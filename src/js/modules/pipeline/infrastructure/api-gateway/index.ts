/**
 * APIGateway (Задача 2.1): единая точка внешних HTTP-вызовов.
 */

export {
  ApiGateway,
  GATEWAY_DEFAULTS,
  RateLimiter,
  RateLimiterError,
  RATE_LIMITER_DEFAULTS,
  ResponseCache,
  CACHE_DEFAULTS,
  RetryPolicy,
  RETRY_DEFAULTS,
} from './api-gateway.js';
export type { ApiGatewayOptions } from './api-gateway.js';
export type {
  CacheEntry,
  GatewayMeta,
  GatewayRequest,
  GatewayResponse,
  GatewayResult,
  GatewayStatus,
  HttpClientLike,
  HttpMethod,
  RateLimitDecision,
} from './types.js';
export type { RetryableFailure, RetryDecision } from './retry-policy.js';
