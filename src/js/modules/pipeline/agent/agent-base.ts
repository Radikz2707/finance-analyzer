import type {
  AgentConfig,
  AgentState,
  AgentResult,
  AgentSummary,
  IAgent,
} from './types.js';

/**
 * Базовый класс для всех агентов конвейера.
 *
 * Предоставляет:
 * - Управление состоянием (idle/running/paused/error/stopped)
 * - Таймер выполнения
 * - Retry-логику с exponential backoff
 * - Логирование
 * - Graceful shutdown
 *
 * Подклассы реализуют только execute() с конкретной бизнес-логикой.
 */
export abstract class AgentBase implements IAgent {
  public readonly name: string;
  private _state: AgentState = 'idle';
  protected readonly timeoutMs: number;
  protected readonly retries: number;
  protected readonly retryDelayMs: number;
  protected readonly verbose: boolean;

  // Статистика — публичные для тестирования
  public totalExecutions = 0;
  public totalSuccesses = 0;
  public totalFailures = 0;
  protected lastResult: AgentResult | null = null;

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.timeoutMs = config.timeoutMs ?? 0;
    this.retries = config.retries ?? 0;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    this.verbose = config.verbose ?? false;
  }

  get state(): AgentState {
    return this._state;
  }

  /**
   * Абстрактный метод — подклассы реализуют бизнес-логику.
   */
  protected abstract executeInternal(input: unknown): Promise<unknown>;

  /**
   * Публичный execute() с таймером, retry и error handling.
   */
  async execute(input: unknown): Promise<AgentResult> {
    if (this._state === 'stopped' || this._state === 'paused') {
      const errorResult = new Error(`Agent ${this.name} is ${this._state}`);
      return this.makeResult(false, errorResult, 0, '');
    }

    this._state = 'running';
    this.totalExecutions++;
    const startTime = Date.now();
    const startedAt = new Date().toISOString();

    if (this.verbose) {
      console.log(`[AGENT:${this.name}] Запуск (попытка 1/${this.retries + 1})`);
    }

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.retries + 1; attempt++) {
      // Проверка таймаута
      if (this.timeoutMs > 0) {
        const elapsed = Date.now() - startTime;
        if (elapsed > this.timeoutMs) {
          this._state = 'error';
          return this.makeResult(
            false,
            new Error(`Agent ${this.name} timed out after ${this.timeoutMs}ms`),
            startTime,
            startedAt,
          );
        }
      }

      try {
        const data = await this.executeInternal(input);
        const durationMs = Date.now() - startTime;
        this.lastResult = this.makeResult(true, data, startTime, startedAt);
        this._state = 'idle';
        this.totalSuccesses++;

        if (this.verbose) {
          console.log(`[AGENT:${this.name}] Успех за ${durationMs}ms`);
        }

        return this.lastResult;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt <= this.retries) {
          const delay = this.retryDelayMs * attempt; // exponential backoff
          if (this.verbose) {
            console.log(
              `[AGENT:${this.name}] Ошибка (попытка ${attempt}/${this.retries + 1}): ${lastError.message}. ` +
              `Повтор через ${delay}ms...`,
            );
          }
          await this.sleep(delay);
        }
      }
    }

    // Все попытки исчерпаны
    this._state = 'error';
    this.totalFailures++;
    this.lastResult = this.makeResult(false, lastError, startTime, '');

    if (this.verbose) {
      console.error(`[AGENT:${this.name}] Все ${this.retries + 1} попыток исчерпаны: ${lastError?.message}`);
    }

    return this.lastResult;
  }

  /** Graceful shutdown */
  async stop(): Promise<void> {
    if (this._state === 'stopped') return;
    this._state = 'stopped';
    if (this.verbose) {
      console.log(`[AGENT:${this.name}] Остановлен`);
    }
  }

  /** Получить сводку */
  getSummary(): AgentSummary {
    return {
      name: this.name,
      state: this._state,
      lastExecution: this.lastResult
        ? {
            startedAt: this.lastResult.completedAt,
            completedAt: this.lastResult.completedAt,
            durationMs: this.lastResult.durationMs,
            success: this.lastResult.success,
            error: this.lastResult.error?.message,
          }
        : undefined,
      totalExecutions: this.totalExecutions,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
    };
  }

  // ── Helpers ──

  private makeResult(
    success: boolean,
    dataOrError: unknown,
    startTime: number,
    _startedAt: string,
  ): AgentResult {
    return {
      success,
      data: success ? (dataOrError as unknown) : undefined,
      error: success ? undefined : (dataOrError as Error),
      durationMs: Date.now() - startTime,
      completedAt: new Date().toISOString(),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
