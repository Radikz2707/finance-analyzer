/**
 * Тесты FeedbackLoop (Задача 1.1): OutcomeTracker, SuccessMetrics,
 * ABTestEngine, ReinforcementLearning, фасад FeedbackLoop.
 */

// Глобальные describe/it/expect предоставляются vitest (globals: true в vitest.config.ts).
// Явный `import ... from 'vitest'` в этом проекте создаёт второй экземпляр
// @vitest/runner и ломает контекст — поэтому глобалы.
import {
  OutcomeTracker,
  OutcomeTrackerError,
  validateDecision,
  validateOutcome,
  SuccessMetrics,
  computeAggregates,
  computeTrend,
  ABTestEngine,
  ABTestEngineError,
  twoProportionZTest,
  ReinforcementLearning,
  ReinforcementLearningError,
  FeedbackLoop,
} from './index.js';
import type {
  DecisionRecord,
  OutcomeRecord,
  DecisionOutcomePair,
  LessonEntry,
} from './types.js';

// ──────────────────────────────────────────────
// Хелперы
// ──────────────────────────────────────────────

function makeDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: overrides.id ?? '',
    createdAt: overrides.createdAt ?? '2026-10-01T10:00:00.000Z',
    userQuestion: overrides.userQuestion ?? 'Стоит ли покупать SBER?',
    category: overrides.category ?? 'asset',
    tickers: overrides.tickers ?? ['SBER'],
    recommendedAction: overrides.recommendedAction ?? 'buy',
    reasoning: overrides.reasoning ?? 'Перспективный рост дивидендов',
    confidence: overrides.confidence ?? 0.8,
    agentRoles: overrides.agentRoles ?? ['ResearchAgent', 'StrategistAgent'],
    metadata: overrides.metadata,
  };
}

function makeOutcome(
  decisionId: string,
  overrides: Partial<OutcomeRecord> = {},
): Omit<OutcomeRecord, 'recordedAt'> {
  return {
    decisionId,
    actualAction: overrides.actualAction ?? 'buy',
    outcome: overrides.outcome ?? 'positive',
    roiPercent: overrides.roiPercent ?? 10,
    satisfaction: overrides.satisfaction ?? 4,
    implemented: overrides.implemented ?? true,
    notes: overrides.notes,
  };
}

/** Фиксированные часы для детерминированных трендов */
const FIXED_NOW = new Date('2026-10-09T12:00:00.000Z');

// ──────────────────────────────────────────────
// OutcomeTracker (1.1.1)
// ──────────────────────────────────────────────

describe('OutcomeTracker', () => {
  it('регистрирует решение и возвращает ID', async () => {
    const tracker = new OutcomeTracker({ now: () => FIXED_NOW });
    const id = await tracker.trackDecision(makeDecision());
    expect(id).toBeTruthy();
  });

  it('связывает решение с результатом (matched=true)', async () => {
    const tracker = new OutcomeTracker({ now: () => FIXED_NOW });
    const id = await tracker.trackDecision(makeDecision());
    await tracker.recordOutcome(makeOutcome(id));

    const pairs = await tracker.getPairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.matched).toBe(true);
    expect(pairs[0]?.outcome?.outcome).toBe('positive');
  });

  it('помечает решения без результата как unmatched', async () => {
    const tracker = new OutcomeTracker({ now: () => FIXED_NOW });
    await tracker.trackDecision(makeDecision());

    const pairs = await tracker.getPairs();
    expect(pairs[0]?.matched).toBe(false);
    expect(await tracker.getPendingDecisions()).toHaveLength(1);
  });

  it('отклоняет результат для несуществующего решения', async () => {
    const tracker = new OutcomeTracker({ now: () => FIXED_NOW });
    await expect(
      tracker.recordOutcome(makeOutcome('nonexistent')),
    ).rejects.toThrow(OutcomeTrackerError);
  });

  it('валидация отклоняет невалидные поля', async () => {
    const badDecision = makeDecision({ confidence: 1.5 });
    expect(validateDecision(badDecision).length).toBeGreaterThan(0);

    const tracker = new OutcomeTracker({ now: () => FIXED_NOW });
    await expect(tracker.trackDecision(badDecision)).rejects.toThrow(
      OutcomeTrackerError,
    );

    const badOutcome = makeOutcome('x', { satisfaction: 10 });
    expect(validateOutcome(badOutcome as OutcomeRecord).length).toBeGreaterThan(
      0,
    );
  });

  it('фильтрует решения по категории и тикеру', async () => {
    const tracker = new OutcomeTracker({ now: () => FIXED_NOW });
    await tracker.trackDecision(
      makeDecision({ category: 'asset', tickers: ['SBER'] }),
    );
    await tracker.trackDecision(
      makeDecision({ category: 'portfolio', tickers: ['GAZP'] }),
    );

    const byCategory = await tracker.getDecisionsByCategory('portfolio');
    expect(byCategory).toHaveLength(1);
    expect(byCategory[0]?.category).toBe('portfolio');

    const byTicker = await tracker.getDecisionsByTicker('sber');
    expect(byTicker).toHaveLength(1);
    expect(byTicker[0]?.tickers).toContain('SBER');
  });
});

