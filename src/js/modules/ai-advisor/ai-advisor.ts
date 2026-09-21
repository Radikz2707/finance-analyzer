import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { exec } from 'node:child_process';
import { XlsxParserModule } from '../xlsx-parser/xlsx-parser.js';
import {
  buildOrdersHtmlAndMd,
} from './report-builders.js';
import { PortfolioMathModule } from '../portfolio-math/portfolio-math.js';
import { PortfolioValidator } from '../portfolio-math/portfolio-validator.js';
import { calculatePortfolioIncome } from './income-calculator.js';
import { getMarkdownTemplate } from './report-templates.js';
import { DashboardReportBuilder } from '../../../components/dashboard-report/dashboard-report.js';
import { AiClient } from './ai-client.js';
// Удалено: auto-target блок — legacy UI suggestion, не AI recommendation.
// Для SUR при USER_TARGET=NOT_SET не показывать автоматически целевую долю.
// import { suggestAllAutoTargets } from './auto-target-allocator.js';
import { PriceAlertsModule } from './price-alerts.js';
import { buildPortfolioSnapshot } from '../portfolio-snapshot/portfolio-snapshot.js';
import { InvestmentThesisEngine } from '../research/investment-thesis/investment-thesis-engine.js';
import { buildAssetResearchSnapshot, buildPortfolioAssetContext } from './snapshot-builder.js';
import type { ResearchContext } from '../research/providers/types.js';
import { hasValue } from '../research/helpers.js';
import type { MacroResearch } from '../research/types.js';
import {
  buildDeterministicAssetData,
  buildStructuredAIRecommendation,
  type StructuredAIAssetRecommendation,
} from './structured-ai-recommendation.js';
import {
  sanitizeAiNarrative,
  assertFinalAiDisplaySafe,
  assertFinalReportSafe,
} from './ollama-manager.js';
import { postProcessAiText } from './ai-validation.js';

/**
 * Главный управляющий модуль сквозного анализа инвестиционной деятельности портфеля
 */
