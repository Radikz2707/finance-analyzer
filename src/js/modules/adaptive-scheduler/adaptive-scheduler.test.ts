/**
 * Adaptive Scheduler Tests — гибридный диспетчер нагрузки.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect/vi),
 * а не импорт из 'vitest' (ограничение окружения: vitest 5.x + vite 8.x).
 *
 * Покрытие:
 * 1. Режимы: manual (до старта), active (свободно), sleeping (занято)
 * 2. Авто-запуск коллбэка при свободной системе и пропуск при занятой
 * 3. Переходы sleeping → active при освобождении ресурсов
 * 4. manualRun() в любом режиме, события переходов, отписка
 * 5. stop(), защита от повторного входа, minRunIntervalMs, повторный start()
 */

import { AdaptiveScheduler } from './index.js';
import type { AdaptiveSchedulerEvent, AdaptiveSchedulerMode } from './types.js';
import type { IResourceSource } from '../resource-monitor/types.js';

/** Фейковый источник: busy управляется через поле busy */
class FakeResourceSource implements IResourceSource {
  idle = 80_000;
  total = 100_000;
  totalMemory = 16 * 1024 ** 3;
  freeMemory = 8 * 1024 ** 3;
  busy = false;

  readCpuTimes() {
    return { idle: this.idle, total: this.total };
  }

  readProcessCpuUsage() {
    return { user: 0, system: 0 };
  }

  totalmem() {
    return this.totalMemory;
  }

  freemem() {
    // Занятая система: свободно 1 ГБ из 16 (93.75% > порог 85%)
    return this.busy ? 1 * 1024 ** 3 : this.freeMemory;
  }
}

