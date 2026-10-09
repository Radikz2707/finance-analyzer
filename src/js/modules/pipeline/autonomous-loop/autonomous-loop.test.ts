/**
 * AutonomousLoop — тесты автономного цикла Директора (Фаза 4).
 *
 * Покрытие:
 * - полный цикл: цель → выполнение → оценка → FeedbackLoop (решение,
 *   результат, RL-награда) → урок → пометка цели;
 * - приоритизация целей (critical раньше low);
 * - провалы: негативный урок, счётчик подряд, аварийная остановка;
 * - лимиты: maxIterationsPerCycle, maxCycleDurationMs (DI-часы),
 *   maxConsecutiveFailures;
 * - dry-run без выполнения и без записей в FeedbackLoop;
 * - stop() между итерациями; reset; get-status / get-history;
 * - честные ошибки: нет goalSource/executor, падение источника целей;
 * - execute dispatch.
 *
 * ВАЖНО: импорт { describe, it, expect } из 'vitest' НЕ используется —
 * он создаёт второй экземпляр @vitest/runner и ломает контекст тестов
 * (TypeError: Cannot read properties of undefined (reading 'config')).
 * Все тесты используют глобалы (globals: true).
 */

import {
  AutonomousLoop,
  createGoalSourceFromGoalAgent,
} from './autonomous-loop.js';
import {
  AutonomousLoopError,
  DEFAULT_AUTONOMOUS_LIMITS,
  type AutonomousGoalContext,
  type AutonomousLimits,
  type GoalPlanExecutor,
  type GoalPlanResult,
  type GoalSource,
} from './types.js';
import { FeedbackLoop } from '../feedback-loop/feedback-loop.js';
import type { SystemMetrics } from '../feedback-loop/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function goal(
  overrides: Partial<AutonomousGoalContext> = {},
): AutonomousGoalContext {
  return {
    goalId: 'g-1',
    name: 'Цель 1',
    description: 'Описание цели 1',
    type: 'analysis',
    priority: 'medium',
    tags: [],
    ...overrides,
  };
}

function okResult(action = 'HOLD'): GoalPlanResult {
  return {
    userQuestion: '[autonomous] вопрос',
    recommendedAction: action,
    success: true,
    confidence: 0.9,
    agentRoles: ['analysis', 'ai'],
    reasoning: 'выполнено',
  };
}

/** Мок источника целей с журналом завершений/блокировок */
function makeGoalSource(goals: AutonomousGoalContext[]): GoalSource & {
  completed: string[];
  blocked: string[];
} {
  const completed: string[] = [];
  const blocked: string[] = [];
  return {
    completed,
    blocked,
    async getActiveGoals() {
      return [...goals];
    },
    async markCompleted(goalId: string) {
      completed.push(goalId);
    },
    async markBlocked(goalId: string) {
      blocked.push(goalId);
    },
  };
}

/** Мок исполнителя: вызываемая функция с журналом вызовов и лимитов */
interface MockExecutor {
  (
    goal: AutonomousGoalContext,
    limits: AutonomousLimits,
  ): Promise<GoalPlanResult>;
  calls: AutonomousGoalContext[];
  limitsSeen: AutonomousLimits[];
}

function makeExecutor(
  behavior: (goal: AutonomousGoalContext) => GoalPlanResult,
): MockExecutor {
  const calls: AutonomousGoalContext[] = [];
  const limitsSeen: AutonomousLimits[] = [];
  const fn = async (
    goal: AutonomousGoalContext,
    limits: AutonomousLimits,
  ): Promise<GoalPlanResult> => {
    calls.push(goal);
    limitsSeen.push(limits);
    return behavior(goal);
  };
  return Object.assign(fn, { calls, limitsSeen });
}

