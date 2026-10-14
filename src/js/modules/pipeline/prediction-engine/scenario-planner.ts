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
import type { NewsImpact } from '../news-driver/types.js';
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

/** Ранг важности новости (для выбора сильнейшего impact'а) */
const NEWS_IMPORTANCE_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  noise: 0,
};

/** Корректировка сценариев по новостному фону */
export interface NewsScenarioAdjustment {
  /** Сдвиг базового сценария, % от последнего значения */
  baseShiftPercent: number;
  /** Сдвиг оптимистичного сценария, % */
  bestShiftPercent: number;
  /** Сдвиг пессимистичного сценария, % */
  worstShiftPercent: number;
  /** Честное описание учёта новостного фона (null — фон не учитывался) */
  note: string | null;
}

/** Нейтральная корректировка (новостной фон не учитывается) */
export const NEUTRAL_NEWS_ADJUSTMENT: NewsScenarioAdjustment = {
  baseShiftPercent: 0,
  bestShiftPercent: 0,
  worstShiftPercent: 0,
  note: null,
};

/**
 * Вычислить корректировку сценариев по новостному фону.
 * Берётся сильнейший impact (|сентимент| × важность):
 * - негатив → пессимистичный сценарий усиливается, базовый слегка снижается;
 * - позитив → оптимистичный сценарий усиливается, базовый слегка растёт.
 */
export function computeNewsAdjustment(
  impacts: readonly NewsImpact[] | undefined,
): NewsScenarioAdjustment {
  if (!impacts || impacts.length === 0) return NEUTRAL_NEWS_ADJUSTMENT;

  let strongest: NewsImpact | null = null;
  let strongestStrength = 0;
  for (const impact of impacts) {
    const rank = NEWS_IMPORTANCE_RANK[impact.importance] ?? 0;
    const strength = Math.abs(impact.sentimentScore) * rank;
    if (strength > strongestStrength) {
      strongest = impact;
      strongestStrength = strength;
    }
  }

  if (!strongest || strongestStrength <= 0) return NEUTRAL_NEWS_ADJUSTMENT;

  const magnitude = Math.min(
    1,
    Math.abs(strongest.sentimentScore) *
      ((NEWS_IMPORTANCE_RANK[strongest.importance] ?? 0) / 4),
  );

  if (strongest.impactDirection === 'negative') {
    return {
      baseShiftPercent: -0.5 * magnitude,
      bestShiftPercent: -0.25 * magnitude,
      worstShiftPercent: -1.5 * magnitude,
      note:
        `Новостной фон негативный по ${strongest.ticker} ` +
        `(сентимент ${strongest.sentimentScore.toFixed(2)}) — пессимистичный сценарий усилен.`,
    };
  }

  if (strongest.impactDirection === 'positive') {
    return {
      baseShiftPercent: 0.5 * magnitude,
      bestShiftPercent: 1.5 * magnitude,
      worstShiftPercent: 0.25 * magnitude,
      note:
        `Новостной фон позитивный по ${strongest.ticker} ` +
        `(сентимент ${strongest.sentimentScore.toFixed(2)}) — оптимистичный сценарий усилен.`,
    };
  }

  return NEUTRAL_NEWS_ADJUSTMENT;
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

  /** Построить сценарии best/base/worst для ряда (с учётом новостного фона). */
  plan(
    series: readonly TimeSeriesPoint[],
    newsImpacts?: readonly NewsImpact[],
  ): ScenarioPlanResult {
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

    // Новостной фон: сдвиг сценариев в % от последнего значения
    const newsAdjustment = computeNewsAdjustment(newsImpacts);
    if (newsAdjustment.note) {
      warnings.push(newsAdjustment.note);
    }

    const scenarios: PlannedScenario[] = [];

    for (const kind of ['base', 'best', 'worst'] as const) {
      const shiftPercent =
        kind === 'base'
          ? newsAdjustment.baseShiftPercent
          : kind === 'best'
            ? newsAdjustment.bestShiftPercent
            : newsAdjustment.worstShiftPercent;
      const points = baseForecast.points.map((p) => {
        // Смещение конуса неопределённости: ± k·σ·√step
        const shift =
          kind === 'base'
            ? 0
            : this.sigmaMultiplier *
              baseForecast.residualStd *
              Math.sqrt(p.step) *
              (kind === 'best' ? 1 : -1);
        // Новостной сдвиг: мультипликативно к прогнозной точке
        const newsShift = p.value * (shiftPercent / 100);
        const value = round(p.value + shift + newsShift);
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
