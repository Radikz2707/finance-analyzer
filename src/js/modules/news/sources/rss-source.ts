/**
 * RSS-источник новостей.
 *
 * Поддерживает параллельный сбор из нескольких RSS-лент.
 * URLы лент загружаются динамически из Config API / MOEX / БД.
 */

import { BaseNewsSource, type NewsSourceResult, type RawNewsItem } from './base-source.js';
import { config as newsConfig } from '../news-config.js';

/** RSS-лента */
interface RssFeed {
  url: string;
  name: string;
}

/** RSS источник */
export class RssNewsSource extends BaseNewsSource {
  private feeds: RssFeed[] = [];

  constructor() {
    super({
      id: 'rss_aggregator',
      name: 'RSS Aggregator',
      url: '',
      type: 'rss',
      priority: 8,
      language: 'mixed',
      enabled: true,
      successStreak: 0,
      failureStreak: 0,
    });
  }

  /**
   * Установка RSS-лент (загружаются динамически).
   */
  async setFeeds(): Promise<void> {
    // Загрузка лент из Config API
    try {
      const response = await fetch('/api/config/rss-feeds');
      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        const feeds = data.feeds as Array<Record<string, unknown>>;
        this.feeds = feeds.map((feed) => ({
          url: (feed.url as string) || '',
          name: (feed.name as string) || '',
        }));
        return;
      }
    } catch {
      // Config API недоступен, пробуем MOEX
    }

    // Fallback: MOEX RSS
    try {
      const response = await fetch('https://iss.moex.com/iss/rss.xml');
      if (response.ok) {
        this.feeds = [
          {
            url: 'https://iss.moex.com/iss/rss.xml',
            name: 'MOEX RSS',
          },
        ];
        return;
      }
    } catch {
      // MOEX RSS недоступен
    }

    // Fallback: пустой набор
    this.feeds = [];
  }

  async fetch(tickers: string[]): Promise<NewsSourceResult> {
    // Загрузка лент
    await this.setFeeds();

    if (this.feeds.length === 0) {
      return {
        source: this.config.name,
        items: [],
      lastSuccessAt: this.lastSuccessAt || new Date().toISOString(),
        count: 0,
      };
    }

    // Параллельный сбор из всех лент
    const allItems: RawNewsItem[] = [];

    const promises = this.feeds.map(async (feed) => {
      try {
        const items = await this.fetchFeed(feed, tickers);
        return items;
      } catch (error) {
        console.warn(`[RSS] Ошибка ленты ${feed.name}:`, error);
        return [];
      }
    });

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allItems.push(...result.value);
      }
    }

    if (allItems.length > 0) {
      this.markSuccess();
    } else {
      this.markFailure(new Error('Все RSS-ленты вернули пустой результат'));
    }

    return {
      source: this.config.name,
      items: allItems,
      lastSuccessAt: this.lastSuccessAt ?? new Date().toISOString(),
      count: allItems.length,
    };
  }

  async healthCheck(): Promise<boolean> {
    await this.setFeeds();
    return this.feeds.length > 0;
  }

  /**
   * Сбор одной RSS-ленты.
   * Фильтрует новости по тикерам портфеля (если указаны).
   */
  private async fetchFeed(
    feed: RssFeed,
    tickers: string[],
  ): Promise<RawNewsItem[]> {
    const response = await fetch(feed.url, {
      signal: AbortSignal.timeout(newsConfig.NEWS_HTTP_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`RSS error: ${response.status}`);
    }

    const text = await response.text();
    const allItems = this.parseRssXml(text, feed.name);

    // Фильтрация по тикерам (если указаны)
    if (tickers.length === 0) {
      return allItems;
    }

    return allItems.filter((item) => this.isRelevantToTickers(item, tickers));
  }

  /**
   * Проверяет, релевантна ли новость тикерам портфеля.
   * Ищет точное совпадение ticker как отдельного слова в заголовке или описании.
   */
  private isRelevantToTickers(
    item: RawNewsItem,
    tickers: string[],
  ): boolean {
    const text = `${item.title} ${item.summary}`.toLowerCase();

    for (const ticker of tickers) {
      // Точное совпадение ticker как отдельного слова (word boundary)
      const pattern = new RegExp(`\\b${ticker.toLowerCase()}\\b`);
      if (pattern.test(text)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Парсинг RSS XML.
   * Использует DOMParser (browser) или xml2js (node).
   */
  private parseRssXml(xml: string, sourceName: string): RawNewsItem[] {
    const items: RawNewsItem[] = [];

    // Browser: DOMParser
    if (typeof window !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');
      const entries = doc.querySelectorAll('entry, item');

      entries.forEach((entry) => {
        const title = entry.querySelector('title, title')?.textContent ?? 'Без заголовка';
        const summary = entry.querySelector('summary, description')?.textContent ?? '';
        const link = entry.querySelector('link')?.getAttribute('href') ?? '';
        const pubDate = entry.querySelector('published, pubDate')?.textContent ?? new Date().toISOString();

        if (title) {
          items.push({
            id: `rss_${sourceName}_${link || 'unknown'}`,
            title,
            summary: summary || title,
            url: link || '',
            publishedAt: pubDate,
            source: sourceName,
          });
        }
      });
    }
    // Node: xml2js (если доступен)
    // TODO: Добавить динамический import('xml2js') когда будет установлен
    // else if (typeof require !== 'undefined') {
    //   try {
    //     const xml2js = require('xml2js');
    //     const parser = new xml2js.Parser({ explicitArray: false });
    //     parser.parseString(xml, (_err: unknown, _result: unknown) => {
    //       // Парсинг...
    //     });
    //   } catch {
    //     // xml2js недоступен
    //   }
    // }

    return items;
  }
}
