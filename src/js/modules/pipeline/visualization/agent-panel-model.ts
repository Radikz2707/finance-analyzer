/**
 * Agent Panel Model — чистая модель данных «панели управления агентами».
 *
 * Модуль НЕ зависит от DOM и браузерных API: только типы и чистые функции,
 * поэтому полностью покрывается unit-тестами без браузера (этап 5.2).
 *
 * Источники данных — опциональные DI-объекты (структурные контракты, а не
 * конкретные классы):
 * - `agents` — агенты с `getSummary()` (IAgent/AgentBase) или готовые сводки
 *   `AgentSummary`;
 * - `history` — HistoryAgent (методы getAll()/chain());
 * - `watchdog` — Watchdog (getHealthReport()/getIncidents()/getState());
 * - `controller` — AgentController (getAllStatuses()).
 *
 * Если источник не передан — панель честно показывает «данные недоступны»
 * (флаги `available`), ничего не выдумывая.
 */

import type { AgentSummary, AgentState } from '../agent/types.js';
import type {
  HistoryEvent,
  HistoryStatus,
  HistoryTrace,
} from '../agents/history-agent.js';
import type { AgentHealthReport, IncidentRecord } from '../watchdog/types.js';
import type { AgentStatus } from '../controller/agent-controller.js';

// ──────────────────────────────────────────────
// 1. Типы панели
// ──────────────────────────────────────────────

/** Общая оценка состояния: ok / warnings / critical */
export type PanelOverall = 'ok' | 'warnings' | 'critical';

/**
 * Статус агента на панели. 'paused' из AgentState сознательно маппится в
 * 'stopped' (агент приостановлен = не выполняет работу) — см. mapAgentStatus.
 */
export type PanelAgentStatus =
  'idle' | 'running' | 'error' | 'stopped' | 'unknown';

/** Карточка одного агента (из getSummary()) */
export interface AgentCard {
  /** Имя агента */
  name: string;
  /** Текущий статус */
  status: PanelAgentStatus;
  /** Всего выполнений */
  totalExecutions: number;
  /** Успешных выполнений */
  successes: number;
  /** Провальных выполнений */
  failures: number;
  /** Текст последней ошибки (если последнее выполнение провалено) */
  lastError?: string;
  /** Длительность последнего выполнения (мс) */
  lastDurationMs?: number;
}

/** Шаг цепочки выполнения */
export interface ChainStep {
  id: string;
  agentName: string;
  action: string;
  status: HistoryStatus;
  createdAt: string;
  durationMs?: number;
}

/** Цепочка выполнения одного запроса (группировка по runId) */
export interface ChainView {
  /** Сквозной ID запуска */
  runId: string;
  /** Шаги в хронологическом порядке */
  steps: ChainStep[];
  /** Время первого шага */
  startedAt?: string;
  /** Время последнего шага */
  endedAt?: string;
  /** Успех всей цепочки: true / false / undefined (нет данных или только blocked) */
  success?: boolean;
}

/** Строка истории действий */
export interface HistoryEntryView {
  id: string;
  agentName: string;
  action: string;
  status: HistoryStatus;
  createdAt: string;
  durationMs?: number;
}

/** Сводка Watchdog для панели */
export interface WatchdogView {
  /** Состояние сторожевого процесса (idle/monitoring/recovering/stopped) */
  state: string;
  /** Всего инцидентов */
  incidents: number;
  /** Критических инцидентов */
  criticalIncidents: number;
  /** Агентов с проблемным здоровьем (slow/timeout/error) */
  unhealthyAgents: number;
  /** Среднее время ответа (мс) */
  avgResponseTimeMs: number;
}

/** Сводка AgentController для панели */
export interface ControllerView {
  /** Всего зарегистрированных агентов */
  agentsCount: number;
  /** Выполняются сейчас */
  running: number;
  /** В состоянии error */
  errors: number;
  /** Остановлены */
  stopped: number;
}

/** Доступность источников (для честного «данные недоступны») */
export interface PanelSourceAvailability {
  agents: boolean;
  history: boolean;
  watchdog: boolean;
  controller: boolean;
}

/** Итоговое состояние панели — результат buildPanelState() */
export interface AgentPanelState {
  agents: AgentCard[];
  chains: ChainView[];
  history: HistoryEntryView[];
  overall: PanelOverall;
  available: PanelSourceAvailability;
  watchdog?: WatchdogView;
  controller?: ControllerView;
}

// ──────────────────────────────────────────────
// 2. DI-источники (структурные контракты)
// ──────────────────────────────────────────────

/** Элемент источника agents: объект с getSummary() или готовая сводка */
export type AgentSourceItem = { getSummary(): AgentSummary } | AgentSummary;

