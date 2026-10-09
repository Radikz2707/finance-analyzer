/**
 * Типы APIGateway (Задача 2.1): единая точка внешних HTTP-вызовов
 * с rate limiting, TTL-кэшем, ретраями и circuit breaker.
 *
 * Принципы: DI (HTTP-клиент и часы инжектируются), честные ошибки,
 * прозрачная диагностика каждой фазы запроса.
 */

// ─── Запрос / ответ ───────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export interface GatewayRequest {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  /** Тело запроса (строка или сериализуемый объект). */
  body?: string | Record<string, unknown>;
  /** Таймаут конкретного запроса, мс (по умолчанию из конфига шлюза). */
  timeoutMs?: number;
}

export interface GatewayResponse {
  status: number;
  ok: boolean;
  /** Тело ответа как строка. */
  body: string;
  headers?: Record<string, string>;
  /** Фазы прохождения: где запрос провёл время (диагностика). */
  meta: GatewayMeta;
}

export interface GatewayMeta {
  /** Ключ кэша, если запрос мог кэшироваться. */
  cacheKey?: string;
  /** 'hit' — из кэша; 'miss' — сеть; 'bypass' — кэш не применялся. */
  cache: 'hit' | 'miss' | 'bypass';
  /** Сколько реальных сетевых попыток было сделано (1 + ретраи). */
  attempts: number;
  /** Полная длительность, мс (включая ожидание rate limit и backoff). */
  durationMs: number;
  /** Ожидание из-за rate limit, мс (0 если не ждали). */
  rateLimitWaitMs: number;
  warnings: string[];
}

// ─── Rate limiting ────────────────────────────────────────────────────────

/** Результат запроса разрешения rate limiter. */
export interface RateLimitDecision {
  /** true — можно выполнять запрос сейчас; false — превышен лимит. */
  allowed: boolean;
  /** Сколько ждать до разрешения, мс (0 при allowed=true). */
  waitMs: number;
  /** Сколько токенов осталось (после списания). */
  remaining: number;
}

// ─── Кэш ──────────────────────────────────────────────────────────────────

export interface CacheEntry {
  response: GatewayResponse;
  /** Абсолютное время истечения (epoch мс). */
  expiresAt: number;
  storedAt: number;
}

// ─── DI-клиент ────────────────────────────────────────────────────────────

/** Минимальный контракт HTTP-клиента (инжектируется; в Node — fetch). */
export interface HttpClientLike {
  request(
    req: GatewayRequest,
    timeoutMs: number,
  ): Promise<{
    status: number;
    body: string;
    headers?: Record<string, string>;
  }>;
}

// ─── Ошибки и итог ────────────────────────────────────────────────────────

/** Статус итога шлюза. */
export type GatewayStatus =
  | 'success'
  | 'rate_limited'
  | 'circuit_open'
  | 'timeout'
  | 'network_error'
  | 'server_error'
  | 'rejected';

/** Итог вызова через шлюз (success=true только при успехе). */
export interface GatewayResult {
  status: GatewayStatus;
  response?: GatewayResponse;
  error?: string;
}
