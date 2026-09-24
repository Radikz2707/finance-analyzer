/**
 * PipelineScheduler — автоматический запуск pipeline по расписанию.
 *
 * Функции:
 * - Утренний запуск анализа (9:00)
 * - Вечерний запуск анализа (21:00)
 * - Интеграция с уведомлениями
 */

import { PipelineCoordinator } from '../pipeline/pipeline-coordinator.js';
import type { PipelineResult } from '../pipeline/pipeline-coordinator.js';
import { NotificationEngine } from '../notifications/notifications.js';
import { exportToCSV } from '../report-export/export.js';

// ──────────────────────────────────────────────
// 1. Types
// ──────────────────────────────────────────────

/** Настройки планировщика */
export interface SchedulerConfig {
  /** Включить планировщик */
  enabled: boolean;
  /** Время утреннего запуска (часы) */
  morningHour: number;
  /** Время вечернего запуска (часы) */
  eveningHour: number;
  /** Конфигурация pipeline */
  pipelineConfig: {
    data: { name: string; verbose: boolean; retries: number };
    research: { name: string; verbose: boolean; retries: number };
    analysis: { name: string; verbose: boolean; retries: number };
    ai: { name: string; verbose: boolean; retries: number };
    review: { name: string; verbose: boolean; retries: number };
    notification: { name: string; verbose: boolean; retries: number };
  };
}

/** Результат запуска */
export interface ScheduledRunResult {
  success: boolean;
  error?: string;
  pipelineResult?: PipelineResult;
  timestamp: string;
}

// ──────────────────────────────────────────────
// 2. Pipeline Scheduler
// ──────────────────────────────────────────────

/**
 * PipelineScheduler — автоматический запуск pipeline.
 */
export class PipelineScheduler {
  private intervals: NodeJS.Timeout[] = [];
  private config: SchedulerConfig;
  private notificationEngine?: NotificationEngine;
  private lastRun: string | null = null;

  constructor(config: SchedulerConfig, notificationEngine?: NotificationEngine) {
    this.config = config;
    this.notificationEngine = notificationEngine;
  }

  /**
   * Запустить планировщик.
   */
  start(): void {
    if (!this.config.enabled) {
      console.log('[Scheduler] Отключён');
      return;
    }

    console.log('[Scheduler] Запуск: утро=' + this.config.morningHour + ':00, вечер=' + this.config.eveningHour + ':00');

    // Проверка каждую минуту
    const checkInterval = setInterval(() => {
      this.checkAndRun();
    }, 60 * 1000);

    this.intervals.push(checkInterval);
  }

  /**
   * Остановить планировщик.
   */
  stop(): void {
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
    console.log('[Scheduler] Остановлен');
  }

  /**
   * Проверить и запустить pipeline.
   */
  private checkAndRun(): void {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Проверяем, не запускался ли уже сегодня
    const today = now.toISOString().split('T')[0];
    if (this.lastRun === today) {
      return;
    }

    // Утренний запуск
    if (currentHour === this.config.morningHour && currentMinute === 0) {
      console.log('[Scheduler] 🌅 Запуск утреннего анализа...');
      this.runPipeline('morning');
    }

    // Вечерний запуск
    if (currentHour === this.config.eveningHour && currentMinute === 0) {
      console.log('[Scheduler] 🌆 Запуск вечернего анализа...');
      this.runPipeline('evening');
    }
  }

  /**
   * Запустить pipeline.
   */
  private async runPipeline(period: 'morning' | 'evening'): Promise<void> {
    try {
      const result = await this.executePipeline();

      if (result.success) {
        this.lastRun = new Date().toISOString().split('T')[0];
        console.log('[Scheduler] ✅ Анализ завершён успешно');

        // Отправляем уведомление
        if (this.notificationEngine && result.pipelineResult) {
          const digest = period === 'morning'
            ? this.notificationEngine.generateMorningDigest(result.pipelineResult)
            : this.notificationEngine.generateEveningDigest(result.pipelineResult);

          await this.notificationEngine.sendToTelegram(digest);
        }
      } else {
        console.error('[Scheduler] ❌ Ошибка анализа:', result.error);
      }
    } catch (err) {
      console.error('[Scheduler] ❌ Исключение:', err);
    }
  }

  /**
   * Выполнить pipeline.
   */
  private async executePipeline(): Promise<ScheduledRunResult> {
    const coordinator = new PipelineCoordinator(this.config.pipelineConfig);
    const result = await coordinator.run();

    // Экспорт в CSV
    if (result.success) {
      try {
        await exportToCSV(result);
        console.log('[Scheduler] 📊 Экспорт в CSV выполнен');
      } catch (err) {
        console.warn('[Scheduler] ⚠️ Ошибка экспорта в CSV:', err);
      }
    }

    return {
      success: result.success,
      error: result.error?.message,
      pipelineResult: result,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Запустить pipeline вручную.
   */
  async runNow(): Promise<ScheduledRunResult> {
    return this.executePipeline();
  }
}

// ──────────────────────────────────────────────
// 3. Экспорт
// ──────────────────────────────────────────────
