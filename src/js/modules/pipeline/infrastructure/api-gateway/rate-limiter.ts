/**
 * RateLimiter (Задача 2.1.1): token bucket на хост.
 *
 * - Лимит и окно задаются конфигом (например 10 запросов / 10 с).
 * - Превышение лимита → allowed=false с расчётным waitMs (без сна внутри —
 *   решение принимает вызывающий; шлюз честно ждёт или отклоняет).
 * - Хост извлекается из URL (протокол отбрасывается).
 */

export class RateLimiterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RateLimiterError';
  }
}

export const RATE_LIMITER_DEFAULTS = {
  maxRequests: 10,
  windowMs: 10_000,
} as const;

export interface RateLimiterOptions {
  /** Максимум запросов за окно (на хост). */
  maxRequests?: number;
  /** Длина скользящего окна, мс. */
  windowMs?: number;
  /** Часы (epoch мс, инжектируются для тестов). */
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  waitMs: number;
  remaining: number;
}

export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, number[]>();

  constructor(options: RateLimiterOptions = {}) {
    this.maxRequests = options.maxRequests ?? RATE_LIMITER_DEFAULTS.maxRequests;
    this.windowMs = options.windowMs ?? RATE_LIMITER_DEFAULTS.windowMs;
    this.now = options.now ?? (() => Date.now());
    if (!(this.maxRequests >= 1) || !Number.isFinite(this.maxRequests)) {
      throw new RateLimiterError(
        `maxRequests должен быть конечным числом ≥ 1, получено ${this.maxRequests}`,
      );
    }
    if (!(this.windowMs > 0) || !Number.isFinite(this.windowMs)) {
      throw new RateLimiterError(
        `windowMs должен быть конечным числом > 0, получено ${this.windowMs}`,
      );
    }
  }

  /**
   * Пытается списать токен для хоста URL.
   * Валидный URL обязателен — иначе честная ошибка.
   */
  tryAcquire(url: string): RateLimitDecision {
    const host = this.extractHost(url);
    const nowMs = this.now();
    const bucket = (this.buckets.get(host) ?? []).filter(
      (ts) => nowMs - ts < this.windowMs,
    );

    if (bucket.length >= this.maxRequests) {
      const oldest = bucket[0]!;
      const waitMs = Math.ceil(this.windowMs - (nowMs - oldest));
      this.buckets.set(host, bucket);
      return { allowed: false, waitMs: Math.max(0, waitMs), remaining: 0 };
    }

    bucket.push(nowMs);
    this.buckets.set(host, bucket);
    return {
      allowed: true,
      waitMs: 0,
      remaining: this.maxRequests - bucket.length,
    };
  }

  /** Сколько токенов осталось для хоста (без списания). */
  remaining(url: string): number {
    const host = this.extractHost(url);
    const nowMs = this.now();
    const bucket = (this.buckets.get(host) ?? []).filter(
      (ts) => nowMs - ts < this.windowMs,
    );
    return Math.max(0, this.maxRequests - bucket.length);
  }

  private extractHost(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`недопустимый протокол ${parsed.protocol}`);
      }
      return parsed.host;
    } catch (cause) {
      throw new RateLimiterError(
        `tryAcquire: невалидный URL "${String(url)}" (причина: ${
          cause instanceof Error ? cause.message : String(cause)
        })`,
      );
    }
  }
}
