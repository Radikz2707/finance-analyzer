/**
 * QuikNewsSource — источник новостей QUIK для Gatekeeper.
 *
 * Реализует интерфейс INewsSource (src/js/modules/pipeline/gatekeeper/types.ts)
 * и читает файлы новостей, экспортированные скриптом quik/export_news.lua.
 *
 * Поведение при недоступности QUIK (папка отсутствует / нет файлов):
 * - fetch() возвращает [] (поток данных не ломается);
 * - healthCheck() возвращает false.
 */

import { QuikNewsReader } from './quik-news-reader.js';
import { getLogger } from '../logger/logger.js';
import type { QuikNewsSourceConfig } from './types.js';
import type {
  INewsSource,
  NewsSource,
  RawNewsItem,
} from '../pipeline/gatekeeper/types.js';

/** Логгер модуля */
const log = getLogger('quik-news-source');

/**
 * Источник новостей QUIK (только чтение экспортированных файлов).
 */
export class QuikNewsSource implements INewsSource {
  public readonly name: NewsSource = 'quik';
  public readonly enabled: boolean;

  private readonly reader: QuikNewsReader;
  private readonly daysBack: number;

  constructor(config?: QuikNewsSourceConfig) {
    this.enabled = config?.enabled ?? true;
    this.reader = new QuikNewsReader({ newsDir: config?.newsDir });
    this.daysBack = config?.daysBack ?? 0;
  }

  /** Запросить свежие новости из файлов QUIK */
  async fetch(): Promise<RawNewsItem[]> {
    if (!this.enabled) return [];

    try {
      const available = await this.reader.isAvailable();
      if (!available) return [];

      const records = await this.reader.readNews(this.daysBack);
      return this.reader.toRawNewsItems(records);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Ошибка чтения новостей QUIK: ${message}`);
      return [];
    }
  }

  /** Проверить доступность источника */
  async healthCheck(): Promise<boolean> {
    if (!this.enabled) return false;
    return this.reader.isAvailable();
  }
}
