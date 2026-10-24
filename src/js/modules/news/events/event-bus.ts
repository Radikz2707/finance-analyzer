/**
 * Event Bus — real-time event alerts.
 *
 * Event-driven архитектура: событие → триггер → анализ → уведомление.
 */

import { config as newsConfig } from '../news-config.js';

/** Тип рыночного события */
export type MarketEventType =
  | 'NEWS_CRITICAL'    // Критическая новость
  | 'NEWS_HIGH'        // Важная новость
  | 'PRICE_DROP'       // Падение цены
  | 'PRICE_RISE'       // Рост цены
  | 'SENTIMENT_SHIFT'  // Сдвиг сентимента
  | 'DIVIDEND_ANNOUNCE' // Объявление дивидендов
  | 'EARNINGS_RELEASE'  // Выпуск отчётности
  | 'MACRO_EVENT';     // Макро-событие

/** Приоритет события */
export type EventPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** Рыночное событие */
export interface MarketEvent {
  /** Уникальный ID */
  id: string;
  /** Тип события */
  type: MarketEventType;
  /** Приоритет */
  priority: EventPriority;
  /** Тикер (опционально) */
  ticker?: string;
  /** Заголовок */
  title: string;
  /** Описание */
  description: string;
  /** Дата и время */
  timestamp: string;
  /** Метаданные */
  metadata?: Record<string, unknown>;
}

/** Обработчик события */
export type EventHandler = (event: MarketEvent) => Promise<void>;

/** Event Bus */
export class EventBus {
  private listeners: Map<string, EventHandler[]> = new Map();
  private eventLog: MarketEvent[] = [];
  private readonly maxLogSize = 1000;

  /**
   * Подписка на события.
   */
  subscribe(eventType: string, handler: EventHandler): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)!.push(handler);
  }

  /**
   * Отписка от событий.
   */
  unsubscribe(eventType: string, handler: EventHandler): void {
    const handlers = this.listeners.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Публикация события.
   */
  async emit(event: MarketEvent): Promise<void> {
    // Логирование события
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }

    // Обработка по типам
    const handlers = this.listeners.get(event.type) || [];
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`[EventBus] Ошибка обработчика ${event.type}:`, error);
      }
    }

    // Мгновенный алерт для критических событий
    if (event.priority === 'CRITICAL' || event.priority === 'HIGH') {
      await this.handleImmediateAlert(event);
    }
  }

  /**
   * Обработка мгновенного алерта.
   */
  private async handleImmediateAlert(event: MarketEvent): Promise<void> {
    // Проверка anti-spam
    const recentEvents = this.eventLog.filter(
      (e) =>
        e.priority === event.priority &&
        Date.now() - new Date(e.timestamp).getTime() < 60_000,
    );

    if (recentEvents.length > newsConfig.ALERTS_MAX_PER_MINUTE) {
      console.warn(`[EventBus] Anti-spam: слишком много алертов ${event.priority}`);
      return;
    }

    // Отправка алерта
    console.log(`[EventBus] 🚨 ${event.priority} EVENT: ${event.title}`);
    console.log(`   ${event.description}`);

    // TODO: Интеграция с Telegram/email
    // await this.sendAlert(event);
  }

  /**
   * Получение истории событий.
   */
  getEventHistory(limit: number = 50): MarketEvent[] {
    return this.eventLog.slice(-limit);
  }

  /**
   * Очистка истории.
   */
  clearHistory(): void {
    this.eventLog = [];
  }
}
