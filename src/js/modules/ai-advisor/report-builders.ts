import { QuikOrder } from '../xlsx-parser/quik-orders-parser.js';
import { AssetAnalysis } from '../portfolio-math/portfolio-math.js';

/**
 * Форматирование цены: показывает копейки только если они есть
 * 99.25 → "99,25 ₽"
 * 99.00 → "99 ₽"
 */
function formatPrice(value: number): string {
  const formatted = value.toFixed(2);
  const parts = formatted.split('.');
  const whole = parseInt(parts[0], 10);
  const kopecks = parseInt(parts[1], 10);
  if (kopecks === 0) {
    return whole.toLocaleString('ru-RU');
  }
  const kopecksStr = kopecks.toString().padStart(2, '0');
  return whole.toLocaleString('ru-RU') + ',' + kopecksStr;
}

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

/**
 * Модуль сборки действующих и завершенных лимитных заявок из QUIK с поддержкой ночных GTC-переносов
 */
export function buildOrdersHtmlAndMd(
  realOrders: QuikOrder[],
): HTMLOrdersResult {
  let html = '';
  let md = '';

  if (realOrders && realOrders.length > 0) {
    for (let i = 0; i < realOrders.length; i++) {
      const order = realOrders[i];

      // Вычисляем базовый цвет операции (Покупка - зеленый, Продажа - красный, Перенос - приглушенный фиолетовый)
      let opColor = order.operation === 'BUY' ? '#238636' : '#da3633';

      let badgeStatusClass = 'status-' + order.operation;
      if (order.status === 'ИСПОЛНЕНА') {
        badgeStatusClass = 'status-FILLED';
        opColor = '#21262d'; // Серый цвет для исполненных заявок
      } else if (order.status === 'GTC (ПЕРЕНОС)') {
        badgeStatusClass = 'status-NEW'; // Использует уже имеющийся фиолетовый класс из scss
        opColor = '#8a2be2';
      }

      html +=
        '<tr class="order-row-' + badgeStatusClass + '">' +
        "<td class='instrument-name'><strong>" +
        order.ticker +
        '</strong></td>' +
        '<td>' +
        "<span class='status-badge " +
        badgeStatusClass +
        "' style='background-color: " +
        opColor +
        "; color: #fff;'>" +
        (order.status === 'GTC (ПЕРЕНОС)' ? 'GTC' : order.operation) +
        '</span>' +
        '</td>' +
        '<td>' +
        order.qty.toLocaleString('ru-RU') +
        ' шт.</td>' +
        '<td>' +
        formatPrice(order.price) +
        ' ₽</td>' +
        "<td class='sum-cell'>" +
        formatPrice(order.sum) +
        ' ₽</td>' +
        '<td>' +
        order.status +
        '</td>' +
        '</tr>';

      md +=
        '- ' +
        order.ticker +
        ': Заявка на ' +
        order.operation +
        ' (' +
        order.status +
        '), ' +
        order.qty +
        ' шт. по цене ' +
        (order.isBond
          ? formatPrice(order.pricePercent) + '% от номинала'
          : formatPrice(order.price) + ' руб.') +
        ' (Всего: ' +
        formatPrice(order.sum) +
        ' руб.)\n';
    }
  } else {
    html =
      "<tr><td colspan='6'>Нет активных или завершенных заявок в стаканах Мосбиржи</td></tr>";
    md =
      '- Действующие или завершенные лимитные заявки в терминале QUIK отсутствуют.\n';
  }

  return { html, md };
}

/**
 * Модуль сборки единого макро-блока распределения активов портфеля
 */
