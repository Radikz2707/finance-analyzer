/**
 * ABTestEngine — A/B тестирование подходов (подзадача 1.1.3).
 *
 * Позволяет сравнивать разные варианты рекомендаций (например, «агрессивный»
 * vs «консервативный» подход) и определять статистически значимого победителя.
 *
 * Распределение по вариантам: детерминированное хэш-распределение по ключу
 * субъекта (например, category+ticker) — воспроизводимо и сбалансировано.
 *
 * Статистическая значимость: двухпропорциональный z-тест для conversion rate
 * (win rate). p-value < 0.05 → победитель объявляется.
 *
 * Хранилище: in-memory + опциональный DI-персистенс (через `saveState` /
 * `loadState` коллбеки), чтобы фасад FeedbackLoop мог сохранять состояние.
 */

import { randomUUID } from 'node:crypto';
import type {
  ABTest,
  ABTestVariant,
  ABTestResult,
  VariantComparison,
  CreateABTestParams,
} from './types.js';

// ──────────────────────────────────────────────
// Ошибки
// ──────────────────────────────────────────────

/** Ошибка ABTestEngine */
export class ABTestEngineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ABTestEngineError';
  }
}

// ──────────────────────────────────────────────
// Статистика
// ──────────────────────────────────────────────

/** FNV-1a хэш (32 бит) — детерминированное распределение */
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Нормальная CDF (approximation, Zelen & Severo) — для p-value z-теста */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - (Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)) * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

/**
 * Двухпропорциональный z-тест: p-value различия двух conversion rates.
 * При n1 или n2 = 0 возвращает p = 1 (нет данных — нет различий).
 */
