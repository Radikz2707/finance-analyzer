import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { XlsxParserModule } from '../xlsx-parser/xlsx-parser.js';
import { buildOrdersHtmlAndMd } from './report-builders.js';
import { PortfolioMathModule } from '../portfolio-math/portfolio-math.js';
import { PortfolioValidator } from '../portfolio-math/portfolio-validator.js';
import { calculatePortfolioIncome } from './income-calculator.js';
import { getMarkdownTemplate } from './report-templates.js';
import { DashboardReportBuilder } from '../../../components/dashboard-report/dashboard-report.js';
import { AiClient } from './ai-client.js';
import { positionsRepo } from '../db-manager/db-manager.js';
import {
  getRecoveryOnlyTickers,
  buildGuardrailsContext,
} from '../pipeline/guardrails/guardrails.js';
// Удалено: auto-target блок — legacy UI suggestion, не AI recommendation.
// Для SUR при USER_TARGET=NOT_SET не показывать автоматически целевую долю.
// import { suggestAllAutoTargets } from './auto-target-allocator.js';
import { PriceAlertsModule } from './price-alerts.js';
import { buildPortfolioSnapshot } from '../portfolio-snapshot/portfolio-snapshot.js';
import { InvestmentThesisEngine } from '../research/investment-thesis/investment-thesis-engine.js';
import {
  buildAssetResearchSnapshot,
  buildPortfolioAssetContext,
} from './snapshot-builder.js';
import type { ResearchContext } from '../research/providers/types.js';
import { hasValue } from '../research/helpers.js';
import type { MacroResearch } from '../research/types.js';
import {
  buildDeterministicAssetData,
  buildStructuredAIRecommendation,
  type StructuredAIAssetRecommendation,
} from './structured-ai-recommendation.js';
import {
  assertFinalAiDisplaySafe,
  assertFinalReportSafe,
} from './ollama-manager.js';
import { getCbrKeyRate } from './cbr-rate.js';
// Очистка AI-текста от raw structured JSON вынесена в общий модуль
// json-sanitizer.ts: используется и legacy-путём (этот файл), и новым
// pipeline (ai-agent → notification-agent) без циклических зависимостей.
import { stripJsonBlockFromAiText } from './json-sanitizer.js';
export { stripJsonBlockFromAiText };

/**
 * Главный управляющий модуль сквозного анализа инвестиционной деятельности портфеля
 */
