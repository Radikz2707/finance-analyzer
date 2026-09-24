/**
 * Watchdog — Сторож процессов мультиагентного конвейера.
 *
 * Архитектура:
 *   [Agent 1] ─┐
 *   [Agent 2] ─┤→ Watchdog (polling) → Health Report → AgentController
 *   [Agent N] ─┘
 *                   ↓
 *            [Timeout detected?]
 *                   ↓
 *            [Restart agent] → [Restore context] → [Retry]
 *
 * Функции:
 * 1. Периодический polling здоровья всех агентов
 * 2. Обнаружение timeout/error
 * 3. Автоматический перезапуск агентов
 * 4. Восстановление контекста последнего задания
 * 5. Логирование инцидентов
 */

import type {
  WatchdogConfig,
  WatchdogState,
  WatchdogStats,
  AgentHealthCheck,
  AgentHealthReport,
  IncidentRecord,
} from './types.js';
import { DEFAULT_THRESHOLDS } from './types.js';

// ──────────────────────────────────────────────
// Утилиты
// ──────────────────────────────────────────────

/** Генерация ID инцидента */
function generateIncidentId(): string {
  return `incident-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ──────────────────────────────────────────────
// Watchdog
// ──────────────────────────────────────────────

/**
 * Watchdog — Сторож процессов.
 */
export class Watchdog {
  private readonly config: Required<WatchdogConfig>;
  private _state: WatchdogState = 'idle';
  private timerId: ReturnType<typeof setInterval> | null = null;
  private healthChecks: Map<string, AgentHealthCheck> = new Map();
  private incidents: IncidentRecord[] = [];
  private stats: WatchdogStats = {
    totalChecks: 0,
    healthyChecks: 0,
    slowChecks: 0,
    timeoutChecks: 0,
    totalRestarts: 0,
    totalIncidents: 0,
    autoRecovered: 0,
  };

  // Callbacks для интеграции
  private onIncidentDetected?: (incident: IncidentRecord) => void;
  private onAgentRestartedCallback?: (agentName: string, context?: Record<string, unknown>) => void;

  constructor(config?: WatchdogConfig) {
    this.config = {
      checkIntervalMs: config?.checkIntervalMs ?? 5000,
      thresholds: config?.thresholds ?? DEFAULT_THRESHOLDS,
      maxRecoveryAttempts: config?.maxRecoveryAttempts ?? 3,
      restartDelayMs: config?.restartDelayMs ?? 2000,
      enableVsCodeRestart: config?.enableVsCodeRestart ?? false,
      vsCodeRestartCommand: config?.vsCodeRestartCommand ?? 'code --reload-window',
      verbose: config?.verbose ?? false,
    };
  }

  /**
   * Зарегистрировать callback при обнаружении инцидента.
   */
  onIncident(callback: (incident: IncidentRecord) => void): void {
    this.onIncidentDetected = callback;
  }

  /**
   * Зарегистрировать callback при перезапуске агента.
   */
  onAgentRestarted(callback: (agentName: string, context?: Record<string, unknown>) => void): void {
    this.onAgentRestartedCallback = callback;
  }

  /** Запустить мониторинг */
  start(): void {
    if (this._state === 'monitoring') {
      console.warn('[Watchdog] Monitoring already running');
      return;
    }

    this._state = 'monitoring';
    this.timerId = setInterval(() => {
      this.checkAllAgents();
    }, this.config.checkIntervalMs);

    // Первая проверка сразу
    void this.checkAllAgents();

    if (this.config.verbose) {
      console.log(
        `[Watchdog] Started: interval=${this.config.checkIntervalMs}ms, ` +
        `thresholds=healthy:${this.config.thresholds.healthyMaxMs}ms/slow:${this.config.thresholds.slowThresholdMs}ms/timeout:${this.config.thresholds.timeoutThresholdMs}ms`,
      );
    }
  }

  /** Остановить мониторинг */
  async stop(): Promise<void> {
    this._state = 'stopped';
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    if (this.config.verbose) {
      console.log('[Watchdog] Stopped');
    }
  }

  /** Проверить здоровье конкретного агента */
  async checkAgent(agentName: string): Promise<AgentHealthCheck> {
    const check = await this.performHealthCheck(agentName);
    this.healthChecks.set(agentName, check);
    this.stats.totalChecks++;

    if (check.status === 'healthy') {
      this.stats.healthyChecks++;
    } else if (check.status === 'slow') {
      this.stats.slowChecks++;
    } else if (check.status === 'timeout') {
      this.stats.timeoutChecks++;
      await this.handleTimeout(agentName, check);
    }

    return check;
  }

  /** Проверить все зарегистрированные агенты */
  private async checkAllAgents(): Promise<void> {
    if (this._state !== 'monitoring') return;

    const agentNames = Array.from(this.healthChecks.keys());

    for (const agentName of agentNames) {
      try {
        await this.checkAgent(agentName);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Watchdog] Error checking agent ${agentName}: ${errorMsg}`);
      }
    }
  }

  /** Получить отчёт по всем агентам */
  getHealthReport(): AgentHealthReport {
    const agents = Array.from(this.healthChecks.values());
    const unhealthyAgents = agents.filter(
      (a) => a.status === 'slow' || a.status === 'timeout' || a.status === 'error',
    );

    const responseTimes = agents.map((a) => a.responseTimeMs).filter((t) => t > 0);
    const avgResponseTimeMs =
      responseTimes.length > 0
        ? Math.round(responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length)
        : 0;
    const maxResponseTimeMs = Math.max(...responseTimes, 0);

    return {
      agents,
      unhealthyAgents,
      avgResponseTimeMs,
      maxResponseTimeMs,
    };
  }

  /** Получить историю инцидентов */
  getIncidents(): IncidentRecord[] {
    return [...this.incidents];
  }

  /** Получить текущее состояние */
  getState(): WatchdogState {
    return this._state;
  }

  /** Получить статистику */
  getStats(): WatchdogStats {
    return { ...this.stats };
  }

  /** Зарегистрировать агента в мониторинге */
  registerAgent(agentName: string): void {
    if (!this.healthChecks.has(agentName)) {
      this.healthChecks.set(agentName, {
        agentName,
        lastCheckedAt: new Date().toISOString(),
        responseTimeMs: 0,
        status: 'healthy',
      });

      if (this.config.verbose) {
        console.log(`[Watchdog] Registered agent: ${agentName}`);
      }
    }
  }

  /** Установить текущее задание агента */
  setAgentTask(agentName: string, taskId: string, deadlineMs: number): void {
    const check = this.healthChecks.get(agentName);
    if (check) {
      check.currentTask = {
        taskId,
        startedAt: new Date().toISOString(),
        deadlineMs,
      };
    }
  }

  /** Удалить агента из мониторинга */
  unregisterAgent(agentName: string): void {
    this.healthChecks.delete(agentName);
    if (this.config.verbose) {
      console.log(`[Watchdog] Unregistered agent: ${agentName}`);
    }
  }

  // ── Helpers ──

  /**
   * Выполнить проверку здоровья агента.
   * Подклассы могут переопределить этот метод.
   */
  protected async performHealthCheck(
    agentName: string,
  ): Promise<AgentHealthCheck> {
    const lastCheck = this.healthChecks.get(agentName);

    // Имитация проверки — в реальности здесь будет вызов к агенту
    // Для примера: случайное время ответа
    const mockResponseTime = this.getRandomResponseTime(agentName);

    const responseTime = mockResponseTime;

    // Определение статуса
    let status: AgentHealthCheck['status'] = 'healthy';
    if (responseTime > this.config.thresholds.timeoutThresholdMs) {
      status = 'timeout';
    } else if (responseTime > this.config.thresholds.slowThresholdMs) {
      status = 'slow';
    } else if (responseTime > this.config.thresholds.healthyMaxMs) {
      status = 'slow';
    }

    return {
      agentName,
      lastCheckedAt: new Date().toISOString(),
      responseTimeMs: responseTime,
      status,
      currentTask: lastCheck?.currentTask,
    };
  }

  /**
   * Обработка таймаута агента.
   */
  private async handleTimeout(
    agentName: string,
    check: AgentHealthCheck,
  ): Promise<void> {
    if (this.config.verbose) {
      console.log(`[Watchdog] ⚠️ Timeout detected for agent: ${agentName}`);
    }

    // Создаём инцидент
    const incident: IncidentRecord = {
      id: generateIncidentId(),
      occurredAt: new Date().toISOString(),
      agentName,
      type: 'timeout',
      severity: 'critical',
      message: `Agent ${agentName} exceeded timeout threshold (${this.config.thresholds.timeoutThresholdMs}ms)`,
      context: check.currentTask ? { taskId: check.currentTask.taskId } : undefined,
      recoveryAttempts: 0,
    };

    this.incidents.push(incident);
    this.stats.totalIncidents++;

    if (this.onIncidentDetected) {
      this.onIncidentDetected(incident);
    }

    // Пытаемся восстановить
    await this.attemptRecovery(agentName, incident);
  }

  /**
   * Попытка восстановления агента.
   */
  private async attemptRecovery(
    agentName: string,
    incident: IncidentRecord,
  ): Promise<void> {
    if (incident.recoveryAttempts >= this.config.maxRecoveryAttempts) {
      incident.severity = 'critical';
      incident.message += ' — Max recovery attempts reached';
      if (this.config.verbose) {
        console.error(`[Watchdog] ❌ Max recovery attempts for ${agentName}`);
      }
      return;
    }

    incident.recoveryAttempts++;
    incident.recoveryMethod = 'restart_agent';

    if (this.config.verbose) {
      console.log(
        `[Watchdog] 🔄 Attempting recovery ${incident.recoveryAttempts}/${this.config.maxRecoveryAttempts} for ${agentName}`,
      );
    }

    // Задержка перед перезапуском
    await this.sleep(this.config.restartDelayMs);

    try {
      // Вызываем callback для перезапуска
      if (this.onAgentRestartedCallback) {
        const context = incident.context;
        this.onAgentRestartedCallback(agentName, context);
        incident.context = context;
      }

      // Обновляем инцидент
      incident.resolvedAt = new Date().toISOString();
      incident.severity = 'recovered';
      incident.message += ' — Agent restarted successfully';

      this.stats.totalRestarts++;
      this.stats.autoRecovered++;

      if (this.config.verbose) {
        console.log(`[Watchdog] ✅ Agent ${agentName} recovered`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      incident.severity = 'critical';
      incident.message += ` — Recovery failed: ${errorMsg}`;

      if (this.config.verbose) {
        console.error(`[Watchdog] ❌ Recovery failed for ${agentName}: ${errorMsg}`);
      }

      // Если включён перезапуск VS Code
      if (this.config.enableVsCodeRestart && incident.recoveryAttempts >= this.config.maxRecoveryAttempts) {
        await this.restartVsCode();
      }
    }
  }

  /**
   * Перезапуск VS Code.
   */
  private async restartVsCode(): Promise<void> {
    if (this.config.verbose) {
      console.log(`[Watchdog] 🔄 Restarting VS Code: ${this.config.vsCodeRestartCommand}`);
    }

    try {
      // Используем child_process для выполнения команды
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      await execAsync(this.config.vsCodeRestartCommand);
      if (this.config.verbose) {
        console.log('[Watchdog] ✅ VS Code restart command executed');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Watchdog] ❌ VS Code restart failed: ${errorMsg}`);
    }
  }

  /**
   * Генерация случайного времени ответа для тестирования.
   * В продакшене здесь будет реальный вызов к агенту.
   */
  private getRandomResponseTime(_agentName: string): number {
    // Для тестов: случайное время от 100ms до 50000ms
    // В продакшене: реальный замер ответа агента
    const random = Math.random();
    if (random < 0.7) {
      // 70% — healthy
      return 500 + Math.random() * 4500;
    } else if (random < 0.9) {
      // 20% — slow
      return this.config.thresholds.healthyMaxMs + Math.random() * 5000;
    } else {
      // 10% — timeout
      return this.config.thresholds.timeoutThresholdMs + Math.random() * 20000;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
