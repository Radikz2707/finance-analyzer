/**
 * Pipeline Scheduler — планировщик запуска конвейера по cron-расписанию.
 */

import { PipelineCoordinator } from '../pipeline-coordinator.js';

export interface PipelineSchedule {
  name: string;
  cron: string;
  enabled: boolean;
}

export interface PipelineSchedulerOptions {
  pollIntervalMs?: number;
}

/**
 * Простой polling-планировщик для запуска pipeline по расписанию.
 * Использует простую проверку cron-выражений без внешних зависимостей.
 */
export class PipelineScheduler {
  private coordinatorFactory: () => PipelineCoordinator;
  private schedules: PipelineSchedule[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastRunBySchedule: Map<string, number> = new Map();
  private pollIntervalMs: number;

  constructor(
    coordinatorFactory: () => PipelineCoordinator,
    options: PipelineSchedulerOptions = {},
  ) {
    this.coordinatorFactory = coordinatorFactory;
    this.pollIntervalMs = options.pollIntervalMs ?? 60_000;
  }

  /** Добавить расписание */
  addSchedule(schedule: PipelineSchedule): void {
    this.schedules.push(schedule);
  }

  /** Получить все расписания */
  getSchedules(): PipelineSchedule[] {
    return [...this.schedules];
  }

  /** Запустить polling */
  start(): void {
    if (this.pollTimer) {
      console.warn('[Scheduler] Already running');
      return;
    }

    console.log(`[Scheduler] Polling interval: ${this.pollIntervalMs / 1000}s`);

    this.pollTimer = setInterval(() => {
      this.checkSchedules();
    }, this.pollIntervalMs);
  }

  /** Остановить polling */
  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Проверить все расписания и запустить pipeline если пора */
  private async checkSchedules(): Promise<void> {
    const now = Date.now();

    for (const schedule of this.schedules) {
      if (!schedule.enabled) continue;

      const lastRun = this.lastRunBySchedule.get(schedule.name) ?? 0;
      const timeSinceLastRun = now - lastRun;

      // Простая логика: если прошло достаточно времени, запускаем
      // В продакшене здесь будет полноценный cron-парсер
      if (this.shouldRun(schedule, timeSinceLastRun)) {
        console.log(`\n[Scheduler] Запуск: ${schedule.name} (${schedule.cron})`);

        try {
          const coordinator = this.coordinatorFactory();
          await coordinator.run();
          this.lastRunBySchedule.set(schedule.name, now);
          console.log(`[Scheduler] ${schedule.name} завершён успешно`);
        } catch (error) {
          console.error(`[Scheduler] Ошибка в ${schedule.name}:`, error);
        }
      }
    }
  }

  /** Определить, нужно ли запускать pipeline */
  private shouldRun(schedule: PipelineSchedule, timeSinceLastRun: number): boolean {
    // По умолчанию: запускать если прошло больше pollIntervalMs
    if (timeSinceLastRun < this.pollIntervalMs) {
      return false;
    }

    // Для ежедневных расписаний (0 9 * * 1-5, 0 10 * * 0)
    if (schedule.cron.includes('* *') && schedule.cron.split(' ').length === 5) {
      // Проверка по часам/минутам из cron
      const parts = schedule.cron.split(' ');
      const minutes = parts[1];
      const hours = parts[0];

      if (minutes == null || hours == null) return false;

      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      // Простая проверка: если время совпадает с cron-выражением
      if (this.matchesCronValue(currentMinute, minutes) &&
          this.matchesCronValue(currentHour, hours)) {
        return true;
      }
    }

    return false;
  }

  /** Проверить совпадение значения с cron-выражением */
  private matchesCronValue(value: number, cronExpr: string): boolean {
    if (cronExpr === '*') return true;
    if (cronExpr.includes('/')) {
      const parts = cronExpr.split('/').map(Number);
      const start = parts[0];
      const step = parts[1];
      if (start == null || step == null) return false;
      return value >= start && (value - start) % step === 0;
    }
    if (cronExpr.includes('-')) {
      const parts = cronExpr.split('-').map(Number);
      const from = parts[0];
      const to = parts[1];
      if (from == null || to == null) return false;
      return value >= from && value <= to;
    }
    return value === parseInt(cronExpr, 10);
  }
}
