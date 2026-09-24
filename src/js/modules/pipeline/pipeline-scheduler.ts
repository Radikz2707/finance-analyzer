import { PipelineCoordinator } from './pipeline-coordinator.js';
import type { AgentConfig } from './agent/types.js';

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
// 2. Cron parser (простой, без зависимостей)
// ──────────────────────────────────────────────

/**
 * Простой парсер cron-выражений.
 * Поддерживает:
 *   - Фиксированные значения: 0, 15, 30
 *   - Звёздочка: * (любое значение)
 *   - Списки: 0,15,30,45
 *   - Диапазоны: 1-5
 *
 * Формат: "минута час день_месяца месяц день_недели"
 * Пример: "0 9 * * 1-5" — каждый будний день в 9:00
 */
export interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

export function parseCron(cron: string): CronFields {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression: "${cron}". Expected 5 fields.`,
    );
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

function parseField(
  field: string,
  min: number,
  max: number,
): number[] {
  if (field === '*') {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  const values = new Set<number>();

  for (const part of field.split(',')) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start > end) {
        throw new Error(`Invalid range: ${part}`);
      }
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    } else {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < min || num > max) {
        throw new Error(`Invalid value: ${part} (expected ${min}-${max})`);
      }
      values.add(num);
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

/**
 * Проверить, совпадает ли текущее время с cron-выражением.
 */
export function matchesCron(
  cron: string,
  date: Date = new Date(),
): boolean {
  const fields = parseCron(cron);
  return (
    fields.minute.includes(date.getMinutes()) &&
    fields.hour.includes(date.getHours()) &&
    fields.dayOfMonth.includes(date.getDate()) &&
    fields.month.includes(date.getMonth() + 1) &&
    fields.dayOfWeek.includes(date.getDay())
  );
}

/**
 * Вычислить следующее время запуска по cron-выражению.
 */
export function nextCronRun(cron: string, from: Date = new Date()): Date {
  const fields = parseCron(cron);

  // Начинаем с следующей минуты
  const next = new Date(from);
  next.setMinutes(next.getMinutes() + 1, 0, 0);

  // Ищем ближайшее совпадение (максимум ~525600 минут = 1 год)
  for (let i = 0; i < 525600; i++) {
    if (
      fields.minute.includes(next.getMinutes()) &&
      fields.hour.includes(next.getHours()) &&
      fields.dayOfMonth.includes(next.getDate()) &&
      fields.month.includes(next.getMonth() + 1) &&
      fields.dayOfWeek.includes(next.getDay())
    ) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  throw new Error(`Cannot find next run for cron: ${cron}`);
}

// ──────────────────────────────────────────────
// 3. Pipeline Scheduler
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
    console.log(`[Scheduler] Schedule ${id} ${enabled ? 'enabled' : 'disabled'}`);
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
      const coordinator = new PipelineCoordinator();
      const result = await coordinator.run();

      if (result.success) {
        console.log(
          `[Scheduler] Pipeline completed successfully in ${result.totalDurationMs}ms`,
        );
      } else {
        console.error(
          `[Scheduler] Pipeline failed: ${result.error?.message}`,
        );
      }
    } catch (err) {
      console.error('[Scheduler] Pipeline execution error:', err);
    }
  }

  private async executePipelineWithSchedule(
    schedule: ScheduleEntry,
  ): Promise<void> {
    try {
      const coordinator = new PipelineCoordinator({
        data: schedule.agentConfig,
        research: schedule.agentConfig,
        analysis: schedule.agentConfig,
        ai: schedule.agentConfig,
        notification: schedule.agentConfig,
      });
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
      console.error(
        `[Scheduler] Pipeline (${schedule.name}) error:`,
        err,
      );
    }
  }
}
