/**
 * SuccessMetrics — метрики успешности решений (подзадача 1.1.2).
 *
 * Вычисляет по связкам «решение → результат» (DecisionOutcomePair):
 * - Win rate (доля позитивных исходов среди реализованных)
 * - ROI (средний по позитивным/всем с известным ROI)
 * - Satisfaction score (средняя оценка директора 1..5)
 * - Confidence accuracy: |avgConfidence - winRate| — насколько модель
 *   честно оценивает свою уверенность (0 = идеально калибрована)
 *
 * Все функции чистые, без побочных эффектов и обращения к БД.
 */

import type {
  DecisionOutcomePair,
  CategoryMetrics,
  SystemMetrics,
  TrendPoint,
} from './types.js';

// ──────────────────────────────────────────────
// Константы
// ──────────────────────────────────────────────

/** Период тренда по умолчанию (дней) */
export const DEFAULT_TREND_DAYS = 14;

// ──────────────────────────────────────────────
// Чистые функции агрегации
// ──────────────────────────────────────────────

/** Вычислить агрегаты для подмножества связок */
export function computeAggregates(pairs: readonly DecisionOutcomePair[]): {
  total: number;
  implemented: number;
  positive: number;
  negative: number;
  ignored: number;
  winRate: number;
  avgConfidence: number;
  avgSatisfaction: number;
  avgRoi: number;
  avgActionDelayMs: number;
  confidenceAccuracy: number;
} {
  const total = pairs.length;
  const implemented = pairs.filter(
    (p) => p.outcome !== null && p.outcome.implemented,
  ).length;
  const positive = pairs.filter(
    (p) => p.outcome?.outcome === 'positive',
  ).length;
  const negative = pairs.filter(
    (p) => p.outcome?.outcome === 'negative',
  ).length;
  const ignored = pairs.filter((p) => p.outcome?.outcome === 'ignored').length;

  // Win rate: позитивные / реализованные (0, если нет реализованных)
  const implementedPairs = pairs.filter(
    (p) => p.outcome !== null && p.outcome.implemented,
  );
  const positiveAmongImplemented = implementedPairs.filter(
    (p) => p.outcome?.outcome === 'positive',
  ).length;
  const winRate =
    implementedPairs.length > 0
      ? positiveAmongImplemented / implementedPairs.length
      : 0;

  // Средняя уверенность по всем решениям
  const avgConfidence =
    total > 0
      ? pairs.reduce((sum, p) => sum + p.decision.confidence, 0) / total
      : 0;

  // Средняя удовлетворённость по результатам с оценкой
  const satisfactionValues = pairs
    .map((p) => p.outcome?.satisfaction)
    .filter((v): v is number => typeof v === 'number');
  const avgSatisfaction =
    satisfactionValues.length > 0
      ? satisfactionValues.reduce((s, v) => s + v, 0) /
        satisfactionValues.length
      : 0;

  // Средний ROI по результатам с известным ROI
  const roiValues = pairs
    .map((p) => p.outcome?.roiPercent)
    .filter((v): v is number => typeof v === 'number');
  const avgRoi =
    roiValues.length > 0
      ? roiValues.reduce((s, v) => s + v, 0) / roiValues.length
      : 0;

  // Средняя задержка действия
  const delayValues = pairs
    .map((p) => p.outcome?.actionDelayMs)
    .filter((v): v is number => typeof v === 'number' && v >= 0);
  const avgActionDelayMs =
    delayValues.length > 0
      ? delayValues.reduce((s, v) => s + v, 0) / delayValues.length
      : 0;

  // Confidence accuracy: насколько winRate совпадает с заявленной уверенностью
  const confidenceAccuracy =
    implementedPairs.length > 0 ? Math.abs(avgConfidence - winRate) : 0;

  return {
    total,
    implemented,
    positive,
    negative,
    ignored,
    winRate,
    avgConfidence,
    avgSatisfaction,
    avgRoi,
    avgActionDelayMs,
    confidenceAccuracy,
  };
}

/** Округление до N знаков (для стабильных снапшотов в тестах) */
function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Метрики по категории */
export function computeCategoryMetrics(
  pairs: readonly DecisionOutcomePair[],
  category: string,
): CategoryMetrics {
  const agg = computeAggregates(pairs);
  return {
    category,
    totalDecisions: agg.total,
    implementedCount: agg.implemented,
    positiveCount: agg.positive,
    negativeCount: agg.negative,
    ignoredCount: agg.ignored,
    winRate: round(agg.winRate),
    avgConfidence: round(agg.avgConfidence),
    avgSatisfaction: round(agg.avgSatisfaction),
    avgRoi: round(agg.avgRoi),
    avgActionDelayMs: Math.round(agg.avgActionDelayMs),
  };
}

