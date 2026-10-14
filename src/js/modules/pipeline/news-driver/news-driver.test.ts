/**
 * Тесты NewsDriver — фасад новостного драйвера.
 *
 * Проверяют: analyzePortfolio (оценка влияния на портфель), buildNewsContext
 * (LLM-контекст), buildContext (структурированный контекст) и
 * adjustRecommendation (корректировка рекомендации).
 *
 * Глобальные describe/it/expect предоставляются vitest (globals: true).
 */

import type { CachedNewsItem } from '../gatekeeper/news-cache.js';
import { NewsDriver } from './news-driver.js';
import type { NewsCacheLike, PortfolioFactsLike } from './types.js';

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

function makeCache(items: CachedNewsItem[]): NewsCacheLike {
  return {
    getByTicker: (ticker: string) =>
      items.filter((i) => i.tickers.includes(ticker)),
  };
}

function makeFacts(tickers: string[]): PortfolioFactsLike {
  return { assetsAnalysis: tickers.map((ticker) => ({ ticker })) };
}

// ─── analyzePortfolio ─────────────────────────────────────────────────────

describe('NewsDriver.analyzePortfolio', () => {
  it('оценивает влияние новостей на активы портфеля', () => {
    const driver = new NewsDriver();
    const cache = makeCache([
      makeNews({
        tickers: ['SBER'],
        sentiment: 'positive',
        importance: 'high',
      }),
      makeNews({
        id: 'n2',
        tickers: ['GAZP'],
        title: 'Газпром под санкциями',
        description: 'Введены ограничения',
        sentiment: 'negative',
        importance: 'critical',
      }),
    ]);
    const impacts = driver.analyzePortfolio(makeFacts(['SBER', 'GAZP']), cache);
    expect(impacts).toHaveLength(2);
    const sber = impacts.find((i) => i.ticker === 'SBER');
    const gazp = impacts.find((i) => i.ticker === 'GAZP');
    expect(sber!.impactDirection).toBe('positive');
    expect(gazp!.impactDirection).toBe('negative');
    expect(gazp!.importance).toBe('critical');
  });

  it('тикер без новостей пропускается', () => {
    const driver = new NewsDriver();
    const cache = makeCache([makeNews({ tickers: ['SBER'] })]);
    const impacts = driver.analyzePortfolio(makeFacts(['SBER', 'LKOH']), cache);
    expect(impacts.map((i) => i.ticker)).toEqual(['SBER']);
  });

  it('пустой кэш → пустой результат', () => {
    const driver = new NewsDriver();
    const impacts = driver.analyzePortfolio(makeFacts(['SBER']), makeCache([]));
    expect(impacts).toEqual([]);
  });

  it('нейтральный фон (impactScore < порога) не попадает в результат', () => {
    const driver = new NewsDriver();
    const cache = makeCache([
      makeNews({ sentiment: 'neutral', importance: 'low' }),
    ]);
    const impacts = driver.analyzePortfolio(makeFacts(['SBER']), cache);
    expect(impacts).toEqual([]);
  });

  it('некорректные факты → пустой результат (без исключений)', () => {
    const driver = new NewsDriver();
    const impacts = driver.analyzePortfolio(
      { assetsAnalysis: [] },
      makeCache([makeNews()]),
    );
    expect(impacts).toEqual([]);
  });
});

// ─── buildNewsContext ─────────────────────────────────────────────────────

describe('NewsDriver.buildNewsContext', () => {
  it('пустой список → пустая строка', () => {
    const driver = new NewsDriver();
    expect(driver.buildNewsContext([])).toBe('');
  });

  it('непустой список → содержит тикер, сентимент и важность', () => {
    const driver = new NewsDriver();
    const cache = makeCache([
      makeNews({ sentiment: 'negative', importance: 'critical' }),
    ]);
    const impacts = driver.analyzePortfolio(makeFacts(['SBER']), cache);
    const context = driver.buildNewsContext(impacts);
    expect(context).toContain('SBER');
    expect(context).toContain('negative');
    expect(context).toContain('critical');
    expect(context).toContain('Новостной фон');
  });
});

// ─── buildContext ─────────────────────────────────────────────────────────

describe('NewsDriver.buildContext', () => {
  it('criticalSignals содержит только critical/high impact-ы', () => {
    const driver = new NewsDriver();
    const cache = makeCache([
      makeNews({
        tickers: ['SBER'],
        importance: 'critical',
        sentiment: 'negative',
      }),
      makeNews({
        id: 'n2',
        tickers: ['GAZP'],
        importance: 'low',
        sentiment: 'positive',
      }),
    ]);
    const impacts = driver.analyzePortfolio(makeFacts(['SBER', 'GAZP']), cache);
    const context = driver.buildContext(impacts);
    expect(context.criticalSignals).toHaveLength(1);
    expect(context.criticalSignals[0]).toContain('SBER');
    expect(context.summary).toContain('SBER');
  });
});

// ─── adjustRecommendation ─────────────────────────────────────────────────

describe('NewsDriver.adjustRecommendation', () => {
  it('критический негатив меняет HOLD → REDUCE', () => {
    const driver = new NewsDriver();
    const cache = makeCache([
      makeNews({
        sentiment: 'negative',
        importance: 'critical',
        title: 'Сбербанк под санкциями',
        description: 'Введены блокирующие ограничения',
      }),
    ]);
    const impacts = driver.analyzePortfolio(makeFacts(['SBER']), cache);
    const adjusted = driver.adjustRecommendation(
      {
        action: 'HOLD',
        confidence: 0.6,
        reasoning: 'Позиция SBER в допустимых пределах.',
      },
      impacts,
    );
    expect(adjusted.action).toBe('REDUCE');
    expect(adjusted.reasoning).toContain('Новостной фон');
  });

  it('без impact-ов рекомендация не меняется', () => {
    const driver = new NewsDriver();
    const rec = {
      action: 'HOLD' as const,
      confidence: 0.6,
      reasoning: 'Позиция стабильна.',
    };
    const adjusted = driver.adjustRecommendation(rec, []);
    expect(adjusted.action).toBe('HOLD');
    expect(adjusted.reasoning).toBe(rec.reasoning);
  });
});
