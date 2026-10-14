/**
 * Activity Renderer — чистая функция форматирования события активности
 * в строку чата.
 *
 * Примеры:
 * - «🔍 ResearchAgent: собираю факты по SBER»
 * - «✅ AnalysisAgent: готово за 120 мс»
 * - «❌ ResearchAgent: ошибка: таймаут сети»
 *
 * Модуль не имеет runtime-зависимостей (только type-only импорт) — работает
 * и в Node, и в браузере.
 */

import type { AgentActivityEvent, AgentActivityPhase } from './types.js';

/** Человекочитаемые метки ролей агентов */
const ROLE_LABELS: Record<string, string> = {
  ai: 'AI Agent',
  analysis: 'AnalysisAgent',
  research: 'ResearchAgent',
  strategist: 'StrategistAgent',
  scenario: 'ScenarioAgent',
  review: 'ReviewAgent',
  file: 'FileAgent',
  terminal: 'TerminalAgent',
  package: 'PackageAgent',
  process: 'ProcessAgent',
  automation: 'AutomationAgent',
  system: 'SystemResourceAgent',
  code: 'CodingWorkflow',
};

/** Иконки фаз */
const PHASE_ICONS: Record<AgentActivityPhase, string> = {
  started: '🔍',
  step: '⚙️',
  completed: '✅',
  failed: '❌',
};

/** Человекочитаемая метка роли агента */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/**
 * Отформатировать событие активности в строку чата.
 * Для completed/failed с durationMs добавляется суффикс «за N мс».
 */
export function formatActivityEvent(event: AgentActivityEvent): string {
  const label = roleLabel(event.role);
  const icon = PHASE_ICONS[event.phase] ?? '•';
  const duration =
    event.durationMs !== undefined ? ` за ${event.durationMs} мс` : '';
  return `${icon} ${label}: ${event.message}${duration}`;
}
