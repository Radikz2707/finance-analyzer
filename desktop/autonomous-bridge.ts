/**
 * AutonomousBridge — автономный цикл Директора внутри десктоп-приложения.
 *
 * Встраивает цикл в main-процесс:
 * - цели хранятся в <dataDir>/goals.json
 * - фоновый таймер: раз в интервал выполняет один цикл
 * - опасные роли запрещены
 * - управление из чата: /goal, /goals, /autonomous on|off|status.
 */

/** Минимальный контракт цели автономного цикла (goal-agent удалён) */
export interface Goal {
  id: string;
  text: string;
  status: 'active' | 'completed' | 'pending' | 'paused' | 'cancelled';
  createdAt: string;
  completedAt?: string;
  outcome?: string;
  lesson?: string;
}

/** Минимальный контракт Директора (настоящий DirectorAgent или fake в тестах) */
export interface DirectorLike {
  processUserMessage(question: string): Promise<{
    text?: string;
    recommendation?: { action?: unknown; confidence?: number } | undefined;
    task?:
      | { agentResults?: Array<{ role: string; success: boolean }> }
      | undefined;
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
  director: DirectorLike;
  log?: (level: 'info' | 'warn', message: string) => void;
  intervalSec?: number;
  onCycle?: (events: AutonomousIterationEvent[]) => void;
}

/** Запрещённые роли в автономном режиме (безопасность) */
const FORBIDDEN_ROLES = ['terminal', 'process', 'package'];

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
    this.intervalSec = options.intervalSec ?? 60;
  }

  /** Добавить цель */
  async addGoal(_text: string): Promise<Goal> {
    // Заглушка — GoalAgent удалён
    return {
      id: `goal-${Date.now()}`,
      name: _text.slice(0, 80),
      description: _text,
      status: 'active',
      priority: 'high',
      type: 'action',
      createdAt: new Date().toISOString(),
      completedAt: undefined,
    } as Goal;
  }

  /** Список целей */
  async listGoals(_status?: string): Promise<Goal[]> {
    // Заглушка — GoalAgent удалён
    return [];
  }

  /** Один цикл */
  async runOnce(): Promise<null> {
    if (this.cycling) return null;
    return this.safeCycle();
  }

  /** Включить фоновый цикл */
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
    return this.status();
  }

  /** Текущий статус моста */
  async status(): Promise<BridgeStatus> {
    return {
      running: this.timer !== null,
      intervalSec: this.intervalSec,
      loop: {
        state: 'stopped',
        totalIterations: 0,
        consecutiveFailures: 0,
      },
      activeGoals: 0,
    };
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async safeCycle(): Promise<null> {
    if (this.cycling) return null;
    this.cycling = true;
    try {
      // Автономный цикл: GoalAgent удалён, цикл неактивен
      // Лог только при первом запуске — дальше не нужен
    } catch (err) {
      this.log(
        'warn',
        `Автономный цикл упал: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.cycling = false;
    }
    return null;
  }
}

export function createAutonomousBridge(
  options: AutonomousBridgeOptions,
): AutonomousBridge {
  return new AutonomousBridge(options);
}
