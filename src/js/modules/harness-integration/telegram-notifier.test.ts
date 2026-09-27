/**
 * Telegram Notifier Tests — форматирование и отправка через внешний sender.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect/vi),
 * а не импорт из 'vitest' (ограничение окружения: vitest 5.x + vite 8.x).
 *
 * Покрытие:
 * 1. formatAnomalyReport: эмодзи риска, тикеры, z-score, маркер ⚠️
 * 2. formatAnomalyReport: пустой список → «аномалий не обнаружено»
 * 3. formatSchedulerAlert: режимы, CPU/RAM, пропущенные циклы
 * 4. no-op без sender: отправка возвращает false и не кидает ошибок
 * 5. attach(): отправитель получает отформатированный текст
 * 6. ошибка отправителя → false (без проброса исключения)
 */

import { TelegramNotifier } from './index.js';
import type {
  AnomalyBrief,
  SchedulerStatusInfo,
  TelegramSender,
} from './types.js';

/** Аномалия с фиксированным уровнем риска */
function makeAnomaly(
  ticker: string,
  riskLevel: AnomalyBrief['riskLevel'],
  overrides: Partial<AnomalyBrief> = {},
): AnomalyBrief {
  return {
    ticker,
    zScoreLast: 2.5,
    isLastAnomaly: true,
    riskLevel,
    volatilityAnnual: 40,
    ...overrides,
  };
}

/** Статус диспетчера с указанным режимом */
function makeStatus(
  mode: SchedulerStatusInfo['mode'],
  overrides: Partial<SchedulerStatusInfo> = {},
): SchedulerStatusInfo {
  return {
    mode,
    lastRunAt: '2026-09-26T12:00:00.000Z',
    skippedCycles: 0,
    cpuUsagePct: 12,
    memoryUsagePct: 55,
    ...overrides,
  };
}

/** Записывающий mock-отправитель (глобальные vi.fn) */
function makeSender(behavior: 'ok' | 'throw' = 'ok'): TelegramSender {
  return {
    sendMessage: vi.fn(async (_text: string) => {
      if (behavior === 'throw') {
        throw new Error('network error');
      }
      return true;
    }),
  };
}

