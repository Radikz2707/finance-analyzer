/**
 * TrendAnalyzer — анализ долгосрочных трендов (подзадача 1.2.4).
 *
 * Метод: простая линейная регрессия (МНК) по индексам точек,
 * R² как доля объяснённой дисперсии. Детерминированно, без LLM.
 *
 * Пример:
 * ```ts
 * const t = new TrendAnalyzer();
 * const r = t.analyze(points);
 * console.log(r.direction, r.slope, r.rSquared);
 * ```
 */

import type {
  TimeSeriesPoint,
  TrendAnalyzerOptions,
  TrendDirection,
  TrendResult,
} from './types.js';

// ──────────────────────────────────────────────
// Константы и ошибки
// ──────────────────────────────────────────────

export const DEFAULT_SLOPE_THRESHOLD = 0.1;
export const DEFAULT_MIN_R_SQUARED = 0.3;
export const DEFAULT_TREND_MIN_POINTS = 5;

/** Ошибка TrendAnalyzer */
export class TrendAnalyzerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TrendAnalyzerError';
  }
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ──────────────────────────────────────────────
// TrendAnalyzer
// ──────────────────────────────────────────────

export class TrendAnalyzer {
  private readonly slopeThreshold: number;
  private readonly minRSquared: number;
  private readonly minPoints: number;

  constructor(options: TrendAnalyzerOptions = {}) {
    this.slopeThreshold = options.slopeThreshold ?? DEFAULT_SLOPE_THRESHOLD;
    this.minRSquared = options.minRSquared ?? DEFAULT_MIN_R_SQUARED;
    this.minPoints = Math.max(3, options.minPoints ?? DEFAULT_TREND_MIN_POINTS);
  }

  /** Проанализировать тренд ряда значений. */
  analyze(
    series: readonly TimeSeriesPoint[],
    windowSize?: number,
  ): TrendResult {
    if (!Array.isArray(series)) {
      throw new TrendAnalyzerError('analyze(): ожидается массив точек');
    }
    if (series.length < this.minPoints) {
      return {
        direction: 'insufficient',
        slope: 0,
        intercept: 0,
        rSquared: 0,
        changePercent: null,
        windowSize: series.length,
        warnings: [
          `Недостаточно точек (${series.length} < ${this.minPoints}) — тренд не оценивается`,
        ],
      };
    }

    const warnings: string[] = [];

    // Берём последние N точек, если окно задано
    const useWindow =
      windowSize !== undefined && windowSize >= this.minPoints
        ? series.slice(-windowSize)
        : series;

    const n = useWindow.length;
    const values = useWindow.map((p) => p.value);

    // МНК: x = индекс (0..n-1)
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i]!;
      sumXY += i * values[i]!;
      sumXX += i * i;
    }
    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) {
      // Все x одинаковы — невозможно для уникальных индексов, но защита честности
      throw new TrendAnalyzerError(
        'TrendAnalyzer: вырожденная регрессия (x одинаковые)',
      );
    }
    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    // R² = 1 - SSres / SStot
    const meanY = sumY / n;
    let ssTot = 0;
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
      const fitted = intercept + slope * i;
      ssTot += (values[i]! - meanY) ** 2;
      ssRes += (values[i]! - fitted) ** 2;
    }
    const rSquared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

    // Порог наклона: доля std ряда за шаг
    const variance =
      values.reduce((s, v) => s + (v - meanY) ** 2, 0) / Math.max(1, n - 1);
    const sigma = Math.sqrt(variance);
    const slopeNorm = sigma > 0 ? Math.abs(slope) / sigma : 0;

    let direction: TrendDirection;
    if (slopeNorm < this.slopeThreshold || rSquared < this.minRSquared) {
      direction = 'stable';
      if (slopeNorm >= this.slopeThreshold && rSquared < this.minRSquared) {
        warnings.push(
          `Наклон заметный, но R² = ${round(rSquared, 3)} < ${this.minRSquared} — тренд не подтверждается, считаем stable`,
        );
      }
    } else {
      direction = slope > 0 ? 'rising' : 'falling';
    }

    // Изменение в процентах за окно (если первое значение != 0)
    const first = values[0]!;
    const last = values[n - 1]!;
    let changePercent: number | null = null;
    if (first !== 0) {
      changePercent = round(((last - first) / Math.abs(first)) * 100, 2);
    } else {
      warnings.push('Первое значение окна = 0 — changePercent не определён');
    }

    return {
      direction,
      slope: round(slope),
      intercept: round(intercept),
      rSquared: round(rSquared, 4),
      changePercent,
      windowSize: n,
      warnings,
    };
  }
}
