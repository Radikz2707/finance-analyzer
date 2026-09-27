/**
 * Resource Monitor Module — мониторинг нагрузки на систему (CPU/RAM).
 *
 * Использование:
 *   const monitor = new ResourceMonitor();
 *   const snap = monitor.sample();
 *   if (snap.isBusy) { ... }
 *
 * @module resource-monitor
 */

export * from './types.js';
export {
  ResourceMonitor,
  NodeResourceSource,
  DEFAULT_THRESHOLDS,
} from './resource-monitor.js';
