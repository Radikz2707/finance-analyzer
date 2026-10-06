/**
 * RssNewsSource — источник новостей из RSS-лент.
 *
 * Поддерживаемые источники:
 * === Российские (Московская биржа) ===
 * - РБК Финансы — rbc.ru/finance
 * - Интерфакс — interfax.ru/news
 * - Финам — finam.ru/news
 * - Коммерсантъ —kommersant.ru
 * - Ведомости — vedomosti.ru
 *
 * === Международные ===
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
  /** Флаг: российские новости Мосбиржи */
  isMoscowExchange?: boolean;
}

/** Дефолтные RSS-ленты (проверенные рабочие) */
const DEFAULT_RSS_SOURCES: RssSourceConfig[] = [
  // === РОССИЙСКИЕ НОВОСТИ (Московская биржа) ===
  {
    name: 'РБК Финансы',
    url: 'https://www.rbc.ru/rss/rbc_news_main.xml',
    enabled: true,
    maxItems: 100,
    isMoscowExchange: true,
  },
  {
    name: 'Интерфакс',
    url: 'https://www.interfax.ru/rss/rss.rdf',
    enabled: true,
    maxItems: 80,
    isMoscowExchange: true,
  },
  {
    name: 'Финансы Финам',
    url: 'https://www.finam.ru/infoblock/newsfeed/rss.aspx',
    enabled: true,
    maxItems: 100,
    isMoscowExchange: true,
  },
  {
    name: 'Коммерсантъ Финансы',
    url: 'https://www.kommersant.ru/rss/finance.xml',
    enabled: true,
    maxItems: 60,
    isMoscowExchange: true,
  },
  {
    name: 'Ведомости Финансы',
    url: 'https://www.vedomosti.ru/rss.xml',
    enabled: true,
    maxItems: 60,
    isMoscowExchange: true,
  },
  // === МЕЖДУНАРОДНЫЕ ===
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

  while (
    (itemMatch = itemRegex.exec(xml)) !== null &&
    items.length < maxItems
  ) {
    const itemXml = itemMatch[1];
    if (!itemXml) continue;

    const title = extractTag(itemXml, 'title')?.trim() ?? '';
    const link = extractTag(itemXml, 'link')?.trim() ?? '';
    const pubDate = extractTag(itemXml, 'pubDate')?.trim() ?? '';
    const description = extractTag(itemXml, 'description')?.trim() ?? '';
    const category = extractTag(itemXml, 'category')?.trim() ?? '';
    const source = extractTag(itemXml, 'source')?.trim() ?? '';

    // Извлекаем тикеры из категории или заголовка
    const tickers = extractTickersFromNews(title + ' ' + category);

    if (title && link) {
      items.push({
        title,
        description: description.slice(0, 500),
        url: link,
        date: pubDate || new Date().toISOString(),
        metadata: {
          sourceName: source || '',
          category: category || '',
          tickers: tickers.length > 0 ? tickers.join(',') : '',
        },
      });
    }
  }

  return items;
}

/**
 * Извлечь тикеры из текста новости.
 */
function extractTickersFromNews(text: string): string[] {
  const found: string[] = [];
  const knownTickers = [
    'SBER', 'GMKN', 'LKOH', 'PLZL', 'ROSN', 'VTBR', 'SBERP',
    'GAZP', 'MGNT', 'YNDX', 'AFLT', 'MTLR', 'TATN', 'SNGS',
    'ROSNDR', 'MTSS', 'FLOT', 'ALRS', 'CHMF', 'NLMK', 'PHOR',
    'SENER', 'MAGN', 'SKNG', 'VKCO', 'AFKON', 'BSPB', 'FEES',
  ];
  
  const lower = text.toLowerCase();
  for (const ticker of knownTickers) {
    if (lower.includes(ticker.toLowerCase())) {
      found.push(ticker);
    }
  }
  
  return found;
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
          // Habr и Investing.com отвечают медленно — 10с часто не хватает
          timeout: 20000,
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/rss+xml, application/xml, text/xml, */*',
          },
          responseType: 'text',
          transformResponse: [(data) => data],
        });

        const maxItems = source.maxItems ?? 50;
        const items = parseRssXml(response.data, maxItems);

        return items;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[RssNewsSource] Ошибка загрузки ${source.name}: ${message}`,
        );
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

  /** Запросить ТОЛЬКО российские новости по Московской бирже */
  async fetchMoscowExchange(): Promise<RawNewsItem[]> {
    if (!this.enabled) {
      return [];
    }

    const moscowSources = this.sources.filter((s) => s.isMoscowExchange);
    
    if (moscowSources.length === 0) {
      return [];
    }

    const allItems: RawNewsItem[] = [];

    const promises = moscowSources.map(async (source) => {
      try {
        const response = await axios.get(source.url, {
          timeout: 20000,
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/rss+xml, application/xml, text/xml, */*',
          },
          responseType: 'text',
          transformResponse: [(data) => data],
        });

        const maxItems = source.maxItems ?? 50;
        const items = parseRssXml(response.data, maxItems);

        return items;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[RssNewsSource] Ошибка загрузки ${source.name}: ${message}`,
        );
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

  /** Получить список российских источников */
  getMoscowExchangeSources(): string[] {
    return this.sources
      .filter((s) => s.isMoscowExchange && s.enabled !== false)
      .map((s) => s.name);
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
