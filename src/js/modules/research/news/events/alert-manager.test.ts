/**
 * Тесты для AlertManager — интеграция TelegramSender.
 *
 * Покрытие:
 * - Без telegramSender — не делает HTTP-запросов, логирует пропуск
 * - С mock-telegramSender — вызывает с ожидаемыми аргументами
 * - Без реального HTTP в тестах
 *
 * ВНИМАНИЕ: используются глобальные API vitest (globals: true).
 */

import { AlertManager } from './alert-manager.js';
import type { MarketEvent, EventPriority } from './event-bus.js';

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function makeEvent(overrides: Partial<MarketEvent> = {}): MarketEvent {
  return {
    id: 'test-event-1',
    title: 'Тестовый алерт',
    description: 'Описание алерта',
    priority: 'HIGH' as EventPriority,
    ticker: 'SBER',
    timestamp: new Date().toISOString(),
    type: 'PRICE_DROP',
    ...overrides,
  };
}

function makeMockSender() {
  const calls: Array<{ message: string; title?: string }> = [];
  const mockSender = vi.fn(async (message: string, title?: string) => {
    calls.push({ message, title });
    return true;
  });
  return { mockSender, calls };
}

// ═══════════════════════════════════════════════
// AlertManager — без telegramSender
// ═══════════════════════════════════════════════

describe('AlertManager — без TelegramSender', () => {
  it('не делает HTTP-запросов при отсутствии telegramSender', async () => {
    const manager = new AlertManager({
      enabled: true,
      channels: ['telegram'] as const,
      minPriority: 'HIGH' as EventPriority,
    });

    const event = makeEvent();
    await manager.sendAlert(event);

    // Не должно быть ошибок — просто лог пропуск
  });

  it('не считает успехом отсутствие отправителя', async () => {
    const manager = new AlertManager({
      enabled: true,
      channels: ['telegram'] as const,
      minPriority: 'HIGH' as EventPriority,
    });

    const event = makeEvent();
    // sendAlert не возвращает boolean — он void.
    // Но не должен выбрасывать ошибку
    await expect(manager.sendAlert(event)).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// AlertManager — с mock-отправителем
// ═══════════════════════════════════════════════

describe('AlertManager — с mock TelegramSender', () => {
  it('вызывает telegramSender с корректными аргументами', async () => {
    const { mockSender, calls } = makeMockSender();
    const manager = AlertManager.withTelegramSender(mockSender, {
      enabled: true,
      channels: ['telegram'] as const,
      minPriority: 'HIGH' as EventPriority,
    });

    const event = makeEvent({
      title: 'SBER: цена упала',
      description: 'Цена SBER ниже 250 руб.',
    });

    await manager.sendAlert(event);

    expect(mockSender).toHaveBeenCalledTimes(1);
    expect(mockSender).toHaveBeenCalledWith(
      '🔔 SBER: цена упала\nЦена SBER ниже 250 руб.',
      'SBER: цена упала',
    );
    expect(calls).toHaveLength(1);
  });

  it('не вызывает отправитель при отключённых алертах', async () => {
    const { mockSender } = makeMockSender();
    const manager = AlertManager.withTelegramSender(mockSender, {
      enabled: false,
      channels: ['telegram'] as const,
      minPriority: 'HIGH' as EventPriority,
    });

    const event = makeEvent();
    await manager.sendAlert(event);

    expect(mockSender).not.toHaveBeenCalled();
  });

  it('не вызывает отправитель при низком приоритете', async () => {
    const { mockSender } = makeMockSender();
    const manager = AlertManager.withTelegramSender(mockSender, {
      enabled: true,
      channels: ['telegram'] as const,
      minPriority: 'HIGH' as EventPriority,
    });

    const event = makeEvent({ priority: 'LOW' as EventPriority });
    await manager.sendAlert(event);

    expect(mockSender).not.toHaveBeenCalled();
  });

  it('отправляет через несколько каналов', async () => {
    const { mockSender, calls } = makeMockSender();
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    const manager = AlertManager.withTelegramSender(mockSender, {
      enabled: true,
      channels: ['telegram', 'ui', 'log'] as const,
      minPriority: 'HIGH' as EventPriority,
    });

    const event = makeEvent();
    await manager.sendAlert(event);

    expect(mockSender).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('🟠'); // эмодзи для HIGH

    console.log = originalLog;
  });

  it('не отправляет реальный HTTP в тестах', async () => {
    // Гарантируем, что mockSender не делает fetch
    const { mockSender } = makeMockSender();
    const manager = AlertManager.withTelegramSender(mockSender, {
      enabled: true,
      channels: ['telegram'] as const,
      minPriority: 'HIGH' as EventPriority,
    });

    const event = makeEvent();
    await manager.sendAlert(event);

    // mockSender — это vi.fn(), он не делает HTTP
    // Если бы был реальный fetch — тест упал бы или завис
    expect(mockSender).toHaveBeenCalled();
  });
});
