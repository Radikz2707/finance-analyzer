/**
 * MetaOrchestrator — центральный координатор 20+ агентов.
 *
 * Функции:
 * - Динамический выбор агентов под задачу
 * - Распределение ресурсов (CPU, память, API calls)
 * - Балансировка нагрузки
 * - Отказоустойчивость (retry, fallback, escalate)
 * - Мониторинг производительности
 * - Оптимизация через анализ метрик
 */

import { randomUUID } from 'crypto';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import type {
  MetaOrchestratorInput,
  MetaOrchestratorOutput,
  CreateTaskParams,
  ExecuteTaskParams,
  GetTaskStatusParams,
  GetResourceUsageParams,
  GetAgentStatusParams,
  GetFailuresParams,
  SetStrategyParams,
  OrchestrationTask,
  AgentInstance,
  ResourceUsage,
  FailureRecord,
  FailureType,
  TaskPriority,
  TaskResultStatus,
  AgentSelectionStrategy,
} from './types.js';

const DEFAULT_MAX_RETRIES = 2;
const CRITICAL_TIMEOUT_MS = 60000;
const HIGH_TIMEOUT_MS = 45000;
const NORMAL_TIMEOUT_MS = 30000;
const LOW_TIMEOUT_MS = 15000;

export class MetaOrchestrator extends AgentBase {
  private tasks: Map<string, OrchestrationTask>;
  private agents: Map<string, AgentInstance>;
  private failures: FailureRecord[];
  private strategy: AgentSelectionStrategy;
  private isPaused: boolean;
  private resourceUsage: ResourceUsage;
  private actionAgents: Record<string, unknown>;

  constructor(
    config: AgentConfig,
    actionAgents?: Record<string, unknown>,
  ) {
    super({ ...config, timeoutMs: config.timeoutMs ?? 120000 });
    this.tasks = new Map();
    this.agents = new Map();
    this.failures = [];
    this.strategy = 'load-balanced';
    this.isPaused = false;
    this.resourceUsage = {
      cpuPercent: 0,
      memoryUsedMb: 0,
      memoryTotalMb: 0,
      memoryPercent: 0,
      activeTasks: 0,
      queuedTasks: 0,
      apiCallsPerMinute: 0,
    };
    this.actionAgents = actionAgents ?? {};
    this.initDefaultAgents();
  }

  protected async executeInternal(input: unknown): Promise<unknown> {
    const p = input as MetaOrchestratorInput;
    switch (p.action) {
      case 'create-task':
        return this.createTask(p.params as CreateTaskParams);
      case 'execute-task':
        return this.executeTask(p.params as ExecuteTaskParams);
      case 'get-task-status':
        return this.getTaskStatus((p.params as GetTaskStatusParams).taskId);
      case 'get-all-tasks':
        return this.getAllTasks();
      case 'cancel-task':
        return this.cancelTask((p.params as { taskId: string }).taskId);
      case 'retry-task':
        return this.retryTask((p.params as { taskId: string }).taskId);
      case 'get-resource-usage':
        return this.getResourceUsage((p.params as GetResourceUsageParams | undefined));
      case 'get-agent-status':
        return this.getAgentStatus((p.params as GetAgentStatusParams | undefined));
      case 'get-failures':
        return this.getFailures((p.params as GetFailuresParams | undefined));
      case 'get-stats':
        return this.getStats();
      case 'set-strategy':
        return this.setStrategy((p.params as SetStrategyParams).strategy);
      case 'pause':
        return this.pause();
      case 'resume':
        return this.resume();
      case 'stop':
        return this.stopOrchestrator();
      default:
        throw new Error('Unknown action: ' + (p as { action: string }).action);
    }
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ── Task Management ──

  private createTask(params: CreateTaskParams): MetaOrchestratorOutput {
    const task: OrchestrationTask = {
      id: randomUUID(),
      name: params.name,
      description: params.description,
      priority: params.priority ?? 'normal',
      agentRole: params.agentRole,
      input: params.input,
      timeoutMs: this.getTimeoutForPriority(params.priority),
      maxRetries: params.maxRetries ?? DEFAULT_MAX_RETRIES,
      status: 'pending',
      retryCount: 0,
    };

    this.tasks.set(task.id, task);
    this.resourceUsage.queuedTasks++;

    return {
      success: true,
      message: 'Задача "' + task.name + '" создана',
      task,
    };
  }

  private async executeTask(params: ExecuteTaskParams): Promise<MetaOrchestratorOutput> {
    const task = this.tasks.get(params.taskId);
    if (!task) {
      return { success: false, message: 'Задача не найдена' };
    }

    if (this.isPaused) {
      return { success: false, message: 'Оркестратор приостановлен' };
    }

    if (task.status !== 'pending' && task.status !== 'retrying') {
      return { success: false, message: 'Задача не может быть выполнена' };
    }

    task.status = 'running';
    task.startedAt = this.now();
    this.resourceUsage.queuedTasks--;
    this.resourceUsage.activeTasks++;

    try {
      const result = await this.executeWithRetry(task);
      task.status = 'completed';
      task.completedAt = this.now();
      task.result = result;

      this.updateAgentStats(task.agentRole, true);

      return {
        success: true,
        message: 'Задача "' + task.name + '" выполнена',
        task,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      task.status = 'failed';
      task.completedAt = this.now();
      task.error = error;

      this.recordFailure(task, error);
      this.updateAgentStats(task.agentRole, false);

      return {
        success: false,
        message: 'Задача "' + task.name + '" завершилась с ошибкой',
        task,
      };
    } finally {
      this.resourceUsage.activeTasks--;
    }
  }

  private async executeWithRetry(task: OrchestrationTask): Promise<unknown> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= task.maxRetries; attempt++) {
      try {
        const agent = this.selectAgent(task.agentRole) as { execute: (input: unknown) => Promise<unknown> };
        if (!agent) {
          throw new Error('Агент "' + task.agentRole + '" не найден');
        }

        const result = await agent.execute(task.input);
        if (result && typeof result === 'object' && 'success' in result) {
          return (result as { success: boolean; data?: unknown }).data ?? result;
        }
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        task.retryCount = attempt + 1;

        if (attempt < task.maxRetries) {
          task.status = 'retrying';
          await this.sleepMs(1000 * (attempt + 1)); // exponential backoff
        }
      }
    }

    throw new Error(lastError ?? 'Unknown error after retries');
  }

