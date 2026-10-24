/**
 * MOEX ISS API — официальный источник новостей Московской биржи.
 *
 * Используется вместо RSS (который мёртвый) для получения официальных новостей.
 */

import { BaseNewsSource, type NewsSourceResult, type RawNewsItem } from './base-source.js';
import { config as newsConfig } from '../news-config.js';

/** Ответ MOEX ISS API */
interface MoexNewsResponse {
  news: Array<{
    id: number;
    title: string;
    desc?: string;
    url?: string;
    date?: string;
    source?: string;
  }>;
}

/** MOEX ISS API источник */
export class MoexNewsSource extends BaseNewsSource {
  private readonly baseUrl = 'https://iss.moex.com/iss';

  constructor() {
    super({
      id: 'moex_official',
      name: 'MOEX Official',
      url: 'https://iss.moex.com/iss/news.json',
      type: 'api',
      priority: 10,
      language: 'ru',
      enabled: true,
      successStreak: 0,
      failureStreak: 0,
    });
  }

  async fetch(tickers: string[]): Promise<NewsSourceResult> {
    try {
      // Загружаем последние новости с MOEX
      const response = await fetch(`${this.baseUrl}/sitenews.json?limit=50`, {
        signal: AbortSignal.timeout(newsConfig.NEWS_HTTP_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`MOEX API error: ${response.status}`);
      }

      const data = (await response.json()) as MoexNewsResponse;
      let items = this.parseNews(data.news);

      // Фильтрация по тикерам (если указаны)
      if (tickers.length > 0) {
        items = items.filter((item) => this.isRelevantToTickers(item, tickers));
      }

      this.markSuccess();

      return {
        source: this.config.name,
        items,
        lastSuccessAt: this.lastSuccessAt ?? new Date().toISOString(),
        count: items.length,
      };
    } catch (error) {
      this.markFailure(error instanceof Error ? error : new Error(String(error)));
      return {
        source: this.config.name,
        items: [],
        lastSuccessAt: this.lastSuccessAt ?? new Date().toISOString(),
        count: 0,
      };
    }
  }

  /**
   * Проверяет, релевантна ли новость тикерам портфеля.
   */
  private isRelevantToTickers(
    item: RawNewsItem,
    tickers: string[],
  ): boolean {
    const text = `${item.title} ${item.summary}`.toLowerCase();

    for (const ticker of tickers) {
      const pattern = new RegExp(`\\b${ticker.toLowerCase()}\\b`);
      if (pattern.test(text)) {
        return true;
      }
    }

    return false;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/sitenews.json?limit=1`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Парсинг новостей MOEX */
  private parseNews(news: MoexNewsResponse['news']): RawNewsItem[] {
    if (!news || news.length === 0) return [];

    return news.map((item) => ({
      id: `moex_${item.id}`,
      title: item.title || 'Без заголовка',
      summary: item.desc || item.title || '',
      url: item.url || `https://www.moex.com/n${item.id}.aspx`,
      publishedAt: item.date || new Date().toISOString(),
      source: item.source || 'MOEX',
    }));
  }
}
