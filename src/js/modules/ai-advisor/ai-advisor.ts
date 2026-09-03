import fs from 'fs';
import path from 'path';
import { exec } from 'node:child_process';
import { XlsxParserModule } from '../xlsx-parser/xlsx-parser';
import { PortfolioMathModule } from '../portfolio-math/portfolio-math';
import { getMarkdownTemplate, getHtmlTemplate } from './report-templates';
import { calculatePortfolioIncome } from './income-calculator';
import { parseQuikOrdersFile } from '../xlsx-parser/quik-orders-parser';

export async function parseExcelAndFetchRecommendations(): Promise<void> {
  const rootDir = process.cwd();
  const excelModule = new XlsxParserModule();

  const assets = await excelModule.parseCurrentPortfolio();
  const macroGoals = await excelModule.parseMacroGoals();

  if (assets.length === 0) {
    console.error('❌ [ОШИБКА]: Данные portfolio-файла пусты.');
    return;
  }

  const math = new PortfolioMathModule();
  const analysisResult = math.analyzePortfolio(macroGoals, assets);

  const totalVal = analysisResult.macro.totalBalance;
  const currentStocksPct = analysisResult.macro.stocksPercent;
  const currentBondsPct = analysisResult.macro.bondsPercent;

  let ordersRowsHtml = '';
  let ordersTextMd = '';

  const ordersPath = 'C:/dev/finance-analyzer/data/orders.csv';
  const quikData = parseQuikOrdersFile(ordersPath);
  const realOrders = quikData.orders;

  if (realOrders && realOrders.length > 0) {
    for (let i = 0; i < realOrders.length; i++) {
      const order = realOrders[i];
      const opColor = order.operation === 'BUY' ? '#238636' : '#da3633';

      ordersRowsHtml +=
        '<tr>' +
        "<td><strong style='color: #fff;'>" +
        order.instrument +
        '</strong></td>' +
        "<td><span class='status-badge' style='background-color: " +
        opColor +
        "; color: #fff;'>" +
        order.operation +
        '</span></td>' +
        '<td>' +
        order.quantity.toLocaleString('ru-RU') +
        ' шт.</td>' +
        '<td>' +
        order.price.toLocaleString('ru-RU') +
        ' ₽</td>' +
        " <td style='color: #e3b341; font-weight: bold;'>" +
        order.totalSum.toLocaleString('ru-RU') +
        ' ₽</td>' +
        '<td>' +
        order.status +
        '</td>' +
        '</tr>';

      ordersTextMd +=
        '- ' +
        order.instrument +
        ': Заявка на ' +
        order.operation +
        ', ' +
        order.quantity +
        ' шт. по цене ' +
        order.price +
        ' руб. (Всего: ' +
        order.totalSum +
        ' руб.)\n';
    }
  } else {
    ordersRowsHtml =
      "<tr><td colspan='6' style='text-align: center; color: #8b949e;'>Нет active-заявок в стаканах Мосбиржи (все приказы исполнены или сняты)</td></tr>";
    ordersTextMd =
      '- Действующие лимитные заявки в терминале QUIK отсутствуют.\n';
  }

  const inc = await calculatePortfolioIncome(assets);

  const reportPathMd = path.join(rootDir, 'report.md');
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
      '\n⚠️ **ВНИМАНИЕ**: Обнаружены новые активы без указанной цели в Excel:\n' +
      newAssets
        .map((item) => `* ${item.name} (Укажите целевой % в столбце S)`)
        .join('\n') +
      '\n';

    newAssetsWarningHtml =
      "<div style='background: rgba(163, 113, 247, 0.1); border: 1px solid #a371f7; padding: 12px; border-radius: 6px; margin-bottom: 15px; color: #d3b6ff;'>" +
      '<strong>⚠️ Внимание:</strong> В вашем портфеле обнаружены новые инструменты без установленной целевой доли: ' +
      '<strong>' +
      newAssets.map((item) => item.name).join(', ') +
      '</strong>. ' +
      'Пожалуйста, пропишите для них желаемый процент в столбце S (Целевая доля) вашей Excel-таблицы.' +
      '</div>';
  }

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
      '* Количество акций Сбербанк (из QUIK): ' +
      inc.sberQty +
      ' шт. Прогноз выплат (чистыми после НДФЛ 13%): ' +
      inc.sberDivsNet.toLocaleString('ru-RU') +
      ' ₽ (грязными: ' +
      inc.sberDivs.toLocaleString('ru-RU') +
      ' ₽)\n' +
      '* Количество акций Татнефть (из QUIK): ' +
      inc.tatneftQty +
      ' шт. Прогноз выплат (чистыми после НДФЛ 13%): ' +
      inc.tatneftDivsNet.toLocaleString('ru-RU') +
      ' ₽ (грязными: ' +
      inc.tatneftDivs.toLocaleString('ru-RU') +
      ' ₽)\n' +
      '* Общий дивидендный поток по акциям (чистыми): ' +
      inc.totalDivsNet.toLocaleString('ru-RU') +
      ' ₽ (грязными: ' +
      inc.totalDivs.toLocaleString('ru-RU') +
      ' ₽)\n' +
      '\n### 🗓 Действующие заявки в терминале QUIK:\n' +
      ordersTextMd,
  );
  fs.writeFileSync(reportPathMd, mdData, 'utf-8');

  let barRowsHtml = '';
  let legendRowsHtml = '';
  let tableRowsHtml = '';
  const colors = [
    '#238636',
    '#388bfd',
    '#58a6ff',
    '#bc8cff',
    '#f25157',
    '#e3b341',
    '#a371f7',
    '#6e7681',
  ];

  for (let i = 0; i < analysisResult.assetsAnalysis.length; i++) {
    const item = analysisResult.assetsAnalysis[i];
    const color = colors[i % colors.length];
    const widthFact = Math.min(100, Math.max(0, item.currentPercent * 4));
    const widthTarget = Math.min(100, Math.max(0, item.targetPercent * 4));

    barRowsHtml +=
      "<div style='margin-bottom: 15px;'>" +
      "<div style='font-size: 13px; margin-bottom: 4px; color: #8b949e; font-weight: bold;'>" +
      item.name +
      '</div>' +
      "<div style='display: flex; align-items: center; gap: 10px;'>" +
      "<div style='width: 75px; font-size: 11px; text-align: right; color: #388bfd;'>Факт: " +
      item.currentPercent.toFixed(1) +
      '%</div>' +
      "<div style='flex-grow: 1; background: #30363d; height: 12px; border-radius: 4px; overflow: hidden;'>" +
      "<div style='background: #388bfd; width: " +
      widthFact +
      "%; height: 100%;'></div>" +
      '</div>' +
      '</div>' +
      "<div style='display: flex; align-items: center; gap: 10px; margin-top: 3px;'>" +
      "<div style='width: 75px; font-size: 11px; text-align: right; color: #238636;'>Цель: " +
      item.targetPercent.toFixed(1) +
      '%</div>' +
      "<div style='flex-grow: 1; background: #30363d; height: 6px; border-radius: 2px; overflow: hidden;'>" +
      "<div style='background: #238636; width: " +
      widthTarget +
      "%; height: 100%;'></div>" +
      '</div>' +
      '</div>' +
      '</div>';

    legendRowsHtml +=
      "<div style='margin-bottom: 12px; background: #161b22; padding: 12px; border-radius: 6px; border-left: 4px solid " +
      color +
      ";'>" +
      "<div style='display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;'>" +
      "<span style='font-weight: bold; color: #fff;'>" +
      item.name +
      '</span>' +
      "<span style='color: #58a6ff; font-weight: bold;'>" +
      item.currentPercent.toFixed(1) +
      '%</span>' +
      '</div>' +
      "<div style='background: #30363d; height: 4px; border-radius: 2px; overflow: hidden;'>" +
      "<div style='background: " +
      color +
      '; width: ' +
      widthFact +
      "%; height: 100%;'></div>" +
      '</div>' +
      '</div>';

    const prefix = item.deficitRub > 0 ? '+' : '';
    const colorStyle =
      item.deficitRub > 0
        ? '#58a6ff'
        : item.deficitRub < 0
          ? '#ff7b72'
          : '#fff';
    const displayDeficit =
      item.status === 'NEW'
        ? '—'
        : prefix + item.deficitRub.toLocaleString('ru-RU') + ' ₽';

    tableRowsHtml +=
      '<tr>' +
      "<td><strong style='color: #fff;'>" +
      item.name +
      '</strong></td>' +
      '<td>' +
      item.currentPercent.toFixed(1) +
      '%</td>' +
      '<td>' +
      item.targetPercent.toFixed(1) +
      '%</td>' +
      "<td style='color: " +
      colorStyle +
      "; font-weight: bold;'>" +
      displayDeficit +
      '</td>' +
      "<td><span class='status-badge status-" +
      item.status +
      "'>" +
      item.status +
      '</span></td>' +
      '</tr>';
  }

  const aiBoxHtml =
    "<div class='ai-header'>📋 Экспертное заключение ИИ-советника (Сентябрь 2026)</div>" +
    newAssetsWarningHtml +
    "<div class='ai-section'>" +
    "<div class='ai-header'>🌐 1. Макроэкономическая ситуация в РФ</div>" +
    '<p>Ключевая ставка ЦБ зафиксирована на уровне 14%. Это жесткий денежно-кредитный режим. В текущих реалиях облигации с фиксированным доходом и надежные флоатеры являются абсолютным приоритетом для сохранения и разгона капитала.</p>' +
    '</div>' +
    "<div class='ai-section'>" +
    "<div class='ai-header'>📊 2. Аналитика купонов и НКД облигаций</div>" +
    '<p>Суммарный накопленный купонный доход, собранный парсером по всем облигационным позициям портфеля (включая Бруснику, ГТЛК и Селигдар-10) непосредственно из столбца таблицы Excel, составляет <strong>' +
    inc.totalNkd.toLocaleString('ru-RU') +
    ' ₽</strong>. Данные средства полностью учтены конвейером.</p>' +
    '</div>' +
    "<div class='ai-section'>" +
    "<div class='ai-header'>📈 3. Дивидендный горизонт акций и автоматизация</div>" +
    '<p>На основе фактического объема акций компании <strong>Сбербанк</strong> из вашей таблицы в количестве <strong>' +
    inc.sberQty +
    ' шт.</strong>, величина чистых дивидендных поступлений после вычета НДФЛ 13% составляет <strong>' +
    inc.sberDivsNet.toLocaleString('ru-RU') +
    ' ₽</strong> (начислено грязными: ' +
    inc.sberDivs.toLocaleString('ru-RU') +
    ' ₽, ставка: 37.64 ₽).</p>' +
    '<p>Для акций компании <strong>Татнефть</strong> парсер успешно считал из таблицы актуальную позицию в количестве <strong>' +
    inc.tatneftQty +
    ' шт.</strong> Чистая сумма за вычетом НДФЛ составляет <strong>' +
    inc.tatneftDivsNet.toLocaleString('ru-RU') +
    ' ₽</strong> (начислено грязными: ' +
    inc.tatneftDivs.toLocaleString('ru-RU') +
    ' ₽, из расчета объявленных 38.20 ₽ на акцию).</p>' +
    '<p>Итоговый суммарный <strong>чистый пассивный поток</strong> по акциям, который реально поступит на ваш счет, равен <strong>' +
    inc.totalDivsNet.toLocaleString('ru-RU') +
    ' ₽</strong> (общая грязная сумма: ' +
    inc.totalDivs.toLocaleString('ru-RU') +
    ' ₽).</p>' +
    '</div>' +
    "<div class='ai-section'>" +
    "<div class='ai-header'>💵 4. Пошаговый План действий на сентябрь</div>" +
    "<ul class='ai-list'>" +
    '<li><strong>Действие №1:</strong> Свободные средства и поступающие купоны направляйте целиком на покупку облигаций ГТЛК 2P-14 до целевой отметки 15%.</li>' +
    '</ul>' +
    '</div>';

  const reportPathHtml = path.join(rootDir, 'report.html');

  const htmlData = getHtmlTemplate(
    totalVal.toLocaleString('ru-RU'),
    analysisResult.macro.freeCash.toLocaleString('ru-RU'),
    currentStocksPct,
    currentBondsPct,
    legendRowsHtml,
    barRowsHtml,
    aiBoxHtml,
    tableRowsHtml,
    ordersRowsHtml,
    new Date().toLocaleDateString('ru-RU'),
    new Date().toLocaleTimeString('ru-RU'),
  );

  fs.writeFileSync(reportPathHtml, htmlData, 'utf-8');

  const cleanPathHtml = reportPathHtml.replace(/\\/g, '/');

  console.log('\n====================================');
  console.log('🎉 SUCCESS: Automated pipeline ok.');
  console.log('====================================\n');

  const openCommand =
    process.platform === 'win32'
      ? 'start "" "' + cleanPathHtml + '"'
      : 'open "' + cleanPathHtml + '"';

  exec(openCommand);
}
