/**
 * AgentResultCache — кэширование результатов агентов.
 *
 * Позволяет избежать повторного выполнения агентов для одинаковых вопросов.
 * TTL: 5 минут по умолчанию.
 */

import type { AgentResultEntry } from './director-types.js';

/** Запись в кэше */
export interface CachedAgentResult {
  key: string;
  results: AgentResultEntry[];
  timestamp: number;
  ttlMs: number;
}

/**
 * Кэш результатов агентов.
 * 
 * Использует хеш от тикеров + типа вопроса + версии фактов как ключ.
 */
export class AgentResultCache {
  private cache = new Map<string, CachedAgentResult>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  constructor(options?: { defaultTtlMs?: number; maxEntries?: number }) {
    this.defaultTtlMs = options?.defaultTtlMs ?? 5 * 60 * 1000; // 5 минут
    this.maxEntries = options?.maxEntries ?? 50;
  }

  /** Сгенерировать ключ кэша */
  static generateKey(
    tickers: string[],
    questionType: string,
    factsVersion: number,
  ): string {
    const sorted = [...tickers].sort().join(',');
    return `${questionType}:${sorted}:v${factsVersion}`;
  }

  /** Получить кэшированные результаты */
  get(key: string): AgentResultEntry[] | null {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > cached.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.results;
  }

  /** Сохранить результаты в кэш */
  set(key: string, results: AgentResultEntry[], ttlMs?: number): void {
    this.cache.set(key, {
      key,
      results,
      timestamp: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });
    
    this.evictIfNeeded();
  }

  /** Очистить весь кэш */
  clear(): void {
    this.cache.clear();
  }

  /** Удалить записи для конкретных тикеров */
  invalidateForTickers(tickers: string[]): void {
    for (const key of this.cache.keys()) {
      const keyTickers = key.split(':')[1]?.split(',');
      if (keyTickers?.some(t => tickers.includes(t))) {
        this.cache.delete(key);
      }
    }
  }

  /** Размер кэша */
  get size(): number {
    return this.cache.size;
  }

  /** Удалить устаревшие записи если превышен лимит */
  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxEntries) return;
    
    const entries = [...this.cache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    const toDelete = entries.slice(0, entries.length - this.maxEntries);
    for (const [key] of toDelete) {
      this.cache.delete(key);
    }
  }
}
