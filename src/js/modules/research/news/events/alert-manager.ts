/**
 * Alert Manager — управление алертами и уведомлениями.
 *
 * Отправляет алерты через настроенные каналы (Telegram, UI, Log).
 * Для Telegram-отправки использует внешний отправитель (TelegramSender),
 * чтобы не дублировать логику NotificationEngine.
 */

import { config as newsConfig } from '../news-config.js';
import type { MarketEvent, EventPriority } from './event-bus.js';

/** Канал уведомлений */
export type AlertChannel = (typeof newsConfig.ALERTS_CHANNELS)[number];

/** Интерфейс отправителя в Telegram (инъекция зависимости) */
export interface TelegramSender {
  (message: string, title?: string): Promise<boolean>;
}

/** Конфигурация алерта */
export interface AlertConfig {
  /** Включены ли алерты */
  enabled: boolean;
  /** Каналы отправки */
  channels: AlertChannel[];
  /** Минимальный приоритет для отправки */
  minPriority: EventPriority;
  /** Отправитель в Telegram (необязательно) */
  telegramSender?: TelegramSender;
}

/** Alert Manager */
export class AlertManager {
  private config: AlertConfig;
  private lastAlertTime: Map<string, number> = new Map();

  constructor(config?: Partial<AlertConfig>) {
    this.config = {
      enabled: newsConfig.REALTIME_ALERTS_ENABLED,
      channels: ['telegram', 'ui', 'log'] as const,
      minPriority: 'HIGH' as EventPriority,
      ...config,
    };
  }

  /**
   * Создать AlertManager с готовым Telegram-отправителем
   * из NotificationEngine.
   */
  static withTelegramSender(
    telegramSender: TelegramSender,
    config?: Partial<AlertConfig>,
  ): AlertManager {
    return new AlertManager({ ...config, telegramSender });
  }

  /**
   * Отправка алерта.
   */
  async sendAlert(event: MarketEvent): Promise<void> {
    if (!this.config.enabled) return;

    // Проверка приоритета
    if (!this.isPriorityHighEnough(event.priority)) return;

    // Проверка anti-spam
    if (this.isSpam(event.id)) return;

    // Отправка через настроенные каналы
    for (const channel of this.config.channels) {
      try {
        switch (channel) {
          case 'telegram':
            await this.sendToTelegram(event);
            break;
          case 'ui':
            this.sendToUi(event);
            break;
          case 'log':
            this.sendToLog(event);
            break;
        }
      } catch (error) {
        console.error(`[AlertManager] Ошибка отправки через ${channel}:`, error);
      }
    }

    // Обновление lastAlertTime
    this.lastAlertTime.set(event.id, Date.now());
  }

  /**
   * Проверка приоритета.
   */
  private isPriorityHighEnough(priority: EventPriority): boolean {
    const priorityLevels: Record<EventPriority, number> = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    return (
      priorityLevels[priority] >= priorityLevels[this.config.minPriority]
    );
  }

  /**
   * Проверка anti-spam.
   */
  private isSpam(eventId: string): boolean {
    const lastTime = this.lastAlertTime.get(eventId);
    if (!lastTime) return false;

    const timeSinceLastAlert = Date.now() - lastTime;
    return timeSinceLastAlert < 60_000; // 1 минута
  }

  /**
    * Отправка в Telegram через инъектированный отправитель.
    * Если отправитель не настроен — логирование без отправки.
    */
   private async sendToTelegram(event: MarketEvent): Promise<void> {
     const message = `🔔 ${event.title}\n${event.description}`;
     if (this.config.telegramSender) {
       const ok = await this.config.telegramSender(message, event.title);
       if (!ok) {
         console.error('[AlertManager] Не удалось отправить в Telegram');
       }
     } else {
       console.log('[AlertManager] Telegram-отправитель не настроен, пропуск: ' + event.title);
     }
   }

  /**
   * Отправка в UI.
   */
  private sendToUi(event: MarketEvent): void {
    // Отправка в браузер через window.postMessage
    if (typeof window !== 'undefined') {
      window.postMessage(
        {
          type: 'NEWS_ALERT',
          event: {
            id: event.id,
            title: event.title,
            description: event.description,
            priority: event.priority,
            timestamp: event.timestamp,
          },
        },
        '*',
      );
    }
  }

  /**
   * Отправка в лог.
   */
  private sendToLog(event: MarketEvent): void {
    const icon = this.getPriorityIcon(event.priority);
    console.log(`[AlertManager] ${icon} ${event.title}: ${event.description}`);
  }

  /**
   * Получение иконки по приоритету.
   */
  private getPriorityIcon(priority: EventPriority): string {
    switch (priority) {
      case 'CRITICAL':
        return '🔴';
      case 'HIGH':
        return '🟠';
      case 'MEDIUM':
        return '🟡';
      case 'LOW':
        return '🟢';
    }
  }

  /**
   * Обновление конфигурации.
   */
  updateConfig(config: Partial<AlertConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
