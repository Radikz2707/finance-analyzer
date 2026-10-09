/**
 * ScenarioPlanner — сценарии best/worst/base на прогнозах временных рядов
 * (подзадача 1.2.5).
 *
 * Честная авторская реализация (НЕ расширение ScenarioAgent — тот работает
 * на портфельных «что если»-изменениях, здесь — прогнозы временных рядов):
 * - base: центральный прогноз TimeSeriesForecaster (Holt);
 * - best / worst: отклонение базового прогноза на sigmaMultiplier × residualStd
 *   × √step (расширяющийся конус неопределённости);
 * - веса фиксированные эвристические: base 0.5, best/worst по 0.25.
 *
 * Пример:
 * ```ts
 * const planner = new ScenarioPlanner({ forecaster });
 * const plan = planner.plan(series);
 * console.log(plan.scenarios.map((s) => `${s.kind}: ${s.finalValue}`));
 * ```
 */

import { TimeSeriesForecaster } from './time-series-forecaster.js';
import type {
  ForecastResult,
  PlannedScenario,
  ScenarioKind,
  ScenarioPlanResult,
  ScenarioPlannerOptions,
  TimeSeriesPoint,
} from './types.js';

// ──────────────────────────────────────────────
// Константы и ошибки
// ──────────────────────────────────────────────

/** Множитель сигмы по умолчанию для best/worst */
export const DEFAULT_SIGMA_MULTIPLIER = 2;
/** Горизонт по умолчанию */
export const DEFAULT_SCENARIO_HORIZON = 10;
/** Фиксированные честные веса сценариев (эвристика, без ML) */
export const SCENARIO_WEIGHTS: Record<ScenarioKind, number> = {
  base: 0.5,
  best: 0.25,
  worst: 0.25,
};

/** Ошибка ScenarioPlanner */
export class ScenarioPlannerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ScenarioPlannerError';
  }
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ──────────────────────────────────────────────
// ScenarioPlanner
// ──────────────────────────────────────────────

export class ScenarioPlanner {
  private readonly forecaster: TimeSeriesForecaster;
  private readonly sigmaMultiplier: number;
  private readonly horizon: number;

  constructor(
    options: ScenarioPlannerOptions & {
      forecaster?: TimeSeriesForecaster;
    } = {},
  ) {
    this.forecaster = options.forecaster ?? new TimeSeriesForecaster();
    this.sigmaMultiplier = Math.max(
      0.5,
      options.sigmaMultiplier ?? DEFAULT_SIGMA_MULTIPLIER,
    );
    this.horizon = Math.max(1, options.horizon ?? DEFAULT_SCENARIO_HORIZON);
  }

  /** Построить сценарии best/base/worst для ряда. */
  plan(series: readonly TimeSeriesPoint[]): ScenarioPlanResult {
    if (!Array.isArray(series) || series.length === 0) {
      throw new ScenarioPlannerError('plan(): ожидается непустой массив точек');
    }

    const baseForecast: ForecastResult = this.forecaster.forecast(series, {
      method: 'holt',
      horizon: this.horizon,
    });

    const warnings: string[] = [...baseForecast.warnings];
    const lastValue = series[series.length - 1]!.value;

    if (baseForecast.residualStd === 0) {
      warnings.push(
        'residualStd = 0 (детерминированный ряд) — best/worst совпадают с base',
      );
    }

    const scenarios: PlannedScenario[] = [];

    for (const kind of ['base', 'best', 'worst'] as const) {
      const points = baseForecast.points.map((p) => {
        // Смещение конуса неопределённости: ± k·σ·√step
        const shift =
          kind === 'base'
            ? 0
            : this.sigmaMultiplier *
              baseForecast.residualStd *
              Math.sqrt(p.step) *
              (kind === 'best' ? 1 : -1);
        const value = round(p.value + shift);
        return {
          step: p.step,
          value,
          lower: round(p.lower + (kind === 'best' ? shift : 0)),
          upper: round(p.upper + (kind === 'worst' ? shift : 0)),
        };
      });

      const finalPoint = points[points.length - 1]!;
      const changePercent =
        lastValue !== 0
          ? round(
              ((finalPoint.value - lastValue) / Math.abs(lastValue)) * 100,
              2,
            )
          : 0;

      if (lastValue === 0) {
        warnings.push(
          'Последнее значение ряда = 0 — changePercent = 0 (не определён)',
        );
      }

      const description =
        kind === 'base'
          ? `Базовый прогноз (${baseForecast.method}, MAPE ${baseForecast.mape ?? 'н/д'})`
          : kind === 'best'
            ? `Оптимистичный: базовый прогноз + ${this.sigmaMultiplier}σ·√step`
            : `Пессимистичный: базовый прогноз − ${this.sigmaMultiplier}σ·√step`;

      scenarios.push({
        kind,
        description,
        forecast: { ...baseForecast, points },
        finalValue: finalPoint.value,
        changePercent,
        weight: SCENARIO_WEIGHTS[kind],
      });
    }

    // Сортировка: best → base → worst (по finalValue убыванию не гарантируется при отрицательных, поэтому фиксируем порядок kind)
    const order: Record<ScenarioKind, number> = { best: 0, base: 1, worst: 2 };
    scenarios.sort((a, b) => order[a.kind] - order[b.kind]);

    return { scenarios, lastValue, warnings };
  }
}
