/**
 * DataFetcher — unified загрузчик исторических данных.
 *
 * Стратегия:
 * 1. Если FINAM_API_KEY установлен → используем Finam API
 * 2. Иначе → используем MOEX ISS API (бесплатно, без регистрации)
 *
 * Оба источника сохраняют данные в один SQLite-кэш,
 * поэтому переключение прозрачно для потребителей.
 */

import type { HistoryResult, OHLCVBar } from './contracts.js';
import {
  fetchHistoricalData as fetchFromFinam,
  fetchHistoricalBatch as fetchBatchFromFinam,
} from '../finam-api/history-provider.js';
import {
  fetchHistoricalData as fetchFromMoex,
  fetchHistoricalBatch as fetchBatchFromMoex,
} from '../moex-api/history-provider.js';
import {
  calculatePriceMetrics,
  formatMetrics,
} from '../moex-api/history-provider.js';

/** Результат загрузки (унифицированный) */
export interface DataFetchResult {
  ticker: string;
  bars: OHLCVBar[];
  from: string;
  to: string;
  count: number;
  fromCache: boolean;
  source: 'finam' | 'moex';
}

/** Запрос к DataFetcher */
export interface DataFetchRequest {
  ticker: string;
  interval: 'D' | 'W' | 'M';
  from: string;
  to: string;
}

/**
 * Загрузить исторические данные для одного тикера.
 * Автоматически выбирает источник (Finam → MOEX).
 */
export async function fetchHistoricalData(
  request: DataFetchRequest,
): Promise<DataFetchResult> {
  const hasFinamKey = !!(
    process.env.FINAM_API_KEY && process.env.FINAM_API_KEY.trim()
  );

  if (hasFinamKey) {
    const result: HistoryResult = await fetchFromFinam(request);
    return {
      ...result,
      source: 'finam',
    };
  }

  // Fallback на MOEX ISS
  const result: HistoryResult = await fetchFromMoex(request);
  return {
    ...result,
    source: 'moex',
  };
}

/**
 * Загрузить исторические данные для множества тикеров.
 */
export async function fetchHistoricalBatch(
  tickers: string[],
  from: string,
  to: string,
  interval: 'D' | 'W' | 'M' = 'D',
): Promise<Map<string, OHLCVBar[]>> {
  const hasFinamKey = !!(
    process.env.FINAM_API_KEY && process.env.FINAM_API_KEY.trim()
  );

  let results: Map<string, OHLCVBar[]>;

  if (hasFinamKey) {
    console.log('[DataFetcher] Используем Finam API');
    results = await fetchBatchFromFinam(tickers, from, to, interval);
  } else {
    console.log(
      '[DataFetcher] FINAM_API_KEY не установлен, используем MOEX ISS',
    );
    results = await fetchBatchFromMoex(tickers, from, to, interval);
  }

  return results;
}

// ──────────────────────────────────────────────
// 3. Analytics (re-export from MOEX provider)
// ──────────────────────────────────────────────

export { calculatePriceMetrics, formatMetrics };
