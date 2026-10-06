/**
 * Agent Testing Tests — фреймворк тестирования агентов.
 *
 * Проверяются: harness (run / expectOk / expectError), таймаут, репортёр,
 * collectExamples (отчёт без падения прогона) и mockAgentLike.
 */

import {
  AgentHarnessAssertionError,
  AgentHarnessTimeoutError,
  collectExamples,
  createAgentHarness,
  mockAgentLike,
} from './agent-testing.js';
import type { AgentHarnessTarget } from './agent-testing.js';
import type { AgentResult } from './types.js';

// ─── Заглушки ───────────────────────────────────────────────

/** Агент-заглушка: всегда успех с заданным output */
function okAgent(
  output: unknown,
  name = 'OkAgent',
): AgentHarnessTarget<unknown> {
  return {
    name,
    async execute(): Promise<AgentResult> {
      return {
        success: true,
        data: output,
        durationMs: 1,
        completedAt: new Date().toISOString(),
      };
    },
  };
}

/** Агент-заглушка: всегда ошибка */
function errorAgent(
  message: string,
  name = 'ErrAgent',
): AgentHarnessTarget<unknown> {
  return {
    name,
    async execute(): Promise<AgentResult> {
      return {
        success: false,
        error: new Error(message),
        durationMs: 1,
        completedAt: new Date().toISOString(),
      };
    },
  };
}

describe('createAgentHarness — run', () => {
  it('возвращает AgentResult как есть', async () => {
    const agent = okAgent({ ok: 1 });
    const harness = await createAgentHarness(agent);
    const result = await harness.run('input');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: 1 });
    expect(harness.agentName).toBe('OkAgent');
  });

  it('передаёт события репортёру', async () => {
    const events: string[] = [];
    const agent = okAgent(1, 'ReporterAgent');
    const harness = await createAgentHarness(agent, {
      reporter: (event) => events.push(event.type),
    });
    await harness.run('input');
    expect(events).toContain('run');
    expect(events).toContain('complete');
  });
});

describe('createAgentHarness — expectOk', () => {
  it('проходит при успехе и применяет check к результату', async () => {
    const agent = okAgent({ n: 42 });
    const harness = await createAgentHarness(agent);
    let checked: unknown;
    await harness.expectOk('input', (result) => {
      checked = result.data;
    });
    expect(checked).toEqual({ n: 42 });
  });

  it('бросает AgentHarnessAssertionError при ошибке агента', async () => {
    const agent = errorAgent('сломалось');
    const harness = await createAgentHarness(agent);
    await expect(harness.expectOk({})).rejects.toBeInstanceOf(
      AgentHarnessAssertionError,
    );
  });
});

describe('createAgentHarness — expectError', () => {
  it('проходит при неуспехе и проверяет messagePart', async () => {
    const agent = errorAgent('Команда не найдена');
    const harness = await createAgentHarness(agent);
    await harness.expectError('input', 'не найдена');
  });

  it('бросает при несовпадении messagePart', async () => {
    const agent = errorAgent('Другая ошибка');
    const harness = await createAgentHarness(agent);
    await expect(
      harness.expectError('input', 'не найдена'),
    ).rejects.toBeInstanceOf(AgentHarnessAssertionError);
  });

  it('бросает, если агент вернул успех', async () => {
    const agent = okAgent('ok');
    const harness = await createAgentHarness(agent);
    await expect(harness.expectError('input')).rejects.toBeInstanceOf(
      AgentHarnessAssertionError,
    );
  });
});

describe('createAgentHarness — таймаут', () => {
  it('бросает AgentHarnessTimeoutError при превышении timeoutMs', async () => {
    const slow: AgentHarnessTarget<unknown> = {
      name: 'SlowAgent',
      execute: () => new Promise<AgentResult>(() => {}),
    };
    const harness = await createAgentHarness(slow, { timeoutMs: 25 });
    await expect(harness.run('input')).rejects.toBeInstanceOf(
      AgentHarnessTimeoutError,
    );
  });
});

describe('collectExamples', () => {
  it('собирает отчёт и не роняет прогон на падении примера', async () => {
    const agent = okAgent('data', 'CollectAgent');
    const report = await collectExamples(agent, [
      { name: 'ok-1', input: 1 },
      {
        name: 'ok-with-check',
        input: 2,
        check: (result) => {
          expect(result.success).toBe(true);
        },
      },
      // Ожидание ошибки, но агент успешен → пример падает, прогон продолжается
      { name: 'expected-error', input: 3, expect: 'error' },
    ]);

    expect(report.total).toBe(3);
    expect(report.passed).toBe(2);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.name).toBe('expected-error');
    expect(report.failed[0]?.error).toBeInstanceOf(AgentHarnessAssertionError);
  });
});

describe('mockAgentLike', () => {
  it('возвращает типизированный мок с заданным output', async () => {
    const agent = mockAgentLike({ ok: 1 });
    const harness = await createAgentHarness(agent);
    const result = await harness.expectOk('any input');
    expect(result.data).toEqual({ ok: 1 });
  });

  it('fail: true возвращает неуспешный результат', async () => {
    const agent = mockAgentLike(null, {
      name: 'FailingMock',
      fail: true,
      error: new Error('намеренная ошибка'),
    });
    const harness = await createAgentHarness(agent);
    await harness.expectError('any input', 'намеренная ошибка');
  });
});
