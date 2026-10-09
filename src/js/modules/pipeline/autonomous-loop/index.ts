/**
 * AutonomousLoop — экспорты модуля автономного цикла Директора (Фаза 4).
 */

export {
  AutonomousLoop,
  defaultEvaluator,
  createGoalSourceFromGoalAgent,
  type AutonomousLoopOptions,
} from './autonomous-loop.js';
export {
  AutonomousLoopError,
  DEFAULT_AUTONOMOUS_LIMITS,
  type AutonomousGoalContext,
  type AutonomousLimits,
  type AutonomousLoopAction,
  type AutonomousLoopInput,
  type AutonomousLoopOutput,
  type GoalPlanExecutor,
  type GoalPlanResult,
  type GoalSource,
  type IterationRecord,
  type LoopState,
  type LoopStatus,
  type OutcomeEvaluator,
  type OutcomeVerdict,
} from './types.js';
