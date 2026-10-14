/**
 * Тесты NewsStrategyAdapter — корректировка инвестиционной стратегии по новостям.
 *
 * Ключевой сценарий: критическая новость по тикеру меняет рекомендацию
 * (HOLD → REDUCE с обоснованием), позитив усиливает тезис.
 *
 * Глобальные describe/it/expect предоставляются vitest (globals: true).
 */

import type { NewsImpact } from './types.js';
import {
  adjustRecommendation,
  relevantImpacts,
} from './news-strategy-adapter.js';

// ─── Утилиты ──────────────────────────────────────────────────────────────

function makeImpact(overrides: Partial<NewsImpact> = {}): NewsImpact {
  return {
    ticker: 'SBER',
    sentimentScore: -0.9,
    importance: 'critical',
    impactDirection: 'negative',
    affectedMetrics: ['санкционные риски'],
    suggestedAction: 'REDUCE',
    headlines: ['Сбербанк под санкциями'],
    impactScore: 0.9,
    reasoning: 'Новостной фон по SBER: негативный, критическая важность.',
    ...overrides,
  };
}

function makeRec(
  overrides: Partial<Parameters<typeof adjustRecommendation>[0]> = {},
) {
  return {
    action: 'HOLD' as const,
    confidence: 0.6,
    reasoning: 'Позиция SBER в допустимых пределах.',
    ...overrides,
  };
}

// ─── relevantImpacts ──────────────────────────────────────────────────────

describe('relevantImpacts', () => {
  it('пустой список → пустой результат', () => {
    expect(relevantImpacts(makeRec(), [])).toEqual([]);
  });

  it('матчит impact-ы по тикеру, упомянутому в reasoning', () => {
    const rec = makeRec({ reasoning: 'Позиция SBER стабильна.' });
    const sber = makeImpact({ ticker: 'SBER' });
    const gazp = makeImpact({ ticker: 'GAZP' });
    const result = relevantImpacts(rec, [sber, gazp]);
    expect(result.map((i) => i.ticker)).toEqual(['SBER']);
  });

  it('без тикера в reasoning — учитывает весь портфельный фон', () => {
    const rec = makeRec({ reasoning: 'Позиция стабильна.' });
    const sber = makeImpact({ ticker: 'SBER' });
    const gazp = makeImpact({ ticker: 'GAZP' });
    const result = relevantImpacts(rec, [sber, gazp]);
    expect(result).toHaveLength(2);
  });
});

// ─── adjustRecommendation ──────────────────────────────────────────────────

describe('adjustRecommendation', () => {
  it('критический негатив: HOLD → REDUCE с обоснованием', () => {
    const result = adjustRecommendation(makeRec(), [
      makeImpact({ impactDirection: 'negative', importance: 'critical' }),
    ]);
    expect(result.adjustedByNews).toBe(true);
    expect(result.action).toBe('REDUCE');
    expect(result.reasoning).toContain('📰 Новостной фон');
    expect(result.reasoning).toContain('пересмотреть');
    expect(result.newsReasons.length).toBeGreaterThan(0);
  });

  it('критический негатив: BUY → HOLD (покупка приостановлена)', () => {
    const result = adjustRecommendation(
      makeRec({ action: 'BUY', confidence: 0.8 }),
      [makeImpact({ impactDirection: 'negative', importance: 'critical' })],
    );
    expect(result.action).toBe('HOLD');
    expect(result.confidence).toBeLessThanOrEqual(0.7);
  });

  it('критический негатив: AVERAGE → HOLD', () => {
    const result = adjustRecommendation(makeRec({ action: 'AVERAGE' }), [
      makeImpact({ impactDirection: 'negative', importance: 'critical' }),
    ]);
    expect(result.action).toBe('HOLD');
  });

  it('высокий негатив: BUY → HOLD', () => {
    const result = adjustRecommendation(makeRec({ action: 'BUY' }), [
      makeImpact({ impactDirection: 'negative', importance: 'high' }),
    ]);
    expect(result.action).toBe('HOLD');
  });

  it('критический негатив подтверждает REDUCE', () => {
    const result = adjustRecommendation(makeRec({ action: 'REDUCE' }), [
      makeImpact({ impactDirection: 'negative', importance: 'critical' }),
    ]);
    expect(result.action).toBe('REDUCE');
    expect(result.reasoning).toContain('подтверждает');
  });

  it('позитивный фон: HOLD → BUY (тезис усилен)', () => {
    const result = adjustRecommendation(makeRec(), [
      makeImpact({
        impactDirection: 'positive',
        importance: 'high',
        sentimentScore: 0.8,
      }),
    ]);
    expect(result.action).toBe('BUY');
    expect(result.reasoning).toContain('тезис усилен');
  });

  it('позитивный фон: BUY → уверенность повышается', () => {
    const result = adjustRecommendation(
      makeRec({ action: 'BUY', confidence: 0.6 }),
      [
        makeImpact({
          impactDirection: 'positive',
          importance: 'critical',
          sentimentScore: 0.9,
        }),
      ],
    );
    expect(result.action).toBe('BUY');
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('нет impact-ов → рекомендация не меняется', () => {
    const rec = makeRec();
    const result = adjustRecommendation(rec, []);
    expect(result.adjustedByNews).toBe(false);
    expect(result.action).toBe(rec.action);
    expect(result.reasoning).toBe(rec.reasoning);
    expect(result.newsReasons).toEqual([]);
  });

  it('нейтральный фон → рекомендация не меняется', () => {
    const rec = makeRec();
    const result = adjustRecommendation(rec, [
      makeImpact({ impactDirection: 'neutral', sentimentScore: 0 }),
    ]);
    expect(result.adjustedByNews).toBe(false);
    expect(result.action).toBe('HOLD');
  });

  it('позитив не отменяет критический негатив (негатив приоритетнее)', () => {
    const result = adjustRecommendation(makeRec(), [
      makeImpact({ impactDirection: 'negative', importance: 'critical' }),
      makeImpact({
        impactDirection: 'positive',
        importance: 'high',
        sentimentScore: 0.8,
      }),
    ]);
    expect(result.action).toBe('REDUCE');
  });
});
