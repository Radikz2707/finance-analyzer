/**
 * News Data Loader — загрузка и управление данными новостей.
 *
 * Содержит конфигурацию источников и мониторинг тикеров.
 */

import type { NewsSourceResult } from './sources/base-source.js';

/** Конфигурация источника новостей */
export interface NewsSourceConfig {
  /** Идентификатор источника */
  id: string;
  /** Название */
  name: string;
  /** Включён ли источник */
  enabled: boolean;
  /** URL или путь к источнику */
  url?: string;
  /** Тип источника */
  type?: string;
  /** Приоритет источника (0-1) */
  priority?: number;
  /** Язык источника */
  language?: string;
  /** Серия успешных сборов */
  successStreak?: number;
  /** Серия неудачных сборов */
  failureStreak?: number;
  /** Интервал обновления (мс) */
  pollIntervalMs?: number;
  /** Максимум новостей за запрос */
  maxItems?: number;
}

/** Мониторинг тикеров для новостей */
export class TickerMonitor {
  private tickers: Set<string> = new Set();

  /** Добавить тикер */
  addTicker(ticker: string): void {
    this.tickers.add(ticker.toUpperCase());
  }

  /** Удалить тикер */
  removeTicker(ticker: string): void {
    this.tickers.delete(ticker.toUpperCase());
  }

  /** Получить список тикеров */
  getTickers(): string[] {
    return Array.from(this.tickers);
  }

  /** Получить тикеры для мониторинга (alias для getTickers) */
  getMonitoredTickers(): string[] {
    return this.getTickers();
  }

  /** Проверить, есть ли тикер в мониторинге */
  hasTicker(ticker: string): boolean {
    return this.tickers.has(ticker.toUpperCase());
  }

  /** Очистить все тикеры */
  clear(): void {
    this.tickers.clear();
  }

  /** Количество тикеров */
  get count(): number {
    return this.tickers.size;
  }
}

/** Загрузчик данных новостей (заглушка) */
export class NewsLoader {
  /** Загрузить новости из источника */
  async loadFromSource(_config: NewsSourceConfig): Promise<NewsSourceResult> {
    return {
      source: _config.name,
      items: [],
      lastSuccessAt: new Date().toISOString(),
      count: 0,
    };
  }
}