describe('TelegramNotifier', () => {
  it('formatAnomalyReport: эмодзи риска, тикеры, z-score и маркер последней аномалии', () => {
    const notifier = new TelegramNotifier();
    const anomalies = [
      makeAnomaly('SBER', 'high', { zScoreLast: 3.21, volatilityAnnual: 45.2 }),
      makeAnomaly('GAZP', 'medium', { isLastAnomaly: false }),
      makeAnomaly('PLZL', 'low'),
    ];

    const report = notifier.formatAnomalyReport(anomalies);

    expect(report).toContain('📊 Отчёт об аномалиях');
    expect(report).toContain('🔴 SBER ⚠️ | z=3.21 | риск: high | вол: 45.2%');
    expect(report).toContain('🟡 GAZP | z=2.50 | риск: medium');
    expect(report).toContain('🟢 PLZL ⚠️ | z=2.50 | риск: low');
    // Строки разделены переносами
    expect(report.split('\n')).toHaveLength(4);
  });

  it('formatAnomalyReport: пустой список → сообщение об отсутствии аномалий', () => {
    const notifier = new TelegramNotifier();

    const report = notifier.formatAnomalyReport([]);

    expect(report).toBe('📊 Аномалий не обнаружено ✅');
  });

  it('formatAnomalyReport: обрезает отчёт до 5 аномалий (компактность)', () => {
    const notifier = new TelegramNotifier();
    const anomalies = Array.from({ length: 7 }, (_, i) =>
      makeAnomaly(`T${i}`, 'low'),
    );

    const report = notifier.formatAnomalyReport(anomalies);

    // 1 заголовок + 5 строк = 6
    expect(report.split('\n')).toHaveLength(6);
    expect(report).toContain('T0');
    expect(report).not.toContain('T6');
  });

  it('formatSchedulerAlert: режим с эмодзи, последний запуск, CPU/RAM, циклы', () => {
    const notifier = new TelegramNotifier();

    const alert = notifier.formatSchedulerAlert(
      makeStatus('sleeping', {
        skippedCycles: 7,
        cpuUsagePct: 88,
        memoryUsagePct: 91,
      }),
    );

    expect(alert).toContain('🛰 Диспетчер анализа');
    expect(alert).toContain('Режим: 😴 спит');
    expect(alert).toContain('Последний запуск: 2026-09-26T12:00:00.000Z');
    expect(alert).toContain('Пропущено циклов: 7');
    expect(alert).toContain('CPU: 88% | RAM: 91%');
  });

  it('formatSchedulerAlert: все три режима отображаются корректно', () => {
    const notifier = new TelegramNotifier();

    expect(notifier.formatSchedulerAlert(makeStatus('active'))).toContain(
      'Режим: 🟢 активен',
    );
    expect(notifier.formatSchedulerAlert(makeStatus('manual'))).toContain(
      'Режим: ✋ ручной',
    );
    expect(
      notifier.formatSchedulerAlert(makeStatus('active', { lastRunAt: null })),
    ).toContain('Последний запуск: —');
  });

  it('no-op без sender: отправка возвращает false и не кидает ошибок', async () => {
    const notifier = new TelegramNotifier();

    await expect(
      notifier.sendAnomalyReport([makeAnomaly('SBER', 'high')]),
    ).resolves.toBe(false);
    await expect(
      notifier.sendSchedulerAlert(makeStatus('active')),
    ).resolves.toBe(false);

    expect(notifier.hasSender()).toBe(false);
  });

  it('attach(): отправитель получает отформатированный текст, возврат true', async () => {
    const notifier = new TelegramNotifier();
    const sender = makeSender();
    notifier.attach(sender);

    expect(notifier.hasSender()).toBe(true);

    const ok = await notifier.sendAnomalyReport([makeAnomaly('SBER', 'high')]);

    expect(ok).toBe(true);
    expect(sender.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = (sender.sendMessage as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(sentText).toContain('📊 Отчёт об аномалиях');
    expect(sentText).toContain('🔴 SBER ⚠️');
  });

  it('attach(): повторный вызов заменяет отправителя', async () => {
    const notifier = new TelegramNotifier();
    const first = makeSender();
    const second = makeSender();

    notifier.attach(first);
    await notifier.sendSchedulerAlert(makeStatus('active'));
    expect(first.sendMessage).toHaveBeenCalledTimes(1);

    notifier.attach(second);
    await notifier.sendSchedulerAlert(makeStatus('active'));

    expect(first.sendMessage).toHaveBeenCalledTimes(1); // больше не вызывается
    expect(second.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('ошибка отправителя → false (без проброса исключения)', async () => {
    const notifier = new TelegramNotifier();
    notifier.attach(makeSender('throw'));

    await expect(
      notifier.sendAnomalyReport([makeAnomaly('SBER', 'high')]),
    ).resolves.toBe(false);
    await expect(
      notifier.sendSchedulerAlert(makeStatus('active')),
    ).resolves.toBe(false);
  });

  it('sendSchedulerAlert с sender → true и отформатированным текстом алерта', async () => {
    const notifier = new TelegramNotifier();
    const sender = makeSender();
    notifier.attach(sender);

    const ok = await notifier.sendSchedulerAlert(
      makeStatus('sleeping', { skippedCycles: 3, cpuUsagePct: 90 }),
    );

    expect(ok).toBe(true);
    expect(sender.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = (sender.sendMessage as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    // Формат: заголовок + режим + последний запуск + циклы + CPU/RAM
    expect(sentText).toContain('🛰 Диспетчер анализа');
    expect(sentText).toContain('Режим: 😴 спит');
    expect(sentText).toContain('Пропущено циклов: 3');
    expect(sentText).toContain('CPU: 90% | RAM: 55%');
    expect(sentText.split('\n')).toHaveLength(5);
  });
});
