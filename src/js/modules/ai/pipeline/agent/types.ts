/**
 * Pipeline Agent — базовые типы для мультиагентного конвейера.
 *
 * Каждый агент:
 * - Имеет уникальное имя и статус
 * - Возвращает AgentResult с данными, ошибками и таймингом
 * - Поддерживает graceful shutdown
 */

// ──────────────────────────────────────────────
// 1. Agent lifecycle states
// ──────────────────────────────────────────────

export type AgentState = 'idle' | 'running' | 'paused' | 'error' | 'stopped';

// ──────────────────────────────────────────────
// 2. Agent result
// ──────────────────────────────────────────────

/** Результат выполнения агента */
export interface AgentResult<T = unknown> {
  /** Успешно ли выполнен агент */
  success: boolean;
  /** Данные результата (если success=true) */
  data?: T;
  /** Ошибка (если success=false) */
  error?: Error;
  /** Время выполнения в миллисекундах */
  durationMs: number;
  /** Метка времени завершения */
  completedAt: string;
}

// ──────────────────────────────────────────────
// 3. Agent configuration
// ──────────────────────────────────────────────

/** Конфигурация агента */
export interface AgentConfig {
  /** Уникальное имя агента */
  name: string;
  /** Максимальное время выполнения (мс). 0 = без лимита */
  timeoutMs?: number;
  /** Попытки при ошибке */
  retries?: number;
  /** Задержка между попытками (мс) */
  retryDelayMs?: number;
  /** Флаг подробного логирования */
  verbose?: boolean;
}

// ──────────────────────────────────────────────
// 4. Agent interface
// ──────────────────────────────────────────────

/**
 * Контракт любого агента в конвейере.
 *
 * Agent — это автономная единица, которая:
 * - Принимает входные данные (Input)
 * - Выполняет свою задачу
 * - Возвращает результат (Output)
 * - Сообщает о состоянии
 */
export interface IAgent<Input = unknown, Output = unknown> {
  /** Уникальное имя агента */
  readonly name: string;

  /** Текущее состояние */
  readonly state: AgentState;

  /**
   * Выполнить задачу агента.
   * @param input — входные данные от координатора или предыдущего агента
   * @returns AgentResult с данными результата
   */
  execute(input: Input): Promise<AgentResult<Output>>;

  /**
   * Остановить агента (graceful shutdown).
   * Вызывается координатором при остановке конвейера.
   */
  stop(): Promise<void>;

  /**
   * Получить сводку о последнем выполнении.
   */
  getSummary(): AgentSummary;
}

/** Сводка о выполнении агента */
export interface AgentSummary {
  name: string;
  state: AgentState;
  lastExecution?: {
    startedAt: string;
    completedAt?: string;
    durationMs: number;
    success: boolean;
    error?: string;
  };
  totalExecutions: number;
  totalSuccesses: number;
  totalFailures: number;
}

// ──────────────────────────────────────────────
// 5. Pipeline state (shared between agents)
// ──────────────────────────────────────────────

/**
 * Общее состояние конвейера.
 * Хранится в PipelineCoordinator и передаётся между агентами.
 */
export interface PipelineState {
  /** Уникальный ID запуска конвейера */
  pipelineId: string;
  /** Метка времени запуска */
  startedAt: string;
  /** Флаг остановки конвейера */
  stopped: boolean;
  /** Данные, передаваемые между агентами */
  sharedData: Record<string, unknown>;
}

/** Создать новое состояние конвейера */
export function createPipelineState(): PipelineState {
  return {
    pipelineId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    stopped: false,
    sharedData: {},
  };
}
