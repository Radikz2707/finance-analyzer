/**
 * FeedbackLoop — цикл обратной связи (Этап 4, Задача 1.1).
 *
 * Компоненты:
 * - OutcomeTracker (1.1.1): решения → результаты
 * - SuccessMetrics (1.1.2): win rate, ROI, satisfaction
 * - ABTestEngine (1.1.3): A/B тесты подходов
 * - ReinforcementLearning (1.1.4): обучение с подкреплением
 * - FeedbackLoop (1.1.5): единый фасад
 */

export * from './types.js';

export {
  OutcomeTracker,
  OutcomeTrackerError,
  InMemoryDecisionSource,
  InMemoryOutcomeSource,
  validateDecision,
  validateOutcome,
  type OutcomeTrackerOptions,
} from './outcome-tracker.js';

export {
  SuccessMetrics,
  computeAggregates,
  computeCategoryMetrics,
  computeTrend,
  groupByDay,
  DEFAULT_TREND_DAYS,
  type SuccessMetricsOptions,
} from './success-metrics.js';

export {
  ABTestEngine,
  ABTestEngineError,
  twoProportionZTest,
  normalCdf,
  type ABTestEngineOptions,
  type ABTestObservation,
} from './ab-test-engine.js';

export {
  ReinforcementLearning,
  ReinforcementLearningError,
  DEFAULT_LEARNING_RATE,
  DEFAULT_DISCOUNT_FACTOR,
  DEFAULT_EXPLORATION_RATE,
  DEFAULT_WEIGHT_HALF_LIFE_DAYS,
  type ReinforcementLearningOptions,
} from './reinforcement-learning.js';

export { FeedbackLoop, type FeedbackLoopInput } from './feedback-loop.js';
