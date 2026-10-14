/**
 * SelfImprovementLoop — замкнутый цикл самоулучшения Директора (Фаза 4).
 *
 * Цикл: diagnose (AutoRepairAgent) → plan (RepairPlanner) → execute
 * (CodingWorkflow + FileAgent/TerminalAgent через security-gate) → verify
 * (npm test / tsc) → learn (FeedbackLoop.record-outcome + LearningAgent.feedback)
 * → report.
 *
 * Безопасность: КАЖДАЯ операция с компьютером (file/terminal/code) проходит
 * через SecurityAgent ДО выполнения:
 * - allow → выполняется;
 * - deny → шаг блокируется (попадает в blockedSteps);
 * - require-confirmation → выполняется только при подтверждении через DI
 *   `confirm` (human-in-the-loop); без подтверждения шаг блокируется.
 *
 * DI: все зависимости инжектируются (тесты не трогают реальные БД/сеть/FS).
 * По умолчанию используются реальные агенты с безопасными корнями.
 */

import { randomUUID } from 'node:crypto';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import { splitCommandWithArgs } from '../agent/command-tokens.js';
import type {
  AutoRepairInput,
  AutoRepairOutput,
} from '../agents/auto-repair-agent.js';
import { AutoRepairAgent } from '../agents/auto-repair-agent.js';
import type { FileAgentInput } from '../agents/file-agent.js';
import { FileAgent } from '../agents/file-agent.js';
import type {
  AnalyzeResult,
  FeedbackEntry,
  Lesson,
} from '../agents/learning-agent.js';
import { LearningAgent } from '../agents/learning-agent.js';
import type {
  SecurityActionRequest,
  SecurityDecision,
} from '../agents/security-agent.js';
import { SecurityAgent } from '../agents/security-agent.js';
import type {
  TerminalAgentInput,
  TerminalAgentOutput,
} from '../agents/terminal-agent.js';
import { TerminalAgent } from '../agents/terminal-agent.js';
import type { CodingWorkflowInput } from '../coding-workflow/types.js';
import { CodingWorkflow } from '../coding-workflow/coding-workflow.js';
import type {
  AnalysisResult,
  DecisionRecord,
  OutcomeRecord,
} from '../feedback-loop/types.js';
import { FeedbackLoop } from '../feedback-loop/feedback-loop.js';
import { RepairPlanner, type RepairPlannerInput } from './repair-planner.js';
import {
  SelfImprovementError,
  type ImprovementPlan,
  type ImprovementResult,
  type ImprovementStep,
  type SelfImprovementInput,
  type SelfImprovementOutput,
} from './types.js';

// ──────────────────────────────────────────────
// 1. Минимальные контракты (DI)
// ──────────────────────────────────────────────

/** Минимальный контракт агента (AgentResult-обёртка) */
export interface AgentLike<TInput> {
  execute(
    input: TInput,
  ): Promise<{ success: boolean; data?: unknown; error?: unknown }>;
}

/** Минимальный контракт AutoRepairAgent */
export interface AutoRepairLike {
  execute(input: AutoRepairInput): Promise<{
    success: boolean;
    data?: unknown;
    error?: unknown;
  }>;
}

/** Минимальный контракт FeedbackLoop (execute-фасад) */
export interface FeedbackLoopLike {
  execute(
    action: string,
    input?: unknown,
  ): Promise<{ success: boolean; data?: unknown; error?: string }>;
}

/** Минимальный контракт LearningAgent */
export interface LearningAgentLike {
  feedback(entry: FeedbackEntry): Promise<Lesson>;
  analyze(input?: {
    windowMs?: number;
    scope?: string;
  }): Promise<AnalyzeResult>;
}

/** Минимальный контракт RepairPlanner (структурный, для DI) */
export interface RepairPlannerLike {
  buildPlan(input: RepairPlannerInput): ImprovementPlan;
}

/** Шлюз безопасности (структурно совместим с ActionSecurityGate) */
export interface SecurityGateLike {
  check(
    request: SecurityActionRequest,
  ): SecurityDecision | Promise<SecurityDecision>;
}

