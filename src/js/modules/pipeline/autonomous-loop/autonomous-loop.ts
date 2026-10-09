/**
 * AutonomousLoop — автономный цикл Директора («нервная система» агента).
 *
 * Непрерывный цикл без участия человека:
 *   [GoalSource: активные цели] → сортировка по приоритету →
 *   → [Executor: выполнение плана цели агентами] →
 *   → [FeedbackLoop: track-decision → record-outcome → update-weights] →
 *   → [Урок: повторять/избегать] → следующая итерация.
 *
 * Границы автономности (безопасность):
 * - цели берутся ТОЛЬКО из GoalSource (GoalAgent) — цикл ничего не выдумывает;
 * - исполнитель получает limits (в т.ч. forbiddenRoles) и ОБЯЗАН их
 *   соблюдать: в автономном режиме опасные роли (terminal/process)
 *   запрещены по умолчанию;
 * - лимиты цикла: maxIterationsPerCycle, maxCycleDurationMs,
 *   maxConsecutiveFailures — превышение = честная остановка с причиной;
 * - stop() в любой момент прекращает запуск новых итераций;
 * - dry-run показывает план без выполнения и без записей в FeedbackLoop.
 *
 * Самообучение: каждая итерация пишется в FeedbackLoop (решение,
 * результат, награда в RL-веса), урок формулируется из исхода.
 */

import { FeedbackLoop } from '../feedback-loop/feedback-loop.js';
import type { DecisionRecord, OutcomeRecord } from '../feedback-loop/types.js';
import {
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
  type LoopStatus,
  type OutcomeEvaluator,
  type OutcomeVerdict,
} from './types.js';

/** Порядок сортировки целей по приоритету (меньше = важнее) */
const PRIORITY_ORDER: Readonly<Record<string, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Максимум итераций в истории (защита от роста памяти) */
const MAX_HISTORY = 200;

// ──────────────────────────────────────────────
// AutonomousLoop
// ──────────────────────────────────────────────

/** Опции конструктора (DI) */
export interface AutonomousLoopOptions {
  /** Источник целей (обёртка над GoalAgent) */
  goalSource: GoalSource;
  /** Исполнитель планов целей («руки») */
  executor: GoalPlanExecutor;
  /** Оценщик результатов (по умолчанию — по success) */
  evaluator?: OutcomeEvaluator;
  /** FeedbackLoop для самообучения (создаётся по умолчанию) */
  feedback?: FeedbackLoop;
  /** Лимиты автономности (частичное переопределение) */
  limits?: Partial<AutonomousLimits>;
  /** Инжектируемые часы (для тестов) */
  now?: () => Date;
}

export class AutonomousLoop {
  private readonly goalSource: GoalSource;
  private readonly executor: GoalPlanExecutor;
  private readonly evaluator: OutcomeEvaluator;
  private readonly feedback: FeedbackLoop;
  private readonly limits: AutonomousLimits;
  private readonly now: () => Date;

  private state: LoopStatus['state'] = 'idle';
  private stopRequested = false;
  private consecutiveFailures = 0;
  private totalIterations = 0;
  private history: IterationRecord[] = [];
  private startedAt?: string;
  private lastStopReason?: string;

  constructor(options: AutonomousLoopOptions) {
    if (!options || !options.goalSource) {
      throw new AutonomousLoopError(
        'AutonomousLoop: не указан источник целей (goalSource)',
      );
    }
    if (!options.executor) {
      throw new AutonomousLoopError(
        'AutonomousLoop: не указан исполнитель планов (executor)',
      );
    }
    this.goalSource = options.goalSource;
    this.executor = options.executor;
    this.evaluator = options.evaluator ?? defaultEvaluator;
    this.feedback = options.feedback ?? new FeedbackLoop();
    this.limits = { ...DEFAULT_AUTONOMOUS_LIMITS, ...options.limits };
    this.now = options.now ?? (() => new Date());
  }

  /** Текущий статус цикла */
  getStatus(): LoopStatus {
    return {
      state: this.state,
      iterations: this.history.length,
      consecutiveFailures: this.consecutiveFailures,
      totalIterations: this.totalIterations,
      startedAt: this.startedAt,
      lastStopReason: this.lastStopReason,
    };
  }

