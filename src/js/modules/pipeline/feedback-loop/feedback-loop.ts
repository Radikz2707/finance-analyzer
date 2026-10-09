/**
 * FeedbackLoop — единый фасад цикла обратной связи (подзадача 1.1.5).
 *
 * Объединяет:
 * - OutcomeTracker (1.1.1): решения → результаты
 * - SuccessMetrics (1.1.2): win rate, ROI, satisfaction
 * - ABTestEngine (1.1.3): A/B тесты подходов
 * - ReinforcementLearning (1.1.4): обновление весов действий
 *
 * Интеграция: LearningAgent (через LessonSource), DirectorAgent
 * (через track-decision / record-outcome).
 *
 * Использование:
 * ```ts
 * const loop = new FeedbackLoop();
 * await loop.execute('track-decision', decisionRecord);
 * await loop.execute('record-outcome', outcomeRecord);
 * const metrics = await loop.execute('get-metrics');
 * ```
 */

import { randomUUID } from 'node:crypto';
import type {
  DecisionRecord,
  OutcomeRecord,
  FeedbackLoopAction,
  FeedbackLoopOutput,
  FeedbackLoopOptions,
  FeedbackLoopStatus,
  SystemMetrics,
  AnalysisResult,
  ABTest,
  CreateABTestParams,
  FeatureVector,
  ActionWeight,
  LessonEntry,
  LessonSource,
  RLPrediction,
} from './types.js';
import { OutcomeTracker } from './outcome-tracker.js';
import { SuccessMetrics, computeAggregates } from './success-metrics.js';
import {
  ABTestEngine,
  ABTestEngineError,
  type ABTestObservation,
} from './ab-test-engine.js';
import {
  ReinforcementLearning,
  ReinforcementLearningError,
} from './reinforcement-learning.js';

// ──────────────────────────────────────────────
// FeedbackLoop
// ──────────────────────────────────────────────

/** Маппинг исхода → reward для RL */
const OUTCOME_REWARDS: Record<OutcomeRecord['outcome'], number> = {
  positive: 1,
  negative: -1,
  neutral: 0,
  ignored: -0.2,
};

/** Порог win rate, ниже которого категория считается слабой */
const WEAK_WIN_RATE_THRESHOLD = 0.4;
/** Порог win rate, выше которого категория считается сильной */
const STRONG_WIN_RATE_THRESHOLD = 0.7;
/** Порог confidence accuracy (расхождение уверенности и реальности) */
const CALIBRATION_THRESHOLD = 0.25;
/** Порог удовлетворённости (из 5) */
const LOW_SATISFACTION_THRESHOLD = 3;
/** Кандидаты действий RL по умолчанию */
const DEFAULT_RL_ACTIONS = [
  'recommend',
  'deep-analyze',
  'hold',
  'alert',
] as const;

/** Вход execute(): произвольные данные действия (кастуются внутри по action) */
export type FeedbackLoopInput = unknown;

/**
 * FeedbackLoop — фасад всего цикла обучения.
 */
export class FeedbackLoop {
  private readonly tracker: OutcomeTracker;
  private readonly metrics: SuccessMetrics;
  private readonly abEngine: ABTestEngine;
  private readonly rl: ReinforcementLearning;
  private readonly lessonSource: LessonSource | undefined;

  private status: FeedbackLoopStatus = 'idle';
  private lastError: string | null = null;

  constructor(options: FeedbackLoopOptions = {}) {
    this.tracker = new OutcomeTracker({
      decisionSource: options.decisionSource,
      outcomeSource: options.outcomeSource,
    });
    this.metrics = new SuccessMetrics();
    this.abEngine = new ABTestEngine();
    this.rl = new ReinforcementLearning(options.rlConfig);
    this.lessonSource = options.lessonSource;
    // analysisIntervalMs опция зарезервирована для авто-планировщика анализа;
    // пока используется вручную через execute('analyze')
    void (options.analysisIntervalMs ?? 0);
  }

  /** Текущий статус и последняя ошибка. */
  getStatus(): { status: FeedbackLoopStatus; lastError: string | null } {
    return { status: this.status, lastError: this.lastError };
  }

