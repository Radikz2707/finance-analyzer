/**
 * RepairPlanner — тесты планирования ремонта из диагностики AutoRepairAgent,
 * уроков LearningAgent и метрик FeedbackLoop.
 *
 * Покрытие:
 * - fixable-проверки диагностики → шаги terminal/file (все виды RepairFixKind);
 * - уроки с outcome 'bad' → code-шаги «пересмотреть подход»;
 * - слабые категории метрик → code-шаги «пересмотреть подход к категории»;
 * - пустая диагностика + нет уроков/метрик → план без шагов;
 * - дедупликация шагов по описанию;
 * - fixToStep: null для не-fixable проверок;
 * - summarizeDiagnosis.
 */

import {
  RepairPlanner,
  fixToStep,
  summarizeDiagnosis,
} from './repair-planner.js';
import type {
  AutoRepairOutput,
  HealthCheckResult,
} from '../agents/auto-repair-agent.js';
import type { Lesson } from '../agents/learning-agent.js';
import type { AnalysisResult } from '../feedback-loop/types.js';

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

function makeLesson(partial: Partial<Lesson>): Lesson {
  return {
    id: 'l1',
    pattern: 'terminal.execute:bad',
    action: 'terminal.execute',
    outcome: 'bad',
    weight: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    source: 'feedback',
    ...partial,
  };
}

function makeAnalysis(
  byCategory: Array<{
    category: string;
    winRate: number;
    implementedCount: number;
  }>,
): AnalysisResult {
  return {
    metrics: {
      totalDecisions: 0,
      totalOutcomes: 0,
      overallWinRate: 0,
      implementationRate: 0,
      avgConfidence: 0,
      avgSatisfaction: 0,
      avgRoi: 0,
      byCategory: byCategory.map((c) => ({
        category: c.category,
        totalDecisions: c.implementedCount,
        implementedCount: c.implementedCount,
        positiveCount: 0,
        negativeCount: 0,
        ignoredCount: 0,
        winRate: c.winRate,
        avgConfidence: 0,
        avgSatisfaction: 0,
        avgRoi: 0,
        avgActionDelayMs: 0,
      })),
      byTicker: {},
      byAgent: {},
      trend: [],
    },
    strengths: [],
    weaknesses: [],
    recommendations: [],
    warnings: [],
  };
}

// ─── fixToStep ──────────────────────────────────────────────────────────

describe('repair-planner: fixToStep', () => {
  it('terminal-фикс → terminal-шаг с командой и аргументами', () => {
    const check: HealthCheckResult = {
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
    };
    const step = fixToStep(check);
    expect(step?.role).toBe('terminal');
    expect(step?.input).toEqual({ command: 'npm', args: ['install'] });
    expect(step?.description).toBe('npm install');
  });

  it('git-checkout-фикс → terminal-шаг git checkout', () => {
    const check: HealthCheckResult = {
      id: 'integrity.required-path',
      severity: 'error',
      title: 'файл удалён',
      fixable: true,
      fix: {
        kind: 'git-checkout',
        target: 'src/js/app.ts',
        description: 'Восстановить src/js/app.ts из git',
      },
    };
    const step = fixToStep(check);
    expect(step?.role).toBe('terminal');
    expect(step?.input).toEqual({
      command: 'git',
      args: ['checkout', '--', 'src/js/app.ts'],
    });
  });

  it('file-recreate-фикс → file-шаг write с содержимым', () => {
    const check: HealthCheckResult = {
      id: 'configs.data-json',
      severity: 'error',
      title: 'невалидный JSON',
      fixable: true,
      fix: {
        kind: 'file-recreate',
        target: 'data/example.json',
        content: '{}',
        description: 'Пересоздать data/example.json',
      },
    };
    const step = fixToStep(check);
    expect(step?.role).toBe('file');
    expect(step?.input).toEqual({
      action: 'write',
      path: 'data/example.json',
      content: '{}',
    });
  });

  it('file-copy-фикс → file-шаг write с source (исполнитель читает источник)', () => {
    const check: HealthCheckResult = {
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
    };
    const step = fixToStep(check);
    expect(step?.role).toBe('file');
    expect(step?.input).toMatchObject({
      action: 'write',
      path: '.env',
      source: '.env.template',
    });
  });

  it('не-fixable проверка → null', () => {
    const check: HealthCheckResult = {
      id: 'configs.package-json',
      severity: 'error',
      title: 'невалидный package.json',
      fixable: false,
    };
    expect(fixToStep(check)).toBeNull();
  });
});