  /** История итераций (копия; limit — последние N) */
  getHistory(limit?: number): IterationRecord[] {
    const slice =
      limit && limit > 0 ? this.history.slice(-limit) : [...this.history];
    return slice.map((record) => ({ ...record }));
  }

  /** Запросить остановку цикла (между итерациями) */
  stop(reason = 'Остановка запрошена пользователем'): void {
    this.stopRequested = true;
    this.lastStopReason = reason;
  }

  /** Сброс состояния и истории */
  reset(): void {
    this.state = 'idle';
    this.stopRequested = false;
    this.consecutiveFailures = 0;
    this.totalIterations = 0;
    this.history = [];
    this.startedAt = undefined;
    this.lastStopReason = undefined;
  }

  /**
   * Выполнить действия цикла.
   * - run-cycle: автономный цикл по активным целям;
   * - dry-run: план без выполнения;
   * - stop / get-status / get-history / reset.
   */
  async execute(
    action: AutonomousLoopAction,
    input: AutonomousLoopInput = {},
  ): Promise<AutonomousLoopOutput> {
    switch (action) {
      case 'run-cycle':
        return this.runCycle(input.limits);
      case 'dry-run':
        return this.dryRun(input.limits);
      case 'stop':
        this.stop();
        return {
          success: true,
          message: this.lastStopReason ?? 'Остановлено',
          status: this.getStatus(),
        };
      case 'get-status':
        return {
          success: true,
          message: 'Статус получен',
          status: this.getStatus(),
        };
      case 'get-history':
        return {
          success: true,
          message: `История: ${this.history.length} итераций`,
          iterations: this.getHistory(),
        };
      case 'reset':
        this.reset();
        return {
          success: true,
          message: 'Состояние сброшено',
          status: this.getStatus(),
        };
      default: {
        const exhaustive: never = action;
        throw new AutonomousLoopError(
          `AutonomousLoop: неизвестное действие ${String(exhaustive)}`,
        );
      }
    }
  }

  /** Сухой прогон: показать план без выполнения */
  private async dryRun(
    overrides?: Partial<AutonomousLimits>,
  ): Promise<AutonomousLoopOutput> {
    const limits = { ...this.limits, ...overrides };
    const goals = await this.loadGoals();
    const planned = goals.slice(0, limits.maxIterationsPerCycle);
    return {
      success: true,
      message:
        `Dry-run: выполнено бы ${planned.length} из ${goals.length} активных целей ` +
        `(лимит ${limits.maxIterationsPerCycle} итераций, запрещённые роли: ` +
        `${limits.forbiddenRoles.join(', ') || 'нет'}).`,
      status: this.getStatus(),
      iterations: planned.map((goal) => ({
        id: `dry-${goal.goalId}`,
        startedAt: this.now().toISOString(),
        goalId: goal.goalId,
        goalName: goal.name,
        success: true,
        result: {
          userQuestion: `[план] ${goal.description}`,
          recommendedAction: 'plan',
          success: true,
          confidence: 0,
          agentRoles: [],
          reasoning: 'Планируемая цель (не выполнялась)',
        },
      })),
    };
  }

