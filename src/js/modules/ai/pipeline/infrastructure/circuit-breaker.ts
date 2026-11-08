/**
 * Circuit breaker + retry (exponential backoff + jitter) + fallback chain.
 *
 * Инфраструктура устойчивости для внешних вызовов:
 * - AI-провайдеры (Ollama → OpenRouter → GigaChat → YandexGPT);
 * - источники данных (MOEX → CBR → Finam).
 *
 * Состояния circuit breaker: closed → open → halfOpen → closed.
 * Открытая цепь мгновенно отклоняет вызовы (CircuitOpenError), не нагружая
 * падающий провайдер; после cooldown цепь переходит в halfOpen и пропускает
 * один пробный вызов: успех закрывает цепь, ошибка снова её размыкает.
 */

export type CircuitState = 'closed' | 'open' | 'halfOpen';

/** Ошибка: цепь разомкнута — вызов отклонён без обращения к fn */
export class CircuitOpenError extends Error {
  constructor(message = 'Circuit is open: provider in cooldown') {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

/** Проверка «разомкнута ли цепь» для этой ошибки */
export function isCircuitOpenError(error: unknown): boolean {
  return error instanceof CircuitOpenError;
}

export interface CircuitBreakerOptions {
  /** Количество подряд идущих ошибок до размыкания (по умолчанию 3) */
  failureThreshold?: number;
  /** Cooldown перед переходом в halfOpen, мс (по умолчанию 30_000) */
  resetTimeoutMs?: number;
  /** Колбэк смены состояния (логирование/метрики) */
  onStateChange?: (
    state: CircuitState,
    previous: CircuitState,
    breaker: CircuitBreaker,
  ) => void;
  /** Инжектируемые часы (для детерминированных тестов) */
  now?: () => number;
}

/** Снимок состояния circuit breaker (диагностика/мониторинг) */
export interface CircuitBreakerSnapshot {
  state: CircuitState;
  /** Текущая серия ошибок (сбрасывается после успеха) */
  failures: number;
  /** Накопленное количество успехов */
  successes: number;
  /** Timestamp размыкания (null, пока цепь не открыта) */
  openedAt: number | null;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly onStateChange?: CircuitBreakerOptions['onStateChange'];
  private readonly now: () => number;

  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private openedAt: number | null = null;
  /** Пробный вызов в halfOpen уже выполняется (допускается только один) */
  private trialInFlight = false;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.onStateChange = options.onStateChange;
    this.now = options.now ?? (() => Date.now());
  }

  getState(): CircuitBreakerSnapshot {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      openedAt: this.openedAt,
    };
  }

  /** Принудительно вернуть цепь в закрытое состояние */
  reset(): void {
    this.failures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
    this.transitionTo('closed');
  }

  /**
   * Выполнить fn через circuit breaker.
   * - open → бросает CircuitOpenError, fn НЕ вызывается;
   * - halfOpen → один пробный вызов (успех закрывает, ошибка открывает);
   * - closed → обычный вызов, N ошибок подряд размыкают цепь.
   */
  async execute<T>(fn: () => Promise<T> | T): Promise<T> {
    // Ленивый переход open → halfOpen по истечении cooldown
    if (this.state === 'open') {
      const cooledDown =
        this.openedAt !== null &&
        this.now() - this.openedAt >= this.resetTimeoutMs;
      if (!cooledDown) {
        throw new CircuitOpenError();
      }
      this.transitionTo('halfOpen');
    }

    if (this.state === 'halfOpen') {
      // Пропускаем только один пробный вызов
      if (this.trialInFlight) {
        throw new CircuitOpenError(
          'Circuit is half-open: trial call already in flight',
        );
      }
      this.trialInFlight = true;
      try {
        const value = await fn();
        this.successes++;
        this.failures = 0;
        this.trialInFlight = false;
        this.transitionTo('closed');
        return value;
      } catch (error) {
        this.trialInFlight = false;
        this.failures++;
        this.transitionTo('open');
        throw error;
      }
    }

    // closed
    try {
      const value = await fn();
      this.successes++;
      this.failures = 0; // успех закрывает серию ошибок
      return value;
    } catch (error) {
      this.failures++;
      if (this.failures >= this.failureThreshold) {
        this.transitionTo('open');
      }
      throw error;
    }
  }

  private transitionTo(next: CircuitState): void {
    const previous = this.state;
    if (previous === next) {
      return;
    }
    this.state = next;
    this.openedAt = next === 'open' ? this.now() : null;
    this.onStateChange?.(next, previous, this);
  }
}

