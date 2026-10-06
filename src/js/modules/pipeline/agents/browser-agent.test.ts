/**
 * BrowserAgent Tests — веб-мониторинг: поиск, парсинг страниц, цены, новости, refresh.
 *
 * Все внешние зависимости (browserGateway, newsProvider, priceProvider, newsCache)
 * инжектируются моками — тесты НЕ ходят в сеть. Проверяются:
 * слои «API → fallback браузер → нет данных», whitelist доменов и https,
 * лимиты контента, таймауты, дедупликация, кэширование refresh.
 */

import {
  BrowserAgent,
  DEFAULT_ALLOWED_DOMAINS,
  isUrlAllowed,
} from './browser-agent.js';
import type {
  BrowserAgentOutput,
  BrowserGatewayLike,
  NewsCacheLike,
  NewsProviderLike,
  PriceProviderLike,
  WebResult,
} from './browser-agent.js';

// ─── Helpers ───────────────────────────────────────────────

function outputOf(result: { data?: unknown }): BrowserAgentOutput {
  return result.data as BrowserAgentOutput;
}

/** Безопасные no-op провайдеры — если тест не инжектирует мок, сеть не трогается */
const NOOP_NEWS_PROVIDER: NewsProviderLike = {
  async fetchNews(): Promise<WebResult[]> {
    return [];
  },
};

const NOOP_PRICE_PROVIDER: PriceProviderLike = {
  async getPrices(): Promise<WebResult[]> {
    return [];
  },
};

interface AgentTestOptions {
  browserGateway?: BrowserGatewayLike | null;
  newsProvider?: NewsProviderLike;
  priceProvider?: PriceProviderLike;
  newsCache?: NewsCacheLike;
  timeoutMs?: number;
  refreshIntervalMs?: number;
  refreshCacheTtlMs?: number;
  maxContentBytes?: number;
}

function createAgent(options: AgentTestOptions = {}): BrowserAgent {
  return new BrowserAgent(
    { name: 'BrowserAgent' },
    {
      browserGateway: options.browserGateway ?? null,
      newsProvider: options.newsProvider ?? NOOP_NEWS_PROVIDER,
      priceProvider: options.priceProvider ?? NOOP_PRICE_PROVIDER,
      newsCache: options.newsCache,
      timeoutMs: options.timeoutMs,
      refreshIntervalMs: options.refreshIntervalMs,
      refreshCacheTtlMs: options.refreshCacheTtlMs,
      maxContentBytes: options.maxContentBytes,
    },
  );
}

function createMockBrowserGateway(
  handler?: (
    url: string,
    options?: { timeoutMs?: number; maxContentBytes?: number },
  ) => Promise<{ url: string; title?: string; text: string }>,
): { gateway: BrowserGatewayLike; urls: string[] } {
  const urls: string[] = [];
  const gateway: BrowserGatewayLike = {
    async navigate(
      url: string,
    ): Promise<{ url: string; title?: string; text: string }> {
      urls.push(url);
      if (handler) return handler(url);
      return { url, title: 'Mock Title', text: 'mock content '.repeat(40) };
    },
  };
  return { gateway, urls };
}

function createMockNewsProvider(items: WebResult[]): {
  provider: NewsProviderLike;
  calls: string[];
} {
  const calls: string[] = [];
  const provider: NewsProviderLike = {
    async fetchNews(query?: string): Promise<WebResult[]> {
      calls.push(query ?? '');
      return items;
    },
  };
  return { provider, calls };
}

function createMockPriceProvider(items: WebResult[] | Error): {
  provider: PriceProviderLike;
  calls: string[];
} {
  const calls: string[] = [];
  const provider: PriceProviderLike = {
    async getPrices(tickers: string[]): Promise<WebResult[]> {
      calls.push(tickers.join(','));
      if (items instanceof Error) throw items;
      return items;
    },
  };
  return { provider, calls };
}