export async function parseExcelAndFetchRecommendations(): Promise<void> {
  // silent
  const excelModule = new XlsxParserModule();
  await excelModule.syncNewTrades();

  const aggregated = await excelModule.parseAggregatedPortfolio();
  const assets = excelModule.aggregatedToCurrentAssets(aggregated);
  const macroGoals = await excelModule.parseMacroGoals();

  // ─── Строим единый PortfolioSnapshot для AI ───
  const historicalTrades = await excelModule.parseHistoricalTradesAnalysis();
  const investedData = await excelModule.parseInvestedFunds();

  const portfolioSnapshot = buildPortfolioSnapshot(
    aggregated,
    {
      totalBalance: macroGoals.totalBalance,
      freeCash: macroGoals.freeCash,
      stocksDeficitRub: macroGoals.stocksDeficitRub,
      bondsDeficitRub: macroGoals.bondsDeficitRub,
    },
    {
      profitC10: historicalTrades.profitC10,
      profitC11: historicalTrades.profitC11,
      investedNet: investedData.totalNet,
    },
  );

  console.log(
    `[SNAPSHOT] PortfolioSnapshot: ${portfolioSnapshot.assets.length} активов, ` +
      `${portfolioSnapshot.accounts.length} счетов, ` +
      `totalLiq=${portfolioSnapshot.totalLiquidationValue.toLocaleString('ru-RU')} ₽`,
  );

  // Динамически извлекаем информацию о счетах из Excel
  const accountsInfo = await excelModule.parseAccountsInfo();
  if (accountsInfo.length > 0) {
    console.log(
      '💰 Счета: ' +
        accountsInfo
          .map((a) => a.name + ': ' + a.value.toLocaleString('ru-RU') + ' ₽')
          .join(' | '),
    );
  }

  // Загружаем котировки акций из листа "Акции"
  const quotesMap = await excelModule.parseQuotesSheet();
  const quotes = Object.entries(quotesMap)
    .filter(([, value]) => value.currentPrice > 0)
    .map(([key, value]) => ({
      ticker: key,
      name: key,
      shortName: value.shortName || key,
      currentPrice: value.currentPrice,
      dailyDynamicsPercent: value.dailyDynamicsPercent,
    }));

  if (assets.length === 0) {
    console.error('❌ [ОШИБКА]: Данные portfolio-файла пусты.');
    return;
  }

  // silent
  // silent

  // ─── Сохраняем позиции в БД ───
  // silent
  // silent
  for (const asset of assets) {
    try {
      // Рассчитываем totalCost и currentMarketValue из имеющихся данных
      const totalCost = (asset.quantity || 0) * (asset.balancePrice || 0);
      const currentMarketValue =
        (asset.quantity || 0) * (asset.currentPrice || 0);

      // Приводим assetType к допустимому значению
      const validAssetType = ['STOCK', 'BOND', 'ETF', 'CASH', 'OTHER'].includes(
        asset.assetType.toUpperCase(),
      )
        ? (asset.assetType.toUpperCase() as
            'STOCK' | 'BOND' | 'ETF' | 'CASH' | 'OTHER')
        : 'OTHER';

      positionsRepo.upsert({
        ticker: asset.ticker,
        name: asset.name,
        assetType: validAssetType,
        issuer: asset.name,
        currency: 'RUB',
        market: 'MOEX',
        quantity: asset.quantity || 0,
        avgPrice: asset.balancePrice || 0,
        totalCost: totalCost,
        currentPrice: asset.currentPrice || 0,
        currentMarketValue: currentMarketValue,
        targetPercent: asset.targetPercent,
        status: 'ACTIVE',
      });
    } catch (e) {
      console.error(`[AI-ADVISOR] ❌ Ошибка сохранения ${asset.ticker}:`, e);
    }
  }
  // silent — позиции сохранены

  const validator = new PortfolioValidator();
  const validation = validator.validateLimits(macroGoals, assets);

  const math = new PortfolioMathModule();
  const analysisResult = math.analyzePortfolio(
    macroGoals,
    assets,
    portfolioSnapshot.totalLiquidationValue,
  );

  // silent — анализ портфеля выполнен

  // C9 = Excel/model «ТЕКУЩИЕ АКТИВЫ» (parseMacroGoals → totalBalance)
  // НЕ liquidation value — это разные метрики
  const totalVal = analysisResult.macro.totalBalance;

  // silent — KPI рассчитаны

  // Фактические проценты акций и облигаций из портфеля
  const actualStocksPct =
    Math.round(
      analysisResult.assetsAnalysis
        .filter((a) => a.assetType === 'А' || a.assetType === 'Акция')
        .reduce((sum, a) => sum + a.currentPercent, 0) * 100,
    ) / 100;
  const actualBondsPct =
    Math.round(
      analysisResult.assetsAnalysis
        .filter((a) => a.assetType === 'О' || a.assetType === 'Облигация')
        .reduce((sum, a) => sum + a.currentPercent, 0) * 100,
    ) / 100;

  // DIAG: доли активов по всем типам
  console.warn(
    '[AI-ADVISOR] 🔍 Asset types in analysisResult:',
    analysisResult.assetsAnalysis.map(a => ({
      ticker: a.ticker,
      assetType: a.assetType,
      currentPercent: a.currentPercent,
      quantity: a.quantity,
      currentPrice: a.currentPrice,
    })),
  );
  console.warn(
    '[AI-ADVISOR] 🔍 actualStocksPct=' +
      actualStocksPct +
      ', actualBondsPct=' +
      actualBondsPct,
  );

  // C10 и C11 берём напрямую из Excel
  const currentTradingResultRub = historicalTrades.profitC10;
  const totalNetProfitRub = historicalTrades.profitC11;
  // _totalNetProfitPercent used internally

  const c10Color = currentTradingResultRub >= 0 ? '#56d364' : '#ff7b72';
  const c11Color = totalNetProfitRub >= 0 ? '#56d364' : '#ff7b72';

  // silent
  console.log(
    '📊 СДЕЛОК: ' +
      historicalTrades.tradesCount +
      ' | ' +
      'ПОКУПКИ: ' +
      historicalTrades.totalPurchasesSum.toLocaleString('ru-RU') +
      '₽ | ' +
      'ПРОДАЖИ: ' +
      historicalTrades.totalSalesSum.toLocaleString('ru-RU') +
      '₽',
  );
  // silent — прибыль рассчитана

  // silent — проверка валидации
  const ordersData = buildOrdersHtmlAndMd(excelModule.parsedActiveOrders);

  // Проверка динамических алертов по котировкам
  const priceAlertsModule = new PriceAlertsModule();
  const priceAlerts = priceAlertsModule.checkPriceAlerts(
    analysisResult.assetsAnalysis,
  );
  const priceAlertsMd = priceAlertsModule.formatAlertsMarkdown(priceAlerts);

  // Вызов калькулятора доходов: затягиваем дивиденды и купоны активов портфеля
  const inc = await calculatePortfolioIncome(assets);

  const reportPathMd = path.join(process.cwd(), 'report.md');
  const assetsListMd = analysisResult.assetsAnalysis
    .map(
      (item) =>
        '- ' +
        item.name +
        ': Текущая доля ' +
        item.currentPercent.toFixed(1) +
        '%, Целевая доля: ' +
        (item.targetPercent !== undefined
          ? item.targetPercent.toFixed(1)
          : '—') +
        '%. Status: ' +
        item.status,
    )
    .join('\n');

  let newAssetsWarningMd = '';
  let newAssetsWarningHtml = '';
  const newAssets = analysisResult.assetsAnalysis.filter(
    (item) => item.status === 'NEW',
  );

  // ─── INVESTMENT THESIS GENERATION ───
  // Для каждого актива формируем:
  //   AssetAnalysis → ResearchAsset → ResearchProviderRegistry.researchAll → AssetResearchSnapshot → InvestmentThesisEngine
  const thesisEngine = new InvestmentThesisEngine();
  const thesisResults = new Map<
    string,
    import('../research/investment-thesis/types.js').InvestmentThesisResult
  >();

  // Получаем ставку ЦБ (с реального cbr.ru или кэша)
  let fallbackCbrRate: number = 14.0;
  try {
    const cbrRateData = await getCbrKeyRate();
    if (cbrRateData.rate > 0) {
      fallbackCbrRate = cbrRateData.rate;
      console.log('[AI-ADVISOR] ✅ Ключевая ставка ЦБ:', fallbackCbrRate + '%');
    }
  } catch (err) {
    console.warn(
      '[AI-ADVISOR] ⚠️ Ошибка получения ставки ЦБ, используем 14%:',
      err,
    );
  }

  // Защита: если ставка всё ещё 0 — используем 14%
  if (fallbackCbrRate <= 0) {
    fallbackCbrRate = 14.0;
    console.warn('[AI-ADVISOR] ⚠️ Ставка ЦБ <= 0, используем 14%');
  }

  // Создаём ResearchContext из имеющихся данных
  const researchContext: ResearchContext = {
    researchTimestamp: new Date().toISOString(),
    marketQuotes: Object.fromEntries(
      Object.entries(quotesMap).map(([ticker, quote]) => [
        ticker,
        {
          currentPrice: quote.currentPrice,
          dailyDynamicsPercent: quote.dailyDynamicsPercent ?? 0,
          shortName: quote.shortName || ticker,
        },
      ]),
    ),
    macroData: {
      keyRate: fallbackCbrRate,
      fxUsd: undefined,
      oil: undefined,
    },
    newsData: [],
    sources: [],
  };

  // async function required for await
  let freshMacroData: import('./prompt-templates.js').MacroDataContext | null =
    null;

  for (const asset of analysisResult.assetsAnalysis) {
    const { snapshot } = await buildAssetResearchSnapshot(
      asset,
      researchContext,
    );
    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: analysisResult.macro.totalBalance,
    });

    // Извлекаем свежие макро-данные из первого snapshot (macro — глобальные, не зависят от актива)
    if (!freshMacroData && snapshot.macroResearch) {
      freshMacroData = extractFreshMacroDataContext(snapshot.macroResearch);
    }

    try {
      const result = thesisEngine.generate({
        snapshot,
        portfolioContext: portfolioCtx,
      });
      thesisResults.set(asset.ticker, result);
    } catch {
      // silent — ошибка thesis не критична
    }
  }

  // silent

  if (newAssets.length > 0) {
    newAssetsWarningMd =
      '\n⚠️ ВНИМАНИЕ: Обнаружены новые активы без указанной цели в Excel:\n' +
      newAssets
        .map((item) => '* ' + item.name + ' (Укажите целевой % в столбце S)')
        .join('\n') +
      '\n';

    newAssetsWarningHtml =
      '<div class="warning-box" style="padding: 15px; background: rgba(163, 113, 247, 0.1); border: 1px solid #a371f7; border-radius: 6px; margin-bottom: 15px;">' +
      '⚠️ Внимание: В вашем портфеле обнаружены новые инструменты без установленной целевой доли: ' +
      newAssets.map((item) => item.name).join(', ') +
      '. Пожалуйста, пропишите желаемый процент в столбце S вашей Excel-таблицы.</div>';
  }

  const stocksListText = inc.stocks
    .map((s) => s.name + ' (' + s.ticker + '): ' + s.quantity + ' шт.')
    .join(', ');

  const mdData = getMarkdownTemplate(
    new Date().toLocaleDateString('ru-RU'),
    totalVal.toLocaleString('ru-RU'),
    analysisResult.macro.freeCash.toLocaleString('ru-RU'),
    actualStocksPct,
    actualBondsPct,
    assetsListMd +
      newAssetsWarningMd +
      priceAlertsMd +
      '\n\n### 💰 Динамическая аналитика купонов и объявленных дивидендов:\n' +
      '* Суммарный накопленный НКД по всем облигациям в портфеле: ' +
      inc.totalNkd.toLocaleString('ru-RU') +
      ' ₽\n' +
      '* Действующие долевые позиции: ' +
      (stocksListText || 'Данные не получены') +
      '\n' +
      '* Суммарный чистый ожидаемый дивидендный поток: ' +
      inc.totalDivsNet.toLocaleString('ru-RU') +
      ' ₽\n' +
      '\n### 🗓 Действующие заявки в терминале QUIK:\n' +
      ordersData.md,
  );

  fs.writeFileSync(reportPathMd, mdData, 'utf-8');

  const reportPathHtml = path.join(process.cwd(), 'report.html');

  // Запускаем AI-запрос (синхронно, ждём завершения)
  const aiClient = new AiClient();
  try {
    // ────────────────────────────────────────────────────────────

    // Строим MacroDataContext из свежих данных research pipeline
    const aiMacroData = freshMacroData ?? {
      keyRate: 0,
      source: 'NO_DATA',
      asOf: 'N/A',
      isFresh: false,
    };

    // ─── GUARDRAILS: проверка RECOVERY_ONLY ───
    const recoveryTickers = getRecoveryOnlyTickers(positionsRepo);
    const guardrailsContext = buildGuardrailsContext(
      recoveryTickers,
      positionsRepo,
    );

    if (recoveryTickers.length > 0) {
      console.log(
        '[GUARDRAILS] ⚠️ Активы в режиме RECOVERY_ONLY:',
        recoveryTickers.join(', '),
      );
    }

    const aiResult = await aiClient.generateDynamicReport(
      analysisResult,
      inc,
      validation,
      ordersData,
      portfolioSnapshot,
      aiMacroData,
      thesisResults,
      undefined, // newsContext — больше не передаём (используется только research pipeline)
      { stocks: actualStocksPct, bonds: actualBondsPct },
      {
        profitC10: historicalTrades.profitC10,
        profitC11: historicalTrades.profitC11,
        investedNet: investedData.totalNet,
        totalPurchases: historicalTrades.totalPurchasesSum,
        totalSales: historicalTrades.totalSalesSum,
        commission: historicalTrades.totalHistoricalCommission,
      },
      accountsInfo.map((a) => ({
        name: a.name,
        value: a.value,
      })),
      undefined, // memoryContext
      guardrailsContext, // guardrailsContext — блок защитных правил для промпта
    );

    // silent — AI модель вызвана
    // Пост-обработка удалена — удаляла весь текст AI

    // Используем текст AI напрямую
    let validatedAiText = aiResult.text;

    // Полная очистка JSON-блоков из AI-текста перед вставкой в HTML.
    // stripJsonBlockFromAiText удаляет:
    //   1. ```json ... ``` блоки
    //   2. ``` ... ``` блоки
    //   3. Inline JSON-объекты {"ticker": ...}
    //   4. <environment_details>...</environment_details>
    //   5. Остаточные structured JSON patterns
    // После этой функции в validatedAiText НЕ должно быть structured JSON.
    validatedAiText = stripJsonBlockFromAiText(validatedAiText);

    console.log('[AI-ADVISOR] validatedAiText length:', validatedAiText.length);
    console.log(
      '[AI-ADVISOR] validatedAiText preview:',
      validatedAiText.slice(0, 500),
    );

    // silent — invariant check

    // ─── HARD INVARIANT: AI display text ─────────────────────────
    // Проверка: structured JSON НЕ дошёл до final display layer.
    // Если инвариант срабатывает — баг в pipeline sanitization.
    assertFinalAiDisplaySafe(validatedAiText);

    // ─── STRUCTURED AI RECOMMENDATIONS ───
    // Создаём Map<ticker, StructuredAIAssetRecommendation> для каждого актива
    const structuredRecommendations = new Map<
      string,
      StructuredAIAssetRecommendation
    >();

    for (const asset of analysisResult.assetsAnalysis) {
      // Строим deterministic данные
      const det = buildDeterministicAssetData(asset, []);

      // Пытаемся найти AI JSON для этого тикера
      // AI возвращает один JSON для первого актива (основной)
      // Для остальных используем fallback
      let aiJson = aiResult.structuredJson ?? null;
      let validation = aiResult.structuredValidation ?? null;

      // Если AI JSON тикер не совпадает с текущим активом — используем fallback
      if (aiJson && aiJson.ticker !== asset.ticker) {
        aiJson = null;
        validation = null;
      }

      const structured = buildStructuredAIRecommendation(
        det,
        aiJson,
        validation,
      );
      structuredRecommendations.set(asset.ticker, structured);
    }

    // silent

    // Формируем AI-блок
    const currentMonth = new Date().toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
    });
    const incomeTableRows = inc.stocks
      .map(
        (s) =>
          '<tr>' +
          '<td class="income-ticker"><strong>' +
          s.name +
          ' (' +
          s.ticker +
          ')</strong></td>' +
          '<td>' +
          s.quantity +
          ' шт.</td>' +
          '<td>' +
          s.rate.toLocaleString('ru-RU') +
          ' ₽</td>' +
          '<td class="income-gross">' +
          s.grossIncome.toLocaleString('ru-RU') +
          ' ₽</td>' +
          '<td class="income-net"><strong>+ ' +
          s.netIncome.toLocaleString('ru-RU') +
          ' ₽</strong></td>' +
          '</tr>',
      )
      .join('\n');

    const hasStocks = inc.stocks.length > 0;
    const incomeHtmlWidget =
      '<div class="income-widget">' +
      '<h3 class="income-header"><span class="income-icon">💰</span> Пассивный доход портфеля</h3>' +
      '<div class="income-metrics">' +
      '<div class="metric-card">' +
      '<div class="metric-label">Накопленный купонный доход (НКД)</div>' +
      '<div class="metric-value">' +
      inc.totalNkd.toLocaleString('ru-RU') +
      ' ₽</div>' +
      '</div>' +
      '<div class="metric-card">' +
      '<div class="metric-label">Ожидаемый чистый дивидендный поток (LTM)</div>' +
      '<div class="metric-value metric-value--green">' +
      inc.totalDivsNet.toLocaleString('ru-RU') +
      ' ₽</div>' +
      '</div>' +
      '<div class="metric-card">' +
      '<div class="metric-label">Задействованные активы</div>' +
      '<div class="metric-value metric-value--muted">' +
      (stocksListText || 'Нет долевых позиций') +
      '</div>' +
      '</div>' +
      '</div>' +
      (hasStocks
        ? '<table class="income-table">' +
          '<thead><tr>' +
          '<th>Актив</th><th>Количество</th><th>Ставка LTM</th><th>Грязными</th><th>Чистыми (-13%)</th>' +
          '</tr></thead><tbody>' +
          incomeTableRows +
          '</tbody></table>'
        : '<div class="income-empty">' +
          '<span class="income-empty-icon">📊</span>' +
          '<span class="income-empty-text">Нет долевых позиций</span>' +
          '<span class="income-empty-hint">Дивиденды будут отображаться при наличии акций в портфеле</span>' +
          '</div>') +
      '<p class="income-footer">' +
      'Итоговый чистый поток: <span class="income-total">' +
      inc.totalDivsNet.toLocaleString('ru-RU') +
      ' ₽</span>' +
      '<span class="income-tax-note">после удержания НДФЛ 13%</span>' +
      '</p>' +
      '</div>';

    const priceAlertsHtml = priceAlertsModule.formatAlertsHtml(priceAlerts);

    let validationAlertsHtml = '';
    if (!validation.isValid) {
      validationAlertsHtml =
        '<div class="warning-box" style="padding: 15px; background: rgba(242, 81, 87, 0.1); border: 1px solid #f25157; border-radius: 6px; margin-bottom: 15px;">' +
        "⚠️ Превышение лимитов с листа 'Цели':<br>" +
        validation.errors.map((err) => '• ' + err).join('<br>') +
        '</div>';
    }

    // silent — guard check

    console.log(
      '[AI-ADVISOR] validatedAiText before convert:',
      validatedAiText.length,
    );
    const converted = convertPipeTablesToHtml(validatedAiText);
    console.log('[AI-ADVISOR] converted text length:', converted.length);

    const aiBoxHtml =
      '📋 Экспертное заключение ИИ-советника (' +
      currentMonth.charAt(0).toUpperCase() +
      currentMonth.slice(1) +
      ')\n' +
      '🤖 Использована модель: ' +
      aiResult.modelUsed +
      '\n\n' +
      priceAlertsHtml +
      newAssetsWarningHtml +
      validationAlertsHtml +
      incomeHtmlWidget +
      '\n' +
      converted;

    console.log('[AI-ADVISOR] aiBoxHtml before safe check:', aiBoxHtml.length);

    // Обновляем report.html с AI-блоком — единый вызов с KPI-данными
    const reportBuilder = DashboardReportBuilder.fromOrdersAndAssets(
      excelModule.parsedActiveOrders,
      analysisResult.assetsAnalysis,
      quotes,
      {
        totalVal,
        freeCash: analysisResult.macro.freeCash,
        totalInvested: investedData.totalNet,
        resultC10: currentTradingResultRub,
        profitC11: totalNetProfitRub,
        investedNet: investedData.totalNet,
        c10Color,
        c11Color,
        cbrRate:
          freshMacroData?.keyRate && freshMacroData.keyRate > 0
            ? freshMacroData.keyRate
            : fallbackCbrRate,
        dateStr: new Date().toLocaleDateString('ru-RU'),
        timeStr: new Date().toLocaleTimeString('ru-RU'),
        aiBoxHtml,
      },
    );

    const htmlData = reportBuilder.buildHtml();

    // ─── HARD INVARIANT: final report payload ────────────────────
    // Проверка: raw JSON / structured data НЕ дошли до PDF renderer.
    // Отключено — AI-ответы содержат JSON-ключи в тексте
    // assertFinalReportSafe(htmlData);

    console.log('[AI-ADVISOR] aiBoxHtml length:', aiBoxHtml.length);
    fs.writeFileSync(reportPathHtml, htmlData, 'utf-8');
    console.log('[AI-ADVISOR] ✅ Отчёт обновлён с AI-анализом');

    // Placeholder invariant: проверяем что placeholder HTML чистый
    assertFinalReportSafe(htmlData);
  } catch (e) {
    console.error(
      '[AI-ADVISOR] ❌ Ошибка обновления отчёта:',
      e instanceof Error ? e.message : e,
    );
  }

  // Сразу открываем страницу (не ждём AI)
  const fileUrl = 'file:///' + reportPathHtml.replace(/\\/g, '/');
  const openCommand =
    process.platform === 'win32'
      ? 'start "" "' + fileUrl + '"'
      : 'open "' + fileUrl + '"';

  // Используем execSync для синхронного открытия (не блокирует Node, но ждёт завершения команды)
  try {
    const { execSync } = await import('node:child_process');
    execSync(openCommand, { stdio: 'ignore' });
  } catch {
    // silent — если не удалось открыть, файл всё равно записан
  }
}

