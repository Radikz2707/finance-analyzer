/**
 * SourceRegistry — реестр источников данных DataOrchestrator.
 *
 * Ключевые принципы:
 * 1. Источник регистрируется по модулю (id), а не по копии.
 *    Каждый модуль вызывается РОВНО ОДИН РАЗ за прогон.
 * 2. Повторные вызовы одного источника (потребители внутри прогона)
 *    получают закэшированный результат из реестра.
 * 3. Кэш по TTL: результат живёт cacheTtlMs мс. НЕ привязан к таймауту.
 * 4. News-источники зарезервированы (phase=2), но не активны в Phase 1.
 */

import type { SourceResult } from './source-result.js';

// ──────────────────────────────────────────────
// 1. Типы
// ──────────────────────────────────────────────

/** Фаза источника: 1 = финансовые данные (активен), 2 = news (резерв). */
export type SourcePhase = 1 | 2;

/** Запись в реестре: id + fetcher + опции. */
export interface SourceEntry<T = unknown> {
  /** Уникальный id источника (например 'moex-iss-fundamentals'). */
  id: string;
  /** Функция, возвращающая данные источника. */
  fetcher: () => Promise<T>;
  /** Таймаут для этого источника (мс). Если undefined — используется defaultTimeoutMs. */
  timeoutMs?: number;
  /** Фаза: 1 = активен, 2 = зарезервирован (news). */
  phase: SourcePhase;
}

/** Закэшированный результат с меткой времени. */
interface CachedResult<T = unknown> {
  value: T;
  /** Момент, когда кэш был заполнен (Date.now()). */
  cachedAt: number;
}

// ──────────────────────────────────────────────
// 2. SourceRegistry
// ──────────────────────────────────────────────

/**
 * SourceRegistry — единый реестр источников данных.
 *
 * Гарантирует, что каждый модуль-источник вызывается ровно один раз
 * за прогон. Повторные вызовы (через кэш потребителя) получают
 * закэшированный результат.
 */
export class SourceRegistry {
  private entries = new Map<string, SourceEntry>();
  private cache = new Map<string, CachedResult>();
  private readonly cacheTtlMs: number;

  constructor(options?: { cacheTtlMs?: number }) {
    this.cacheTtlMs = options?.cacheTtlMs ?? 60_000;
  }

  /**
   * Зарегистрировать источник.
   * Если id уже занят — перезаписывает (для тестов).
   */
  register<T = unknown>(entry: SourceEntry<T>): void {
    this.entries.set(entry.id, entry as SourceEntry);
  }

  /**
   * Получить результат источника.
   * Если результат в кэше и не истёк — возвращает кэш.
   * Иначе вызывает fetcher и кэширует результат.
   */
  async fetch<T = unknown>(id: string): Promise<SourceResult<T>> {
    const entry = this.entries.get(id);
    if (!entry) {
      return {
        id,
        status: 'unavailable',
        reason: `source not registered: ${id}`,
      };
    }

    // Проверка кэша
    const cached = this.cache.get(id);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return {
        id,
        status: 'ok',
        data: cached.value as T,
      };
    }

    const start = Date.now();
    const timeoutMs = entry.timeoutMs ?? 15_000;

    try {
      // Promise.race с таймаутом — работает с любым промисом,
      // не только с fetch(). AbortSignal.timeout не прерывает
      // обычный async/await, только API которые слушают signal.
      const timedFetcher = Promise.race([
        entry.fetcher(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), timeoutMs);
        }),
      ]);

      const data = await timedFetcher;

      const duration = Date.now() - start;

      // Кэшируем результат
      this.cache.set(id, {
        value: data,
        cachedAt: start,
      });

      return {
        id,
        status: 'ok',
        data: data as T,
        durationMs: duration,
      };
    } catch (error) {
      const duration = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);

      // Определяем причину
      let reason: string;
      if (message.includes('abort') || message.includes('AbortError')) {
        reason = 'timeout';
      } else {
        reason = message;
      }

      // НЕ кэшируем unavailable — см. обоснование:
      // 1. Кэш вернёт { status: 'ok', data: null } — нарушение контракта SourceResult
      // 2. TTL=60с замаскирует unavailable как ok на 60 секунд
      // 3. В одном прогоне источники не вызываются повторно (Promise.allSettled)
      // 4. Потребители вызывают fetcher напрямую, а не через registry.fetch()

      return {
        id,
        status: 'unavailable',
        reason,
        durationMs: duration,
      };
    }
  }

  /**
   * Очистить кэш (для тестов или нового прогона).
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Получить список зарегистрированных активных источников.
   */
  getActiveSourceIds(): string[] {
    return [...this.entries.values()]
      .filter((e) => e.phase === 1)
      .map((e) => e.id);
  }

  /**
   * Получить все зарегистрированные id (включая phase=2).
   */
  getAllSourceIds(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Проверить, зарегистрирован ли источник.
   */
  has(id: string): boolean {
    return this.entries.has(id);
  }
}
