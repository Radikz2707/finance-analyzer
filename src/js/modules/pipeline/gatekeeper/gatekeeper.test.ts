/**
 * Gatekeeper Tests — тесты для модуля фильтрации новостей.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Gatekeeper } from './gatekeeper.js';
import type { GatekeeperConfig, RawNewsItem, INewsSource, NewsSource } from './types.js';

// ──────────────────────────────────────────────
// Mock источник новостей
// ──────────────────────────────────────────────

class MockNewsSource implements INewsSource {
  public readonly name: NewsSource = 'custom_rss';
  public readonly enabled = true;
  private mockData: RawNewsItem[];

  constructor(data: RawNewsItem[]) {
    this.mockData = data;
  }

  async fetch(): Promise<RawNewsItem[]> {
    return [...this.mockData];
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

// ──────────────────────────────────────────────
// Тесты
// ──────────────────────────────────────────────

describe('Gatekeeper', () => {
  let config: GatekeeperConfig;
  let source: MockNewsSource;

  beforeEach(() => {
    config = {
      monitoredTickers: ['SBER', 'GAZP', 'LKHN'],
      verbose: false,
    };
  });

  it('должен одобрить новости с тикерами из списка', async () => {
    const newsItems: RawNewsItem[] = [
      {
        title: 'Сбербанк объявил о дивидендах',
        description: 'SBER повысил дивиденды на 15%',
        url: 'https://example.com/sber-div',
        date: new Date().toISOString(),
      },
      {
        title: 'Газпром снизил добычу',
        description: 'GAZP сократил добычу на 10%',
        url: 'https://example.com/gazp-drops',
        date: new Date().toISOString(),
      },
    ];

    source = new MockNewsSource(newsItems);
    const gatekeeper = new Gatekeeper(config, [source]);
    const result = await gatekeeper.run();

    expect(result.approvedNews.length).toBe(2);
    expect(result.approvedNews[0].relevantTickers).toContain('SBER');
    expect(result.approvedNews[1].relevantTickers).toContain('GAZP');
  });

  it('должен отфильтровать нерелевантные новости', async () => {
    const newsItems: RawNewsItem[] = [
      {
        title: 'Apple представила новый iPhone',
        description: 'Купертино анонсировало iPhone 16',
        url: 'https://example.com/apple-iphone',
        date: new Date().toISOString(),
      },
      {
        title: 'Рынки Азии растут',
        description: 'Азиатские индексы показали рост',
        url: 'https://example.com/asia-markets',
        date: new Date().toISOString(),
      },
    ];

    source = new MockNewsSource(newsItems);
    const gatekeeper = new Gatekeeper(config, [source]);
    const result = await gatekeeper.run();

    expect(result.approvedNews.length).toBe(0);
    expect(result.filteredOut.total).toBe(2);
  });

  it('должен дедуплицировать новости по content hash', async () => {
    const newsItems: RawNewsItem[] = [
      {
        title: 'Сбербанк объявил о дивидендах',
        description: 'SBER повысил дивиденды на 15%',
        url: 'https://example.com/sber-div-1',
        date: new Date().toISOString(),
      },
      {
        title: 'Сбербанк объявил о дивидендах',
        description: 'SBER повысил дивиденды на 15%',
        url: 'https://example.com/sber-div-2',
        date: new Date().toISOString(),
      },
    ];

    source = new MockNewsSource(newsItems);
    const gatekeeper = new Gatekeeper(config, [source]);
    const result = await gatekeeper.run();

    expect(result.approvedNews.length).toBe(1);
    expect(result.filteredOut.byReason['duplicate']).toBe(1);
  });

  it('должен определить критический приоритет для банкротства', async () => {
    const newsItems: RawNewsItem[] = [
      {
        title: 'GAZP объявил о банкротстве',
        description: 'Газпром не может оплатить долги',
        url: 'https://example.com/gazp-bankrupt',
        date: new Date().toISOString(),
      },
    ];

    source = new MockNewsSource(newsItems);
    const gatekeeper = new Gatekeeper(config, [source]);
    const result = await gatekeeper.run();

    expect(result.approvedNews.length).toBe(1);
    expect(result.approvedNews[0].priority).toBe('critical');
  });

  it('должен определить высокий приоритет для дивидендов', async () => {
    const newsItems: RawNewsItem[] = [
      {
        title: 'Сбербанк повысил дивиденды',
        description: 'SBER увеличил дивиденды на 15%',
        url: 'https://example.com/sber-div',
        date: new Date().toISOString(),
      },
    ];

    source = new MockNewsSource(newsItems);
    const gatekeeper = new Gatekeeper(config, [source]);
    const result = await gatekeeper.run();

    expect(result.approvedNews.length).toBe(1);
    expect(result.approvedNews[0].priority).toBe('high');
  });

  it('должен отсечь шум', async () => {
    const newsItems: RawNewsItem[] = [
      {
        title: 'Анонс: скоро выйдет новый обзор рынка',
        description: 'Ожидается общий анализ рынка',
        url: 'https://example.com/market-review',
        date: new Date().toISOString(),
      },
    ];

    source = new MockNewsSource(newsItems);
    const gatekeeper = new Gatekeeper(config, [source]);
    const result = await gatekeeper.run();

    // Шум должен быть отфильтрован
    expect(result.filteredOut.byReason['noise']).toBe(1);
  });

  it('должен обновить список тикеров', async () => {
    source = new MockNewsSource([
      {
        title: 'Лукойл купил активы',
        description: 'LKHN расширил портфель',
        url: 'https://example.com/lkhn-buy',
        date: new Date().toISOString(),
      },
    ]);

    const gatekeeper = new Gatekeeper(config, [source]);
    
    // Изначально LKHN есть в списке
    const result1 = await gatekeeper.run();
    expect(result1.approvedNews.length).toBe(1);

    // Обновляем тикеры
    gatekeeper.updateTickers(['SBER', 'GAZP']);

    // LKHN больше не отслеживается
    const result2 = await gatekeeper.run();
    expect(result2.approvedNews.length).toBe(0);
  });

  it('должен вернуть статистику', async () => {
    const newsItems: RawNewsItem[] = [
      {
        title: 'Сбербанк объявил о дивидендах',
        description: 'SBER повысил дивиденды',
        url: 'https://example.com/sber-div',
        date: new Date().toISOString(),
      },
      {
        title: 'Apple представила iPhone',
        description: 'Купертино выпустила новый смартфон',
        url: 'https://example.com/apple',
        date: new Date().toISOString(),
      },
    ];

    source = new MockNewsSource(newsItems);
    const gatekeeper = new Gatekeeper(config, [source]);
    await gatekeeper.run();

    const stats = gatekeeper.getStats();
    expect(stats.totalProcessed).toBe(2);
    expect(stats.approved).toBe(1);
    expect(stats.filtered).toBe(1); // Apple — not_relevant
    expect(stats.noise).toBe(0);
  });

  it('должен остановить Gatekeeper', async () => {
    source = new MockNewsSource([
      {
        title: 'SBER дивиденды',
        description: 'SBER повысил дивиденды',
        url: 'https://example.com/sber',
        date: new Date().toISOString(),
      },
    ]);

    const gatekeeper = new Gatekeeper(config, [source]);
    await gatekeeper.stop();

    const stats = gatekeeper.getStats();
    expect(stats.totalProcessed).toBe(0);
  });
});