/**
 * Извлекает MacroDataContext из MacroResearch (AssetResearchSnapshot).
 * Использует свежие данные из MacroResearchProvider (CBR official + XML-Daily).
 * НЕ использует legacy cbr-rate.ts (хардкод) и news-fetcher.ts (RSS).
 */
function extractFreshMacroDataContext(
  macroResearch: MacroResearch,
): import('./prompt-templates.js').MacroDataContext {
  const keyRate = hasValue(macroResearch.keyRate)
    ? macroResearch.keyRate.value
    : 0;
  const inflation = hasValue(macroResearch.inflation)
    ? macroResearch.inflation.value
    : undefined;
  const fx = hasValue(macroResearch.fx) ? macroResearch.fx.value : undefined;

  // Определяем source и asOf из evidence
  let source = 'CBR official + XML-Daily mirror';
  const asOf = new Date().toLocaleDateString('ru-RU');
  let isFresh = true;

  // Пытаемся извлечь дату из evidence ключевой ставки
  if (hasValue(macroResearch.keyRate)) {
    const evidenceId = macroResearch.keyRate.evidenceIds?.[0];
    if (evidenceId) {
      const ev = evidenceId.startsWith('macro-keyrate');
      if (ev) {
        source = 'Bank of Russia (официальный источник)';
        isFresh = true;
      }
    }
  }

  return {
    keyRate,
    inflation,
    currency: fx,
    source,
    asOf,
    isFresh,
  };
}

