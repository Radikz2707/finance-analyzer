/**
 * Cross-check цен: карточка (MOEX ISS) против котировки дашборда.
 *
 * Правила:
 * - допуск расхождения — из PortfolioConfig.quoteCrossCheck.tolerancePct;
 * - нет одной из цен → проверка не выполняется (fail-closed: не «0%»);
 * - превышение допуска → warning с ОБЕИМИ ценами и временем каждого среза;
 * - ликвидность — факт: «ваша партия Y ₽ — Z% дневного оборота», Z считается.
 */

import { PortfolioConfig } from '../../../config/portfolio-config.js';

/** Минимальный контракт цены для сверки. */
export interface CrossCheckQuote {
  ticker: string;
  price: number | null;
  asOf?: string | null;
  source?: string | null;
}

/** Результат сверки по одному тикеру. */
export interface QuoteCrossCheckResult {
  ticker: string;
  cardPrice: number;
  dashboardPrice: number;
  diffPct: number;
  tolerancePct: number;
  exceeded: boolean;
  message: string;
}

function isValidPrice(price: number | null | undefined): price is number {
  return typeof price === 'number' && Number.isFinite(price) && price > 0;
}

function formatPrice(price: number): string {
  return price.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatAsOf(asOf: string | null | undefined): string {
  if (!asOf) return 'время среза не указано';
  const date = new Date(asOf);
  if (Number.isNaN(date.getTime())) return asOf;
  return date.toLocaleString('ru-RU');
}

/**
 * Сверить цены карточек с котировками дашборда.
 *
 * @param cardQuotes — цены из карточек (источник: MOEX ISS).
 * @param dashboardQuotes — цены из таблицы «Котировки акций».
 * @param tolerancePct — допуск расхождения, % (по умолчанию из конфига).
 */
export function crossCheckQuotes(
  cardQuotes: CrossCheckQuote[],
  dashboardQuotes: CrossCheckQuote[],
  tolerancePct: number = PortfolioConfig.quoteCrossCheck.tolerancePct,
): QuoteCrossCheckResult[] {
  const dashboardByTicker = new Map(
    dashboardQuotes.map((quote) => [quote.ticker.trim().toUpperCase(), quote]),
  );

  const results: QuoteCrossCheckResult[] = [];

  for (const card of cardQuotes) {
    const ticker = card.ticker.trim().toUpperCase();
    const dashboard = dashboardByTicker.get(ticker);
    if (!dashboard) continue;
    if (!isValidPrice(card.price) || !isValidPrice(dashboard.price)) continue;

    const diffPct =
      (Math.abs(card.price - dashboard.price) / dashboard.price) * 100;
    const exceeded = diffPct > tolerancePct;

    const message =
      `⚠️ Расхождение цены ${ticker}: карточка ${formatPrice(card.price)} ₽ ` +
      `(${card.source ?? 'источник не указан'}, ${formatAsOf(card.asOf)}) ` +
      `vs дашборд ${formatPrice(dashboard.price)} ₽ ` +
      `(${dashboard.source ?? 'источник не указан'}, ${formatAsOf(
        dashboard.asOf,
      )}); расхождение ${diffPct.toFixed(2)}% при допуске ${tolerancePct}%`;

    if (exceeded) {
      console.warn(
        `[QUOTE_CROSS_CHECK] ticker=${ticker} card=${card.price} ` +
          `dashboard=${dashboard.price} diffPct=${diffPct.toFixed(2)} ` +
          `tolerancePct=${tolerancePct} cardAsOf=${card.asOf ?? 'null'} ` +
          `dashboardAsOf=${dashboard.asOf ?? 'null'}`,
      );
    }

    results.push({
      ticker,
      cardPrice: card.price,
      dashboardPrice: dashboard.price,
      diffPct,
      tolerancePct,
      exceeded,
      message,
    });
  }

  return results;
}

/**
 * Факт ликвидности для карточки: доля вашей партии в дневном обороте.
 * Оборот не подтверждён → честное «недоступен», а не 0%.
 */
export function buildLiquidityFact(
  positionRub: number | null | undefined,
  turnoverRub: number | null | undefined,
): string {
  if (!isValidPrice(turnoverRub)) {
    return 'Дневной оборот: недоступен — ликвидность не подтверждена';
  }

  if (!isValidPrice(positionRub)) {
    return `Дневной оборот: ${formatPrice(turnoverRub)} ₽`;
  }

  const sharePct = (positionRub / turnoverRub) * 100;
  return (
    `ваша партия ${formatPrice(positionRub)} ₽ — ` +
    `${sharePct.toFixed(2)}% дневного оборота (${formatPrice(turnoverRub)} ₽)`
  );
}
