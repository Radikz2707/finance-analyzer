/**
 * Resource Monitor — мониторинг нагрузки на систему.
 *
 * Собирает снимки {@link ResourceSnapshot}:
 * - CPU% — по дельтам суммарных times ядер os.cpus() между вызовами sample();
 * - RAM% — по os.totalmem()/os.freemem();
 * - процессная нагрузка — по process.cpuUsage() (диагностика).
 *
 * Пороги занятости по умолчанию: CPU ≥ 70% ИЛИ RAM ≥ 85%.
 * Пороги настраиваются в конструкторе (не хардкодятся под пользователя).
 */

import * as os from 'node:os';
import type {
  CpuCoreTimes,
  IResourceSource,
  ResourceSnapshot,
  ResourceThresholds,
} from './types.js';

/** Пороги по умолчанию: CPU 70%, RAM 85% */
export const DEFAULT_THRESHOLDS: Required<ResourceThresholds> = {
  cpuBusyPct: 70,
  memoryBusyPct: 85,
};

/**
 * Реальный источник ресурсов на базе node:os и process.cpuUsage().
 */
export class NodeResourceSource implements IResourceSource {
  readCpuTimes(): CpuCoreTimes {
    const cores = os.cpus();
    let idle = 0;
    let total = 0;
    for (const core of cores) {
      const t = core.times;
      idle += t.idle;
      total += t.idle + t.user + t.nice + t.sys + t.irq;
    }
    return { idle, total };
  }

  readProcessCpuUsage(): { user: number; system: number } {
    return process.cpuUsage();
  }

  totalmem(): number {
    return os.totalmem();
  }

  freemem(): number {
    return os.freemem();
  }
}

/**
 * ResourceMonitor — чтение нагрузки системы и формирование снимков.
 *
 * CPU% рассчитывается по дельте времен ядер между последовательными
 * вызовами sample(): первый вызов формирует baseline и возвращает 0%.
 */
export class ResourceMonitor {
  private readonly source: IResourceSource;
  private readonly thresholds: Required<ResourceThresholds>;
  private prevCpuTimes: CpuCoreTimes | null = null;
  private prevProcessUsage: { user: number; system: number } | null = null;
  private prevSampleAtMs: number | null = null;
  private lastSnapshot: ResourceSnapshot | null = null;

  constructor(
    source: IResourceSource = new NodeResourceSource(),
    thresholds: ResourceThresholds = {},
  ) {
    this.source = source;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Снять текущий снимок нагрузки.
   */
  sample(): ResourceSnapshot {
    const nowMs = Date.now();
    const cpuTimes = this.source.readCpuTimes();
    const cpuUsagePct = this.computeCpuUsagePct(cpuTimes);
    const processCpuUsagePct = this.computeProcessCpuUsagePct(nowMs);

    const totalMemBytes = this.source.totalmem();
    const freeMemBytes = this.source.freemem();
    const usedMemBytes = Math.max(0, totalMemBytes - freeMemBytes);
    const memoryUsagePct =
      totalMemBytes > 0 ? (usedMemBytes / totalMemBytes) * 100 : 0;

    const snapshot: ResourceSnapshot = {
      cpuUsagePct,
      memoryUsedMb: Math.round(usedMemBytes / 1024 / 1024),
      memoryTotalMb: Math.round(totalMemBytes / 1024 / 1024),
      memoryUsagePct: Math.round(memoryUsagePct * 10) / 10,
      isBusy:
        cpuUsagePct >= this.thresholds.cpuBusyPct ||
        memoryUsagePct >= this.thresholds.memoryBusyPct,
      timestamp: new Date(nowMs).toISOString(),
    };

    if (processCpuUsagePct !== undefined) {
      snapshot.processCpuUsagePct = processCpuUsagePct;
    }

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  /** Сбросить все baseline-значения (CPU, процесс, время) */
  reset(): void {
    this.prevCpuTimes = null;
    this.prevProcessUsage = null;
    this.prevSampleAtMs = null;
    this.lastSnapshot = null;
  }

  /** Последний снятый снимок (null, если sample() ещё не вызывался) */
  getLastSnapshot(): ResourceSnapshot | null {
    return this.lastSnapshot;
  }

  /** Текущие пороги занятости */
  getThresholds(): Required<ResourceThresholds> {
    return { ...this.thresholds };
  }

  private computeCpuUsagePct(current: CpuCoreTimes): number {
    if (this.prevCpuTimes === null) {
      this.prevCpuTimes = current;
      return 0;
    }

    const idleDelta = current.idle - this.prevCpuTimes.idle;
    const totalDelta = current.total - this.prevCpuTimes.total;
    this.prevCpuTimes = current;

    if (totalDelta <= 0) {
      return 0;
    }

    const busyDelta = totalDelta - idleDelta;
    const pct = (busyDelta / totalDelta) * 100;
    return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
  }

  private computeProcessCpuUsagePct(nowMs: number): number | undefined {
    const usage = this.source.readProcessCpuUsage();

    if (this.prevProcessUsage === null || this.prevSampleAtMs === null) {
      this.prevProcessUsage = usage;
      this.prevSampleAtMs = nowMs;
      return undefined;
    }

    const elapsedMs = nowMs - this.prevSampleAtMs;
    const deltaUs =
      usage.user -
      this.prevProcessUsage.user +
      usage.system -
      this.prevProcessUsage.system;
    this.prevProcessUsage = usage;
    this.prevSampleAtMs = nowMs;

    if (elapsedMs <= 0) {
      return undefined;
    }

    // Процент одного ядра: дельта CPU (мкс) / затраченное время (мкс) * 100
    const pct = (deltaUs / (elapsedMs * 1000)) * 100;
    return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
  }
}
