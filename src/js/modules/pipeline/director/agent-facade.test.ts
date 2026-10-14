/**
 * Тесты DirectorAgentFacade — интеграция NewsDriver в роли research/ai.
 *
 * Проверяют: роль research использует новостной фон в сводке; роль ai
 * получает новостные impact'ы и меняет мнение при критическом негативе.
 *
 * Глобальные describe/it/expect предоставляются vitest (globals: true).
 */

import type { CachedNewsItem } from '../gatekeeper/news-cache.js';
import { DirectorAgentFacade } from './agent-facade.js';
import type { NewsCacheLike } from '../news-driver/types.js';
import type {
  DirectorFactsContext,
  InterpretedQuestion,
} from './director-types.js';

// ─── Утилиты ──────────────────────────────────────────────────────────────

function makeNews(overrides: Partial<CachedNewsItem> = {}): CachedNewsItem {
  return {
    id: 'n1',
    title: 'Сбербанк под санкциями',
    description: 'Введены блокирующие ограничения',
    url: 'https://example.com/1',
    date: '2024-06-01T00:00:00Z',
    source: 'РБК',
    tickers: ['SBER'],
    category: 'Финансы',
    sentiment: 'negative',
    importance: 'critical',
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

function makeFacts(): DirectorFactsContext {
  return {
    assetsAnalysis: [
      {
        ticker: 'SBER',
        name: 'Сбер',
        currentPercent: 8,
        targetPercent: 12,
        deficitRub: 40000,
        status: 'BUY',
        balancePrice: 250,
        currentPrice: 300,
        unrealizedProfitRub: 5000,
      },
    ],
    totalPortfolioValue: 500000,
    freeCashRub: 60000,
  };
}

function makeQuestion(): InterpretedQuestion {
  return {
    category: 'asset',
    tickers: ['SBER'],
    topic: 'SBER',
    text: 'Что с SBER?',
    requiredAgents: ['research', 'ai'],
    needsConsilium: false,
    complexity: 2,
    intent: 'understand',
  };
}

// ─── Роль research ────────────────────────────────────────────────────────

describe('DirectorAgentFacade: роль research и NewsDriver', () => {
  it('с newsCache сводка содержит новостной фон', async () => {
    const facade = new DirectorAgentFacade({
      newsCache: makeCache([makeNews()]),
    });
    const results = await facade.executeRoles(
      ['research'],
      makeQuestion(),
      makeFacts(),
    );
    const research = results.find((r) => r.role === 'research')!;
    expect(research.success).toBe(true);
    const summary = (research.data as { summary: string }).summary;
    expect(summary).toContain('SBER');
    expect(summary).toContain('negative');
  });

  it('без newsCache сводка честно сообщает об отсутствии контекста', async () => {
    const facade = new DirectorAgentFacade();
    const results = await facade.executeRoles(
      ['research'],
      makeQuestion(),
      makeFacts(),
    );
    const research = results.find((r) => r.role === 'research')!;
    const summary = (research.data as { summary: string }).summary;
    expect(summary).toContain('новостной контекст не передан');
  });
});

// ─── Роль ai ──────────────────────────────────────────────────────────────

describe('DirectorAgentFacade: роль ai и NewsDriver', () => {
  it('критический негатив меняет мнение AI на REDUCE', async () => {
    const facade = new DirectorAgentFacade({
      newsCache: makeCache([makeNews()]),
    });
    const results = await facade.executeRoles(
      ['ai'],
      makeQuestion(),
      makeFacts(),
    );
    const ai = results.find((r) => r.role === 'ai')!;
    expect(ai.success).toBe(true);
    const opinion = (ai.data as { opinion: { action: string } }).opinion;
    expect(opinion.action).toBe('REDUCE');
  });

  it('без новостей AI действует по структурной логике (BUY при дефиците)', async () => {
    const facade = new DirectorAgentFacade();
    const results = await facade.executeRoles(
      ['ai'],
      makeQuestion(),
      makeFacts(),
    );
    const ai = results.find((r) => r.role === 'ai')!;
    const opinion = (ai.data as { opinion: { action: string } }).opinion;
    expect(opinion.action).toBe('BUY');
  });
});