/** Группировка по дню (YYYY-MM-DD) по decision.createdAt */
export function groupByDay(
  pairs: readonly DecisionOutcomePair[],
): Map<string, DecisionOutcomePair[]> {
  const groups = new Map<string, DecisionOutcomePair[]>();
  for (const pair of pairs) {
    const day = pair.decision.createdAt.slice(0, 10);
    const list = groups.get(day);
    if (list) {
      list.push(pair);
    } else {
      groups.set(day, [pair]);
    }
  }
  return groups;
}

/** Тренд за последние N дней (включая дни без решений — с нулями) */
export function computeTrend(
  pairs: readonly DecisionOutcomePair[],
  days = DEFAULT_TREND_DAYS,
  now: Date = new Date(),
): TrendPoint[] {
  const byDay = groupByDay(pairs);
  const points: TrendPoint[] = [];
  const msPerDay = 86_400_000;
  const todayMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  for (let i = days - 1; i >= 0; i--) {
    const dayMs = todayMs - i * msPerDay;
    const day = new Date(dayMs).toISOString().slice(0, 10);
    const dayPairs = byDay.get(day) ?? [];
    const agg = computeAggregates(dayPairs);
    points.push({
      date: day,
      winRate: round(agg.winRate),
      decisionCount: agg.total,
      avgSatisfaction: round(agg.avgSatisfaction),
      avgRoi: round(agg.avgRoi),
    });
  }
  return points;
}

// ──────────────────────────────────────────────
// SuccessMetrics — фасад
// ──────────────────────────────────────────────

/** Опции SuccessMetrics */
export interface SuccessMetricsOptions {
  /** DI: часы для детерминированных тестов (по умолчанию new Date()) */
  now?: () => Date;
  /** Период тренда в днях (по умолчанию DEFAULT_TREND_DAYS) */
  trendDays?: number;
}

/**
 * SuccessMetrics — расчёт метрик из связок OutcomeTracker.
 */
export class SuccessMetrics {
  private readonly now: () => Date;
  private readonly trendDays: number;

  constructor(options: SuccessMetricsOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.trendDays = options.trendDays ?? DEFAULT_TREND_DAYS;
  }

  /** Общие метрики системы по всем связкам. */
  computeSystemMetrics(pairs: readonly DecisionOutcomePair[]): SystemMetrics {
    // Метрики по категориям
    const categories = new Map<string, DecisionOutcomePair[]>();
    for (const pair of pairs) {
      const list = categories.get(pair.decision.category);
      if (list) {
        list.push(pair);
      } else {
        categories.set(pair.decision.category, [pair]);
      }
    }
    const byCategory = [...categories.entries()]
      .map(([category, catPairs]) => computeCategoryMetrics(catPairs, category))
      .sort((a, b) => b.totalDecisions - a.totalDecisions);

    // Метрики по тикерам
    const tickers = new Map<string, DecisionOutcomePair[]>();
    for (const pair of pairs) {
      for (const ticker of pair.decision.tickers) {
        const key = ticker.toUpperCase();
        const list = tickers.get(key);
        if (list) {
          list.push(pair);
        } else {
          tickers.set(key, [pair]);
        }
      }
    }
    const byTicker: Record<string, CategoryMetrics> = {};
    for (const [ticker, tPairs] of tickers.entries()) {
      byTicker[ticker] = computeCategoryMetrics(tPairs, ticker);
    }

    // Метрики по агентам
    const agents = new Map<string, DecisionOutcomePair[]>();
    for (const pair of pairs) {
      for (const role of pair.decision.agentRoles) {
        const list = agents.get(role);
        if (list) {
          list.push(pair);
        } else {
          agents.set(role, [pair]);
        }
      }
    }
    const byAgent: Record<string, CategoryMetrics> = {};
    for (const [role, aPairs] of agents.entries()) {
      byAgent[role] = computeCategoryMetrics(aPairs, role);
    }

    // Общие агрегаты
    const agg = computeAggregates(pairs);
    return {
      totalDecisions: agg.total,
      totalOutcomes: pairs.filter((p) => p.matched).length,
      overallWinRate: round(agg.winRate),
      implementationRate:
        agg.total > 0 ? round(agg.implemented / agg.total) : 0,
      avgConfidence: round(agg.avgConfidence),
      avgSatisfaction: round(agg.avgSatisfaction),
      avgRoi: round(agg.avgRoi),
      byCategory,
      byTicker,
      byAgent,
      trend: computeTrend(pairs, this.trendDays, this.now()),
    };
  }

  /** Метрики по конкретной категории. */
  computeForCategory(
    pairs: readonly DecisionOutcomePair[],
    category: string,
  ): CategoryMetrics {
    return computeCategoryMetrics(
      pairs.filter((p) => p.decision.category === category),
      category,
    );
  }
}