// ─── buildPlan ──────────────────────────────────────────────────────────

describe('repair-planner: buildPlan', () => {
  it('fixable-проверки диагностики → шаги плана', () => {
    const planner = new RepairPlanner();
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
    const plan = planner.buildPlan({ diagnosis });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.role).toBe('terminal');
    expect(plan.goal).toBe('Ремонт и улучшение проекта');
    expect(plan.diagnosis).toContain('Диагностика');
    expect(plan.expectedOutcome).toContain('1 шаг');
  });

  it('уроки с outcome bad → code-шаги «пересмотреть подход»', () => {
    const planner = new RepairPlanner();
    const plan = planner.buildPlan({
      diagnosis: makeDiagnosis([]),
      lessons: [
        makeLesson({ action: 'terminal.execute', note: 'опасная команда' }),
      ],
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.role).toBe('code');
    expect(plan.steps[0]?.description).toContain('terminal.execute');
  });

  it('слабые категории метрик → code-шаги «пересмотреть подход к категории»', () => {
    const planner = new RepairPlanner();
    const plan = planner.buildPlan({
      diagnosis: makeDiagnosis([]),
      metrics: makeAnalysis([
        { category: 'asset', winRate: 0.2, implementedCount: 5 },
      ]),
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.role).toBe('code');
    expect(plan.steps[0]?.description).toContain('asset');
  });

  it('сильные категории метрик не порождают шагов', () => {
    const planner = new RepairPlanner();
    const plan = planner.buildPlan({
      diagnosis: makeDiagnosis([]),
      metrics: makeAnalysis([
        { category: 'asset', winRate: 0.8, implementedCount: 5 },
      ]),
    });
    expect(plan.steps).toHaveLength(0);
  });

  it('пустая диагностика + нет уроков/метрик → план без шагов', () => {
    const planner = new RepairPlanner();
    const plan = planner.buildPlan({ diagnosis: makeDiagnosis([]) });
    expect(plan.steps).toHaveLength(0);
    expect(plan.expectedOutcome).toContain('Проблем не обнаружено');
  });

  it('дедупликация: одинаковые фиксы планируются один раз', () => {
    const planner = new RepairPlanner();
    const fix = {
      kind: 'terminal' as const,
      command: 'npm',
      args: ['install'],
      description: 'npm install',
    };
    const diagnosis = makeDiagnosis([
      {
        id: 'deps.node-modules',
        severity: 'warning',
        title: 'node_modules отсутствует',
        fixable: true,
        fix,
      },
      {
        id: 'deps.lock-file',
        severity: 'warning',
        title: 'lock-файл отсутствует',
        fixable: true,
        fix,
      },
    ]);
    const plan = planner.buildPlan({ diagnosis });
    expect(plan.steps).toHaveLength(1);
  });

  it('кастомная цель попадает в план', () => {
    const planner = new RepairPlanner();
    const plan = planner.buildPlan({
      diagnosis: makeDiagnosis([]),
      goal: 'Починить проект',
    });
    expect(plan.goal).toBe('Починить проект');
  });
});

// ─── summarizeDiagnosis ─────────────────────────────────────────────────

describe('repair-planner: summarizeDiagnosis', () => {
  it('сводка содержит число проверок, ошибок и предупреждений', () => {
    const diagnosis = makeDiagnosis([
      {
        id: 'a',
        severity: 'error',
        title: 'ошибка',
        fixable: false,
      },
      {
        id: 'b',
        severity: 'warning',
        title: 'предупреждение',
        fixable: true,
        fix: {
          kind: 'terminal',
          command: 'npm',
          args: ['install'],
          description: 'npm install',
        },
      },
    ]);
    const summary = summarizeDiagnosis(diagnosis);
    expect(summary).toContain('2 проверок');
    expect(summary).toContain('ошибок 1');
    expect(summary).toContain('предупреждений 1');
    expect(summary).toContain('исправимых 1');
    expect(summary).toContain('overall=critical');
  });
});
