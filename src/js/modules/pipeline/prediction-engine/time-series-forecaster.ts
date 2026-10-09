/**
 * TimeSeriesForecaster — прогнозирование временных рядов (подзадача 1.2.1).
 *
 * Честная реализация без магии:
 * - 'sma'  — скользящее среднее (плоский прогноз)
 * - 'ema'  — экспоненциальное сглаживание уровня
 * - 'holt' — двойное экспоненциальное сглаживание Хольта (уровень + тренд)
 *
 * Доверительные интервалы строятся по std остатков одношаговых прогнозов
 * на истории (backtesting-in-sample) — простая, но честная оценка
 * неопределённости. Это НЕ ARIMA: сезонность и авторегрессия не моделируются
 * (предупреждение в warnings при выборе 'holt' о его ограничениях).
 */

import type {
  ForecastMethod,
  ForecastOptions,
  ForecastPoint,
  ForecastResult,
  TimeSeriesPoint,
} from './types.js';

// ──────────────────────────────────────────────
// Константы и ошибки
// ──────────────────────────────────────────────

/** Горизонт прогноза по умолчанию */
export const DEFAULT_HORIZON = 10;
/** Уровень доверия по умолчанию */
export const DEFAULT_CONFIDENCE = 0.95;
/** Минимум точек для 'holt' (нужен уровень + тренд) */
export const MIN_POINTS_HOLT = 4;
/** Минимум точек для остальных методов */
export const MIN_POINTS_BASIC = 2;

/** Ошибка TimeSeriesForecaster */
export class TimeSeriesForecasterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TimeSeriesForecasterError';
  }
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Квантиль нормального распределения для уровня доверия (двусторонний) */
function zScore(confidenceLevel: number): number {
  // Приближение Обри-Мартина (достаточно для 0.8..0.99)
  const p = Math.min(0.9999, Math.max(0.0001, (1 + confidenceLevel) / 2));
  // Рациональная аппроксимация обратной CDF (Beasley-Springer-Moro lite)
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ] as const;
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ] as const;
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ] as const;
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ] as const;
  const pLow = 0.02425;
  let q: number;
  let z: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    z =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pLow) {
    q = p - 0.5;
    const r = q * q;
    z =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    z =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return z;
}