/** Структурный контракт HistoryAgent (только чтение, для панели) */
export interface AgentHistorySource {
  /** Все события, новые сверху */
  getAll(): readonly HistoryEvent[];
  /** Все цепочки по runId (новые сверху) */
  chain(): readonly HistoryTrace[];
}

/** Структурный контракт Watchdog (только чтение, для панели) */
export interface AgentWatchdogSource {
  getHealthReport(): AgentHealthReport;
  getIncidents(): readonly IncidentRecord[];
  getState(): string;
}

/** Структурный контракт AgentController (только чтение, для панели) */
export interface AgentControllerSource {
  getAllStatuses(): readonly AgentStatus[];
}

/** DI-источники панели — все опциональны */
export interface AgentPanelSources {
  agents?: ReadonlyArray<AgentSourceItem>;
  history?: AgentHistorySource;
  watchdog?: AgentWatchdogSource;
  controller?: AgentControllerSource;
}

// ──────────────────────────────────────────────
// 3. Сборка состояния
// ──────────────────────────────────────────────

/** Лимит строк истории на панели (последние N событий) */
export const HISTORY_VIEW_LIMIT = 10;

/**
 * Построить состояние панели из доступных источников.
 * Недостающие источники не выдумываются: массивы пусты, флаги available=false.
 */
export function buildPanelState(
  sources: AgentPanelSources = {},
): AgentPanelState {
  const agents = sources.agents ? sources.agents.map(toAgentCard) : [];
  const chains = sources.history ? toChainViews(sources.history.chain()) : [];
  const history = sources.history
    ? toHistoryEntries(sources.history.getAll())
    : [];
  const watchdog = sources.watchdog
    ? toWatchdogView(sources.watchdog)
    : undefined;
  const controller = sources.controller
    ? toControllerView(sources.controller)
    : undefined;

  return {
    agents,
    chains,
    history,
    overall: computeOverall({ agents, chains, watchdog, controller }),
    available: {
      agents: agents.length > 0,
      history: sources.history !== undefined,
      watchdog: sources.watchdog !== undefined,
      controller: sources.controller !== undefined,
    },
    watchdog,
    controller,
  };
}

// ──────────────────────────────────────────────
// 3.5 Каталог всех агентов системы
// ──────────────────────────────────────────────

/** Имена всех агентов конвейера (для панели «Агенты») */
export const SYSTEM_AGENT_CATALOG: ReadonlyArray<{ name: string }> = [
  { name: 'DataAgent' },
  { name: 'ResearchAgent' },
  { name: 'AnalysisAgent' },
  { name: 'AiAgent' },
  { name: 'ReviewAgent' },
  { name: 'NotificationAgent' },
  { name: 'StrategistAgent' },
  { name: 'ScenarioAgent' },
  { name: 'Consilium' },
  { name: 'SecurityAgent' },
  { name: 'HistoryAgent' },
  { name: 'FileAgent' },
  { name: 'TerminalAgent' },
  { name: 'BrowserAgent' },
  { name: 'ConfigAgent' },
  { name: 'ProcessAgent' },
  { name: 'SchedulerAgent' },
  { name: 'LearningAgent' },
  { name: 'AutoRepairAgent' },
  { name: 'PackageAgent' },
];

/**
 * Дополнить карточки реальных агентов полным каталогом системы:
 * агенты, ещё не выполнявшиеся в текущей сессии, показываются как idle.
 */
export function buildAgentCatalogCards(known: AgentCard[]): AgentCard[] {
  const knownNames = new Set(known.map((card) => card.name));
  const rest: AgentCard[] = SYSTEM_AGENT_CATALOG.filter(
    (item) => !knownNames.has(item.name),
  ).map((item) => ({
    name: item.name,
    status: 'idle',
    totalExecutions: 0,
    successes: 0,
    failures: 0,
  }));
  return [...known, ...rest];
}

// ──────────────────────────────────────────────
// 4. Мапперы
// ──────────────────────────────────────────────

/** Привести источник агента к AgentSummary (getSummary() либо готовый объект) */
function toSummary(item: AgentSourceItem): AgentSummary {
  const withSummary = item as Partial<{ getSummary: () => AgentSummary }>;
  if (typeof withSummary.getSummary === 'function') {
    return withSummary.getSummary();
  }
  return item as AgentSummary;
}

/** Маппинг AgentState → статус карточки (paused трактуется как stopped) */
export function mapAgentStatus(state: AgentState): PanelAgentStatus {
  switch (state) {
    case 'idle':
      return 'idle';
    case 'running':
      return 'running';
    case 'error':
      return 'error';
    case 'stopped':
      return 'stopped';
    // paused ≈ приостановлен: не выполняет работу → показываем как stopped
    case 'paused':
      return 'stopped';
    default:
      return 'unknown';
  }
}

