/**
 * ActivityStream — EventEmitter-стрим активности агентов.
 *
 * - `emit(event)` — публикует событие (генерирует id/timestamp), сохраняет
 *   в буфер последних N событий и уведомляет подписчиков;
 * - `subscribe(fn)` / `unsubscribe(fn)` — управление подпиской;
 * - `getRecent(count?)` — буфер последних событий (для восстановления UI).
 *
 * Подписчик — наблюдатель: его ошибка не роняет стрим (аналогично
 * DirectorAuditLog.onEvent).
 */

import type { AgentActivityEvent, ActivitySubscriber } from './types.js';

/** Опции стрима (DI для детерминированных тестов) */
export interface ActivityStreamOptions {
  /** Максимум событий в буфере (по умолчанию 200) */
  maxBuffer?: number;
  /** Источник времени, мс (по умолчанию Date.now) */
  now?: () => number;
  /** Фабрика ID событий (по умолчанию — счётчик + случайный суффикс) */
  idFactory?: () => string;
}

/** ID по умолчанию: монотонный счётчик + случайный суффикс */
function defaultIdFactory(): string {
  return `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Стрим активности агентов (in-memory, с ограничением буфера) */
export class ActivityStream {
  private readonly listeners = new Set<ActivitySubscriber>();
  private readonly buffer: AgentActivityEvent[] = [];
  private readonly maxBuffer: number;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(options?: ActivityStreamOptions) {
    this.maxBuffer = Math.max(1, options?.maxBuffer ?? 200);
    this.now = options?.now ?? Date.now;
    this.idFactory = options?.idFactory ?? defaultIdFactory;
  }

  /**
   * Опубликовать событие активности.
   * id и timestamp генерируются автоматически; подписчики уведомляются
   * ПОСЛЕ сохранения в буфер (порядок доставки = порядок emit).
   *
   * @returns полное событие (с id/timestamp)
   */
  emit(
    event: Omit<AgentActivityEvent, 'id' | 'timestamp'>,
  ): AgentActivityEvent {
    const full: AgentActivityEvent = {
      ...event,
      id: this.idFactory(),
      timestamp: new Date(this.now()).toISOString(),
    };
    this.buffer.push(full);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.splice(0, this.buffer.length - this.maxBuffer);
    }
    for (const listener of this.listeners) {
      try {
        listener(full);
      } catch {
        // Слушатель — наблюдатель: его сбой не должен ломать стрим.
      }
    }
    return full;
  }

  /**
   * Подписаться на поток активности.
   * @returns функция отписки (повторная отписка — безопасный no-op).
   */
  subscribe(fn: ActivitySubscriber): () => void {
    this.listeners.add(fn);
    return () => this.unsubscribe(fn);
  }

  /** Отписаться от потока активности (no-op, если не был подписан) */
  unsubscribe(fn: ActivitySubscriber): void {
    this.listeners.delete(fn);
  }

  /** Последние N событий (по умолчанию — весь буфер) */
  getRecent(count?: number): AgentActivityEvent[] {
    const n = Math.max(1, count ?? this.buffer.length);
    return this.buffer.slice(-n);
  }

  /** Очистить буфер (подписчики остаются) */
  clear(): void {
    this.buffer.length = 0;
  }
}
