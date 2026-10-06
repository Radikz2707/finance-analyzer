import { NewsCache } from './news-cache.js';

/** Вспомогательная функция для вычисления хеша */
function computeHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

describe('NewsCache', () => {
  let cache: NewsCache;

  beforeEach(() => {
    cache = new NewsCache({ maxItems: 100 });
    cache.clear();
  });

  it('должен добавлять новость в кэш', () => {
    const item = {
      title: 'Сбербанк показал рост прибыли',
      description: 'Банк отчитался о увеличении прибыли на 15%',
      url: 'https://example.com/sber-profit',
      date: new Date().toISOString(),
      metadata: {
        sourceName: 'РБК',
        category: 'Финансы',
        tickers: 'SBER',
      },
    };

    const cached = cache.add(item, ['SBER'], true);
    
    expect(cached.id).toBeDefined();
    expect(cached.title).toBe(item.title);
    expect(cached.tickers).toContain('SBER');
    expect(cached.isMoscowExchange).toBe(true);
  });

  it('должен определять позитивный сентимент', () => {
    const item = {
      title: 'Сбербанк показал рекордный рост прибыли',
      description: 'Банк отчитался о увеличении прибыли на 15%',
      url: 'https://example.com/sber-profit',
      date: new Date().toISOString(),
      metadata: { sourceName: 'РБК' },
    };

    const cached = cache.add(item, ['SBER'], true);
    expect(cached.sentiment).toBe('positive');
  });

  it('должен определять негативный сентимент', () => {
    const item = {
      title: 'Сбербанк столкнулся с проблемами и санкциями',
      description: 'Банк может столкнуться с новыми ограничениями',
      url: 'https://example.com/sber-problems',
      date: new Date().toISOString(),
      metadata: { sourceName: 'Интерфакс' },
    };

    const cached = cache.add(item, ['SBER'], true);
    expect(cached.sentiment).toBe('negative');
  });

  it('должен определять важность новости', () => {
    const criticalItem = {
      title: 'ЦБ повысил ключевую ставку до 20%',
      description: 'Решение повлияет на весь рынок',
      url: 'https://example.com/cb-rate',
      date: new Date().toISOString(),
      metadata: { sourceName: 'РБК' },
    };

    const cachedCritical = cache.add(criticalItem, ['SBER', 'GAZP'], true);
    expect(cachedCritical.importance).toBe('critical');

    const highItem = {
      title: 'Лукойл объявил дивиденды',
      description: 'Дивиденды за год составят 500 рублей на акцию',
      url: 'https://example.com/lukoil-div',
      date: new Date().toISOString(),
      metadata: { sourceName: 'Финам' },
    };

    const cachedHigh = cache.add(highItem, ['LKOH'], true);
    expect(cachedHigh.importance).toBe('high');
  });

  it('должен возвращать новости по тикеру', () => {
    const item1 = {
      title: 'Сбербанк вырос',
      description: 'Акции Сбербанка выросли на 5%',
      url: 'https://example.com/sber-up',
      date: new Date().toISOString(),
      metadata: { sourceName: 'РБК' },
    };

    const item2 = {
      title: 'Газпром упал',
      description: 'Акции Газпрома снизились на 3%',
      url: 'https://example.com/gazp-down',
      date: new Date().toISOString(),
      metadata: { sourceName: 'Интерфакс' },
    };

    cache.add(item1, ['SBER'], true);
    cache.add(item2, ['GAZP'], true);

    const sberNews = cache.getByTicker('SBER');
    expect(sberNews.length).toBe(1);
    expect(sberNews[0]?.title).toBe('Сбербанк вырос');

    const gazpNews = cache.getByTicker('GAZP');
    expect(gazpNews.length).toBe(1);
    expect(gazpNews[0]?.title).toBe('Газпром упал');
  });

  it('должен обновлять mentionCount при дубликатах', () => {
    const item = {
      title: 'Сбербанк показал рост',
      description: 'Акции выросли',
      url: 'https://example.com/sber-up',
      date: new Date().toISOString(),
      metadata: { sourceName: 'РБК' },
    };

    cache.add(item, ['SBER'], true);
    cache.add(item, ['SBER'], true);

    const cached = cache.get(computeHash('https://example.com/sber-upСбербанк показал рост'));
    expect(cached?.mentionCount).toBe(2);
  });

  it('должен возвращать статистику', () => {
    cache.add(
      {
        title: 'Сбербанк вырос',
        description: 'Акции выросли',
        url: 'https://example.com/sber-up',
        date: new Date().toISOString(),
        metadata: { sourceName: 'РБК' },
      },
      ['SBER'],
      true,
    );

    cache.add(
      {
        title: 'Лукойл объявил дивиденды',
        description: 'Дивиденды за год',
        url: 'https://example.com/lukoil-div',
        date: new Date().toISOString(),
        metadata: { sourceName: 'Финам' },
      },
      ['LKOH'],
      true,
    );

    const stats = cache.getStats();
    expect(stats.totalItems).toBe(2);
    expect(stats.moscowExchangeItems).toBe(2);
    expect(stats.uniqueTickers).toBe(2);
  });

  it('должен строить тренды', () => {
    // Добавляем несколько позитивных новостей по SBER
    for (let i = 0; i < 5; i++) {
      cache.add(
        {
          title: `Сбербанк показал рост ${i + 1}`,
          description: 'Акции растут',
          url: `https://example.com/sber-up-${i}`,
          date: new Date().toISOString(),
          metadata: { sourceName: 'РБК' },
        },
        ['SBER'],
        true,
      );
    }

    // Добавляем негативные новости по GAZP
    for (let i = 0; i < 3; i++) {
      cache.add(
        {
          title: `Газпром столкнулся с проблемами ${i + 1}`,
          description: 'Акции падают',
          url: `https://example.com/gazp-down-${i}`,
          date: new Date().toISOString(),
          metadata: { sourceName: 'Интерфакс' },
        },
        ['GAZP'],
        true,
      );
    }

    const trends = cache.getTrends();
    expect(trends.length).toBe(2);

    const sberTrend = trends.find((t) => t.ticker === 'SBER');
    expect(sberTrend).toBeDefined();
    expect(sberTrend!.averageSentiment).toBeGreaterThan(0);

    const gazpTrend = trends.find((t) => t.ticker === 'GAZP');
    expect(gazpTrend).toBeDefined();
    expect(gazpTrend!.averageSentiment).toBeLessThan(0);
  });
});