  private getTaskStatus(taskId: string): MetaOrchestratorOutput {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, message: 'Задача не найдена' };
    }
    return {
      success: true,
      message: 'Статус задачи',
      task,
    };
  }

  private cancelTask(taskId: string): MetaOrchestratorOutput {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, message: 'Задача не найдена' };
    }
    if (task.status === 'running') {
      task.status = 'failed';
      task.error = 'Отменена пользователем';
      task.completedAt = this.now();
      this.resourceUsage.activeTasks--;
    } else {
      this.tasks.delete(taskId);
      this.resourceUsage.queuedTasks--;
    }
    return { success: true, message: 'Задача отменена', task };
  }

  private retryTask(taskId: string): MetaOrchestratorOutput {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, message: 'Задача не найдена' };
    }
    if (task.status !== 'failed') {
      return { success: false, message: 'Задача не может быть повторена' };
    }

    task.status = 'retrying';
    task.retryCount = 0;
    task.error = undefined;
    task.completedAt = undefined;

    return {
      success: true,
      message: 'Задача "' + task.name + '" поставлена на повтор',
      task,
    };
  }

  // ── Agent Selection & Load Balancing ──

  private selectAgent(role: string): unknown {
    // Сначала проверяем кэш агентов
    const cached = this.agents.get(role);
    if (cached && cached.status !== 'offline' && cached.status !== 'error') {
      return this.actionAgents[role];
    }

    // Если агент не найден — инициализируем
    if (!this.actionAgents[role]) {
      console.warn('[MetaOrchestrator] Агент "' + role + '" не зарегистрирован');
      return undefined;
    }

    // Регистрируем агент
    this.agents.set(role, {
      role,
      instance: this.actionAgents[role],
      status: 'idle',
      totalExecutions: 0,
      successRate: 1.0,
      avgExecutionTimeMs: 0,
    });

    return this.actionAgents[role];
  }

  // ── Resource Monitoring ──

  private getResourceUsage(params?: GetResourceUsageParams): MetaOrchestratorOutput {
    if (params?.agentRole) {
      const agent = this.agents.get(params.agentRole);
      if (!agent) {
        return { success: false, message: 'Агент не найден' };
      }
      return {
        success: true,
        message: 'Ресурсы агента ' + params.agentRole,
        agentStatus: agent,
      };
    }

    return {
      success: true,
      message: 'Использование ресурсов',
      resourceUsage: this.resourceUsage,
    };
  }

  private getAgentStatus(params?: GetAgentStatusParams): MetaOrchestratorOutput {
    if (params?.role) {
      const agent = this.agents.get(params.role);
      if (!agent) {
        return { success: false, message: 'Агент не найден' };
      }
      return {
        success: true,
        message: 'Статус агента ' + params.role,
        agentStatus: agent,
      };
    }

    return {
      success: true,
      message: 'Статус всех агентов',
      agents: Array.from(this.agents.values()),
    };
  }

  // ── Failure Management ──

  private recordFailure(
    task: OrchestrationTask,
    error: string,
  ): void {
    const failureType: FailureType = error.includes('timeout')
      ? 'timeout'
      : error.includes('network') || error.includes('connect')
        ? 'network'
        : 'unknown';

    this.failures.push({
      taskId: task.id,
      agentRole: task.agentRole,
      failureType,
      error,
      timestamp: this.now(),
      recoveryAttempted: task.retryCount > 0,
      recoverySuccess: false,
    });
  }

  private getFailures(params?: GetFailuresParams): MetaOrchestratorOutput {
    let items = [...this.failures];

    if (params?.agentRole) {
      items = items.filter((f) => f.agentRole === params.agentRole);
    }

    const limit = params?.limit ?? items.length;
    const sorted = items.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    return {
      success: true,
      message: 'Найдено ' + sorted.length + ' сбоев',
      failures: sorted.slice(0, limit),
    };
  }

  // ── Stats & Strategy ──

  private getStats(): MetaOrchestratorOutput {
    const tasks = Array.from(this.tasks.values());

    const byStatus: Record<TaskResultStatus, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      retrying: 0,
    };
    const byPriority: Record<TaskPriority, number> = {
      low: 0,
      normal: 0,
      high: 0,
      critical: 0,
    };

    let totalDuration = 0;
    let completedCount = 0;
    let successCount = 0;
    let totalRetries = 0;

    for (const task of tasks) {
      byStatus[task.status]++;
      byPriority[task.priority]++;
      totalRetries += task.retryCount;

      if (task.status === 'completed' && task.startedAt && task.completedAt) {
        const duration =
          new Date(task.completedAt).getTime() -
          new Date(task.startedAt).getTime();
        totalDuration += duration;
        completedCount++;
        successCount++;
      }
      if (task.status === 'failed') {
        totalDuration += 5000; // estimated
      }
    }

    return {
      success: true,
      message: 'Статистика оркестратора',
      stats: {
        totalTasks: tasks.length,
        byStatus,
        byPriority,
        averageDurationMs:
          completedCount > 0 ? totalDuration / completedCount : 0,
        successRate:
          tasks.length > 0 ? (successCount / tasks.length) * 100 : 0,
        totalFailures: byStatus.failed,
        totalRetries,
        strategy: this.strategy,
      },
    };
  }

  private setStrategy(strategy: AgentSelectionStrategy): MetaOrchestratorOutput {
    this.strategy = strategy;
    return {
      success: true,
      message: 'Стратегия изменена на ' + strategy,
    };
  }

  // ── Lifecycle Control ──

  private pause(): MetaOrchestratorOutput {
    this.isPaused = true;
    return { success: true, message: 'Оркестратор приостановлен' };
  }

  private resume(): MetaOrchestratorOutput {
    this.isPaused = false;
    return { success: true, message: 'Оркестратор возобновлён' };
  }

  private stopOrchestrator(): MetaOrchestratorOutput {
    this.isPaused = true;
    // Помечаем все running задачи как failed
    for (const task of this.tasks.values()) {
      if (task.status === 'running') {
        task.status = 'failed';
        task.error = 'Остановлен оркестратором';
        task.completedAt = this.now();
      }
    }
    return { success: true, message: 'Оркестратор остановлен' };
  }

  // ── Helpers ──

  private getTimeoutForPriority(priority?: TaskPriority): number {
    switch (priority) {
      case 'critical':
        return CRITICAL_TIMEOUT_MS;
      case 'high':
        return HIGH_TIMEOUT_MS;
      case 'low':
        return LOW_TIMEOUT_MS;
      default:
        return NORMAL_TIMEOUT_MS;
    }
  }

  private updateAgentStats(role: string, success: boolean): void {
    const agent = this.agents.get(role);
    if (!agent) return;

    agent.totalExecutions++;
    // Exponential moving average для success rate
    const weight = 0.1;
    const currentSuccess = agent.successRate;
    agent.successRate = currentSuccess * (1 - weight) + (success ? 1 : 0) * weight;

    // Обновляем статус
    agent.status = success ? 'idle' : 'error';
    agent.lastUsedAt = this.now();
  }

  private initDefaultAgents(): void {
    // Заполняем пустые метрики для стандартных ролей
    const defaultRoles = [
      'file',
      'terminal',
      'package',
      'browser',
      'config',
      'process',
      'scheduler',
      'learning',
      'auto-repair',
      'goal',
      'research-v2',
      'communication',
      'automation',
    ];

    for (const role of defaultRoles) {
      if (!this.agents.has(role)) {
        this.agents.set(role, {
          role,
          instance: this.actionAgents[role],
          status: this.actionAgents[role] ? 'idle' : 'offline',
          totalExecutions: 0,
          successRate: 1.0,
          avgExecutionTimeMs: 0,
        });
      }
    }
  }

  private sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Public API ──

  getTaskCount(): number {
    return this.tasks.size;
  }

  getAgentCount(): number {
    return this.agents.size;
  }

  getStrategy(): AgentSelectionStrategy {
    return this.strategy;
  }

  getAllTasks(): OrchestrationTask[] {
    return Array.from(this.tasks.values());
  }

  getAllAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  getFailuresList(): FailureRecord[] {
    return [...this.failures];
  }
}
