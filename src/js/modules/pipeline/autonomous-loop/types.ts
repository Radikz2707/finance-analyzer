/**
 * AutonomousLoop — типы автономного цикла Директора (Фаза 4).
 *
 * «Нервная система» агента-организма: непрерывный цикл
 * цель → план → действие → оценка → урок → следующая итерация.
 *
 * Принципы безопасности (границы автономности):
 * - цикл выполняет ТОЛЬКО активные цели из GoalSource (GoalAgent);
 * - опасные роли (terminal/process) по умолчанию ЗАПРЕЩЕНЫ в
 *   автономном режиме — исполнитель получает limits и отвечает за
 *   фильтрацию;
 * - лимиты: maxIterationsPerCycle, maxCycleDurationMs,
 *   maxConsecutiveFailures — цикл останавливается честно, с сообщением;
 * - каждое решение трекается в FeedbackLoop (track-decision →
 *   record-outcome → update-weights) — цикл самообучается;
 * - dryRun позволяет посмотреть план без выполнения.
 */

// ──────────────────────────────────────────────
// 1. Цели и планирование
// ──────────────────────────────────────────────

/** Контекст цели, передаваемый исполнителю */
export interface AutonomousGoalContext {
  /** ID цели в GoalAgent */
  goalId: string;
  /** Название цели */
  name: string;
  /** Описание цели */
  description: string;
  /** Тип цели (tracking/analysis/alert/action/research) */
  type: string;
  /** Приоритет (critical/high/medium/low) */
  priority: string;
  /** Теги цели */
  tags: string[];
}

/** Ограничения автономности (передаются исполнителю КАЖДОЙ итерации) */
export interface AutonomousLimits {
  /** Максимум итераций за цикл */
  maxIterationsPerCycle: number;
  /** Максимум длительность цикла, мс */
  maxCycleDurationMs: number;
  /** Провалов подряд до аварийной остановки */
  maxConsecutiveFailures: number;
  /** Роли, ЗАПРЕЩЁННЫЕ в автономном режиме (по умолчанию terminal/process) */
  forbiddenRoles: string[];
}

/** Лимиты по умолчанию */
export const DEFAULT_AUTONOMOUS_LIMITS: AutonomousLimits = {
  maxIterationsPerCycle: 3,
  maxCycleDurationMs: 5 * 60 * 1000,
  maxConsecutiveFailures: 2,
  forbiddenRoles: ['terminal', 'process'],
};

// ──────────────────────────────────────────────
// 2. Исполнители (DI)
// ──────────────────────────────────────────────

/** Результат выполнения плана цели исполнителем */
export interface GoalPlanResult {
  /** Вопрос/запрос, выполненный конвейером */
  userQuestion: string;
  /** Рекомендованное действие (HOLD/BUY/.../action-имя) */
  recommendedAction: string;
  /** Успех выполнения */
  success: boolean;
  /** Уверенность 0..1 */
  confidence: number;
  /** Роли агентов, участвовавших в выполнении */
  agentRoles: string[];
  /** Обоснование / что сделано */
  reasoning: string;
}

/**
 * Исполнитель плана цели — «руки» цикла. Реализуется через DirectorAgent /
 * pipeline-конвейер. Получает контекст цели и лимиты (обязан соблюдать
 * forbiddenRoles).
 */
export type GoalPlanExecutor = (
  goal: AutonomousGoalContext,
  limits: AutonomousLimits,
) => Promise<GoalPlanResult>;

/** Вердикт оценщика результата */
export interface OutcomeVerdict {
  outcome: 'positive' | 'negative' | 'neutral';
  /** Оценка удовлетворённости 1..5 */
  satisfaction: number;
  /** Заметки (попадают в урок) */
  notes?: string;
}

/**
 * Оценщик результата — «сознание» цикла. По умолчанию: success → positive
 * (satisfaction 4), fail → negative (satisfaction 2).
 */
export type OutcomeEvaluator = (context: {
  goal: AutonomousGoalContext;
  result: GoalPlanResult;
}) => OutcomeVerdict | Promise<OutcomeVerdict>;

/** Источник целей (обёртка над GoalAgent; DI для тестов) */
export interface GoalSource {
  /** Активные цели, отсортированные вызовом (цикл дополнительно сортирует) */
  getActiveGoals(): Promise<AutonomousGoalContext[]>;
  /** Пометить цель завершённой после успешной итерации */
  markCompleted(goalId: string, note: string): Promise<void>;
  /** Пометить цель заблокированной после провала (опционально) */
  markBlocked?(goalId: string, note: string): Promise<void>;
}

// ──────────────────────────────────────────────
// 3. Состояние цикла
// ──────────────────────────────────────────────

/** Запись итерации цикла */
export interface IterationRecord {
  /** Уникальный ID итерации */
  id: string;
  /** Метка времени начала (ISO) */
  startedAt: string;
  /** Метка времени завершения (ISO), undefined для прерванных */
  completedAt?: string;
  /** ID цели */
  goalId: string;
  /** Название цели */
  goalName: string;
  /** ID решения в FeedbackLoop */
  decisionId?: string;
  /** Результат исполнителя */
  result?: GoalPlanResult;
  /** Вердикт оценки */
  outcome?: 'positive' | 'negative' | 'neutral';
  /** Урок, извлечённый из итерации */
  lesson?: string;
  /** Успешна ли итерация в целом */
  success: boolean;
  /** Причина провала */
  error?: string;
}

/** Состояние цикла */
export type LoopState = 'idle' | 'running' | 'stopped';

/** Статус цикла */
export interface LoopStatus {
  state: LoopState;
  /** Итераций выполнено за последний цикл */
  iterations: number;
  /** Провалов подряд */
  consecutiveFailures: number;
  /** Итераций за всё время */
  totalIterations: number;
  startedAt?: string;
  /** Причина остановки последнего цикла */
  lastStopReason?: string;
}

// ──────────────────────────────────────────────
// 4. Входы и выходы фасада
// ──────────────────────────────────────────────

/** Действия AutonomousLoop */
export type AutonomousLoopAction =
  'run-cycle' | 'dry-run' | 'stop' | 'get-status' | 'get-history' | 'reset';

/** Вход execute() */
export interface AutonomousLoopInput {
  /** Переопределение лимитов для конкретного цикла */
  limits?: Partial<AutonomousLimits>;
}

/** Выход execute() */
export interface AutonomousLoopOutput {
  success: boolean;
  message: string;
  status?: LoopStatus;
  /** Итерации последнего цикла */
  iterations?: IterationRecord[];
  /** Уроки последнего цикла */
  lessons?: string[];
}

// ──────────────────────────────────────────────
// 5. Ошибка
// ──────────────────────────────────────────────

/** Честная ошибка цикла */
export class AutonomousLoopError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AutonomousLoopError';
  }
}
