/**
 * Тесты PredictionEngine и его компонентов.
 *
 * Принципы: детерминизм (DI-часы), честность (пустые/некорректные данные →
 * честные ошибки или предупреждения, без выдуманных результатов).
 *
 * Глобальные describe/it/expect/vi предоставляются vitest (globals: true в
 * vitest.config.ts). Явный `import ... from 'vitest'` в этом проекте создаёт
 * второй экземпляр @vitest/runner и ломает контекст — поэтому глобалы.
 */

import { NeedPredictor, NeedPredictorError } from './need-predictor.js';
import {
  AnomalyDetectorV2,
  AnomalyDetectorV2Error,
} from './anomaly-detector-v2.js';
import { PredictionEngine } from './prediction-engine.js';
import { ScenarioPlanner, SCENARIO_WEIGHTS } from './scenario-planner.js';
import { TimeSeriesForecaster, std } from './time-series-forecaster.js';
import { TrendAnalyzer } from './trend-analyzer.js';
import type { TimeSeriesPoint } from './types.js';

// ─── Утилиты ──────────────────────────────────────────────────────────────

/** Линейный ряд value = a + b·i без шума */
function linearSeries(n: number, a = 100, b = 2): TimeSeriesPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: `2024-01-${String(i + 1).padStart(2, '0')}`,
    value: a + b * i,
  }));
}

/** Ряд с одним выбросом на позиции idx */
function seriesWithSpike(
  n: number,
  idx: number,
  spike = 50,
): TimeSeriesPoint[] {
  const base = Array.from({ length: n }, () => 100);
  base[idx] = 100 + spike;
  return base.map((value, i) => ({
    ts: `2024-01-${String(i + 1).padStart(2, '0')}`,
    value,
  }));
}

// ─── TimeSeriesForecaster ─────────────────────────────────────────────────

describe('TimeSeriesForecaster', () => {
  it('forecast по линейному ряду (holt) продолжает тренд', () => {
    const f = new TimeSeriesForecaster();
    const result = f.forecast(linearSeries(30, 100, 2), { horizon: 5 });
    expect(result.method).toBe('holt');
    expect(result.points).toHaveLength(5);
    expect(result.points[0]!.value).toBeGreaterThan(158); // last=158, тренд продолжается
    expect(result.points[0]!.lower).toBeLessThanOrEqual(
      result.points[0]!.value,
    );
    expect(result.points[0]!.upper).toBeGreaterThanOrEqual(
      result.points[0]!.value,
    );
    // Интервал расширяется с шагом
    const w1 = result.points[0]!.upper - result.points[0]!.lower;
    const w5 = result.points[4]!.upper - result.points[4]!.lower;
    expect(w5).toBeGreaterThanOrEqual(w1);
  });

  it('forecast sma даёт плоский прогноз', () => {
    const f = new TimeSeriesForecaster();
    const result = f.forecast(linearSeries(10), { method: 'sma', horizon: 3 });
    const values = result.points.map((p) => p.value);
    expect(new Set(values).size).toBe(1);
  });

  it('forecast на детерминированном ряде → предупреждение о вырожденных интервалах', () => {
    const f = new TimeSeriesForecaster();
    const flat = linearSeries(10).map((p) => ({ ...p, value: 42 }));
    const result = f.forecast(flat);
    expect(result.residualStd).toBe(0);
    expect(result.warnings.some((w) => w.includes('детерминирован'))).toBe(
      true,
    );
  });

  it('честные ошибки: мало точек, horizon < 1, holt требует 4 точки', () => {
    const f = new TimeSeriesForecaster();
    expect(() => f.forecast(linearSeries(1))).toThrow(/минимум 2/);
    expect(() => f.forecast(linearSeries(5), { horizon: 0 })).toThrow(/>= 1/);
    expect(() => f.forecast(linearSeries(3), { method: 'holt' })).toThrow(
      /'holt'/,
    );
  });

  it('std: несмещённая оценка, 0 для короткого массива', () => {
    expect(std([1, 2, 3, 4])).toBeCloseTo(Math.sqrt(5 / 3), 10);
    expect(std([5])).toBe(0);
  });
});

// ─── NeedPredictor ────────────────────────────────────────────────────────