// ──────────────────────────────────────────────
// SuccessMetrics (1.1.2)
// ──────────────────────────────────────────────

describe('SuccessMetrics', () => {
  function makePair(
    outcome: 'positive' | 'negative' | 'neutral' | 'ignored',
    overrides: {
      category?: string;
      ticker?: string;
      agentRole?: string;
      roi?: number;
      satisfaction?: number;
      confidence?: number;
      implemented?: boolean;
    } = {},
  ): DecisionOutcomePair {
    const decision = makeDecision({
      category: overrides.category ?? 'asset',
      tickers: [overrides.ticker ?? 'SBER'],
      agentRoles: [overrides.agentRole ?? 'ResearchAgent'],
      confidence: overrides.confidence ?? 0.8,
    });
    const pair: DecisionOutcomePair = {
      decision,
      outcome: null,
      matched: false,
    };
    // 'ignored' означает, что директор не реализовал рекомендацию
    const implemented = overrides.implemented ?? outcome !== 'ignored';
    if (!implemented) return pair;
    pair.outcome = {
      decisionId: decision.id,
      recordedAt: decision.createdAt,
      actualAction: 'buy',
      outcome,
      roiPercent: overrides.roi,
      satisfaction: overrides.satisfaction,
      implemented: true,
    };
    pair.matched = true;
    return pair;
  }

  it('вычисляет win rate: позитивные / реализованные', () => {
    const pairs = [
      makePair('positive'),
      makePair('positive'),
      makePair('negative'),
      makePair('ignored'),
    ];
    const agg = computeAggregates(pairs);
    // 3 реализованы, 2 позитивных → win rate 2/3
    expect(agg.implemented).toBe(3);
    expect(agg.winRate).toBeCloseTo(2 / 3, 4);
  });

  it('win rate = 0 при отсутствии реализованных решений', () => {
    const pairs = [makePair('positive', { implemented: false })];
    const agg = computeAggregates(pairs);
    expect(agg.implemented).toBe(0);
    expect(agg.winRate).toBe(0);
  });

  it('считает confidence accuracy как |avgConfidence - winRate|', () => {
    const pairs = [
      makePair('positive', { confidence: 0.9 }),
      makePair('negative', { confidence: 0.7 }),
    ];
    const agg = computeAggregates(pairs);
    expect(agg.avgConfidence).toBeCloseTo(0.8, 4);
    expect(agg.winRate).toBeCloseTo(0.5, 4);
    expect(agg.confidenceAccuracy).toBeCloseTo(0.3, 4);
  });

  it('агрегирует метрики по категориям, тикерам и агентам', () => {
    const pairs = [
      makePair('positive', {
        category: 'asset',
        ticker: 'SBER',
        agentRole: 'A1',
      }),
      makePair('negative', {
        category: 'asset',
        ticker: 'SBER',
        agentRole: 'A1',
      }),
      makePair('positive', {
        category: 'portfolio',
        ticker: 'GAZP',
        agentRole: 'A2',
      }),
    ];
    const system = new SuccessMetrics({
      now: () => FIXED_NOW,
    }).computeSystemMetrics(pairs);

    expect(system.byCategory).toHaveLength(2);
    const asset = system.byCategory.find((c) => c.category === 'asset');
    expect(asset?.totalDecisions).toBe(2);
    expect(system.byTicker['SBER']?.totalDecisions).toBe(2);
    expect(system.byAgent['A1']?.totalDecisions).toBe(2);
    expect(system.implementationRate).toBe(1);
  });

  it('тренд покрывает ровно N дней с нулями в пустые дни', () => {
    const trend = computeTrend([], 7, FIXED_NOW);
    expect(trend).toHaveLength(7);
    expect(trend[0]?.decisionCount).toBe(0);
    expect(trend[6]?.date).toBe('2026-10-09');
  });
});