// ──────────────────────────────────────────────
// 2. Опции
// ──────────────────────────────────────────────

/** Опции SelfImprovementLoop (DI) */
export interface SelfImprovementLoopOptions {
  /** Разрешённые корни (для собственных агентов; по умолчанию process.cwd()) */
  roots?: string[];
  /** Агент диагностики (по умолчанию — AutoRepairAgent с roots) */
  autoRepair?: AutoRepairLike;
  /** Планировщик ремонта (по умолчанию — RepairPlanner) */
  planner?: RepairPlannerLike;
  /** Конвейер разработки кода (по умолчанию — CodingWorkflow с roots) */
  codingWorkflow?: AgentLike<CodingWorkflowInput>;
  /** Агент файловых операций (по умолчанию — FileAgent с roots) */
  fileAgent?: AgentLike<FileAgentInput>;
  /** Агент терминала (по умолчанию — TerminalAgent с roots) */
  terminalAgent?: AgentLike<TerminalAgentInput>;
  /** Шлюз безопасности (по умолчанию — SecurityAgent с roots) */
  security?: SecurityGateLike;
  /** Цикл обратной связи (по умолчанию — FeedbackLoop) */
  feedbackLoop?: FeedbackLoopLike;
  /** Агент обучения (по умолчанию — LearningAgent) */
  learningAgent?: LearningAgentLike;
  /** Команда финальной проверки (по умолчанию 'npm run test') */
  verifyCommand?: string;
  /** Максимум итераций ремонта CodingWorkflow (по умолчанию 2) */
  maxRepairIterations?: number;
  /**
   * Подтверждение для require-confirmation (human-in-the-loop).
   * По умолчанию — false: шаг блокируется в автономном режиме.
   */
  confirm?: (
    request: SecurityActionRequest,
    decision: SecurityDecision,
  ) => Promise<boolean> | boolean;
  /** Часы для детерминированных тестов (по умолчанию new Date()) */
  now?: () => Date;
}

// ──────────────────────────────────────────────
// 3. Цикл
// ──────────────────────────────────────────────

/** Замкнутый цикл самоулучшения: diagnose → plan → execute → verify → learn */
export class SelfImprovementLoop extends AgentBase {
  private readonly autoRepair: AutoRepairLike;
  private readonly planner: RepairPlannerLike;
  private readonly codingWorkflow: AgentLike<CodingWorkflowInput>;
  private readonly fileAgent: AgentLike<FileAgentInput>;
  private readonly terminalAgent: AgentLike<TerminalAgentInput>;
  private readonly security: SecurityGateLike;
  private readonly feedbackLoop: FeedbackLoopLike;
  private readonly learningAgent: LearningAgentLike;
  private readonly verifyCommand: string;
  private readonly maxRepairIterations: number;
  private readonly confirm: (
    request: SecurityActionRequest,
    decision: SecurityDecision,
  ) => Promise<boolean> | boolean;
  private readonly now: () => Date;

  constructor(config?: AgentConfig, options?: SelfImprovementLoopOptions) {
    super(config ?? { name: 'SelfImprovementLoop' });
    const roots = options?.roots?.length
      ? options.roots.map((root) => root)
      : [process.cwd()];
    this.autoRepair =
      options?.autoRepair ??
      new AutoRepairAgent({ name: 'AutoRepairAgent' }, { roots });
    this.planner = options?.planner ?? new RepairPlanner({ now: options?.now });
    this.codingWorkflow =
      options?.codingWorkflow ??
      new CodingWorkflow(
        { name: 'CodingWorkflow' },
        { roots, maxRepairIterations: options?.maxRepairIterations },
      );
    this.fileAgent =
      options?.fileAgent ?? new FileAgent({ name: 'FileAgent' }, { roots });
    this.terminalAgent =
      options?.terminalAgent ??
      new TerminalAgent({ name: 'TerminalAgent' }, { roots });
    this.security =
      options?.security ??
      (() => {
        const agent = new SecurityAgent({ name: 'SecurityAgent' }, { roots });
        return { check: (request) => agent.validate(request) };
      })();
    this.feedbackLoop = options?.feedbackLoop ?? new FeedbackLoop();
    this.learningAgent = options?.learningAgent ?? new LearningAgent();
    this.verifyCommand = options?.verifyCommand ?? 'npm run test';
    this.maxRepairIterations = Math.max(0, options?.maxRepairIterations ?? 2);
    this.confirm = options?.confirm ?? (() => false);
    this.now = options?.now ?? (() => new Date());
  }

