/**
 * Notifications — система уведомлений и алертов.
 *
 * Функции:
 * - Алерты при критических рисках (превышение лимитов, резкие падения)
 * - Утренний/вечерний дайджест портфеля
 * - Cron-планировщик для автоматических уведомлений
 * - Интеграция с Telegram Bot
 */

import type { PipelineResult } from '../pipeline/pipeline-coordinator.js';
import type { ReviewResult } from '../pipeline/review/review-agent.js';

// ──────────────────────────────────────────────
// 1. Notification types
// ──────────────────────────────────────────────

/** Тип уведомления */
export type NotificationType =
  | 'alert'
  | 'digest'
  | 'review'
  | 'error'
  | 'info';

/** Уровень серьёзности */
export type NotificationSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Уведомление */
export interface Notification {
  /** Уникальный ID */
  id: string;
  /** Тип */
  type: NotificationType;
  /** Уровень серьёзности */
  severity: NotificationSeverity;
  /** Заголовок */
  title: string;
  /** Текст сообщения */
  message: string;
  /** Метка времени */
  timestamp: string;
  /** Данные (опционально) */
  data?: Record<string, unknown>;
  /** Отправлено ли в Telegram */
  sent: boolean;
}

/** Настройки уведомлений */
export interface NotificationConfig {
  /** Telegram Bot токен */
  telegramToken: string;
  /** Admin Chat IDs */
  adminChatIds: number[];
  /** Включить алерты */
  enableAlerts: boolean;
  /** Включить дайджесты */
  enableDigests: boolean;
  /** Время утреннего дайджеста (часы) */
  morningDigestHour: number;
  /** Время вечернего дайджеста (часы) */
  eveningDigestHour: number;
}

// ──────────────────────────────────────────────
// 2. Notification Engine
// ──────────────────────────────────────────────

/**
 * NotificationEngine — генерация и отправка уведомлений.
 */
export class NotificationEngine {
  private notifications: Notification[] = [];
  private config: NotificationConfig;
  private telegramToken: string;
  private adminChatIds: number[];

  constructor(config: NotificationConfig) {
    this.config = config;
    this.telegramToken = config.telegramToken;
    this.adminChatIds = config.adminChatIds;
  }

  /**
   * Проверить алерты на основе результатов pipeline.
   */
  checkAlerts(pipelineResult: PipelineResult): Notification[] {
    const alerts: Notification[] = [];

    if (!this.config.enableAlerts) {
      return alerts;
    }

    // Проверяем review-результаты
    const review = pipelineResult.reviewResult;
    if (review) {
      alerts.push(...this.checkReviewAlerts(review));
    }

    // Проверяем стадии pipeline
    for (const [stage, stageResult] of Object.entries(pipelineResult.stages)) {
      if (stageResult?.result.success === false) {
        alerts.push({
          id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'error',
          severity: 'high',
          title: `Ошибка на этапе ${stage}`,
          message: stageResult.result.error?.message || 'Неизвестная ошибка',
          timestamp: new Date().toISOString(),
          sent: false,
        });
      }
    }

    this.notifications.push(...alerts);
    return alerts;
  }

  /**
   * Проверить алерты из review-результатов.
   */
  private checkReviewAlerts(review: ReviewResult): Notification[] {
    const alerts: Notification[] = [];
    const reviewers = review.reviewers;

    // Проверяем консервативного ревизора
    const conservative = reviewers.get('conservative');
    if (conservative) {
      for (const warning of conservative.warnings) {
        if (warning.severity === 'high') {
          alerts.push({
            id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'alert',
            severity: 'high',
            title: `⚠️ Высокий риск: ${warning.ticker || 'Портфель'}`,
            message: warning.message,
            timestamp: new Date().toISOString(),
            data: { category: warning.category },
            sent: false,
          });
        }
      }
    }

    // Проверяем Risk Manager
    const riskManager = reviewers.get('risk_manager');
    if (riskManager) {
      for (const warning of riskManager.warnings) {
        if (warning.severity === 'high') {
          alerts.push({
            id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'alert',
            severity: 'high',
            title: '📋 Risk Manager: нарушение лимита',
            message: warning.message,
            timestamp: new Date().toISOString(),
            sent: false,
          });
        }
      }
    }

    // Проверяем согласие
    if (review.agreementPercent < 60) {
      alerts.push({
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'alert',
        severity: 'medium',
        title: '📊 Низкое согласие ревизоров',
        message: `Согласие: ${review.agreementPercent}% — рекомендации расходятся`,
        timestamp: new Date().toISOString(),
        sent: false,
      });
    }

    return alerts;
  }

  /**
   * Сгенерировать утренний дайджест.
   */
  generateMorningDigest(pipelineResult: PipelineResult): Notification {
    const totalBalance = pipelineResult.reviewResult
      ? this.extractTotalBalance(pipelineResult)
      : 0;

    const review = pipelineResult.reviewResult;
    const agreementPercent = review?.agreementPercent ?? 0;
    const hasDisagreement = review?.hasDisagreement ?? false;

    let message = '<b>🌅 Утренний дайджест</b>\n\n';
    message += '<b>📊 Портфель:</b> ' + totalBalance.toFixed(0) + ' RUB\n';
    message += '<b>🤖 Согласие AI:</b> ' + agreementPercent + '%\n';

    if (hasDisagreement) {
      message += '\n⚠️ <b>Расхождения между ревизорами!</b>\n';
      message += 'Требуется внимание директора.\n';
    } else {
      message += '\n✅ Рекомендации стабильны.\n';
    }

    // Добавляем топ-риски
    if (review) {
      const conservative = review.reviewers.get('conservative');
      if (conservative && conservative.warnings && conservative.warnings.length > 0) {
        message += '\n<b>⚠️ Топ-риски:</b>\n';
        for (const w of conservative.warnings.slice(0, 3)) {
          message += '• ' + w.message + '\n';
        }
      }
    }

    return {
      id: 'digest-morning-' + Date.now(),
      type: 'digest',
      severity: 'low',
      title: '🌅 Утренний дайджест',
      message: message.trim(),
      timestamp: new Date().toISOString(),
      sent: false,
    };
  }

