/**
 * SelfImprovement — типы замкнутого цикла самоулучшения инвестиционного анализа.
 *
 * Цикл: collect outcomes → analyze patterns → update weights → report
 */

// ──────────────────────────────────────────────
// 1. Паттерны и уроки
// ──────────────────────────────────────────────

/** Паттерн, обнаруженный в исторических данных */
export interface LearnedPattern {
  pattern: string;
  description: string;
  applicableTickers: string[];
  accuracy: number;
  sampleSize: number;
  recommendation: string;
}

/** Урок, сохранённый в память */
export interface LearningLesson {
  lesson: string;
  category: string;
  confidence: number;
}

// ──────────────────────────────────────────────
// 2. Результат цикла
// ──────────────────────────────────────────────

/** Результат выполнения цикла самоулучшения */
export interface ImprovementResult {
  success: boolean;
  patterns: LearnedPattern[];
  strategyWeights: Record<string, number>;
  lessonsSaved: number;
  message: string;
}

// ──────────────────────────────────────────────
// 3. Вход/выход агента
// ──────────────────────────────────────────────

/** Действия SelfImprovementLoop */
export type SelfImprovementAction = 'analyze' | 'update' | 'report';

/** Вход SelfImprovementLoop */
export interface SelfImprovementInput {
  action: SelfImprovementAction;
  newOutcomes?: Array<{
    pipelineId: string;
    ticker: string;
    recommendedAction: string;
    actualAction?: string;
    pnl30d?: number;
    pnl90d?: number;
    success: boolean;
    notes?: string;
    recordedAt: string;
  }>;
  improveGoal?: string;
}

/** Выход SelfImprovementLoop */
export interface SelfImprovementOutput {
  success: boolean;
  patterns: LearnedPattern[];
  strategyWeights: Record<string, number>;
  lessonsSaved: number;
  message: string;
}

// ──────────────────────────────────────────────
// 4. Ошибка
// ──────────────────────────────────────────────

/** Ошибка цикла самоулучшения */
export class SelfImprovementError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SelfImprovementError';
  }
}