  protected async executeInternal(
    input: SelfImprovementInput,
  ): Promise<SelfImprovementOutput> {
    if (!input || typeof input !== 'object') {
      throw new SelfImprovementError(
        'SelfImprovementLoop: входные данные отсутствуют',
      );
    }
    const action = input.action;
    if (action !== 'diagnose' && action !== 'improve' && action !== 'health') {
      throw new SelfImprovementError(
        `SelfImprovementLoop: неизвестное действие: ${String(action)}`,
      );
    }
    if (action === 'diagnose' || action === 'health') {
      const value = await this.runDiagnose(input.autoFix ?? false);
      return { kind: action, value };
    }
    const value = await this.runImprove(input.goal);
    return { kind: 'improve', value };
  }

  // ── Диагностика (health / diagnose) ──

  /** Только диагностика: AutoRepairAgent.diagnose → отчёт (без изменений) */
  private async runDiagnose(autoFix: boolean): Promise<AutoRepairOutput> {
    const result = await this.autoRepair.execute({
      action: 'diagnose',
      scope: 'project',
      autoFix,
    });
    if (!result.success) {
      throw new SelfImprovementError(
        `Диагностика не выполнена: ${errorText(result.error)}`,
      );
    }
    return result.data as AutoRepairOutput;
  }

  // ── Полный цикл улучшения ──

  /** Замкнутый цикл: diagnose → plan → execute → verify → learn → report */
  private async runImprove(goal?: string): Promise<ImprovementResult> {
    // 1. diagnose
    const diagnosis = await this.runDiagnose(false);

    // 2. Собрать уроки и метрики для планировщика.
    const lessons = await this.collectLessons();
    const metrics = await this.collectMetrics();

    // 3. plan
    const plan = this.planner.buildPlan({
      diagnosis,
      lessons,
      metrics,
      goal,
    });

    // 4. execute (каждый шаг через security-gate)
    const blockedSteps: string[] = [];
    let executedSteps = 0;
    let repairIterations = 0;
    for (const step of plan.steps) {
      const allowed = await this.approveStep(step);
      if (!allowed) {
        blockedSteps.push(step.description);
        continue;
      }
      const outcome = await this.executeStep(step);
      if (!outcome.ok) {
        blockedSteps.push(`${step.description} (${outcome.reason})`);
        continue;
      }
      executedSteps += 1;
      repairIterations += outcome.repairIterations;
    }

    // 5. verify (npm test / tsc через security-gate)
    const testPassed = await this.verify();

    // 6. learn (FeedbackLoop + LearningAgent)
    const lessonsSaved = await this.learn(plan, testPassed, blockedSteps);

    // 7. report
    return this.buildResult(
      plan,
      testPassed,
      repairIterations,
      lessonsSaved,
      executedSteps,
      blockedSteps,
      diagnosis,
    );
  }

  // ── Сбор контекста для планировщика ──

  /** Уроки LearningAgent (падение источника — честно пусто) */
  private async collectLessons(): Promise<Lesson[]> {
    try {
      const analysis = await this.learningAgent.analyze();
      return analysis.lessons;
    } catch {
      return [];
    }
  }

