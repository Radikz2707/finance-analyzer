/**
 * Market Data Contracts — единые контракты рыночных данных.
 *
 * Канонические типы для finam-api и moex-api (ранее OHLCVBar/HistoryResult
 * дублировались в обоих провайдерах). Файл чистый: только типы, без
 * зависимостей — провайдеры импортируют type-only, runtime-циклов нет.
 */

/** Интервал свечей */
export type HistoryInterval = 'D' | 'W' | 'M';

/** OHLCV-свеча */
export interface OHLCVBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Результат загрузки исторических данных (общий для всех провайдеров) */
export interface HistoryResult {
  ticker: string;
  bars: OHLCVBar[];
  from: string;
  to: string;
  count: number;
  fromCache: boolean;
}
