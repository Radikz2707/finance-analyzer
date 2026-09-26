/**
 * RssNewsSource — источник новостей из RSS-лент.
 *
 * Поддерживаемые источники:
 * - Investing.com (финансовые новости на русском)
 * - Habr (финансовый тег)
 * - Yahoo Finance (англоязычные)
 * - Пользовательские RSS
 */

import axios from 'axios';
import type { RawNewsItem, INewsSource, NewsSource } from './types.js';

/** Конфигурация RSS-источника */
export interface RssSourceConfig {
  name: string;
  url: string;
  enabled?: boolean;
  maxItems?: number;
}

/** Дефолтные RSS-ленты (проверенные рабочие) */
const DEFAULT_RSS_SOURCES: RssSourceConfig[] = [
  {
    name: 'Investing.com',
    url: 'https://ru.investing.com/rss/news.rss',
    enabled: true,
    maxItems: 50,
  },
  {
    name: 'Habr Finance',
    url: 'https://habr.com/ru/rss/best/finance/',
    enabled: true,
    maxItems: 30,
  },
  {
    name: 'Yahoo Finance',
    url: 'https://finance.yahoo.com/rss/',
    enabled: true,
    maxItems: 30,
  },
];

/**
 * Парсер RSS XML → RawNewsItem[]
 */
function parseRssXml(xml: string, maxItems: number = 50): RawNewsItem[] {
  const items: RawNewsItem[] = [];

  // Извлекаем <item> блоки
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(xml)) !== null && items.length < maxItems) {
    const itemXml = itemMatch[1];

    const title = extractTag(itemXml, 'title')?.trim() ?? '';
    const link = extractTag(itemXml, 'link')?.trim() ?? '';
    const pubDate = extractTag(itemXml, 'pubDate')?.trim() ?? '';
    const description = extractTag(itemXml, 'description')?.trim() ?? '';

    if (title && link) {
      items.push({
        title,
        description: description.slice(0, 500),
        url: link,
        date: pubDate || new Date().toISOString(),
        metadata: {
          sourceName: extractTag(itemXml, 'source')?.trim(),
        },
      });
    }
  }

  return items;
}

/** Извлечение содержимого XML тега */
function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  if (match && match[1]) {
    return match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, '')
      .trim();
  }
  return null;
}

/**
 * RssNewsSource — источник новостей из RSS.
 */
export class RssNewsSource implements INewsSource {
  public readonly name: NewsSource = 'custom_rss';
  public readonly enabled: boolean;
  private readonly sources: RssSourceConfig[];
  private readonly userAgent = 'FinanceAnalyzer/1.0';

  constructor(configs?: RssSourceConfig[]) {
    this.sources = configs ?? DEFAULT_RSS_SOURCES;
    this.enabled = this.sources.some((s) => s.enabled !== false);
  }

  /** Запросить новости из всех RSS-лент */
  async fetch(): Promise<RawNewsItem[]> {
    if (!this.enabled) {
      return [];
    }

    const allItems: RawNewsItem[] = [];

    const promises = this.sources.map(async (source) => {
      if (source.enabled === false) return [];

      try {
        const response = await axios.get(source.url, {
          timeout: 10000,
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          },
          responseType: 'text',
          transformResponse: [(data) => data],
        });

        const maxItems = source.maxItems ?? 50;
        const items = parseRssXml(response.data, maxItems);

        return items;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[RssNewsSource] Ошибка загрузки ${source.name}: ${message}`);
        return [];
      }
    });

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allItems.push(...result.value);
      }
    }

    return allItems;
  }

  /** Проверить доступность */
  async healthCheck(): Promise<boolean> {
    try {
      const results = await Promise.allSettled(
        this.sources.map((source) =>
          axios.get(source.url, { timeout: 5000 }).then(() => true),
        ),
      );

      return results.some((r) => r.status === 'fulfilled' && r.value === true);
    } catch {
      return false;
    }
  }
}
