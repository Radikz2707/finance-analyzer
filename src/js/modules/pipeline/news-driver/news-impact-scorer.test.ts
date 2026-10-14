/**
 * Тесты NewsImpactScorer — оценка влияния новостей на актив.
 *
 * Принципы: детерминизм, честные ошибки на некорректных данных,
 * формула impact = |сентимент| × важность × релевантность.
 *
 * Глобальные describe/it/expect предоставляются vitest (globals: true).
 */

import type { CachedNewsItem } from '../gatekeeper/news-cache.js';
import {
  NewsImpactScorer,
  NewsImpactScorerError,
  IMPORTANCE_WEIGHTS,
  collectAffectedMetrics,
  sentimentValue,
  suggestAction,
} from './news-impact-scorer.js';

// ─── Утилиты ──────────────────────────────────────────────────────────────

function makeNews(overrides: Partial<CachedNewsItem> = {}): CachedNewsItem {
  return {
    id: 'n1',
    title: 'Сбербанк показал рост прибыли',
    description: 'Банк отчитался о росте',
    url: 'https://example.com/1',
    date: '2024-06-01T00:00:00Z',
    source: 'РБК',
    tickers: ['SBER'],
    category: 'Финансы',
    sentiment: 'positive',
    importance: 'high',
    isMoscowExchange: true,
    cachedAt: '2024-06-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z',
    mentionCount: 1,
    ...overrides,
  };
}

// ─── Вспомогательные функции ──────────────────────────────────────────────

describe('NewsImpactScorer helpers', () => {
  it('sentimentValue: positive=1, negative=-1, neutral/unknown=0', () => {
    expect(sentimentValue('positive')).toBe(1);
    expect(sentimentValue('negative')).toBe(-1);
    expect(sentimentValue('neutral')).toBe(0);
    expect(sentimentValue('unknown')).toBe(0);
  });

  it('suggestAction: критический негатив → REDUCE, позитив → BUY', () => {
    expect(suggestAction('negative', 'critical')).toBe('REDUCE');
    expect(suggestAction('negative', 'high')).toBe('HOLD');
    expect(suggestAction('negative', 'medium')).toBeNull();
    expect(suggestAction('positive', 'critical')).toBe('BUY');
    expect(suggestAction('positive', 'high')).toBe('BUY');
    expect(suggestAction('positive', 'low')).toBeNull();
    expect(suggestAction('neutral', 'critical')).toBeNull();
  });

  it('collectAffectedMetrics: собирает метрики по ключевым словам', () => {
    const metrics = collectAffectedMetrics([
      makeNews({
        title: 'Сбербанк объявил дивиденды',
        description: 'Совет директоров рекомендовал выплату',
      }),
      makeNews({
        title: 'Новые санкции против банка',
        description: 'Введены ограничения',
      }),
    ]);
    expect(metrics).toContain('дивиденды');
    expect(metrics).toContain('санкционные риски');
  });
});

// ─── NewsImpactScorer ─────────────────────────────────────────────────────

describe('NewsImpactScorer', () => {
  it('позитивный фон → positive, sentimentScore > 0, suggestedAction BUY', () => {
    const scorer = new NewsImpactScorer();
    const impact = scorer.scoreTicker('SBER', [
      makeNews({ sentiment: 'positive', importance: 'high' }),
    ]);
    expect(impact).not.toBeNull();
    expect(impact!.impactDirection).toBe('positive');
    expect(impact!.sentimentScore).toBeGreaterThan(0);
    expect(impact!.importance).toBe('high');
    expect(impact!.suggestedAction).toBe('BUY');
    expect(impact!.impactScore).toBeGreaterThan(0);
  });

  it('критический негатив → negative, suggestedAction REDUCE', () => {
    const scorer = new NewsImpactScorer();
    const impact = scorer.scoreTicker('SBER', [
      makeNews({
        title: 'Сбербанк под санкциями',
        description: 'Введены блокирующие ограничения',
        sentiment: 'negative',
        importance: 'critical',
      }),
    ]);
    expect(impact!.impactDirection).toBe('negative');
    expect(impact!.sentimentScore).toBeLessThan(0);
    expect(impact!.importance).toBe('critical');
    expect(impact!.suggestedAction).toBe('REDUCE');
  });

  it('нейтральный фон → neutral, suggestedAction null', () => {
    const scorer = new NewsImpactScorer();
    const impact = scorer.scoreTicker('SBER', [
      makeNews({ sentiment: 'neutral', importance: 'medium' }),
    ]);
    expect(impact!.impactDirection).toBe('neutral');
    expect(impact!.suggestedAction).toBeNull();
  });

  it('важность = максимальная среди новостей тикера', () => {
    const scorer = new NewsImpactScorer();
    const impact = scorer.scoreTicker('SBER', [
      makeNews({ id: 'a', importance: 'low', sentiment: 'positive' }),
      makeNews({ id: 'b', importance: 'critical', sentiment: 'positive' }),
      makeNews({ id: 'c', importance: 'medium', sentiment: 'positive' }),
    ]);
    expect(impact!.importance).toBe('critical');
  });

  it('релевантность: тикер в тексте (не в списке) учитывается с весом 0.5', () => {
    const scorer = new NewsImpactScorer();
    const impact = scorer.scoreTicker('SBER', [
      makeNews({
        tickers: [],
        title: 'Акции SBER выросли',
        description: 'Бумаги банка подорожали',
        sentiment: 'positive',
        importance: 'high',
      }),
    ]);
    expect(impact).not.toBeNull();
    expect(impact!.impactDirection).toBe('positive');
  });

  it('нерелевантная новость (тикер не упомянут) → null', () => {
    const scorer = new NewsImpactScorer();
    const impact = scorer.scoreTicker('SBER', [
      makeNews({
        tickers: ['GAZP'],
        title: 'Газпром отчитался',
        description: 'Выручка выросла',
      }),
    ]);
    expect(impact).toBeNull();
  });

  it('пустой массив новостей → честная ошибка', () => {
    const scorer = new NewsImpactScorer();
    expect(() => scorer.scoreTicker('SBER', [])).toThrow(NewsImpactScorerError);
  });

  it('пустой тикер → честная ошибка', () => {
    const scorer = new NewsImpactScorer();
    expect(() => scorer.scoreTicker('', [makeNews()])).toThrow(
      NewsImpactScorerError,
    );
  });

  it('impactScore = |сентимент| × вес важности', () => {
    const scorer = new NewsImpactScorer();
    const impact = scorer.scoreTicker('SBER', [
      makeNews({ sentiment: 'negative', importance: 'critical' }),
    ]);
    expect(impact!.impactScore).toBeCloseTo(
      Math.abs(impact!.sentimentScore) * IMPORTANCE_WEIGHTS.critical,
      3,
    );
  });

  it('headlines содержат заголовки учтённых новостей', () => {
    const scorer = new NewsImpactScorer();
    const impact = scorer.scoreTicker('SBER', [
      makeNews({ id: 'a', title: 'Заголовок A' }),
      makeNews({ id: 'b', title: 'Заголовок B' }),
    ]);
    expect(impact!.headlines).toContain('Заголовок A');
    expect(impact!.headlines).toContain('Заголовок B');
  });
});
