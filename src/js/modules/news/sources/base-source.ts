/**
 * Базовый класс источника новостей.
 * Все источники наследуются от этого класса.
 */

import type { NewsSourceConfig } from '../news-data-loader.js';

/** Результат сбора новостей из источника */
export interface NewsSourceResult {
  /** Название источника */
  source: string;
  /** Список новостей */
  items: RawNewsItem[];
  /** Дата последнего успешного сбора */
  lastSuccessAt: string;
  /** Количество собранных новостей */
  count: number;
}

/** Сырая новость из источника */
export interface RawNewsItem {
  /** Уникальный ID новости */
  id: string;
  /** Заголовок */
  title: string;
  /** Описание/сводка */
  summary: string;
  /** URL источника */
  url: string;
  /** Дата публикации */
  publishedAt: string;
  /** Источник */
  source: string;
}

/** Базовый класс источника новостей */
export abstract class BaseNewsSource {
  protected config: NewsSourceConfig;
  protected lastSuccessAt: string | null = null;
  protected lastFailureAt: string | null = null;
  protected successStreak: number = 0;
  protected failureStreak: number = 0;

  constructor(config: NewsSourceConfig) {
    this.config = config;
  }

  /**
   * Сбор новостей из источника.
   * Реализуется в наследниках.
   */
  abstract fetch(tickers: string[]): Promise<NewsSourceResult>;

  /**
   * Проверка доступности источника.
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * Обновление метрик здоровья.
   */
  protected markSuccess(): void {
    this.lastSuccessAt = new Date().toISOString();
    this.successStreak++;
    this.failureStreak = 0;
  }

  protected markFailure(error: Error): void {
    this.lastFailureAt = new Date().toISOString();
    this.failureStreak++;
    this.successStreak = 0;

    console.warn(
      `[${this.config.name}] ❌ Ошибка сбора: ${error.message} ` +
        `(неудач подряд: ${this.failureStreak})`,
    );
  }

  /**
   * Получить статус здоровья источника.
   */
  getHealthStatus(): {
    enabled: boolean;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    successStreak: number;
    failureStreak: number;
  } {
    // Отключаем источник если > 5 неудач подряд
    const isEnabled = this.failureStreak < 5;
    return {
      enabled: isEnabled && this.config.enabled,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      successStreak: this.successStreak,
      failureStreak: this.failureStreak,
    };
  }
}
