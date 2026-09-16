import { describe, it, expect } from 'vitest';
import { NewsResearchProvider } from './news-provider.js';
import type {
  ResearchAsset,
  ResearchContext,
} from './types.js';
import type { RawNewsItem } from './news-fetcher.js';

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function createAsset(overrides?: Partial<ResearchAsset>): ResearchAsset {
  return {
    ticker: 'SBER',
    name: 'ПАО Сбербанк',
    assetType: 'STOCK',
    issuer: 'ПАО Сбербанк',
    currency: 'RUB',
    market: 'MOEX',
    ...overrides,
  };
}

function createContext(overrides?: Partial<ResearchContext>): ResearchContext {
  return {
    researchTimestamp: '2025-09-15T10:00:00Z',
    marketQuotes: {},
    macroData: {},
    newsData: [],
    sources: [
      {
        name: 'Google News RSS',
        version: '1.0',
        fetchedAt: '2025-09-15T10:00:00Z',
      },
    ],
    ...overrides,
  };
}

function createMockFetcher(items: RawNewsItem[]) {
  return {
    async fetch(): Promise<import('./news-fetcher.js').FetchResult> {
      return {
        items,
        sourceName: 'Google News RSS',
        success: true,
      };
    },
  };
}

function createMockErrorFetcher(error: string) {
  return {
    async fetch(): Promise<import('./news-fetcher.js').FetchResult> {
      throw new Error(error);
    },
  };
}

function createMockRawItem(overrides?: Partial<RawNewsItem>): RawNewsItem {
  return {
    title: 'Test Title',
    link: 'https://example.com/1',
    date: '2025-09-15T10:00:00Z',
    source: 'Interfax',
    description: 'Test description',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════
// 1. STOCK supports = true
// ═══════════════════════════════════════════════

describe('NewsResearchProvider supports STOCK', () => {
  const provider = new NewsResearchProvider();

  it('поддерживает STOCK → true', () => {
    expect(provider.supports(createAsset({ assetType: 'STOCK' }))).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 2. BOND/ETF/CASH/OTHER = false
// ═══════════════════════════════════════════════

describe('NewsResearchProvider rejects non-STOCK', () => {
  const provider = new NewsResearchProvider();

  it('BOND → false', () => {
    expect(provider.supports(createAsset({ assetType: 'BOND' }))).toBe(false);
  });

  it('ETF → false', () => {
    expect(provider.supports(createAsset({ assetType: 'ETF' }))).toBe(false);
  });

  it('CASH → false', () => {
    expect(provider.supports(createAsset({ assetType: 'CASH' }))).toBe(false);
  });

  it('OTHER → false', () => {
    expect(provider.supports(createAsset({ assetType: 'OTHER' }))).toBe(false);
  });
});

// ═══════════════════════════════════════════════
// 3. mock news response → NewsItem[]
// ═══════════════════════════════════════════════

describe('mock news response → NewsItem[]', () => {
  it('нормальные новости нормализуются в NewsItem[]', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'Сбербанк отчитался о прибыли',
        link: 'https://example.com/sber-profit',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Чистая прибыль выросла на 15%',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER', name: 'Сбербанк', issuer: 'Сбербанк' }),
      createContext(),
    );

    expect(snapshot.newsResearch).toBeDefined();
    expect(snapshot.newsResearch!.items.length).toBeGreaterThan(0);
    expect(snapshot.newsResearch!.items[0].title).toBe('Сбербанк отчитался о прибыли');
  });
});

// ═══════════════════════════════════════════════
// 4. title/date/source/url нормализуются
// ═══════════════════════════════════════════════

describe('title/date/source/url нормализуются', () => {
  it('title сохраняется как есть', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER: рекордная выручка',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'TASS',
        description: 'Тест',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.newsResearch!.items[0].title).toBe('SBER: рекордная выручка');
  });

  it('date сохраняется в ISO 8601', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER Test',
        link: 'https://example.com/1',
        date: 'Mon, 15 Sep 2025 10:00:00 +0300',
        source: 'TASS',
        description: 'Test',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const dateStr = snapshot.newsResearch!.items[0].date;
    expect(dateStr).toBeDefined();
    expect(dateStr).not.toBe('');
    // Проверяем, что дата валидна (ISO формат)
    const parsed = new Date(dateStr);
    expect(isNaN(parsed.getTime())).toBe(false);
  });

  it('source берётся из RawNewsItem', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER Test',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Bloomberg',
        description: 'Test',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.newsResearch!.items[0].source).toBe('Bloomberg');
  });

  it('url берётся из RawNewsItem.link', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER Test',
        link: 'https://bloomberg.com/news/sber',
        date: '2025-09-15T10:00:00Z',
        source: 'Bloomberg',
        description: 'Test',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.newsResearch!.items[0].url).toBe('https://bloomberg.com/news/sber');
  });
});