  /** Автономный цикл по активным целям */
  private async runCycle(
    overrides?: Partial<AutonomousLimits>,
  ): Promise<AutonomousLoopOutput> {
    if (this.state === 'running') {
      throw new AutonomousLoopError(
        'AutonomousLoop: цикл уже выполняется (state=running)',
      );
    }

    const limits = { ...this.limits, ...overrides };
    const cycleStart = this.now().getTime();

    this.state = 'running';
    this.stopRequested = false;
    this.consecutiveFailures = 0;
    this.startedAt = this.now().toISOString();

    const iterations: IterationRecord[] = [];
    const lessons: string[] = [];
    let stopReason: string | undefined;

    try {
      const goals = await this.loadGoals();

      if (goals.length === 0) {
        this.state = 'idle';
        this.lastStopReason = 'Нет активных целей';
        return {
          success: true,
          message: 'Нет активных целей — циклу нечего выполнять',
          status: this.getStatus(),
          iterations: [],
          lessons: [],
        };
      }

      for (const goal of goals) {
        // ── Проверки продолжения ──
        if (this.stopRequested) {
          stopReason = this.lastStopReason ?? 'Остановка запрошена';
          break;
        }
        if (iterations.length >= limits.maxIterationsPerCycle) {
          stopReason = `Достигнут лимит итераций (${limits.maxIterationsPerCycle})`;
          break;
        }
        const elapsed = this.now().getTime() - cycleStart;
        if (elapsed >= limits.maxCycleDurationMs) {
          stopReason = `Достигнут лимит длительности цикла (${limits.maxCycleDurationMs} мс)`;
          break;
        }

        // ── Итерация: план → действие → оценка → урок ──
        const record = await this.runIteration(goal, limits);
        iterations.push(record);
        this.totalIterations += 1;
        this.pushHistory(record);
        if (record.lesson) {
          lessons.push(record.lesson);
        }

        if (record.success) {
          this.consecutiveFailures = 0;
          await this.safeMarkCompleted(goal, record);
        } else {
          this.consecutiveFailures += 1;
          await this.safeMarkBlocked(goal, record);
          if (this.consecutiveFailures >= limits.maxConsecutiveFailures) {
            stopReason =
              `Аварийная остановка: ${this.consecutiveFailures} провала(ов) ` +
              `подряд (лимит ${limits.maxConsecutiveFailures})`;
            break;
          }
        }
      }

      this.state = 'idle';
      this.lastStopReason =
        stopReason ??
        `Цикл завершён: обработаны все цели (${iterations.length})`;
      return {
        success: true,
        message: this.lastStopReason,
        status: this.getStatus(),
        iterations,
        lessons,
      };
    } catch (err) {
      this.state = 'stopped';
      this.lastStopReason = err instanceof Error ? err.message : String(err);
      throw new AutonomousLoopError(
        `AutonomousLoop: цикл прерван ошибкой (${this.lastStopReason})`,
        { cause: err },
      );
    }
  }

