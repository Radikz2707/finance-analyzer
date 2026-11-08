/**
 * Gatekeeper Types — типы и интерфейсы для модуля фильтрации новостей.
 *
 * Gatekeeper — входной ИИ-фильтр, который:
 * 1. Перехватывает новости из QUIK (OnNews), Moex API, RSS-лент
 * 2. Фильтрует по актуальным тикерам из БД
 * 3. Отсеивает рыночный шум
 * 4. Дедуплицирует по URL/content hash
 * 5. Приоритизирует по важности
 */

// ──────────────────────────────────────────────
// 1. Источники новостей
// ──────────────────────────────────────────────

/** Источник новости */
export type NewsSource =
  | 'quik'
  | 'moex'
  | 'google_news'
  | 'rbc'
  | 'interfax'
  | 'investing_com'
  | 'custom_rss';

/** Уровень важности новости */
export type NewsPriority = 'critical' | 'high' | 'medium' | 'low' | 'noise';

/** Статус обработки новости Gatekeeper */
export type NewsFilterStatus =
  | 'approved'    // Пропущена — релевантна тикерам
  | 'filtered'     // Отфильтрована — не релевантна
  | 'duplicate'    // Дубликат
  | 'noise'        // Шум
  | 'expired';     // Просрочена

// ──────────────────────────────────────────────
// 2. Структура новости
// ──────────────────────────────────────────────

/** Новостная запись после фильтрации Gatekeeper */
export interface GatekeeperNewsItem {
  /** Уникальный ID */
  id: string;
  /** Заголовок */
  title: string;
  /** Описание/сводка */
  summary: string;
  /** URL источника */
  url: string;
  /** Дата публикации (ISO 8601) */
  publishedAt: string;
  /** Источник */
  source: NewsSource;
  /** Приоритет */
  priority: NewsPriority;
  /** Статус фильтрации */
  filterStatus: NewsFilterStatus;
  /** Релевантные тикеры (из БД) */
  relevantTickers: string[];
  /** Content hash для дедупликации */
  contentHash: string;
  /** Причина фильтрации (если отфильтрована) */
  filterReason?: string;
  /** Сырые данные источника */
  rawData?: Record<string, unknown>;
}

/** Нормализованная новость (без priority, relevantTickers, filterStatus) */
export interface NormalizedNewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  source: NewsSource;
  contentHash: string;
  rawData?: Record<string, unknown>;
}

/** Результат работы Gatekeeper */
export interface GatekeeperResult {
  /** ID сессии фильтрации */
  sessionId: string;
  /** Время обработки */
  processedAt: string;
  /** Отфильтрованные новости (approved) */
  approvedNews: GatekeeperNewsItem[];
  /** Отфильтрованный шум */
  filteredOut: {
    total: number;
    byReason: Record<string, number>;
  };
  /** Статистика по источникам */
  sourceStats: Record<NewsSource, {
    total: number;
    approved: number;
  }>;
  /** Обработанные тикеры */
  processedTickers: string[];
}

// ──────────────────────────────────────────────
// 3. Конфигурация Gatekeeper
// ──────────────────────────────────────────────

/** Конфигурация Gatekeeper */
export interface GatekeeperConfig {
  /** Тикеры из БД, которые нужно отслеживать */
  monitoredTickers: string[];
  /** Максимальное количество новостей за сессию */
  maxNewsPerSession?: number;
  /** TTL новостей в минутах (по умолчанию 60) */
  newsTtlMinutes?: number;
  /** Порог релевантности (0..1) */
  relevanceThreshold?: number;
  /** Включить QUIK OnNews */
  enableQuik?: boolean;
  /** Включить Moex API */
  enableMoex?: boolean;
  /** Включить RSS-ленты */
  enableRss?: boolean;
  /** Включить Google News */
  enableGoogleNews?: boolean;
  /** verbose-режим */
  verbose?: boolean;
}

// ──────────────────────────────────────────────
// 4. Интерфейс источника новостей
// ──────────────────────────────────────────────

/** Базовый интерфейс для всех источников новостей */
export interface INewsSource {
  /** Название источника */
  readonly name: NewsSource;
  /** Активен ли источник */
  readonly enabled: boolean;
  /** Запросить свежие новости */
  fetch(): Promise<RawNewsItem[]>;
  /** Проверить доступность */
  healthCheck(): Promise<boolean>;
}

/** Сырая новость от источника */
export interface RawNewsItem {
  /** Заголовок */
  title: string;
  /** Описание */
  description: string;
  /** URL */
  url: string;
  /** Дата */
  date: string;
  /** Дополнительные поля */
  metadata?: Record<string, unknown>;
}

// ──────────────────────────────────────────────
// 5. Интерфейс Gatekeeper
// ──────────────────────────────────────────────

/** Интерфейс Gatekeeper */
export interface IGatekeeper {
  /** Запустить фильтрацию */
  run(): Promise<GatekeeperResult>;
  /** Остановить Gatekeeper */
  stop(): Promise<void>;
  /** Получить статистику */
  getStats(): GatekeeperStats;
  /** Обновить список тикеров */
  updateTickers(tickers: string[]): void;
}

/** Статистика Gatekeeper */
export interface GatekeeperStats {
  /** Всего обработано новостей */
  totalProcessed: number;
  /** Одобрено */
  approved: number;
  /** Отфильтровано */
  filtered: number;
  /** Дубликатов */
  duplicates: number;
  /** Шума */
  noise: number;
  /** Активных источников */
  activeSources: number;
}
