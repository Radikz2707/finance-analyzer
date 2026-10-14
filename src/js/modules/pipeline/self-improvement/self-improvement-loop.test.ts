/**
 * SelfImprovementLoop — тесты замкнутого цикла самоулучшения.
 *
 * Покрытие:
 * - health/diagnose: только диагностика AutoRepairAgent → отчёт;
 * - improve: diagnose → plan → execute → verify → learn → report;
 * - security-gate: allow выполняет шаг, deny блокирует,
 *   require-confirmation блокирует без подтверждения и выполняет с ним;
 * - file-шаг с source: чтение источника перед записью;
 * - code-шаг с файлами → CodingWorkflow; без файлов → ревью (verify);
 * - learn: FeedbackLoop (track-decision → record-outcome) + LearningAgent.feedback;
 * - buildResultMessage.
 *
 * Все зависимости — DI-моки (без реальных FS/сети/процессов).
 */

import {
  SelfImprovementLoop,
  buildResultMessage,
} from './self-improvement-loop.js';
import { RepairPlanner } from './repair-planner.js';
import type {
  AutoRepairOutput,
  HealthCheckResult,
} from '../agents/auto-repair-agent.js';
import type { Lesson } from '../agents/learning-agent.js';
import type { SecurityDecision } from '../agents/security-agent.js';
import type { TerminalAgentOutput } from '../agents/terminal-agent.js';
import type { ImprovementResult } from './types.js';

// ─── Хелперы ────────────────────────────────────────────────────────────

function makeDiagnosis(checks: HealthCheckResult[]): AutoRepairOutput {
  const overall = checks.some((c) => c.severity === 'error')
    ? 'critical'
    : checks.some((c) => c.severity === 'warning')
      ? 'warnings'
      : 'ok';
  return {
    action: 'diagnose',
    scope: 'project',
    checks,
    overall,
    appliedFixes: [],
    blockedFixes: [],
    message: 'диагностика',
  };
}

function makeTerminalOutput(exitCode: number): TerminalAgentOutput {
  return {
    command: 'npm run test',
    stdout: '',
    stderr: '',
    exitCode,
    durationMs: 10,
    truncated: false,
  };
}

function makeDecision(
  verdict: SecurityDecision['verdict'],
  extra?: Partial<SecurityDecision>,
): SecurityDecision {
  return {
    id: 'd1',
    timestamp: '2026-01-01T00:00:00.000Z',
    request: { kind: 'terminal' },
    verdict,
    matchedRules: [],
    ...extra,
  };
}

function makeLesson(): Lesson {
  return {
    id: 'l1',
    pattern: 'self-improve:good',
    action: 'self-improve',
    outcome: 'good',
    weight: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    source: 'feedback',
    agent: 'SelfImprovementLoop',
  };
}

/** Собрать моки для цикла */
function makeMocks(overrides?: {
  diagnosis?: AutoRepairOutput;
  securityVerdict?: SecurityDecision['verdict'];
  verifyExitCode?: number;
  confirmResult?: boolean;
}) {
  const diagnosis = overrides?.diagnosis ?? makeDiagnosis([]);
  const autoRepair = {
    execute: vi.fn().mockResolvedValue({ success: true, data: diagnosis }),
  };
  const learningAgent = {
    analyze: vi.fn().mockResolvedValue({ lessons: [] }),
    feedback: vi.fn().mockResolvedValue(makeLesson()),
  };
  const feedbackLoop = {
    execute: vi.fn().mockImplementation((action: string) => {
      if (action === 'analyze') {
        // Нет данных анализа — честный отказ (метрики = null).
        return Promise.resolve({ success: false, error: 'no data' });
      }
      return Promise.resolve({ success: true, data: {} });
    }),
  };
  const security = {
    check: vi
      .fn()
      .mockResolvedValue(makeDecision(overrides?.securityVerdict ?? 'allow')),
  };
  const terminalAgent = {
    execute: vi.fn().mockResolvedValue({
      success: true,
      data: makeTerminalOutput(overrides?.verifyExitCode ?? 0),
    }),
  };
  const fileAgent = {
    execute: vi.fn().mockResolvedValue({
      success: true,
      data: { action: 'write', path: 'x', success: true, message: 'ok' },
    }),
  };
  const codingWorkflow = {
    execute: vi.fn().mockResolvedValue({
      success: true,
      data: {
        success: true,
        message: 'ok',
        testPassed: true,
        repairIterations: 1,
        filesWritten: ['src/x.ts'],
        steps: [],
      },
    }),
  };
  const loop = new SelfImprovementLoop(
    { name: 'SelfImprovementLoop' },
    {
      autoRepair,
      planner: new RepairPlanner(),
      learningAgent,
      feedbackLoop,
      security,
      terminalAgent,
      fileAgent,
      codingWorkflow,
      confirm: () => overrides?.confirmResult ?? false,
    },
  );
  return {
    loop,
    autoRepair,
    learningAgent,
    feedbackLoop,
    security,
    terminalAgent,
    fileAgent,
    codingWorkflow,
  };
}