  /**
   * Единая точка входа для всех действий FeedbackLoopAction.
   * Возвращает FeedbackLoopOutput (success/error + data).
   */
  async execute(
    action: FeedbackLoopAction,
    input: FeedbackLoopInput = {},
  ): Promise<FeedbackLoopOutput> {
    try {
      this.lastError = null;
      let data: unknown;
      switch (action) {
        case 'track-decision':
          this.status = 'tracking';
          data = await this.trackDecision(input as unknown as DecisionRecord);
          break;
        case 'record-outcome':
          this.status = 'tracking';
          data = await this.recordOutcome(
            input as unknown as Omit<OutcomeRecord, 'recordedAt'>,
          );
          break;
        case 'get-metrics':
          this.status = 'analyzing';
          data = await this.getMetrics();
          break;
        case 'get-analysis':
          this.status = 'analyzing';
          data = await this.analyze();
          break;
        case 'create-ab-test':
          data = this.createABTest(input as unknown as CreateABTestParams);
          break;
        case 'record-ab-result':
          data = this.recordABResult(input as unknown as ABTestObservation);
          break;
        case 'get-ab-tests':
          data = this.abEngine.getAllTests();
          break;
        case 'get-ab-result':
          data = this.getABResult(
            String((input as { testId?: unknown }).testId),
          );
          break;
        case 'analyze':
          this.status = 'analyzing';
          data = await this.runAnalysisCycle();
          break;
        case 'update-weights':
          this.status = 'learning';
          data = await this.updateWeights(
            input as unknown as {
              decisionId?: string;
              action?: string;
              reward?: number;
              category?: string;
            },
          );
          break;
        case 'predict':
          data = this.predict(
            input as unknown as {
              features: FeatureVector;
              candidateActions?: string[];
            },
          );
          break;
        case 'get-weights':
          data = this.rl.getWeights();
          break;
        case 'get-status':
          data = this.getStatus();
          break;
        case 'reset':
          this.rl.reset();
          this.status = 'idle';
          data = { reset: true };
          break;
        case 'clear-all':
          this.rl.reset();
          this.status = 'idle';
          data = {
            cleared: true,
            note: 'Источники данных не очищаются — используйте напрямую',
          };
          break;
        default: {
          const exhaustive: never = action;
          throw new Error(`Неизвестное действие: ${String(exhaustive)}`);
        }
      }
      if (this.status !== 'idle') this.status = 'idle';
      return { action, success: true, data };
    } catch (error) {
      this.status = 'error';
      this.lastError = error instanceof Error ? error.message : String(error);
      return { action, success: false, error: this.lastError };
    }
  }

  // ── Решения и результаты ───────────────────────────────────────────────

  /** Зарегистрировать решение. Возвращает ID. */
  async trackDecision(record: DecisionRecord): Promise<string> {
    return this.tracker.trackDecision(record);
  }

  /** Зафиксировать результат + обновить RL-веса автоматически. */
  async recordOutcome(
    record: Omit<OutcomeRecord, 'recordedAt'>,
  ): Promise<{ outcomeId: string; weightsUpdated: boolean }> {
    const outcomeId = await this.tracker.recordOutcome(record);
    const decision = await this.tracker.getDecision(record.decisionId);
    if (decision) {
      const reward = OUTCOME_REWARDS[record.outcome] ?? 0;
      this.rl.update(decision.category, decision.recommendedAction, reward);
    }
    return { outcomeId, weightsUpdated: decision !== undefined };
  }

  // ── Метрики и анализ ───────────────────────────────────────────────────

  /** Общие метрики системы. */
  async getMetrics(): Promise<SystemMetrics> {
    const pairs = await this.tracker.getPairs();
    return this.metrics.computeSystemMetrics(pairs);
  }

  /** Анализ: сильные/слабые стороны, рекомендации, предупреждения. */
  async analyze(): Promise<AnalysisResult> {
    const pairs = await this.tracker.getPairs();
    const systemMetrics = this.metrics.computeSystemMetrics(pairs);
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];
    const warnings: string[] = [];

    if (systemMetrics.totalDecisions === 0) {
      warnings.push('Нет данных: не зарегистрировано ни одного решения');
      return {
        metrics: systemMetrics,
        strengths,
        weaknesses,
        recommendations,
        warnings,
      };
    }

    if (systemMetrics.totalOutcomes < systemMetrics.totalDecisions) {
      warnings.push(
        `Не все решения имеют результаты: ${systemMetrics.totalOutcomes}/${systemMetrics.totalDecisions} —win rate может быть смещён`,
      );
    }

    for (const category of systemMetrics.byCategory) {
      if (category.implementedCount === 0) {
        warnings.push(
          `Категория "${category.category}": нет реализованных решений — метрики ненадёжны`,
        );
        continue;
      }
      if (category.winRate >= STRONG_WIN_RATE_THRESHOLD) {
        strengths.push(
          `Категория "${category.category}": высокий win rate (${(category.winRate * 100).toFixed(0)}%)`,
        );
        recommendations.push(
          `Увеличить долю рекомендаций категории "${category.category}"`,
        );
      } else if (category.winRate < WEAK_WIN_RATE_THRESHOLD) {
        weaknesses.push(
          `Категория "${category.category}": низкий win rate (${(category.winRate * 100).toFixed(0)}%)`,
        );
        recommendations.push(
          `Пересмотреть подход к категории "${category.category}" (win rate ${(category.winRate * 100).toFixed(0)}%)`,
        );
      }
      if (
        category.avgSatisfaction > 0 &&
        category.avgSatisfaction < LOW_SATISFACTION_THRESHOLD
      ) {
        weaknesses.push(
          `Категория "${category.category}": низкая удовлетворённость (${category.avgSatisfaction.toFixed(1)}/5)`,
        );
      }
    }

