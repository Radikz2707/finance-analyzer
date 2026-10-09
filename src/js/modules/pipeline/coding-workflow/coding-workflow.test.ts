/**
 * CodingWorkflow — тесты конвейера разработки кода.
 *
 * Покрытие:
 * - полный успешный прогон: write → test (exit 0) → report;
 * - провал проверки → analyze → repair (запись файла) → retest → успех;
 * - провал без ремонта (repairExecutor null) → честный отказ;
 * - падение записи файла → честный отчёт;
 * - валидация входа (пустые files/task, отсутствие content);
 * - repair командой.
 *
 * ВАЖНО: импорт { describe, it, expect } из 'vitest' НЕ используется —
 * он создаёт второй экземпляр @vitest/runner и ломает контекст тестов
 * (TypeError: Cannot read properties of undefined (reading 'config')).
 * Все тесты используют глобалы (globals: true).
 */

import { CodingWorkflow } from './coding-workflow.js';
import type { CodingWorkflowInput } from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Мок FileAgent/TerminalAgent (AgentResult-совместимый) */
interface MockAgent {
  calls: Array<Record<string, unknown>>;
  respond: (input: Record<string, unknown>) => {
    success: boolean;
    data?: Record<string, unknown>;
    error?: Error;
  };
  execute(input: unknown): Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    error?: Error;
  }>;
}

function makeMockAgent(respond: MockAgent['respond']): MockAgent {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    respond,
    async execute(input: unknown) {
      const typed = input as Record<string, unknown>;
      calls.push(typed);
      return respond(typed);
    },
  } as MockAgent;
}

function makeTerminalData(
  exitCode: number,
  stderr = '',
): Record<string, unknown> {
  return {
    command: 'npm run test',
    stdout: '',
    stderr,
    exitCode,
    durationMs: 1,
    truncated: false,
  };
}