function createMockCache(
  items: Array<{
    title?: string;
    url?: string;
    description?: string;
    date?: string;
  }>,
): NewsCacheLike {
  const store = [...items];
  return {
    add(item): unknown {
      if (item.url && !store.some((s) => s.url === item.url)) {
        store.push(item);
      }
      return item;
    },
    getLatest(limit = 10): typeof items {
      return store.slice(0, limit);
    },
  };
}

/** JSON-ответ MOEX ISS marketdata (как его вернул бы браузер в fallback) */
const MOEX_JSON = JSON.stringify({
  marketdata: {
    columns: ['SECID', 'LAST'],
    data: [['SBER', 233.45]],
  },
});

// ─── search ─────────────────────────────────────────────────

describe('BrowserAgent — search (поиск по новостным источникам)', () => {
  it('возвращает результаты от API-провайдера', async () => {
    const items: WebResult[] = [
      {
        title: 'Сбер отчитался',
        url: 'https://rbc.ru/sber',
        snippet: '…',
        publishedAt: '2026-10-01',
      },
    ];
    const { provider, calls } = createMockNewsProvider(items);
    const agent = createAgent({ newsProvider: provider });

    const out = outputOf(
      await agent.execute({ action: 'search', query: 'Сбер' }),
    );

    expect(out.action).toBe('search');
    expect(out.items).toEqual(items);
    expect(out.source).toBe('news:api');
    expect(out.warning).toBeUndefined();
    expect(calls).toEqual(['Сбер']);
  });

  it('пустой query → честное «нет данных», провайдер не вызывается', async () => {
    const { provider, calls } = createMockNewsProvider([]);
    const agent = createAgent({ newsProvider: provider });

    const out = outputOf(await agent.execute({ action: 'search' }));

    expect(out.items).toEqual([]);
    expect(out.source).toBe('no-data');
    expect(out.warning).toContain('не указан query');
    expect(calls).toEqual([]);
  });

  it('падение провайдера → «нет данных» с предупреждением', async () => {
    const provider: NewsProviderLike = {
      async fetchNews(): Promise<WebResult[]> {
        throw new Error('network down');
      },
    };
    const agent = createAgent({ newsProvider: provider });

    const out = outputOf(
      await agent.execute({ action: 'search', query: 'GAZP' }),
    );

    expect(out.items).toEqual([]);
    expect(out.source).toBe('no-data');
    expect(out.warning).toContain('недоступен');
  });
});

// ─── fetch-page ─────────────────────────────────────────────

