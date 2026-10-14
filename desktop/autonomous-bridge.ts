/**
 * AutonomousBridge — автономный цикл Директора внутри десктоп-приложения.
 *
 * Встраивает «нервную систему» (AutonomousLoop + GoalAgent) в main-процесс:
 * - цели хранятся в том же персистентном хранилище, что и CLI
 *   (<dataDir>/goals.json) — watch-режим терминала и приложение видят
 *   одни и те же цели;
 * - фоновый таймер: раз в интервал перечитывает цели и выполняет один
 *   цикл (цель → Директор → агенты → урок);
 * - опасные роли (terminal/process) запрещены limits.forbiddenRoles —
 *   как в scripts/autonomous-session.ts;
 * - управление из чата: /goal «текст», /goals, /autonomous on|off|status.
 */

import { GoalAgent } from '../src/js/modules/pipeline/agents/goal-agent/goal-agent.js';
import {
  AutonomousLoop,
  createGoalSourceFromGoalAgent,
} from '../src/js/modules/pipeline/autonomous-loop/autonomous-loop.js';
import type {
  AutonomousLimits,
  AutonomousLoopOutput,
} from '../src/js/modules/pipeline/autonomous-loop/types.js';
import type { Goal } from '../src/js/modules/pipeline/agents/goal-agent/types.js';

/** Минимальный контракт Директора (настоящий DirectorAgent или fake в тестах) */
export interface DirectorLike {
  processUserMessage(question: string): Promise<{
    text?: string;
    /** action структурно совместим с AiAction | null (String() в исполнителе) */
    recommendation?: { action?: unknown; confidence?: number } | undefined;
    task?:
      { agentResults?: Array<{ role: string; success: boolean }> } | undefined;
  }>;
}

/** Событие завершения итерации (для renderer-уведомлений) */
export interface AutonomousIterationEvent {
  goalId: string;
  goalName: string;
  success: boolean;
  outcome?: string;
  lesson?: string;
}

/** Опции моста (DI для тестов) */
export interface AutonomousBridgeOptions {
  /** Директор приложения (исполнитель целей) */
  director: DirectorLike;
  /** Логгер (по умолчанию console) */
  log?: (level: 'info' | 'warn', message: string) => void;
  /** Интервал фонового цикла, сек (по умолчанию 60) */
  intervalSec?: number;
  /** Лимиты цикла (по умолчанию — как в autonomous-session) */
  limits?: Partial<AutonomousLimits>;
  /** Инжектируемый GoalAgent (для тестов); по умолчанию — персистентный */
  goalAgent?: GoalAgent;
  /** Колбэк после цикла с итерациями (уведомления в UI) */
  onCycle?: (events: AutonomousIterationEvent[]) => void;
}

/** Запрещённые роли в автономном режиме (безопасность) */
const FORBIDDEN_ROLES = ['terminal', 'process', 'package'];

/**
 * Роль самоулучшения: РАЗРЕШЕНА в автономном режиме (не входит в
 * FORBIDDEN_ROLES), потому что ВСЕ её операции с компьютером (file/terminal/
 * code) проходят через SecurityAgent внутри SelfImprovementLoop
 * (allow / deny / require-confirmation). Отдельный запрет не требуется.
 */
export const SELF_IMPROVE_ROLE = 'self-improve';

const DEFAULT_INTERVAL_SEC = 60;

/** Результат операций моста (для IPC и чата) */
export interface BridgeStatus {
  running: boolean;
  intervalSec: number;
  loop: {
    state: string;
    totalIterations: number;
    consecutiveFailures: number;
    lastStopReason?: string;
  };
  activeGoals: number;
}

export class AutonomousBridge {
  private readonly director: DirectorLike;
  private readonly goalAgent: GoalAgent;
  private readonly loop: AutonomousLoop;
  private readonly log: (level: 'info' | 'warn', message: string) => void;
  private readonly onCycle?: (events: AutonomousIterationEvent[]) => void;
  private intervalSec: number;
  private timer: NodeJS.Timeout | null = null;
  private cycling = false;

  constructor(options: AutonomousBridgeOptions) {
    this.director = options.director;
    this.onCycle = options.onCycle;
    this.log =
      options.log ??
      ((level, message) => {
        const prefix = level === 'warn' ? '⚠️' : 'ℹ️';
        console[level](`[autonomous] ${prefix} ${message}`);
      });
    this.intervalSec = options.intervalSec ?? DEFAULT_INTERVAL_SEC;
    this.goalAgent =
      options.goalAgent ?? new GoalAgent({ name: 'GoalAgent-desktop' });
    this.loop = new AutonomousLoop({
      goalSource: createGoalSourceFromGoalAgent(this.goalAgent),
      executor: this.buildExecutor(),
      limits: options.limits,
    });
  }

