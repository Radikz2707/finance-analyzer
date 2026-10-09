/**
 * AutomationAgent — workflow engine для автоматизации задач.
 */

// ──────────────────────────────────────────────
// 1. Типы workflow
// ──────────────────────────────────────────────

/** Статус workflow */
export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

/** Триггер запуска */
export type TriggerType =
  | 'schedule'       // По расписанию (cron)
  | 'event'          // По событию
  | 'manual'         // Ручной запуск
  | 'dependency';    // После завершения другого workflow

/** Действие в workflow */
export type ActionType =
  | 'notify'         // Отправить уведомление
  | 'analyze'        // Запустить анализ
  | 'research'       // Запустить исследование
  | 'execute'        // Выполнить команду
  | 'wait'           // Ожидание
  | 'condition';     // Условие

// ──────────────────────────────────────────────
// 2. Интерфейсы
// ──────────────────────────────────────────────

/** Настройка триггера */
export interface TriggerConfig {
  type: TriggerType;
  enabled: boolean;
  config: Record<string, unknown>;
}

/** Действие workflow */
export interface WorkflowAction {
  id: string;
  type: ActionType;
  name: string;
  params: Record<string, unknown>;
  nextActionId?: string;
  condition?: string; // условие для type='condition'
}

/** Workflow (шаблон) */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  trigger: TriggerConfig;
  actions: WorkflowAction[];
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

/** Запуск workflow */
export interface WorkflowRun {
  id: string;
  templateId: string;
  templateName: string;
  status: WorkflowStatus;
  currentActionId?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  results: Record<string, unknown>;
}

/** Результат выполнения */
export interface ActionExecutionResult {
  actionId: string;
  actionType: ActionType;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

// ──────────────────────────────────────────────
// 3. Входы и выходы
// ──────────────────────────────────────────────

/** Действия AutomationAgent */
export type AutomationAgentAction =
  | 'create-template'
  | 'update-template'
  | 'delete-template'
  | 'run-template'
  | 'run-now'
  | 'get-templates'
  | 'get-runs'
  | 'get-run-status'
  | 'pause-run'
  | 'resume-run'
  | 'stop-run'
  | 'get-stats';

/** Создание шаблона */
export interface CreateTemplateParams {
  name: string;
  description: string;
  trigger: TriggerConfig;
  actions: Omit<WorkflowAction, 'id'>[];
}

/** Обновление шаблона */
export interface UpdateTemplateParams {
  id: string;
  name?: string;
  description?: string;
  trigger?: TriggerConfig;
  actions?: Omit<WorkflowAction, 'id'>[];
  isActive?: boolean;
}

/** Запуск шаблона */
export interface RunTemplateParams {
  templateId: string;
  overrideParams?: Record<string, unknown>;
}

/** Ручной запуск */
export interface RunNowParams {
  templateId: string;
}

/** Получение шаблонов */
export interface GetTemplatesParams {
  isActive?: boolean;
}

/** Получение запусков */
export interface GetRunsParams {
  templateId?: string;
  status?: WorkflowStatus;
  limit?: number;
}

/** Вход AutomationAgent */
export type AutomationAgentInput =
  | { action: 'create-template'; params: CreateTemplateParams }
  | { action: 'update-template'; params: UpdateTemplateParams }
  | { action: 'delete-template'; params: { id: string } }
  | { action: 'run-template'; params: RunTemplateParams }
  | { action: 'run-now'; params: RunNowParams }
  | { action: 'get-templates'; params?: GetTemplatesParams }
  | { action: 'get-runs'; params?: GetRunsParams }
  | { action: 'get-run-status'; params: { runId: string } }
  | { action: 'pause-run'; params: { runId: string } }
  | { action: 'resume-run'; params: { runId: string } }
  | { action: 'stop-run'; params: { runId: string } }
  | { action: 'get-stats'; params?: Record<string, never> };

/** Результат операции */
export interface AutomationOperationResult {
  success: boolean;
  message: string;
  template?: WorkflowTemplate;
  templates?: WorkflowTemplate[];
  run?: WorkflowRun;
  runs?: WorkflowRun[];
  executionResult?: ActionExecutionResult;
  stats?: WorkflowStats;
}

/** Статистика workflow */
export interface WorkflowStats {
  totalTemplates: number;
  activeTemplates: number;
  totalRuns: number;
  byStatus: Record<WorkflowStatus, number>;
  averageDurationMs: number;
  successRate: number;
}

/** Выход AutomationAgent */
export type AutomationAgentOutput = AutomationOperationResult;
