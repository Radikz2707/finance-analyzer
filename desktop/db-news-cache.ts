/**
 * DbNewsCache — реальный NewsCacheLike поверх таблицы `news` (better-sqlite3).
 *
 * Desktop-Директор и NewsDriver читают новостной фон, который пайплайн
 * сохраняет через DataAgent → newsRepo.addProcessed (relevance_to_ticker,
 * is_processed=1). Динамический импорт db-manager — как у harness в ipc-core:
 * better-sqlite3 (native-модуль) подключается только там, где нужен;
 * при недоступности БД возвращается честный пустой кэш (нейтральный фон).
 */

import type { NewsRecord } from '../src/js/modules/db-manager/types.js';
import type {
  CachedNewsItem,
  NewsImportance,
  NewsSentiment,
  NewsTrend,
} from '../src/js/modules/pipeline/gatekeeper/news-cache.js';
import type { NewsCacheLike } from '../src/js/modules/pipeline/news-driver/types.js';

/** Минимальный репозиторий новостей (структурно совместим с newsRepo) */
export interface DbNewsRepoLike {
  getByTicker(ticker: string, limit?: number): NewsRecord[];
  getLatest(limit?: number): NewsRecord[];
}

/** Опции сборки кэша */
export interface DbNewsCacheOptions {
  /** Репозиторий (DI для тестов); по умолчанию — newsRepo из db-manager */
  repo?: DbNewsRepoLike;
  /** Колбэк ошибки подключения БД (для диагностики) */
  onError?: (error: unknown) => void;
}

/** NewsRecord.sentiment → NewsSentiment кэша */
const SENTIMENT_MAP: Record<NewsRecord['sentiment'], NewsSentiment> = {
  POSITIVE: 'positive',
  NEGATIVE: 'negative',
  NEUTRAL: 'neutral',
  UNKNOWN: 'unknown',
};

/** NewsRecord.importance → NewsImportance кэша */
const IMPORTANCE_MAP: Record<NewsRecord['importance'], NewsImportance> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

/** Числовой вес сентимента (для тренда) */
const SENTIMENT_SCORE: Record<NewsSentiment, number> = {
  positive: 1,
  negative: -1,
  neutral: 0,
  unknown: 0,
};

/** NewsRecord → CachedNewsItem */
export function toCachedNewsItem(record: NewsRecord): CachedNewsItem {
  const tickers = record.relevanceToTicker ? [record.relevanceToTicker] : [];
  const cachedAt = record.createdAt ?? record.date;
  return {
    id:
      record.id !== undefined
        ? String(record.id)
        : `${record.date}-${record.title}`,
    title: record.title,
    description: record.summary,
    url: record.url,
    date: record.date,
    source: record.source,
    tickers,
    category: '',
    sentiment: SENTIMENT_MAP[record.sentiment] ?? 'unknown',
    importance: IMPORTANCE_MAP[record.importance] ?? 'low',
    isMoscowExchange: record.source === 'MOEX',
    cachedAt,
    updatedAt: cachedAt,
    mentionCount: 1,
  };
}

/** Тренд по тикеру: сентимент + динамика */
function buildTrend(
  ticker: string,
  items: CachedNewsItem[],
): NewsTrend | undefined {
  if (items.length === 0) return undefined;
  const sum = items.reduce(
    (acc, item) => acc + SENTIMENT_SCORE[item.sentiment],
    0,
  );
  const averageSentiment = sum / items.length;
  const trend: NewsTrend['trend'] =
    averageSentiment > 0.1 ? 'up' : averageSentiment < -0.1 ? 'down' : 'stable';
  return {
    ticker,
    newsCount: items.length,
    averageSentiment,
    topKeywords: [],
    trend,
  };
}

/** Пустой репозиторий (БД недоступна) */
const EMPTY_REPO: DbNewsRepoLike = {
  getByTicker: () => [],
  getLatest: () => [],
};

/**
 * Кэш новостей, где getLatest/getTickerTrend гарантированно присутствуют
 * (расширение опционального контракта NewsCacheLike).
 */
export type DbNewsCache = NewsCacheLike & {
  getLatest(limit?: number): CachedNewsItem[];
  getTickerTrend(ticker: string): NewsTrend | undefined;
};

/** Синхронная сборка кэша из репозитория (чистая, тестируемая) */
export function buildDbNewsCache(
  repo: DbNewsRepoLike = EMPTY_REPO,
): DbNewsCache {
  return {
    getByTicker(ticker: string, limit = 20): CachedNewsItem[] {
      return repo.getByTicker(ticker, limit).map(toCachedNewsItem);
    },
    getLatest(limit = 50): CachedNewsItem[] {
      return repo.getLatest(limit).map(toCachedNewsItem);
    },
    getTickerTrend(ticker: string): NewsTrend | undefined {
      const items = repo.getByTicker(ticker, 50).map(toCachedNewsItem);
      return buildTrend(ticker, items);
    },
  };
}

/**
 * Асинхронная фабрика: динамически подключает db-manager (better-sqlite3).
 * При недоступности БД — честный пустой кэш (нейтральный новостной фон).
 */
export async function createDbNewsCacheAsync(
  options: DbNewsCacheOptions = {},
): Promise<DbNewsCache> {
  if (options.repo) {
    return buildDbNewsCache(options.repo);
  }
  try {
    const mod = await import('../src/js/modules/db-manager/db-manager.js');
    return buildDbNewsCache(mod.newsRepo);
  } catch (error) {
    options.onError?.(error);
    return buildDbNewsCache();
  }
}
