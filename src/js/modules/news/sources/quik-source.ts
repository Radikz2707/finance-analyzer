/**
 * QuikNewsSource — экспорт новостей из терминала QUIK.
 *
 * Использует:
 * 1. OnNews callback (Lua-скрипт) — экспорт новостей в JSON-файл
 * 2. Прямое чтение файлов из QUIK_NEWS_DIR
 *
 * При недоступности терминала fetch() вернёт [] — поток данных не прерывается.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BaseNewsSource, type NewsSourceResult, type RawNewsItem } from './base-source.js';
import { getLogger } from '../../logger/index.js';

/** Настройки QuikNewsSource */
interface QuikNewsSourceOptions {
  /** Включить источник (по умолчанию true) */
  enabled?: boolean;
  /** Папка с экспортированными новостями QUIK */
  newsDir?: string;
}

/** QuikNewsSource */
export class QuikNewsSource extends BaseNewsSource {
  private readonly log = getLogger('quik-news');
  private readonly newsDir: string;

  constructor(options?: QuikNewsSourceOptions) {
    const newsDir =
      options?.newsDir ||
      process.env.QUIK_NEWS_DIR ||
      path.join(process.cwd(), 'data', 'quik');

    super({
      id: 'quik_onnews',
      name: 'QUIK OnNews',
      url: newsDir,
      type: 'quik',
      priority: 8,
      language: 'ru',
      enabled: options?.enabled !== false,
      successStreak: 0,
      failureStreak: 0,
    });

    this.newsDir = newsDir;
  }

  async fetch(tickers: string[]): Promise<NewsSourceResult> {
    // Проверяем существование директории
    if (!fs.existsSync(this.newsDir)) {
      this.log.warn(`[QuikNews] Директория не найдена: ${this.newsDir}`);
      return {
        source: this.config.name,
        items: [],
        lastSuccessAt: this.lastSuccessAt || new Date().toISOString(),
        count: 0,
      };
    }

    // Читаем все JSON-файлы с новостями
    const files = fs.readdirSync(this.newsDir).filter((f) => f.endsWith('.json'));
    const allItems: RawNewsItem[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(this.newsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const news = JSON.parse(content);

        // Поддерживаем два формата: массив или объект с полем news
        const newsArray = Array.isArray(news) ? news : (news.news || []);

        for (const item of newsArray) {
          if (item.id && item.text) {
            allItems.push({
              id: `quik_${item.id}`,
              title: item.text.substring(0, 100),
              summary: item.text,
              url: item.url || '',
              publishedAt: item.time || new Date().toISOString(),
              source: 'QUIK',
            });
          }
        }
      } catch (err) {
        this.log.warn(`[QuikNews] Ошибка чтения файла ${file}:`, err);
      }
    }

    // Фильтрация по тикерам (если указаны)
    const filtered = tickers.length > 0
      ? allItems.filter((item) =>
          tickers.some((t) => item.title.includes(t) || item.summary.includes(t)),
        )
      : allItems;

    if (filtered.length > 0) {
      this.markSuccess();
    } else {
      this.markFailure(new Error('QUIK не вернул новостей'));
    }

    return {
      source: this.config.name,
      items: filtered,
      lastSuccessAt: this.lastSuccessAt || new Date().toISOString(),
      count: filtered.length,
    };
  }

  async healthCheck(): Promise<boolean> {
    return fs.existsSync(this.newsDir);
  }
}