export function buildAssetsTablesAndBars(
  assetsAnalysis: AssetAnalysis[],
): HTMLTablesResult {
  let barRows = '';
  let legendRows = '';
  let tableRows = '';
  let priorityBlock = '';
  let concentrationBlock = '';
  let rebalanceBlock = '';

  // Сортировка по динамике цены (убывание) — лучшие инструменты сверху
  const sortedAssets = [...assetsAnalysis].sort(
    (a, b) => b.dynamicsPercent - a.dynamicsPercent,
  );

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

  for (let i = 0; i < sortedAssets.length; i++) {
    const item = sortedAssets[i];
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

    // Если целевая доля равна 0 (актив полностью продается, как STME ETF), выводим аккуратный прочерк
    const displayDeficit =
      item.targetPercent === 0
        ? '—'
        : prefix + item.deficitRub.toLocaleString('ru-RU') + ' ₽';

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
          : '#e3b341';

    // Определяем направление цены для цветовой индикации
    const priceDirection =
      item.currentPrice > item.balancePrice
        ? 'up'
        : item.currentPrice < item.balancePrice
          ? 'down'
          : 'same';

    const arrowSymbol =
      priceDirection === 'up' ? '↑' : priceDirection === 'down' ? '↓' : '↔';

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
      '<td class="deficit-cell" style="color: ' +
      colorStyle +
      ';">' +
      displayDeficit +
      '</td>' +
      "<td><span class='status-badge status-" +
      (item.targetPercent === 0 ? 'SELL' : item.status) +
      "'>" +
      (item.targetPercent === 0 ? 'ВЫХОД' : item.status) +
      '</span></td>' +
      "<td class='price-info price-direction--" + priceDirection + "'>" +
      "<div class='price-pair'>" +
      "<span class='price-entry'>" +
      (item.balancePrice > 0
        ? item.balancePrice.toLocaleString('ru-RU') + ' ₽'
        : '—') +
      '</span>' +
      "<span class='price-current'>" +
      (item.currentPrice > 0
        ? item.currentPrice.toLocaleString('ru-RU') + ' ₽'
        : '—') +
      '</span>' +
      '</div>' +
      "<span class='price-arrow'>" + arrowSymbol + '</span>' +
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

  const buyAssets = assetsAnalysis.filter(
    (a) => a.status === 'BUY' && a.targetPercent > 0,
  );
  if (buyAssets.length > 0) {
    priorityBlock =
      "<div class='priority-section'>" +
      "<h3 class='section-title section-title--blue'>🎯 Приоритет покупок (по дефициту)</h3>" +
      "<div class='priority-list'>";
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

  const concentrated = assetsAnalysis.filter((a) => a.currentPercent > 20); // Задаем лимит концентрации макро-группы
  if (concentrated.length > 0) {
    concentrationBlock =
      "<div class='concentration-section'>" +
      "<h3 class='section-title section-title--red'>⚠️ Концентрация рисков</h3>" +
      "<div class='concentration-list'>";
    concentrated.forEach((item) => {
      concentrationBlock +=
        "<div class='concentration-item'>" +
        "<span class='concentration-name'>" +
        item.name +
        '</span>' +
        "<span class='concentration-value'>" +
        item.currentPercent.toFixed(1) +
        '% портфеля</span>' +
        '</div>';
    });
    concentrationBlock += '</div></div>';
  }

  if (buyAssets.length > 0) {
    const topBuy = buyAssets[0];
    const totalDeficit = buyAssets
      .reduce((sum, a) => sum + a.deficitRub, 0)
      .toLocaleString('ru-RU');
    const totalPositions = buyAssets.length;
    const topName = topBuy.name;
    const topDeficit = topBuy.deficitRub.toLocaleString('ru-RU');
    const topPct = (topBuy.targetPercent - topBuy.currentPercent).toFixed(1);

    rebalanceBlock =
      "<div class='rebalance-section'>" +
      "<h3 class='section-title section-title--green'>💡 Рекомендация по ребалансировке</h3>" +
      "<div class='rebalance-content'>" +
      "<div class='rebalance-main'>" +
      "<span class='rebalance-highlight'>Первостепенная задача:</span> " +
      '<strong>' +
      topName +
      '</strong> — дефицит <strong>' +
      topDeficit +
      ' ₽</strong> (' +
      topPct +
      '% от портфеля)' +
      '</div>' +
      "<div class='rebalance-summary'>" +
      "Всего для приведения портфеля к целям: <strong class='highlight-total'>" +
      totalDeficit +
      ' ₽</strong> на <strong>' +
      totalPositions +
      ' позиций</strong>.' +
      '</div>' +
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
