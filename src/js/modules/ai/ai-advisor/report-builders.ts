import { QuikOrder } from '../../data/xlsx-parser/quik-orders-parser.js';
import { AssetAnalysis } from '../../portfolio/portfolio-math/portfolio-math.js';
import { PortfolioConfig } from '../../../config/portfolio-config.js';
import { assessDailyMove } from './daily-move.js';

/**
 * Форматирование цены: показывает копейки только если они есть
 * 99.25 → "99,25 ₽"
 * 99.00 → "99 ₽"
 */
function formatPrice(value: number): string {
  const formatted = value.toFixed(2);
  const parts = formatted.split('.');
  const whole = parseInt(parts[0]!, 10);
  const kopecks = parseInt(parts[1] ?? '0', 10);
  if (kopecks === 0) {
    return whole.toLocaleString('ru-RU');
  }
  const kopecksStr = kopecks.toString().padStart(2, '0');
  return whole.toLocaleString('ru-RU') + ',' + kopecksStr;
}

/** Форматирование дневного оборота в рублях */
function formatVolumeRub(volume: number): string {
  if (volume >= 1e9) {
    return (volume / 1e9).toFixed(1) + ' млрд ₽';
  }
  if (volume >= 1e6) {
    return (volume / 1e6).toFixed(1) + ' млн ₽';
  }
  if (volume >= 1e3) {
    return (volume / 1e3).toFixed(1) + ' тыс ₽';
  }
  return volume.toLocaleString('ru-RU') + ' ₽';
}

/**
 * Генерация блока "Анализ ликвидности" для Markdown-отчёта.
 */
export function buildLiquidityBlockMd(
  warnings: string[],
  recommendations: string[],
  highPct: number,
  mediumPct: number,
  lowPct: number,
  criticalPct: number,
  status: string,
): string {
  const statusIcon =
    status === 'HEALTHY' ? '✅' : status === 'WARNING' ? '⚠️' : '🔴';

  let md = '## 📊 Анализ ликвидности портфеля\n\n';
  md += `**Статус:** ${statusIcon} ${status === 'HEALTHY' ? 'Здоровый' : status === 'WARNING' ? 'Внимание' : 'Критический'}\n\n`;
  md += '| Уровень | Доля |\n';
  md += '|---------|------|\n';
  md += `| Высокая (${highPct.toFixed(1)}%) | ✅ |\n`;
  md += `| Средняя (${mediumPct.toFixed(1)}%) | ➖ |\n`;
  md += `| Низкая (${lowPct.toFixed(1)}%) | ⚠️ |\n`;
  md += `| Критическая (${criticalPct.toFixed(1)}%) | 🔴 |\n\n`;

  if (warnings.length > 0) {
    md += '### ⚠️ Предупреждения\n\n';
    for (const w of warnings) {
      md += `- ${w}\n`;
    }
    md += '\n';
  }

  if (recommendations.length > 0) {
    md += '### 💡 Рекомендации\n\n';
    for (const r of recommendations) {
      md += `- ${r}\n`;
    }
    md += '\n';
  }

  return md;
}

/**
 * Генерация блока "Анализ ликвидности" для HTML-дашборда.
 */
