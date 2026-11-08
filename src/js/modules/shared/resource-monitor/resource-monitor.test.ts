/**
 * Resource Monitor Tests — снимки нагрузки системы (CPU/RAM).
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect/vi),
 * а не импорт из 'vitest' (ограничение окружения: vitest 5.x + vite 8.x).
 *
 * Покрытие:
 * 1. Baseline CPU на первом sample(), RAM-метрики и isBusy
 * 2. CPU% по дельтам времен ядер между sample()
 * 3. Пороги занятости (по умолчанию и кастомные)
 * 4. processCpuUsagePct (диагностика, со второго sample())
 * 5. reset() и согласованность NodeResourceSource с node:os
 */

import { NodeResourceSource, ResourceMonitor } from './index.js';
import type { IResourceSource } from './types.js';

/** Фейковый источник ресурсов с управляемыми значениями */
class FakeResourceSource implements IResourceSource {
  idle = 80_000;
  total = 100_000;
  processUser = 0;
  processSystem = 0;
  totalMemory = 16 * 1024 ** 3; // 16 ГБ
  freeMemory = 8 * 1024 ** 3; // 8 ГБ

  readCpuTimes() {
    return { idle: this.idle, total: this.total };
  }

  readProcessCpuUsage() {
    return { user: this.processUser, system: this.processSystem };
  }

  totalmem() {
    return this.totalMemory;
  }

  freemem() {
    return this.freeMemory;
  }
}

describe('ResourceMonitor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('первый sample() формирует baseline CPU (0%) и корректные RAM-метрики', () => {
    const source = new FakeResourceSource();
    const monitor = new ResourceMonitor(source);

    const snap = monitor.sample();

    expect(snap.cpuUsagePct).toBe(0);
    expect(snap.memoryUsedMb).toBe(8 * 1024);
    expect(snap.memoryTotalMb).toBe(16 * 1024);
    expect(snap.memoryUsagePct).toBe(50);
    expect(snap.isBusy).toBe(false);
    expect(snap.timestamp).toBeTruthy();
    expect(snap.processCpuUsagePct).toBeUndefined();
  });

  it('второй sample() считает CPU% по дельте времен ядер', () => {
    const source = new FakeResourceSource();
    const monitor = new ResourceMonitor(source);

    monitor.sample(); // baseline
    source.idle = 82_000;
    source.total = 110_000;

    const snap = monitor.sample();
    // busy = (110000-100000) - (82000-80000) = 10000 - 2000 = 8000 → 80%
    expect(snap.cpuUsagePct).toBe(80);
    expect(snap.isBusy).toBe(true);
  });

  it('isBusy=false при нагрузке ниже порогов по умолчанию', () => {
    const source = new FakeResourceSource();
    const monitor = new ResourceMonitor(source);

    monitor.sample();
    // Δidle = 14_000, Δtotal = 20_000 → busy = 6_000 / 20_000 = 30%
    source.idle = 94_000;
    source.total = 120_000;

    const snap = monitor.sample();
    expect(snap.cpuUsagePct).toBe(30);
    expect(snap.isBusy).toBe(false);
  });

  it('isBusy=true при памяти выше порога 85%', () => {
    const source = new FakeResourceSource();
    source.freeMemory = 1 * 1024 ** 3; // занято 15/16 ≈ 93.75%

    const monitor = new ResourceMonitor(source);
    const snap = monitor.sample();

    expect(snap.memoryUsagePct).toBe(93.8);
    expect(snap.isBusy).toBe(true);
  });

  it('учитывает кастомные пороги', () => {
    const source = new FakeResourceSource();
    const monitor = new ResourceMonitor(source, { cpuBusyPct: 30 });
    expect(monitor.getThresholds()).toEqual({
      cpuBusyPct: 30,
      memoryBusyPct: 85,
    });

    monitor.sample();
    // Δidle = 10_000, Δtotal = 20_000 → busy = 10_000 / 20_000 = 50% ≥ 30
    source.idle = 90_000;
    source.total = 120_000;

    const snap = monitor.sample();
    expect(snap.cpuUsagePct).toBe(50);
    expect(snap.isBusy).toBe(true);
  });

  it('processCpuUsagePct появляется со второго sample() и детерминирован при fake time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const source = new FakeResourceSource();
    const monitor = new ResourceMonitor(source);

    monitor.sample();
    // Прошла 1 минута, процесс потребил 50 мс CPU (одно ядро)
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    source.processUser = 50_000;

    const snap = monitor.sample();
    // 50000 мкс / (60000 мс * 1000) * 100 = 0.0833... → 0.1
    expect(snap.processCpuUsagePct).toBe(0.1);
  });

  it('reset() сбрасывает baseline CPU', () => {
    const source = new FakeResourceSource();
    const monitor = new ResourceMonitor(source);

    monitor.sample();
    monitor.reset();
    expect(monitor.getLastSnapshot()).toBeNull();

    const snap = monitor.sample();
    expect(snap.cpuUsagePct).toBe(0);
  });

  it('NodeResourceSource согласован с node:os', () => {
    const src = new NodeResourceSource();

    expect(src.totalmem()).toBeGreaterThan(0);
    expect(src.freemem()).toBeGreaterThan(0);
    expect(src.freemem()).toBeLessThanOrEqual(src.totalmem());

    const times = src.readCpuTimes();
    expect(times.total).toBeGreaterThanOrEqual(times.idle);
    expect(times.idle).toBeGreaterThanOrEqual(0);

    const proc = src.readProcessCpuUsage();
    expect(proc.user).toBeGreaterThanOrEqual(0);
    expect(proc.system).toBeGreaterThanOrEqual(0);
  });
});