/** Фабрика-алиас: createCircuitBreaker(options) === new CircuitBreaker(options) */
export function createCircuitBreaker(
  options: CircuitBreakerOptions = {},
): CircuitBreaker {
  return new CircuitBreaker(options);
}

// ──────────────────────────────────────────────
// Retry: exponential backoff + jitter
// ──────────────────────────────────────────────

export interface RetryOptions {
  /** Сколько повторов после первого вызова (по умолчанию 2) */
  retries?: number;
  /** Базовая задержка, мс (по умолчанию 100) */
  baseDelayMs?: number;
  /** Множитель экспоненты (по умолчанию 2) */
  factor?: number;
  /** Jitter: true — случайный разброс [0, delay]; функция — свой генератор [0,1) */
  jitter?: boolean | (() => number);
  /** Какие ошибки повторять (по умолчанию все, кроме CircuitOpenError) */
  retryable?: (error: unknown) => boolean;
  /** Колбэк перед повтором (attempt нумеруется с 1) */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelayMs(
  attempt: number,
  baseDelayMs: number,
  factor: number,
  jitter: boolean | (() => number),
): number {
  const exponential = baseDelayMs * Math.pow(factor, attempt);
  if (!jitter) {
    return exponential;
  }
  const random = typeof jitter === 'function' ? jitter() : Math.random();
  return Math.floor(exponential * random); // full jitter: [0, exponential)
}

/**
 * Выполнить fn с повторами: exponential backoff (baseDelayMs * factor^attempt),
 * опциональный jitter. Повторяется только при retryable(error) — по умолчанию
 * всё, кроме CircuitOpenError (открытая цепь означает «не трогать»).
 * После исчерпания попыток бросается последняя ошибка.
 */
export async function withRetry<T>(
  fn: () => Promise<T> | T,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const factor = options.factor ?? 2;
  const jitter = options.jitter ?? false;
  const retryable =
    options.retryable ?? ((error: unknown) => !isCircuitOpenError(error));

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !retryable(error)) {
        throw error;
      }
      const delayMs = computeDelayMs(attempt, baseDelayMs, factor, jitter);
      options.onRetry?.(error, attempt + 1, delayMs);
      await sleep(delayMs);
      attempt++;
    }
  }
}

// ──────────────────────────────────────────────
// Fallback chain
// ──────────────────────────────────────────────

export interface FallbackOptions {
  /** Метки источников для каждого шага (по умолчанию: 'primary', 'fallback1', ...) */
  labels?: readonly string[];
  /**
   * Когда переходить к следующему источнику.
   * По умолчанию — любая ошибка, кроме CircuitOpenError:
   * открытая цепь означает «не трогать», цепочку останавливаем сразу.
   */
  shouldFallback?: (error: unknown) => boolean;
  /** Колбэк перед переходом к следующему источнику */
  onFallback?: (from: string, to: string, error: unknown) => void;
}

export interface FallbackResult<T> {
  /** Значение от успешного источника */
  value: T;
  /** Метка (id) источника, который ответил */
  source: string;
  /** Сколько попыток сделано (1 = primary сразу) */
  attempts: number;
}

function defaultLabel(index: number): string {
  return index === 0 ? 'primary' : `fallback${index}`;
}

/**
 * Последовательный вызов primary → fallback1 → fallback2 ...
 * Переход к следующему при ошибке (если shouldFallback разрешает).
 * Возвращает { value, source, attempts }.
 */
export async function withFallback<T>(
  primary: () => Promise<T> | T,
  fallbacks: readonly (() => Promise<T> | T)[] = [],
  options: FallbackOptions = {},
): Promise<FallbackResult<T>> {
  const steps = [primary, ...fallbacks];
  const shouldFallback =
    options.shouldFallback ?? ((error: unknown) => !isCircuitOpenError(error));

  for (let i = 0; i < steps.length; i++) {
    try {
      const value = await steps[i]!();
      return {
        value,
        source: options.labels?.[i] ?? defaultLabel(i),
        attempts: i + 1,
      };
    } catch (error) {
      const isLast = i === steps.length - 1;
      if (isLast || !shouldFallback(error)) {
        throw error;
      }
      options.onFallback?.(
        options.labels?.[i] ?? defaultLabel(i),
        options.labels?.[i + 1] ?? defaultLabel(i + 1),
        error,
      );
    }
  }

  // Недостижимо: на последнем шаге всегда выбрасываем ошибку
  throw new Error('withFallback: unreachable');
}
