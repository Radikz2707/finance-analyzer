/**
 * MetaOrchestrator — управление 20+ агентами, распределение ресурсов,
 * отказоустойчивость, балансировка нагрузки.
 */

// ──────────────────────────────────────────────
// 1. Типы оркестрации
// ──────────────────────────────────────────────

/** Статус оркестратора */
export type OrchestratorStatus = 'idle' | 'running' | 'paused' | 'error';

/** Стратегия выбора агентов */
export type AgentSelectionStrategy =
  | 'fastest' // Самый быстрый
  | 'most-reliable' // Самый надёжный
  | 'load-balanced' // Балансировка нагрузки
  | 'priority'; // По приоритету

/** Уровень приоритета задачи */
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

/** Результат выполнения задачи */
export type TaskResultStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'retrying';

// ──────────────────────────────────────────────
// 2. Интерфейсы задач
// ──────────────────────────────────────────────

/** Задача для оркестратора */
export interface OrchestrationTask {
  id: string;
  name: string;
  description: string;
  priority: TaskPriority;
  agentRole: string;
  input: unknown;
  timeoutMs: number;
  maxRetries: number;
  status: TaskResultStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: unknown;
  retryCount: number;
  metadata?: Record<string, unknown>;
}

// ──────────────────────────────────────────────
// 3. Ресурсы и мониторинг
// ──────────────────────────────────────────────

/** Состояние агента */
export interface AgentInstance {
  role: string;
  instance: unknown;
  status: 'idle' | 'busy' | 'error' | 'offline';
  lastUsedAt?: string;
  totalExecutions: number;
  successRate: number;
  avgExecutionTimeMs: number;
}

/** Использование ресурсов */
export interface ResourceUsage {
  cpuPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  memoryPercent: number;
  activeTasks: number;
  queuedTasks: number;
  apiCallsPerMinute: number;
}

/** Балансировка нагрузки */
export interface LoadBalanceResult {
  selectedAgent: string;
  reason: string;
  loadScore: number; // 0-100, ниже = лучше
}

// ──────────────────────────────────────────────
// 4. Отказоустойчивость
// ──────────────────────────────────────────────

/** Тип сбоя */
export type FailureType =
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'resource_exhaustion'
  | 'unknown';

/** Запись о сбое */
export interface FailureRecord {
  taskId: string;
  agentRole: string;
  failureType: FailureType;
  error: string;
  timestamp: string;
  recoveryAttempted: boolean;
  recoverySuccess: boolean;
}

/** Стратегия восстановления */
export type RecoveryStrategy =
  | 'retry' // Повторить
  | 'fallback-agent' // Альтернативный агент
  | 'skip' // Пропустить
  | 'escalate'; // Сообщить пользователю

// ──────────────────────────────────────────────
// 5. Входы и выходы
// ──────────────────────────────────────────────

/** Действия MetaOrchestrator */
export type MetaOrchestratorAction =
  | 'create-task'
  | 'execute-task'
  | 'get-task-status'
  | 'get-all-tasks'
  | 'cancel-task'
  | 'retry-task'
  | 'get-resource-usage'
  | 'get-agent-status'
  | 'get-failures'
  | 'get-stats'
  | 'set-strategy'
  | 'pause'
  | 'resume'
  | 'stop';

/** Создание задачи */
export interface CreateTaskParams {
  name: string;
  description: string;
  agentRole: string;
  input: unknown;
  priority?: TaskPriority;
  timeoutMs?: number;
  maxRetries?: number;
}

/** Выполнение задачи */
export interface ExecuteTaskParams {
  taskId: string;
}

/** Получение статуса задачи */
export interface GetTaskStatusParams {
  taskId: string;
}

/** Получение ресурсов */
export interface GetResourceUsageParams {
  agentRole?: string;
}

/** Получение статуса агента */
export interface GetAgentStatusParams {
  role?: string;
}

/** Получение сбоев */
export interface GetFailuresParams {
  agentRole?: string;
  limit?: number;
}

/** Установка стратегии */
export interface SetStrategyParams {
  strategy: AgentSelectionStrategy;
}

/** Вход MetaOrchestrator */
export type MetaOrchestratorInput =
  | { action: 'create-task'; params: CreateTaskParams }
  | { action: 'execute-task'; params: ExecuteTaskParams }
  | { action: 'get-task-status'; params: GetTaskStatusParams }
  | { action: 'get-all-tasks'; params?: Record<string, never> }
  | { action: 'cancel-task'; params: { taskId: string } }
  | { action: 'retry-task'; params: { taskId: string } }
  | { action: 'get-resource-usage'; params?: GetResourceUsageParams }
  | { action: 'get-agent-status'; params?: GetAgentStatusParams }
  | { action: 'get-failures'; params?: GetFailuresParams }
  | { action: 'get-stats'; params?: Record<string, never> }
  | { action: 'set-strategy'; params: SetStrategyParams }
  | { action: 'pause'; params?: Record<string, never> }
  | { action: 'resume'; params?: Record<string, never> }
  | { action: 'stop'; params?: Record<string, never> };

/** Результат операции */
export interface OrchestrationResult {
  success: boolean;
  message: string;
  task?: OrchestrationTask;
  tasks?: OrchestrationTask[];
  resourceUsage?: ResourceUsage;
  agentStatus?: AgentInstance;
  agents?: AgentInstance[];
  failures?: FailureRecord[];
  stats?: OrchestratorStats;
  loadBalance?: LoadBalanceResult;
}

/** Статистика оркестратора */
export interface OrchestratorStats {
  totalTasks: number;
  byStatus: Record<TaskResultStatus, number>;
  byPriority: Record<TaskPriority, number>;
  averageDurationMs: number;
  successRate: number;
  totalFailures: number;
  totalRetries: number;
  strategy: AgentSelectionStrategy;
}

/** Выход MetaOrchestrator */
export type MetaOrchestratorOutput = OrchestrationResult;
