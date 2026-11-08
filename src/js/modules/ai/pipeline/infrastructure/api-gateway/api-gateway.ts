/**
 * APIGateway (Задача 2.1.4): единая точка внешних HTTP-вызовов.
 *
 * Конвейер запроса:
 *   1. Валидация (метод, URL http/https, таймаут).
 *   2. Rate limit (token bucket на хост; честное ожидание или отказ).
 *   3. Кэш (GET/HEAD, TTL, 2xx) → hit без сети.
 *   4. Circuit breaker на хост + RetryPolicy (идемпотентные ретраи).
 *   5. Сеть через инжектируемый HttpClientLike.
 *
 * execute() не бросает: результат всегда GatewayResult с честным status.
 */

import { CircuitBreaker, CircuitOpenError } from '../circuit-breaker.js';
import type { GatewayRequest, GatewayResult, HttpClientLike } from './types.js';
import { RateLimiter } from './rate-limiter.js';
import { ResponseCache } from './response-cache.js';
import { RetryPolicy } from './retry-policy.js';

export {
  RateLimiter,
  RateLimiterError,
  RATE_LIMITER_DEFAULTS,
} from './rate-limiter.js';
export { ResponseCache, CACHE_DEFAULTS } from './response-cache.js';
export { RetryPolicy, RETRY_DEFAULTS } from './retry-policy.js';
export type {
  GatewayRequest,
  GatewayResponse,
  GatewayMeta,
  GatewayResult,
  GatewayStatus,
  HttpClientLike,
  HttpMethod,
  RateLimitDecision,
  CacheEntry,
} from './types.js';

export const GATEWAY_DEFAULTS = {
  timeoutMs: 15_000,
  waitOnRateLimit: true,
  maxRateLimitWaitMs: 5_000,
} as const;

const ALLOWED_METHODS: readonly string[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
] as const;

export interface ApiGatewayOptions {
  client: HttpClientLike;
  rateLimiter?: RateLimiter;
  cache?: ResponseCache;
  retryPolicy?: RetryPolicy;
  /** Фабрика circuit breaker на хост. */
  circuitBreakerFactory?: (host: string) => CircuitBreaker;
  now?: () => number;
  /** Задержка (инжектируется для тестов). */
  delay?: (ms: number) => Promise<void>;
  waitOnRateLimit?: boolean;
  maxRateLimitWaitMs?: number;
  defaultTimeoutMs?: number;
}

export class ApiGateway {
  private readonly client: HttpClientLike;
  private readonly rateLimiter: RateLimiter;
  private readonly cache: ResponseCache;
  private readonly retryPolicy: RetryPolicy;
  private readonly now: () => number;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly waitOnRateLimit: boolean;
  private readonly maxRateLimitWaitMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly circuitBreakerFactory: (host: string) => CircuitBreaker;

  constructor(options: ApiGatewayOptions) {
    if (!options.client || typeof options.client.request !== 'function') {
      throw new Error(
        'ApiGateway требует client с методом request() (HttpClientLike)',
      );
    }
    this.client = options.client;
    this.rateLimiter = options.rateLimiter ?? new RateLimiter();
    this.cache = options.cache ?? new ResponseCache();
    this.retryPolicy = options.retryPolicy ?? new RetryPolicy();
    this.now = options.now ?? (() => Date.now());
    this.delay =
      options.delay ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.waitOnRateLimit =
      options.waitOnRateLimit ?? GATEWAY_DEFAULTS.waitOnRateLimit;
    this.maxRateLimitWaitMs =
      options.maxRateLimitWaitMs ?? GATEWAY_DEFAULTS.maxRateLimitWaitMs;
    this.defaultTimeoutMs =
      options.defaultTimeoutMs ?? GATEWAY_DEFAULTS.timeoutMs;
    this.circuitBreakerFactory =
      options.circuitBreakerFactory ?? (() => new CircuitBreaker());
  }

  /** Главная точка входа: конвейер запроса, никогда не бросает. */
  async execute(request: GatewayRequest): Promise<GatewayResult> {
    const startedAt = this.now();
    const warnings: string[] = [];

    // 1) Валидация
    const validationError = this.validate(request);
    if (validationError !== null) {
      return { status: 'rejected', error: validationError };
    }

    const body = this.serializeBody(request);
    const cacheKey = this.cache.keyOf(request.method, request.url, body);

    // 2) Rate limit
    const decision = this.rateLimiter.tryAcquire(request.url);
    let rateLimitWaitMs = 0;
    if (!decision.allowed) {
      if (!this.waitOnRateLimit || decision.waitMs > this.maxRateLimitWaitMs) {
        return {
          status: 'rate_limited',
          error: `rate limit исчерпан для хоста (ждать ${decision.waitMs} мс, максимум ${this.maxRateLimitWaitMs} мс)`,
        };
      }
      rateLimitWaitMs = decision.waitMs;
      await this.delay(decision.waitMs);
      warnings.push(`rate limit: ожидание ${decision.waitMs} мс`);
    }

    // 3) Кэш
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return {
        status: 'success',
        response: {
          ...cached,
          meta: {
            cacheKey,
            cache: 'hit',
            attempts: 0,
            durationMs: this.now() - startedAt,
            rateLimitWaitMs,
            warnings,
          },
        },
      };
    }

