/**
 * Agent Testing — фреймворк для тестирования агентов pipeline.
 *
 * Чистые функции БЕЗ импортов vitest: используют throws/returns, поэтому
 * работают в любом тестовом фреймворке (vitest, jest, node:test) и в
 * продакшен-диагностике. Опциональный `reporter` позволяет наблюдать за
 * прогоном без жёсткой привязки к конкретному раннеру.
 */

import type { AgentResult } from './types.js';

// ──────────────────────────────────────────────
// 1. Контракт агента для harness
// ──────────────────────────────────────────────

/**
 * Минимальный контракт агента для harness. Структурно совместим с
 * `IAgent`/`AgentBase` и с самостоятельными агентами, реализующими
 * `execute()` (SchedulerAgent и др.).
 */
export interface AgentHarnessTarget<Input = unknown, Output = unknown> {
  readonly name: string;
  execute(input: Input): Promise<AgentResult<Output>>;
}

// ──────────────────────────────────────────────
// 2. Ошибки harness
// ──────────────────────────────────────────────

/** Ошибка таймаута выполнения агента (createAgentHarness timeoutMs). */
export class AgentHarnessTimeoutError extends Error {
  public readonly agentName: string;
  public readonly timeoutMs: number;

  constructor(agentName: string, timeoutMs: number) {
    super(`Agent ${agentName} не завершился за ${timeoutMs} мс`);
    this.name = 'AgentHarnessTimeoutError';
    this.agentName = agentName;
    this.timeoutMs = timeoutMs;
  }
}

/** Ошибка невыполненного ожидания (expectOk / expectError). */
export class AgentHarnessAssertionError extends Error {
  public readonly agentName: string;
  public readonly input: unknown;
  public readonly result: AgentResult | null;

  constructor(
    message: string,
    agentName: string,
    input: unknown,
    result: AgentResult | null,
  ) {
    super(message);
    this.name = 'AgentHarnessAssertionError';
    this.agentName = agentName;
    this.input = input;
    this.result = result;
  }
}

// ──────────────────────────────────────────────
// 3. Опции и события
// ──────────────────────────────────────────────

/** Опции harness */
export interface AgentHarnessOptions {
  /** Таймаут выполнения в мс (по умолчанию 10 000; <=0 — без таймаута) */
  timeoutMs?: number;
  /** Опциональный репортёр событий (логирование/DI) */
  reporter?: (event: AgentHarnessEvent) => void;
}

/** События harness для репортёра */
export type AgentHarnessEvent =
  | { type: 'run'; agentName: string; input: unknown; startedAt: number }
  | {
      type: 'complete';
      agentName: string;
      result: AgentResult;
      durationMs: number;
    }
  | { type: 'timeout'; agentName: string; timeoutMs: number };

// ──────────────────────────────────────────────
// 4. Harness
// ──────────────────────────────────────────────

/**
 * Типизированная обёртка над агентом для тестов.
 *
 * - `run` — выполнить и вернуть `AgentResult` как есть;
 * - `expectOk` — выполнить и бросить `AgentHarnessAssertionError`, если
 *   результат неуспешен; дополнительно применяет `check(result)`;
 * - `expectError` — выполнить и бросить `AgentHarnessAssertionError`, если
 *   агент вернул успех; при `messagePart` дополнительно проверяет вхождение
 *   подстроки в текст ошибки.
 */
export interface AgentHarness<Input = unknown, Output = unknown> {
  readonly agentName: string;
  run(input: Input): Promise<AgentResult<Output>>;
  expectOk(
    input: Input,
    check?: (result: AgentResult<Output>) => void | Promise<void>,
  ): Promise<AgentResult<Output>>;
  expectError(input: Input, messagePart?: string): Promise<AgentResult<Output>>;
}

/**
 * Создать harness для агента.
 *
 * @param agent — целевой агент (execute + name);
 * @param options — таймаут и опциональный репортёр.
 */