export function buildLiquidityBlockHtml(
  warnings: string[],
  recommendations: string[],
  highPct: number,
  mediumPct: number,
  lowPct: number,
  criticalPct: number,
  status: string,
): string {
  const statusColor =
    status === 'HEALTHY'
      ? '#56d364'
      : status === 'WARNING'
        ? '#e3b341'
        : '#ff7b72';

  let html = "<div class='block-box'>";
  html += '<h2>📊 Анализ ликвидности</h2>';
  html += '<div style="font-size: 14px; margin-bottom: 10px;">';
  html += `Статус: <strong style="color: ${statusColor};">${status === 'HEALTHY' ? '✅ Здоровый' : status === 'WARNING' ? '⚠️ Внимание' : '🔴 Критический'}</strong>`;
  html += '</div>';

  // Progress bars
  html += "<div style='margin: 10px 0;'>";
  html +=
    "<div style='font-size: 12px; color: #8b949e; margin-bottom: 4px;'>Структура ликвидности:</div>";
  html +=
    '<div style="background: #21262d; border-radius: 4px; height: 20px; overflow: hidden; display: flex;">';
  if (highPct > 0)
    html += `<div style="background: #56d364; width: ${highPct}%; text-align: center; font-size: 11px; line-height: 20px; color: #000;">${highPct.toFixed(0)}%</div>`;
  if (mediumPct > 0)
    html += `<div style="background: #8b949e; width: ${mediumPct}%; text-align: center; font-size: 11px; line-height: 20px;">${mediumPct.toFixed(0)}%</div>`;
  if (lowPct > 0)
    html += `<div style="background: #e3b341; width: ${lowPct}%; text-align: center; font-size: 11px; line-height: 20px; color: #000;">${lowPct.toFixed(0)}%</div>`;
  if (criticalPct > 0)
    html += `<div style="background: #ff7b72; width: ${criticalPct}%; text-align: center; font-size: 11px; line-height: 20px;">${criticalPct.toFixed(0)}%</div>`;
  html += '</div></div>';

  if (warnings.length > 0) {
    html += "<div style='margin-top: 10px;'>";
    html +=
      "<div style='font-size: 13px; font-weight: bold; color: #e3b341; margin-bottom: 6px;'>⚠️ Предупреждения:</div>";
    for (const w of warnings) {
      html += `<div style='font-size: 12px; color: #ff7b72; margin-bottom: 3px;'>• ${w}</div>`;
    }
    html += '</div>';
  }

  if (recommendations.length > 0) {
    html += "<div style='margin-top: 10px;'>";
    html +=
      "<div style='font-size: 13px; font-weight: bold; color: #58a6ff; margin-bottom: 6px;'>💡 Рекомендации:</div>";
    for (const r of recommendations) {
      html += `<div style='font-size: 12px; color: #8b949e; margin-bottom: 3px;'>• ${r}</div>`;
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
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
  /** Действующие долевые позиции (не дивидендные): «Имя (TICKER): N шт.» */
  stocksPositionsBlock: string;
}

/** Шаг стратега, участвующий в итоге ребалансировки. */
export interface RebalanceStep {
  ticker: string;
  amountRub: number;
  /** «Купить» / «Продать» / «Удерживать» */
  action?: string;
  /** Отображаемое имя (если известно) */
  name?: string;
}

interface RebalancePosition {
  name: string;
  ticker: string;
  amountRub: number;
}

/**
 * Действующие долевые позиции из assetsAnalysis.
 *
 * Раньше список брался из income.stocks (дивидендные позиции), поэтому
 * при пустом листе «Дивиденды» отчёт писал «Данные не получены», хотя
 * акции в портфеле есть. Здесь источник — сам портфель.
 */
export function buildActiveStockPositionsText(
  assetsAnalysis: AssetAnalysis[],
): string {
  return assetsAnalysis
    .filter((asset) => {
      const type = (asset.assetType ?? '').trim().toUpperCase();
      const isStock = type === 'А' || type === 'АКЦИЯ' || type === 'STOCK';
      return isStock && (asset.quantity ?? 0) > 0;
    })
    .map((asset) => `${asset.name} (${asset.ticker}): ${asset.quantity} шт.`)
    .join(', ');
}

/**
 * Итог ребалансировки = дефицитные позиции PortfolioMath + BUY-шаги стратега.
 *
 * PortfolioMath не всегда содержит NEW-ОФЗ (например, когда бумага только
 * докупается), но стратег уже построил для неё шаг. Итоговая сумма обязана
 * учитывать оба источника, иначе 3 позиции превращаются в 2.
 */
function mergeRebalancePositions(
  assetsAnalysis: AssetAnalysis[],
  strategySteps?: RebalanceStep[],
): RebalancePosition[] {
  const assetByTicker = new Map(
    assetsAnalysis.map((asset) => [asset.ticker.toUpperCase(), asset]),
  );
  const buyAssets = assetsAnalysis.filter(
    (asset) =>
      (asset.status === 'BUY' || asset.status === 'NEW') &&
      asset.deficitRub > 0,
  );

  const positions = new Map<string, RebalancePosition>();
  for (const asset of buyAssets) {
    positions.set(asset.ticker.toUpperCase(), {
      name: asset.name,
      ticker: asset.ticker,
      amountRub: asset.deficitRub,
    });
  }

  const skippedSurplus: string[] = [];
  for (const step of strategySteps ?? []) {
    const ticker = (step.ticker ?? '').trim();
    if (!ticker) continue;
    // Плитка «Приоритет покупок» — только покупки. Шаг без действия
    // больше не считается покупкой: раньше default=true затаскивал
    // в список профицитные позиции (Новотр, ФосАгро, ДелПорт, sГТЛК,
    // Селигдар) и плитка называла их приоритетом покупок.
    const isBuy = step.action ? /куп/i.test(step.action) : false;
    if (!isBuy || !(step.amountRub > 0)) continue;

    const key = ticker.toUpperCase();
    if (positions.has(key)) continue;

    // Сверка с PortfolioMath: профицит (REDUCE/EXIT) и нулевой дефицит
    // в список покупок не попадают, даже если шаг пришёл из стратегии.
    const asset = assetByTicker.get(key);
    const isMathBuy =
      asset !== undefined &&
      (asset.status === 'BUY' || asset.status === 'NEW') &&
      asset.deficitRub > 0;
    if (asset && !isMathBuy) {
      skippedSurplus.push(`${ticker}(${asset.status},${asset.deficitRub})`);
      continue;
    }

    positions.set(key, {
      name: step.name ?? ticker,
      ticker,
      amountRub: step.amountRub,
    });
  }

  if (skippedSurplus.length > 0) {
    console.log(
      `[PRIORITY_TILE] excluded_non_buy=${skippedSurplus.join(',')} ` +
        `included=${[...positions.keys()].join(',') || 'none'}`,
    );
  }

  return [...positions.values()];
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
    // Группируем заявки по счетам
    const accountsMap = new Map<string, QuikOrder[]>();
    for (const order of realOrders) {
      const account = order.account || 'НЕИЗВЕСТЕН';
      if (!accountsMap.has(account)) {
        accountsMap.set(account, []);
      }
      accountsMap.get(account)!.push(order);
    }

    const accountNames = Array.from(accountsMap.keys());

    html +=
      '<table class="orders-table grouped-orders">' +
      '<thead><tr>' +
      '<th>Счет</th>' +
      '<th>Инструмент</th>' +
      '<th>Операция</th>' +
      '<th>Количество</th>' +
      '<th>Цена за ед.</th>' +
      '<th>Общая сумма</th>' +
      '<th>Статус заявки</th>' +
      '</tr></thead>' +
      '<tbody>';

    for (let a = 0; a < accountNames.length; a++) {
      const account = accountNames[a]!;
      const orders = accountsMap.get(account)!;
      const accountRowCount = orders.length;

      for (let i = 0; i < orders.length; i++) {
        const order = orders[i]!;

        let opColor = order.operation! === 'BUY' ? '#238636' : '#da3633';
        let badgeStatusClass = 'status-' + order.operation;
        if (order.status === 'ИСПОЛНЕНА') {
          badgeStatusClass = 'status-FILLED';
          opColor = '#21262d';
        } else if (order.status === 'GTC (ПЕРЕНОС)') {
          badgeStatusClass = 'status-NEW';
          opColor = '#8a2be2';
        }

        // Разделитель между счетами
        const isFirstInAccount = i === 0;
        const isLastAccount = a === accountNames.length - 1;
        const isLastInAccount = i === orders.length - 1;

        let rowClass = 'order-row-' + badgeStatusClass;
        if (isFirstInAccount && !isLastAccount && !isLastInAccount) {
          rowClass += ' row-account-start';
        } else if (isFirstInAccount && isLastAccount && !isLastInAccount) {
          rowClass += ' row-account-start';
        } else if (!isFirstInAccount && isLastInAccount) {
          rowClass += ' row-account-end';
        }

        let accountCell = '';
        if (isFirstInAccount) {
          accountCell =
            "<td rowspan='" +
            accountRowCount +
            "' class='account-label-cell'><span class='account-label'>" +
            account +
            '</span></td>';
        }

        html +=
          '<tr class="' +
          rowClass +
          '">' +
          accountCell +
          "<td class='instrument-name'><strong>" +
          order.ticker! +
          '</strong></td>' +
          '<td>' +
          "<span class='status-badge " +
          badgeStatusClass +
          "' style='background-color: " +
          opColor +
          "; color: #fff;'>" +
          order.operation! +
          '</span>' +
          '</td>' +
          '<td>' +
          order.qty!.toLocaleString('ru-RU') +
          ' шт.</td>' +
          '<td>' +
          formatPrice(order.price!) +
          ' ₽</td>' +
          "<td class='sum-cell'>" +
          formatPrice(order.sum!) +
          ' ₽</td>' +
          '<td>' +
          order.status! +
          '</td>' +
          '</tr>';

        md +=
          '- ' +
          account +
          ' | ' +
          order.ticker! +
          ': Заявка на ' +
          order.operation! +
          ' (' +
          order.status! +
          '), ' +
          order.qty! +
          ' шт. по цене ' +
          (order.isBond!
            ? formatPrice(order.pricePercent!) + '% от номинала'
            : formatPrice(order.price!) + ' руб.') +
          ' (Всего: ' +
          formatPrice(order.sum!) +
          ' руб.)\n';
      }
    }

    html += '</tbody></table>';
  } else {
    html =
      "<tr><td colspan='7'>Нет активных или завершенных заявок в стаканах Мосбиржи</td></tr>";
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
  strategySteps?: RebalanceStep[],
): HTMLTablesResult {
  let barRows = '';
  let legendRows = '';
  let tableRows = '';
  let priorityBlock = '';
  let concentrationBlock = '';
  let rebalanceBlock = '';

  // silent — assets загружены

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
    const item = sortedAssets[i]!;
    const color = colors[i % colors.length];
    const widthFact = Math.min(100, Math.max(0, item.currentPercent * 4));
    const widthTarget = Math.min(
      100,
      Math.max(0, (item.targetPercent ?? 0) * 4),
    );

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
      (item.targetPercent !== undefined ? item.targetPercent.toFixed(1) : '—') +
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

    // Контракт колонки «Дефицит/Профицит»: current − target.
    // Дефицит отрицательный, профицит положительный.
    const signedAmount = -item.deficitRub;
    const prefix = signedAmount > 0 ? '+' : '';
    const colorStyle =
      signedAmount > 0 ? '#56d364' : signedAmount < 0 ? '#ff7b72' : '#fff';

    // Если целевая доля не установлена или равна 0 — выводим прочерк
    const displayDeficit =
      item.targetPercent === undefined || item.targetPercent === 0
        ? '—'
        : prefix + signedAmount.toLocaleString('ru-RU') + ' ₽';

    // ─── P&L от цены входа (в процентах) ───
    const balancePrice = Number(item.balancePrice) || 0;
    const currentPrice = Number(item.currentPrice) || 0;
    // Для облигаций с UNKNOWN priceUnit P&L = «—» (номинал неизвестен)
    const isPriceUnknown = item.priceUnit === 'UNKNOWN';
    const pnlPercent =
      !isPriceUnknown && currentPrice > 0 && balancePrice > 0
        ? ((currentPrice - balancePrice) / balancePrice) * 100
        : 0;
    const pnlColor =
      pnlPercent > 0 ? '#56d364' : pnlPercent < 0 ? '#ff7b72' : '#e3b341';
    const pnlDirection =
      pnlPercent > 0 ? 'up' : pnlPercent < 0 ? 'down' : 'same';
    const pnlArrow =
      pnlDirection === 'up' ? '↑' : pnlDirection === 'down' ? '↓' : '↔';

    tableRows +=
      '<tr>' +
      "<td class='asset-name'><strong>" +
      item.name +
      '</strong></td>' +
      '<td>' +
      item.currentPercent.toFixed(1) +
      '%</td>' +
      '<td>' +
      (item.targetPercent !== undefined ? item.targetPercent.toFixed(1) : '—') +
      '%</td>' +
      '<td class="deficit-cell" style="color: ' +
      colorStyle +
      ';">' +
      displayDeficit +
      '</td>' +
      "<td><span class='status-badge status-" +
      (item.status === 'EXIT' ? 'EXIT' : item.status) +
      "'>" +
      (item.status === 'EXIT'
        ? 'ВЫХОД'
        : item.status === 'NO_TARGET'
          ? 'БЕЗ ЦЕЛИ'
          : item.status) +
      '</span></td>' +
      "<td class='price-info price-direction--" +
      pnlDirection +
      "'>" +
      "<div class='price-pair'>" +
      "<span class='price-entry'>" +
      (balancePrice > 0
        ? balancePrice.toLocaleString('ru-RU', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }) + ' ₽'
        : '—') +
      '</span>' +
      "<span class='price-current'>" +
      (currentPrice > 0
        ? currentPrice.toLocaleString('ru-RU', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }) + ' ₽'
        : '—') +
      '</span>' +
      '</div>' +
      "<span class='price-arrow'>" +
      pnlArrow +
      '</span>' +
      '</td>' +
      "<td class='pnl-cell' style='color: " +
      pnlColor +
      ";'>" +
      "<span class='pnl-arrow'>" +
      pnlArrow +
      '</span>' +
      "<span class='pnl-pct'>" +
      (isPriceUnknown || currentPrice === 0 || balancePrice === 0
        ? '—'
        : (pnlPercent > 0 ? '+' : '') + pnlPercent.toFixed(1) + '%') +
      '</span>' +
      '</td>' +
      '</tr>';
  }

  // NEW-активы (например, ОФЗ) тоже участвуют в приведении к целям:
  // стратег строит для них шаг, значит итоговая сумма обязана их учитывать.
  // BUY-шаги стратега добавляются к дефицитным позициям PortfolioMath —
  // иначе NEW-ОФЗ из шага не попадает в итог и 3 позиции превращаются в 2.
  const rebalancePositions = mergeRebalancePositions(
    assetsAnalysis,
    strategySteps,
  );
  if (rebalancePositions.length > 0) {
    console.log(
      `[REBALANCE_TOTAL] render=report-builders positions=${rebalancePositions.length} ` +
        `totalRub=${rebalancePositions.reduce((sum, a) => sum + a.amountRub, 0)} ` +
        `tickers=${rebalancePositions.map((a) => a.ticker).join(',')}`,
    );
  }
  if (rebalancePositions.length > 0) {
    priorityBlock =
      "<div class='priority-section'>" +
      "<h3 class='section-title section-title--blue'>🎯 Приоритет покупок (только дефицит к цели)</h3>" +
      "<div class='priority-list'>";
    rebalancePositions.forEach((item, index) => {
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
        item.amountRub.toLocaleString('ru-RU') +
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

  if (rebalancePositions.length > 0) {
    const topBuy = rebalancePositions[0]!;
    const topAsset = assetsAnalysis.find(
      (asset) => asset.ticker.toUpperCase() === topBuy.ticker.toUpperCase(),
    );
    const topTargetPct = topAsset?.targetPercent ?? 0;
    const topCurrentPct = topAsset?.currentPercent ?? 0;
    const totalDeficit = rebalancePositions
      .reduce((sum, a) => sum + a.amountRub, 0)
      .toLocaleString('ru-RU');
    const totalPositions = rebalancePositions.length;
    const topName = topBuy.name;
    const topDeficit = topBuy.amountRub.toLocaleString('ru-RU');
    const topPct = (topTargetPct - topCurrentPct).toFixed(1);
    const positionsWord =
      totalPositions % 10 === 1 && totalPositions % 100 !== 11
        ? 'позицию'
        : [2, 3, 4].includes(totalPositions % 10) &&
            ![12, 13, 14].includes(totalPositions % 100)
          ? 'позиции'
          : 'позиций';

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
      ' ' +
      positionsWord +
      '</strong>.' +
      '</div>' +
      '</div></div>';
  }

  // Действующие долевые позиции — из самого портфеля, а не из income.stocks.
  const activeStocksText = buildActiveStockPositionsText(assetsAnalysis);
  const stocksPositionsBlock = activeStocksText
    ? "<div class='stocks-positions-section'>" +
      "<h3 class='section-title section-title--blue'>📌 Действующие долевые позиции</h3>" +
      "<div class='stocks-positions-list'>" +
      activeStocksText +
      '</div></div>'
    : '';

  return {
    barRows,
    legendRows,
    tableRows,
    priorityBlock,
    concentrationBlock,
    rebalanceBlock,
    stocksPositionsBlock,
  };
}

// ─── Интерфейсы для котировок акций ─────────────────────────────────────

export interface StockQuote {
  ticker: string;
  name: string;
  shortName: string;
  currentPrice: number;
  dailyDynamicsPercent: number;
  /** Дневной оборот в рублях */
  volumeTodayRub?: number;
  /** Источник котировки: MOEX_ISS / EXCEL / PYTHON_ISS */
  source?: string;
  /** Время среза котировки (ISO) */
  asOf?: string | null;
}

export interface QuotesBlockResult {
  quotesTableRows: string;
  topGainers: string;
  topLosers: string;
  /** Подпись источника и времени среза (атрибуция таблицы). */
  quotesSourceNote: string;
  /**
   * Пометка о движениях на низкой ликвидности: такие проценты —
   * шум, а не сигнал. Пустая строка — подобных движений нет.
   */
  lowLiquidityNote: string;
}

/**
 * Генерация блока "Котировки акций" с таблицей всех акций
 * и мини-блоками топ/антитоп
 */
export function buildQuotesBlock(quotes: StockQuote[]): QuotesBlockResult {
  let quotesTableRows = '';
  let topGainers = '';
  let topLosers = '';

  if (quotes.length === 0) {
    return {
      quotesTableRows,
      topGainers,
      topLosers,
      quotesSourceNote: '',
      lowLiquidityNote: '',
    };
  }

  // Атрибуция таблицы: источник и время среза. Без этого таблица выглядит
  // как «данные ниоткуда» — именно этот дефект был в дашборде.
  const sources = Array.from(
    new Set(
      quotes
        .map((quote) => quote.source)
        .filter((source): source is string => Boolean(source)),
    ),
  );
  const asOfValues = quotes
    .map((quote) => quote.asOf)
    .filter((asOf): asOf is string => Boolean(asOf))
    .sort();
  const latestAsOf = asOfValues[asOfValues.length - 1] ?? null;
  const quotesSourceNote =
    sources.length > 0
      ? `Источник: ${sources.join(', ')}${
          latestAsOf
            ? `, срез ${new Date(latestAsOf).toLocaleString('ru-RU')}`
            : ''
        }`
      : 'Источник котировок не указан';

  // Сортировка по дневной динамике. NaN/undefined не участвуют: они не
  // «нулевое изменение», а отсутствие данных.
  const noticePct = PortfolioConfig.anomaly.noticePct;
  const sortedByDynamics = quotes
    .filter((quote) => Number.isFinite(quote.dailyDynamicsPercent))
    .sort((a, b) => b.dailyDynamicsPercent - a.dailyDynamicsPercent);

  // Топ-5 роста — только значимые движения (>= порога заметности из конфига).
  // Движения меньше 1% — шум, а не сигнал.
  const risingQuotes = sortedByDynamics.filter(
    (q) => q.dailyDynamicsPercent >= noticePct,
  );
  const topGainersList = risingQuotes.slice(0, 5);

  // Топ-5 падения — только значимые движения.
  const decliningQuotes = sortedByDynamics.filter(
    (q) => q.dailyDynamicsPercent <= -noticePct,
  );
  const topLosersList = decliningQuotes.slice(-5).reverse();

  // Генерация строк таблицы
  for (const quote of quotes) {
    // Изменение может быть NaN/undefined (источник не отдал LASTCHANGEPCT).
    // Fail-closed: пишем «н/д», а не «NaN%» и не выдуманный 0.
    const change = quote.dailyDynamicsPercent;
    const changeValid = Number.isFinite(change);
    const color = !changeValid
      ? '#8b949e'
      : change > 0
        ? '#56d364'
        : change < 0
          ? '#ff7b72'
          : '#e3b341';
    const arrow = !changeValid
      ? '—'
      : change > 0
        ? '↑'
        : change < 0
          ? '↓'
          : '↔';

    quotesTableRows +=
      '<tr>' +
      "<td class='quote-name'><strong>" +
      quote.shortName +
      '</strong></td>' +
      "<td class='quote-price'>" +
      (quote.currentPrice > 0
        ? quote.currentPrice.toLocaleString('ru-RU', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }) + ' ₽'
        : '—') +
      '</td>' +
      "<td class='quote-dynamics' style='color: " +
      color +
      ";'>" +
      "<span class='quote-arrow'>" +
      arrow +
      '</span>' +
      "<span class='quote-value'>" +
      (changeValid
        ? change !== 0
          ? (change > 0 ? '+' : '') + change.toFixed(2) + '%'
          : '0.00%'
        : 'н/д') +
      '</span>' +
      '</td>' +
      "<td class='quote-volume'>" +
      (quote.volumeTodayRub != null && quote.volumeTodayRub > 0
        ? formatVolumeRub(quote.volumeTodayRub)
        : '—') +
      '</td>' +
      '</tr>';
  }

  // Генерация топ-гainers
  if (topGainersList.length > 0) {
    topGainers =
      "<div class='quotes-top-block'>" +
      "<h4 class='section-title section-title--green'>🚀 Топ-5 роста</h4>" +
      "<div class='quotes-list'>";
    topGainersList.forEach((quote) => {
      topGainers +=
        "<div class='quote-item quote-item--green'>" +
        "<span class='quote-item-ticker'>" +
        quote.shortName +
        '</span>' +
        "<span class='quote-item-value' style='color: #56d364;'>" +
        '+' +
        quote.dailyDynamicsPercent.toFixed(2) +
        '%' +
        '</span>' +
        '</div>';
    });
    topGainers += '</div></div>';
  } else {
    // Нет растущих акций — показываем сообщение
    topGainers =
      "<div class='quotes-top-block'>" +
      "<h4 class='section-title section-title--green'>🚀 Топ-5 роста</h4>" +
      "<div style='padding:10px;color:#8b949e;font-size:13px;'>Нет акций с положительной динамикой за сегодня</div>" +
      '</div>';
  }

  // Генерация топ-losers (антитоп)
  if (topLosersList.length > 0) {
    topLosers =
      "<div class='quotes-top-block'>" +
      "<h4 class='section-title section-title--red'>📉 Топ-5 падения</h4>" +
      "<div class='quotes-list'>";
    topLosersList.forEach((quote) => {
      topLosers +=
        "<div class='quote-item quote-item--red'>" +
        "<span class='quote-item-ticker'>" +
        quote.shortName +
        '</span>' +
        "<span class='quote-item-value' style='color: #ff7b72;'>" +
        quote.dailyDynamicsPercent.toFixed(2) +
        '%' +
        '</span>' +
        '</div>';
    });
    topLosers += '</div></div>';
  } else {
    // Нет падающих акций — показываем сообщение
    topLosers =
      "<div class='quotes-top-block'>" +
      "<h4 class='section-title section-title--red'>📉 Топ-5 падения</h4>" +
      "<div style='padding:10px;color:#8b949e;font-size:13px;'>Нет акций с отрицательной динамикой за сегодня</div>" +
      '</div>';
  }

  // Движения на низкой ликвидности — шум, а не сигнал. Отчёт обязан
  // отделить их от значимых движений (кейс ЕвроТранс: −9,90% при 1,7 млн ₽).
  const lowLiquidityMoves = quotes
    .filter((quote) => Number.isFinite(quote.dailyDynamicsPercent))
    .map((quote) =>
      assessDailyMove({
        ticker: quote.ticker,
        dayChangePct: quote.dailyDynamicsPercent,
        turnoverRub: quote.volumeTodayRub ?? null,
      }),
    )
    .filter((assessment) => assessment.verdict === 'low_liquidity_noise');

  const lowLiquidityNote =
    lowLiquidityMoves.length > 0
      ? 'Движение на низкой ликвидности (не сигнал): ' +
        lowLiquidityMoves.map((assessment) => assessment.message).join('; ')
      : '';

  // Если значимых движений нет — честно говорим, что топ не сформирован,
  // а не показываем «+0,12%» как сигнал.
  const noNotableMovesNote =
    topGainersList.length === 0 &&
    topLosersList.length === 0 &&
    quotes.length > 0
      ? `Движения ниже порога заметности ${noticePct}% — шум, топ не сформирован.`
      : '';

  return {
    quotesTableRows,
    topGainers,
    topLosers,
    quotesSourceNote,
    lowLiquidityNote: [lowLiquidityNote, noNotableMovesNote]
      .filter((note) => note.length > 0)
      .join(' '),
  };
}

// ============================================================================
// P1-3: Итоговое заключение — 4 элемента по ТЗ
// ============================================================================

/** Итоговое заключение по активу */
export interface FinalConclusion {
  /** 1. Действие */
  action: string;
  /** 2. Причины рекомендации */
  reasons: string[];
  /** 3. Основные риски */
  risks: string[];
  /** 4. Ограничения исполнения */
  executionLimitations: string[];
}

/**
 * Формирует итоговое заключение по активу.
 *
 * Требования ТЗ (Этап 8):
 * 1. Действие
 * 2. Причины рекомендации
 * 3. Основные риски
 * 4. Состояние данных
 * 5. Источник рекомендации
 * 6. Согласованность Math и AI
 * 7. Ограничения исполнения
 */
export function buildFinalConclusion(
  assetAnalysis: {
    ticker: string;
    name: string;
    status: string;
    targetPercent?: number;
    currentPercent: number;
    deficitRub: number;
    unrealizedProfitRub: number;
    balancePrice: number;
    currentPrice: number;
    holdOnly?: boolean;
    isConcentrated?: boolean;
    quantity: number;
  },
  aiRecommendation: {
    recommendedAction: string | null;
    confidence: number | null;
    rationale: string | null;
    keyRisks: string[];
  } | null,
): FinalConclusion {
  const reasons: string[] = [];
  const risks: string[] = [];
  const limitations: string[] = [];

  // ─── 1. Действие ───
  const mathAction = assetAnalysis.status;

  // ─── 2. Причины рекомендации ───
  const deviation =
    assetAnalysis.currentPercent - (assetAnalysis.targetPercent ?? 0);

  if (mathAction === 'BUY') {
    reasons.push(
      `Дефицит доли: текущая ${assetAnalysis.currentPercent.toFixed(1)}% vs целевая ${assetAnalysis.targetPercent?.toFixed(1) ?? '—'}%`,
    );
    if (assetAnalysis.deficitRub > 0) {
      reasons.push(
        `Рублёвый дефицит: ${assetAnalysis.deficitRub.toLocaleString('ru-RU')} ₽`,
      );
    }
  } else if (mathAction === 'SELL' || mathAction === 'REDUCE') {
    reasons.push(
      `Профицит доли: текущая ${assetAnalysis.currentPercent.toFixed(1)}% vs целевая ${assetAnalysis.targetPercent?.toFixed(1) ?? '—'}%`,
    );
    reasons.push(`Превышение: ${Math.abs(deviation).toFixed(1)} п.п.`);
    if (assetAnalysis.deficitRub < 0) {
      reasons.push(
        `Рублёвый профицит: ${Math.abs(assetAnalysis.deficitRub).toLocaleString('ru-RU')} ₽`,
      );
    }
  } else if (mathAction === 'EXIT') {
    reasons.push('Целевая доля = 0% — плановый выход из позиции');
  } else if (mathAction === 'STABLE' || mathAction === 'HOLD') {
    reasons.push('Позиция в пределах целевого диапазона');
  } else if (mathAction === 'NEW') {
    reasons.push('Целевая доля есть, но позиции нет — новая позиция');
  } else if (mathAction === 'NO_TARGET') {
    reasons.push('Целевая доля не установлена в Excel');
  }

  // AI rationale НЕ добавляем в итоговое заключение — AI выдумывает числа
  // Rationale используется только в текстовом отчёте, не в структурированном выводе

  // ─── 3. Основные риски ───
  if (assetAnalysis.isConcentrated) {
    risks.push(
      `Высокая концентрация: ${assetAnalysis.currentPercent.toFixed(1)}% портфеля`,
    );
  }
  if (assetAnalysis.unrealizedProfitRub < 0) {
    const drawdownPct =
      assetAnalysis.balancePrice > 0
        ? ((assetAnalysis.currentPrice - assetAnalysis.balancePrice) /
            assetAnalysis.balancePrice) *
          100
        : 0;
    risks.push(
      `Нереализованный убыток: ${assetAnalysis.unrealizedProfitRub.toLocaleString('ru-RU')} ₽ (${drawdownPct.toFixed(1)}%)`,
    );
  }
  if (
    aiRecommendation &&
    aiRecommendation.keyRisks &&
    aiRecommendation.keyRisks.length > 0
  ) {
    risks.push(...aiRecommendation.keyRisks);
  }
  if (risks.length === 0) {
    risks.push('Нет критических рисков');
  }

  // ─── 4. Ограничения исполнения ───

  // ─── 7. Ограничения исполнения ───
  if (assetAnalysis.holdOnly) {
    limitations.push('Продажа запрещена (holdOnly=true)');
  }
  if (mathAction === 'BUY' && assetAnalysis.deficitRub <= 0) {
    limitations.push('Недостаточно средств для покупки');
  }
  if (
    assetAnalysis.holdOnly &&
    (mathAction === 'SELL' || mathAction === 'REDUCE' || mathAction === 'EXIT')
  ) {
    limitations.push(
      '⛔ Исполнение заблокировано: holdOnly конфликтует с действием',
    );
  }
  if (limitations.length === 0) {
    limitations.push('Нет ограничений');
  }

  return {
    action: mathAction,
    reasons,
    risks,
    executionLimitations: limitations,
  };
}