    // Калибровка уверенности
    const agg = computeAggregates(pairs);
    if (agg.implemented > 0 && agg.confidenceAccuracy > CALIBRATION_THRESHOLD) {
      warnings.push(
        `Уверенность модели плохо калибрована: расхождение с реальностью ${(agg.confidenceAccuracy * 100).toFixed(0)}%`,
      );
      recommendations.push(
        'Снизить заявляемую уверенность или пересмотреть оценки',
      );
    }

    // Уроки для LearningAgent
    await this.deriveAndSaveLessons(pairs, systemMetrics);

    return {
      metrics: systemMetrics,
      strengths,
      weaknesses,
      recommendations,
      warnings,
    };
  }

  /** Полный цикл: анализ + затухание весов RL. */
  async runAnalysisCycle(): Promise<
    AnalysisResult & { decayedWeights: ActionWeight[] }
  > {
    const result = await this.analyze();
    return { ...result, decayedWeights: this.rl.decayAllWeights() };
  }

  // ── A/B тесты ──────────────────────────────────────────────────────────

  /** Создать A/B тест. */
  createABTest(params: CreateABTestParams): ABTest {
    return this.abEngine.createTest(params);
  }

  /** Записать наблюдение A/B теста. */
  recordABResult(observation: ABTestObservation): void {
    this.abEngine.recordObservation(observation);
  }

  /** Результаты A/B теста (с анализом). */
  getABResult(testId: string): ReturnType<ABTestEngine['analyzeTest']> {
    return this.abEngine.analyzeTest(testId);
  }

  // ── RL ─────────────────────────────────────────────────────────────────

  /** Прогноз RL для контекста. */
  predict(input: {
    features: FeatureVector;
    candidateActions?: readonly string[];
  }): RLPrediction {
    const actions = input.candidateActions ?? DEFAULT_RL_ACTIONS;
    return this.rl.predict(input.features, actions);
  }

  /** Ручное обновление веса (без привязки к решению). */
  async updateWeights(input: {
    decisionId?: string;
    action?: string;
    reward?: number;
    category?: string;
  }): Promise<ActionWeight[]> {
    if (input.decisionId) {
      const decision = await this.tracker.getDecision(input.decisionId);
      if (!decision) {
        throw new ReinforcementLearningError(
          `Решение "${input.decisionId}" не найдено`,
        );
      }
      const reward = input.reward ?? 0;
      this.rl.update(
        decision.category,
        input.action ?? decision.recommendedAction,
        reward,
      );
    } else if (input.category && input.action) {
      this.rl.update(input.category, input.action, input.reward ?? 0);
    } else {
      throw new ReinforcementLearningError(
        'Нужен либо decisionId, либо пара category+action',
      );
    }
    return this.rl.getWeights();
  }

  // ── Уроки для LearningAgent ────────────────────────────────────────────

  /**
   * Деривация уроков из метрик и сохранение в LessonSource (если задан).
   * Урок создаётся для сильных и слабых категорий.
   */
  private async deriveAndSaveLessons(
    pairs: readonly { decision: DecisionRecord; matched: boolean }[],
    systemMetrics: SystemMetrics,
  ): Promise<void> {
    if (!this.lessonSource) return;
    if (pairs.length === 0) return;

    const lessons: LessonEntry[] = [];
    for (const category of systemMetrics.byCategory) {
      if (category.implementedCount === 0) continue;
      const outcome =
        category.winRate >= STRONG_WIN_RATE_THRESHOLD
          ? ('positive' as const)
          : category.winRate < WEAK_WIN_RATE_THRESHOLD
            ? ('negative' as const)
            : ('neutral' as const);
      lessons.push({
        id: randomUUID(),
        pattern: `feedback-loop:category:${category.category}`,
        action: `category:${category.category}`,
        outcome,
        weight: Math.abs(category.winRate - 0.5) * 2, // 0..1, дальше от случайности — весомее
        createdAt: new Date().toISOString(),
        source: 'feedback',
        note: `win rate ${(category.winRate * 100).toFixed(0)}% из ${category.implementedCount} реализованных`,
      });
    }

    for (const lesson of lessons) {
      await this.lessonSource.saveLesson(lesson);
    }
  }
}

// Реэкспорт ошибок для удобства потребителей
export { ABTestEngineError, ReinforcementLearningError };
