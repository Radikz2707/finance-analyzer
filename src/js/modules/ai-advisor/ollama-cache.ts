/**
 * Модуль кэширования ответов локальных AI-моделей
 * Позволяет избежать повторных запросов к Ollama для одинаковых промптов
 */

import crypto from 'crypto';

/** Кэшированный ответ */
export interface CachedResponse {
  /** Хеш запроса */
  hash: string;
  /** Ответ модели */
  content: string;
  /** Использованная модель */
  model: string;
  /** Время кэширования (timestamp) */
  timestamp: number;
  /** Размер в символах */
  size: number;
}

/** Конфигурация кэша */
export interface CacheConfig {
  /** Максимальное количество записей в кэше */
  maxEntries: number;
  /** Время жизни записи в миллисекундах (по умолчанию 24 часа) */
  ttl: number;
  /** Флаг включения кэширования */
  enabled: boolean;
}

/** Стандартная конфигурация кэша */
const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxEntries: 100,
  ttl: 24 * 60 * 60 * 1000, // 24 часа
  enabled: true,
};

/**
 * Генерация хеша для запроса
 */
function generateHash(prompt: string, model: string): string {
  const data = `${model}:${prompt}`;
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Класс кэширования для локальных AI-моделей
 */
export class LocalCacheManager {
  private cache: Map<string, CachedResponse>;
  private config: CacheConfig;

  constructor(config: Partial<CacheConfig> = {}) {
    this.cache = new Map();
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };

    if (this.config.enabled) {
      console.log(
        `[LocalCache] Кэш инициализирован: ${this.config.maxEntries} записей, TTL: ${this.config.ttl / 1000 / 60} мин`,
      );
    }
  }

  /**
   * Получение кэшированного ответа
   */
  public get(prompt: string, model: string): string | null {
    if (!this.config.enabled) {
      return null;
    }

    const hash = generateHash(prompt, model);
    const cached = this.cache.get(hash);

    if (!cached) {
      return null;
    }

    // Проверяем, не истёк ли TTL
    const age = Date.now() - cached.timestamp;
    if (age > this.config.ttl) {
      this.cache.delete(hash);
      return null;
    }

    console.log(
      `[LocalCache] ✅ Хит кэша для модели ${model} (${cached.size} символов)`,
    );
    return cached.content;
  }

  /**
   * Сохранение ответа в кэш
   */
  public set(prompt: string, model: string, content: string): void {
    if (!this.config.enabled) {
      return;
    }

    // Ограничиваем размер кэша
    if (this.cache.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    const hash = generateHash(prompt, model);
    const cachedResponse: CachedResponse = {
      hash,
      content,
      model,
      timestamp: Date.now(),
      size: content.length,
    };

    this.cache.set(hash, cachedResponse);
    console.log(
      `[LocalCache] 💾 Сохранено в кэш: ${model} (${content.length} символов)`,
    );
  }

  /**
   * Удаление записи из кэша
   */
  public delete(prompt: string, model: string): boolean {
    const hash = generateHash(prompt, model);
    const deleted = this.cache.delete(hash);
    
    if (deleted) {
      console.log(`[LocalCache] 🗑️ Удалено из кэша: ${model}`);
    }
    
    return deleted;
  }

  /**
   * Очистка всех записей из кэша
   */
  public clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    console.log(`[LocalCache] 🧹 Очищено ${size} записей`);
  }

  /**
   * Получение статистики кэша
   */
  public getStats(): {
    totalEntries: number;
    maxSize: number;
    utilization: string;
    ttlMinutes: number;
    enabled: boolean;
  } {
    return {
      totalEntries: this.cache.size,
      maxSize: this.config.maxEntries,
      utilization: `${((this.cache.size / this.config.maxEntries) * 100).toFixed(1)}%`,
      ttlMinutes: this.config.ttl / 1000 / 60,
      enabled: this.config.enabled,
    };
  }

  /**
   * Удаление самой старой записи
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, value] of this.cache.entries()) {
      if (value.timestamp < oldestTime) {
        oldestTime = value.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      console.log('[LocalCache] 👴 Удалена самая старая запись');
    }
  }

  /**
   * Получение всех записей кэша (для отладки)
   */
  public getAllEntries(): CachedResponse[] {
    return Array.from(this.cache.values());
  }

  /**
   * Включение/выключение кэширования
   */
  public setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    console.log(`[LocalCache] ${enabled ? '✅ Включён' : '⛔ Выключен'} кэш`);
  }
}

/**
 * Глобальный экземпляр менеджера кэша
 */
export const localCache = new LocalCacheManager();

/**
 * Получение отклика с использованием кэша
 */
export async function getCachedResponse(
  prompt: string,
  model: string,
  fetcher: () => Promise<string>,
): Promise<{ content: string; fromCache: boolean }> {
  // Пробуем получить из кэша
  const cached = localCache.get(prompt, model);
  if (cached) {
    return { content: cached, fromCache: true };
  }

  // Запрашиваем у модели
  const content = await fetcher();
  
  // Сохраняем в кэш
  localCache.set(prompt, model, content);
  
  return { content, fromCache: false };
}
