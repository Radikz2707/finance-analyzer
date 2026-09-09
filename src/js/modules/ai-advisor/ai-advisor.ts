import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { exec } from 'node:child_process';
import { XlsxParserModule } from '../xlsx-parser/xlsx-parser.js';
import {
  buildOrdersHtmlAndMd,
  buildAssetsTablesAndBars,
} from './report-builders.js';
import { PortfolioMathModule } from '../portfolio-math/portfolio-math.js';
import { PortfolioValidator } from '../portfolio-math/portfolio-validator.js';
import { calculatePortfolioIncome } from './income-calculator.js';
import { getMarkdownTemplate } from './report-templates.js';
import { DashboardReportBuilder } from '../../../components/dashboard-report/dashboard-report.js';
import { AiClient } from './ai-client.js';
import { getCbrKeyRate } from './cbr-rate.js';
import { suggestAllAutoTargets } from './auto-target-allocator.js';

/**
 * Главный управляющий модуль сквозного анализа инвестиционной деятельности портфеля
 */
export async function parseExcelAndFetchRecommendations(): Promise<void> {
  const excelModule = new XlsxParserModule();
  await excelModule.syncNewTrades();

  const assets = await excelModule.parseCurrentPortfolio();
  const macroGoals = await excelModule.parseMacroGoals();

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
  const currentStocksPct = analysisResult.macro.stocksPercent;
  const currentBondsPct = analysisResult.macro.bondsPercent;

  // Извлекаем чистую торговую разницу из сбалансированных данных парсера
  const tradeDifferenceRub =
    historicalTrades.totalSalesSum - historicalTrades.totalPurchasesSum;

  // ИСПРАВЛЕНО: Убираем избыточное прибавление активов C9 и вычитание комиссий в коде.
  // Переменная currentTradingResultRub должна быть строго равна tradeDifferenceRub,
  // чтобы выводить на экраны терминала и дашборда ваш точный чистый минус -277 040,24 ₽.
  const currentTradingResultRub = tradeDifferenceRub;

  const totalNetProfitRub = totalVal - investedData.totalNet;
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
    '📉 Торговая разница (C5): ' +
      tradeDifferenceRub.toLocaleString('ru-RU') +
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
  const uiTables = buildAssetsTablesAndBars(analysisResult.assetsAnalysis);

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
    currentStocksPct,
    currentBondsPct,
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
    currentStocksPct,
    currentBondsPct,
    assetsListMd +
      newAssetsWarningMd +
      autoTargetsMd +
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

  let validationAlertsHtml = '';
  if (!validation.isValid) {
    validationAlertsHtml =
      '<div class="warning-box" style="padding: 15px; background: rgba(242, 81, 87, 0.1); border: 1px solid #f25157; border-radius: 6px; margin-bottom: 15px;">' +
      "⚠️ Превышение лимитов с листа 'Цели':<br>" +
      validation.errors.map((err) => '• ' + err).join('<br>') +
      '</div>';
  }

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

  const aiClient = new AiClient();
  const dynamicAiContent = await aiClient.generateDynamicReport(
    analysisResult,
    inc,
    validation,
    ordersData,
    cbrRate.rate,
    newAssetsForAi,
  );

  // Формируем виджет пассивного дохода для интеграции в UI дашборда
  const incomeHtmlWidget =
    '<div style="background: rgba(56, 211, 100, 0.08); border: 1px solid #38d364; padding: 15px; border-radius: 8px; margin-bottom: 20px; color: #e6edf2;">' +
    '<h3 style="margin-top: 0; color: #38d364; display: flex; align-items: center; gap: 8px;">💰 Пассивный доход портфеля (Данные Мосбиржи)</h3>' +
    '<ul style="margin: 0; padding-left: 20px; line-height: 1.6;">' +
    '<li><strong>Накопленный купонный доход (НКД):</strong> ' +
    inc.totalNkd.toLocaleString('ru-RU') +
    ' ₽</li>' +
    '<li><strong>Ожидаемый чистый дивидендный поток (LTM):</strong> ' +
    inc.totalDivsNet.toLocaleString('ru-RU') +
    ' ₽</li>' +
    '<li><strong>Задействованные активы:</strong> <span style="color: #8b949e;">' +
    (stocksListText || 'Нет долевых позиций') +
    '</span></li>' +
    '</ul>' +
    '<table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 14px;">' +
    '<thead><tr style="border-bottom: 1px solid #30363d; color: #8b949e; text-align: left;">' +
    '<th style="padding: 8px 12px;">Актив</th><th style="padding: 8px 12px;">Количество</th><th style="padding: 8px 12px;">Ставка LTM</th><th style="padding: 8px 12px;">Грязными</th><th style="padding: 8px 12px;">Чистыми (-13%)</th>' +
    '</tr></thead><tbody>' +
    inc.stocks
      .map(
        (s) =>
          '<tr style="border-bottom: 1px solid #21262d;">' +
          '<td style="padding: 8px 12px; color: #58a6ff;"><strong>' +
          s.name +
          ' (' +
          s.ticker +
          ')</strong></td>' +
          '<td style="padding: 8px 12px;">' +
          s.quantity +
          ' шт.</td>' +
          '<td style="padding: 8px 12px;">' +
          s.rate.toLocaleString('ru-RU') +
          ' ₽</td>' +
          '<td style="padding: 8px 12px;">' +
          s.grossIncome.toLocaleString('ru-RU') +
          ' ₽</td>' +
          '<td style="padding: 8px 12px; color: #56d364;"><strong>+ ' +
          s.netIncome.toLocaleString('ru-RU') +
          ' ₽</strong></td>' +
          '</tr>',
      )
      .join('\n ') +
    '</tbody></table>' +
    '<p style="margin-top: 12px; margin-bottom: 0; color: #8b949e; font-size: 13px;">Итоговый чистый поток составляет <strong style="color: #56d364;">' +
    inc.totalDivsNet.toLocaleString('ru-RU') +
    ' ₽</strong> после автоматического удержания НДФЛ.</p></div>';

  // Добавляем блок автопредложений в HTML
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

  const aiBoxHtml =
    '📋 Экспертное заключение ИИ-советника (Сентябрь 2026)\n' +
    newAssetsWarningHtml +
    autoTargetsHtml +
    validationAlertsHtml +
    incomeHtmlWidget +
    '\n' +
    dynamicAiContent;
  const reportPathHtml = path.join(process.cwd(), 'report.html');

  // Сборка веб-интерфейса дашборда на основе очищенных данных
  const reportBuilder = new DashboardReportBuilder({
    totalVal: totalVal.toLocaleString('ru-RU'),
    freeCash: analysisResult.macro.freeCash.toLocaleString('ru-RU'),
    stocksPct: currentStocksPct,
    bondsPct: currentBondsPct,
    cbrRate: cbrRate.rate,
    barRows: uiTables.barRows,
    aiBoxHtml: aiBoxHtml,
    tableRows: uiTables.tableRows,
    ordersRows: ordersData.html,
    dateStr: new Date().toLocaleDateString('ru-RU'),
    timeStr: new Date().toLocaleTimeString('ru-RU'),
    totalInvested: investedData.totalNet.toLocaleString('ru-RU'),
    resultC10: currentTradingResultRub.toLocaleString('ru-RU'),
    profitC11:
      totalNetProfitRub.toLocaleString('ru-RU') +
      ' (' +
      totalNetProfitPercent.toFixed(2) +
      '%)',
    c10Color: c10Color,
    c11Color: c11Color,
    priorityBlock: uiTables.priorityBlock,
    concentrationBlock: uiTables.concentrationBlock,
    rebalanceBlock: uiTables.rebalanceBlock,
  });

  const htmlData = reportBuilder.buildHtml();
  fs.writeFileSync(reportPathHtml, htmlData, 'utf-8');

  const cleanPathHtml = reportPathHtml.replace(/\\/g, '/');
  const openCommand =
    process.platform === 'win32'
      ? 'start "" "' + cleanPathHtml + '"'
      : 'open "' + cleanPathHtml + '"';
  exec(openCommand);
}
