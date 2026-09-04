import { QuikOrder } from '../xlsx-parser/quik-orders-parser';

export interface HTMLOrdersResult {
  html: string;
  md: string;
}

export interface HTMLTablesResult {
  barRows: string;
  legendRows: string;
  tableRows: string;
}

// 🎯 Модуль сборки таблиц действующих лимитных заявок
export function buildOrdersHtmlAndMd(
  realOrders: QuikOrder[],
): HTMLOrdersResult {
  let html = '';
  let md = '';

  if (realOrders && realOrders.length > 0) {
    for (let i = 0; i < realOrders.length; i++) {
      const order = realOrders[i];
      const opColor = order.operation === 'BUY' ? '#238636' : '#da3633';

      html +=
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

      md +=
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
    html =
      "<tr><td colspan='6' style='color: #8b949e; text-align: center;'>Нет active-заявок в стаканах Мосбиржи</td></tr>";
    md = '- Действующие лимитные заявки в терминале QUIK отсутствуют.\n';
  }

  return { html, md };
}

// 🎯 Модуль сборки аналитических таблиц активов и прогресс-баров долей
export function buildAssetsTablesAndBars(
  assetsAnalysis: Array<{
    name: string;
    currentPercent: number;
    targetPercent: number;
    deficitRub: number;
    status: string;
  }>,
): HTMLTablesResult {
  let barRows = '';
  let legendRows = '';
  let tableRows = '';

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

  for (let i = 0; i < assetsAnalysis.length; i++) {
    const item = assetsAnalysis[i];
    const color = colors[i % colors.length];
    const widthFact = Math.min(100, Math.max(0, item.currentPercent * 4));
    const widthTarget = Math.min(100, Math.max(0, item.targetPercent * 4));

    barRows +=
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

    legendRows +=
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

    tableRows +=
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
      "'>>" +
      item.status +
      '</span></td>' +
      '</tr>';
  }

  return { barRows, legendRows, tableRows };
}
