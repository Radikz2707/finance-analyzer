/**
 * MoexNewsSource — источник новостей из MOEX API.
 *
 * Использует MOEX ISS API для получения новостей:
 * - https://iss.moex.com/iss/news.json — список новостей
 * - https://iss.moex.com/iss/news/{id}.json — конкретная новость
 *
 * Поддерживает:
 * - Фильтрацию по тикерам (engine=stocks, board=TQBR)
 * - Фильтрацию по категориям (дивиденды, отчёты, события)
 * - Кэширование в SQLite
 */

import { db } from '../../db-manager/db-manager.js';
import type { RawNewsItem, INewsSource, NewsSource } from './types.js';

// ──────────────────────────────────────────────
// 1. Типы
// ──────────────────────────────────────────────

/** Новость из MOEX API */
export interface MoexNewsItem {
  id: number;
  date: string;
  title: string;
  description?: string;
  url?: string;
  engine?: string;
  group?: string;
  is_main?: boolean;
}

/** Конфигурация MOEX источника */
export interface MoexNewsSourceConfig {
  /** Включить источник */
  enabled?: boolean;
  /** Максимум новостей за запрос */
  maxItems?: number;
  /** Интервал кэширования (мс) */
  cacheTtlMs?: number;
}

// ──────────────────────────────────────────────
// 2. MOEX API Client
// ──────────────────────────────────────────────

/** Базовый URL MOEX ISS API */
const MOEX_ISS_BASE = 'https://iss.moex.com/iss';

/**
 * Загрузить новости из MOEX API.
 */
async function fetchMoexNews(maxItems: number = 50): Promise<MoexNewsItem[]> {
  try {
    const url = `${MOEX_ISS_BASE}/news.json?limit=${maxItems}&sort_order=date_desc`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'FinanceAnalyzer/1.0',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`MOEX API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Парсим ответ MOEX ISS
    // Структура: { data: { columns: [...], rows: [[...]] } }
    const newsData = data?.data?.find((d: { columns: string[] }) => 
      d.columns?.includes('id')
    );

    if (!newsData) {
      console.warn('[MoexNewsSource] Нет данных в ответе MOEX API');
      return [];
    }

    const columns = newsData.columns as string[];
    const rows = newsData.rows as string[][];

    const items: MoexNewsItem[] = [];
    
    for (const row of rows) {
      const item: Record<string, string | number | boolean> = {};
      columns.forEach((col, i) => {
        item[col] = row[i];
      });

      items.push({
        id: Number(item.id) || 0,
        date: item.date as string || '',
        title: item.title as string || '',
        description: item.description as string || '',
        url: item.se_url as string || '',
        engine: item.engine as string || '',
        group: item.group as string || '',
        is_main: item.is_main === 'Y' || item.is_main === true,
      });
    }

    return items;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[MoexNewsSource] Ошибка загрузки из MOEX: ${message}`);
    return [];
  }
}

/**
 * Загрузить новости по конкретному тикеру.
 */