describe('BrowserAgent — fetch-page (парсинг через браузерный шлюз)', () => {
  it('разрешённый домен → контент страницы', async () => {
    const { gateway, urls } = createMockBrowserGateway(async (url) => ({
      url,
      title: 'Московская биржа',
      text: 'Промокод акции SBER сегодня.'.repeat(10),
    }));
    const agent = createAgent({ browserGateway: gateway });

    const out = outputOf(
      await agent.execute({
        action: 'fetch-page',
        url: 'https://www.moex.com/ru/issue.aspx?code=SBER',
      }),
    );

    expect(out.source).toBe('browser:gateway');
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.title).toBe('Московская биржа');
    expect(out.items[0]?.snippet).toContain('SBER');
    expect(urls).toEqual(['https://www.moex.com/ru/issue.aspx?code=SBER']);
  });

  it('лимит контента обрезает текст страницы', async () => {
    const { gateway } = createMockBrowserGateway(async (url) => ({
      url,
      title: 'T',
      text: 'x'.repeat(1000),
    }));
    const agent = createAgent({
      browserGateway: gateway,
      maxContentBytes: 100,
    });

    const out = outputOf(
      await agent.execute({
        action: 'fetch-page',
        url: 'https://cbr.ru/key-indicators',
      }),
    );

    expect(out.items[0]?.snippet?.length).toBeLessThanOrEqual(100);
  });

  it('запрещённый домен → deny, браузер не вызывается', async () => {
    const { gateway, urls } = createMockBrowserGateway();
    const agent = createAgent({ browserGateway: gateway });

    const out = outputOf(
      await agent.execute({
        action: 'fetch-page',
        url: 'https://example.com/private',
      }),
    );

    expect(out.source).toBe('deny');
    expect(out.items).toEqual([]);
    expect(out.warning).toContain('белом списке');
    expect(urls).toEqual([]);
  });

  it('http (не https) → deny «только https»', async () => {
    const { gateway, urls } = createMockBrowserGateway();
    const agent = createAgent({ browserGateway: gateway });

    const out = outputOf(
      await agent.execute({ action: 'fetch-page', url: 'http://moex.com/' }),
    );

    expect(out.source).toBe('deny');
    expect(out.warning).toContain('только https');
    expect(urls).toEqual([]);
  });

  it('без браузерного шлюза → честное «нет данных»', async () => {
    const agent = createAgent({ browserGateway: null });

    const out = outputOf(
      await agent.execute({
        action: 'fetch-page',
        url: 'https://www.moex.com/',
      }),
    );

    expect(out.items).toEqual([]);
    expect(out.source).toBe('no-data');
    expect(out.warning).toContain('не настроен');
  });

  it('таймаут навигации → «нет данных» с предупреждением о таймауте', async () => {
    const gateway: BrowserGatewayLike = {
      navigate(): Promise<{ url: string; text: string }> {
        return new Promise(() => {
          // Никогда не резолвится — срабатывает таймаут агента
        });
      },
    };
    const agent = createAgent({ browserGateway: gateway, timeoutMs: 30 });

    const out = outputOf(
      await agent.execute({
        action: 'fetch-page',
        url: 'https://www.finam.ru/news',
      }),
    );

    expect(out.items).toEqual([]);
    expect(out.source).toBe('no-data');
    expect(out.warning).toContain('таймаут');
  });

  it('ошибка навигации → «нет данных» без выдуманного контента', async () => {
    const { gateway } = createMockBrowserGateway(async () => {
      throw new Error('HTTP 500');
    });
    const agent = createAgent({ browserGateway: gateway });

    const out = outputOf(
      await agent.execute({
        action: 'fetch-page',
        url: 'https://www.investing.com/news',
      }),
    );

    expect(out.items).toEqual([]);
    expect(out.warning).toContain('HTTP 500');
  });
});

// ─── prices ─────────────────────────────────────────────────

describe('BrowserAgent — prices (API → fallback браузер)', () => {
  it('успех через API-провайдера (браузер не вызывается)', async () => {
    const { provider } = createMockPriceProvider([
      {
        ticker: 'SBER',
        price: 250.1,
        url: 'https://iss.moex.com/iss/history.json?ticker=SBER',
      },
    ]);
    const { gateway, urls } = createMockBrowserGateway();
    const agent = createAgent({
      browserGateway: gateway,
      priceProvider: provider,
    });

    const out = outputOf(
      await agent.execute({ action: 'prices', tickers: ['SBER'] }),
    );

    expect(out.source).toBe('api:moex');
    expect(out.items[0]).toMatchObject({ ticker: 'SBER', price: 250.1 });
    expect(urls).toEqual([]);
  });

  it('падение API → fallback на браузер (MOEX ISS JSON)', async () => {
    const { provider } = createMockPriceProvider(new Error('API down'));
    const { gateway, urls } = createMockBrowserGateway(async (url) => ({
      url,
      title: '',
      text: MOEX_JSON,
    }));
    const agent = createAgent({
      browserGateway: gateway,
      priceProvider: provider,
    });

    const out = outputOf(
      await agent.execute({ action: 'prices', tickers: ['SBER'] }),
    );

    expect(out.source).toBe('browser:gateway');
    expect(out.items[0]).toMatchObject({ ticker: 'SBER', price: 233.45 });
    expect(urls[0]).toContain('iss.moex.com');
    expect(urls[0]).toContain('SBER');
  });

  it('API и браузер недоступны → честное «нет данных»', async () => {
    const { provider } = createMockPriceProvider(new Error('API down'));
    const agent = createAgent({
      browserGateway: null,
      priceProvider: provider,
    });

    const out = outputOf(
      await agent.execute({ action: 'prices', tickers: ['SBER'] }),
    );

    expect(out.items).toEqual([]);
    expect(out.source).toBe('no-data');
    expect(out.warning).toContain('нет данных');
  });

  it('пустой список тикеров → «нет данных» без вызовов', async () => {
    const { provider, calls } = createMockPriceProvider([]);
    const agent = createAgent({ priceProvider: provider });

    const out = outputOf(await agent.execute({ action: 'prices' }));

    expect(out.items).toEqual([]);
    expect(out.warning).toContain('не указаны tickers');
    expect(calls).toEqual([]);
  });
});

