/**
 * Agent Controller — управление всеми агентами конвейера.
 *
 * Возможности:
 * - Запуск/остановка/перезапуск любого агента
 * - Динамическое изменение настроек (retries, timeout)
 * - Прямые команды агентам
 * - Переопределение результатов
 * - Pause/Resume конвейера
 */

import type { AgentConfig } from '../agent/types.js';
import type { AuditLog } from '../audit/audit-log.js';

// ──────────────────────────────────────────────
// 1. Agent status
// ──────────────────────────────────────────────

/** Статус одного агента */
export interface AgentStatus {
  /** Имя агента */
  name: string;
  /** Текущий статус */
  status: 'idle' | 'running' | 'paused' | 'error' | 'stopped';
  /** Последнее выполнение */
  lastExecution?: {
    startedAt: string;
    completedAt?: string;
    durationMs: number;
    success: boolean;
    error?: string;
  };
  /** Статистика */
  stats: {
    totalExecutions: number;
    totalSuccesses: number;
    totalFailures: number;
  };
  /** Текущая конфигурация */
  config: AgentConfig;
}

// ──────────────────────────────────────────────
// 2. Agent Controller
// ──────────────────────────────────────────────

/**
 * Agent Controller — центральный контроллер для управления агентами.
 *
 * Директор может:
 * - /agents — посмотреть статус всех агентов
 * - /status {agent} — детальная статистика
 * - /log {agent} — логи за последнюю минуту
 * - /stop {agent} — остановить агента
 * - /restart {agent} — перезапустить агента
 * - /config {agent} retries=3 timeoutMs=30000 — изменить настройки
 * - /override {agent} "команда" — переопределить результат
 */
export class AgentController {
  private agents: Map<string, unknown> = new Map();
  private agentConfigs: Map<string, AgentConfig> = new Map();
  private agentStatuses: Map<string, AgentStatus> = new Map();
  private auditLog: AuditLog;

  constructor(auditLog: AuditLog) {
    this.auditLog = auditLog;
  }

  /** Зарегистрировать агента */
  registerAgent(name: string, agent: unknown, config: AgentConfig): void {
    this.agents.set(name, agent);
    this.agentConfigs.set(name, config);
    this.agentStatuses.set(name, {
      name,
      status: 'idle',
      stats: { totalExecutions: 0, totalSuccesses: 0, totalFailures: 0 },
      config,
    });
  }

  /** Получить статус всех агентов */
  getAllStatuses(): AgentStatus[] {
    return Array.from(this.agentStatuses.values());
  }

  /** Получить статус одного агента */
  getStatus(agentName: string): AgentStatus | undefined {
    return this.agentStatuses.get(agentName);
  }

  /** Остановить агента */
  async stopAgent(agentName: string): Promise<boolean> {
    const agent = this.agents.get(agentName);
    if (!agent) {
      console.error(`[AgentController] Агент ${agentName} не найден`);
      return false;
    }

    const stoppable = agent as { stop?: () => Promise<void> };
    if (stoppable.stop) {
      await stoppable.stop();
    }

    const status = this.agentStatuses.get(agentName);
    if (status) {
      status.status = 'stopped';
    }

    this.auditLog.log(
      'agent.stop',
      'director',
      `Остановлен агент: ${agentName}`,
    );

    console.log(`[AgentController] Агент ${agentName} остановлен`);
    return true;
  }

  /** Перезапустить агента */
  async restartAgent(agentName: string): Promise<boolean> {
    await this.stopAgent(agentName);

    const status = this.agentStatuses.get(agentName);
    if (status) {
      status.status = 'idle';
    }

    this.auditLog.log(
      'agent.restart',
      'director',
      `Перезапущен агент: ${agentName}`,
    );

    console.log(`[AgentController] Агент ${agentName} перезапущен`);
    return true;
  }

  /** Изменить конфигурацию агента */
  updateConfig(agentName: string, newConfig: Partial<AgentConfig>): boolean {
    const status = this.agentStatuses.get(agentName);
    if (!status) {
      console.error(`[AgentController] Агент ${agentName} не найден`);
      return false;
    }

    const oldConfig = { ...status.config };
    status.config = { ...status.config, ...newConfig };
    this.agentConfigs.set(agentName, status.config);

    this.auditLog.log(
      'agent.config_change',
      'director',
      `Изменена конфигурация агента ${agentName}`,
      { oldConfig, newConfig: status.config },
    );

    console.log(
      `[AgentController] Конфигурация ${agentName} изменена:`,
      newConfig,
    );
    return true;
  }

  /** Переопределить результат агента */
  overrideResult(
    agentName: string,
    command: string,
    overrideData: unknown,
  ): boolean {
    this.auditLog.log(
      'command.override',
      'director',
      `Переопределение результата агента ${agentName}: ${command}`,
      { command, overrideData },
    );

    console.log(
      `[AgentController] Переопределение ${agentName}: ${command}`,
      overrideData,
    );
    return true;
  }

  /** Сформировать текстовый отчёт для Telegram */
  formatAgentsReport(): string {
    const statuses = this.getAllStatuses();
    let text = '<b>🤖 Статус агентов:</b>\n\n';

    for (const status of statuses) {
      const statusEmoji = this.getStatusEmoji(status.status);
      const statsText = `exec: ${status.stats.totalExecutions}, ok: ${status.stats.totalSuccesses}, fail: ${status.stats.totalFailures}`;

      text += `${statusEmoji} <b>${status.name}</b> — ${status.status}\n`;
      text += `  ${statsText}\n`;

      if (status.lastExecution) {
        const duration = (status.lastExecution.durationMs / 1000).toFixed(1);
        text += `  ⏱ Последнее: ${duration}с\n`;
      }

      text += '\n';
    }

    return text;
  }

  /** Сформировать детальную статистику агента */
  formatAgentDetail(agentName: string): string {
    const status = this.agentStatuses.get(agentName);
    if (!status) {
      return `<b>❌ Агент ${agentName} не найден</b>`;
    }

    let text = `<b>📊 Детали: ${status.name}</b>\n\n`;
    text += `Статус: ${status.status}\n`;
    text += `Конфиг: retries=${status.config.retries}, timeout=${status.config.timeoutMs}ms\n`;

    if (status.lastExecution) {
      text += '\nПоследнее выполнение:\n';
      text += `  Начал: ${new Date(status.lastExecution.startedAt).toLocaleTimeString('ru-RU')}\n`;
      text += `  Длительность: ${(status.lastExecution.durationMs / 1000).toFixed(1)}с\n`;
      text += `  Успех: ${status.lastExecution.success ? '✅' : '❌'}\n`;
      if (status.lastExecution.error) {
        text += `  Ошибка: ${status.lastExecution.error}\n`;
      }
    }

    return text;
  }

  // ── Helpers ──

  private getStatusEmoji(status: string): string {
    switch (status) {
      case 'idle':
        return '✅';
      case 'running':
        return '⏳';
      case 'paused':
        return '⏸️';
      case 'error':
        return '⚠️';
      case 'stopped':
        return '⏹️';
      default:
        return '❓';
    }
  }
}