  /** «Руки» цикла: цель → вопрос Директору → контроль запрещённых ролей */
  private buildExecutor() {
    return async (
      goal: { goalId: string; name: string; description: string },
      _limits: AutonomousLimits,
    ) => {
      const userQuestion = `[autonomous] ${goal.name}: ${goal.description}`;
      this.log('info', `🎯 Цель: ${goal.name}`);
      const response = await this.director.processUserMessage(userQuestion);

      const agentRoles =
        response.task?.agentResults?.map((entry) => entry.role) ?? [];
      const forbidden = agentRoles.filter((role) =>
        FORBIDDEN_ROLES.includes(role),
      );
      if (forbidden.length > 0) {
        return {
          userQuestion,
          recommendedAction: 'BLOCKED',
          success: false,
          confidence: 0,
          agentRoles,
          reasoning: `Автономный режим: выполнены запрещённые роли (${forbidden.join(', ')})`,
        };
      }

      const allSucceeded =
        response.task?.agentResults?.every((entry) => entry.success) ?? false;
      const action = String(response.recommendation?.action ?? 'NONE');
      // self-improve разрешена: её операции проходят через SecurityAgent
      // внутри SelfImprovementLoop (allow/deny/require-confirmation).
      const gatedNote = agentRoles.includes(SELF_IMPROVE_ROLE)
        ? ' [self-improve: операции через SecurityAgent]'
        : '';
      return {
        userQuestion,
        recommendedAction: action,
        success: allSucceeded,
        confidence: response.recommendation?.confidence ?? 0.5,
        agentRoles,
        reasoning: `${(response.text ?? '').slice(0, 500)}${gatedNote}`,
      };
    };
  }

  // ─── Цели ─────────────────────────────────────────────────────────

  /** Добавить цель и активировать её (та же механика, что в CLI) */
  async addGoal(text: string): Promise<Goal> {
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new Error('Текст цели пуст');
    const added = await this.goalAgent.execute({
      action: 'add',
      params: {
        name: trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed,
        description: trimmed,
        type: 'action',
        priority: 'high',
      },
    });
    if (!added.success) {
      throw new Error(
        added.error instanceof Error
          ? added.error.message
          : 'Цель не добавлена',
      );
    }
    const goal = (added.data as { goal: Goal }).goal;
    await this.goalAgent.execute({
      action: 'update',
      params: { id: goal.id, status: 'active' },
    });
    this.log('info', `🎯 Цель добавлена и активирована: «${goal.name}»`);
    return goal;
  }

  /** Список целей (с фильтром по статусу, опционально) */
  async listGoals(status?: Goal['status']): Promise<Goal[]> {
    const result = await this.goalAgent.execute({
      action: 'list',
      params: status ? { status } : undefined,
    });
    return (result.data as { goals: Goal[] } | undefined)?.goals ?? [];
  }

  // ─── Цикл ─────────────────────────────────────────────────────────

  /** Один цикл прямо сейчас (выполняет до limits.maxIterationsPerCycle целей) */
  async runOnce(): Promise<AutonomousLoopOutput | null> {
    if (this.cycling) {
      return null;
    }
    return this.safeCycle();
  }

  /** Включить фоновый цикл (watch) */
  async start(intervalSec?: number): Promise<BridgeStatus> {
    if (intervalSec && intervalSec > 0) this.intervalSec = intervalSec;
    if (this.timer) {
      this.log(
        'warn',
        `Автономный цикл уже запущен (интервал ${this.intervalSec} с)`,
      );
    } else {
      this.timer = setInterval(() => {
        void this.safeCycle();
      }, this.intervalSec * 1000);
      this.log(
        'info',
        `👀 Автономный цикл запущен: каждые ${this.intervalSec} с`,
      );
    }
    return this.status();
  }

  /** Выключить фоновый цикл */
  async stop(): Promise<BridgeStatus> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.log('info', '⏹ Автономный цикл остановлен');
    }
    this.loop.stop('Автономный цикл остановлен пользователем');
    return this.status();
  }

  /** Текущий статус моста */
  async status(): Promise<BridgeStatus> {
    const active = await this.listGoals('active');
    const loopStatus = this.loop.getStatus();
    return {
      running: this.timer !== null,
      intervalSec: this.intervalSec,
      loop: {
        state: loopStatus.state,
        totalIterations: loopStatus.totalIterations,
        consecutiveFailures: loopStatus.consecutiveFailures,
        lastStopReason: loopStatus.lastStopReason,
      },
      activeGoals: active.length,
    };
  }

  /** Остановить таймер при закрытии приложения */
  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Цикл без падения процесса: ошибки логируются */
  private async safeCycle(): Promise<AutonomousLoopOutput | null> {
    if (this.cycling) return null;
    this.cycling = true;
    try {
      // Подхватить цели, добавленные внешне (CLI/другим процессом)
      await this.goalAgent.reload();
      const output = await this.loop.execute('run-cycle');
      if (output.iterations && output.iterations.length > 0) {
        this.log(
          'info',
          `📋 Автономный цикл: ${output.iterations.length} итераций — ${output.message}`,
        );
        // Уведомления в UI (тост + обновление вкладки «Цели»)
        if (this.onCycle) {
          const events: AutonomousIterationEvent[] = output.iterations.map(
            (iteration) => ({
              goalId: iteration.goalId,
              goalName: iteration.goalName,
              success: iteration.success,
              outcome: iteration.outcome,
              lesson: iteration.lesson,
            }),
          );
          try {
            this.onCycle(events);
          } catch {
            // Уведомления не должны ломать цикл
          }
        }
      }
      return output;
    } catch (err) {
      this.log(
        'warn',
        `Автономный цикл упал: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    } finally {
      this.cycling = false;
    }
  }
}

/** Создать мост поверх DirectorAgent приложения */
export function createAutonomousBridge(
  options: AutonomousBridgeOptions,
): AutonomousBridge {
  return new AutonomousBridge(options);
}
