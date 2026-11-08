/**
 * Типы модуля Resource Monitor.
 *
 * Модуль следит за нагрузкой на систему (CPU + RAM) и выдаёт снимки
 * {@link ResourceSnapshot}, на основе которых AdaptiveScheduler решает:
 * запускать фоновый анализ или «уснуть» до освобождения ресурсов.
 */

/** Суммарные времена ядер CPU (для расчёта загрузки по дельтам) */
export interface CpuCoreTimes {
  /** Суммарное время простоя по всем ядрам, мс */
  idle: number;
  /** Суммарное время (idle + user + nice + sys + irq...), мс */
  total: number;
}

/** Снимок нагрузки на ресурсы системы */
export interface ResourceSnapshot {
  /** Загрузка CPU, % (0..100) */
  cpuUsagePct: number;
  /** Используемая оперативная память, МБ */
  memoryUsedMb: number;
  /** Общий объём оперативной памяти, МБ */
  memoryTotalMb: number;
  /** Занятость памяти, % (0..100) */
  memoryUsagePct: number;
  /** Система загружена: CPU или RAM достигли порога */
  isBusy: boolean;
  /** Метка времени снятия снимка (ISO 8601) */
  timestamp: string;
  /**
   * Занятость текущего процесса, % от одного ядра.
   * Диагностика на базе process.cpuUsage(); появляется со второго
   * sample() (для первой дельты нужен baseline).
   */
  processCpuUsagePct?: number;
}

/** Пороги занятости системы */
export interface ResourceThresholds {
  /** CPU-порог, % (по умолчанию 70) */
  cpuBusyPct?: number;
  /** RAM-порог, % (по умолчанию 85) */
  memoryBusyPct?: number;
}

/** Абстракция источника ресурсов (подменяется в тестах) */
export interface IResourceSource {
  /** Суммарные времена ядер CPU (на базе os.cpus()) */
  readCpuTimes(): CpuCoreTimes;
  /** Занятость текущего процесса: user/system, мкс (process.cpuUsage()) */
  readProcessCpuUsage(): { user: number; system: number };
  /** Общая память, байт */
  totalmem(): number;
  /** Свободная память, байт */
  freemem(): number;
}
