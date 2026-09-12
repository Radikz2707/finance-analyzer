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
import { getCbrKeyRate } from './cbr-rate.js';
import { suggestAllAutoTargets } from './auto-target-allocator.js';
import { PriceAlertsModule } from './price-alerts.js';
import { NewsFetcherModule } from './news-fetcher.js';

/**
 * Главный управляющий модуль сквозного анализа инвестиционной деятельности портфеля
 */
export async function parseExcelAndFetchRecommendations(): Promise<void> {
  console.log('[AI-ADVISOR] >>> Начало генерации отчёта');
  const excelModule = new XlsxParserModule();
  await excelModule.syncNewTrades();

  const assets = await excelModule.parseCurrentPortfolio();
  const macroGoals = await excelModule.parseMacroGoals();

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

  const investedData = await excelModule.parseInvestedFunds();
  const historicalTrades = await excelModule.parseHistoricalTradesAnalysis();

  const math = new PortfolioMathModule();
  const analysisResult = math.analyzePortfolio(macroGoals, assets);

  const totalVal = analysisResult.macro.totalBalance;

  // Фактические проценты акций и облигаций из портфеля
  const actualStocksPct = analysisResult.assetsAnalysis
    .filter((a) => a.assetType === 'А' || a.assetType === 'Акция')
    .reduce((sum, a) => sum + a.currentPercent, 0);
  const actualBondsPct = analysisResult.assetsAnalysis
    .filter((a) => a.assetType === 'О' || a.assetType === 'Облигация')
    .reduce((sum, a) => sum + a.currentPercent, 0);

  // C10 и C11 берём напрямую из Excel
  const currentTradingResultRub = historicalTrades.profitC10;
  const totalNetProfitRub = historicalTrades.profitC11;
  const totalNetProfitPercent =
    investedData.totalNet > 0
      ? (totalNetProfitRub / investedData.totalNet) * 100
      : 0;

  const c10Color = currentTradingResultRub >= 0 ? '#56d364' : '#ff7b72';
  const c11Color = totalNetProfitRub >= 0 ? '#56d364' : '#ff7b72';

  console.log('==================================================');
  console.log('📊 СКВОЗНОЙ ИСТОРИЧЕСКИЙ АНАЛИЗ ДЕЯТЕЛЬНОСТИ (EXCEL MODEL)');
  console.log(
    '▪️ Всего проведено сделок с начала учета: ' +
      historicalTrades.tradesCount +
      ' шт.',
  );
  console.log(
    '🛒 Общий объем покупок (Купля): ' +
      historicalTrades.totalPurchasesSum.toLocaleString('ru-RU') +
      ' ₽',
  );
  console.log(
    '💰 Общий объем продаж (Продажа): ' +
      historicalTrades.totalSalesSum.toLocaleString('ru-RU') +
      ' ₽',
  );
  console.log(
    '📉 Текущая прибыль (C10): ' +
      historicalTrades.profitC10.toLocaleString('ru-RU') +
      ' ₽',
  );
  console.log(
    '▪️ Всего уплачено комиссий брокера (C6): ' +
      historicalTrades.totalHistoricalCommission.toLocaleString('ru-RU') +
      ' ₽',
  );
  console.log(
    '📈 Текущая оценка активов in наличии (C9): ' +
      totalVal.toLocaleString('ru-RU') +
      ' ₽',
  );

  // Вывод в терминал Thunderobot теперь полностью выровнен и точен копейка в копейку с Excel
  console.log(
    '📊 Результат за весь период (C10): ' +
      currentTradingResultRub.toLocaleString('ru-RU') +
      ' ₽',
  );
  console.log(
    '💰 Чистый объем лично вложенных средств (C12): ' +
      investedData.totalNet.toLocaleString('ru-RU') +
      ' ₽',
  );
  console.log(
    '🌟 Текущий инвест-результат (C11): ' +
      (totalNetProfitRub >= 0 ? '+' : '') +
      totalNetProfitRub.toLocaleString('ru-RU') +
      ' ₽ (' +
      totalNetProfitPercent.toFixed(2) +
      '%)',
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

  // Получаем актуальное значение ключевой ставки с автоматическим JSON-обновлением
  const cbrRate = await getCbrKeyRate();
  console.log(
    '🏦 Ключевая ставка ЦБ РФ: ' +
      cbrRate.rate +
      '% (от ' +
      cbrRate.date +
      ', ' +
      cbrRate.source +
      ')',
  );

  // Загрузка новостного фона и макроэкономических индикаторов
  console.log('[NEWS] Загрузка свежих новостей и макро-данных...');
  const newsFetcher = new NewsFetcherModule();
  const [newsContext, macroIndicators] = await Promise.all([
    newsFetcher.fetchMarketNews(),
    newsFetcher.getMacroIndicators(),
  ]);

  // Объединяем новостной и макро-контекст
  const combinedContext = [newsContext, macroIndicators]
    .filter(Boolean)
    .join('\n\n');

  if (combinedContext) {
    console.log('[NEWS] ✅ Новости и макро-данные загружены');
  } else {
    console.log('[NEWS] ⚠️ Новости не загружены, анализ без новостного фона');
  }

  const reportPathMd = path.join(process.cwd(), 'report.md');
  const assetsListMd = analysisResult.assetsAnalysis
    .map(
      (item) =>
        '- ' +
        item.name +
        ': Текущая доля ' +
        item.currentPercent.toFixed(1) +
        '%, Целевая доля: ' +
        item.targetPercent.toFixed(1) +
        '%. Status: ' +
        item.status,
    )
    .join('\n');

  let newAssetsWarningMd = '';
  let newAssetsWarningHtml = '';
  let autoTargetsMd = '';
  const newAssets = analysisResult.assetsAnalysis.filter(
    (item) => item.status === 'NEW',
  );

  // ЗАЩИТА: Если у фонда STME ETF цель 0.0% — это плановый выход, фиолетовую плашку варнинга не выводим
  const trulyNewAssets = newAssets.filter((item) => item.ticker !== 'STME');

  // АВТОПРЕДЛОЖЕНИЕ ЦЕЛЕВЫХ ДОЛЬ для новых активов
  const autoTargets = suggestAllAutoTargets(
    assets,
    actualStocksPct,
    actualBondsPct,
  );

  if (trulyNewAssets.length > 0) {
    newAssetsWarningMd =
      '\n⚠️ ВНИМАНИЕ: Обнаружены новые активы без указанной цели в Excel:\n' +
      trulyNewAssets
        .map((item) => '* ' + item.name + ' (Укажите целевой % в столбце S)')
        .join('\n') +
      '\n';

    newAssetsWarningHtml =
      '<div class="warning-box" style="padding: 15px; background: rgba(163, 113, 247, 0.1); border: 1px solid #a371f7; border-radius: 6px; margin-bottom: 15px;">' +
      '⚠️ Внимание: В вашем портфеле обнаружены новые инструменты без установленной целевой доли: ' +
      trulyNewAssets.map((item) => item.name).join(', ') +
      '. Пожалуйста, пропишите желаемый процент в столбце S вашей Excel-таблицы.</div>';

    // Формируем рекомендации по автопредложению
    if (autoTargets.length > 0) {
      autoTargetsMd =
        '\n💡 **АВТОМАТИЧЕСКИЕ РЕКОМЕНДАЦИИ ПО ЦЕЛЕВЫМ ДОЛЯМ:**\n' +
        autoTargets
          .map(
            (t) =>
              '* **' +
              t.name +
              '**: рекомендуется ' +
              t.suggestedTargetPercent +
              '% (основано на макро-структуре портфеля)',
          )
          .join('\n') +
        '\n';
    }
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
      autoTargetsMd +
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

  // Формируем список новых активов для ИИ-контекста
  let newAssetsForAi = '';
  if (autoTargets.length > 0) {
    newAssetsForAi =
      '\n=== НОВЫЕ АКТИВЫ (без целевой доли) ===\n' +
      autoTargets
        .map(
          (t) =>
            '- ' +
            t.ticker +
            ' (' +
            t.name +
            '): текущая доля 0%, рекомендуется ' +
            t.suggestedTargetPercent +
            '% (' +
            t.reason +
            ')',
        )
        .join('\n') +
      '\n';
  }

  const reportPathHtml = path.join(process.cwd(), 'report.html');

  // Запускаем AI-запрос в фоне (не блокирует открытие отчёта)
  void (async () => {
    const aiClient = new AiClient();
    try {
      const aiResult = await aiClient.generateDynamicReport(
        analysisResult,
        inc,
        validation,
        ordersData,
        cbrRate.rate,
        newAssetsForAi,
        combinedContext,
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

      let autoTargetsHtml = '';
      if (autoTargets.length > 0) {
        autoTargetsHtml =
          '<div style="background: rgba(56, 139, 255, 0.08); border: 1px solid #388bfd; padding: 15px; border-radius: 8px; margin-bottom: 15px; color: #e6edf2;">' +
          '<h4 style="margin-top: 0; color: #58a6ff; margin-bottom: 10px;">💡 Автоматические рекомендации по целевым долям</h4>' +
          '<ul style="margin: 0; padding-left: 20px; line-height: 1.6;">' +
          autoTargets
            .map(
              (t) =>
                '<li><strong>' +
                t.name +
                '</strong>: рекомендуется <strong style="color: #56d364;">' +
                t.suggestedTargetPercent +
                '%</strong> — ' +
                t.reason +
                '</li>',
            )
            .join('') +
          '</ul>' +
          '<p style="margin-top: 10px; margin-bottom: 0; color: #8b949e; font-size: 12px;">Для применения рекомендаций укажите целевой процент в столбце S Excel-таблицы.</p></div>';
      }

      const priceAlertsHtml = priceAlertsModule.formatAlertsHtml(priceAlerts);

      let validationAlertsHtml = '';
      if (!validation.isValid) {
        validationAlertsHtml =
          '<div class="warning-box" style="padding: 15px; background: rgba(242, 81, 87, 0.1); border: 1px solid #f25157; border-radius: 6px; margin-bottom: 15px;">' +
          "⚠️ Превышение лимитов с листа 'Цели':<br>" +
          validation.errors.map((err) => '• ' + err).join('<br>') +
          '</div>';
      }

      const aiBoxHtml =
        '📋 Экспертное заключение ИИ-советника (' +
        currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1) +
        ')\n' +
        '🤖 Использована модель: ' + aiResult.modelUsed + '\n\n' +
        priceAlertsHtml +
        newAssetsWarningHtml +
        autoTargetsHtml +
        validationAlertsHtml +
        incomeHtmlWidget +
        '\n' +
        aiResult.text;

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
      reportBuilder.data.cbrRate = cbrRate.rate;
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
      fs.writeFileSync(reportPathHtml, htmlData, 'utf-8');
      console.log('[AI] ✅ Отчёт обновлён с AI-анализом');
    } catch (error) {
      console.error('[AI] ❌ Ошибка фоновой генерации:', error);
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
  reportBuilder.data.cbrRate = cbrRate.rate;
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