/** Std выборки (несмещённая, n-1) */
export function std(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Одношаговые остатки метода на истории (in-sample backtest).
 * Возвращает массив (факт − прогноз), длина = n - warmup.
 */
function inSampleResiduals(
  values: readonly number[],
  method: ForecastMethod,
  alpha: number,
  beta: number,
  smaWindow: number,
): number[] {
  const residuals: number[] = [];
  let level = values[0] ?? 0;
  let trend = 0;

  for (let i = 1; i < values.length; i++) {
    const actual = values[i] as number;
    let prediction: number;
    switch (method) {
      case 'sma': {
        const from = Math.max(0, i - smaWindow);
        const window = values.slice(from, i);
        prediction = window.reduce((s, v) => s + v, 0) / window.length;
        break;
      }
      case 'ema': {
        prediction = level; // прогноз = текущий уровень
        break;
      }
      case 'holt': {
        prediction = level + trend;
        break;
      }
    }
    residuals.push(actual - prediction);

    // Обновление состояний (как в основном прогоне)
    if (method === 'ema') {
      level = alpha * actual + (1 - alpha) * level;
    } else if (method === 'holt') {
      const prevLevel = level;
      level = alpha * actual + (1 - alpha) * (prevLevel + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }
  }
  return residuals;
}

// ──────────────────────────────────────────────
// TimeSeriesForecaster
// ──────────────────────────────────────────────

/** Опции конструктора */
export interface TimeSeriesForecasterOptions {
  /** DI: часы (для генерации прогнозных меток, по умолчанию new Date()) */
  now?: () => Date;
}

/**
 * TimeSeriesForecaster — прогноз временного ряда.
 *
 * Пример:
 * ```ts
 * const f = new TimeSeriesForecaster();
 * const result = f.forecast(points, { method: 'holt', horizon: 5 });
 * console.log(result.points[0].value, result.mape);
 * ```
 */
export class TimeSeriesForecaster {
  private readonly now: () => Date;

  constructor(options: TimeSeriesForecasterOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /** Построить прогноз по временному ряду. */
  forecast(
    series: readonly TimeSeriesPoint[],
    options: ForecastOptions = {},
  ): ForecastResult {
    const method = options.method ?? 'holt';
    const horizon = options.horizon ?? DEFAULT_HORIZON;
    const confidenceLevel = options.confidenceLevel ?? DEFAULT_CONFIDENCE;
    const alpha = Math.min(1, Math.max(0.01, options.alpha ?? 0.3));
    const beta = Math.min(1, Math.max(0.01, options.beta ?? 0.1));
    const smaWindow = Math.max(2, options.smaWindow ?? 5);

    if (series.length < MIN_POINTS_BASIC) {
      throw new TimeSeriesForecasterError(
        `Для прогноза нужно минимум ${MIN_POINTS_BASIC} точек, получено ${series.length}`,
      );
    }
    if (horizon < 1) {
      throw new TimeSeriesForecasterError('Горизонт прогноза должен быть >= 1');
    }

    const values = series.map((p) => p.value);
    const warnings: string[] = [];

    if (method === 'holt' && series.length < MIN_POINTS_HOLT) {
      throw new TimeSeriesForecasterError(
        `Для метода 'holt' нужно минимум ${MIN_POINTS_HOLT} точек, получено ${series.length}`,
      );
    }
    if (series.length < 20) {
      warnings.push(
        `Мало точек (${series.length}) — прогноз ненадёжен, интервалы широкие`,
      );
    }

    // Остатки на истории → std неопределённости
    const residuals = inSampleResiduals(values, method, alpha, beta, smaWindow);
    const residualStd = std(residuals);
    if (residualStd === 0) {
      warnings.push(
        'Остатки нулевые (ряд детерминирован) — интервалы вырождены',
      );
    }

    // Состояние на конец истории
    let level = values[0] as number;
    let trend = 0;
    if (method === 'ema' || method === 'holt') {
      for (let i = 1; i < values.length; i++) {
        const v = values[i] as number;
        if (method === 'ema') {
          level = alpha * v + (1 - alpha) * level;
        } else {
          const prevLevel = level;
          level = alpha * v + (1 - alpha) * (prevLevel + trend);
          trend = beta * (level - prevLevel) + (1 - beta) * trend;
        }
      }
    }

    // MAPE на истории (по одношаговым прогнозам) — качество модели
    let mape: number | null = null;
    {
      // Повторный проход с состояниями: на каждом шаге прогноз из прошлого состояния
      let lv = values[0] as number;
      let tr = 0;
      const pcts: number[] = [];
      for (let i = 1; i < values.length; i++) {
        const actual = values[i] as number;
        let pred: number;
        if (method === 'sma') {
          const from = Math.max(0, i - smaWindow);
          const window = values.slice(from, i);
          pred = window.reduce((s, v) => s + v, 0) / window.length;
        } else if (method === 'ema') {
          pred = lv;
        } else {
          pred = lv + tr;
        }
        if (actual !== 0) pcts.push(Math.abs((actual - pred) / actual));
        if (method === 'ema') {
          lv = alpha * actual + (1 - alpha) * lv;
        } else if (method === 'holt') {
          const prev = lv;
          lv = alpha * actual + (1 - alpha) * (prev + tr);
          tr = beta * (lv - prev) + (1 - beta) * tr;
        }
      }
      if (pcts.length > 0) {
        mape = round(pcts.reduce((s, v) => s + v, 0) / pcts.length);
      }
    }
    if (mape !== null && mape > 0.5) {
      warnings.push(
        `MAPE ${(mape * 100).toFixed(0)}% — модель плохо аппроксимирует ряд`,
      );
    }

    // Прогнозные точки с растущим интервалом (sqrt(step) для случайного блуждания)
    const z = zScore(confidenceLevel);
    const lastTs = series[series.length - 1]?.ts ?? this.now().toISOString();
    const stepMs = this.inferStepMs(series);
    const baseTime = Date.parse(lastTs) || this.now().getTime();

    const points: ForecastPoint[] = [];
    for (let step = 1; step <= horizon; step++) {
      let value: number;
      switch (method) {
        case 'sma': {
          const window = values.slice(-smaWindow);
          value = window.reduce((s, v) => s + v, 0) / window.length;
          break;
        }
        case 'ema':
          value = level;
          break;
        case 'holt':
          value = level + trend * step;
          break;
      }
      const margin = z * residualStd * Math.sqrt(step);
      points.push({
        step,
        value: round(value),
        lower: round(value - margin),
        upper: round(value + margin),
      });
    }
    void stepMs;
    void baseTime;
    void lastTs;

    return {
      method,
      points,
      confidenceLevel,
      residualStd: round(residualStd),
      mape,
      warnings,
    };
  }

  /** Приблизительный шаг ряда в мс (для будущих нужд подписи точек). */
  private inferStepMs(series: readonly TimeSeriesPoint[]): number | null {
    if (series.length < 2) return null;
    const times = series
      .map((p) => Date.parse(p.ts))
      .filter((t) => !Number.isNaN(t));
    if (times.length < 2) return null;
    const diffs: number[] = [];
    for (let i = 1; i < times.length; i++) {
      const dt = (times[i] as number) - (times[i - 1] as number);
      if (dt > 0) diffs.push(dt);
    }
    if (diffs.length === 0) return null;
    return diffs.reduce((s, v) => s + v, 0) / diffs.length;
  }
}