// ═══════════════════════════════════════════════
// 5. publishedAt сохраняется
// ═══════════════════════════════════════════════

describe('publishedAt сохраняется', () => {
  it('evidence содержит publishedAt из новости, а не retrievedAt', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER прибыль',
        link: 'https://example.com/1',
        date: '2025-01-15T08:00:00Z',
        source: 'Интерфакс',
        description: 'Тест',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const evidenceKeys = Object.keys(snapshot.evidence);
    expect(evidenceKeys.length).toBeGreaterThan(0);

    const ev = snapshot.evidence[evidenceKeys[0]];
    expect(ev.publishedAt).toMatch(/^2025-01-15T08:00:00/);
    expect(ev.type).toBe('NEWS');
    expect(ev.source).toBe('Интерфакс');
  });
});

// ═══════════════════════════════════════════════
// 6. relevance filtering работает
// ═══════════════════════════════════════════════

describe('relevance filtering работает', () => {
  it('новость с ticker в заголовке → релевантна', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER показывает рост',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Тест',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.newsResearch!.items.length).toBeGreaterThan(0);
  });

  it('новость с issuer name → релевантна', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'Сбербанк объявил дивиденды',
        link: 'https://example.com/2',
        date: '2025-09-15T10:00:00Z',
        source: 'TASS',
        description: 'Тест',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER', name: 'Сбербанк', issuer: 'Сбербанк' }),
      createContext(),
    );

    expect(snapshot.newsResearch!.items.length).toBeGreaterThan(0);
  });

  it('новость без совпадений → не релевантна', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'Apple представила новый iPhone',
        link: 'https://example.com/3',
        date: '2025-09-15T10:00:00Z',
        source: 'Reuters',
        description: 'Apple Inc. представила...',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER', name: 'Сбербанк' }),
      createContext(),
    );

    // Нет релевантных новостей → newsResearch undefined или пустой
    if (snapshot.newsResearch) {
      expect(snapshot.newsResearch.items.length).toBe(0);
    }
  });

  it('relevanceToIssuer в диапазоне 0..1', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER прибыль',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Тест',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    for (const item of snapshot.newsResearch!.items) {
      expect(item.relevanceToIssuer).toBeGreaterThanOrEqual(0);
      expect(item.relevanceToIssuer).toBeLessThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════
// 7. duplicate news удаляются
// ═══════════════════════════════════════════════

describe('duplicate news удаляются', () => {
  it('дубли по URL удаляются', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER прибыль',
        link: 'https://example.com/same-url',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Тест 1',
      }),
      createMockRawItem({
        title: 'SBER прибыль (дубль)',
        link: 'https://example.com/same-url',
        date: '2025-09-15T11:00:00Z',
        source: 'TASS',
        description: 'Тест 2',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    // Должна остаться только одна новость (первая)
    expect(snapshot.newsResearch!.items.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════
// 8. malformed article → игнорируется/diagnostic
// ═══════════════════════════════════════════════

describe('malformed article → игнорируется', () => {
  it('новость без title и link → пропускается', async () => {
    const mockItems: RawNewsItem[] = [
      {
        title: '',
        link: '',
        date: '2025-09-15T10:00:00Z',
        source: 'Тест',
        description: 'Мусор',
      },
      createMockRawItem({
        title: 'SBER новость',
        link: 'https://example.com/valid',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Тест',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    // Должна остаться только валидная новость
    expect(snapshot.newsResearch!.items.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════
// 9. HTTP error → NO_DATA
// ═══════════════════════════════════════════════

describe('HTTP error → NO_DATA', () => {
  it('ошибка fetcher → snapshot без newsResearch', async () => {
    const fetcher = createMockErrorFetcher('Network error');
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.newsResearch).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// 10. rate-limit → NO_DATA
// ═══════════════════════════════════════════════

describe('rate-limit → NO_DATA', () => {
  it('HTTP 429 → snapshot без newsResearch', async () => {
    const fetcher = {
      async fetch(): Promise<import('./news-fetcher.js').FetchResult> {
        const { NewsFetchError } = await import('./news-fetcher.js');
        throw new NewsFetchError(
          'Rate limit exceeded',
          429,
          'HTTP 429: Too Many Requests',
        );
      },
    };

    const provider = new NewsResearchProvider(
      fetcher as unknown as import('./news-fetcher.js').NewsFetcher,
    );

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.newsResearch).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// 11. every news item has provenance
// ═══════════════════════════════════════════════

describe('every news item has provenance', () => {
  it('каждая новость имеет evidence в snapshot.evidence', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER прибыль',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Чистая прибыль выросла',
      }),
      createMockRawItem({
        title: 'SBER дивиденды',
        link: 'https://example.com/2',
        date: '2025-09-14T10:00:00Z',
        source: 'TASS',
        description: 'Совет директоров назначил дивиденды',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.newsResearch!.items.length).toBeGreaterThan(0);

    for (const item of snapshot.newsResearch!.items) {
      // Каждая новость имеет url
      expect(item.url).toBeDefined();
      expect(item.url.length).toBeGreaterThan(0);

      // Ищем evidence с таким же url
      const hasEvidence = Object.values(snapshot.evidence).some(
        (ev) => ev.url === item.url,
      );
      expect(hasEvidence).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════
// 12. evidence type = NEWS
// ═══════════════════════════════════════════════

describe('evidence type = NEWS', () => {
  it('каждый evidence имеет type NEWS', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER прибыль',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Тест',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    for (const ev of Object.values(snapshot.evidence)) {
      expect(ev.type).toBe('NEWS');
    }
  });
});

// ═══════════════════════════════════════════════
// 13. cache работает
// ═══════════════════════════════════════════════

describe('cache работает', () => {
  it('повторный запрос для того же ticker возвращает кэшированные данные', async () => {
    let fetchCount = 0;
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER прибыль',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Тест',
      }),
    ];

    const fetcher = {
      async fetch(): Promise<import('./news-fetcher.js').FetchResult> {
        fetchCount++;
        return {
          items: mockItems,
          sourceName: 'Google News RSS',
          success: true,
        };
      },
    };

    const provider = new NewsResearchProvider(
      fetcher as unknown as import('./news-fetcher.js').NewsFetcher,
    );

    // Первый запрос — fetch
    await provider.research(createAsset({ ticker: 'SBER' }), createContext());
    expect(fetchCount).toBe(1);

    // Второй запрос — из кэша
    await provider.research(createAsset({ ticker: 'SBER' }), createContext());
    expect(fetchCount).toBe(1); // fetch не вызвался повторно
  });

  it('разные tickers не кэшируются вместе', async () => {
    let fetchCount = 0;
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER прибыль',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Тест',
      }),
    ];

    const fetcher = {
      async fetch(): Promise<import('./news-fetcher.js').FetchResult> {
        fetchCount++;
        return {
          items: mockItems,
          sourceName: 'Google News RSS',
          success: true,
        };
      },
    };

    const provider = new NewsResearchProvider(
      fetcher as unknown as import('./news-fetcher.js').NewsFetcher,
    );

    await provider.research(createAsset({ ticker: 'SBER' }), createContext());
    expect(fetchCount).toBe(1);

    await provider.research(createAsset({ ticker: 'GAZP' }), createContext());
    expect(fetchCount).toBe(2); // GAZP — новый ключ
  });
});

// ═══════════════════════════════════════════════
// 14. provider НЕ создаёт AIRecommendation
// ═══════════════════════════════════════════════

describe('provider НЕ создаёт AIRecommendation', () => {
  it('aiRecommendation = undefined', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER прибыль',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Тест',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.aiRecommendation).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// 15. provider НЕ создаёт InvestmentThesis
// ═══════════════════════════════════════════════

describe('provider НЕ создаёт InvestmentThesis', () => {
  it('investmentThesis = undefined', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER прибыль',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Тест',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.investmentThesis).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// 16. provider не придумывает sentiment при отсутствии данных
// ═══════════════════════════════════════════════

describe('provider не придумывает sentiment', () => {
  it('нейтральная новость → UNKNOWN sentiment', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER провела встречу с инвесторами',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Банк провёл встречу',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const sentiment = snapshot.newsResearch!.items[0].sentiment;
    expect(sentiment).toBe('UNKNOWN');
  });

  it('новость с позитивными словами → POSITIVE', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER показал рост прибыли',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Рост чистой прибыли',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const sentiment = snapshot.newsResearch!.items[0].sentiment;
    expect(sentiment).toBe('POSITIVE');
  });

  it('новость с негативными словами → NEGATIVE', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER столкнулся с убытками',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Банк понёс убытки',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const sentiment = snapshot.newsResearch!.items[0].sentiment;
    expect(sentiment).toBe('NEGATIVE');
  });
});

// ═══════════════════════════════════════════════
// 17. empty result → NO_DATA
// ═══════════════════════════════════════════════

describe('empty result → NO_DATA', () => {
  it('пустой массив новостей → snapshot без newsResearch', async () => {
    const fetcher = createMockFetcher([]);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.newsResearch).toBeUndefined();
  });

  it('все новости нерелевантны → snapshot без newsResearch', async () => {
    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'Apple представила новый продукт',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Reuters',
        description: 'Apple Inc. объявила...',
      }),
      createMockRawItem({
        title: 'Google обновил поисковую алгоритм',
        link: 'https://example.com/2',
        date: '2025-09-14T10:00:00Z',
        source: 'Bloomberg',
        description: 'Alphabet Inc....',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER', name: 'Сбербанк' }),
      createContext(),
    );

    expect(snapshot.newsResearch).toBeUndefined();
  });

  it('identity всегда присутствует', async () => {
    const fetcher = createMockFetcher([]);
    const provider = new NewsResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER', name: 'Сбербанк' }),
      createContext(),
    );

    expect(snapshot.identity.ticker).toBe('SBER');
    expect(snapshot.identity.name).toBe('Сбербанк');
    expect(snapshot.identity.assetType).toBe('STOCK');
  });
});

// ═══════════════════════════════════════════════
// 18. Registry integration
// ═══════════════════════════════════════════════

describe('Registry integration', () => {
  it('registry находит NewsResearchProvider для STOCK', async () => {
    const { ResearchProviderRegistry } = await import('./registry.js');
    const registry = new ResearchProviderRegistry();

    const mockItems: RawNewsItem[] = [
      createMockRawItem({
        title: 'SBER прибыль',
        link: 'https://example.com/1',
        date: '2025-09-15T10:00:00Z',
        source: 'Интерфакс',
        description: 'Тест',
      }),
    ];

    const fetcher = createMockFetcher(mockItems);
    const newsProvider = new NewsResearchProvider(fetcher);
    registry.register(newsProvider);

    const asset = createAsset({ ticker: 'SBER', assetType: 'STOCK' });
    const found = registry.findProviders(asset);

    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.some((p) => p === newsProvider)).toBe(true);
  });

  it('registry не находит NewsResearchProvider для BOND', async () => {
    const { ResearchProviderRegistry } = await import('./registry.js');
    const registry = new ResearchProviderRegistry();

    const fetcher = createMockFetcher([]);
    const newsProvider = new NewsResearchProvider(fetcher);
    registry.register(newsProvider);

    const asset = createAsset({ ticker: 'RU000A10', assetType: 'BOND' });
    const found = registry.findProviders(asset);

    expect(found.some((p) => p === newsProvider)).toBe(false);
  });
});