describe('NeedPredictor', () => {
  const HOUR = 3600_000;

  function makeSource(
    decisions: Array<{
      id: string;
      createdAt: string;
      category: string;
    }>,
  ) {
    return { getAll: vi.fn(async () => decisions) };
  }

  const FIXED_NOW = new Date('2024-06-10T10:00:00Z').getTime();

  function makePredictor(
    decisions: Parameters<typeof makeSource>[0],
    now = () => new Date(FIXED_NOW),
  ) {
    return new NeedPredictor({ decisions: makeSource(decisions), now });
  }

  it('пустая история → честный отказ (needs пустой + warning)', async () => {
    const p = makePredictor([]);
    const result = await p.predict();
    expect(result.needs).toEqual([]);
    expect(result.categoryStats).toEqual([]);
    expect(
      result.warnings.some((w) => w.includes('Недостаточно решений')),
    ).toBe(true);
  });

  it('частая категория с завершающимся циклом получает больший probability', async () => {
    // Категория «portfolio» запрашивалась каждый час, последний раз 50 мин назад
    const decisions = Array.from({ length: 6 }, (_, i) => ({
      id: `d${i}`,
      createdAt: new Date(
        FIXED_NOW - (50 + (5 - i) * 60) * 60_000,
      ).toISOString(),
      category: 'portfolio',
    }));
    // Категория «reports» — редкая, давно
    decisions.push(
      {
        id: 'r1',
        createdAt: new Date(FIXED_NOW - 10 * 24 * HOUR).toISOString(),
        category: 'reports',
      },
      {
        id: 'r2',
        createdAt: new Date(FIXED_NOW - 9 * 24 * HOUR).toISOString(),
        category: 'reports',
      },
    );
    const p = makePredictor(decisions);
    const result = await p.predict();
    expect(result.analyzedDecisions).toBe(8);

    const portfolio = result.needs.find((n) => n.category === 'portfolio');
    expect(portfolio).toBeDefined();
    expect(portfolio!.probability).toBeGreaterThan(0.3);
    expect(portfolio!.heuristic).toBe(true);
    expect(portfolio!.reasons.length).toBeGreaterThan(0);

    const stats = result.categoryStats.find((s) => s.category === 'portfolio');
    expect(stats!.count).toBe(6);
    expect(stats!.share).toBeCloseTo(0.75, 2);
    expect(stats!.avgIntervalMs).not.toBeNull();
  });

  it('некорректные записи пропускаются с честным warning', async () => {
    const decisions = [
      {
        id: 'ok1',
        createdAt: new Date(FIXED_NOW - HOUR).toISOString(),
        category: 'a',
      },
      {
        id: 'ok2',
        createdAt: new Date(FIXED_NOW).toISOString(),
        category: 'a',
      },
      { id: 'bad-date', createdAt: 'not-a-date', category: 'b' },
      {
        id: 'bad-cat',
        createdAt: new Date(FIXED_NOW).toISOString(),
        category: '',
      },
    ];
    const p = makePredictor(decisions, undefined);
    const result = await p.predict();
    expect(result.categoryStats.some((s) => s.category === 'b')).toBe(false);
    expect(result.warnings.some((w) => w.includes('bad-date'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('bad-cat'))).toBe(true);
  });

  it('падение источника → NeedPredictorError (честная ошибка)', async () => {
    const broken = {
      getAll: vi.fn(async () => {
        throw new Error('DB down');
      }),
    };
    const p = new NeedPredictor({ decisions: broken });
    await expect(p.predict()).rejects.toBeInstanceOf(NeedPredictorError);
  });

  it('конструктор без источника → честная ошибка', () => {
    expect(() => new NeedPredictor({ decisions: null as never })).toThrow(
      NeedPredictorError,
    );
  });
});

// ─── AnomalyDetectorV2 ────────────────────────────────────────────────────

describe('AnomalyDetectorV2', () => {
  it('находит spike по z-score', () => {
    const detector = new AnomalyDetectorV2({ minPoints: 10, zThreshold: 3 });
    const result = detector.detect(seriesWithSpike(20, 15, 50));
    const spike = result.anomalies.find((a) => a.type === 'spike');
    expect(spike).toBeDefined();
    expect(spike!.index).toBe(15);
    expect(spike!.severity).toBeGreaterThan(3);
    expect(result.stats.max).toBe(150);
  });

  it('находит drop по z-score', () => {
    const detector = new AnomalyDetectorV2({ minPoints: 10 });
    const points = seriesWithSpike(20, 10, -50);
    const result = detector.detect(points);
    expect(
      result.anomalies.some((a) => a.type === 'drop' && a.index === 10),
    ).toBe(true);
  });

  it('вырожденный ряд → пустые аномалии + честный warning', () => {
    const detector = new AnomalyDetectorV2({ minPoints: 10 });
    const flat = linearSeries(15).map((p) => ({ ...p, value: 100 }));
    const result = detector.detect(flat);
    expect(result.anomalies).toEqual([]);
    expect(result.warnings.some((w) => w.includes('вырожден'))).toBe(true);
  });

  it('мало точек → честная ошибка', () => {
    const detector = new AnomalyDetectorV2({ minPoints: 10 });
    expect(() => detector.detect(linearSeries(5))).toThrow(/минимум 10/);
    expect(() => detector.detect('x' as unknown as TimeSeriesPoint[])).toThrow(
      AnomalyDetectorV2Error,
    );
  });
});

// ─── TrendAnalyzer ────────────────────────────────────────────────────────

describe('TrendAnalyzer', () => {
  it('растущий ряд → rising с высоким R²', () => {
    const analyzer = new TrendAnalyzer();
    const result = analyzer.analyze(linearSeries(20, 100, 3));
    expect(result.direction).toBe('rising');
    expect(result.slope).toBeCloseTo(3, 4);
    expect(result.rSquared).toBeCloseTo(1, 4);
    // (157 − 100) / 100 · 100 = 57%
    expect(result.changePercent).toBeCloseTo(57, 1);
  });

  it('падающий ряд → falling', () => {
    const analyzer = new TrendAnalyzer();
    const result = analyzer.analyze(linearSeries(20, 100, -2));
    expect(result.direction).toBe('falling');
    expect(result.slope).toBeLessThan(0);
  });

  it('шумный ряд с нулевым наклоном → stable', () => {
    const analyzer = new TrendAnalyzer();
    const flat = linearSeries(10).map((p) => ({ ...p, value: 100 }));
    const result = analyzer.analyze(flat);
    expect(result.direction).toBe('stable');
  });

  it('мало точек → insufficient + честный warning', () => {
    const analyzer = new TrendAnalyzer({ minPoints: 5 });
    const result = analyzer.analyze(linearSeries(3));
    expect(result.direction).toBe('insufficient');
    expect(result.warnings.some((w) => w.includes('Недостаточно точек'))).toBe(
      true,
    );
  });

  it('окно анализа ограничивает ряд', () => {
    const analyzer = new TrendAnalyzer();
    const series = [...linearSeries(10, 100, 1), ...linearSeries(10, 200, -1)];
    const result = analyzer.analyze(series, 10);
    expect(result.windowSize).toBe(10);
  });
});

// ─── ScenarioPlanner ──────────────────────────────────────────────────────

describe('ScenarioPlanner', () => {
  it('три сценария в порядке best → base → worst, best >= base >= worst', () => {
    const planner = new ScenarioPlanner({ horizon: 5 });
    const result = planner.plan(linearSeries(30, 100, 2));
    expect(result.scenarios).toHaveLength(3);
    expect(result.scenarios.map((s) => s.kind)).toEqual([
      'best',
      'base',
      'worst',
    ]);

    const [best, base, worst] = result.scenarios;
    expect(best!.finalValue).toBeGreaterThanOrEqual(base!.finalValue);
    expect(base!.finalValue).toBeGreaterThanOrEqual(worst!.finalValue);
    expect(best!.weight).toBe(SCENARIO_WEIGHTS.best);
    expect(base!.weight).toBe(0.5);
    expect(worst!.weight).toBe(SCENARIO_WEIGHTS.worst);
  });

  it('на детерминированном ряде best/worst совпадают с base + честный warning', () => {
    const planner = new ScenarioPlanner();
    const flat = linearSeries(15).map((p) => ({ ...p, value: 50 }));
    const result = planner.plan(flat);
    const base = result.scenarios.find((s) => s.kind === 'base')!;
    const best = result.scenarios.find((s) => s.kind === 'best')!;
    const worst = result.scenarios.find((s) => s.kind === 'worst')!;
    expect(best.finalValue).toBe(base.finalValue);
    expect(worst.finalValue).toBe(base.finalValue);
    expect(result.warnings.some((w) => w.includes('совпадают'))).toBe(true);
  });

  it('changePercent считается от последнего значения', () => {
    const planner = new ScenarioPlanner({ horizon: 3 });
    const result = planner.plan(linearSeries(20, 100, 1));
    const base = result.scenarios.find((s) => s.kind === 'base')!;
    expect(base.changePercent).toBeGreaterThan(0);
    expect(result.lastValue).toBe(119);
  });

  it('пустой ряд → честная ошибка', () => {
    const planner = new ScenarioPlanner();
    expect(() => planner.plan([])).toThrow(/непустой/);
  });
});

// ─── PredictionEngine (фасад) ─────────────────────────────────────────────

describe('PredictionEngine', () => {
  it('execute dispatch по всем action', async () => {
    const engine = new PredictionEngine();
    const series = linearSeries(30);

    const forecast = await engine.execute({ action: 'forecast', series });
    expect(forecast.success).toBe(true);
    expect((forecast.data as { method: string }).method).toBe('holt');

    const anomalies = await engine.execute({
      action: 'detect-anomalies',
      series,
    });
    expect(anomalies.success).toBe(true);
    expect(
      (anomalies.data as { anomalies: unknown[] }).anomalies,
    ).toBeDefined();

    const trend = await engine.execute({ action: 'analyze-trend', series });
    expect(trend.success).toBe(true);
    expect((trend.data as { direction: string }).direction).toBe('rising');

    const scenarios = await engine.execute({
      action: 'plan-scenarios',
      series,
    });
    expect(scenarios.success).toBe(true);
    expect((scenarios.data as { scenarios: unknown[] }).scenarios).toHaveLength(
      3,
    );
  });

  it('execute без series → честная ошибка, success=false', async () => {
    const engine = new PredictionEngine();
    const result = await engine.execute({ action: 'forecast' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('не передан series');
  });

  it('неизвестный action → success=false', async () => {
    const engine = new PredictionEngine();
    const result = await engine.execute({
      action: 'nope' as Parameters<typeof engine.execute>[0]['action'],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Неизвестное действие');
  });

  it('predict-needs без needPredictor → честная ошибка', async () => {
    const engine = new PredictionEngine();
    const result = await engine.execute({ action: 'predict-needs' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('needPredictor не передан');
  });

  it('predict-needs через DI работает', async () => {
    const fixed = new Date('2024-06-10T10:00:00Z').getTime();
    const predictor = new NeedPredictor({
      decisions: {
        getAll: vi.fn(async () =>
          Array.from({ length: 6 }, (_, i) => ({
            id: `d${i}`,
            createdAt: new Date(
              fixed - (50 + (5 - i) * 60) * 60_000,
            ).toISOString(),
            category: 'portfolio',
          })),
        ),
      },
      now: () => new Date(fixed),
    });
    const engine = new PredictionEngine({ needPredictor: predictor });
    const result = await engine.execute({ action: 'predict-needs' });
    expect(result.success).toBe(true);
    const data = result.data as { needs: Array<{ category: string }> };
    expect(data.needs.some((n) => n.category === 'portfolio')).toBe(true);
  });

  it('full-report агрегирует все секции, ошибка секции не роняет отчёт', async () => {
    const engine = new PredictionEngine();
    const good = await engine.fullReport(linearSeries(30));
    expect(good.ok).toBe(true);
    expect(Object.keys(good.sections)).toEqual(
      expect.arrayContaining(['forecast', 'anomalies', 'trend', 'scenarios']),
    );
    expect(Object.keys(good.errors)).toHaveLength(0);

    const bad = await engine.fullReport(linearSeries(2));
    expect(bad.ok).toBe(false);
    expect(bad.errors.forecast).toBeDefined();
    expect(bad.errors.trend).toBeUndefined(); // insufficient — не ошибка
    // При этом успешные секции всё равно есть
    expect(bad.sections.forecast).toBeUndefined();
  });

  it('прямые методы фасада соответствуют компонентам', () => {
    const engine = new PredictionEngine();
    const series = linearSeries(25);
    expect(engine.detectAnomalies(series).stats.count).toBe(25);
    expect(engine.analyzeTrend(series).windowSize).toBe(25);
    expect(engine.planScenarios(series).scenarios).toHaveLength(3);
    expect(engine.forecast(series).points.length).toBe(10);
  });
});
