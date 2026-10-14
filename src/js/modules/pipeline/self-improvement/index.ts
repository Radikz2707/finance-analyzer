/**
 * SelfImprovement — замкнутый цикл самоулучшения Директора (Фаза 4).
 *
 * Модуль: diagnose (AutoRepairAgent) → plan (RepairPlanner) → execute
 * (CodingWorkflow + FileAgent/TerminalAgent через security-gate) → verify
 * (npm test / tsc) → learn (FeedbackLoop + LearningAgent) → report.
 *
 * Безопасность: все операции с компьютером — только через SecurityAgent
 * (allow / deny / require-confirmation).
 */

export {
  SelfImprovementLoop,
  buildResultMessage,
  type AgentLike,
  type AutoRepairLike,
  type FeedbackLoopLike,
  type LearningAgentLike,
  type SecurityGateLike,
  type SelfImprovementLoopOptions,
} from './self-improvement-loop.js';
export {
  RepairPlanner,
  fixToStep,
  summarizeDiagnosis,
  type RepairPlannerInput,
  type RepairPlannerOptions,
} from './repair-planner.js';
export {
  generateImprovementGoals,
  summarizeImprovementGoals,
  WEAK_WIN_RATE_THRESHOLD,
  CRITICAL_WIN_RATE_THRESHOLD,
  type ImprovementGoal,
} from './improvement-goals.js';
export {
  SelfImprovementError,
  type ImprovementPlan,
  type ImprovementResult,
  type ImprovementStep,
  type ImprovementStepRole,
  type SelfImprovementAction,
  type SelfImprovementInput,
  type SelfImprovementOutput,
} from './types.js';
