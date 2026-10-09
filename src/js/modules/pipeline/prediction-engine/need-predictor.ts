/**
 * NeedPredictor — предсказание потребностей директора (подзадача 1.2.2).
 *
 * Честная детерминированная эвристика (без ML и без LLM):
 * - частота категории → базовая вероятность;
 * - приближение цикла запроса (прошёл ли средний интервал) → буст;
 * - попадание текущего часа в пиковые часы категории → буст.
 *
 * Источник данных — история решений (FeedbackLoop DecisionSource), DI.
 * Пример:
 * ```ts
 * const p = new NeedPredictor({ decisions: feedbackLoop.decisions });
 * const result = await p.predict();
 * console.log(result.needs[0]?.category, result.needs[0]?.probability);
 * ```
 */

import type {
  NeedCategoryStats,
  NeedDecisionSource,
  NeedPredictionResult,
  PredictedNeed,
} from './types.js';

// ──────────────────────────────────────────────
// Константы и ошибки
// ──────────────────────────────────────────────

/** Горизонт прогноза по умолчанию: 1 час (мс) */
export const DEFAULT_HORIZON_MS = 60 * 60 * 1000;
/** Минимум решений для прогноза (меньше — честный отказ) */
export const MIN_DECISIONS_DEFAULT = 3;
/** Часы попадают в peakHours, если доля запросов в час >= этого порога */
export const PEAK_HOUR_MIN_SHARE = 0.2;

/** Ошибка NeedPredictor */
export class NeedPredictorError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NeedPredictorError';
  }
}

/** Опции NeedPredictor */
export interface NeedPredictorOptions {
  /** DI: источник решений (совместим с FeedbackLoop) */
  decisions: NeedDecisionSource;
  /** DI: часы (по умолчанию new Date()) */
  now?: () => Date;
  /** Минимум решений для прогноза (по умолчанию 3) */
  minDecisions?: number;
  /** Горизонт прогноза в мс (по умолчанию 1 час) */
  horizonMs?: number;
}

/** Служебная запись решения с числовой датой */
interface ParsedDecision {
  category: string;
  ts: number;
  hour: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ──────────────────────────────────────────────
// NeedPredictor
// ──────────────────────────────────────────────

export class NeedPredictor {
  private readonly decisions: NeedDecisionSource;
  private readonly now: () => Date;
  private readonly minDecisions: number;
  private readonly horizonMs: number;

  constructor(options: NeedPredictorOptions) {
    if (!options.decisions || typeof options.decisions.getAll !== 'function') {
      throw new NeedPredictorError(
        'NeedPredictor: требуется decisions-источник с методом getAll()',
      );
    }
    this.decisions = options.decisions;
    this.now = options.now ?? (() => new Date());
    this.minDecisions = Math.max(
      1,
      options.minDecisions ?? MIN_DECISIONS_DEFAULT,
    );
    this.horizonMs = Math.max(1, options.horizonMs ?? DEFAULT_HORIZON_MS);
  }

