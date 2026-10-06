/**
 * Тесты infrastructure:
 * - CircuitBreaker (closed → open → halfOpen → closed);
 * - withRetry (exponential backoff + jitter, retryable-предикат);
 * - withFallback (fallback chain, CircuitOpenError не триггерит fallback);
 * - withProviderFallback (фабрика для цепочки данных MOEX → CBR → Finam).
 */

import {
  CircuitBreaker,
  CircuitOpenError,
  createCircuitBreaker,
  isCircuitOpenError,
  withRetry,
  withFallback,
} from './circuit-breaker.js';
import { withProviderFallback } from '../../research/providers/provider-fallback.js';

// ──────────────────────────────────────────────
// CircuitBreaker
// ──────────────────────────────────────────────

describe('CircuitBreaker', () => {
  it('закрыт → открыт после N ошибок подряд (failureThreshold)', async () => {
    const onStateChange = vi.fn();
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      onStateChange,
    });
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fn)).rejects.toThrow('boom');
    }

    expect(fn).toHaveBeenCalledTimes(3);
    const state = breaker.getState();
    expect(state.state).toBe('open');
    expect(state.failures).toBe(3);
    expect(onStateChange).toHaveBeenCalledWith('open', 'closed', breaker);
  });

  it('в состоянии open не вызывает fn и бросает CircuitOpenError', async () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 60_000,
    });
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(breaker.execute(failing)).rejects.toThrow('boom');
    expect(breaker.getState().state).toBe('open');

    const healthy = vi.fn().mockResolvedValue('ok');
    await expect(breaker.execute(healthy)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(healthy).not.toHaveBeenCalled();
  });

  it('после cooldown переходит в halfOpen: пробный вызов, успех → closed', async () => {
    let now = 0;
    const states: string[] = [];
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      now: () => now,
      onStateChange: (state) => states.push(state),
    });
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(breaker.execute(failing)).rejects.toThrow('boom');
    expect(breaker.getState().state).toBe('open');

    // Cooldown ещё не истёк — цепь остаётся open, fn не вызывается
    now = 500;
    await expect(breaker.execute(failing)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(failing).toHaveBeenCalledTimes(1);

    // Cooldown истёк — halfOpen, пробный вызов успешен → closed
    now = 1000;
    const healthy = vi.fn().mockResolvedValue('ok');
    await expect(breaker.execute(healthy)).resolves.toBe('ok');
    expect(breaker.getState().state).toBe('closed');
    expect(breaker.getState().successes).toBeGreaterThan(0);
    expect(states).toEqual(['open', 'halfOpen', 'closed']);
  });

  it('ошибка пробного вызова в halfOpen снова открывает цепь', async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 500,
      now: () => now,
    });
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(breaker.execute(fn)).rejects.toThrow('boom');
    await expect(breaker.execute(fn)).rejects.toThrow('boom');
    expect(breaker.getState().state).toBe('open'); // threshold = 2

    now = 500; // cooldown истёк → halfOpen
    await expect(breaker.execute(fn)).rejects.toThrow('boom'); // пробный вызов падает
    expect(breaker.getState().state).toBe('open');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('в halfOpen допускается только один пробный вызов', async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 100,
      now: () => now,
    });
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(breaker.execute(failing)).rejects.toThrow('boom');

    now = 100; // cooldown истёк
    let resolveFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const slow = vi.fn().mockImplementation(() => gate.then(() => 'ok'));

    const first = breaker.execute(slow);
    // Пока пробный вызов выполняется — второй отклоняется сразу
    await expect(breaker.execute(slow)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );

    resolveFirst();
    await expect(first).resolves.toBe('ok');
    expect(breaker.getState().state).toBe('closed');
  });

  it('reset() возвращает цепь в closed', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 60_000,
    });
    await expect(
      breaker.execute(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(breaker.getState().state).toBe('open');

    breaker.reset();
    expect(breaker.getState().state).toBe('closed');
    await expect(breaker.execute(() => Promise.resolve('ok'))).resolves.toBe(
      'ok',
    );
  });

  it('isCircuitOpenError распознаёт CircuitOpenError', () => {
    expect(isCircuitOpenError(new CircuitOpenError())).toBe(true);
    expect(isCircuitOpenError(new Error('обычная ошибка'))).toBe(false);
    expect(isCircuitOpenError(undefined)).toBe(false);
  });
});

// ──────────────────────────────────────────────
// withRetry
// ──────────────────────────────────────────────