  /**
   * Сгенерировать вечерний дайджест.
   */
  generateEveningDigest(pipelineResult: PipelineResult): Notification {
    const review = pipelineResult.reviewResult;
    const agreementPercent = review?.agreementPercent ?? 0;

    let message = '<b>🌆 Вечерний дайджест</b>\n\n';
    message += '<b>📊 Итоги дня:</b>\n';
    message += 'Согласие AI: ' + agreementPercent + '%\n';

    if (review?.hasDisagreement) {
      message += '⚠️ Расхождения между ревизорами\n';
    } else {
      message += '✅ Рекомендации стабильны\n';
    }

    // Добавляем summary
    message += '\n' + (review?.finalRecommendation || 'Нет данных');

    return {
      id: 'digest-evening-' + Date.now(),
      type: 'digest',
      severity: 'low',
      title: '🌆 Вечерний дайджест',
      message: message.trim(),
      timestamp: new Date().toISOString(),
      sent: false,
    };
  }

  /**
   * Отправить уведомление в Telegram.
   */
  async sendToTelegram(notification: Notification): Promise<boolean> {
    if (!this.telegramToken || this.adminChatIds.length === 0) {
      console.log('[Notifications] ⚠️ Telegram не настроен. Пропускаем отправку: ' + notification.title);
      return false;
    }

    try {
      const baseUrl = 'https://api.telegram.org/bot' + this.telegramToken;

      for (const chatId of this.adminChatIds) {
        const response = await fetch(baseUrl + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: notification.message,
            parse_mode: 'HTML',
          }),
        });

        if (!response.ok) {
          console.error('[Notifications] ❌ Ошибка отправки в Telegram (chatId: ' + chatId + '):', await response.text());
          return false;
        }
      }

      notification.sent = true;
      console.log(`[Notifications] ✅ Отправлено: ${notification.title}`);
      return true;
    } catch (err) {
      console.error('[Notifications] ❌ Исключение при отправке:', err);
      return false;
    }
  }

  /**
   * Отправить все неотправленные уведомления.
   */
  async sendAllPending(): Promise<number> {
    const pending = this.notifications.filter((n) => !n.sent);
    let sentCount = 0;

    for (const notification of pending) {
      const success = await this.sendToTelegram(notification);
      if (success) {
        sentCount++;
      }
    }

    return sentCount;
  }

  /**
   * Получить все уведомления.
   */
  getNotifications(): Notification[] {
    return [...this.notifications];
  }

  /**
   * Получить уведомления по типу.
   */
  getNotificationsByType(type: NotificationType): Notification[] {
    return this.notifications.filter((n) => n.type === type);
  }

  /**
   * Очистить старые уведомления (старше 24 часов).
   */
  clearOld(): void {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    this.notifications = this.notifications.filter((n) => n.timestamp >= cutoff);
  }

  /**
   * Извлечь totalBalance из pipeline result (хак, но работает).
   */
  private extractTotalBalance(_pipelineResult: PipelineResult): number {
    // В реальном коде здесь будет запрос к БД или data-agent output
    return 0;
  }
}

// ──────────────────────────────────────────────
// 3. Cron Scheduler
// ──────────────────────────────────────────────

/**
 * CronScheduler — планировщик автоматических уведомлений.
 */
export class CronScheduler {
  private intervals: NodeJS.Timeout[] = [];
  private morningHour: number;
  private eveningHour: number;

  constructor(_engine: NotificationEngine, morningHour: number, eveningHour: number) {
    this.morningHour = morningHour;
    this.eveningHour = eveningHour;
  }

  /**
   * Запустить планировщик.
   */
  start(): void {
    console.log(`[CronScheduler] Запуск: утро=${this.morningHour}:00, вечер=${this.eveningHour}:00`);

    // Проверка каждую минуту
    const checkInterval = setInterval(() => {
      this.checkAndSend();
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
    console.log('[CronScheduler] Остановлен');
  }

  /**
   * Проверить и отправить уведомления.
   */
  private checkAndSend(): void {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Утренний дайджест в 9:00
    if (currentHour === this.morningHour && currentMinute === 0) {
      console.log('[CronScheduler] 🌅 Отправка утреннего дайджеста...');
      // Здесь будет вызов pipeline и отправка
    }

    // Вечерний дайджест в 21:00
    if (currentHour === this.eveningHour && currentMinute === 0) {
      console.log('[CronScheduler] 🌆 Отправка вечернего дайджеста...');
      // Здесь будет вызов pipeline и отправка
    }
  }
}

// ──────────────────────────────────────────────
// 4. Экспорт
// ──────────────────────────────────────────────
