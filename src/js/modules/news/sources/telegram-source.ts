/**
 * TelegramNewsSource — сбор новостей из Telegram-каналов через RSS-мосты.
 *
 * Использует публичные RSS-мосты для парсинга Telegram-каналов:
 * - CBA_Official (Сбербанк)
 * - MOEX_Engine (Московская биржа)
 * - Finam123 (Финам)
 * - Investfolio (Инвестиционный блог)
 *
 * RSS-мосты:
 * - https://tgstat.ru/rss/channel/{id}
 * - https://telega.in/rss/{username}
 */

import { BaseNewsSource, type NewsSourceResult, type RawNewsItem } from './base-source.js';
import { config as newsConfig } from '../news-config.js';

/** Telegram-канал — конфигурация загружается динамически */
interface TelegramChannel {
  /** Название канала */
  name: string;
  /** URL RSS-моста */
  rssUrl: string;
  /** Тикеры, которые освещает канал */
  tickers: string[];
}

/** TelegramNewsSource */
export class TelegramNewsSource extends BaseNewsSource {
  /**
   * Каналы загружаются ДИНАМИЧЕСКИ из config API или БД.
   * Пустой массив по умолчанию — данные всегда должны приходить извне.
   */
  private channels: TelegramChannel[] = [];

  constructor() {
    super({
      id: 'telegram_aggregator',
      name: 'Telegram Aggregator',
      url: '',
      type: 'telegram',
      priority: 7,
      language: 'ru',
      enabled: true,
      successStreak: 0,
      failureStreak: 0,
    });
  }

  /**
   * Загрузка каналов из внешнего источника (config API / БД).
   * Вызывается при инициализации или обновлении конфигурации.
   */
  async loadChannels(): Promise<void> {
    try {
      const response = await fetch('/api/config/telegram-channels');
      if (!response.ok) {
        this.channels = [];
        return;
      }
      const data = await response.json() as Array<Record<string, unknown>>;
      this.channels = data.map((ch) => ({
        name: (ch.name as string) || '',
        rssUrl: (ch.rssUrl as string) || '',
        tickers: (ch.tickers as string[]) || [],
      }));
    } catch {
      this.channels = [];
    }
  }

  async fetch(tickers: string[]): Promise<NewsSourceResult> {
    // Фильтруем каналы по тикерам
    const relevantChannels = this.channels.filter((ch) =>
      ch.tickers.some((t) => tickers.includes(t)),
    );

    // Если тикеры не указаны, используем все каналы
    const channelsToFetch =
      tickers.length > 0 ? relevantChannels : this.channels;

    if (channelsToFetch.length === 0) {
      return {
        source: this.config.name,
        items: [],
        lastSuccessAt: this.lastSuccessAt || new Date().toISOString(),
        count: 0,
      };
    }

    // Параллельный сбор из всех каналов
    const allItems: RawNewsItem[] = [];

    const promises = channelsToFetch.map(async (channel) => {
      try {
        const items = await this.fetchChannel(channel);
        return items;
      } catch (error) {
        console.warn(`[Telegram] Ошибка канала ${channel.name}:`, error);
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
      this.markFailure(new Error('Все Telegram-каналы вернули пустой результат'));
    }

    return {
      source: this.config.name,
      items: allItems,
      lastSuccessAt: this.lastSuccessAt || new Date().toISOString(),
      count: allItems.length,
    };
  }

  async healthCheck(): Promise<boolean> {
    if (this.channels.length === 0) return false;
    const firstChannel = this.channels[0];
    if (!firstChannel) return false;
    try {
      const response = await fetch(firstChannel.rssUrl, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Сбор одного Telegram-канала.
   */
  private async fetchChannel(channel: TelegramChannel): Promise<RawNewsItem[]> {
    const response = await fetch(channel.rssUrl, {
      signal: AbortSignal.timeout(newsConfig.NEWS_HTTP_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.status}`);
    }

    const text = await response.text();
    return this.parseTelegramXml(text, channel.name, channel.tickers);
  }

  /**
   * Парсинг Telegram XML.
   */
  private parseTelegramXml(
    xml: string,
    sourceName: string,
    _tickers: string[],
  ): RawNewsItem[] {
    const items: RawNewsItem[] = [];

    // Browser: DOMParser
    if (typeof window !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');
      const entries = doc.querySelectorAll('entry, item');

      entries.forEach((entry) => {
        const title = entry.querySelector('title')?.textContent || '';
        const summary =
          entry.querySelector('summary, description')?.textContent || '';
        const link = entry.querySelector('link')?.getAttribute('href') || '';
        const pubDate = entry.querySelector('published, pubDate')?.textContent || '';

        if (title) {
          items.push({
            id: `tg_${sourceName}_${link}`,
            title,
            summary,
            url: link,
            publishedAt: pubDate,
            source: sourceName,
          });
        }
      });
    }

    return items;
  }
}
