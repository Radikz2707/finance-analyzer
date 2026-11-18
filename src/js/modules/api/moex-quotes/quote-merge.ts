/**
 * Слияние котировок Excel и MOEX ISS.
 *
 * Правило источника (прогон 20:57): MOEX ISS — основной источник цены,
 * изменения дня и оборота; Excel — только фолбэк, если ISS не подтвердил
 * инструмент. Раньше Excel перекрывал ISS, и таблица подписывалась
 * «Источник: EXCEL» при живых данных MOEX.
 *
 * Функция чистая: сеть остаётся у MoexQuotesClient.
 */

import type { MoexQuotesSnapshot } from './moex-quotes.js';

/** Минимальный контракт котировки, совместимый с AssetQuote. */
export interface MergeableQuote {
  ticker: string;
  name: string;
  shortName: string;
  currentPrice: number;
  dailyDynamicsPercent: number;
  volumeTodayRub?: number;
  /** EXCEL / EXCEL (фолбэк) / MOEX ISS / PYTHON_ISS */
  source?: string;
  asOf?: string | null;
}

export interface IssMergeResult<T extends MergeableQuote> {
  quotes: Record<string, T>;
  /** Тикеры, по которым ISS подтвердил цену. */
  applied: string[];
  /** Тикеры, оставшиеся на Excel-фолбэке. */
  excelFallback: string[];
  /** Тикеры ISS без подтверждённой цены. */
  issUnavailable: string[];
}

/**
 * Перезаписать Excel-котировки подтверждёнными данными MOEX ISS.
 *
 * - ISS подтвердил цену → цена/изменение/оборот/asOf из ISS, source='MOEX ISS';
 * - ISS не подтвердил → Excel остаётся, но помечается 'EXCEL (фолбэк)';
 * - оборот из ISS дополняет Excel, если ISS его не отдал.
 */
export function mergeIssQuotes<T extends MergeableQuote>(
  excelQuotes: Record<string, T>,
  snapshot: MoexQuotesSnapshot,
): IssMergeResult<T> {
  const quotes: Record<string, T> = { ...excelQuotes };
  const applied: string[] = [];

  for (const [rawTicker, issQuote] of Object.entries(snapshot.quotes)) {
    const ticker = rawTicker.trim().toUpperCase();
    if (!ticker) continue;
    if (issQuote.last === null || issQuote.last <= 0) continue;

    const existing = quotes[ticker];
    const merged: MergeableQuote = {
      ticker,
      name: existing?.name ?? ticker,
      shortName: existing?.shortName ?? ticker,
      currentPrice: issQuote.last,
      dailyDynamicsPercent:
        issQuote.changePct ?? existing?.dailyDynamicsPercent ?? 0,
      volumeTodayRub: issQuote.turnover ?? existing?.volumeTodayRub,
      source: 'MOEX ISS',
      asOf: issQuote.asOf,
    };

    // Структурная совместимость: поля Excel-котировки не теряются.
    quotes[ticker] = {
      ...(existing ?? ({} as T)),
      ...(merged as T),
    };
    applied.push(ticker);
  }

  const appliedSet = new Set(applied);
  const excelFallback: string[] = [];
  for (const [ticker, quote] of Object.entries(quotes)) {
    if (appliedSet.has(ticker.toUpperCase())) continue;
    if (quote.source === 'EXCEL') {
      quotes[ticker] = { ...quote, source: 'EXCEL (фолбэк)' };
      excelFallback.push(ticker);
    }
  }

  return {
    quotes,
    applied,
    excelFallback,
    issUnavailable: snapshot.unavailable.map((ticker) => ticker.toUpperCase()),
  };
}
