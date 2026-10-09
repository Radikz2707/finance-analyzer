/**
 * RetryPolicy (Задача 2.1.3): экспоненциальный backoff для повторных попыток.
 *
 * - Ретраи только для идемпотентных методов (GET/HEAD/PUT/DELETE);
 *   POST/PATCH повторяются только при явном allowNonIdempotent=true.
 * - Повторяем только network error / timeout / 5xx; 4xx — нет.
 * - Задержка = baseMs · 2^(попытка-1), ограничена maxBackoffMs; jitter
 *   детерминированный (инжектируется генератор [0..1)).
 */

import type { GatewayRequest } from './types.js';

export const RETRY_DEFAULTS = {
  maxRetries: 2,
  baseMs: 500,
  maxBackoffMs: 10_000,
} as const;

const IDEMPOTENT_METHODS: readonly string[] = [
  'GET',
  'HEAD',
  'PUT',
  'DELETE',
] as const;

export type RetryableFailure =
  { kind: 'network' | 'timeout' } | { kind: 'status'; status: number };

export interface RetryDecision {
  retry: boolean;
  /** Задержка перед следующей попыткой, мс (0 если retry=false). */
  delayMs: number;
  reason: string;
}

export class RetryPolicy {
  private readonly maxRetries: number;
  private readonly baseMs: number;
  private readonly maxBackoffMs: number;
  private readonly allowNonIdempotent: boolean;
  private readonly random: () => number;

  constructor(options?: {
    maxRetries?: number;
    baseMs?: number;
    maxBackoffMs?: number;
    allowNonIdempotent?: boolean;
    random?: () => number;
  }) {
    this.maxRetries = options?.maxRetries ?? RETRY_DEFAULTS.maxRetries;
    this.baseMs = options?.baseMs ?? RETRY_DEFAULTS.baseMs;
    this.maxBackoffMs = options?.maxBackoffMs ?? RETRY_DEFAULTS.maxBackoffMs;
    this.allowNonIdempotent = options?.allowNonIdempotent ?? false;
    this.random = options?.random ?? (() => 0.5);
    if (!(this.maxRetries >= 0) || this.maxRetries > 10) {
      throw new Error(
        `RetryPolicy: maxRetries должен быть 0..10, получено ${this.maxRetries}`,
      );
    }
  }

  /** Решение о повторе для попытки attempt (1-базированная). */
  decide(
    request: GatewayRequest,
    failure: RetryableFailure,
    attempt: number,
  ): RetryDecision {
    if (attempt > this.maxRetries) {
      return {
        retry: false,
        delayMs: 0,
        reason: `исчерпан лимит ретраев (${this.maxRetries})`,
      };
    }
    if (
      failure.kind === 'status' &&
      failure.status < 500 &&
      failure.status !== 429
    ) {
      return {
        retry: false,
        delayMs: 0,
        reason: `статус ${failure.status} не повторяется (клиентская ошибка)`,
      };
    }
    const idempotent = IDEMPOTENT_METHODS.includes(request.method);
    if (!idempotent && !this.allowNonIdempotent) {
      return {
        retry: false,
        delayMs: 0,
        reason: `метод ${request.method} не идемпотентен — ретраи отключены`,
      };
    }
    const exponential = Math.min(
      this.maxBackoffMs,
      this.baseMs * 2 ** (attempt - 1),
    );
    // Детерминированный jitter: ±25% от экспоненциальной задержки
    const jitter = 1 + (this.random() - 0.5) * 0.5;
    return {
      retry: true,
      delayMs: Math.max(1, Math.round(exponential * jitter)),
      reason: `повтор после ${failure.kind}${
        failure.kind === 'status' ? ` ${failure.status}` : ''
      } (попытка ${attempt}/${this.maxRetries})`,
    };
  }
}