// ─── news ───────────────────────────────────────────────────

describe('BrowserAgent — news (сбор новостей)', () => {
  it('дедупликация по url', async () => {
    const { provider } = createMockNewsProvider([
      { title: 'A', url: 'https://rbc.ru/a' },
      { title: 'B (тот же url)', url: 'https://rbc.ru/a' },
      { title: 'C', url: 'https://rbc.ru/c' },
    ]);
    const agent = createAgent({ newsProvider: provider });

    const out = outputOf(await agent.execute({ action: 'news', limit: 10 }));

    expect(out.items).toHaveLength(2);
    expect(out.source).toBe('news:api');
  });

  it('лимит результатов', async () => {
    const many: WebResult[] = Array.from({ length: 5 }, (_, i) => ({
      title: `Новость ${i}`,
      url: `https://rbc.ru/n${i}`,
    }));
    const { provider } = createMockNewsProvider(many);
    const agent = createAgent({ newsProvider: provider });

    const out = outputOf(await agent.execute({ action: 'news', limit: 2 }));

    expect(out.items).toHaveLength(2);
  });

  it('пусто у провайдера + есть кэш → новости из кэша', async () => {
    const { provider } = createMockNewsProvider([]);
    const cache = createMockCache([
      {
        title: 'Из кэша',
        url: 'https://rbc.ru/cached',
        description: 'd',
        date: '2026-10-01',
      },
    ]);
    const agent = createAgent({ newsProvider: provider, newsCache: cache });

    const out = outputOf(await agent.execute({ action: 'news' }));

    expect(out.source).toBe('news:cache');
    expect(out.items[0]?.title).toBe('Из кэша');
    expect(out.warning).toContain('кэша');
  });

  it('пусто у провайдера, нет браузера и кэша → «нет данных»', async () => {
    const { provider } = createMockNewsProvider([]);
    const agent = createAgent({ newsProvider: provider });

    const out = outputOf(await agent.execute({ action: 'news' }));

    expect(out.items).toEqual([]);
    expect(out.source).toBe('no-data');
    expect(out.warning).toContain('нет данных');
  });

  it('браузерный RSS fallback, когда API пуст', async () => {
    const { provider } = createMockNewsProvider([]);
    const rssXml =
      '<rss><channel><item><title>Финам: рост рынка</title>' +
      '<link>https://www.finam.ru/news/1</link>' +
      '<pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate>' +
      '<description>Описание новости</description></item></channel></rss>';
    const { gateway } = createMockBrowserGateway(async () => ({
      url: 'https://www.finam.ru/infoblock/newsfeed/rss.aspx',
      text: rssXml,
    }));
    const agent = createAgent({
      browserGateway: gateway,
      newsProvider: provider,
    });

    const out = outputOf(
      await agent.execute({ action: 'news', query: 'рост' }),
    );

    expect(out.source).toBe('news:browser');
    expect(out.items[0]?.title).toBe('Финам: рост рынка');
    expect(out.items[0]?.url).toBe('https://www.finam.ru/news/1');
  });
});

// ─── refresh ────────────────────────────────────────────────