    // 4) Circuit breaker + ретраи
    const host = this.hostOf(request.url);
    const breaker = this.breakerFor(host);
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    let attempts = 0;

    try {
      const response = await breaker.execute(async () => {
        for (;;) {
          attempts += 1;
          try {
            const raw = await this.client.request(request, timeoutMs);
            const gatewayResponse = {
              status: raw.status,
              ok: raw.status >= 200 && raw.status < 300,
              body: raw.body,
              headers: raw.headers,
              meta: {
                cacheKey,
                cache: 'miss' as const,
                attempts,
                durationMs: this.now() - startedAt,
                rateLimitWaitMs,
                warnings,
              },
            };
            if (raw.status >= 500 || raw.status === 429) {
              const decision2 = this.retryPolicy.decide(
                request,
                { kind: 'status', status: raw.status },
                attempts,
              );
              if (decision2.retry) {
                warnings.push(decision2.reason);
                await this.delay(decision2.delayMs);
                continue;
              }
            }
            return gatewayResponse;
          } catch (error) {
            const kind: 'timeout' | 'network' = isTimeoutError(error)
              ? 'timeout'
              : 'network';
            const message =
              error instanceof Error ? error.message : String(error);
            const decision2 = this.retryPolicy.decide(
              request,
              { kind },
              attempts,
            );
            if (decision2.retry) {
              warnings.push(`${decision2.reason}: ${message}`);
              await this.delay(decision2.delayMs);
              continue;
            }
            const enriched = new Error(
              `${kind === 'timeout' ? 'Таймаут' : 'Ошибка сети'} после ${attempts} попыток: ${message}`,
            );
            enriched.name =
              kind === 'timeout' ? 'GatewayTimeoutError' : 'NetworkError';
            throw enriched;
          }
        }
      });

      // 5) Кэширование успешного идемпотентного ответа
      this.cache.set(request.method, request.url, body, response);

      const status: GatewayResult['status'] = response.ok
        ? 'success'
        : 'server_error';
      return {
        status,
        response,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        return {
          status: 'circuit_open',
          error: `circuit breaker разомкнут для ${host}: ${error.message}`,
        };
      }
      const name = error instanceof Error ? error.name : '';
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: name === 'GatewayTimeoutError' ? 'timeout' : 'network_error',
        error: message,
      };
    }
  }

  /** Снимки circuit breaker по хостам (диагностика). */
  getBreakerSnapshots(): Record<
    string,
    { state: string; failures: number; successes: number }
  > {
    const result: Record<
      string,
      { state: string; failures: number; successes: number }
    > = {};
    for (const [host, breaker] of this.breakers) {
      const snapshot = breaker.getState();
      result[host] = {
        state: snapshot.state,
        failures: snapshot.failures,
        successes: snapshot.successes,
      };
    }
    return result;
  }

  private validate(request: GatewayRequest): string | null {
    if (typeof request !== 'object' || request === null) {
      return 'execute: request должен быть объектом';
    }
    if (!ALLOWED_METHODS.includes(request.method)) {
      return `execute: недопустимый метод "${String(request.method)}"`;
    }
    try {
      const parsed = new URL(request.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `execute: разрешены только http/https, получен ${parsed.protocol}`;
      }
    } catch {
      return `execute: невалидный URL "${String(request.url)}"`;
    }
    if (
      request.timeoutMs !== undefined &&
      (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)
    ) {
      return 'execute: timeoutMs должен быть конечным числом > 0';
    }
    return null;
  }

  private serializeBody(request: GatewayRequest): string | undefined {
    if (request.body === undefined) return undefined;
    return typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body);
  }

  private hostOf(url: string): string {
    return new URL(url).host;
  }

  private breakerFor(host: string): CircuitBreaker {
    const existing = this.breakers.get(host);
    if (existing) return existing;
    const breaker = this.circuitBreakerFactory(host);
    this.breakers.set(host, breaker);
    return breaker;
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    /timeout|ETIMEDOUT|aborted/i.test(error.message)
  );
}