describe('AdaptiveScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('до start() режим manual, checkResources() не запускает задачу', () => {
    const callback = vi.fn(async () => {});
    const scheduler = new AdaptiveScheduler(callback, {
      resourceSource: new FakeResourceSource(),
    });

    expect(scheduler.getMode()).toBe('manual');

    scheduler.checkResources();

    expect(callback).not.toHaveBeenCalled();
    expect(scheduler.getMode()).toBe('manual');
    expect(scheduler.getLastSnapshot()).not.toBeNull();
  });

  it('start() при свободной системе переводит в active и авто-запускает задачу', async () => {
    vi.useFakeTimers();
    const callback = vi.fn(async () => {});
    const scheduler = new AdaptiveScheduler(callback, {
      resourceSource: new FakeResourceSource(),
      pollIntervalMs: 50,
    });

    scheduler.start();

    expect(scheduler.getMode()).toBe('active');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(scheduler.getSkippedCycles()).toBe(0);

    await vi.advanceTimersByTimeAsync(200);
    expect(callback).toHaveBeenCalledTimes(1); // minRunInterval не даёт частых запусков
  });

  it('start() при занятой системе переводит в sleeping и пропускает запуски', async () => {
    vi.useFakeTimers();
    const source = new FakeResourceSource();
    source.busy = true;
    const callback = vi.fn(async () => {});
    const scheduler = new AdaptiveScheduler(callback, {
      resourceSource: source,
      pollIntervalMs: 50,
      minRunIntervalMs: 0,
    });

    scheduler.start();
    expect(scheduler.getMode()).toBe('sleeping');
    expect(callback).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100); // два пропущенных цикла

    expect(callback).not.toHaveBeenCalled();
    expect(scheduler.getSkippedCycles()).toBe(3); // стартовый + 2 тика
  });

  it('при освобождении системы переходит sleeping → active и запускает задачу', async () => {
    vi.useFakeTimers();
    const source = new FakeResourceSource();
    source.busy = true;
    const callback = vi.fn(async () => {});
    const scheduler = new AdaptiveScheduler(callback, {
      resourceSource: source,
      pollIntervalMs: 50,
      minRunIntervalMs: 0,
    });

    scheduler.start();
    expect(scheduler.getMode()).toBe('sleeping');

    source.busy = false;
    await vi.advanceTimersByTimeAsync(50);

    expect(scheduler.getMode()).toBe('active');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(scheduler.getSkippedCycles()).toBe(0);
  });

  it('manualRun() запускает задачу даже при занятой системе', async () => {
    const source = new FakeResourceSource();
    source.busy = true;
    const callback = vi.fn(async () => {});
    const scheduler = new AdaptiveScheduler(callback, {
      resourceSource: source,
    });

    await scheduler.manualRun();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(scheduler.isRunning()).toBe(false);
  });

  it('эмитит события переходов режимов и поддерживает отписку', async () => {
    vi.useFakeTimers();
    const source = new FakeResourceSource();
    const callback = vi.fn(async () => {});
    const scheduler = new AdaptiveScheduler(callback, {
      resourceSource: source,
      pollIntervalMs: 50,
      minRunIntervalMs: 0,
    });

    const transitions: Array<[AdaptiveSchedulerMode, AdaptiveSchedulerMode]> =
      [];
    const listener = (e: AdaptiveSchedulerEvent) => {
      transitions.push([e.from, e.to]);
    };
    const unsubscribe = scheduler.onModeChange(listener);

    // start() тихо уходит из 'manual': первое событие — результат первого снимка
    scheduler.start(); // свободно → sleeping → active
    source.busy = true;
    await vi.advanceTimersByTimeAsync(50); // active → sleeping
    source.busy = false;
    await vi.advanceTimersByTimeAsync(50); // sleeping → active

    expect(transitions).toEqual([
      ['sleeping', 'active'],
      ['active', 'sleeping'],
      ['sleeping', 'active'],
    ]);

    // Отписка: последующие переходы не доходят до слушателя
    unsubscribe();
    source.busy = true;
    await vi.advanceTimersByTimeAsync(50);
    expect(transitions).toHaveLength(3);
  });

  it('stop() переводит в manual и останавливает фоновое наблюдение', async () => {
    vi.useFakeTimers();
    const source = new FakeResourceSource();
    const callback = vi.fn(async () => {});
    const scheduler = new AdaptiveScheduler(callback, {
      resourceSource: source,
      pollIntervalMs: 50,
      minRunIntervalMs: 0,
    });

    scheduler.start();
    expect(scheduler.getMode()).toBe('active');

    scheduler.stop();
    expect(scheduler.getMode()).toBe('manual');

    await vi.advanceTimersByTimeAsync(300);
    expect(callback).toHaveBeenCalledTimes(1); // только стартовый запуск
  });

  it('защищает от повторного входа, пока задача выполняется', async () => {
    let resolveTask: (() => void) | undefined;
    const callback = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTask = resolve;
        }),
    );
    const scheduler = new AdaptiveScheduler(callback, {
      resourceSource: new FakeResourceSource(),
      pollIntervalMs: 10,
      minRunIntervalMs: 0,
    });

    scheduler.start();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(scheduler.isRunning()).toBe(true);

    scheduler.checkResources(); // задача ещё висит — повторный запуск невозможен
    scheduler.checkResources();
    expect(callback).toHaveBeenCalledTimes(1);

    resolveTask?.();
    await Promise.resolve();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('minRunIntervalMs ограничивает частоту запусков', async () => {
    vi.useFakeTimers();
    const callback = vi.fn(async () => {});
    const scheduler = new AdaptiveScheduler(callback, {
      resourceSource: new FakeResourceSource(),
      pollIntervalMs: 10,
      minRunIntervalMs: 1000,
    });

    scheduler.start();
    expect(callback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500); // 50 тиков, но интервал 1000 мс не истёк
    expect(callback).toHaveBeenCalledTimes(1);
    expect(scheduler.getMode()).toBe('active'); // режим остаётся активным

    await vi.advanceTimersByTimeAsync(600); // суммарно 1100 мс → запуск разрешён
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('повторный start() не создаёт второй интервал', async () => {
    vi.useFakeTimers();
    const callback = vi.fn(async () => {});
    const scheduler = new AdaptiveScheduler(callback, {
      resourceSource: new FakeResourceSource(),
      pollIntervalMs: 50,
      minRunIntervalMs: 0,
    });

    scheduler.start();
    scheduler.start();

    await vi.advanceTimersByTimeAsync(150); // стартовый + тики 50/100/150 = 4 вызова
    expect(callback).toHaveBeenCalledTimes(4);
  });

  it('передаёт ошибки коллбэка в лог, не роняя планировщик', async () => {
    vi.useFakeTimers();
    const error = new Error('pipeline failed');
    const callback = vi.fn(async () => {
      throw error;
    });
    const scheduler = new AdaptiveScheduler(callback, {
      resourceSource: new FakeResourceSource(),
      pollIntervalMs: 10,
      minRunIntervalMs: 0,
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    scheduler.start();
    await vi.advanceTimersByTimeAsync(20);

    expect(errorSpy).toHaveBeenCalled();
    expect(scheduler.isRunning()).toBe(false);

    errorSpy.mockRestore();
  });
});