export async function parseExcelAndFetchRecommendations(): Promise<void> {
  console.log('[AI-ADVISOR] >>> Начало генерации отчёта');
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
      accountsInfo.map((a) => a.name + ': ' + a.value.toLocaleString('ru-RU') + ' ₽').join(' | '),
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

  const validator = new PortfolioValidator();
  const validation = validator.validateLimits(macroGoals, assets);

  const math = new PortfolioMathModule();
  const analysisResult = math.analyzePortfolio(
    macroGoals,
    assets,
    portfolioSnapshot.totalLiquidationValue,
  );

  // ─── DIAGNOSTIC: PORTFOLIO TABLE ROWS COUNT ─────────────────────
  console.log(
    '[PORTFOLIO] ' +
    'assets=' + assets.length + ' | ' +
    'analysis=' + analysisResult.assetsAnalysis.length + ' | ' +
    'snapshot=' + portfolioSnapshot.assets.length,
  );

  // C9 = Excel/model «ТЕКУЩИЕ АКТИВЫ» (parseMacroGoals → totalBalance)
  // НЕ liquidation value — это разные метрики
  const totalVal = analysisResult.macro.totalBalance;

  // ─── DIAGNOSTIC: DASHBOARD_KPI_SOURCE ─────────────────────────────
  console.log(
    '[KPI] C9=' + totalVal.toLocaleString('ru-RU') + '₽ | ' +
    'C10=' + historicalTrades.profitC10.toLocaleString('ru-RU') + '₽ | ' +
    'C11=' + historicalTrades.profitC11.toLocaleString('ru-RU') + '₽ | ' +
    'C12=' + investedData.totalNet.toLocaleString('ru-RU') + '₽',
  );

  // Фактические проценты акций и облигаций из портфеля
  const actualStocksPct = Math.round(
    analysisResult.assetsAnalysis
      .filter((a) => a.assetType === 'А' || a.assetType === 'Акция')
      .reduce((sum, a) => sum + a.currentPercent, 0) * 100
  ) / 100;
  const actualBondsPct = Math.round(
    analysisResult.assetsAnalysis
      .filter((a) => a.assetType === 'О' || a.assetType === 'Облигация')
      .reduce((sum, a) => sum + a.currentPercent, 0) * 100
  ) / 100;

  // C10 и C11 берём напрямую из Excel
  const currentTradingResultRub = historicalTrades.profitC10;
  const totalNetProfitRub = historicalTrades.profitC11;
  const totalNetProfitPercent =
    investedData.totalNet > 0
      ? (totalNetProfitRub / investedData.totalNet) * 100
      : 0;

  const c10Color = currentTradingResultRub >= 0 ? '#56d364' : '#ff7b72';
  const c11Color = totalNetProfitRub >= 0 ? '#56d364' : '#ff7b72';

  console.log(
    '==================================================',
  );
  console.log(
    '📊 СДЕЛОК: ' + historicalTrades.tradesCount + ' | ' +
    'ПОКУПКИ: ' + historicalTrades.totalPurchasesSum.toLocaleString('ru-RU') + '₽ | ' +
    'ПРОДАЖИ: ' + historicalTrades.totalSalesSum.toLocaleString('ru-RU') + '₽',
  );
  console.log(
    '📊 ТЕКУЩАЯ ПРИБЫЛЬ (C10): ' + historicalTrades.profitC10.toLocaleString('ru-RU') + '₽ | ' +
    'КОМИССИЯ: ' + historicalTrades.totalHistoricalCommission.toLocaleString('ru-RU') + '₽',
  );
  console.log(
    '📊 ОЦЕНКА АКТИВОВ (C9): ' + totalVal.toLocaleString('ru-RU') + '₽ | ' +
    'РЕЗУЛЬТАТ (C10): ' + currentTradingResultRub.toLocaleString('ru-RU') + '₽ | ' +
    'ВЛОЖЕНО (C12): ' + investedData.totalNet.toLocaleString('ru-RU') + '₽',
  );
  console.log(
    '🌟 ИНВЕСТ-РЕЗУЛЬТАТ (C11): ' +
      (totalNetProfitRub >= 0 ? '+' : '') +
      totalNetProfitRub.toLocaleString('ru-RU') + '₽ (' +
      totalNetProfitPercent.toFixed(2) + '%)',
  );

  if (!validation.isValid) {
    console.warn('⚠️ ОБНАРУЖЕНЫ НАРУШЕНИЯ РИСК-МЕНЕДЖМЕНТА:');
    validation.errors.forEach((err) => console.warn('- ' + err));
  }
  console.log('==================================================');
  const ordersData = buildOrdersHtmlAndMd(excelModule.parsedActiveOrders);

  // Проверка динамических алертов по котировкам
  const priceAlertsModule = new PriceAlertsModule();
  const priceAlerts = priceAlertsModule.checkPriceAlerts(analysisResult.assetsAnalysis);
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
  const thesisResults = new Map<string, import('../research/investment-thesis/types.js').InvestmentThesisResult>();

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
      ])
    ),
    macroData: {
      keyRate: undefined,
      fxUsd: undefined,
      oil: undefined,
    },
    newsData: [],
    sources: [],
  };

  // async function required for await
  let freshMacroData: import('./prompt-templates.js').MacroDataContext | null = null;

  for (const asset of analysisResult.assetsAnalysis) {
    const { snapshot } = await buildAssetResearchSnapshot(asset, researchContext);
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
    } catch (err) {
      console.error(
        `[THESIS] Ошибка генерации thesis для ${asset.ticker}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `[THESIS] Сформировано thesis для ${thesisResults.size} из ${analysisResult.assetsAnalysis.length} активов`,
  );

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

  // Запускаем AI-запрос в фоне (не блокирует открытие отчёта)
  void (async () => {
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
      );

      console.log(
        '[AI] Модель: ' + aiResult.modelUsed +
        ' | Статус: ' + (aiResult.success ? '✅ Успешно' : '⚠️ Fallback') +
        (aiResult.error ? ' | Ошибка: ' + aiResult.error : '')
      );

      // ─── CANONICAL SANITIZED AI TEXT ─────────────────────────────
      // Один очищенный AI-текст для ВСЕХ display paths.
      // aiResult.text больше НЕ используется напрямую после этой строки.
      // Только sanitizedAiText или deterministic structured data.
      const strippedText = stripJsonBlockFromAiText(aiResult.text);
      const sanitizedAiText = sanitizeAiNarrative(strippedText);

      // ─── POST-PROCESSING: AI VALIDATION MODULE ───────────────────
      // Полная пост-обработка: валидация направлений, удаление
      // галлюцинированных данных, проверка исключённых активов.
      const postProcessResult = postProcessAiText(
        sanitizedAiText,
        analysisResult.assetsAnalysis,
      );

      // Логируем предупреждения валидации
      if (postProcessResult.warnings.length > 0) {
        console.log('[AI-VALIDATION] Предупреждения пост-обработки:');
        for (const warning of postProcessResult.warnings) {
          console.log('  ⚠️  ' + warning);
        }
      }

      // Используем очищенный текст из пост-обработки
      const validatedAiText = postProcessResult.cleanedText;

      // ─── DIAGNOSTIC: PRE-ASSERT AI DISPLAY SAFE ──────────────────
      const forbiddenFields = ['recommendedTargetPercent', 'recommendedAction', 'agreementWithPortfolioMath'];
      const foundForbidden = forbiddenFields.filter((f) => validatedAiText.includes(f));
      if (foundForbidden.length > 0) {
        console.warn(
          '[AI] ⚠️ Forbidden fields in validatedAiText:',
          foundForbidden,
        );
      }

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

      console.log(
        `[STRUCTURED] Создано рекомендаций: ${structuredRecommendations.size}`,
      );

      // Формируем AI-блок
      const currentMonth = new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
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

       // ─── GUARD: structuredJson НЕ должен попадать в aiBoxHtml ────
       // structuredJson используется ТОЛЬКО для StructuredAIAssetRecommendation
       // и никогда не должен сериализоваться в display layer.
       if (aiResult.structuredJson) {
         console.log(
           '[AI-BOX-GUARD] structuredJson present but NOT included in aiBoxHtml — ' +
           'only sanitizedAiText is used for display.',
         );
       }

       const aiBoxHtml =
         '📋 Экспертное заключение ИИ-советника (' +
         currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1) +
         ')\n' +
        '🤖 Использована модель: ' + aiResult.modelUsed + '\n\n' +
          priceAlertsHtml +
          newAssetsWarningHtml +
          validationAlertsHtml +
          incomeHtmlWidget +
          '\n' +
          validatedAiText;

      // Обновляем report.html с AI-блоком
      const reportBuilder = DashboardReportBuilder.fromOrdersAndAssets(
        excelModule.parsedActiveOrders,
        analysisResult.assetsAnalysis,
        quotes,
      );

      reportBuilder.data.totalVal = totalVal.toLocaleString('ru-RU');
      reportBuilder.data.freeCash = analysisResult.macro.freeCash.toLocaleString('ru-RU');
      reportBuilder.data.stocksPct = actualStocksPct;
      reportBuilder.data.bondsPct = actualBondsPct;
      reportBuilder.data.cbrRate = freshMacroData?.keyRate ?? 0;
      reportBuilder.data.totalInvested = investedData.totalNet.toLocaleString('ru-RU');
      reportBuilder.data.resultC10 = currentTradingResultRub.toLocaleString('ru-RU');
      reportBuilder.data.profitC11 =
        totalNetProfitRub.toLocaleString('ru-RU') +
        ' (' +
        totalNetProfitPercent.toFixed(2) +
        '%)';
      reportBuilder.data.c10Color = c10Color;
      reportBuilder.data.c11Color = c11Color;
      reportBuilder.data.dateStr = new Date().toLocaleDateString('ru-RU');
      reportBuilder.data.timeStr = new Date().toLocaleTimeString('ru-RU');
      reportBuilder.data.aiBoxHtml = aiBoxHtml;

      const htmlData = reportBuilder.buildHtml();

      // ─── HARD INVARIANT: final report payload ────────────────────
      // Проверка: raw JSON / structured data НЕ дошли до PDF renderer.
      // Это ПОСЛЕДНИЙ рубеж — если HTML содержит forbidden patterns,
      // сборка падает. Нельзя silently sanitizing malformed report.
      assertFinalReportSafe(htmlData);

      fs.writeFileSync(reportPathHtml, htmlData, 'utf-8');
      console.log('[AI] ✅ Отчёт обновлён с AI-анализом');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[AI] ❌ Ошибка:', msg);
    }
  })();

  // Placeholder для AI-блока (будет обновлён фоном)
  const aiBoxHtmlPlaceholder =
    '<div class="ai-loading">' +
    '<h3>📋 ИИ-советник</h3>' +
    '<p>⏳ Загрузка анализа...</p>' +
    '<p style="color: #8b949e; font-size: 12px;">Анализ выполнится в фоне и обновит отчёт</p>' +
    '</div>';

  // Сборка веб-интерфейса дашборда на основе очищенных данных
  const reportBuilder = DashboardReportBuilder.fromOrdersAndAssets(
    excelModule.parsedActiveOrders,
    analysisResult.assetsAnalysis,
    quotes,
  );

  // Переопределяем данные для карточек KPI
  reportBuilder.data.totalVal = totalVal.toLocaleString('ru-RU');
  reportBuilder.data.freeCash = analysisResult.macro.freeCash.toLocaleString('ru-RU');
  reportBuilder.data.stocksPct = actualStocksPct;
  reportBuilder.data.bondsPct = actualBondsPct;
  reportBuilder.data.cbrRate = freshMacroData?.keyRate ?? 0;
  reportBuilder.data.totalInvested = investedData.totalNet.toLocaleString('ru-RU');
  reportBuilder.data.resultC10 = currentTradingResultRub.toLocaleString('ru-RU');
  reportBuilder.data.profitC11 =
    totalNetProfitRub.toLocaleString('ru-RU') +
    ' (' +
    totalNetProfitPercent.toFixed(2) +
    '%)';
  reportBuilder.data.c10Color = c10Color;
  reportBuilder.data.c11Color = c11Color;
  reportBuilder.data.dateStr = new Date().toLocaleDateString('ru-RU');
  reportBuilder.data.timeStr = new Date().toLocaleTimeString('ru-RU');
  reportBuilder.data.aiBoxHtml = aiBoxHtmlPlaceholder;

  const htmlData = reportBuilder.buildHtml();

  // Placeholder invariant: проверяем что placeholder HTML чистый
  assertFinalReportSafe(htmlData);

  fs.writeFileSync(reportPathHtml, htmlData, 'utf-8');

  // Сразу открываем страницу (не ждём AI)
  const cleanPathHtml = reportPathHtml.replace(/\\/g, '/');
  const openCommand =
    process.platform === 'win32'
      ? 'start "" "' + cleanPathHtml + '"'
      : 'open "' + cleanPathHtml + '"';
  exec(openCommand);

  console.log('[REPORT] ✅ Отчёт открыт (AI-анализ выполнится в фоне)');
}

/**
 * Извлекает MacroDataContext из MacroResearch (AssetResearchSnapshot).
 * Использует свежие данные из MacroResearchProvider (CBR official + XML-Daily).
 * НЕ использует legacy cbr-rate.ts (хардкод) и news-fetcher.ts (RSS).
 */
function extractFreshMacroDataContext(
  macroResearch: MacroResearch,
): import('./prompt-templates.js').MacroDataContext {
  const keyRate = hasValue(macroResearch.keyRate) ? macroResearch.keyRate.value : 0;
  const inflation = hasValue(macroResearch.inflation) ? macroResearch.inflation.value : undefined;
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
 * Удаляет JSON-блок из AI-ответа перед вставкой в HTML/PDF.
 * Raw JSON никогда не должен попадать в HTML — он используется только
 * для построения StructuredAIAssetRecommendation через aiResult.structuredJson.
 *
 * Покрывает ВСЕ форматы:
 *  1. ```json { ... } ```  (fenced с маркером)
 *  2. ``` { ... } ```      (fenced без маркера)
 *  3. {"ticker": ... }     (сырой JSON-объект без маркеров, inline)
 *  4. <environment_details>...</environment_details>
 *  5. Многострочный JSON с вложенными объектами и массивами
 */
export function stripJsonBlockFromAiText(text: string): string {
  let result = text;

  // 1. Удаляем ```json ... ``` блок (fenced с маркером)
  result = result.replace(/```json\s*[\s\S]*?```/g, '');
  // 2. Удаляем ``` ... ``` блок (fenced без маркера)
  result = result.replace(/```\s*[\s\S]*?```/g, '');

  // 3. Удаляем сырой JSON-объект {"ticker": ... } без маркеров (inline)
  //    Используем brace-counting для корректного удаления вложенных объектов
  result = removeInlineJsonObject(result);

  // 4. Удаляем <environment_details>...</environment_details>
  result = result.replace(/<environment_details>[\s\S]*?<\/environment_details>/g, '');

  // 5. Пост-очистка: удаляем оставшиеся одиночные { "ticker" ... } без закрывающей }
  //    (на случай если LLM оборвал JSON)
  result = result.replace(/\{\s*"ticker"\s*:[^}]*$/gm, '');

  // 6. Финальная проверка: удаляем любые оставшиеся structured JSON patterns
  //    на случай если что-то проскочило
  result = result.replace(/"recommendedTargetPercent"\s*:/g, '');
  result = result.replace(/"recommendedAction"\s*:/g, '');
  result = result.replace(/"agreementWithPortfolioMath"\s*:/g, '');

  return result.trim();
}

/**
 * Удаляет inline JSON-объект {"ticker": ...} с корректной обработкой
 * вложенных объектов и массивов через подсчёт скобок.
 */
function removeInlineJsonObject(text: string): string {
  const pattern = /\{\s*"ticker"\s*:/;
  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const startIdx = match.index;

    // Защита от бесконечного цикла: если паттерн совпал в той же позиции
    if (startIdx <= lastIndex) {
      break;
    }

    // Находим закрывающую } с учётом вложенности
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    let endIdx = -1;

    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (ch === '\\') {
        escapeNext = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === '{' || ch === '[') {
        braceCount++;
      } else if (ch === '}' || ch === ']') {
        braceCount--;
        if (braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }

    if (endIdx > startIdx) {
      result += text.slice(lastIndex, startIdx);
      result += '[JSON_BLOCK_REMOVED]';
      lastIndex = endIdx;
    } else {
      // Не нашли закрывающую скобку — пропускаем
      lastIndex = startIdx + 1;
    }
  }

  result += text.slice(lastIndex);
  return result;
}