  /** Одна итерация: выполнить цель, оценить, записать в FeedbackLoop */
  private async runIteration(
    goal: AutonomousGoalContext,
    limits: AutonomousLimits,
  ): Promise<IterationRecord> {
    const id = `iter-${this.now().getTime()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const startedAt = this.now().toISOString();
    const record: IterationRecord = {
      id,
      startedAt,
      goalId: goal.goalId,
      goalName: goal.name,
      success: false,
    };

    let result: GoalPlanResult;
    try {
      result = await this.executor(goal, limits);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record.completedAt = this.now().toISOString();
      record.error = message;
      record.lesson = `Провал: выполнение цели «${goal.name}» упало (${message}) — избегать повторения, разбить цель на подзадачи.`;
      return record;
    }

    record.result = result;

    // ── Оценка результата ──
    let verdict: OutcomeVerdict;
    try {
      verdict = await this.evaluator({ goal, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record.completedAt = this.now().toISOString();
      record.error = `Оценщик упал: ${message}`;
      record.lesson = `Провал оценки результата цели «${goal.name}» (${message}) — проверь OutcomeEvaluator.`;
      return record;
    }
    record.outcome = verdict.outcome;

    // ── Самообучение: решение → результат → награда ──
    const decisionId = `auto-${this.now().getTime()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const decision: DecisionRecord = {
      id: decisionId,
      createdAt: startedAt,
      userQuestion: `[autonomous] ${goal.name}: ${goal.description}`,
      category: goal.type,
      tickers: [],
      recommendedAction: result.recommendedAction,
      reasoning: result.reasoning,
      confidence: result.confidence,
      agentRoles: result.agentRoles,
      metadata: { goalId: goal.goalId, iterationId: id },
    };
    const outcome: Omit<OutcomeRecord, 'recordedAt'> = {
      decisionId,
      actualAction: result.recommendedAction,
      outcome: verdict.outcome,
      satisfaction: verdict.satisfaction,
      notes: verdict.notes,
      implemented: result.success,
      metadata: { goalId: goal.goalId, iterationId: id },
    };
    try {
      await this.feedback.execute('track-decision', decision);
      await this.feedback.execute('record-outcome', outcome);
      await this.feedback.execute('update-weights', {
        decisionId,
        action: result.recommendedAction,
        reward: verdict.outcome === 'positive' ? 1 : -1,
        category: goal.type,
      });
      record.decisionId = decisionId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record.completedAt = this.now().toISOString();
      record.error = `FeedbackLoop не принял запись: ${message}`;
      record.lesson = `Провал записи самообучения для «${goal.name}» (${message}) — решение не учтено в весах.`;
      return record;
    }

    // ── Урок ──
    record.success = result.success && verdict.outcome !== 'negative';
    record.completedAt = this.now().toISOString();
    record.lesson =
      verdict.outcome === 'positive'
        ? `Успех: действие «${result.recommendedAction}» для цели «${goal.name}» сработало${verdict.notes ? ` (${verdict.notes})` : ''} — повторять при схожих целях.`
        : verdict.outcome === 'negative'
          ? `Провал: действие «${result.recommendedAction}» для цели «${goal.name}» не дало результата${verdict.notes ? ` (${verdict.notes})` : ''} — избегать повторения.`
          : `Нейтрально: действие «${result.recommendedAction}» для цели «${goal.name}» без заметного эффекта${
              verdict.notes ? ` (${verdict.notes})` : ''
            } — искать другой подход.`;
    return record;
  }

  /** Загрузить и отсортировать активные цели (critical → low) */
  private async loadGoals(): Promise<AutonomousGoalContext[]> {
    let goals: AutonomousGoalContext[];
    try {
      goals = await this.goalSource.getActiveGoals();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AutonomousLoopError(
        `AutonomousLoop: источник целей недоступен (${message})`,
        { cause: err },
      );
    }
    if (!Array.isArray(goals)) {
      throw new AutonomousLoopError(
        'AutonomousLoop: goalSource.getActiveGoals() вернул не массив',
      );
    }
    return [...goals].sort(
      (a, b) =>
        (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99),
    );
  }

  /** Безопасная пометка цели завершённой (падение не роняет цикл) */
  private async safeMarkCompleted(
    goal: AutonomousGoalContext,
    record: IterationRecord,
  ): Promise<void> {
    try {
      await this.goalSource.markCompleted(
        goal.goalId,
        record.lesson ?? 'Выполнено автономным циклом',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record.error = `Цель выполнена, но markCompleted упал: ${message}`;
    }
  }

  /** Безопасная пометка цели заблокированной (опциональный метод) */
  private async safeMarkBlocked(
    goal: AutonomousGoalContext,
    record: IterationRecord,
  ): Promise<void> {
    try {
      await this.goalSource.markBlocked?.(
        goal.goalId,
        record.lesson ?? 'Провалено автономным циклом',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record.error = `markBlocked упал: ${message}`;
    }
  }

  /** Добавить запись в историю с обрезкой (защита памяти) */
  private pushHistory(record: IterationRecord): void {
    this.history.push(record);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
  }
}

// ──────────────────────────────────────────────
// 3. Дефолтный оценщик и фабрика GoalSource
// ──────────────────────────────────────────────

/** Оценщик по умолчанию: success → positive, иначе negative */
export const defaultEvaluator: OutcomeEvaluator = ({ result }) => ({
  outcome: result.success ? 'positive' : 'negative',
  satisfaction: result.success ? 4 : 2,
});

/**
 * Фабрика GoalSource поверх GoalAgent (агент уже реализует execute).
 * Использует actions: list (status=active), complete, update (status=paused).
 */
export function createGoalSourceFromGoalAgent(goalAgent: {
  execute(input: unknown): Promise<{ success: boolean; data?: unknown }>;
}): GoalSource {
  return {
    async getActiveGoals() {
      const response = await goalAgent.execute({
        action: 'list',
        params: { status: 'active' },
      });
      const data = response?.data as
        | {
            goals?: Array<{
              id: string;
              name: string;
              description: string;
              type: string;
              priority: string;
              tags?: string[];
            }>;
          }
        | undefined;
      return (data?.goals ?? []).map((goal) => ({
        goalId: goal.id,
        name: goal.name,
        description: goal.description,
        type: String(goal.type),
        priority: String(goal.priority),
        tags: goal.tags ?? [],
      }));
    },
    async markCompleted(goalId: string, note: string) {
      await goalAgent.execute({
        action: 'update',
        params: { id: goalId, status: 'completed' },
      });
      await goalAgent
        .execute({
          action: 'complete',
          params: { id: goalId, metrics: { note: 0 } },
        })
        .catch(() => undefined);
      void note;
    },
    async markBlocked(goalId: string, note: string) {
      await goalAgent.execute({
        action: 'update',
        params: { id: goalId, status: 'paused' },
      });
      void note;
    },
  };
}