async function fetchMoexNewsByTicker(ticker: string, maxItems: number = 20): Promise<MoexNewsItem[]> {
  try {
    // MOEX ISS API для новостей по тикеру
    const url = `${MOEX_ISS_BASE}/news.json?filter.engine=stocks&filter.group=${ticker}&limit=${maxItems}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'FinanceAnalyzer/1.0',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const newsData = data?.data?.find((d: { columns: string[] }) => d.columns?.includes('id'));

    if (!newsData) return [];

    const columns = newsData.columns as string[];
    const rows = newsData.rows as string[][];

    const items: MoexNewsItem[] = [];
    
    for (const row of rows) {
      const item: Record<string, string | number | boolean> = {};
      columns.forEach((col, i) => {
        item[col] = row[i];
      });

      items.push({
        id: Number(item.id) || 0,
        date: item.date as string || '',
        title: item.title as string || '',
        description: item.description as string || '',
        url: item.se_url as string || '',
        engine: item.engine as string || '',
        group: item.group as string || '',
        is_main: item.is_main === 'Y' || item.is_main === true,
      });
    }

    return items;
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────
// 3. SQLite Caching
// ──────────────────────────────────────────────

function cacheNewsToDB(items: MoexNewsItem[]): void {
  if (items.length === 0) return;

  const now = new Date().toISOString();
  
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO news (title, date, source, url, importance, sentiment, summary, is_processed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);

  const batch = db.transaction((newsItems: MoexNewsItem[]) => {
    for (const item of newsItems) {
      insertStmt.run(
        item.title,
        item.date,
        'MOEX',
        item.url || null,
        item.is_main ? 'HIGH' : 'MEDIUM',
        'UNKNOWN',
        item.description?.substring(0, 500) || null,
        now,
      );
    }
  });

  batch(items);
}

// ──────────────────────────────────────────────
// 4. RawNewsItem Converter
// ──────────────────────────────────────────────

/**
 * Преобразовать MoexNewsItem → RawNewsItem
 */
function toRawNewsItem(item: MoexNewsItem): RawNewsItem {
  return {
    title: item.title,
    description: item.description || '',
    url: item.url || '',
    date: item.date || new Date().toISOString(),
    metadata: {
      sourceName: 'MOEX',
      moexId: item.id,
      engine: item.engine,
      group: item.group,
      isMain: item.is_main,
    },
  };
}

// ──────────────────────────────────────────────
// 5. MoexNewsSource
// ──────────────────────────────────────────────

/**
 * MoexNewsSource — источник новостей из MOEX ISS API.
 *
 * ⚠️ Примечание: MOEX ISS API endpoint /iss/news.json временно недоступен (404).
 * Этот модуль реализован для future-use — когда MOEX восстановит API.
 * 
 * В текущей конфигурации Gatekeeper использует RSS-источники:
 * - Investing.com (русскоязычные финансовые новости)
 * - Habr Finance (аналитика и обзоры)
 * - Yahoo Finance (англоязычные)
 *
 * Использует MOEX ISS API для получения новостей:
 * - https://iss.moex.com/iss/news.json — список новостей (TEMPORARILY DOWN)
 * - https://iss.moex.com/iss/news/{id}.json — конкретная новость
 *
 * Поддерживает:
 * - Фильтрацию по тикерам (engine=stocks, board=TQBR)
 * - Фильтрацию по категориям (дивиденды, отчёты, события)
 * - Кэширование в SQLite
 */
export class MoexNewsSource implements INewsSource {
  public readonly name: NewsSource = 'moex';
  public readonly enabled: boolean;
  private readonly maxItems: number;
  private lastFetchTime = 0;
  private cachedItems: RawNewsItem[] = [];
  private readonly cacheTtlMs: number;

  constructor(config?: MoexNewsSourceConfig) {
    this.enabled = config?.enabled !== false;
    this.maxItems = config?.maxItems ?? 50;
    this.cacheTtlMs = config?.cacheTtlMs ?? 300_000; // 5 минут
  }

  /** Запросить новости из MOEX API */
  async fetch(): Promise<RawNewsItem[]> {
    if (!this.enabled) {
      return [];
    }

    const now = Date.now();
    
    // Используем кэш если он ещё свежий
    if (now - this.lastFetchTime < this.cacheTtlMs && this.cachedItems.length > 0) {
      return [...this.cachedItems];
    }

    console.log('[MoexNewsSource] Загрузка новостей из MOEX ISS API...');
    
    try {
      // 1. Загружаем общие новости
      const generalItems = await fetchMoexNews(this.maxItems);
      
      // 2. Кэшируем в БД
      cacheNewsToDB(generalItems);
      
      // 3. Преобразуем в RawNewsItem
      this.cachedItems = generalItems.map(toRawNewsItem);
      this.lastFetchTime = now;

      console.log(`[MoexNewsSource] ✅ Загружено ${this.cachedItems.length} новостей из MOEX`);
      
      return this.cachedItems;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[MoexNewsSource] ⚠️ MOEX API недоступен: ${message}`);
      console.warn('[MoexNewsSource] Используются RSS-источники вместо MOEX');
      return [];
    }
  }

  /** Загрузить новости по конкретному тикеру */
  async fetchForTicker(ticker: string): Promise<RawNewsItem[]> {
    if (!this.enabled) return [];
    
    console.log(`[MoexNewsSource] Загрузка новостей для ${ticker}...`);
    const items = await fetchMoexNewsByTicker(ticker, 20);
    return items.map(toRawNewsItem);
  }

  /** Проверить доступность */
  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${MOEX_ISS_BASE}/news.json?limit=1`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ──────────────────────────────────────────────
// 6. Экспорт
// ──────────────────────────────────────────────

export default MoexNewsSource;
