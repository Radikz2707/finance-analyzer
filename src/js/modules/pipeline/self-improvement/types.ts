/**
 * SelfImprovement — типы замкнутого цикла самоулучшения Директора (Фаза 4).
 *
 * Цикл: diagnose (AutoRepairAgent) → plan (RepairPlanner) → execute
 * (CodingWorkflow + FileAgent/TerminalAgent через security-gate) → verify
 * (npm test / tsc) → learn (FeedbackLoop.record-outcome + LearningAgent.feedback)
 * → report.
 *
 * Безопасность: все операции с компьютером выполняются ТОЛЬКО через
 * SecurityAgent (allow / deny / require-confirmation). require-confirmation
 * в автономном режиме блокирует шаг (human-in-the-loop через DI `confirm`).
 */

import type { AgentActionInput } from '../agent/agent-contract.js';
import type { AutoRepairOutput } from '../agents/auto-repair-agent.js';

// ──────────────────────────────────────────────
// 1. План улучшения
// ──────────────────────────────────────────────

/** Роль исполнителя шага плана */
export type ImprovementStepRole = 'file' | 'terminal' | 'code';

/**
 * Шаг плана улучшения.
 * `input` структурно совместим с входом соответствующего агента:
 * - file → FileAgentInput ({ action, path, content, ... });
 * - terminal → TerminalAgentInput ({ command, args });
 * - code → CodingWorkflowInput ({ task, files, testCommand }).
 */
export interface ImprovementStep {
  /** Роль исполнителя шага */
  role: ImprovementStepRole;
  /** Вход агента (FileAgentInput / TerminalAgentInput / CodingWorkflowInput) */
  input: unknown;
  /** Человекочитаемое описание шага (для отчётов и аудита) */
  description: string;
}

/** План улучшения/ремонта проекта */
export interface ImprovementPlan {
  /** Уникальный ID плана */
  id: string;
  /** Цель улучшения (например, «Починить проект») */
  goal: string;
  /** Сводка диагностики (что найдено) */
  diagnosis: string;
  /** Шаги плана (file/terminal/code) */
  steps: ImprovementStep[];
  /** Ожидаемый результат (что должно стать верно после выполнения) */
  expectedOutcome: string;
  /** Метка времени создания плана (ISO) */
  createdAt: string;
}

// ──────────────────────────────────────────────
// 2. Результат улучшения
// ──────────────────────────────────────────────

/** Результат выполнения цикла самоулучшения */
export interface ImprovementResult {
  /** Успешен ли цикл в целом (тесты прошли ИЛИ нечего чинить) */
  success: boolean;
  /** Прошла ли финальная проверка (npm test / tsc) */
  testPassed: boolean;
  /** Сколько итераций ремонта выполнил CodingWorkflow */
  repairIterations: number;
  /** Уроки, сохранённые в LearningAgent (паттерны) */
  lessons: string[];
  /** Числовые метрики цикла (checks, errors, warnings, executedSteps, ...) */
  metrics: Record<string, number>;
  /** План, который выполнялся */
  plan: ImprovementPlan;
  /** Человекочитаемая сводка результата */
  message: string;
  /** Сколько шагов плана выполнено */
  executedSteps: number;
  /** Заблокированные шаги (deny / require-confirmation без подтверждения) */
  blockedSteps: string[];
}

// ──────────────────────────────────────────────
// 3. Вход/выход агента
// ──────────────────────────────────────────────

/** Действия SelfImprovementLoop */
export type SelfImprovementAction = 'diagnose' | 'improve' | 'health';

/** Вход SelfImprovementLoop (единый стандарт action-агента) */
export interface SelfImprovementInput extends AgentActionInput<SelfImprovementAction> {
  /** Цель улучшения (для action: 'improve'; по умолчанию — из диагностики) */
  goal?: string;
  /** Применять ли исправления AutoRepairAgent при diagnose (по умолчанию false) */
  autoFix?: boolean;
}

/** Выход SelfImprovementLoop: дискриминированный союз по kind */
export type SelfImprovementOutput =
  | { kind: 'diagnose'; value: AutoRepairOutput }
  | { kind: 'health'; value: AutoRepairOutput }
  | { kind: 'improve'; value: ImprovementResult };

// ──────────────────────────────────────────────
// 4. Ошибка
// ──────────────────────────────────────────────

/** Честная ошибка цикла самоулучшения */
export class SelfImprovementError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SelfImprovementError';
  }
}