// ──────────────────────────────────────────────
// ABTestEngine (1.1.3)
// ──────────────────────────────────────────────

describe('ABTestEngine', () => {
  let idCounter = 0;
  const makeEngine = () =>
    new ABTestEngine({
      now: () => FIXED_NOW,
      minSampleSize: 10,
      generateId: () => `id-${++idCounter}`,
    });

  function createTest(engine: ABTestEngine) {
    return engine.createTest({
      name: 'risk-approach',
      variants: [
        { name: 'A', description: 'Консервативный', params: { risk: 'low' } },
        { name: 'B', description: 'Агрессивный', params: { risk: 'high' } },
      ],
    });
  }

  it('требует минимум 2 варианта', () => {
    const engine = makeEngine();
    expect(() =>
      engine.createTest({
        name: 'bad',
        variants: [{ name: 'A', description: '', params: {} }],
      }),
    ).toThrow(ABTestEngineError);
  });

  it('детерминированно распределяет варианты по ключу', () => {
    const engine = makeEngine();
    const test = createTest(engine);
    const v1 = engine.assignVariant(test.id, 'SBER:asset');
    const v2 = engine.assignVariant(test.id, 'SBER:asset');
    expect(v1).toBe(v2); // тот же ключ → тот же вариант
  });

  it('пересчитывает результаты и находит победителя при значимости', () => {
    const engine = makeEngine();
    const test = createTest(engine);
    const [va, vb] = test.variants;
    if (!va || !vb) throw new Error('варианты не созданы');

    // Вариант A: 80% конверсий; B: 20%
    for (let i = 0; i < 20; i++) {
      engine.recordObservation({
        testId: test.id,
        variantId: va.id,
        converted: i < 16,
      });
      engine.recordObservation({
        testId: test.id,
        variantId: vb.id,
        converted: i < 4,
      });
    }

    const { comparisons, winnerVariantId, pValue, sufficientData } =
      engine.analyzeTest(test.id);
    expect(sufficientData).toBe(true);
    expect(pValue).toBeLessThan(0.05);
    expect(winnerVariantId).toBe(va.id);
    const winner = comparisons.find((c) => c.isWinner);
    expect(winner?.variantName).toBe('A');
  });

  it('не объявляет победителя при недостатке данных', () => {
    const engine = makeEngine();
    const test = createTest(engine);
    const va = test.variants[0];
    if (!va) throw new Error('вариант не создан');

    engine.recordObservation({
      testId: test.id,
      variantId: va.id,
      converted: true,
    });
    const { sufficientData, winnerVariantId } = engine.analyzeTest(test.id);
    expect(sufficientData).toBe(false);
    expect(winnerVariantId).toBeUndefined();
  });

  it('отклоняет наблюдения для завершённого теста', () => {
    const engine = makeEngine();
    const test = createTest(engine);
    const va = test.variants[0];
    if (!va) throw new Error('вариант не создан');
    engine.completeTest(test.id);
    expect(() =>
      engine.recordObservation({
        testId: test.id,
        variantId: va.id,
        converted: true,
      }),
    ).toThrow(ABTestEngineError);
  });

  it('экспорт/импорт состояния восстанавливает наблюдения', () => {
    const engine = makeEngine();
    const test = createTest(engine);
    const va = test.variants[0];
    if (!va) throw new Error('вариант не создан');
    engine.recordObservation({
      testId: test.id,
      variantId: va.id,
      converted: true,
    });

    const state = engine.exportState();
    const engine2 = makeEngine();
    engine2.importState(state);
    const results = engine2.refreshResults(test.id);
    expect(results[0]?.impressions).toBe(1);
  });

  it('z-тест: p-value близко к 0 при огромной разнице', () => {
    const p = twoProportionZTest(100, 100, 0, 100);
    expect(p).toBeLessThan(0.001);
    expect(twoProportionZTest(5, 10, 5, 10)).toBe(1); // одинаковые пропорции
  });
});

