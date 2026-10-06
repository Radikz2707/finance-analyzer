import { PipelineCoordinator } from './pipeline-coordinator.js';
import { savePortfolioKpi } from './ai-memory/kpi-sink.js';
import { aiMemoryImpl } from './ai-memory/index.js';
import type { AgentConfig } from './agent/types.js';
import { matchesCron, nextCronRun } from './cron-utils.js';

/** Обёртка для KPI sink: aiMemoryImpl + PipelineResult */
const kpiSink = async (
  result: import('./pipeline-coordinator.js').PipelineResult,
): Promise<void> => {
  try {
    await savePortfolioKpi(aiMemoryImpl, result);
  } catch {
    // silently ignore — KPI не критичен для pipeline
  }
};

// Cron-утилиты вынесены в лёгкий модуль cron-utils.ts (без зависимостей),
// чтобы их можно было переиспользовать (SchedulerAgent) без импорта тяжёлого
// графа PipelineCoordinator → ai-memory/SQLite. Публичный API модуля сохранён
// (обратная совместимость для pipeline/index.ts).
export {
  parseCron,
  matchesCron,
  nextCronRun,
  type CronFields,
} from './cron-utils.js';

// ──────────────────────────────────────────────
// 1. Schedule entry
// ──────────────────────────────────────────────

/** Запись расписания */
export interface ScheduleEntry {
  /** Уникальный ID записи */
  id: string;
  /** Название расписания */
  name: string;
  /** Cron-выражение (минута час день_месяца месяц день_недели) */
  cron: string;
  /** Флаг активен */
  enabled: boolean;
  /** Конфигурация агентов для этого запуска */
  agentConfig?: AgentConfig;
  /** Метка времени последнего запуска */
  lastRunAt?: string;
  /** Метка времени следующего запуска */
  nextRunAt?: string;
}

// ──────────────────────────────────────────────
// 2. Pipeline Scheduler
// ──────────────────────────────────────────────

/**
 * PipelineScheduler — управление расписанием запуска конвейера.
 *
 * Возможности:
 * - Добавление/удаление расписаний
 * - Автоматический запуск по cron
 * - Ручной запуск
 * - Логирование запусков
 */
export class PipelineScheduler {
  private schedules: Map<string, ScheduleEntry> = new Map();
  private timerId: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;

  constructor(
    _coordinatorFactory: () => PipelineCoordinator,
    options?: {
      /** Интервал проверки cron (мс). По умолчанию 60 секунд */
      pollIntervalMs?: number;
    },
  ) {
    this.pollIntervalMs = options?.pollIntervalMs ?? 60_000;
  }

  /**
   * Добавить расписание.
   */
  addSchedule(entry: Omit<ScheduleEntry, 'id'>): string {
    const id = `schedule-${crypto.randomUUID().slice(0, 8)}`;
    const schedule: ScheduleEntry = {
      ...entry,
      id,
      enabled: true,
    };
    this.schedules.set(id, schedule);

    console.log(
      `[Scheduler] Schedule added: ${schedule.name} (${schedule.cron}) [${id}]`,
    );

    return id;
  }

  /**
   * Удалить расписание.
   */
  removeSchedule(id: string): boolean {
    const removed = this.schedules.delete(id);
    if (removed) {
      console.log(`[Scheduler] Schedule removed: ${id}`);
    }
    return removed;
  }

  /**
   * Получить все расписания.
   */
  getSchedules(): ScheduleEntry[] {
    return Array.from(this.schedules.values());
  }

  /**
   * Включить/выключить расписание.
   */
  setScheduleEnabled(id: string, enabled: boolean): boolean {
    const schedule = this.schedules.get(id);
    if (!schedule) return false;
    schedule.enabled = enabled;
    console.log(
      `[Scheduler] Schedule ${id} ${enabled ? 'enabled' : 'disabled'}`,
    );
    return true;
  }

  /**
   * Запустить конвейер вручную.
   */
  async runNow(): Promise<void> {
    console.log('[Scheduler] Manual run triggered');
    await this.executePipeline();
  }

  /**
   * Запустить планировщик (начать polling).
   */
  start(): void {
    if (this.timerId !== null) {
      console.warn('[Scheduler] Scheduler already running');
      return;
    }

    console.log('[Scheduler] Starting scheduler...');

    this.timerId = setInterval(async () => {
      await this.checkSchedules();
    }, this.pollIntervalMs);

    // Первая проверка сразу
    void this.checkSchedules();
  }

  /**
   * Остановить планировщик.
   */
  async stop(): Promise<void> {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
      console.log('[Scheduler] Scheduler stopped');
    }
  }

  // ── Helpers ──

  private async checkSchedules(): Promise<void> {
    const now = new Date();

    for (const schedule of this.schedules.values()) {
      if (!schedule.enabled) continue;

      try {
        if (matchesCron(schedule.cron, now)) {
          console.log(
            `[Scheduler] Triggering schedule: ${schedule.name} (${schedule.cron})`,
          );
          schedule.lastRunAt = now.toISOString();

          // Вычисляем следующий запуск
          const nextRun = nextCronRun(schedule.cron, now);
          schedule.nextRunAt = nextRun.toISOString();

          // Запускаем конвейер в фоне (не блокируем polling)
          void this.executePipelineWithSchedule(schedule);
        }
      } catch (err) {
        console.error(
          `[Scheduler] Error checking schedule ${schedule.id}:`,
          err,
        );
      }
    }
  }

  private async executePipeline(): Promise<void> {
    try {
      const coordinator = new PipelineCoordinator({}, { memorySink: kpiSink });
      const result = await coordinator.run();

      if (result.success) {
        console.log(
          `[Scheduler] Pipeline completed successfully in ${result.totalDurationMs}ms`,
        );
      } else {
        console.error(`[Scheduler] Pipeline failed: ${result.error?.message}`);
      }
    } catch (err) {
      console.error('[Scheduler] Pipeline execution error:', err);
    }
  }

  private async executePipelineWithSchedule(
    schedule: ScheduleEntry,
  ): Promise<void> {
    try {
      const coordinator = new PipelineCoordinator(
        {
          data: schedule.agentConfig,
          research: schedule.agentConfig,
          analysis: schedule.agentConfig,
          ai: schedule.agentConfig,
          notification: schedule.agentConfig,
        },
        { memorySink: kpiSink },
      );
      const result = await coordinator.run();

      if (result.success) {
        console.log(
          `[Scheduler] Pipeline (${schedule.name}) completed in ${result.totalDurationMs}ms`,
        );
      } else {
        console.error(
          `[Scheduler] Pipeline (${schedule.name}) failed: ${result.error?.message}`,
        );
      }
    } catch (err) {
      console.error(`[Scheduler] Pipeline (${schedule.name}) error:`, err);
    }
  }
}
