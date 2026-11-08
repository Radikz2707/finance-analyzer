/**
 * Тесты APIGateway (Задача 2.1): RateLimiter, ResponseCache, RetryPolicy,
 * фасад ApiGateway. Всё детерминировано через DI-часы и DI-клиент.
 *
 * Глобальные describe/it/expect/vi предоставляются vitest (globals: true в
 * vitest.config.ts). Явный `import ... from 'vitest'` в этом проекте создаёт
 * второй экземпляр @vitest/runner и ломает контекст — поэтому глобалы.
 */

import {
  ApiGateway,
  RateLimiter,
  RateLimiterError,
  ResponseCache,
  RetryPolicy,
} from './index.js';
import { CircuitBreaker } from '../circuit-breaker.js';
import type { GatewayRequest, HttpClientLike } from './types.js';

// ─── Утилиты ──────────────────────────────────────────────────────────────

let clockMs = 1_000_000;
const now = () => clockMs;
const tick = (ms: number) => {
  clockMs += ms;
};

const delayImmediate = async () => undefined;

function makeClient(
  handler: (
    req: GatewayRequest,
    timeoutMs: number,
  ) => Promise<{
    status: number;
    body: string;
  }>,
): HttpClientLike & { calls: number } {
  const client = {
    calls: 0,
    async request(req: GatewayRequest, timeoutMs: number) {
      client.calls += 1;
      return handler(req, timeoutMs);
    },
  };
  return client;
}

const GET_URL = 'https://api.example.com/v1/quotes';
const get = (overrides: Partial<GatewayRequest> = {}): GatewayRequest => ({
  method: 'GET',
  url: GET_URL,
  ...overrides,
});

// ─── RateLimiter ──────────────────────────────────────────────────────────

describe('RateLimiter', () => {
  it('разрешает до лимита и считает remaining', () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 10_000, now });
    expect(limiter.tryAcquire(GET_URL)).toEqual({
      allowed: true,
      waitMs: 0,
      remaining: 2,
    });
    limiter.tryAcquire(GET_URL);
    const third = limiter.tryAcquire(GET_URL);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it('превышение лимита → отказ с честным waitMs', () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 10_000, now });
    limiter.tryAcquire(GET_URL);
    tick(4_000);
    limiter.tryAcquire(GET_URL);
    const blocked = limiter.tryAcquire(GET_URL);
    expect(blocked.allowed).toBe(false);
    expect(blocked.waitMs).toBeGreaterThan(0);
    expect(blocked.waitMs).toBeLessThanOrEqual(10_000);
  });

  it('скользящее окно: старые запросы освобождают лимит', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 10_000, now });
    expect(limiter.tryAcquire(GET_URL).allowed).toBe(true);
    tick(10_001);
    expect(limiter.tryAcquire(GET_URL).allowed).toBe(true);
  });

  it('лимиты считаются по хостам независимо', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 10_000, now });
    expect(limiter.tryAcquire('https://a.example.com/x').allowed).toBe(true);
    expect(limiter.tryAcquire('https://b.example.com/x').allowed).toBe(true);
  });

  it('невалидный URL → честная ошибка', () => {
    const limiter = new RateLimiter({ now });
    expect(() => limiter.tryAcquire('not-a-url')).toThrow(RateLimiterError);
    expect(() => limiter.tryAcquire('ftp://example.com/x')).toThrow(
      RateLimiterError,
    );
  });

  it('конструктор: некорректные параметры → честная ошибка', () => {
    expect(() => new RateLimiter({ maxRequests: 0, now })).toThrow(
      RateLimiterError,
    );
    expect(() => new RateLimiter({ windowMs: -5, now })).toThrow(
      RateLimiterError,
    );
  });
});

// ─── ResponseCache ────────────────────────────────────────────────────────