function toAgentCard(item: AgentSourceItem): AgentCard {
  const summary = toSummary(item);
  const card: AgentCard = {
    name: summary.name,
    status: mapAgentStatus(summary.state),
    totalExecutions: summary.totalExecutions,
    successes: summary.totalSuccesses,
    failures: summary.totalFailures,
  };
  if (summary.lastExecution) {
    card.lastDurationMs = summary.lastExecution.durationMs;
    if (!summary.lastExecution.success && summary.lastExecution.error) {
      card.lastError = summary.lastExecution.error;
    }
  }
  return card;
}

function toStep(event: HistoryEvent): ChainStep {
  return {
    id: event.id,
    agentName: event.agentName,
    action: event.action,
    status: event.status,
    createdAt: event.createdAt,
    durationMs: event.durationMs,
  };
}

/** Успех цепочки по сводке статусов внутри неё */
function chainSuccess(trace: HistoryTrace): boolean | undefined {
  const counts = trace.counts;
  if (counts.total === 0) return undefined;
  if (counts.failed > 0) return false;
  if (counts.blocked > 0) return undefined;
  return true;
}

function toChainViews(traces: readonly HistoryTrace[]): ChainView[] {
  return traces.map((trace) => ({
    runId: trace.runId ?? 'run-unknown',
    steps: trace.events.map(toStep),
    startedAt: trace.startedAt,
    endedAt: trace.completedAt,
    success: chainSuccess(trace),
  }));
}

function toHistoryEntries(events: readonly HistoryEvent[]): HistoryEntryView[] {
  // getAll() уже отдаёт новые сверху → берём первые N
  return events.slice(0, HISTORY_VIEW_LIMIT).map((event) => ({
    id: event.id,
    agentName: event.agentName,
    action: event.action,
    status: event.status,
    createdAt: event.createdAt,
    durationMs: event.durationMs,
  }));
}

function toWatchdogView(watchdog: AgentWatchdogSource): WatchdogView {
  const report = watchdog.getHealthReport();
  const incidents = watchdog.getIncidents();
  let criticalIncidents = 0;
  for (const incident of incidents) {
    if (incident.severity === 'critical') criticalIncidents++;
  }
  return {
    state: watchdog.getState(),
    incidents: incidents.length,
    criticalIncidents,
    unhealthyAgents: report.unhealthyAgents.length,
    avgResponseTimeMs: report.avgResponseTimeMs,
  };
}

function toControllerView(controller: AgentControllerSource): ControllerView {
  const statuses = controller.getAllStatuses();
  let running = 0;
  let errors = 0;
  let stopped = 0;
  for (const status of statuses) {
    if (status.status === 'running') {
      running++;
    } else if (status.status === 'error') {
      errors++;
    } else if (status.status === 'stopped') {
      stopped++;
    }
  }
  return { agentsCount: statuses.length, running, errors, stopped };
}

// ──────────────────────────────────────────────
// 5. Общая оценка состояния
// ──────────────────────────────────────────────

/** Вход для computeOverall (внутренний тип) */
export interface OverallInput {
  agents: AgentCard[];
  chains: ChainView[];
  watchdog?: WatchdogView;
  controller?: ControllerView;
}

/**
 * Сводная оценка состояния панели:
 * - critical — агент в состоянии error, критический инцидент Watchdog,
 *   ошибки в AgentController или проваленная цепочка;
 * - warnings — провалы в статистике (failures/lastError), некритические
 *   инциденты, проблемные проверки здоровья, blocked-шаги;
 * - ok — всё остальное (включая случай «источники не подключены»).
 */
export function computeOverall(input: OverallInput): PanelOverall {
  for (const agent of input.agents) {
    if (agent.status === 'error') return 'critical';
  }
  if (input.watchdog && input.watchdog.criticalIncidents > 0) {
    return 'critical';
  }
  if (input.controller && input.controller.errors > 0) {
    return 'critical';
  }
  for (const chain of input.chains) {
    if (chain.success === false) return 'critical';
  }

  for (const agent of input.agents) {
    if (agent.failures > 0) return 'warnings';
    if (agent.lastError) return 'warnings';
  }
  if (input.watchdog && input.watchdog.incidents > 0) return 'warnings';
  if (input.watchdog && input.watchdog.unhealthyAgents > 0) return 'warnings';
  for (const chain of input.chains) {
    for (const step of chain.steps) {
      if (step.status === 'blocked') return 'warnings';
    }
  }

  return 'ok';
}