// ──────────────────────────────────────────────
// ReinforcementLearning (1.1.4)
// ──────────────────────────────────────────────

describe('ReinforcementLearning', () => {
  const baseFeatures = {
    category: 'asset',
    tickerCount: 1,
    confidence: 0.8,
    agentCount: 2,
    hourOfDay: 14,
    dayOfWeek: 3,
    isWeekend: false,
    historicalAvgRoi: 5,
    historicalWinRate: 0.7,
  };

  it('без данных exploration=0 выбирает первый кандидат', () => {
    const rl = new ReinforcementLearning({ explorationRate: 0 });
    const prediction = rl.predict(baseFeatures, ['buy', 'hold', 'sell']);
    expect(prediction.recommendedAction).toBe('buy');
    expect(prediction.expectedReward).toBe(0);
    expect(prediction.isExploration).toBe(false);
  });

  it('обновление позитивным reward повышает вес действия', () => {
    const rl = new ReinforcementLearning({ explorationRate: 0 });
    rl.update('asset', 'buy', 1);
    rl.update('asset', 'buy', 1);
    rl.update('asset', 'hold', -1);

    const prediction = rl.predict(baseFeatures, ['buy', 'hold']);
    expect(prediction.recommendedAction).toBe('buy');
    expect(prediction.expectedReward).toBeGreaterThan(0);

    const weights = rl.getWeightsForCategory('asset');
    expect(weights).toHaveLength(2);
    const buy = weights.find((w) => w.action === 'buy');
    const hold = weights.find((w) => w.action === 'hold');
    expect(buy?.weight).toBeGreaterThan(hold?.weight ?? -Infinity);
  });

  it('exploration=1 всегда выбирает случайное действие', () => {
    const rl = new ReinforcementLearning({
      explorationRate: 1,
      random: () => 0.99,
    });
    const prediction = rl.predict(baseFeatures, ['buy', 'hold', 'sell']);
    expect(prediction.isExploration).toBe(true);
    expect(prediction.confidence).toBe(0);
  });

  it('полураспад уменьшает старые веса', () => {
    let clock = FIXED_NOW.getTime();
    const rl = new ReinforcementLearning({
      explorationRate: 0,
      weightHalfLifeDays: 1,
      now: () => new Date(clock),
    });
    rl.update('asset', 'buy', 1);
    const before = rl.getWeights()[0]?.weight ?? 0;

    clock += 3 * 86_400_000; // +3 дня
    rl.decayAllWeights();
    const after = rl.getWeights()[0]?.weight ?? 0;

    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(before * 0.125, 3); // 0.5^3
  });

  it('отклоняет нечисловой reward', () => {
    const rl = new ReinforcementLearning();
    expect(() => rl.update('asset', 'buy', NaN)).toThrow(
      ReinforcementLearningError,
    );
  });

  it('экспорт/импорт весов сохраняет состояние', () => {
    const rl = new ReinforcementLearning();
    rl.update('asset', 'buy', 1);
    const rl2 = new ReinforcementLearning();
    rl2.importWeights(rl.exportWeights());
    expect(rl2.getWeights()).toEqual(rl.getWeights());
  });
});

// ──────────────────────────────────────────────
// FeedbackLoop фасад (1.1.5)
// ──────────────────────────────────────────────