export function twoProportionZTest(
  conversions1: number,
  n1: number,
  conversions2: number,
  n2: number,
): number {
  if (n1 === 0 || n2 === 0) return 1;
  const p1 = conversions1 / n1;
  const p2 = conversions2 / n2;
  const pooled = (conversions1 + conversions2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 1; // идентичные пропорции
  const z = Math.abs((p1 - p2) / se);
  return round(2 * (1 - normalCdf(z)), 6);
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ──────────────────────────────────────────────
// ABTestEngine
// ──────────────────────────────────────────────

/** Событие результата одного показа варианта */
export interface ABTestObservation {
  /** ID теста */
  testId: string;
  /** ID варианта */
  variantId: string;
  /** Был ли позитивный исход (конверсия) */
  converted: boolean;
  /** ROI в процентах (опционально) */
  roiPercent?: number;
  /** Удовлетворённость 1..5 (опционально) */
  satisfaction?: number;
}

/** Опции ABTestEngine */
export interface ABTestEngineOptions {
  /** DI: часы (по умолчанию new Date()) */
  now?: () => Date;
  /** Порог p-value для объявления победителя (по умолчанию 0.05) */
  significanceLevel?: number;
  /** Минимальный размер выборки на вариант для выводов (по умолчанию 30) */
  minSampleSize?: number;
  /** ID-генератор (для детерминированных тестов) */
  generateId?: () => string;
}

/**
 * ABTestEngine — управление A/B тестами рекомендаций.
 *
 * Пример:
 * ```ts
 * const engine = new ABTestEngine();
 * const test = engine.createTest({
 *   name: 'risk-approach',
 *   variants: [
 *     { name: 'A', description: 'Консервативный', params: { risk: 'low' } },
 *     { name: 'B', description: 'Агрессивный', params: { risk: 'high' } },
 *   ],
 * });
 * const variantId = engine.assignVariant(test.id, 'SBER:asset');
 * engine.recordObservation({ testId: test.id, variantId, converted: true, roiPercent: 8 });
 * const { winnerVariantId, pValue } = engine.analyzeTest(test.id);
 * ```
 */
export class ABTestEngine {
  private readonly tests = new Map<string, ABTest>();
  private readonly observations = new Map<string, ABTestObservation[]>();
  private readonly now: () => Date;
  private readonly significanceLevel: number;
  private readonly minSampleSize: number;
  private readonly generateId: () => string;

  constructor(options: ABTestEngineOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.significanceLevel = options.significanceLevel ?? 0.05;
    this.minSampleSize = options.minSampleSize ?? 30;
    this.generateId = options.generateId ?? randomUUID;
  }

  /** Создать новый тест. */
  createTest(params: CreateABTestParams): ABTest {
    if (!params.variants || params.variants.length < 2) {
      throw new ABTestEngineError('A/B тест требует минимум 2 варианта');
    }
    const variants: ABTestVariant[] = params.variants.map((v) => ({
      ...v,
      id: this.generateId(),
    }));
    const test: ABTest = {
      id: this.generateId(),
      name: params.name,
      description: params.description ?? '',
      variants,
      status: 'running',
      results: variants.map((v) => this.emptyResult(params.name, v.id)),
      createdAt: this.now().toISOString(),
      metadata: params.metadata,
    };
    this.tests.set(test.id, test);
    this.observations.set(test.id, []);
    return test;
  }

  /** Детерминированно назначить вариант по ключу субъекта. */
  assignVariant(testId: string, subjectKey: string): string {
    const test = this.getTest(testId);
    const index = fnv1aHash(subjectKey) % test.variants.length;
    const variant = test.variants[index];
    if (!variant) {
      throw new ABTestEngineError(
        `Не удалось назначить вариант для ключа "${subjectKey}"`,
      );
    }
    return variant.id;
  }

  /** Записать наблюдение результата для варианта. */
  recordObservation(observation: ABTestObservation): void {
    const test = this.getTest(observation.testId);
    if (test.status !== 'running') {
      throw new ABTestEngineError(
        `Тест "${observation.testId}" завершён (${test.status}) — наблюдения не принимаются`,
      );
    }
    if (!test.variants.some((v) => v.id === observation.variantId)) {
      throw new ABTestEngineError(
        `Вариант "${observation.variantId}" не найден в тесте "${observation.testId}"`,
      );
    }
    const list = this.observations.get(observation.testId);
    if (list) {
      list.push(observation);
    }
  }

  /** Пересчитать результаты теста по накопленным наблюдениям. */
  refreshResults(testId: string): ABTestResult[] {
    const test = this.getTest(testId);
    const observations = this.observations.get(testId) ?? [];
    test.results = test.variants.map((variant) => {
      const vObs = observations.filter((o) => o.variantId === variant.id);
      const impressions = vObs.length;
      const conversions = vObs.filter((o) => o.converted).length;
      const roiValues = vObs
        .map((o) => o.roiPercent)
        .filter((v): v is number => typeof v === 'number');
      const satisfactionValues = vObs
        .map((o) => o.satisfaction)
        .filter((v): v is number => typeof v === 'number');
      return {
        testId,
        variantId: variant.id,
        impressions,
        conversions,
        conversionRate: impressions > 0 ? round(conversions / impressions) : 0,
        avgRoi:
          roiValues.length > 0
            ? round(roiValues.reduce((s, v) => s + v, 0) / roiValues.length)
            : 0,
        avgSatisfaction:
          satisfactionValues.length > 0
            ? round(
                satisfactionValues.reduce((s, v) => s + v, 0) /
                  satisfactionValues.length,
              )
            : 0,
      };
    });
    return test.results;
  }

  /**
   * Анализ теста: сравнение вариантов, p-value, определение победителя.
   * Победитель объявляется при p-value < significanceLevel И достаточном
   * размере выборки (minSampleSize) на вариант.
   */
  analyzeTest(testId: string): {
    comparisons: VariantComparison[];
    winnerVariantId?: string;
    pValue?: number;
    sufficientData: boolean;
  } {
    const test = this.getTest(testId);
    this.refreshResults(testId);

    if (test.variants.length !== 2) {
      // Для >2 вариантов: winner по conversion rate без p-value
      const comparisons = this.buildComparisons(test);
      const best = [...comparisons].sort(
        (a, b) => b.conversionRate - a.conversionRate,
      )[0];
      if (best) best.isWinner = true;
      return { comparisons, sufficientData: false };
    }

    const r1 = test.results[0];
    const r2 = test.results[1];
    if (!r1 || !r2) {
      throw new ABTestEngineError(
        `У теста "${testId}" меньше 2 вариантов с результатами`,
      );
    }
    const pValue = twoProportionZTest(
      r1.conversions,
      r1.impressions,
      r2.conversions,
      r2.impressions,
    );
    test.pValue = pValue;

    const comparisons = this.buildComparisons(test);
    const sufficientData =
      r1.impressions >= this.minSampleSize &&
      r2.impressions >= this.minSampleSize;

    let winnerVariantId: string | undefined;
    if (sufficientData && pValue < this.significanceLevel) {
      const winner = r1.conversionRate >= r2.conversionRate ? r1 : r2;
      if (winner) {
        winnerVariantId = winner.variantId;
      }
      for (const c of comparisons) {
        c.isWinner = c.variantId === winnerVariantId;
        c.isLoser = !c.isWinner;
      }
      test.winnerVariantId = winnerVariantId;
    }

    return { comparisons, winnerVariantId, pValue, sufficientData };
  }

  /** Завершить тест (перестаёт принимать наблюдения). */
  completeTest(testId: string): ABTest {
    const test = this.getTest(testId);
    this.refreshResults(testId);
    test.status = 'completed';
    test.completedAt = this.now().toISOString();
    return test;
  }

  /** Отменить тест. */
  cancelTest(testId: string): ABTest {
    const test = this.getTest(testId);
    test.status = 'cancelled';
    test.completedAt = this.now().toISOString();
    return test;
  }

  /** Получить тест по ID. */
  getTest(testId: string): ABTest {
    const test = this.tests.get(testId);
    if (!test) {
      throw new ABTestEngineError(`Тест "${testId}" не найден`);
    }
    return test;
  }

  /** Все тесты. */
  getAllTests(): ABTest[] {
    return [...this.tests.values()];
  }

  /** Активные (running) тесты. */
  getRunningTests(): ABTest[] {
    return this.getAllTests().filter((t) => t.status === 'running');
  }

  /** Экспорт состояния (для персистентности фасадом). */
  exportState(): { tests: ABTest[]; observations: ABTestObservation[] } {
    return {
      tests: this.getAllTests().map((t) => ({ ...t })),
      observations: [...this.observations.values()]
        .flat()
        .map((o) => ({ ...o })),
    };
  }

  /** Импорт состояния (восстановление после перезапуска). */
  importState(state: {
    tests: ABTest[];
    observations: ABTestObservation[];
  }): void {
    this.tests.clear();
    this.observations.clear();
    for (const test of state.tests) {
      this.tests.set(test.id, { ...test });
      this.observations.set(test.id, []);
    }
    for (const obs of state.observations) {
      if (this.observations.has(obs.testId)) {
        this.observations.get(obs.testId)?.push(obs);
      }
    }
  }

  // ── приватные ──────────────────────────────────────────────────────────

  private emptyResult(testId: string, variantId: string): ABTestResult {
    return {
      testId,
      variantId,
      impressions: 0,
      conversions: 0,
      conversionRate: 0,
      avgRoi: 0,
      avgSatisfaction: 0,
    };
  }

  private buildComparisons(test: ABTest): VariantComparison[] {
    const maxRate = Math.max(...test.results.map((r) => r.conversionRate), 0);
    const minRate = Math.min(...test.results.map((r) => r.conversionRate), 1);
    const isTie = maxRate === minRate || test.results.length < 2;

    return test.results.map((result) => {
      const variant = test.variants.find((v) => v.id === result.variantId);
      // Уверенность сравнения: 1 - p-value, но только при достаточной выборке
      const enough =
        result.impressions >= this.minSampleSize &&
        typeof test.pValue === 'number';
      return {
        variantId: result.variantId,
        variantName: variant?.name ?? result.variantId,
        conversionRate: result.conversionRate,
        avgRoi: result.avgRoi,
        avgSatisfaction: result.avgSatisfaction,
        sampleSize: result.impressions,
        confidence: enough ? round(1 - (test.pValue ?? 1)) : 0,
        isWinner: false,
        isLoser: false,
        isTie,
      };
    });
  }
}
