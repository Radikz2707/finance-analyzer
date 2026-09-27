/**
 * AdaptiveScheduler — гибридный диспетчер нагрузки.
 *
 * Режимы:
 * - 'active'   — система свободна, фоновая задача запускается автоматически;
 * - 'sleeping' — система занята (CPU/RAM выше порога), фоновый запуск
 *                пропускается (циклы «сна») с логированием;
 * - 'manual'   — автозапуск выключен (до start() / после stop()),
 *                доступен только ручной запуск manualRun().
 *
 * Жёсткой зависимости от PipelineCoordinator нет: коллбэк задачи передаётся
 * в конструктор, например:
 *   const scheduler = new AdaptiveScheduler(
 *     () => new PipelineCoordinator(config).run(),
 *     { pollIntervalMs: 60_000 },
 *   );
 */

import { getLogger } from '../logger/logger.js';
import { ResourceMonitor } from '../resource-monitor/resource-monitor.js';
import type { ResourceSnapshot } from '../resource-monitor/types.js';
import type {
  AdaptiveSchedulerConfig,
  AdaptiveSchedulerEvent,
  AdaptiveSchedulerMode,
  RunTaskCallback,
} from './types.js';

/** Логгер модуля */
const log = getLogger('adaptive-scheduler');

/** Интервал опроса ресурсов по умолчанию: 60 с */
export const DEFAULT_POLL_INTERVAL_MS = 60_000;

/** Минимальная пауза между запусками задачи по умолчанию: 5 мин */
export const DEFAULT_MIN_RUN_INTERVAL_MS = 300_000;

export class AdaptiveScheduler {
  private readonly monitor: ResourceMonitor;
  private readonly callback: RunTaskCallback;
  private readonly pollIntervalMs: number;
  private readonly minRunIntervalMs: number;

  private mode: AdaptiveSchedulerMode = 'manual';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private skippedCycles = 0;
  private lastRunAtMs: number | null = null;
  private lastSnapshot: ResourceSnapshot | null = null;
  private readonly listeners = new Set<
    (event: AdaptiveSchedulerEvent) => void
  >();

  constructor(callback: RunTaskCallback, config: AdaptiveSchedulerConfig = {}) {
    this.callback = callback;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.minRunIntervalMs =
      config.minRunIntervalMs ?? DEFAULT_MIN_RUN_INTERVAL_MS;
    this.monitor = new ResourceMonitor(
      config.resourceSource,
      config.thresholds,
    );
  }

  /**
   * Запустить фоновое наблюдение за нагрузкой.
   * Первый цикл опроса выполняется сразу; режим становится
   * 'active' или 'sleeping' по результатам первого снимка.
   */
  start(): void {
    if (this.pollTimer !== null) {
      // Повторный start() не создаёт второй интервал
      return;
    }

    // Включаем автозапуск: тихо выходим из 'manual' (без события).
    // Первый же снимок в checkResources() определит реальный режим:
    // 'active' (система свободна) или 'sleeping' (система занята).
    if (this.mode === 'manual') {
      this.mode = 'sleeping';
    }

    this.checkResources();
    this.pollTimer = setInterval(() => {
      this.checkResources();
    }, this.pollIntervalMs);

    log.info(`Наблюдение запущено (интервал ${this.pollIntervalMs} мс)`);
  }

  /**
   * Остановить наблюдение: таймер очищается, режим → 'manual'.
   */
  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.switchMode('manual', this.lastSnapshot);
    log.info('Наблюдение остановлено');
  }

  /**
   * Один цикл опроса: снять снимок ресурсов и решить, запускать ли задачу.
   *
   * Публичный метод — удобен для тестов и внешних триггеров.
   */
  checkResources(): ResourceSnapshot {
    const snapshot = this.monitor.sample();
    this.lastSnapshot = snapshot;

    // Ручной режим или задача ещё выполняется — автозапуск недоступен
    if (this.mode === 'manual' || this.running) {
      return snapshot;
    }

    if (snapshot.isBusy) {
      // Система занята: пропускаем цикл («сон»)
      this.skippedCycles += 1;
      this.switchMode('sleeping', snapshot);
      return snapshot;
    }

    // Система свободна: режим активен, но запуск ограничен интервалом
    this.skippedCycles = 0;
    this.switchMode('active', snapshot);

    if (
      this.lastRunAtMs !== null &&
      Date.now() - this.lastRunAtMs < this.minRunIntervalMs
    ) {
      return snapshot;
    }

    void this.runTask();
    return snapshot;
  }

  /**
   * Ручной запуск задачи в любом режиме (кнопка дашборда).
   * Обновляет метку последнего запуска, чтобы фоновый цикл не
   * дублировал работу в пределах minRunIntervalMs.
   */
  async manualRun(): Promise<void> {
    await this.runTask();
  }

  /**
   * Подписка на переходы режимов.
   * Возвращает функцию отписки.
   */
  onModeChange(listener: (event: AdaptiveSchedulerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Текущий режим */
  getMode(): AdaptiveSchedulerMode {
    return this.mode;
  }

  /** Последний снятый снимок (null до первого опроса) */
  getLastSnapshot(): ResourceSnapshot | null {
    return this.lastSnapshot;
  }

  /** Количество пропущенных циклов «сна» */
  getSkippedCycles(): number {
    return this.skippedCycles;
  }

  /** Выполняется ли задача прямо сейчас */
  isRunning(): boolean {
    return this.running;
  }

  private async runTask(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.lastRunAtMs = Date.now();
    try {
      await this.callback();
    } catch (err) {
      log.error('Ошибка фоновой задачи:', err);
    } finally {
      this.running = false;
    }
  }

  private switchMode(
    to: AdaptiveSchedulerMode,
    snapshot: ResourceSnapshot | null,
  ): void {
    if (this.mode === to) {
      return;
    }

    const from = this.mode;
    this.mode = to;

    const finalSnapshot: ResourceSnapshot = snapshot ??
      this.lastSnapshot ?? {
        cpuUsagePct: 0,
        memoryUsedMb: 0,
        memoryTotalMb: 0,
        memoryUsagePct: 0,
        isBusy: false,
        timestamp: new Date().toISOString(),
      };

    const event: AdaptiveSchedulerEvent = {
      from,
      to,
      timestamp: finalSnapshot.timestamp,
      snapshot: finalSnapshot,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        log.warn('Ошибка слушателя событий:', err);
      }
    }

    log.info(`Режим: ${from} → ${to}`);
  }
}