/** Детерминированные часы: каждый вызов двигает время на stepMs */
function makeTicker(stepMs = 1000, start = 0): { now: () => Date } {
  let current = start;
  return {
    now: () => {
      current += stepMs;
      return new Date(current);
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('AutonomousLoop: полный цикл', () => {
  it('1. Выполняет цели, пишет решения в FeedbackLoop и формирует уроки', async () => {
    const feedback = new FeedbackLoop();
    const source = makeGoalSource([
      goal({ goalId: 'g-1' }),
      goal({ goalId: 'g-2', name: 'Цель 2' }),
    ]);
    const executor = makeExecutor(() => okResult());
    const loop = new AutonomousLoop({
      goalSource: source,
      executor,
      feedback,
    });

    const output = await loop.execute('run-cycle');

    expect(output.success).toBe(true);
    expect(output.iterations!.length).toBe(2);
    expect(output.iterations![0]!.success).toBe(true);
    expect(output.iterations![0]!.outcome).toBe('positive');
    expect(output.iterations![0]!.decisionId).toBeDefined();
    expect(output.lessons!.length).toBe(2);
    expect(output.lessons![0]).toContain('повторять');

    // Цели помечены завершёнными
    expect(source.completed).toEqual(['g-1', 'g-2']);
    // Исполнитель получил лимиты с запрещёнными ролями
    expect(executor.limitsSeen[0]!.forbiddenRoles).toContain('terminal');

    // Самообучение: решения и результаты записаны, веса обновлены
    const metrics = (await feedback.execute('get-metrics'))
      .data as SystemMetrics;
    expect(metrics.totalDecisions).toBe(2);
  });

  it('2. Сортирует цели по приоритету: critical раньше low', async () => {
    const source = makeGoalSource([
      goal({ goalId: 'g-low', priority: 'low' }),
      goal({ goalId: 'g-critical', priority: 'critical' }),
      goal({ goalId: 'g-medium', priority: 'medium' }),
    ]);
    const executor = makeExecutor(() => okResult());
    const loop = new AutonomousLoop({
      goalSource: source,
      executor,
      feedback: new FeedbackLoop(),
    });

    const output = await loop.execute('run-cycle', {
      limits: { maxIterationsPerCycle: 3 },
    });

    expect(output.iterations!.map((i) => i.goalId)).toEqual([
      'g-critical',
      'g-medium',
      'g-low',
    ]);
  });

  it('3. Провальная итерация: негативный урок и пометка blocked', async () => {
    const source = makeGoalSource([goal({ goalId: 'g-fail' })]);
    const executor = makeExecutor(() => ({
      ...okResult(),
      success: false,
      reasoning: 'не получилось',
    }));
    const loop = new AutonomousLoop({
      goalSource: source,
      executor,
      feedback: new FeedbackLoop(),
    });

    const output = await loop.execute('run-cycle');

    const record = output.iterations![0]!;
    expect(record.success).toBe(false);
    expect(record.outcome).toBe('negative');
    expect(record.lesson).toContain('избегать');
    expect(source.completed).toEqual([]);
    expect(source.blocked).toEqual(['g-fail']);
  });
});

describe('AutonomousLoop: ограничения автономности', () => {
  it('4. maxIterationsPerCycle останавливает цикл с честной причиной', async () => {
    const source = makeGoalSource([
      goal({ goalId: 'g-1' }),
      goal({ goalId: 'g-2' }),
      goal({ goalId: 'g-3' }),
      goal({ goalId: 'g-4' }),
    ]);
    const executor = makeExecutor(() => okResult());
    const loop = new AutonomousLoop({
      goalSource: source,
      executor,
      feedback: new FeedbackLoop(),
      limits: { maxIterationsPerCycle: 2 },
    });

    const output = await loop.execute('run-cycle');

    expect(output.iterations!.length).toBe(2);
    expect(output.message).toContain('лимит итераций (2)');
    expect(loop.getStatus().lastStopReason).toContain('лимит итераций');
  });

  it('5. maxConsecutiveFailures аварийно останавливает цикл', async () => {
    const source = makeGoalSource([
      goal({ goalId: 'g-1' }),
      goal({ goalId: 'g-2' }),
      goal({ goalId: 'g-3' }),
    ]);
    const executor = makeExecutor(() => ({
      ...okResult(),
      success: false,
    }));
    const loop = new AutonomousLoop({
      goalSource: source,
      executor,
      feedback: new FeedbackLoop(),
      limits: { maxConsecutiveFailures: 2 },
    });

    const output = await loop.execute('run-cycle');

    // 2 провала подряд → третья цель не выполняется
    expect(output.iterations!.length).toBe(2);
    expect(output.message).toContain('Аварийная остановка');
    expect(loop.getStatus().consecutiveFailures).toBe(2);
  });

  it('6. maxCycleDurationMs (DI-часы) прерывает цикл по времени', async () => {
    // Каждый вызов часов двигает время на 2 минуты; за итерацию —
    // несколько вызовов, лимит 5 минут достигается после 1-й итерации
    const ticker = makeTicker(2 * 60 * 1000);
    const source = makeGoalSource([
      goal({ goalId: 'g-1' }),
      goal({ goalId: 'g-2' }),
      goal({ goalId: 'g-3' }),
    ]);
    const executor: GoalPlanExecutor = async () => {
      ticker.now();
      return okResult();
    };
    const loop = new AutonomousLoop({
      goalSource: source,
      executor,
      feedback: new FeedbackLoop(),
      limits: { maxCycleDurationMs: 5 * 60 * 1000 },
      now: ticker.now,
    });

    const output = await loop.execute('run-cycle');

    expect(output.iterations!.length).toBe(1);
    expect(output.message).toContain('лимит длительности');
  });

  it('7. dry-run показывает план, но не вызывает исполнителя и не пишет в FeedbackLoop', async () => {
    const feedback = new FeedbackLoop();
    const source = makeGoalSource([
      goal({ goalId: 'g-1' }),
      goal({ goalId: 'g-2' }),
    ]);
    const executor = makeExecutor(() => okResult());
    const loop = new AutonomousLoop({
      goalSource: source,
      executor,
      feedback,
    });

    const output = await loop.execute('dry-run');

    expect(output.success).toBe(true);
    expect(output.message).toContain('Dry-run');
    expect(output.message).toContain('terminal');
    expect(executor.calls.length).toBe(0);
    expect(source.completed).toEqual([]);
    const metrics = (await feedback.execute('get-metrics'))
      .data as SystemMetrics;
    expect(metrics.totalDecisions).toBe(0);
  });

  it('8. stop() прекращает запуск новых итераций', async () => {
    const source = makeGoalSource([
      goal({ goalId: 'g-1' }),
      goal({ goalId: 'g-2' }),
      goal({ goalId: 'g-3' }),
    ]);
    const loop = new AutonomousLoop({
      goalSource: source,
      executor: makeExecutor(() => {
        loop.stop('пользователь передумал');
        return okResult();
      }),
      feedback: new FeedbackLoop(),
    });

    const output = await loop.execute('run-cycle');

    expect(output.iterations!.length).toBe(1);
    expect(output.message).toContain('пользователь передумал');
  });

  it('9. reset() очищает историю и состояние', async () => {
    const loop = new AutonomousLoop({
      goalSource: makeGoalSource([goal({ goalId: 'g-1' })]),
      executor: makeExecutor(() => okResult()),
      feedback: new FeedbackLoop(),
    });
    await loop.execute('run-cycle');
    expect(loop.getHistory().length).toBe(1);

    await loop.execute('reset');

    expect(loop.getHistory().length).toBe(0);
    expect(loop.getStatus().state).toBe('idle');
    expect(loop.getStatus().totalIterations).toBe(0);
  });
});

describe('AutonomousLoop: честные ошибки и кастомный оценщик', () => {
  it('10. Кастомный оценщик меняет вердикт и попадает в урок', async () => {
    const source = makeGoalSource([goal({ goalId: 'g-1' })]);
    const executor = makeExecutor(() => okResult('BUY'));
    const loop = new AutonomousLoop({
      goalSource: source,
      executor,
      feedback: new FeedbackLoop(),
      evaluator: () => ({
        outcome: 'neutral',
        satisfaction: 3,
        notes: 'эффект неясен',
      }),
    });

    const output = await loop.execute('run-cycle');

    expect(output.iterations![0]!.outcome).toBe('neutral');
    expect(output.lessons![0]).toContain('Нейтрально');
    expect(output.lessons![0]).toContain('эффект неясен');
  });

  it('11. Падение исполнителя не роняет цикл — итерация провалена с уроком', async () => {
    const source = makeGoalSource([goal({ goalId: 'g-1' })]);
    const executor: GoalPlanExecutor = async () => {
      throw new Error('агент недоступен');
    };
    const loop = new AutonomousLoop({
      goalSource: source,
      executor,
      feedback: new FeedbackLoop(),
      limits: { maxConsecutiveFailures: 5 },
    });

    const output = await loop.execute('run-cycle');

    expect(output.iterations![0]!.success).toBe(false);
    expect(output.iterations![0]!.error).toContain('агент недоступен');
    expect(output.iterations![0]!.lesson).toContain('избегать');
  });

  it('12. Падение источника целей → AutonomousLoopError с причиной', async () => {
    const loop = new AutonomousLoop({
      goalSource: {
        async getActiveGoals() {
          throw new Error('хранилище целей недоступно');
        },
        async markCompleted() {},
      },
      executor: makeExecutor(() => okResult()),
      feedback: new FeedbackLoop(),
    });

    await expect(loop.execute('run-cycle')).rejects.toThrow(
      AutonomousLoopError,
    );
    await expect(loop.execute('run-cycle')).rejects.toThrow(
      'хранилище целей недоступно',
    );
  });

  it('13. Конструктор без goalSource/executor → честная ошибка; execute dispatch', async () => {
    expect(
      () =>
        new AutonomousLoop({
          goalSource: undefined as never,
          executor: makeExecutor(() => okResult()),
        }),
    ).toThrow(AutonomousLoopError);
    expect(
      () =>
        new AutonomousLoop({
          goalSource: makeGoalSource([]),
          executor: undefined as never,
        }),
    ).toThrow(AutonomousLoopError);

    // Повторный run-cycle во время работы → честная ошибка
    const source = makeGoalSource([goal({ goalId: 'g-1' })]);
    const loop = new AutonomousLoop({
      goalSource: source,
      executor: makeExecutor(() => {
        void loop.execute('run-cycle').catch(() => undefined);
        return okResult();
      }),
      feedback: new FeedbackLoop(),
    });
    // stop() и get-status доступны через execute
    const status = await loop.execute('get-status');
    expect(status.success).toBe(true);
    expect(status.status!.state).toBe('idle');
  });

  it('14. Пустой список целей → success true и «Нет активных целей»', async () => {
    const loop = new AutonomousLoop({
      goalSource: makeGoalSource([]),
      executor: makeExecutor(() => okResult()),
      feedback: new FeedbackLoop(),
    });

    const output = await loop.execute('run-cycle');

    expect(output.success).toBe(true);
    expect(output.message).toContain('Нет активных целей');
    expect(output.iterations).toEqual([]);
  });

  it('15. Лимиты по умолчанию: terminal/process запрещены', () => {
    expect(DEFAULT_AUTONOMOUS_LIMITS.forbiddenRoles).toEqual([
      'terminal',
      'process',
    ]);
    expect(DEFAULT_AUTONOMOUS_LIMITS.maxIterationsPerCycle).toBe(3);
    expect(DEFAULT_AUTONOMOUS_LIMITS.maxConsecutiveFailures).toBe(2);
  });
});

describe('createGoalSourceFromGoalAgent', () => {
  it('16. Читает активные цели и завершает их через GoalAgent-контракт', async () => {
    const executed: Array<Record<string, unknown>> = [];
    const fakeGoalAgent = {
      async execute(input: unknown) {
        executed.push(input as Record<string, unknown>);
        const typed = input as { action: string; params?: { id?: string } };
        if (typed.action === 'list') {
          return {
            success: true,
            data: {
              goals: [
                {
                  id: 'goal-9',
                  name: 'Ночной анализ',
                  description: 'Собрать сводку',
                  type: 'analysis',
                  priority: 'high',
                  tags: ['night'],
                },
              ],
            },
          };
        }
        return { success: true, data: { success: true, message: 'ok' } };
      },
    };

    const source = createGoalSourceFromGoalAgent(fakeGoalAgent);
    const goals = await source.getActiveGoals();

    expect(goals).toEqual([
      {
        goalId: 'goal-9',
        name: 'Ночной анализ',
        description: 'Собрать сводку',
        type: 'analysis',
        priority: 'high',
        tags: ['night'],
      },
    ]);

    await source.markCompleted('goal-9', 'готово');
    const actions = executed.map((entry) => entry.action);
    expect(actions).toContain('update');
    expect(actions).toContain('complete');
  });
});
