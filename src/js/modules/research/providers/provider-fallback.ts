/**
 * withProviderFallback — фабрика fallback-цепочки для research-провайдеров.
 *
 * Тонкая обёртка над withFallback из pipeline/infrastructure:
 * каждый источник задаётся парой { name, fetch }, результат помечается
 * именем источника, который ответил (source).
 *
 * ⚠️ Подключение в продакшн-код — отдельная задача (см. AI-AGENT-PLAN.md, 1.2):
 * DataFetcher и ResearchProviderRegistry имеют тесты, жёстко фиксирующие текущее
 * поведение (проброс первой ошибки / merge-семантика), поэтому цепочка
 * MOEX → CBR → Finam включается поэтапно вместе с обновлением этих тестов.
 */

import {
  withFallback,
  type FallbackOptions,
  type FallbackResult,
} from '../../pipeline/infrastructure/circuit-breaker.js';

/** Именованный источник данных */
export interface NamedProvider<T> {
  /** Имя источника (метка в результате и в onFallback) */
  name: string;
  /** Функция получения данных */
  fetch: () => Promise<T> | T;
}

export type ProviderFallbackOptions = Omit<FallbackOptions, 'labels'>;

/**
 * Последовательный вызов primary → fallbacks с метками имён источников.
 *
 * @example
 * const result = await withProviderFallback(
 *   { name: 'MOEX', fetch: () => moexApi.getQuotes(tickers) },
 *   [
 *     { name: 'CBR', fetch: () => cbrApi.getQuotes(tickers) },
 *     { name: 'Finam', fetch: () => finamApi.getQuotes(tickers) },
 *   ],
 * );
 * // result.source === 'Finam', если MOEX и CBR упали
 */
export function withProviderFallback<T>(
  primary: NamedProvider<T>,
  fallbacks: readonly NamedProvider<T>[] = [],
  options: ProviderFallbackOptions = {},
): Promise<FallbackResult<T>> {
  return withFallback(
    primary.fetch,
    fallbacks.map((p) => p.fetch),
    {
      ...options,
      labels: [primary.name, ...fallbacks.map((p) => p.name)],
    },
  );
}
