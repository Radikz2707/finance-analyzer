/**
 * Python Engine — TS↔Python мост и детектор статистических аномалий.
 *
 * Модуль: src/js/modules/python-engine/
 * Движок: src/python/main.py
 *
 * Использование:
 *   const detector = new AnomalyDetector();
 *   const results = await detector.detectAnomalies([
 *     { ticker: 'SBER', prices: [250, 251, ...], dates: [...] },
 *   ]);
 */

export * from './types.js';
export { PythonBridge } from './python-bridge.js';
export {
  AnomalyDetector,
  detectAnomaliesInTypeScript,
} from './anomaly-detector.js';
export {
  MoexQuoteProvider,
  type MoexQuote,
  type MoexQuotesResponse,
  type MoexFetchedQuote,
} from './moex-quote-provider.js';
