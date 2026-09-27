/**
 * Типы модуля Adaptive Scheduler.
 *
 * Гибридный диспетчер нагрузки: пока система свободна — фоном запускает
 * тяжёлый анализ (pipeline); когда система занята (игры и т.п.) — «засыпает»
 * и остаётся только ручной запуск через {@link AdaptiveScheduler.manualRun}.
 */

import type {
  IResourceSource,
  ResourceSnapshot,
  ResourceThresholds,
} from '../resource-monitor/types.js';

/** Режим адаптивного планировщика */
export type AdaptiveSchedulerMode = 'active' | 'sleeping' | 'manual';

/** Конфигурация AdaptiveScheduler */
export interface AdaptiveSchedulerConfig {
  /** Интервал опроса ресурсов, мс (по умолчанию 60 000) */
  pollIntervalMs?: number;
  /** Минимальная пауза между запусками задачи, мс (по умолчанию 300 000) */
  minRunIntervalMs?: number;
  /** Пороги занятости для ResourceMonitor */
  thresholds?: ResourceThresholds;
  /** Источник ресурсов (подменяется в тестах) */
  resourceSource?: IResourceSource;
}

/** Событие перехода между режимами */
export interface AdaptiveSchedulerEvent {
  /** Предыдущий режим */
  from: AdaptiveSchedulerMode;
  /** Новый режим */
  to: AdaptiveSchedulerMode;
  /** Метка времени перехода (ISO 8601) */
  timestamp: string;
  /** Снимок ресурсов, на основе которого принято решение */
  snapshot: ResourceSnapshot;
}

/**
 * Коллбэк запуска тяжёлой задачи.
 *
 * Не зависит от PipelineCoordinator напрямую: в конструктор передаётся
 * любая функция, например:
 *   () => new PipelineCoordinator(config).run()
 */
export type RunTaskCallback = () => Promise<unknown>;
