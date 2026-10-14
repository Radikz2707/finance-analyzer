/// <reference types="vitest/globals" />
/**
 * Unit-тесты DbNewsCache (desktop/db-news-cache.ts) — реальный NewsCacheLike
 * поверх таблицы `news` (БД). Чистые функции (toCachedNewsItem, buildDbNewsCache,
 * buildTrend) тестируются без better-sqlite3 через фейковый репозиторий.
 */

import {
  buildDbNewsCache,
  createDbNewsCacheAsync,
  toCachedNewsItem,
  type DbNewsRepoLike,
} from './db-news-cache.js';
import type { NewsRecord } from '../src/js/modules/db-manager/types.js';

/** Фейковый репозиторий (вместо newsRepo) */
function makeRepo(records: NewsRecord[]): DbNewsRepoLike {
  return {
    getByTicker: (ticker, limit = 20) =>
      records.filter((r) => r.relevanceToTicker === ticker).slice(0, limit),
    getLatest: (limit = 50) => records.slice(0, limit),
  };
}

/** Рекорд-новости для тестов */
function makeRecord(partial: Partial<NewsRecord> = {}): NewsRecord {
  return {
    id: 1,
    title: 'Сбер отчитался о росте прибыли',
    date: '2026-10-13T10:00:00.000Z',
    source: 'RSS',
    url: 'https://example.com/news/1',
    importance: 'HIGH',
    sentiment: 'POSITIVE',
    summary: 'Чистая прибыль выросла на 15%',
    relevanceToTicker: 'SBER',
    isProcessed: true,
    createdAt: '2026-10-13T11:00:00.000Z',
    ...partial,
  };
}

describe('desktop/db-news-cache', () => {
  describe('toCachedNewsItem', () => {
    it('маппит все поля NewsRecord → CachedNewsItem', () => {
      const item = toCachedNewsItem(makeRecord());

      expect(item.id).toBe('1');
      expect(item.title).toBe('Сбер отчитался о росте прибыли');
      expect(item.description).toBe('Чистая прибыль выросла на 15%');
      expect(item.url).toBe('https://example.com/news/1');
      expect(item.date).toBe('2026-10-13T10:00:00.000Z');
      expect(item.source).toBe('RSS');
      expect(item.tickers).toEqual(['SBER']);
      expect(item.sentiment).toBe('positive');
      expect(item.importance).toBe('high');
      expect(item.isMoscowExchange).toBe(false);
      expect(item.mentionCount).toBe(1);
    });

    it('маппит сентимент и важность БД → формат кэша', () => {
      expect(
        toCachedNewsItem(makeRecord({ sentiment: 'NEGATIVE' })).sentiment,
      ).toBe('negative');
      expect(
        toCachedNewsItem(makeRecord({ sentiment: 'NEUTRAL' })).sentiment,
      ).toBe('neutral');
      expect(
        toCachedNewsItem(makeRecord({ sentiment: 'UNKNOWN' })).sentiment,
      ).toBe('unknown');
      expect(
        toCachedNewsItem(makeRecord({ importance: 'CRITICAL' })).importance,
      ).toBe('critical');
      expect(
        toCachedNewsItem(makeRecord({ importance: 'MEDIUM' })).importance,
      ).toBe('medium');
      expect(
        toCachedNewsItem(makeRecord({ importance: 'LOW' })).importance,
      ).toBe('low');
    });

    it('MOEX-новость помечается как isMoscowExchange', () => {
      expect(
        toCachedNewsItem(makeRecord({ source: 'MOEX' })).isMoscowExchange,
      ).toBe(true);
    });

    it('тикер берётся из relevanceToTicker; без тикера — пустой список', () => {
      const noTicker = toCachedNewsItem(makeRecord({ relevanceToTicker: '' }));
      expect(noTicker.tickers).toEqual([]);
    });
  });

  describe('buildDbNewsCache', () => {
    it('getByTicker возвращает только новости нужного тикера', () => {
      const repo = makeRepo([
        makeRecord({ id: 1, relevanceToTicker: 'SBER' }),
        makeRecord({ id: 2, relevanceToTicker: 'PLZL' }),
      ]);
      const cache = buildDbNewsCache(repo);

      const items = cache.getByTicker('SBER');
      expect(items).toHaveLength(1);
      expect(items[0]!.tickers).toEqual(['SBER']);
    });

    it('getLatest возвращает последние новости', () => {
      const repo = makeRepo([
        makeRecord({ id: 1 }),
        makeRecord({ id: 2 }),
        makeRecord({ id: 3 }),
      ]);
      const cache = buildDbNewsCache(repo);
      expect(cache.getLatest(2)).toHaveLength(2);
    });

    it('getTickerTrend: позитивный фон → тренд up с сентиментом > 0', () => {
      const repo = makeRepo([
        makeRecord({ sentiment: 'POSITIVE' }),
        makeRecord({ sentiment: 'POSITIVE' }),
      ]);
      const cache = buildDbNewsCache(repo);
      const trend = cache.getTickerTrend('SBER');
      expect(trend).toBeDefined();
      expect(trend!.trend).toBe('up');
      expect(trend!.newsCount).toBe(2);
      expect(trend!.averageSentiment).toBe(1);
    });

    it('getTickerTrend: негативный фон → тренд down', () => {
      const repo = makeRepo([makeRecord({ sentiment: 'NEGATIVE' })]);
      const cache = buildDbNewsCache(repo);
      expect(cache.getTickerTrend('SBER')!.trend).toBe('down');
    });

    it('getTickerTrend: без новостей → undefined', () => {
      const cache = buildDbNewsCache(makeRepo([]));
      expect(cache.getTickerTrend('SBER')).toBeUndefined();
    });
  });

  describe('createDbNewsCacheAsync', () => {
    it('использует предоставленный репозиторий', async () => {
      const repo = makeRepo([makeRecord()]);
      const cache = await createDbNewsCacheAsync({ repo });
      expect(cache.getByTicker('SBER')).toHaveLength(1);
    });

    it('пустой репозиторий → пустой кэш (нейтральный фон)', async () => {
      const cache = await createDbNewsCacheAsync({ repo: makeRepo([]) });
      expect(cache.getByTicker('SBER')).toEqual([]);
      expect(cache.getLatest()).toEqual([]);
    });
  });
});