function makeInput(
  overrides: Partial<CodingWorkflowInput> = {},
): CodingWorkflowInput {
  return {
    task: 'Добавить функцию суммирования',
    files: [{ path: 'src/sum.ts', content: 'export const sum = 1;' }],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('CodingWorkflow', () => {
  it('1. Полный успешный прогон: write → test (exit 0) → report', async () => {
    const file = makeMockAgent(() => ({ success: true, data: {} }));
    const terminal = makeMockAgent(() => ({
      success: true,
      data: makeTerminalData(0),
    }));
    const workflow = new CodingWorkflow(
      { name: 'CodingWorkflow' },
      { fileAgent: file as never, terminalAgent: terminal as never },
    );

    const result = await workflow.execute(makeInput());

    expect(result.success).toBe(true);
    const output = result.data as {
      testPassed: boolean;
      filesWritten: string[];
    };
    expect(output.testPassed).toBe(true);
    expect(output.filesWritten).toEqual(['src/sum.ts']);
    const steps = (result.data as { steps: Array<{ step: string }> }).steps;
    expect(steps.map((step) => step.step)).toEqual(['write', 'test', 'report']);
    // Файл записан с нужным контентом
    expect(file.calls[0]).toEqual({
      action: 'write',
      path: 'src/sum.ts',
      content: 'export const sum = 1;',
    });
  });

  it('2. Провал проверки → repair записывает файл → retest проходит', async () => {
    const file = makeMockAgent(() => ({ success: true, data: {} }));
    let attempt = 0;
    const terminal = makeMockAgent(() => {
      attempt += 1;
      return attempt <= 1
        ? {
            success: true,
            data: makeTerminalData(1, 'FAIL src/sum.ts: expected 2 to be 3'),
          }
        : { success: true, data: makeTerminalData(0) };
    });
    const workflow = new CodingWorkflow(
      { name: 'CodingWorkflow' },
      {
        fileAgent: file as never,
        terminalAgent: terminal as never,
        repairExecutor: (context) => ({
          type: 'write',
          file: {
            path: 'src/sum.ts',
            content: `// fix attempt ${context.attempt}\nexport const sum = 3;`,
          },
          note: 'исправлена константа',
        }),
      },
    );

    const result = await workflow.execute(makeInput());

    expect(result.success).toBe(true);
    const output = result.data as {
      testPassed: boolean;
      repairIterations: number;
      steps: Array<{ step: string; success: boolean }>;
    };
    expect(output.testPassed).toBe(true);
    expect(output.repairIterations).toBe(1);
    expect(output.steps.map((step) => step.step)).toEqual([
      'write',
      'test',
      'analyze',
      'repair',
      'retest',
      'report',
    ]);
    // Repair записал исправленный файл
    expect(file.calls[1]).toEqual({
      action: 'write',
      path: 'src/sum.ts',
      content: '// fix attempt 1\nexport const sum = 3;',
    });
  });

  it('3. Провал без ремонта (repairExecutor null) → честный отказ', async () => {
    const terminal = makeMockAgent(() => ({
      success: true,
      data: makeTerminalData(1, 'some error'),
    }));
    const workflow = new CodingWorkflow(
      { name: 'CodingWorkflow' },
      {
        fileAgent: makeMockAgent(() => ({ success: true, data: {} })) as never,
        terminalAgent: terminal as never,
      },
    );

    const result = await workflow.execute(makeInput());

    // AgentResult.success=true (конвейер не упал), но работа не сделана:
    // output.success=false — работоспособность не достигнута
    const output = result.data as {
      success: boolean;
      testPassed: boolean;
      message: string;
      steps: Array<{ step: string; message: string }>;
    };
    expect(output.success).toBe(false);
    expect(output.testPassed).toBe(false);
    expect(output.message).toContain('внимание человека');
    const repair = output.steps.find((step) => step.step === 'repair');
    expect(repair!.message).toContain('не предложил исправление');
  });

  it('4. Падение записи файла → честный отчёт без проверки', async () => {
    const file = makeMockAgent(() => ({
      success: false,
      error: new Error('путь вне разрешённых корней'),
    }));
    const terminal = makeMockAgent(() => ({
      success: true,
      data: makeTerminalData(0),
    }));
    const workflow = new CodingWorkflow(
      { name: 'CodingWorkflow' },
      { fileAgent: file as never, terminalAgent: terminal as never },
    );

    const result = await workflow.execute(makeInput());

    const output = result.data as {
      success: boolean;
      steps: Array<{ step: string }>;
    };
    expect(output.success).toBe(false);
    expect(output.steps.map((step) => step.step)).toEqual(['write', 'report']);
    // Терминал не вызывался — проверка не запускалась
    expect(terminal.calls.length).toBe(0);
  });

  it('5. Ремонт командой (тип command)', async () => {
    const terminal = makeMockAgent((input) => {
      // npm test падает (missing dep), npm install проходит
      const args = (input as { args?: string[] }).args ?? [];
      return args.includes('install')
        ? { success: true, data: makeTerminalData(0) }
        : { success: true, data: makeTerminalData(1, 'missing dep') };
    });
    const workflow = new CodingWorkflow(
      { name: 'CodingWorkflow' },
      {
        fileAgent: makeMockAgent(() => ({ success: true, data: {} })) as never,
        terminalAgent: terminal as never,
        maxRepairIterations: 1,
        repairExecutor: () => ({
          type: 'command',
          command: 'npm',
          args: ['install', 'lodash'],
          note: 'установлена зависимость',
        }),
      },
    );

    const result = await workflow.execute(makeInput());

    expect(result.success).toBe(true);
    const output = result.data as { repairIterations: number };
    expect(output.repairIterations).toBe(1);
    // Второй вызов терминала — команда ремонта
    expect(terminal.calls[1]).toEqual({
      command: 'npm',
      args: ['install', 'lodash'],
    });
  });

  it('6. Честные ошибки валидации входа (AgentResult.success=false с ошибкой)', async () => {
    const workflow = new CodingWorkflow(
      { name: 'CodingWorkflow' },
      {
        fileAgent: makeMockAgent(() => ({ success: true, data: {} })) as never,
        terminalAgent: makeMockAgent(() => ({
          success: true,
          data: makeTerminalData(0),
        })) as never,
      },
    );

    // AgentBase.execute перехватывает CodingWorkflowError →
    // success=false, error с честным сообщением
    const emptyFiles = await workflow.execute(makeInput({ files: [] }));
    expect(emptyFiles.success).toBe(false);
    expect((emptyFiles.error as Error).message).toContain('список файлов пуст');

    const emptyTask = await workflow.execute(makeInput({ task: '' }));
    expect(emptyTask.success).toBe(false);
    expect((emptyTask.error as Error).message).toContain('задачи (task)');

    const emptyPath = await workflow.execute(
      makeInput({ files: [{ path: '', content: 'x' }] }),
    );
    expect(emptyPath.success).toBe(false);
    expect((emptyPath.error as Error).message).toContain('не указан путь');
  });
});
