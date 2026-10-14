/**
 * ActionResolver — маппинг извлечённой задачи на роли агентов и входы.
 *
 * Превращает ExtractedTask в:
 * - AgentRole[] — каких агентов подключить (file/terminal/code/...);
 * - вход для action-input-builder — структурированный вход агента
 *   (FileAgentInput, TerminalAgentInput, CodingWorkflowInput, ...);
 * - человекочитаемое описание задачи для плана делегирования.
 *
 * Модуль чистый: без Node-зависимостей, типы агентов — type-only импорт.
 */

import type { CodingWorkflowInput } from '../coding-workflow/types.js';
import type { FileAgentInput } from '../agents/file-agent.js';
import type { PackageAgentInput } from '../agents/package-agent.js';
import type { ProcessAgentInput } from '../agents/process-agent.js';
import type { SystemResourceInput } from '../agents/system-resource-agent.js';
import type { TerminalAgentInput } from '../agents/terminal-agent.js';
import type { AgentRole } from '../director/director-types.js';
import type { ExtractedTask, TaskAction } from './types.js';

// ──────────────────────────────────────────────
// 1. Результат резолва
// ──────────────────────────────────────────────

/** Результат маппинга задачи на роли и входы */
export interface ResolvedTaskAction {
  /** Роли агентов для делегирования */
  roles: AgentRole[];
  /**
   * Вход для action-input-builder (структура совместима с типами агентов:
   * FileAgentInput / TerminalAgentInput / CodingWorkflowInput / ...).
   * Пустой объект — роли, не требующие структурированного входа.
   */
  input: unknown;
  /** Человекочитаемое описание задачи для плана */
  description: string;
}

/** Роли по умолчанию для исследовательских/портфельных задач */
const RESEARCH_ROLES: readonly AgentRole[] = ['research', 'ai'];
const PORTFOLIO_ROLES: readonly AgentRole[] = ['analysis', 'ai', 'strategist'];

// ──────────────────────────────────────────────
// 2. Резолвер
// ──────────────────────────────────────────────

/**
 * Сопоставить извлечённую задачу с ролями агентов и входом для
 * action-input-builder. Никогда не бросает: неизвестные параметры
 * нормализуются, отсутствующие — пропускаются.
 */
export function resolveTaskAction(task: ExtractedTask): ResolvedTaskAction {
  switch (task.action) {
    case 'file':
      return resolveFile(task);
    case 'terminal':
      return resolveTerminal(task);
    case 'code':
      return resolveCode(task);
    case 'package':
      return resolvePackage(task);
    case 'process':
      return resolveProcess(task);
    case 'automation':
      return resolveAutomation(task);
    case 'research':
      return {
        roles: [...RESEARCH_ROLES],
        input: {},
        description: `Исследование: ${task.target || task.rawText}`,
      };
    case 'portfolio':
      return {
        roles: [...PORTFOLIO_ROLES],
        input: {},
        description: `Анализ портфеля: ${task.target || task.rawText}`,
      };
    case 'goal':
      return {
        roles: [],
        input: {},
        description: `Цель автономного цикла: ${task.target || task.rawText}`,
      };
  }
}

// ── Файловые операции ──

function resolveFile(task: ExtractedTask): ResolvedTaskAction {
  const params = task.params as { action?: unknown; toPath?: unknown };
  const action = stringParam(params.action) ?? 'write';
  const input: FileAgentInput = {
    action: action as FileAgentInput['action'],
    path: task.target,
  };
  const toPath = stringParam(params.toPath);
  if (toPath) {
    input.toPath = toPath;
  }
  return {
    roles: ['file'],
    input,
    description: `Файловая операция «${action}»: ${task.target}`,
  };
}

// ── Терминальные операции ──

function resolveTerminal(task: ExtractedTask): ResolvedTaskAction {
  const params = task.params as { command?: unknown; args?: unknown };
  const command = stringParam(params.command) ?? task.target;
  const args = stringArrayParam(params.args);
  const input: TerminalAgentInput = { command, args };
  return {
    roles: ['terminal'],
    input,
    description: `Выполнить команду: ${[command, ...args].join(' ')}`,
  };
}