describe('ResponseCache', () => {
  const makeResponse = (status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    body: 'payload',
    meta: {
      cache: 'miss' as const,
      attempts: 1,
      durationMs: 10,
      rateLimitWaitMs: 0,
      warnings: [],
    },
  });

  it('set/get: 2xx GET кэшируется и возвращается', () => {
    const cache = new ResponseCache({ now, ttlMs: 60_000 });
    const key = cache.set('GET', GET_URL, undefined, makeResponse());
    expect(key).not.toBeNull();
    expect(cache.get(key!)).not.toBeNull();
  });

  it('TTL: истёкшая запись не возвращается', () => {
    const cache = new ResponseCache({ now, ttlMs: 100 });
    const key = cache.set('GET', GET_URL, undefined, makeResponse())!;
    tick(101);
    expect(cache.get(key)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('POST не кэшируется никогда', () => {
    const cache = new ResponseCache({ now });
    const key = cache.set('POST', GET_URL, '{}', makeResponse());
    expect(key).toBeNull();
  });

  it('5xx не кэшируется', () => {
    const cache = new ResponseCache({ now });
    const key = cache.set('GET', GET_URL, undefined, makeResponse(503));
    expect(key).toBeNull();
  });

  it('sweep удаляет только истёкшие', () => {
    const cache = new ResponseCache({ now, ttlMs: 100 });
    const k1 = cache.set(
      'GET',
      'https://a.example.com/1',
      undefined,
      makeResponse(),
    )!;
    tick(50);
    const k2 = cache.set(
      'GET',
      'https://a.example.com/2',
      undefined,
      makeResponse(),
    )!;
    tick(51);
    expect(cache.sweep()).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.get(k1)).toBeNull();
    expect(cache.get(k2)).not.toBeNull();
  });

  it('конструктор: некорректные параметры → честная ошибка', () => {
    expect(() => new ResponseCache({ ttlMs: 0 })).toThrow();
    expect(() => new ResponseCache({ maxEntries: 0 })).toThrow();
  });
});

// ─── RetryPolicy ──────────────────────────────────────────────────────────

describe('RetryPolicy', () => {
  const getReq = get();

  it('5xx на идемпотентном GET → ретрай с экспоненциальной задержкой', () => {
    const policy = new RetryPolicy({
      maxRetries: 2,
      baseMs: 500,
      random: () => 0.5,
    });
    const d1 = policy.decide(getReq, { kind: 'status', status: 503 }, 1);
    expect(d1.retry).toBe(true);
    expect(d1.delayMs).toBe(500);
    const d2 = policy.decide(getReq, { kind: 'status', status: 503 }, 2);
    expect(d2.retry).toBe(true);
    expect(d2.delayMs).toBe(1000);
    const d3 = policy.decide(getReq, { kind: 'status', status: 503 }, 3);
    expect(d3.retry).toBe(false);
    expect(d3.reason).toContain('исчерпан');
  });

  it('4xx не повторяется', () => {
    const policy = new RetryPolicy({ maxRetries: 3 });
    const decision = policy.decide(getReq, { kind: 'status', status: 404 }, 1);
    expect(decision.retry).toBe(false);
    expect(decision.reason).toContain('404');
  });

  it('POST без allowNonIdempotent не повторяется', () => {
    const policy = new RetryPolicy({ maxRetries: 3 });
    const postReq: GatewayRequest = { method: 'POST', url: GET_URL };
    const decision = policy.decide(postReq, { kind: 'network' }, 1);
    expect(decision.retry).toBe(false);
    expect(decision.reason).toContain('не идемпотентен');
  });

  it('network/timeout повторяются (GET)', () => {
    const policy = new RetryPolicy({
      maxRetries: 1,
      baseMs: 100,
      random: () => 0.5,
    });
    expect(policy.decide(getReq, { kind: 'network' }, 1).retry).toBe(true);
    expect(policy.decide(getReq, { kind: 'timeout' }, 1).retry).toBe(true);
  });

  it('429 повторяется как серверная перегрузка', () => {
    const policy = new RetryPolicy({
      maxRetries: 1,
      baseMs: 100,
      random: () => 0.5,
    });
    expect(
      policy.decide(getReq, { kind: 'status', status: 429 }, 1).retry,
    ).toBe(true);
  });
});

// ─── ApiGateway (фасад) ───────────────────────────────────────────────────

describe('ApiGateway', () => {
  const makeGateway = (
    handler: Parameters<typeof makeClient>[0],
    overrides: Partial<ConstructorParameters<typeof ApiGateway>[0]> = {},
  ) =>
    new ApiGateway({
      client: makeClient(handler),
      now,
      delay: delayImmediate,
      ...overrides,
    });

  it('успешный запрос: конвейер без ретраев, meta заполнен', async () => {
    const client = makeClient(async () => ({ status: 200, body: 'ok' }));
    const gateway = new ApiGateway({ client, now, delay: delayImmediate });
    const result = await gateway.execute(get());
    expect(result.status).toBe('success');
    expect(result.response?.ok).toBe(true);
    expect(result.response?.meta.attempts).toBe(1);
    expect(result.response?.meta.cache).toBe('miss');
    expect(result.response?.body).toBe('ok');
    expect(client.calls).toBe(1);
  });

  it('кэш: повторный GET идёт из кэша, сеть не дёргается', async () => {
    const client = makeClient(async () => ({ status: 200, body: 'ok' }));
    const gateway = new ApiGateway({ client, now, delay: delayImmediate });
    const first = await gateway.execute(get());
    const second = await gateway.execute(get());
    expect(first.response?.meta.cache).toBe('miss');
    expect(second.response?.meta.cache).toBe('hit');
    expect(second.response?.body).toBe('ok');
    expect(client.calls).toBe(1);
  });

  it('retire 5xx: вторая попытка успешна, attempts=2', async () => {
    let call = 0;
    const client = makeClient(async () => {
      call += 1;
      return call === 1
        ? { status: 503, body: 'unavailable' }
        : { status: 200, body: 'recovered' };
    });
    const gateway = new ApiGateway({
      client,
      now,
      delay: delayImmediate,
      retryPolicy: new RetryPolicy({
        maxRetries: 2,
        baseMs: 10,
        random: () => 0.5,
      }),
    });
    const result = await gateway.execute(get());
    expect(result.status).toBe('success');
    expect(result.response?.meta.attempts).toBe(2);
    expect(
      result.response?.meta.warnings.some((w) => w.includes('повтор')),
    ).toBe(true);
  });

  it('исчерпанные ретраи 5xx → server_error с честным error', async () => {
    const client = makeClient(async () => ({ status: 500, body: 'boom' }));
    const gateway = new ApiGateway({
      client,
      now,
      delay: delayImmediate,
      retryPolicy: new RetryPolicy({
        maxRetries: 1,
        baseMs: 5,
        random: () => 0.5,
      }),
    });
    const result = await gateway.execute(get());
    expect(result.status).toBe('server_error');
    expect(result.error).toContain('500');
    expect(result.response?.meta.attempts).toBe(2);
  });

  it('4xx не ретраится и не роняет: server_error без повторов', async () => {
    const client = makeClient(async () => ({ status: 404, body: 'nope' }));
    const gateway = new ApiGateway({ client, now, delay: delayImmediate });
    const result = await gateway.execute(get());
    expect(result.status).toBe('server_error');
    expect(result.response?.meta.attempts).toBe(1);
  });

  it('таймаут сети → статус timeout (классификация AbortError)', async () => {
    const client = makeClient(async () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    });
    const gateway = new ApiGateway({
      client,
      now,
      delay: delayImmediate,
      retryPolicy: new RetryPolicy({ maxRetries: 0 }),
    });
    const result = await gateway.execute(get());
    expect(result.status).toBe('timeout');
    expect(result.error).toContain('aborted');
  });

  it('rate limit: waitOnRateLimit=false → честный отказ без сети', async () => {
    const client = makeClient(async () => ({ status: 200, body: 'ok' }));
    const gateway = new ApiGateway({
      client,
      now,
      delay: delayImmediate,
      rateLimiter: new RateLimiter({ maxRequests: 1, windowMs: 10_000, now }),
      waitOnRateLimit: false,
    });
    const first = await gateway.execute(get());
    expect(first.status).toBe('success');
    const second = await gateway.execute(get());
    expect(second.status).toBe('rate_limited');
    expect(client.calls).toBe(1);
  });

  it('circuit breaker: серия падений размыкает цепь → circuit_open', async () => {
    const client = makeClient(async () => {
      const error = new Error('connection refused');
      throw error;
    });
    const gateway = new ApiGateway({
      client,
      now,
      delay: delayImmediate,
      retryPolicy: new RetryPolicy({ maxRetries: 0 }),
      circuitBreakerFactory: () =>
        new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000, now }),
    });
    const r1 = await gateway.execute(get());
    const r2 = await gateway.execute(get());
    expect(r1.status).toBe('network_error');
    expect(r2.status).toBe('network_error');
    // Третий запрос отклоняется разомкнутой цепью
    const r3 = await gateway.execute(get());
    expect(r3.status).toBe('circuit_open');
    expect(r3.error).toContain('circuit breaker');
    // Диагностика
    const snapshots = gateway.getBreakerSnapshots();
    expect(snapshots['api.example.com']?.state).toBe('open');
  });

  it('rejected: невалидный URL / метод / таймаут → честный отказ', async () => {
    const gateway = makeGateway(async () => ({ status: 200, body: 'ok' }));
    expect((await gateway.execute(get({ url: 'not-a-url' }))).status).toBe(
      'rejected',
    );
    expect(
      (await gateway.execute(get({ url: 'ftp://x.example.com' }))).status,
    ).toBe('rejected');
    expect(
      (await gateway.execute(get({ method: 'TRACE' as never }))).status,
    ).toBe('rejected');
    expect((await gateway.execute(get({ timeoutMs: -1 }))).status).toBe(
      'rejected',
    );
  });

  it('конструктор без клиента → честная ошибка', () => {
    expect(() => new ApiGateway({ client: null as never })).toThrow();
  });
});
