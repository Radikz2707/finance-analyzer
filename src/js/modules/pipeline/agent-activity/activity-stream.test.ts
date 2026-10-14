/**
 * ActivityStream — тесты EventEmitter-стрима активности агентов.
 *
 * Покрытие:
 * - emit генерирует id/timestamp и уведомляет подписчиков;
 * - subscribe/unsubscribe (включая отписку через возвращённую функцию);
 * - буфер последних N событий (getRecent, обрезка по maxBuffer);
 * - ошибка подписчика не роняет стрим;
 * - clear() очищает буфер, но не подписчиков.
 *
 * ВАЖНО: импорт { describe, it, expect } из 'vitest' НЕ используется —
 * он создаёт второй экземпляр @vitest/runner и ломает контекст тестов.
 * Все тесты используют глобалы (globals: true).
 */

import { ActivityStream } from './activity-stream.js';
import type { AgentActivityEvent } from './types.js';

/** Событие для emit (без id/timestamp — генерируются стримом) */
function makeEvent(
  overrides: Partial<Omit<AgentActivityEvent, 'id' | 'timestamp'>> = {},
): Omit<AgentActivityEvent, 'id' | 'timestamp'> {
  return {
    taskId: 'task-1',
    role: 'research',
    phase: 'started',
    message: 'стартовал',
    ...overrides,
  };
}

describe('ActivityStream', () => {
  it('1. emit генерирует id/timestamp и уведомляет подписчиков', () => {
    const stream = new ActivityStream({
      now: () => 1_700_000_000_000,
      idFactory: () => 'act-test-1',
    });
    const received: AgentActivityEvent[] = [];
    stream.subscribe((event) => received.push(event));

    const full = stream.emit(makeEvent({ message: 'собираю факты' }));

    expect(full.id).toBe('act-test-1');
    expect(full.timestamp).toBe('2023-11-14T22:13:20.000Z');
    expect(full.role).toBe('research');
    expect(full.phase).toBe('started');
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(full);
  });

  it('2. subscribe возвращает функцию отписки; unsubscribe — no-op', () => {
    const stream = new ActivityStream();
    const received: AgentActivityEvent[] = [];
    const unsubscribe = stream.subscribe((event) => received.push(event));

    stream.emit(makeEvent());
    expect(received).toHaveLength(1);

    unsubscribe();
    stream.emit(makeEvent());
    expect(received).toHaveLength(1);

    // Повторная отписка — безопасный no-op
    unsubscribe();
    stream.emit(makeEvent());
    expect(received).toHaveLength(1);
  });

  it('3. unsubscribe удаляет конкретного подписчика', () => {
    const stream = new ActivityStream();
    const first: AgentActivityEvent[] = [];
    const second: AgentActivityEvent[] = [];
    stream.subscribe((event) => first.push(event));
    const secondSub = (event: AgentActivityEvent): void => {
      second.push(event);
    };
    stream.subscribe(secondSub);

    stream.emit(makeEvent());
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);

    stream.unsubscribe(secondSub);
    stream.emit(makeEvent());
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(1);
  });

  it('4. буфер хранит последние N событий (getRecent + обрезка)', () => {
    const stream = new ActivityStream({ maxBuffer: 3 });
    for (let i = 1; i <= 5; i++) {
      stream.emit(makeEvent({ message: `шаг ${i}` }));
    }

    const recent = stream.getRecent();
    expect(recent).toHaveLength(3);
    expect(recent.map((e) => e.message)).toEqual(['шаг 3', 'шаг 4', 'шаг 5']);

    // getRecent(count) возвращает последние count событий
    const lastTwo = stream.getRecent(2);
    expect(lastTwo.map((e) => e.message)).toEqual(['шаг 4', 'шаг 5']);
  });

  it('5. ошибка подписчика не роняет стрим', () => {
    const stream = new ActivityStream();
    const received: AgentActivityEvent[] = [];
    stream.subscribe(() => {
      throw new Error('сбой наблюдателя');
    });
    stream.subscribe((event) => received.push(event));

    const full = stream.emit(makeEvent());
    expect(full.id).toBeTruthy();
    expect(received).toHaveLength(1);
  });

  it('6. clear() очищает буфер, но не подписчиков', () => {
    const stream = new ActivityStream();
    const received: AgentActivityEvent[] = [];
    stream.subscribe((event) => received.push(event));

    stream.emit(makeEvent());
    expect(stream.getRecent()).toHaveLength(1);

    stream.clear();
    expect(stream.getRecent()).toHaveLength(0);

    stream.emit(makeEvent());
    expect(received).toHaveLength(2);
    expect(stream.getRecent()).toHaveLength(1);
  });
});