export async function createAgentHarness<Input = unknown, Output = unknown>(
  agent: AgentHarnessTarget<Input, Output>,
  options?: AgentHarnessOptions,
): Promise<AgentHarness<Input, Output>> {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const reporter = options?.reporter;

  async function runWithTimeout(input: Input): Promise<AgentResult<Output>> {
    const startedAt = Date.now();
    reporter?.({ type: 'run', agentName: agent.name, input, startedAt });

    if (timeoutMs <= 0) {
      const result = await agent.execute(input);
      reporter?.({
        type: 'complete',
        agentName: agent.name,
        result,
        durationMs: Date.now() - startedAt,
      });
      return result;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race<AgentResult<Output>>([
        agent.execute(input),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reporter?.({ type: 'timeout', agentName: agent.name, timeoutMs });
            reject(new AgentHarnessTimeoutError(agent.name, timeoutMs));
          }, timeoutMs);
        }),
      ]);
      reporter?.({
        type: 'complete',
        agentName: agent.name,
        result,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  return {
    agentName: agent.name,

    run: runWithTimeout,

    async expectOk(input, check) {
      const result = await runWithTimeout(input);
      if (!result.success) {
        throw new AgentHarnessAssertionError(
          `Ожидался успех, но агент вернул ошибку: ${
            result.error?.message ?? 'без сообщения'
          }`,
          agent.name,
          input,
          result,
        );
      }
      if (check) {
        await check(result);
      }
      return result;
    },

    async expectError(input, messagePart) {
      const result = await runWithTimeout(input);
      if (result.success) {
        throw new AgentHarnessAssertionError(
          'Ожидалась ошибка, но агент вернул успех',
          agent.name,
          input,
          result,
        );
      }
      const message = result.error?.message ?? '';
      if (messagePart !== undefined && !message.includes(messagePart)) {
        throw new AgentHarnessAssertionError(
          `Сообщение ошибки не содержит "${messagePart}": "${message}"`,
          agent.name,
          input,
          result,
        );
      }
      return result;
    },
  };
}

// ──────────────────────────────────────────────
// 5. Прогон набора примеров
// ──────────────────────────────────────────────

/** Один пример для collectExamples */
export interface AgentExample<Input = unknown> {
  /** Имя примера (для отчёта) */
  name: string;
  /** Входные данные */
  input: Input;
  /** Ожидаемый исход (по умолчанию 'ok') */
  expect?: 'ok' | 'error';
  /** Проверка результата (применяется при expect: 'ok') */
  check?: (result: AgentResult) => void | Promise<void>;
}

/** Отчёт о прогоне набора примеров */
export interface AgentExamplesReport {
  total: number;
  passed: number;
  failed: Array<{ name: string; error: Error }>;
}

/**
 * Прогнать набор примеров через harness и вернуть отчёт.
 * Ошибки отдельных примеров НЕ роняют прогон — они собираются в `failed`.
 */
export async function collectExamples<Input = unknown, Output = unknown>(
  agent: AgentHarnessTarget<Input, Output>,
  examples: readonly AgentExample<Input>[],
  options?: AgentHarnessOptions,
): Promise<AgentExamplesReport> {
  const harness = await createAgentHarness(agent, options);
  const failed: AgentExamplesReport['failed'] = [];

  for (const example of examples) {
    try {
      if (example.expect === 'error') {
        await harness.expectError(example.input);
      } else {
        await harness.expectOk(example.input, example.check);
      }
    } catch (err) {
      failed.push({
        name: example.name,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  return {
    total: examples.length,
    passed: examples.length - failed.length,
    failed,
  };
}

// ──────────────────────────────────────────────
// 6. Мок агента
// ──────────────────────────────────────────────

/** Опции mockAgentLike */
export interface MockAgentOptions {
  /** Имя мок-агента (по умолчанию 'MockAgent') */
  name?: string;
  /** Вернуть неуспешный результат (по умолчанию false) */
  fail?: boolean;
  /** Ошибка для result.error (по умолчанию — намеренная generic-ошибка) */
  error?: Error;
}

/**
 * Создать типизированный мок агента, возвращающий заданный `output`.
 * Удобно для тестов, где нужен фейковый агент (например, DI-зависимость).
 */
export function mockAgentLike<Output = unknown>(
  output: Output,
  options?: MockAgentOptions,
): AgentHarnessTarget<unknown, Output> {
  const name = options?.name ?? 'MockAgent';
  const fail = options?.fail ?? false;
  const error = options?.error ?? new Error('MockAgent: намеренная ошибка');

  return {
    name,
    async execute(): Promise<AgentResult<Output>> {
      return {
        success: !fail,
        data: fail ? undefined : output,
        error: fail ? error : undefined,
        durationMs: 0,
        completedAt: new Date().toISOString(),
      };
    },
  };
}
