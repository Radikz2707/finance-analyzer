/**
 * Price Alert Notifier Tests — рассылка ценовых алертов в Telegram.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect/vi),
 * а не импорт из 'vitest' (ограничение окружения: vitest 5.x + vite 8.x).
 *
 * Покрытие:
 * 1. Провайдер с 2 сработавшими → sendMessage вызван 2 раза
 * 2. Пустой провайдер → 0 отправлений
 * 3. Ошибка провайдера → 0 (+ warn, без проброса)
 * 4. Повторный вызов не шлёт дубли (внутренний Set по тикер+направление+дата)
 * 5. Нет провайдера → 0 (безопасный no-op)
 * 6. Формат сообщения: тикер, уровень, текущая цена, направление
 */

import { PriceAlertNotifier } from './index.js';
import { TelegramNotifier } from './index.js';
import type { TelegramSender } from './types.js';
import type { PriceAlert } from '../ai-advisor/types.js';

/** Ценовой алерт с заданным направлением */
function makeAlert(
  ticker: string,
  direction: 'upper' | 'lower',
  overrides: Partial<PriceAlert> = {},
): PriceAlert {
  return {
    ticker,
    name: ticker,
    currentPrice: direction === 'upper' ? 260 : 240,
    upperLimit: 250,
    lowerLimit: 245,
    direction,
    message: 'Пробой уровня',
    ...overrides,
  };
}

/** Записывающий mock-отправитель */
function makeSender(): TelegramSender {
  return {
    sendMessage: vi.fn(async (_text: string) => true),
  };
}

describe('PriceAlertNotifier', () => {
  it('провайдер с 2 сработавшими алертами → 2 отправки', async () => {
    const sender = makeSender();
    const notifier = new TelegramNotifier();
    notifier.attach(sender);

    const provider = () => [
      makeAlert('SBER', 'upper'),
      makeAlert('GAZP', 'lower'),
    ];
    const alertNotifier = new PriceAlertNotifier(notifier, provider);

    const sent = await alertNotifier.checkAndNotify();

    expect(sent).toBe(2);
    expect(sender.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('пустой провайдер → 0 отправлений', async () => {
    const sender = makeSender();
    const notifier = new TelegramNotifier();
    notifier.attach(sender);

    const alertNotifier = new PriceAlertNotifier(notifier, () => []);

    const sent = await alertNotifier.checkAndNotify();
    expect(sent).toBe(0);
    expect(sender.sendMessage).not.toHaveBeenCalled();
  });

  it('ошибка провайдера → 0 (+ warn, без проброса)', async () => {
    // Логгер по умолчанию пишет в console с меткой модуля первым аргументом
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sender = makeSender();
    const notifier = new TelegramNotifier();
    notifier.attach(sender);

    const alertNotifier = new PriceAlertNotifier(notifier, () => {
      throw new Error('provider exploded');
    });

    const sent = await alertNotifier.checkAndNotify();
    expect(sent).toBe(0);
    expect(sender.sendMessage).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[price-alert-notifier]',
      expect.stringContaining('Ошибка провайдера алертов'),
    );
    warnSpy.mockRestore();
  });

  it('повторный вызов не шлёт дубли (Set тикер+направление+дата)', async () => {
    const sender = makeSender();
    const notifier = new TelegramNotifier();
    notifier.attach(sender);

    const provider = () => [makeAlert('SBER', 'upper')];
    const alertNotifier = new PriceAlertNotifier(notifier, provider);

    const first = await alertNotifier.checkAndNotify();
    const second = await alertNotifier.checkAndNotify();

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(sender.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('асинхронный провайдер поддерживается', async () => {
    const sender = makeSender();
    const notifier = new TelegramNotifier();
    notifier.attach(sender);

    const alertNotifier = new PriceAlertNotifier(notifier, async () => [
      makeAlert('LKOH', 'upper', { currentPrice: 7000 }),
    ]);

    const sent = await alertNotifier.checkAndNotify();
    expect(sent).toBe(1);
  });

  it('нет провайдера → 0 (безопасный no-op)', async () => {
    const sender = makeSender();
    const notifier = new TelegramNotifier();
    notifier.attach(sender);

    const alertNotifier = new PriceAlertNotifier(notifier);

    const sent = await alertNotifier.checkAndNotify();
    expect(sent).toBe(0);
    expect(sender.sendMessage).not.toHaveBeenCalled();
  });

  it('setProvider() позволяет задать провайдера после создания', async () => {
    const sender = makeSender();
    const notifier = new TelegramNotifier();
    notifier.attach(sender);

    const alertNotifier = new PriceAlertNotifier(notifier);
    alertNotifier.setProvider(() => [makeAlert('GAZP', 'lower')]);

    const sent = await alertNotifier.checkAndNotify();
    expect(sent).toBe(1);
    expect(sender.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('формат сообщения содержит тикер, направление, уровень и текущую цену', async () => {
    const notifier = new TelegramNotifier();
    const alertNotifier = new PriceAlertNotifier(notifier, () => []);

    const upper = alertNotifier.formatAlertMessage(
      makeAlert('SBER', 'upper', { currentPrice: 262.5 }),
    );
    expect(upper).toContain('⚡ Ценовой алерт: SBER (SBER)');
    expect(upper).toContain('📈 Рост выше уровня: 250');
    expect(upper).toContain('Текущая цена: 262,5');

    const lower = alertNotifier.formatAlertMessage(
      makeAlert('GAZP', 'lower', { currentPrice: 241.1 }),
    );
    expect(lower).toContain('📉 Падение ниже уровня: 245');
    expect(lower).toContain('Текущая цена: 241,1');
  });

  it('без sender (не привязан) → 0, хотя алерты есть', async () => {
    const notifier = new TelegramNotifier();
    const alertNotifier = new PriceAlertNotifier(notifier, () => [
      makeAlert('SBER', 'upper'),
    ]);

    const sent = await alertNotifier.checkAndNotify();
    expect(sent).toBe(0);
  });
});
