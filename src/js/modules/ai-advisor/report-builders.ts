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
      "<td style='font-size: 11px; color: #8b949e;'>" +
      (item.balancePrice > 0
        ? item.balancePrice.toLocaleString('ru-RU') + ' ₽'
        : '—') +
      '<br>' +
      (item.currentPrice > 0
        ? item.currentPrice.toLocaleString('ru-RU') + ' ₽'
        : '—') +
      '</td>' +
      "<td style='font-size: 11px; color: " +
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
      '<h3 style="margin-top: 0; color: #58a6ff; font-size: 13px; margin-bottom: 10px;">🎯 Приоритет покупок (по дефициту)</h3>' +
      '<div style="display: flex; flex-direction: column; gap: 6px;">';
    buyAssets.forEach((item, index) => {
      const rank = index + 1;
      priorityBlock +=
        "<div style='display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: rgba(56, 139, 255, 0.08); border-radius: 4px;'>" +
        "<span style='font-size: 12px; font-weight: bold; color: #58a6ff; min-width: 20px;'>#" +
        rank +
        '</span>' +
        "<span style='font-size: 12px; color: #fff; flex-grow: 1;'>" +
        item.name +
        '</span>' +
        "<span style='font-size: 12px; color: #58a6ff; font-weight: bold;'>" +
        item.deficitRub.toLocaleString('ru-RU') +
        ' ₽</span>' +
        '</div>';
    });
    priorityBlock += '</div>';
  }

  // === Блок 3: Концентрация рисков ===
  const concentrated = assetsAnalysis.filter(a => a.isConcentrated);
  if (concentrated.length > 0) {
    concentrationBlock =
      '<h3 style="margin-top: 0; color: #f25157; font-size: 13px; margin-bottom: 10px;">⚠️ Концентрация рисков</h3>' +
      '<div style="display: flex; flex-direction: column; gap: 6px;">';
    concentrated.forEach(item => {
      concentrationBlock +=
        "<div style='display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: rgba(242, 81, 87, 0.08); border-radius: 4px;'>" +
        "<span style='font-size: 12px; color: #ff7b72;'>⚠️</span>" +
        "<span style='font-size: 12px; color: #fff; flex-grow: 1;'>" +
        item.name +
        '</span>' +
        "<span style='font-size: 12px; color: #ff7b72; font-weight: bold;'>" +
        item.currentPercent.toFixed(1) +
        '% портфеля</span>' +
        '</div>';
    });
    concentrationBlock += '</div>';
  }

  // === Блок 4: Рекомендация по rebalance ===
  if (buyAssets.length > 0) {
    const topBuy = buyAssets[0];
    rebalanceBlock =
      '<h3 style="margin-top: 0; color: #56d364; font-size: 13px; margin-bottom: 10px;">💡 Рекомендация</h3>' +
      "<div style='font-size: 12px; color: #8b949e; line-height: 1.5;'>" +
      'Первая очередь: <strong style="color: #fff;">' +
      topBuy.name +
      '</strong> — дефицит ' +
      topBuy.deficitRub.toLocaleString('ru-RU') +
      ' ₽ (' +
      (topBuy.targetPercent - topBuy.currentPercent).toFixed(1) +
      '% от портфеля)' +
      '<br><br>' +
      'Всего нужно докупить: <strong style="color: #58a6ff;">' +
      buyAssets
        .reduce((sum, a) => sum + a.deficitRub, 0)
        .toLocaleString('ru-RU') +
      ' ₽</strong> на ' +
      buyAssets.length +
      ' позиций.' +
      '</div>';
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