// ─── health / diagnose ──────────────────────────────────────────────────

describe('self-improvement-loop: health / diagnose', () => {
  it('health → только диагностика AutoRepairAgent (без изменений)', async () => {
    const { loop, autoRepair } = makeMocks();
    const result = await loop.execute({ action: 'health' });
    expect(result.success).toBe(true);
    const output = result.data as { kind: 'health'; value: AutoRepairOutput };
    expect(output.kind).toBe('health');
    expect(output.value.overall).toBe('ok');
    expect(autoRepair.execute).toHaveBeenCalledWith({
      action: 'diagnose',
      scope: 'project',
      autoFix: false,
    });
  });

  it('diagnose → отчёт диагностики', async () => {
    const { loop } = makeMocks();
    const result = await loop.execute({ action: 'diagnose' });
    const output = result.data as { kind: 'diagnose'; value: AutoRepairOutput };
    expect(output.kind).toBe('diagnose');
  });

  it('неизвестное действие → честная ошибка', async () => {
    const { loop } = makeMocks();
    const result = await loop.execute({ action: 'unknown' as never });
    expect(result.success).toBe(false);
  });
});

// ─── improve: полный цикл ───────────────────────────────────────────────

describe('self-improvement-loop: improve (полный цикл)', () => {
  it('нет проблем → план без шагов, verify проходит, урок сохраняется', async () => {
    const { loop, feedbackLoop, learningAgent, terminalAgent } = makeMocks();
    const result = await loop.execute({
      action: 'improve',
      goal: 'Почини проект',
    });
    expect(result.success).toBe(true);
    const output = result.data as { kind: 'improve'; value: ImprovementResult };
    expect(output.kind).toBe('improve');
    expect(output.value.plan.steps).toHaveLength(0);
    expect(output.value.testPassed).toBe(true);
    expect(output.value.success).toBe(true);
    // verify: security + terminal
    expect(terminalAgent.execute).toHaveBeenCalled();
    // learn: FeedbackLoop (track-decision → record-outcome) + LearningAgent
    expect(feedbackLoop.execute).toHaveBeenCalledWith(
      'track-decision',
      expect.objectContaining({ category: 'self-improvement' }),
    );
    expect(feedbackLoop.execute).toHaveBeenCalledWith(
      'record-outcome',
      expect.objectContaining({ outcome: 'positive' }),
    );
    expect(learningAgent.feedback).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'self-improve', outcome: 'good' }),
    );
    expect(output.value.lessons).toContain('self-improve:good');
  });

  it('terminal-шаг: allow → выполняется, verify проходит', async () => {
    const diagnosis = makeDiagnosis([
      {
        id: 'deps.node-modules',
        severity: 'warning',
        title: 'node_modules отсутствует',
        fixable: true,
        fix: {
          kind: 'terminal',
          command: 'npm',
          args: ['install'],
          description: 'npm install',
        },
      },
    ]);
    const { loop, terminalAgent, security } = makeMocks({ diagnosis });
    const result = await loop.execute({ action: 'improve' });
    const output = result.data as { kind: 'improve'; value: ImprovementResult };
    expect(output.value.executedSteps).toBe(1);
    expect(output.value.blockedSteps).toHaveLength(0);
    expect(output.value.success).toBe(true);
    // шаг npm install + финальная проверка
    expect(terminalAgent.execute).toHaveBeenCalledWith({
      command: 'npm',
      args: ['install'],
    });
    expect(security.check).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'terminal', command: 'npm' }),
    );
  });

  it('deny → шаг блокируется, success=false', async () => {
    const diagnosis = makeDiagnosis([
      {
        id: 'deps.node-modules',
        severity: 'warning',
        title: 'node_modules отсутствует',
        fixable: true,
        fix: {
          kind: 'terminal',
          command: 'npm',
          args: ['install'],
          description: 'npm install',
        },
      },
    ]);
    const { loop } = makeMocks({ diagnosis, securityVerdict: 'deny' });
    const result = await loop.execute({ action: 'improve' });
    const output = result.data as { kind: 'improve'; value: ImprovementResult };
    expect(output.value.executedSteps).toBe(0);
    expect(output.value.blockedSteps).toHaveLength(1);
    expect(output.value.success).toBe(false);
  });

  it('require-confirmation без подтверждения → шаг блокируется', async () => {
    const diagnosis = makeDiagnosis([
      {
        id: 'deps.node-modules',
        severity: 'warning',
        title: 'node_modules отсутствует',
        fixable: true,
        fix: {
          kind: 'terminal',
          command: 'npm',
          args: ['install'],
          description: 'npm install',
        },
      },
    ]);
    const { loop } = makeMocks({
      diagnosis,
      securityVerdict: 'require-confirmation',
      confirmResult: false,
    });
    const result = await loop.execute({ action: 'improve' });
    const output = result.data as { kind: 'improve'; value: ImprovementResult };
    expect(output.value.blockedSteps).toHaveLength(1);
    expect(output.value.success).toBe(false);
  });

  it('require-confirmation с подтверждением → шаг выполняется', async () => {
    const diagnosis = makeDiagnosis([
      {
        id: 'deps.node-modules',
        severity: 'warning',
        title: 'node_modules отсутствует',
        fixable: true,
        fix: {
          kind: 'terminal',
          command: 'npm',
          args: ['install'],
          description: 'npm install',
        },
      },
    ]);
    const { loop } = makeMocks({
      diagnosis,
      securityVerdict: 'require-confirmation',
      confirmResult: true,
    });
    const result = await loop.execute({ action: 'improve' });
    const output = result.data as { kind: 'improve'; value: ImprovementResult };
    expect(output.value.executedSteps).toBe(1);
    expect(output.value.blockedSteps).toHaveLength(0);
  });

  it('file-шаг с source: читает источник, затем пишет цель', async () => {
    const diagnosis = makeDiagnosis([
      {
        id: 'configs.env-file',
        severity: 'warning',
        title: '.env отсутствует',
        fixable: true,
        fix: {
          kind: 'file-copy',
          source: '.env.template',
          target: '.env',
          description: 'Восстановить .env из .env.template',
        },
      },
    ]);
    const { loop, fileAgent } = makeMocks({ diagnosis });
    fileAgent.execute.mockImplementation(async (input: { action?: string }) => {
      if (input.action === 'read') {
        return { success: true, data: { content: 'SECRET=1' } };
      }
      return {
        success: true,
        data: { action: 'write', path: '.env', success: true, message: 'ok' },
      };
    });
    const result = await loop.execute({ action: 'improve' });
    const output = result.data as { kind: 'improve'; value: ImprovementResult };
    expect(output.value.executedSteps).toBe(1);
    expect(fileAgent.execute).toHaveBeenCalledWith({
      action: 'read',
      path: '.env.template',
    });
    expect(fileAgent.execute).toHaveBeenCalledWith({
      action: 'write',
      path: '.env',
      content: 'SECRET=1',
    });
  });

  it('code-шаг с файлами → CodingWorkflow', async () => {
    const diagnosis = makeDiagnosis([]);
    makeMocks({ diagnosis });
    // План с code-шагом: урок bad → code-шаг (без файлов) — проверим ревью-ветку отдельно.
    // Здесь подменяем планировщик, чтобы получить code-шаг С файлами.
    const codingWorkflow = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          success: true,
          message: 'ok',
          testPassed: true,
          repairIterations: 2,
          filesWritten: ['src/x.test.ts'],
          steps: [],
        },
      }),
    };
    const loopWithCode = new SelfImprovementLoop(
      { name: 'SelfImprovementLoop' },
      {
        autoRepair: {
          execute: vi
            .fn()
            .mockResolvedValue({ success: true, data: diagnosis }),
        },
        planner: {
          buildPlan: () => ({
            id: 'p1',
            goal: 'Добавить тесты',
            diagnosis: 'диагностика',
            createdAt: '2026-01-01T00:00:00.000Z',
            expectedOutcome: 'тесты проходят',
            steps: [
              {
                role: 'code' as const,
                input: {
                  task: 'Добавить тесты',
                  files: [{ path: 'src/x.test.ts', content: 'test' }],
                },
                description: 'Добавить тесты',
              },
            ],
          }),
        },
        learningAgent: {
          analyze: vi.fn().mockResolvedValue({ lessons: [] }),
          feedback: vi.fn().mockResolvedValue(makeLesson()),
        },
        feedbackLoop: {
          execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
        },
        security: { check: vi.fn().mockResolvedValue(makeDecision('allow')) },
        terminalAgent: {
          execute: vi
            .fn()
            .mockResolvedValue({ success: true, data: makeTerminalOutput(0) }),
        },
        fileAgent: {
          execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
        },
        codingWorkflow,
      },
    );
    const result = await loopWithCode.execute({ action: 'improve' });
    const output = result.data as { kind: 'improve'; value: ImprovementResult };
    expect(output.value.executedSteps).toBe(1);
    expect(output.value.repairIterations).toBe(2);
    expect(codingWorkflow.execute).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'Добавить тесты' }),
    );
  });

  it('code-шаг без файлов (ревью) → проверка текущего состояния', async () => {
    const diagnosis = makeDiagnosis([]);
    makeMocks({ diagnosis });
    const terminalAgent = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: makeTerminalOutput(0),
      }),
    };
    const loopWithReview = new SelfImprovementLoop(
      { name: 'SelfImprovementLoop' },
      {
        autoRepair: {
          execute: vi
            .fn()
            .mockResolvedValue({ success: true, data: diagnosis }),
        },
        planner: {
          buildPlan: () => ({
            id: 'p1',
            goal: 'Пересмотреть подход',
            diagnosis: 'диагностика',
            createdAt: '2026-01-01T00:00:00.000Z',
            expectedOutcome: 'проверка проходит',
            steps: [
              {
                role: 'code' as const,
                input: { task: 'Пересмотреть подход к X', files: [] },
                description: 'Пересмотреть подход к X',
              },
            ],
          }),
        },
        learningAgent: {
          analyze: vi.fn().mockResolvedValue({ lessons: [] }),
          feedback: vi.fn().mockResolvedValue(makeLesson()),
        },
        feedbackLoop: {
          execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
        },
        security: { check: vi.fn().mockResolvedValue(makeDecision('allow')) },
        terminalAgent,
        fileAgent: {
          execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
        },
        codingWorkflow: { execute: vi.fn() },
      },
    );
    const result = await loopWithReview.execute({ action: 'improve' });
    const output = result.data as { kind: 'improve'; value: ImprovementResult };
    expect(output.value.executedSteps).toBe(1);
    // ревью-шаг не трогает CodingWorkflow, а запускает verify
    expect(terminalAgent.execute).toHaveBeenCalled();
  });

  it('verify провален → testPassed=false, урок bad', async () => {
    const { loop, learningAgent } = makeMocks({ verifyExitCode: 1 });
    const result = await loop.execute({ action: 'improve' });
    const output = result.data as { kind: 'improve'; value: ImprovementResult };
    expect(output.value.testPassed).toBe(false);
    expect(output.value.success).toBe(false);
    expect(learningAgent.feedback).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'bad' }),
    );
  });

  it('падение FeedbackLoop/LearningAgent не роняет цикл', async () => {
    makeMocks();
    const loopResilient = new SelfImprovementLoop(
      { name: 'SelfImprovementLoop' },
      {
        autoRepair: {
          execute: vi
            .fn()
            .mockResolvedValue({ success: true, data: makeDiagnosis([]) }),
        },
        planner: new RepairPlanner(),
        learningAgent: {
          analyze: vi.fn().mockRejectedValue(new Error('memory down')),
          feedback: vi.fn().mockRejectedValue(new Error('memory down')),
        },
        feedbackLoop: {
          execute: vi.fn().mockRejectedValue(new Error('loop down')),
        },
        security: { check: vi.fn().mockResolvedValue(makeDecision('allow')) },
        terminalAgent: {
          execute: vi
            .fn()
            .mockResolvedValue({ success: true, data: makeTerminalOutput(0) }),
        },
        fileAgent: {
          execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
        },
        codingWorkflow: { execute: vi.fn() },
      },
    );
    const result = await loopResilient.execute({ action: 'improve' });
    expect(result.success).toBe(true);
    const output = result.data as { kind: 'improve'; value: ImprovementResult };
    expect(output.value.success).toBe(true);
    expect(output.value.lessons).toHaveLength(0);
  });
});

// ─── buildResultMessage ─────────────────────────────────────────────────

describe('self-improvement-loop: buildResultMessage', () => {
  it('формирует сводку с целью, шагами и итогом', () => {
    const plan = {
      id: 'p1',
      goal: 'Починить проект',
      diagnosis: 'диагностика',
      createdAt: '2026-01-01T00:00:00.000Z',
      expectedOutcome: 'тесты проходят',
      steps: [],
    };
    const message = buildResultMessage(plan, true, 0, [], true);
    expect(message).toContain('Починить проект');
    expect(message).toContain('0/0');
    expect(message).toContain('пройдена');
    expect(message).toContain('успех');
  });

  it('упоминает заблокированные шаги', () => {
    const plan = {
      id: 'p1',
      goal: 'Починить проект',
      diagnosis: 'диагностика',
      createdAt: '2026-01-01T00:00:00.000Z',
      expectedOutcome: 'тесты проходят',
      steps: [],
    };
    const message = buildResultMessage(plan, true, 0, ['npm install'], false);
    expect(message).toContain('Заблокировано: 1');
    expect(message).toContain('требует внимания');
  });
});