  /** Предсказать потребности по истории решений. */
  async predict(): Promise<NeedPredictionResult> {
    const warnings: string[] = [];
    let raw: Awaited<ReturnType<NeedDecisionSource['getAll']>>;
    try {
      raw = await this.decisions.getAll();
    } catch (error) {
      throw new NeedPredictorError(
        'NeedPredictor: не удалось прочитать историю решений',
        { cause: error },
      );
    }

    if (!Array.isArray(raw)) {
      throw new NeedPredictorError(
        'NeedPredictor: getAll() вернул не массив — источник повреждён',
      );
    }

    // Парсинг и сортировка по времени
    const parsed: ParsedDecision[] = [];
    for (const d of raw) {
      const ts = Date.parse(d.createdAt);
      if (!Number.isFinite(ts)) {
        warnings.push(`Решение ${d.id} пропущено: некорректная дата`);
        continue;
      }
      if (typeof d.category !== 'string' || d.category.trim() === '') {
        warnings.push(`Решение ${d.id} пропущено: пустая категория`);
        continue;
      }
      const hour = new Date(ts).getHours();
      parsed.push({ category: d.category, ts, hour });
    }
    parsed.sort((a, b) => a.ts - b.ts);

    if (parsed.length < this.minDecisions) {
      return {
        needs: [],
        categoryStats: [],
        analyzedDecisions: parsed.length,
        warnings: [
          `Недостаточно решений (${parsed.length} < ${this.minDecisions}) — прогноз не строится`,
          ...warnings,
        ],
      };
    }

    const nowTs = this.now().getTime();
    const nowHour = new Date(nowTs).getHours();

    // Агрегация по категориям
    const byCategory = new Map<string, ParsedDecision[]>();
    for (const d of parsed) {
      const list = byCategory.get(d.category);
      if (list) list.push(d);
      else byCategory.set(d.category, [d]);
    }

    const stats: NeedCategoryStats[] = [];
    const needs: PredictedNeed[] = [];

    for (const [category, list] of byCategory) {
      const count = list.length;
      const share = count / parsed.length;

      // Средний интервал между последовательными запросами категории
      let avgIntervalMs: number | null = null;
      if (count >= 2) {
        const gaps: number[] = [];
        for (let i = 1; i < list.length; i++) {
          gaps.push(list[i]!.ts - list[i - 1]!.ts);
        }
        avgIntervalMs = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      }

      // Пиковые часы: час встречается в >= PEAK_HOUR_MIN_SHARE запросов категории
      const hourCounts = new Map<number, number>();
      for (const d of list) {
        hourCounts.set(d.hour, (hourCounts.get(d.hour) ?? 0) + 1);
      }
      const peakHours = [...hourCounts.entries()]
        .filter(([, n]) => n / count >= PEAK_HOUR_MIN_SHARE)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .map(([h]) => h);

      const last = list[list.length - 1]!;
      const lastAt = new Date(last.ts).toISOString();

      stats.push({
        category,
        count,
        share: round(share),
        avgIntervalMs,
        peakHours,
        lastAt,
      });

      // ── Эвристика вероятности ──
      const reasons: string[] = [];
      // База: частотность категории
      const freqScore = clamp01(share * 3);
      reasons.push(
        `Частота категории: ${count} из ${parsed.length} решений (${round(share * 100)}%)`,
      );

      // Приближение цикла: доля прошедшего среднего интервала
      let cycleScore = 0;
      if (avgIntervalMs !== null) {
        const elapsed = nowTs - last.ts;
        const cycleRatio = clamp01(elapsed / avgIntervalMs);
        cycleScore = cycleRatio;
        if (cycleRatio >= 0.9) {
          reasons.push(
            `Цикл запроса близок к завершению: прошло ${round(elapsed / 3600000)}ч из среднего ${round(avgIntervalMs / 3600000)}ч`,
          );
        }
      }

      // Пиковый час
      const hourScore = peakHours.includes(nowHour) ? 1 : 0;
      if (hourScore === 1) {
        reasons.push(
          `Текущий час (${nowHour}:00) входит в пиковые часы категории`,
        );
      }

      const probability = round(
        clamp01(0.25 * freqScore + 0.45 * cycleScore + 0.3 * hourScore),
      );

      // Ожидаемое время: не раньше текущего момента
      let expectedAt: string | null = null;
      if (avgIntervalMs !== null && probability > 0) {
        const expectedTs = Math.max(nowTs, last.ts + avgIntervalMs);
        if (expectedTs - nowTs <= this.horizonMs) {
          expectedAt = new Date(expectedTs).toISOString();
        }
      }

      if (probability >= 0.15) {
        needs.push({
          category,
          probability,
          reasons,
          expectedAt,
          heuristic: true,
        });
      }
    }

    needs.sort(
      (a, b) =>
        b.probability - a.probability || a.category.localeCompare(b.category),
    );

    if (needs.length === 0) {
      warnings.push(
        'Ни одна категория не превысила порог вероятности 0.15 — прогнозов нет',
      );
    }

    return {
      needs,
      categoryStats: stats,
      analyzedDecisions: parsed.length,
      warnings,
    };
  }
}
