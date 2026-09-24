/**
 * Watchdog Types — типы и интерфейсы для модуля мониторинга процессов.
 *
 * Watchdog — Сторож процессов, который:
 * 1. Мониторит время ответа каждого агента
 * 2. При превышении таймаута — автоматический перезапуск
 * 3. Восстанавливает контекст последнего задания
 * 4. Делает повторный запрос без участия пользователя
 * 5. Логирует все инциденты в AuditLog
 */

// ──────────────────────────────────────────────
// 1. Состояние Watchdog
// ──────────────────────────────────────────────

/** Текущее состояние Watchdog */
export type WatchdogState = 'idle' | 'monitoring' | 'recovering' | 'stopped';

/** Статус инцидента */
export type IncidentSeverity = 'warning' | 'critical' | 'recovered';

// ──────────────────────────────────────────────
// 2. Мониторинг агента
// ──────────────────────────────────────────────

/** Запись мониторинга одного агента */
export interface AgentHealthCheck {
  /** Имя агента */
  agentName: string;
  /** Последняя проверка */
  lastCheckedAt: string;
  /** Время ответа (мс) */
  responseTimeMs: number;
  /** Статус */
  status: 'healthy' | 'slow' | 'timeout' | 'error';
  /** Текущее задание (если выполняется) */
  currentTask?: {
    /** ID задания */
    taskId: string;
    /** Начало выполнения */
    startedAt: string;
    /** Элдлайн (мс) */
    deadlineMs: number;
  };
}

/** Результат проверки здоровья агента */
export interface AgentHealthReport {
  /** Проверенные агенты */
  agents: AgentHealthCheck[];
  /** Проблемные агенты */
  unhealthyAgents: AgentHealthCheck[];
  /** Среднее время ответа */
  avgResponseTimeMs: number;
  /** Максимальное время ответа */
  maxResponseTimeMs: number;
}

// ──────────────────────────────────────────────
// 3. Инциденты
// ──────────────────────────────────────────────

/** Запись инцидента */
export interface IncidentRecord {
  /** Уникальный ID */
  id: string;
  /** Время возникновения */
  occurredAt: string;
  /** Время устранения */
  resolvedAt?: string;
  /** Агент */
  agentName: string;
  /** Тип инцидента */
  type: 'timeout' | 'error' | 'restart' | 'recovery';
  /** severity */
  severity: IncidentSeverity;
  /** Сообщение */
  message: string;
  /** Контекст (последнее задание) */
  context?: Record<string, unknown>;
  /** Метод восстановления */
  recoveryMethod?: 'restart_agent' | 'restart_session' | 'manual';
  /** Количество попыток восстановления */
  recoveryAttempts: number;
}

// ──────────────────────────────────────────────
// 4. Конфигурация Watchdog
// ──────────────────────────────────────────────

/** Пороги времени ответа (мс) */
export interface ResponseTimeThresholds {
  /** healthy — в пределах */
  healthyMaxMs: number;
  /** slow — превышен healthy */
  slowThresholdMs: number;
  /** timeout — превышен slow */
  timeoutThresholdMs: number;
}

/** Стандартные пороги */
export const DEFAULT_THRESHOLDS: ResponseTimeThresholds = {
  healthyMaxMs: 5000,
  slowThresholdMs: 10000,
  timeoutThresholdMs: 30000,
};

/** Конфигурация Watchdog */
export interface WatchdogConfig {
  /** Интервал проверки (мс, по умолчанию 5000) */
  checkIntervalMs?: number;
  /** Пороги времени ответа */
  thresholds?: ResponseTimeThresholds;
  /** Макс. попыток восстановления одного агента */
  maxRecoveryAttempts?: number;
  /** Задержка перед перезапуском (мс, по умолчанию 2000) */
  restartDelayMs?: number;
  /** Включить автоперезапуск VS Code */
  enableVsCodeRestart?: boolean;
  /** Команда для перезапуска VS Code (опционально) */
  vsCodeRestartCommand?: string;
  /** verbose */
  verbose?: boolean;
}

// ──────────────────────────────────────────────
// 5. Интерфейс Watchdog
// ──────────────────────────────────────────────

/** Интерфейс Watchdog */
export interface IWatchdog {
  /** Запустить мониторинг */
  start(): void;
  /** Остановить мониторинг */
  stop(): Promise<void>;
  /** Проверить здоровье агента */
  checkAgent(agentName: string): Promise<AgentHealthCheck>;
  /** Получить отчёт по всем агентам */
  getHealthReport(): AgentHealthReport;
  /** Получить историю инцидентов */
  getIncidents(): IncidentRecord[];
  /** Получить текущее состояние */
  getState(): WatchdogState;
}

// ──────────────────────────────────────────────
// 6. Статистика
// ──────────────────────────────────────────────

/** Статистика Watchdog */
export interface WatchdogStats {
  /** Всего проверок */
  totalChecks: number;
  /** Успешных проверок */
  healthyChecks: number;
  /** Медленных проверок */
  slowChecks: number;
  /** Таймаутов */
  timeoutChecks: number;
  /** Перезапусков */
  totalRestarts: number;
  /** Инцидентов */
  totalIncidents: number;
  /** Восстановлено автоматически */
  autoRecovered: number;
}