  /** Метрики FeedbackLoop.analyze() (падение источника — честно null) */
  private async collectMetrics(): Promise<AnalysisResult | null> {
    try {
      const output = await this.feedbackLoop.execute('analyze');
      if (!output.success) {
        return null;
      }
      const data = output.data as AnalysisResult | undefined;
      if (
        !data ||
        typeof data !== 'object' ||
        !('metrics' in data) ||
        typeof data.metrics !== 'object' ||
        data.metrics === null
      ) {
        return null; // некорректная структура — метрики не используются
      }
      return data;
    } catch {
      return null;
    }
  }

  // ── Security-gate ──

  /**
   * Проверить шаг через SecurityAgent.
   * allow → true; deny → false; require-confirmation → confirm() или false.
   */
  private async approveStep(step: ImprovementStep): Promise<boolean> {
    const request = this.buildSecurityRequest(step);
    const decision = await this.security.check(request);
    if (decision.verdict === 'allow') {
      return true;
    }
    if (decision.verdict === 'require-confirmation') {
      return this.confirm(request, decision);
    }
    return false; // deny
  }

  /** Построить заявку на действие для SecurityAgent из шага плана */
  private buildSecurityRequest(step: ImprovementStep): SecurityActionRequest {
    switch (step.role) {
      case 'file': {
        const input = step.input as { action?: unknown; path?: unknown };
        return {
          kind: 'file',
          action: typeof input.action === 'string' ? input.action : 'write',
          path: typeof input.path === 'string' ? input.path : undefined,
          description: step.description,
        };
      }
      case 'terminal': {
        const input = step.input as { command?: unknown; args?: unknown };
        return {
          kind: 'terminal',
          command: typeof input.command === 'string' ? input.command : '',
          args: Array.isArray(input.args)
            ? input.args.filter((arg): arg is string => typeof arg === 'string')
            : undefined,
          description: step.description,
        };
      }
      case 'code': {
        const input = step.input as { testCommand?: unknown };
        const command = splitCommandWithArgs(
          typeof input.testCommand === 'string'
            ? input.testCommand
            : this.verifyCommand,
        ) ?? { command: '', args: undefined };
        return {
          kind: 'terminal',
          command: command.command,
          args: command.args,
          description: step.description,
        };
      }
      default: {
        const exhaustive: never = step.role;
        void exhaustive;
        return { kind: 'terminal', description: step.description };
      }
    }
  }

  // ── Выполнение шагов ──

  /** Выполнить шаг плана соответствующим агентом */
  private async executeStep(step: ImprovementStep): Promise<{
    ok: boolean;
    reason?: string;
    repairIterations: number;
  }> {
    switch (step.role) {
      case 'file':
        return this.executeFileStep(step);
      case 'terminal':
        return this.executeTerminalStep(step);
      case 'code':
        return this.executeCodeStep(step);
      default: {
        const exhaustive: never = step.role;
        void exhaustive;
        return {
          ok: false,
          reason: 'Неизвестная роль шага',
          repairIterations: 0,
        };
      }
    }
  }

  /** Файловый шаг: write (при наличии source — сначала чтение источника) */
  private async executeFileStep(step: ImprovementStep): Promise<{
    ok: boolean;
    reason?: string;
    repairIterations: number;
  }> {
    const input = step.input as {
      action?: unknown;
      path?: unknown;
      content?: unknown;
      source?: unknown;
    };
    const path = typeof input.path === 'string' ? input.path : '';
    if (path === '') {
      return { ok: false, reason: 'Путь файла не указан', repairIterations: 0 };
    }
    const source = typeof input.source === 'string' ? input.source : '';
    let content = typeof input.content === 'string' ? input.content : '';
    if (source !== '') {
      const read = await this.fileAgent.execute({
        action: 'read',
        path: source,
      });
      if (!read.success) {
        return {
          ok: false,
          reason: `Не удалось прочитать источник ${source}`,
          repairIterations: 0,
        };
      }
      const output = read.data as { content?: unknown } | undefined;
      content = typeof output?.content === 'string' ? output.content : '';
    }
    const result = await this.fileAgent.execute({
      action: 'write',
      path,
      content,
    });
    return {
      ok: result.success,
      reason: result.success ? undefined : errorText(result.error),
      repairIterations: 0,
    };
  }

