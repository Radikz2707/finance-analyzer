/**
 * Harness Integration — UI-интеграция гибридного диспетчера,
 * QUIK-канала и Telegram-уведомлений.
 *
 * @module harness-integration
 */

export * from './types.js';
// ⚠️ anomaly-source.ts НЕ экспортируется отсюда: он тянет Node-цепочку
// (xlsx-parser → fs, finam history-provider → better-sqlite3). Лёгкий
// index.ts нужен браузерным/тестовым потребителям; источник подключается
// напрямую из Node-only harness-bootstrap.
export { HarnessBridge, MAX_QUIK_NEWS } from './harness-bridge.js';
export type { HarnessBridgeDeps } from './harness-bridge.js';
export {
  TelegramNotifier,
  MAX_ANOMALIES_IN_REPORT,
} from './telegram-notifier.js';
export { PriceAlertNotifier } from './price-alert-notifier.js';
export type { PriceAlertsProvider } from './price-alert-notifier.js';
export {
  formatDashboardHtml,
  MAX_ANOMALIES_IN_BLOCK,
  MAX_NEWS_IN_BLOCK,
} from './format-dashboard-html.js';
export {
  mountDashboardBlock,
  DASHBOARD_REFRESH_INTERVAL_MS,
  DEFAULT_HARNESS_CONTAINER,
} from './mount-dashboard-block.js';