describe('BrowserAgent — refresh (автоматическое обновление)', () => {
  it('вызывает все указанные источники и агрегирует результат', async () => {
    const news = createMockNewsProvider([
      { title: 'Новость', url: 'https://rbc.ru/n1', publishedAt: '2026-10-01' },
    ]);
    const price = createMockPriceProvider([
      { ticker: 'SBER', price: 240, url: 'https://iss.moex.com/sber' },
    ]);
    const agent = createAgent({
      newsProvider: news.provider,
      priceProvider: price.provider,
      refreshIntervalMs: 0,
    });

    const out = outputOf(
      await agent.execute({
        action: 'refresh',
        query: 'SBER',
        tickers: ['SBER'],
        sources: ['news', 'prices'],
      }),
    );

    expect(out.action).toBe('refresh');
    expect(out.source).toBe('refresh:news+prices');
    expect(out.items).toHaveLength(2);
    expect(news.calls).toEqual(['SBER']);
    expect(price.calls).toEqual(['SBER']);
  });

  it('дедуплицирует одинаковые элементы между источниками', async () => {
    const shared: WebResult = {
      title: 'Одна новость',
      url: 'https://rbc.ru/shared',
    };
    const news = createMockNewsProvider([shared]);
    const agent = createAgent({
      newsProvider: news.provider,
      refreshIntervalMs: 0,
    });

    const out = outputOf(
      await agent.execute({
        action: 'refresh',
        query: 'SBER',
        sources: ['news', 'search'],
      }),
    );

    // news и search вернули один и тот же элемент — он должен встретиться один раз
    expect(out.items).toHaveLength(1);
    expect(news.calls).toHaveLength(2); // один вызов на источник
  });

  it('кэширует результат; повторный вызов не дублирует источники', async () => {
    const news = createMockNewsProvider([
      { title: 'Новость', url: 'https://rbc.ru/n1' },
    ]);
    const price = createMockPriceProvider([
      { ticker: 'SBER', price: 240, url: 'https://iss.moex.com/sber' },
    ]);
    const agent = createAgent({
      newsProvider: news.provider,
      priceProvider: price.provider,
      refreshIntervalMs: 0,
    });
    const input = {
      action: 'refresh' as const,
      query: 'SBER',
      tickers: ['SBER'],
      sources: ['news', 'prices'],
    };

    const first = outputOf(await agent.execute(input));
    const second = outputOf(await agent.execute(input));

    expect(first.items).toHaveLength(2);
    expect(second.items).toEqual(first.items);
    expect(news.calls).toHaveLength(1); // повторный вызов из кэша
    expect(price.calls).toHaveLength(1);
    expect(agent.refreshCacheSize).toBe(1);
  });

  it('TTL кэша 0 → повторный вызов переспрашивает источники', async () => {
    const news = createMockNewsProvider([
      { title: 'Новость', url: 'https://rbc.ru/n1' },
    ]);
    const agent = createAgent({
      newsProvider: news.provider,
      refreshIntervalMs: 0,
      refreshCacheTtlMs: 0,
    });
    const input = { action: 'refresh' as const, query: 'x', sources: ['news'] };

    await agent.execute(input);
    await agent.execute(input);

    expect(news.calls).toHaveLength(2);
  });
});

// ─── утилиты ────────────────────────────────────────────────

describe('BrowserAgent — isUrlAllowed (whitelist доменов)', () => {
  it('точное совпадение и поддомены разрешены', () => {
    expect(
      isUrlAllowed('https://moex.com/', DEFAULT_ALLOWED_DOMAINS).allowed,
    ).toBe(true);
    expect(
      isUrlAllowed('https://iss.moex.com/iss/…', DEFAULT_ALLOWED_DOMAINS)
        .allowed,
    ).toBe(true);
    expect(
      isUrlAllowed('https://www.cbr.ru/', DEFAULT_ALLOWED_DOMAINS).allowed,
    ).toBe(true);
  });

  it('посторонний домен и http запрещены', () => {
    expect(
      isUrlAllowed('https://example.com/', DEFAULT_ALLOWED_DOMAINS).allowed,
    ).toBe(false);
    expect(
      isUrlAllowed('http://moex.com/', DEFAULT_ALLOWED_DOMAINS).allowed,
    ).toBe(false);
  });
});