  /** Терминальный шаг: выполнить команду */
  private async executeTerminalStep(step: ImprovementStep): Promise<{
    ok: boolean;
    reason?: string;
    repairIterations: number;
  }> {
    const input = step.input as { command?: unknown; args?: unknown };
    const command = typeof input.command === 'string' ? input.command : '';
    if (command === '') {
      return { ok: false, reason: 'Команда не указана', repairIterations: 0 };
    }
    const args = Array.isArray(input.args)
      ? input.args.filter((arg): arg is string => typeof arg === 'string')
      : undefined;
    const result = await this.terminalAgent.execute({ command, args });
    const output = result.success
      ? (result.data as TerminalAgentOutput | undefined)
      : undefined;
    const ok = Boolean(output && output.exitCode === 0);
    return {
      ok,
      reason: ok
        ? undefined
        : `Команда завершилась с ошибкой: ${errorText(result.error)}`,
      repairIterations: 0,
    };
  }

  /**
   * Кодовый шаг: файлы → CodingWorkflow (write → test → repair → retest);
   * без файлов — ревью-шаг: проверка текущего состояния (verify-команда).
   */
  private async executeCodeStep(step: ImprovementStep): Promise<{
    ok: boolean;
    reason?: string;
    repairIterations: number;
  }> {
    const input = step.input as {
      task?: unknown;
      files?: unknown;
      testCommand?: unknown;
    };
    const files = Array.isArray(input.files)
      ? input.files.filter(
          (file): file is { path: string; content: string } =>
            typeof file === 'object' &&
            file !== null &&
            typeof (file as { path?: unknown }).path === 'string' &&
            typeof (file as { content?: unknown }).content === 'string',
        )
      : [];
    if (files.length === 0) {
      // Ревью-шаг: проверяем, что проект остаётся работоспособным.
      const passed = await this.verify();
      return {
        ok: passed,
        reason: passed ? undefined : 'Проверка проекта не пройдена',
        repairIterations: 0,
      };
    }
    const result = await this.codingWorkflow.execute({
      task: typeof input.task === 'string' ? input.task : step.description,
      files,
      testCommand:
        typeof input.testCommand === 'string' ? input.testCommand : undefined,
      maxRepairIterations: this.maxRepairIterations,
    });
    const output = result.success
      ? (result.data as
          { testPassed?: unknown; repairIterations?: unknown } | undefined)
      : undefined;
    const testPassed = output?.testPassed === true;
    const repairIterations =
      typeof output?.repairIterations === 'number'
        ? output.repairIterations
        : 0;
    return {
      ok: testPassed,
      reason: testPassed ? undefined : 'Код не прошёл проверку',
      repairIterations,
    };
  }

  // ── Verify ──

  /** Финальная проверка: verifyCommand через security-gate + TerminalAgent */
  private async verify(): Promise<boolean> {
    const parsed = splitCommandWithArgs(this.verifyCommand) ?? {
      command: '',
      args: undefined,
    };
    if (parsed.command === '') {
      return false;
    }
    const request: SecurityActionRequest = {
      kind: 'terminal',
      command: parsed.command,
      args: parsed.args,
      description: `Финальная проверка: ${this.verifyCommand}`,
    };
    const decision = await this.security.check(request);
    if (decision.verdict !== 'allow') {
      return false; // deny / require-confirmation без подтверждения
    }
    const result = await this.terminalAgent.execute({
      command: parsed.command,
      args: parsed.args,
    });
    const output = result.success
      ? (result.data as TerminalAgentOutput | undefined)
      : undefined;
    return Boolean(output && output.exitCode === 0);
  }

  // ── Learn ──

