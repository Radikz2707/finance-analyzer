/**
 * Технические факты карточки: 52-недельный диапазон и SMA.
 *
 * Зачем: карточка писала «Технические индикаторы недоступны», хотя история
 * MOEX ISS уже загружена. Модуль считает факты из этой истории, а не
 * выдумывает их и не берёт из промпта.
 *
 * Принципы:
 * - периоды SMA и окно истории — только из `PortfolioConfig.moexQuotes`;
 * - 52w-диапазон не строится на коротком окне: меньше `minBarsFor52w` →
 *   `null` и причина в `unavailable`, а не максимум по трём барам;
 * - нет валидной истории → все значения `null`, карточка пишет «недоступно»;
 * - функция чистая: I/O остаётся у клиента MOEX ISS.
 */

import { PortfolioConfig } from '../../../config/portfolio-config.js';

/** Минимальный контракт бара: подходит и MoexHistoryBar, и OHLCVBar. */
export interface TechnicalBar {
  date: string;
  high: number;
  low: number;
  close: number;
}

/** Значение SMA за период. */
export interface TechnicalSmaFact {
  period: number;
  value: number | null;
}

/** Технические факты одного инструмента. */
export interface TechnicalFacts {
  ticker: string;
  /** Дата последнего валидного бара (ISO), null — истории нет. */
  asOf: string | null;
  barsCount: number;
  currentPrice: number | null;
  high52w: number | null;
  low52w: number | null;
  sma: TechnicalSmaFact[];
  /** Причины, по которым показатель не построен. */
  unavailable: string[];
}

const CONFIG = PortfolioConfig.moexQuotes;

const DAY_MS = 24 * 60 * 60 * 1000;

function isValidBar(bar: TechnicalBar): boolean {
  return (
    typeof bar.date === 'string' &&
    bar.date.length > 0 &&
    Number.isFinite(bar.high) &&
    Number.isFinite(bar.low) &&
    Number.isFinite(bar.close) &&
    bar.high > 0 &&
    bar.low > 0 &&
    bar.close > 0 &&
    bar.high >= bar.low
  );
}

function average(values: readonly number[]): number {
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

/**
 * Построить технические факты из дневной истории.
 *
 * Бары сортируются по дате; невалидные (нулевые/отрицательные цены,
 * high < low) отбрасываются. Окно 52w отсчитывается от последнего бара.
 */
export function buildTechnicalFacts(
  ticker: string,
  bars: readonly TechnicalBar[],
): TechnicalFacts {
  const normalizedTicker = ticker.trim().toUpperCase();
  const valid = bars
    .filter(isValidBar)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const sma: TechnicalSmaFact[] = CONFIG.smaPeriods.map((period) => {
    if (valid.length < period) {
      return { period, value: null };
    }
    const closes = valid.slice(-period).map((bar) => bar.close);
    return { period, value: Number(average(closes).toFixed(4)) };
  });

  const unavailable: string[] = [];
  for (const fact of sma) {
    if (fact.value === null) {
      unavailable.push(
        `SMA${fact.period}: недостаточно истории (${valid.length} < ${fact.period})`,
      );
    }
  }

  if (valid.length === 0) {
    return {
      ticker: normalizedTicker,
      asOf: null,
      barsCount: 0,
      currentPrice: null,
      high52w: null,
      low52w: null,
      sma,
      unavailable: ['история MOEX ISS недоступна', ...unavailable],
    };
  }

  const lastBar = valid[valid.length - 1] as TechnicalBar;
  const asOf = lastBar.date;
  const cutoff =
    new Date(`${asOf}T00:00:00Z`).getTime() - CONFIG.historyWindowDays * DAY_MS;
  const windowBars = valid.filter(
    (bar) => new Date(`${bar.date}T00:00:00Z`).getTime() >= cutoff,
  );

  let high52w: number | null = null;
  let low52w: number | null = null;
  if (windowBars.length < CONFIG.minBarsFor52w) {
    unavailable.push(
      `52w: недостаточно истории (${windowBars.length} < ${CONFIG.minBarsFor52w})`,
    );
  } else {
    high52w = Math.max(...windowBars.map((bar) => bar.high));
    low52w = Math.min(...windowBars.map((bar) => bar.low));
  }

  return {
    ticker: normalizedTicker,
    asOf,
    barsCount: valid.length,
    currentPrice: lastBar.close,
    high52w,
    low52w,
    sma,
    unavailable,
  };
}

function formatPrice(value: number): string {
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

/**
 * Человекочитаемая строка для карточки/промпта.
 * Недоступные показатели честно помечаются «недоступно».
 */
export function formatTechnicalFacts(facts: TechnicalFacts): string {
  if (facts.barsCount === 0) {
    return 'Технические индикаторы: недоступно (нет истории MOEX ISS)';
  }

  const parts: string[] = [];

  if (facts.high52w !== null && facts.low52w !== null) {
    parts.push(
      `52w: ${formatPrice(facts.low52w)}–${formatPrice(facts.high52w)} ₽`,
    );
  } else {
    parts.push('52w: недоступно');
  }

  for (const sma of facts.sma) {
    parts.push(
      `SMA${sma.period}: ${
        sma.value !== null ? `${formatPrice(sma.value)} ₽` : 'недоступно'
      }`,
    );
  }

  if (facts.currentPrice !== null) {
    parts.push(`последняя цена: ${formatPrice(facts.currentPrice)} ₽`);
  }

  if (facts.asOf) {
    parts.push(`источник: MOEX ISS, ${formatDate(facts.asOf)}`);
  }

  return parts.join('; ');
}
