/**
 * Легковесная утилита performance-бенчмарков (это НЕ тесты).
 *
 * Замеряет время выполнения функции (sync/async) с прогревом и вычисляет
 * агрегаты: avg / p95 / min / max + ops-per-second.
 *
 * Бенчмарки информационные: всегда завершаются с кодом 0. Для будущего CI
 * предусмотрен опциональный порог `--fail-on <ms>` — если avgMs любого замера
 * превышает порог, процесс завершается с кодом 1 (см. run.ts).
 */

import { performance } from 'node:perf_hooks';

// ──────────────────────────────────────────────
// Типы
// ──────────────────────────────────────────────

export interface BenchmarkOptions {
  /** Сколько раз выполнить измеряемую функцию (минимум 1). По умолчанию 5. */
  iterations?: number;
  /** Прогрев перед замерами (JIT, кэши). По умолчанию 1. */
  warmup?: number;
}

export interface BenchmarkResult {
  name: string;
  /** Операций в секунду (1000 / avgMs); Infinity при avgMs === 0. */
  opsPerSec: number;
  /** Среднее время выполнения, мс. */
  avgMs: number;
  /** 95-й перцентиль, мс. */
  p95Ms: number;
  /** Минимальное время, мс. */
  minMs: number;
  /** Максимальное время, мс. */
  maxMs: number;
  /** Прирост heapUsed после прогона (МБ) — заполняется memory-бенчмарками. */
  heapUsedMb?: number;
}

export const DEFAULT_ITERATIONS = 5;
export const DEFAULT_WARMUP = 1;

// ──────────────────────────────────────────────
// Замеры
// ──────────────────────────────────────────────

/** Замерить время выполнения fn (sync/async) с агрегатами avg/p95/min/max. */
export async function measure<T = unknown>(
  name: string,
  fn: () => T | Promise<T>,
  options: BenchmarkOptions = {},
): Promise<BenchmarkResult> {
  const iterations = Math.max(1, options.iterations ?? DEFAULT_ITERATIONS);
  const warmup = Math.max(0, options.warmup ?? DEFAULT_WARMUP);

  for (let i = 0; i < warmup; i += 1) {
    await fn();
  }

  const samples: number[] = new Array<number>(iterations);
  for (let i = 0; i < iterations; i += 1) {
    const startedAt = performance.now();
    await fn();
    const elapsedMs = performance.now() - startedAt;
    samples[i] = elapsedMs;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const totalMs = sorted.reduce((acc, sample) => acc + sample, 0);
  const avgMs = totalMs / sorted.length;
  const minMs = sorted[0] ?? 0;
  const maxMs = sorted[sorted.length - 1] ?? 0;
  // Классический nearest-rank перцентиль: индекс floor(0.95 * (n - 1)).
  const p95Index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(0.95 * (sorted.length - 1))),
  );
  const p95Ms = sorted[p95Index] ?? maxMs;

  return {
    name,
    opsPerSec: avgMs > 0 ? 1000 / avgMs : Number.POSITIVE_INFINITY,
    avgMs,
    p95Ms,
    minMs,
    maxMs,
  };
}

/**
 * Замер прироста heapUsed от выполнения fn (один прогон).
 * Перед замером пытаемся вызвать GC (актуально при запуске node --expose-gc);
 * после прогона GC НЕ вызываем — в дельту попадают временные объекты, что
 * лучше отражает пиковое потребление парсинга.
 */
export async function measureMemoryUsage<T = unknown>(
  name: string,
  fn: () => T | Promise<T>,
): Promise<BenchmarkResult> {
  collectGarbage();

  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  await fn();
  const elapsedMs = performance.now() - startedAt;
  const heapAfter = process.memoryUsage().heapUsed;

  return {
    name,
    opsPerSec: elapsedMs > 0 ? 1000 / elapsedMs : Number.POSITIVE_INFINITY,
    avgMs: elapsedMs,
    p95Ms: elapsedMs,
    minMs: elapsedMs,
    maxMs: elapsedMs,
    heapUsedMb: (heapAfter - heapBefore) / 1024 / 1024,
  };
}

/** Вызвать GC, если процесс запущен с флагом --expose-gc (иначе no-op). */
function collectGarbage(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
}

// ──────────────────────────────────────────────
// Вывод таблицей
// ──────────────────────────────────────────────

interface Column {
  header: string;
  align: 'left' | 'right';
  render: (row: BenchmarkResult) => string;
}

const TIME_COLUMNS: Column[] = [
  { header: 'Benchmark', align: 'left', render: (row) => row.name },
  { header: 'avg, ms', align: 'right', render: (row) => fmtMs(row.avgMs) },
  { header: 'p95, ms', align: 'right', render: (row) => fmtMs(row.p95Ms) },
  { header: 'min, ms', align: 'right', render: (row) => fmtMs(row.minMs) },
  { header: 'max, ms', align: 'right', render: (row) => fmtMs(row.maxMs) },
  { header: 'ops/sec', align: 'right', render: (row) => fmtOps(row.opsPerSec) },
];

const MEMORY_COLUMN: Column = {
  header: 'heap delta, MB',
  align: 'right',
  render: (row) =>
    row.heapUsedMb === undefined ? '—' : row.heapUsedMb.toFixed(2),
};

function fmtMs(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}

function fmtOps(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}

/** Собрать ASCII-таблицу результатов (столбец памяти — если есть замеры). */
export function formatResultsTable(results: BenchmarkResult[]): string {
  if (results.length === 0) return '(пусто)';

  const hasMemory = results.some((row) => row.heapUsedMb !== undefined);
  const columns = hasMemory ? [...TIME_COLUMNS, MEMORY_COLUMN] : TIME_COLUMNS;

  const widths = columns.map((column) =>
    Math.max(
      column.header.length,
      ...results.map((row) => column.render(row).length),
    ),
  );

  const renderRow = (values: string[]): string =>
    `| ${values
      .map((value, index) =>
        padCell(value, widths[index] ?? 0, columns[index]?.align ?? 'left'),
      )
      .join(' | ')} |`;

  const headerLine = renderRow(columns.map((column) => column.header));
  const separator = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;

  const lines = [headerLine, separator];
  for (const row of results) {
    lines.push(renderRow(columns.map((column) => column.render(row))));
  }
  return lines.join('\n');
}

function padCell(
  value: string,
  width: number,
  align: 'left' | 'right',
): string {
  return align === 'right' ? value.padStart(width) : value.padEnd(width);
}

/** Печать таблицы результатов в консоль. */
export function printResults(results: BenchmarkResult[]): void {
  console.log(formatResultsTable(results));
}

// ──────────────────────────────────────────────
// Опциональный CI-порог
// ──────────────────────────────────────────────

/** Разобрать флаг `--fail-on <ms>` из argv; null, если флаг не задан/невалиден. */
export function parseFailOnThreshold(argv: string[]): number | null {
  const flagIndex = argv.indexOf('--fail-on');
  if (flagIndex === -1) return null;
  const raw = argv[flagIndex + 1];
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Самый медленный замер со средним временем выше порога (или null). */
export function findSlowest(
  results: BenchmarkResult[],
  thresholdMs: number,
): BenchmarkResult | null {
  let slowest: BenchmarkResult | null = null;
  for (const result of results) {
    if (result.avgMs > thresholdMs) {
      if (slowest === null || result.avgMs > slowest.avgMs) {
        slowest = result;
      }
    }
  }
  return slowest;
}
