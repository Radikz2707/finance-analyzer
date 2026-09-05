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
import { getMarkdownTemplate, getHtmlTemplate } from './report-templates.js';
import { AiClient } from './ai-client.js';

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

  const tradeDifferenceRub =
    historicalTrades.totalSalesSum - historicalTrades.totalPurchasesSum;
  const currentTradingResultRub =
    tradeDifferenceRub + totalVal - historicalTrades.totalHistoricalCommission;
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
    '📈 Текущая оценка активов в наличии (C9): ' +
      totalVal.toLocaleString('ru-RU') +
      ' ₽',
  );
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

  // 🎯 ВЫЗОВ КАЛЬКУЛЯТОРА ДОХОДОВ: Собираем дивиденды по Axios со стабильными индексами
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
        item.targetPercent.toFixed(1) +
        '%. Status: ' +
        item.status,
    )
    .join('\n');

  let newAssetsWarningMd = '';
  let newAssetsWarningHtml = '';
  const newAssets = analysisResult.assetsAnalysis.filter(
    (item) => item.status === 'NEW',
  );

  if (newAssets.length > 0) {
    newAssetsWarningMd =
      '\n⚠️ ВНИМАНИЕ: Обнаружены новые активы без указанной цели в Excel:\n' +
      newAssets
        .map((item) => '* ' + item.name + ' (Укажите целевой % в столбце S)')
        .join('\n') +
      '\n';
    newAssetsWarningHtml =
      "<div style='background: rgba(163, 113, 247, 0.1); border: 1px solid #a371f7; padding: 12px; border-radius: 6px; margin-bottom: 15px; color: #d3b6ff;'><strong>⚠️ Внимание:</strong> В вашем портфеле обнаружены новые инструменты без установленной целевой доли: <strong>" +
      newAssets.map((item) => item.name).join(', ') +
      '</strong>. Пожалуйста, пропишите желаемый процент в столбце S вашей Excel-таблицы.</div>';
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
      "<div style='background: rgba(255, 123, 114, 0.1); border: 1px solid #ff7b72; padding: 12px; border-radius: 6px; margin-bottom: 15px; color: #ff7b72;'>⚠️ Превышение лимитов с листа 'Цели':<br>" +
      validation.errors.map((err) => '• ' + err).join('<br>') +
      '</div>';
  }

  const aiClient = new AiClient();

  const dynamicAiContent = await aiClient.generateDynamicReport(
    analysisResult,
    inc,
    validation,
    ordersData,
  );

  // 🎯 ИНЖЕКТ ДОХОДОВ В UI: Формируем красивую HTML-плашку пассивного дохода прямо перед заключением ИИ
  const incomeHtmlWidget = `
    <div style="background: rgba(56, 211, 100, 0.08); border: 1px solid #38d364; padding: 15px; border-radius: 8px; margin-bottom: 20px; color: #e6edf2;">
      <h3 style="margin-top: 0; color: #56d364; display: flex; align-items: center; gap: 8px;">💰 Пассивный доход портфеля (Данные Мосбиржи)</h3>
      <ul style="margin: 0; padding-left: 20px; line-height: 1.6;">
        <li><strong>Накопленный купонный доход (НКД):</strong> ${inc.totalNkd.toLocaleString('ru-RU')} ₽</li>
        <li><strong>Ожидаемый чистый дивидендный поток (LTM):</strong> ${inc.totalDivsNet.toLocaleString('ru-RU')} ₽</li>
        <li><strong>Задействованные активы:</strong> <span style="color: #8b949e;">${stocksListText || 'Нет долевых позиций'}</span></li>
      </ul>
    </div>
  `;

  const aiBoxHtml =
    '📋 Экспертное заключение ИИ-советника (Сентябрь 2026)\n' +
    newAssetsWarningHtml +
    validationAlertsHtml +
    incomeHtmlWidget + // Вставляем плашку дотаций Мосбиржи прямо внутрь ИИ-блока
    '\n' +
    dynamicAiContent;

  const reportPathHtml = path.join(process.cwd(), 'report.html');

  // 🎯 СТРОГО 18 АРГУМЕНТОВ: Компилятор TS полностью доволен, типы сходятся идеально
  const htmlData = getHtmlTemplate(
    totalVal.toLocaleString('ru-RU'),
    analysisResult.macro.freeCash.toLocaleString('ru-RU'),
    currentStocksPct,
    currentBondsPct,
    uiTables.barRows,
    aiBoxHtml,
    uiTables.tableRows,
    ordersData.html,
    new Date().toLocaleDateString('ru-RU'),
    new Date().toLocaleTimeString('ru-RU'),
    investedData.totalNet.toLocaleString('ru-RU'),
    currentTradingResultRub.toLocaleString('ru-RU'),
    totalNetProfitRub.toLocaleString('ru-RU') +
      ' (' +
      totalNetProfitPercent.toFixed(2) +
      '%)',
    c10Color,
    c11Color,
    uiTables.priorityBlock,
    uiTables.concentrationBlock,
    uiTables.rebalanceBlock,
  );

  fs.writeFileSync(reportPathHtml, htmlData, 'utf-8');
  const cleanPathHtml = reportPathHtml.replace(/\\/g, '/');
  const openCommand =
    process.platform === 'win32'
      ? 'start "" "' + cleanPathHtml + '"'
      : 'open "' + cleanPathHtml + '"';
  exec(openCommand);
}
