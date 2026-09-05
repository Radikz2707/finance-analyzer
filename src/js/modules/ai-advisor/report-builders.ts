import { QuikOrder } from '../xlsx-parser/quik-orders-parser';
import { AssetAnalysis } from '../portfolio-math/portfolio-math.js';

export interface HTMLOrdersResult {
  html: string;
  md: string;
}

export interface HTMLTablesResult {
  barRows: string;
  legendRows: string;
  tableRows: string;
  priorityBlock: string;
  concentrationBlock: string;
  rebalanceBlock: string;
}

// 🎯 Модуль сборки действующих лимитных заявок
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
        "<td class='instrument-name'><strong>" +
        order.instrument +
        '</strong></td>' +
        "<td><span class='status-badge status-" +
        order.operation +
        "' style='background-color: " +
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
        " <td class='sum-cell'>" +
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
      "<tr><td colspan='6' class='no-orders'>Нет active-заявок в стаканах Мосбиржи</td></tr>";
    md = '- Действующие лимитные заявки в терминале QUIK отсутствуют.\n';
  }

  return { html, md };
}

// 🎯 Модуль сборки единого блока портфеля с приоритетами и рисками
export function buildAssetsTablesAndBars(
  assetsAnalysis: AssetAnalysis[],
): HTMLTablesResult {
  let barRows = '';
  let legendRows = '';
  let tableRows = '';
  let priorityBlock = '';
  let concentrationBlock = '';
  let rebalanceBlock = '';

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

  // === Блок 1: Компактная таблица портфеля ===
  for (let i = 0; i < assetsAnalysis.length; i++) {
    const item = assetsAnalysis[i];
    const color = colors[i % colors.length];
    const widthFact = Math.min(100, Math.max(0, item.currentPercent * 4));
    const widthTarget = Math.min(100, Math.max(0, item.targetPercent * 4));

    barRows +=
      "<div class='asset-bars'>" +
      "<div class='asset-label'>" +
      item.name +
      '</div>' +
      "<div class='bar-row'>" +
      "<div class='bar-label'>Факт: " +
      item.currentPercent.toFixed(1) +
      '%</div>' +
      "<div class='bar-track'>" +
      "<div class='bar-fill bar-fill--blue' style='width: " +
      widthFact +
      "%; height: 100%;'></div>" +
      '</div>' +
      '</div>' +
      "<div class='bar-row' style='margin-top: 3px;'>" +
      "<div class='bar-label bar-label--target'>Цель: " +
      item.targetPercent.toFixed(1) +
      '%</div>' +
      "<div class='bar-track bar-track--small'>" +
      "<div class='bar-fill bar-fill--green' style='width: " +
      widthTarget +
      "%; height: 100%;'></div>" +
      '</div>' +
      '</div>' +
      '</div>';

    legendRows +=
      "<div class='asset-legend' style='border-left-color: " +
      color +
      ";'>" +
      "<div class='legend-header'>" +
      "<span class='legend-name'>" +
      item.name +
      '</span>' +
      "<span class='legend-percent'>" +
      item.currentPercent.toFixed(1) +
      '%</span>' +
      '</div>' +
      "<div class='legend-bar'>" +
      "<div class='legend-bar-fill' style='background: " +
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

    // Цена входа vs текущая
    const priceDiff =
      item.currentPrice > 0 && item.balancePrice > 0
        ? (
            ((item.currentPrice - item.balancePrice) / item.balancePrice) *
            100
          ).toFixed(1)
        : '—';
    const priceColor =
      item.currentPrice > item.balancePrice
        ? '#56d364'
        : item.currentPrice < item.balancePrice
          ? '#ff7b72'
          : '#fff';

    tableRows +=
      '<tr>' +
      "<td class='asset-name'><strong>" +
      item.name +
      '</strong></td>' +
      '<td>' +
      item.currentPercent.toFixed(1) +
      '%</td>' +
      '<td>' +
      item.targetPercent.toFixed(1) +
      '%</td>' +
      "<td class='deficit-cell' style='color: " +
      colorStyle +
      ";'>" +
      displayDeficit +
      '</td>' +
      "<td><span class='status-badge status-" +
      item.status +
      "'>" +
      item.status +
      '</span></td>' +
      "<td class='price-info'>" +
      (item.balancePrice > 0
        ? item.balancePrice.toLocaleString('ru-RU') + ' ₽'
        : '—') +
      '<br>' +
      (item.currentPrice > 0
        ? item.currentPrice.toLocaleString('ru-RU') + ' ₽'
        : '—') +
      '</td>' +
      "<td class='price-diff' style='color: " +
      priceColor +
      ";'>" +
      (priceDiff !== '—'
        ? (parseFloat(priceDiff) > 0 ? '+' : '') + priceDiff + '%'
        : '—') +
      '</td>' +
      '</tr>';
  }

  // === Блок 2: Приоритет покупок ===
  const buyAssets = assetsAnalysis.filter(a => a.status === 'BUY');
  if (buyAssets.length > 0) {
    priorityBlock =
      '<div class="priority-list">' +
      '<h3>🎯 Приоритет покупок (по дефициту)</h3>' +
      '<div class="priority-items">';
    buyAssets.forEach((item, index) => {
      const rank = index + 1;
      priorityBlock +=
        "<div class='priority-item'>" +
        "<span class='priority-rank'>#" +
        rank +
        '</span>' +
        "<span class='priority-name'>" +
        item.name +
        '</span>' +
        "<span class='priority-deficit'>" +
        item.deficitRub.toLocaleString('ru-RU') +
        ' ₽</span>' +
        '</div>';
    });
    priorityBlock += '</div></div>';
  }

  // === Блок 3: Концентрация рисков ===
  const concentrated = assetsAnalysis.filter(a => a.isConcentrated);
  if (concentrated.length > 0) {
    concentrationBlock =
      '<div class="risk-concentration">' +
      '<h3>⚠️ Концентрация рисков</h3>' +
      '<div class="risk-items">';
    concentrated.forEach(item => {
      concentrationBlock +=
        "<div class='risk-item'>" +
        "<span class='risk-icon'>⚠️</span>" +
        "<span class='risk-name'>" +
        item.name +
        '</span>' +
        "<span class='risk-percent'>" +
        item.currentPercent.toFixed(1) +
        '% портфеля</span>' +
        '</div>';
    });
    concentrationBlock += '</div></div>';
  }

  // === Блок 4: Рекомендация по rebalance ===
  if (buyAssets.length > 0) {
    const topBuy = buyAssets[0];
    rebalanceBlock =
      '<div class="rebalance-advice">' +
      '<h3>💡 Рекомендация</h3>' +
      "<div class='advice-text'>" +
      'Первая очередь: <strong>' +
      topBuy.name +
      '</strong> — дефицит ' +
      topBuy.deficitRub.toLocaleString('ru-RU') +
      ' ₽ (' +
      (topBuy.targetPercent - topBuy.currentPercent).toFixed(1) +
      '% от портфеля)' +
      '<br><br>' +
      'Всего нужно докупить: <strong class="highlight-blue">' +
      buyAssets
        .reduce((sum, a) => sum + a.deficitRub, 0)
        .toLocaleString('ru-RU') +
      ' ₽</strong> на ' +
      buyAssets.length +
      ' позиций.' +
      '</div></div>';
  }

  return {
    barRows,
    legendRows,
    tableRows,
    priorityBlock,
    concentrationBlock,
    rebalanceBlock,
  };
}