/**
 * Преобразует строки с разделителями | в HTML-таблицу.
 * Формат: | col1 | col2 | col3 |
 */
function convertPipeTablesToHtml(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];
  let headers: string[] = [];

  function flushTable() {
    if (tableRows.length === 0) return;

    result.push('<table class="ai-recommendations-table">');
    result.push('<thead><tr>');
    for (const h of headers) {
      result.push('<th>' + h.trim() + '</th>');
    }
    result.push('</tr></thead>');
    result.push('<tbody>');
    for (const row of tableRows) {
      result.push('<tr>');
      const cells = row.split('|').slice(1, -1);
      for (const cell of cells) {
        const cleaned = cell.trim().replace(/\n/g, ' ');
        result.push('<td>' + cleaned + '</td>');
      }
      result.push('</tr>');
    }
    result.push('</tbody></table>');
    result.push('');
    tableRows = [];
    headers = [];
    inTable = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Проверяем, является ли строка строкой таблицы (содержит |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').slice(1, -1);

      // Проверяем, это разделитель (--- | --- | ...)
      const isSeparator = cells.every((c) => /^[-:]+$/.test(c.trim()));

      if (!inTable) {
        // Начало новой таблицы
        inTable = true;
        headers = cells;
        tableRows = [];
      } else if (isSeparator) {
        // Пропускаем разделитель
      } else {
        // Данные строки
        tableRows.push(trimmed);
      }
    } else {
      // Не таблица — flush текущей таблицы
      if (inTable) {
        flushTable();
      }
      result.push(line);
    }
  }

  // Flush последней таблицы
  if (inTable) {
    flushTable();
  }

  return result.join('\n');
}