// ── Задачи разработки (CodingWorkflow) ──

function resolveCode(task: ExtractedTask): ResolvedTaskAction {
  const params = task.params as { files?: unknown; path?: unknown };
  const files = stringArrayParam(params.files);
  const singlePath = stringParam(params.path);
  const paths = files.length > 0 ? files : singlePath ? [singlePath] : [];
  const input: CodingWorkflowInput = {
    task: task.rawText,
    files: paths.map((path) => ({ path, content: '' })),
  };
  return {
    roles: ['code'],
    input,
    description: `Разработка кода: ${paths.join(', ') || task.target || task.rawText}`,
  };
}

// ── Операции с зависимостями ──

function resolvePackage(task: ExtractedTask): ResolvedTaskAction {
  const params = task.params as {
    action?: unknown;
    manager?: unknown;
    packages?: unknown;
  };
  const action = stringParam(params.action) ?? 'install';
  const manager = stringParam(params.manager) === 'pip' ? 'pip' : 'npm';
  const packages = stringArrayParam(params.packages);
  const input: PackageAgentInput = {
    action: action as PackageAgentInput['action'],
    manager,
    packages,
    dryRun: false,
  };
  return {
    roles: ['package'],
    input,
    description: `Операция с зависимостями «${action}» (${manager}): ${packages.join(', ') || task.target}`,
  };
}

// ── Операции с процессами / системными ресурсами ──

function resolveProcess(task: ExtractedTask): ResolvedTaskAction {
  const params = task.params as {
    action?: unknown;
    command?: unknown;
    args?: unknown;
    name?: unknown;
    scope?: unknown;
    restartOnExit?: unknown;
  };

  // Мониторинг системных ресурсов (SystemResourceAgent, только чтение)
  if (stringParam(params.scope) === 'system') {
    const input: SystemResourceInput = { action: 'status' };
    return {
      roles: ['system'],
      input,
      description: 'Снимок системных ресурсов (CPU/RAM)',
    };
  }

  const action = stringParam(params.action) ?? 'status';
  const command = stringParam(params.command);
  const args = stringArrayParam(params.args);
  const name = stringParam(params.name);
  const input: ProcessAgentInput = {
    action: action as ProcessAgentInput['action'],
  };
  if (command) input.command = command;
  if (args.length > 0) input.args = args;
  if (name) input.name = name;
  if (typeof params.restartOnExit === 'boolean') {
    input.restartOnExit = params.restartOnExit;
  }
  return {
    roles: ['process'],
    input,
    description: `Операция с процессом «${action}»: ${name ?? command ?? task.target}`,
  };
}

// ── Автоматизация ──

function resolveAutomation(task: ExtractedTask): ResolvedTaskAction {
  const params = task.params as { action?: unknown; params?: unknown };
  const action = stringParam(params.action) ?? 'get-templates';
  const nested =
    typeof params.params === 'object' && params.params !== null
      ? (params.params as Record<string, unknown>)
      : {};
  // AutomationAgentInput — discriminated union: структура params зависит от
  // action. Резолвер передаёт «сырой» вход, фасад приводит к конкретному
  // члену union при выполнении.
  const input = { action, params: { ...nested } };
  return {
    roles: ['automation'],
    input,
    description: `Автоматизация «${action}»: ${task.target || task.rawText}`,
  };
}

// ──────────────────────────────────────────────
// 3. Helpers
// ──────────────────────────────────────────────

/** Строковый параметр (null/undefined/не-строка → undefined) */
function stringParam(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return undefined;
}

/** Массив строк (null/undefined/не-массив → []) */
function stringArrayParam(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim() !== '') {
      result.push(item.trim());
    }
  }
  return result;
}

/** Все действия задач (для проверок и UI) */
export const TASK_ACTION_LABELS: Record<TaskAction, string> = {
  file: 'файловая операция',
  terminal: 'команда терминала',
  code: 'разработка кода',
  package: 'управление зависимостями',
  process: 'управление процессами',
  automation: 'автоматизация',
  research: 'исследование',
  portfolio: 'анализ портфеля',
  goal: 'цель автономного цикла',
};