  /**
   * Записать результат в FeedbackLoop (решение → результат → награда)
   * и сохранить урок в LearningAgent.
   */
  private async learn(
    plan: ImprovementPlan,
    testPassed: boolean,
    blockedSteps: string[],
  ): Promise<string[]> {
    const lessons: string[] = [];
    const decisionId = randomUUID();
    const nowIso = this.now().toISOString();

    // FeedbackLoop: решение → результат → награда (RL-веса обновляются).
    try {
      const decision: DecisionRecord = {
        id: decisionId,
        createdAt: nowIso,
        userQuestion: plan.goal,
        category: 'self-improvement',
        tickers: [],
        recommendedAction: 'improve',
        reasoning: plan.diagnosis,
        confidence: 0.5,
        agentRoles: ['self-improve'],
      };
      await this.feedbackLoop.execute('track-decision', decision);
      const outcome: OutcomeRecord = {
        decisionId,
        recordedAt: nowIso,
        actualAction: 'self-improve',
        outcome: testPassed ? 'positive' : 'negative',
        implemented: true,
        notes:
          blockedSteps.length > 0
            ? `Заблокировано шагов: ${blockedSteps.length}`
            : undefined,
      };
      await this.feedbackLoop.execute('record-outcome', outcome);
    } catch {
      // Падение FeedbackLoop не роняет цикл — урок всё равно сохраняется.
    }

    // LearningAgent: урок по результату цикла.
    try {
      const entry: FeedbackEntry = {
        outcome: testPassed ? 'good' : 'bad',
        action: 'self-improve',
        agent: 'SelfImprovementLoop',
        note: `${plan.goal}: ${testPassed ? 'успех' : 'провал'} (шагов выполнено: ${plan.steps.length - blockedSteps.length}/${plan.steps.length})`,
      };
      const lesson = await this.learningAgent.feedback(entry);
      lessons.push(lesson.pattern);
    } catch {
      // Падение LearningAgent не роняет цикл.
    }
    return lessons;
  }

  // ── Report ──

  /** Собрать ImprovementResult */
  private buildResult(
    plan: ImprovementPlan,
    testPassed: boolean,
    repairIterations: number,
    lessons: string[],
    executedSteps: number,
    blockedSteps: string[],
    diagnosis: AutoRepairOutput,
  ): ImprovementResult {
    const errors = diagnosis.checks.filter(
      (c) => c.severity === 'error',
    ).length;
    const warnings = diagnosis.checks.filter(
      (c) => c.severity === 'warning',
    ).length;
    const fixable = diagnosis.checks.filter((c) => c.fixable).length;
    const success = testPassed && blockedSteps.length === 0;
    const message = buildResultMessage(
      plan,
      testPassed,
      executedSteps,
      blockedSteps,
      success,
    );
    return {
      success,
      testPassed,
      repairIterations,
      lessons,
      metrics: {
        checks: diagnosis.checks.length,
        errors,
        warnings,
        fixable,
        plannedSteps: plan.steps.length,
        executedSteps,
        blockedSteps: blockedSteps.length,
        repairIterations,
      },
      plan,
      message,
      executedSteps,
      blockedSteps,
    };
  }
}

// ──────────────────────────────────────────────
// 4. Чистые хелперы (экспортируются для тестов)
// ──────────────────────────────────────────────

/** Человекочитаемая сводка результата цикла */
export function buildResultMessage(
  plan: ImprovementPlan,
  testPassed: boolean,
  executedSteps: number,
  blockedSteps: string[],
  success: boolean,
): string {
  const parts: string[] = [];
  parts.push(`Цель: ${plan.goal}`);
  parts.push(`Шагов: ${executedSteps}/${plan.steps.length}`);
  if (blockedSteps.length > 0) {
    parts.push(`Заблокировано: ${blockedSteps.length}`);
  }
  parts.push(`Проверка: ${testPassed ? 'пройдена' : 'не пройдена'}`);
  parts.push(`Итог: ${success ? 'успех' : 'требует внимания'}`);
  return parts.join('; ');
}

/** Текст ошибки (устойчиво к не-Error значениям) */
function errorText(err: unknown): string {
  return err instanceof Error
    ? err.message
    : String(err ?? 'неизвестная ошибка');
}