describe('withRetry', () => {
  it('возвращает результат после N-1 ошибок (успех на повторе)', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, { retries: 2, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('при исчерпании попыток бросает последнюю ошибку', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('last-error'));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow(
      'last-error',
    );
    expect(fn).toHaveBeenCalledTimes(3); // 1 попытка + 2 повтора
  });

  it('использует экспоненциальный backoff (100ms → 200ms) и onRetry', async () => {
    vi.useFakeTimers();
    try {
      const delays: number[] = [];
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('e1'))
        .mockRejectedValueOnce(new Error('e2'))
        .mockResolvedValueOnce('ok');

      const promise = withRetry(fn, {
        retries: 2,
        baseDelayMs: 100,
        factor: 2,
        jitter: false,
        onRetry: (_err, _attempt, delay) => delays.push(delay),
      });

      await vi.advanceTimersByTimeAsync(1000);
      await expect(promise).resolves.toBe('ok');
      expect(delays).toEqual([100, 200]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('не повторяет CircuitOpenError (даже если retries > 0)', async () => {
    const fn = vi.fn().mockRejectedValue(new CircuitOpenError('open'));
    await expect(
      withRetry(fn, { retries: 5, baseDelayMs: 1 }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('уважает кастомный retryable-предикат', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('skip-me'));
    await expect(
      withRetry(fn, {
        retries: 3,
        baseDelayMs: 1,
        retryable: () => false,
      }),
    ).rejects.toThrow('skip-me');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────
// withFallback
// ──────────────────────────────────────────────

describe('withFallback', () => {
  it('успех primary: значение, source=primary, attempts=1', async () => {
    const result = await withFallback(
      async () => 'primary-value',
      [async () => 'fallback-value'],
    );
    expect(result).toEqual({
      value: 'primary-value',
      source: 'primary',
      attempts: 1,
    });
  });

  it('падение primary → fallback с меткой источника', async () => {
    const primary = vi.fn().mockRejectedValue(new Error('primary-down'));
    const fallback = vi.fn().mockResolvedValue('fallback-value');

    const result = await withFallback(primary, [fallback], {
      labels: ['moex', 'finam'],
    });

    expect(result).toEqual({
      value: 'fallback-value',
      source: 'finam',
      attempts: 2,
    });
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('падение всех источников → бросает ошибку последнего', async () => {
    const fallback = vi.fn().mockRejectedValue(new Error('fallback-down'));
    await expect(
      withFallback(async () => {
        throw new Error('primary-down');
      }, [fallback]),
    ).rejects.toThrow('fallback-down');
  });

  it('CircuitOpenError из primary не триггерит fallback (проброс сразу)', async () => {
    const primary = vi.fn().mockRejectedValue(new CircuitOpenError('open'));
    const fallback = vi.fn().mockResolvedValue('fallback-value');

    await expect(withFallback(primary, [fallback])).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  it('shouldFallback=false останавливает цепочку', async () => {
    const primary = vi.fn().mockRejectedValue(new Error('stop'));
    const fallback = vi.fn().mockResolvedValue('x');

    await expect(
      withFallback(primary, [fallback], { shouldFallback: () => false }),
    ).rejects.toThrow('stop');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('onFallback вызывается при переходе между источниками', async () => {
    const onFallback = vi.fn();
    const result = await withFallback(
      async () => {
        throw new Error('down');
      },
      [async () => 'ok'],
      { labels: ['a', 'b'], onFallback },
    );
    expect(result.source).toBe('b');
    expect(onFallback).toHaveBeenCalledWith('a', 'b', expect.any(Error));
  });
});

// ──────────────────────────────────────────────
// withProviderFallback (данные: MOEX → CBR → Finam)
// ──────────────────────────────────────────────

describe('withProviderFallback', () => {
  it('возвращает значение от первого доступного источника с его именем', async () => {
    const result = await withProviderFallback(
      { name: 'MOEX', fetch: async () => 'moex-data' },
      [{ name: 'CBR', fetch: async () => 'cbr-data' }],
    );
    expect(result).toEqual({ value: 'moex-data', source: 'MOEX', attempts: 1 });
  });

  it('при падении MOEX и CBR отвечает Finam', async () => {
    const result = await withProviderFallback(
      {
        name: 'MOEX',
        fetch: async () => {
          throw new Error('MOEX down');
        },
      },
      [
        {
          name: 'CBR',
          fetch: async () => {
            throw new Error('CBR down');
          },
        },
        { name: 'Finam', fetch: async () => 'finam-data' },
      ],
    );
    expect(result.value).toBe('finam-data');
    expect(result.source).toBe('Finam');
    expect(result.attempts).toBe(3);
  });
});