describe('FeedbackLoop', () => {
  const savedLessons: LessonEntry[] = [];
  const lessonSource = {
    saveLesson: async (lesson: LessonEntry): Promise<void> => {
      savedLessons.push(lesson);
    },
    getLessons: async (): Promise<LessonEntry[]> => savedLessons,
  };

  it('полный цикл: решение → результат → метрики', async () => {
    const loop = new FeedbackLoop({ lessonSource });
    const trackResult = await loop.execute('track-decision', makeDecision());
    expect(trackResult.success).toBe(true);
    const decisionId = trackResult.data as string;

    const outcomeResult = await loop.execute('record-outcome', {
      ...makeOutcome(decisionId),
    });
    expect(outcomeResult.success).toBe(true);
    expect(
      (outcomeResult.data as { weightsUpdated: boolean }).weightsUpdated,
    ).toBe(true);

    const metricsResult = await loop.execute('get-metrics');
    expect(metricsResult.success).toBe(true);
    const metrics = metricsResult.data as {
      totalDecisions: number;
      overallWinRate: number;
    };
    expect(metrics.totalDecisions).toBe(1);
    expect(metrics.overallWinRate).toBe(1);
  });

  it('record-outcome для несуществующего решения возвращает ошибку', async () => {
    const loop = new FeedbackLoop();
    const result = await loop.execute('record-outcome', makeOutcome('ghost'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('не найдено');
    expect(loop.getStatus().status).toBe('error');
  });

  it('analyze выдаёт рекомендации и сохраняет уроки', async () => {
    savedLessons.length = 0;
    const loop = new FeedbackLoop({ lessonSource });
    // 2 позитивных в категории asset, 2 негативных в portfolio
    for (const [category, outcome] of [
      ['asset', 'positive'],
      ['asset', 'positive'],
      ['portfolio', 'negative'],
      ['portfolio', 'negative'],
    ] as const) {
      const id = await loop.trackDecision(makeDecision({ category }));
      await loop.recordOutcome(makeOutcome(id, { outcome }));
    }

    const result = await loop.execute('analyze');
    expect(result.success).toBe(true);
    const analysis = result.data as {
      strengths: string[];
      weaknesses: string[];
      recommendations: string[];
    };
    expect(analysis.strengths.length).toBeGreaterThan(0);
    expect(analysis.weaknesses.length).toBeGreaterThan(0);
    expect(analysis.recommendations.length).toBeGreaterThan(0);
    expect(savedLessons.length).toBe(2); // по уроку на категорию
  });

  it('A/B через фасад: create → record → result', async () => {
    const loop = new FeedbackLoop();
    const createResult = await loop.execute('create-ab-test', {
      name: 'test',
      variants: [
        { name: 'A', description: '', params: {} },
        { name: 'B', description: '', params: {} },
      ],
    });
    const test = createResult.data as {
      id: string;
      variants: { id: string }[];
    };
    const va = test.variants[0];
    if (!va) throw new Error('вариант не создан');

    for (let i = 0; i < 20; i++) {
      loop.recordABResult({
        testId: test.id,
        variantId: va.id,
        converted: i < 18,
      });
    }
    const resultResult = await loop.execute('get-ab-result', {
      testId: test.id,
    });
    const abResult = resultResult.data as {
      comparisons: { sampleSize: number; conversionRate: number }[];
    };
    expect(abResult.comparisons[0]?.sampleSize).toBe(20);
    expect(abResult.comparisons[0]?.conversionRate).toBe(0.9);
  });

  it('predict через фасад использует RL-веса после record-outcome', async () => {
    const loop = new FeedbackLoop();
    const id = await loop.trackDecision(
      makeDecision({ category: 'asset', recommendedAction: 'buy' }),
    );
    await loop.recordOutcome(makeOutcome(id, { outcome: 'positive' }));

    const prediction = loop.predict({
      features: {
        category: 'asset',
        tickerCount: 1,
        confidence: 0.8,
        agentCount: 1,
        hourOfDay: 14,
        dayOfWeek: 3,
        isWeekend: false,
        historicalAvgRoi: 5,
        historicalWinRate: 0.8,
      },
      candidateActions: ['buy', 'hold'],
    });
    expect(prediction.recommendedAction).toBe('buy');
    expect(prediction.expectedReward).toBeGreaterThan(0);
  });

  it('reset сбрасывает веса', async () => {
    const loop = new FeedbackLoop();
    const id = await loop.trackDecision(makeDecision());
    await loop.recordOutcome(makeOutcome(id));
    await loop.execute('reset');
    const weights = await loop.execute('get-weights');
    expect(weights.data).toEqual([]);
  });

  it('get-status возвращает статус', async () => {
    const loop = new FeedbackLoop();
    const result = await loop.execute('get-status');
    expect(result.success).toBe(true);
    expect((result.data as { status: string }).status).toBe('idle');
  });
});
