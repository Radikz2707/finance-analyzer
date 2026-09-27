/**
 * Adaptive Scheduler Module — гибридный диспетчер нагрузки.
 *
 * Использование:
 *   const scheduler = new AdaptiveScheduler(
 *     () => new PipelineCoordinator(config).run(),
 *     { pollIntervalMs: 60_000 },
 *   );
 *   scheduler.start();
 *   scheduler.onModeChange((e) => dashboard.update(e.to));
 *
 * @module adaptive-scheduler
 */

export * from './types.js';
export {
  AdaptiveScheduler,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_MIN_RUN_INTERVAL_MS,
} from './adaptive-scheduler.js';
