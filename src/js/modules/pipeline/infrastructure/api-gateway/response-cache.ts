/**
 * ResponseCache (Задача 2.1.2): TTL-кэш ответов шлюза.
 *
 * - Ключ = method + url + тело (для GET тело пустое).
 * - Кэшируются только ответы с кодом из cacheStatuses (по умолчанию 2xx) и
 *   только идемпотентные методы (GET/HEAD) — POST не кэшируется никогда.
 * - Истёкшие записи удаляются лениво при обращении и через sweep().
 */

import type { CacheEntry, GatewayResponse, HttpMethod } from './types.js';

export const CACHE_DEFAULTS = {
  ttlMs: 60_000,
  maxEntries: 100,
} as const;

const CACHEABLE_METHODS: readonly string[] = ['GET', 'HEAD'] as const;

export interface ResponseCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  /** Коды ответов, пригодные для кэширования. */
  cacheStatuses?: readonly number[];
  now?: () => number;
}

export class ResponseCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly cacheStatuses: readonly number[];
  private readonly now: () => number;
  private readonly store = new Map<string, CacheEntry>();

  constructor(options: ResponseCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? CACHE_DEFAULTS.ttlMs;
    this.maxEntries = options.maxEntries ?? CACHE_DEFAULTS.maxEntries;
    this.cacheStatuses = options.cacheStatuses ?? [
      200, 201, 202, 203, 204, 206,
    ];
    this.now = options.now ?? (() => Date.now());
    if (!(this.ttlMs > 0) || !Number.isFinite(this.ttlMs)) {
      throw new Error(
        `ResponseCache: ttlMs должен быть конечным числом > 0, получено ${this.ttlMs}`,
      );
    }
    if (!(this.maxEntries >= 1)) {
      throw new Error(
        `ResponseCache: maxEntries должен быть ≥ 1, получено ${this.maxEntries}`,
      );
    }
  }

  /** Ключ кэша для запроса. */
  keyOf(method: HttpMethod, url: string, body?: string): string {
    return `${method} ${url} ${body ?? ''}`;
  }

  /** Можно ли кэшировать такой запрос вообще (метод + статус). */
  isCacheable(method: HttpMethod, status: number): boolean {
    return (
      CACHEABLE_METHODS.includes(method) && this.cacheStatuses.includes(status)
    );
  }

  /** Возвращает живой кэш-элемент или null (ленивое истечение). */
  get(key: string): GatewayResponse | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    // LRU-освежение порядка доступа
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.response;
  }

  /** Сохраняет ответ (только кэшируемые). Возвращает ключ или null. */
  set(
    method: HttpMethod,
    url: string,
    body: string | undefined,
    response: GatewayResponse,
  ): string | null {
    if (!this.isCacheable(method, response.status)) return null;
    const key = this.keyOf(method, url, body);
    // Простое вытеснение: при переполнении удаляем самый старый (первый в Map)
    while (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
    const nowMs = this.now();
    this.store.set(key, {
      response,
      expiresAt: nowMs + this.ttlMs,
      storedAt: nowMs,
    });
    return key;
  }

  /** Удаляет истёкшие записи. Возвращает количество удалённых. */
  sweep(): number {
    const nowMs = this.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (nowMs >= entry.expiresAt) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
