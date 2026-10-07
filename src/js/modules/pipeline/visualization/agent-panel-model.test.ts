/**
 * Agent Panel Model — тесты чистой модели данных панели управления агентами.
 *
 * Покрытие:
 * - пустые источники → «данные недоступны» (available=false) и корректный overall;
 * - карточки из getSummary() агентов (счётчики, статусы, lastError/lastDurationMs);
 * - failed-агент → warnings/critical;
 * - chain-группировка по runId из реальной структуры HistoryAgent;
 * - лимит истории (последние N событий, новые сверху);
 * - сводки Watchdog и AgentController и их влияние на overall.
 */

import {
  buildAgentCatalogCards,
  buildPanelState,
  computeOverall,
  HISTORY_VIEW_LIMIT,
  mapAgentStatus,
  SYSTEM_AGENT_CATALOG,
  type AgentCard,
  type AgentControllerSource,
  type AgentWatchdogSource,
} from './agent-panel-model.js';
import { createHistoryAgent } from '../agents/history-agent.js';
import type { AgentSummary, AgentState } from '../agent/types.js';
import type { AgentStatus } from '../controller/agent-controller.js';
import type { AgentHealthReport, IncidentRecord } from '../watchdog/types.js';

// ─── Helpers ───────────────────────────────────────────────────────

function summary(
  name: string,
  state: AgentState,
  overrides: Partial<AgentSummary> = {},
): AgentSummary {
  return {
    name,
    state,
    totalExecutions: 1,
    totalSuccesses: 1,
    totalFailures: 0,
    ...overrides,
  };
}

/** Источник agents из готовых сводок (через getSummary()) */
function agentsWith(
  ...summaries: AgentSummary[]
): Array<{ getSummary(): AgentSummary }> {
  return summaries.map((s) => ({ getSummary: () => s }));
}

function fakeWatchdog(
  report: AgentHealthReport,
  incidents: IncidentRecord[],
  state: string,
): AgentWatchdogSource {
  return {
    getHealthReport: () => report,
    getIncidents: () => incidents,
    getState: () => state,
  };
}

function emptyHealthReport(): AgentHealthReport {
  return {
    agents: [],
    unhealthyAgents: [],
    avgResponseTimeMs: 0,
    maxResponseTimeMs: 0,
  };
}

function incident(severity: IncidentRecord['severity']): IncidentRecord {
  return {
    id: 'inc-1',
    occurredAt: new Date().toISOString(),
    agentName: 'DataAgent',
    type: 'timeout',
    severity,
    message: 'timeout',
    recoveryAttempts: 1,
  };
}

function fakeController(statuses: AgentStatus[]): AgentControllerSource {
  return { getAllStatuses: () => statuses };
}

function controllerStatus(
  name: string,
  status: AgentStatus['status'],
): AgentStatus {
  return {
    name,
    status,
    stats: { totalExecutions: 0, totalSuccesses: 0, totalFailures: 0 },
    config: { name },
  };
}

// ─── Пустые источники ─────────────────────────────────────────────

describe('buildPanelState — пустые источники', () => {
  it('без источников: данные недоступны, массивы пусты, overall ok', () => {
    const state = buildPanelState();
    expect(state.available).toEqual({
      agents: false,
      history: false,
      watchdog: false,
      controller: false,
    });
    expect(state.agents).toEqual([]);
    expect(state.chains).toEqual([]);
    expect(state.history).toEqual([]);
    expect(state.overall).toBe('ok');
  });

  it('пустой массив агентов = данные недоступны (не выдумываем)', () => {
    const state = buildPanelState({ agents: [] });
    expect(state.available.agents).toBe(false);
    expect(state.agents).toEqual([]);
  });
});

// ─── Карточки агентов ─────────────────────────────────────────────

describe('buildPanelState — карточки из getSummary()', () => {
  it('строит карточки со счётчиками и статусом', () => {
    const state = buildPanelState({
      agents: agentsWith(
        summary('DataAgent', 'running', {
          totalExecutions: 5,
          totalSuccesses: 4,
          totalFailures: 1,
        }),
        summary('AnalysisAgent', 'idle'),
      ),
    });

    expect(state.available.agents).toBe(true);
    expect(state.agents).toHaveLength(2);

    const [dataAgent, analysisAgent] = state.agents;
    expect(dataAgent?.name).toBe('DataAgent');
    expect(dataAgent?.status).toBe('running');
    expect(dataAgent?.totalExecutions).toBe(5);
    expect(dataAgent?.successes).toBe(4);
    expect(dataAgent?.failures).toBe(1);

    expect(analysisAgent?.name).toBe('AnalysisAgent');
    expect(analysisAgent?.status).toBe('idle');
  });

  it('принимает готовые AgentSummary без getSummary()', () => {
    const state = buildPanelState({
      agents: [summary('DirectAgent', 'error')],
    });
    expect(state.agents[0]?.name).toBe('DirectAgent');
    expect(state.agents[0]?.status).toBe('error');
  });

  it('переносит lastError и lastDurationMs из последнего выполнения', () => {
    const state = buildPanelState({
      agents: agentsWith(
        summary('FileAgent', 'idle', {
          lastExecution: {
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 1234,
            success: false,
            error: 'EACCES: permission denied',
          },
        }),
      ),
    });

    expect(state.agents[0]?.lastError).toBe('EACCES: permission denied');
    expect(state.agents[0]?.lastDurationMs).toBe(1234);
  });

  it('успешное последнее выполнение не даёт lastError', () => {
    const state = buildPanelState({
      agents: agentsWith(
        summary('DataAgent', 'idle', {
          lastExecution: {
            startedAt: new Date().toISOString(),
            durationMs: 800,
            success: true,
          },
        }),
      ),
    });

    expect(state.agents[0]?.lastError).toBeUndefined();
    expect(state.agents[0]?.lastDurationMs).toBe(800);
  });

  it('mapAgentStatus: paused трактуется как stopped, неизвестное — unknown', () => {
    expect(mapAgentStatus('idle')).toBe('idle');
    expect(mapAgentStatus('running')).toBe('running');
    expect(mapAgentStatus('error')).toBe('error');
    expect(mapAgentStatus('stopped')).toBe('stopped');
    expect(mapAgentStatus('paused')).toBe('stopped');
    expect(mapAgentStatus('bogus' as AgentState)).toBe('unknown');
  });
});

// ─── Overall ──────────────────────────────────────────────────────

describe('buildPanelState — overall', () => {
  it('failed-агент (сбои в статистике) → warnings', () => {
    const state = buildPanelState({
      agents: agentsWith(
        summary('DataAgent', 'idle', { totalFailures: 2, totalSuccesses: 3 }),
      ),
    });
    expect(state.overall).toBe('warnings');
  });

  it('агент в состоянии error → critical', () => {
    const state = buildPanelState({
      agents: agentsWith(summary('DataAgent', 'error')),
    });
    expect(state.overall).toBe('critical');
  });

  it('lastError без ошибок в статистике → warnings', () => {
    const state = buildPanelState({
      agents: agentsWith(
        summary('FileAgent', 'idle', {
          lastExecution: {
            startedAt: new Date().toISOString(),
            durationMs: 500,
            success: false,
            error: 'boom',
          },
        }),
      ),
    });
    expect(state.overall).toBe('warnings');
  });

  it('computeOverall: пустой ввод → ok', () => {
    expect(computeOverall({ agents: [], chains: [] })).toBe('ok');
  });
});

// ─── Цепочки из HistoryAgent ──────────────────────────────────────

describe('buildPanelState — chain-группировка по runId', () => {
  it('из chain() HistoryAgent строятся ChainView с шагами и успехом', () => {
    const history = createHistoryAgent();
    history.startRun();
    const runId = history.activeRunId as string;

    history.record({
      agentName: 'FileAgent',
      action: 'read',
      status: 'success',
      detail: 'ok',
    });
    history.record({
      agentName: 'AnalysisAgent',
      action: 'analyze',
      status: 'success',
      detail: 'ok',
    });

    const state = buildPanelState({ history });

    expect(state.available.history).toBe(true);
    expect(state.chains).toHaveLength(1);
    const chain = state.chains[0];
    expect(chain?.runId).toBe(runId);
    expect(chain?.startedAt).toBeDefined();
    expect(chain?.endedAt).toBeDefined();
    expect(chain?.steps.map((step) => step.agentName)).toEqual([
      'FileAgent',
      'AnalysisAgent',
    ]);
    expect(chain?.steps.map((step) => step.action)).toEqual([
      'read',
      'analyze',
    ]);
    expect(chain?.success).toBe(true);
  });

  it('failed-шаг в цепочке → success=false и overall critical', () => {
    const history = createHistoryAgent();
    history.startRun();

    history.record({
      agentName: 'FileAgent',
      action: 'read',
      status: 'success',
    });
    history.record({
      agentName: 'FileAgent',
      action: 'write',
      status: 'failed',
      detail: 'EACCES',
    });

    const state = buildPanelState({ history });

    expect(state.chains[0]?.success).toBe(false);
    expect(state.overall).toBe('critical');
  });

  it('несколько runId группируются в отдельные цепочки (новые сверху)', () => {
    const history = createHistoryAgent();

    // Явные createdAt, чтобы startedAt цепочек различался (иначе оба запуска
    // попадают в одну миллисекунду и порядок недетерминирован).
    history.startRun();
    history.record({
      agentName: 'AgentA',
      action: 'first',
      status: 'success',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const firstRunId = history.activeRunId as string;

    history.startRun();
    history.record({
      agentName: 'AgentB',
      action: 'second',
      status: 'success',
      createdAt: '2026-01-01T00:00:02.000Z',
    });
    const secondRunId = history.activeRunId as string;

    const state = buildPanelState({ history });

    expect(state.chains).toHaveLength(2);
    expect(state.chains[0]?.runId).toBe(secondRunId);
    expect(state.chains[1]?.runId).toBe(firstRunId);
  });
});

// ─── История (лимит и порядок) ────────────────────────────────────

describe('buildPanelState — история действий', () => {
  it('ограничена последними N событиями, новые сверху', () => {
    const history = createHistoryAgent();
    history.startRun();
    const total = HISTORY_VIEW_LIMIT + 3;

    for (let i = 0; i < total; i++) {
      history.record({
        agentName: 'Agent' + i,
        action: 'act',
        status: 'success',
      });
    }

    const state = buildPanelState({ history });

    expect(state.history).toHaveLength(HISTORY_VIEW_LIMIT);
    expect(state.history[0]?.agentName).toBe('Agent' + (total - 1));
    expect(state.history[HISTORY_VIEW_LIMIT - 1]?.agentName).toBe(
      'Agent' + (total - HISTORY_VIEW_LIMIT),
    );
    expect(state.history[0]?.action).toBe('act');
    expect(state.history[0]?.status).toBe('success');
    expect(state.history[0]?.createdAt).toBeDefined();
  });
});

// ─── Watchdog и AgentController ───────────────────────────────────

describe('buildPanelState — Watchdog', () => {
  it('сводка сторожевого процесса попадает в состояние', () => {
    const state = buildPanelState({
      watchdog: fakeWatchdog(
        emptyHealthReport(),
        [incident('warning')],
        'monitoring',
      ),
    });

    expect(state.available.watchdog).toBe(true);
    expect(state.watchdog).toMatchObject({
      state: 'monitoring',
      incidents: 1,
      criticalIncidents: 0,
      unhealthyAgents: 0,
      avgResponseTimeMs: 0,
    });
    // Некритический инцидент → warnings
    expect(state.overall).toBe('warnings');
  });

  it('критический инцидент → overall critical', () => {
    const state = buildPanelState({
      watchdog: fakeWatchdog(
        emptyHealthReport(),
        [incident('critical')],
        'monitoring',
      ),
    });
    expect(state.watchdog?.criticalIncidents).toBe(1);
    expect(state.overall).toBe('critical');
  });

  it('unhealthy-агенты → warnings', () => {
    const report = emptyHealthReport();
    report.unhealthyAgents = [
      {
        agentName: 'DataAgent',
        lastCheckedAt: new Date().toISOString(),
        responseTimeMs: 40000,
        status: 'timeout',
      },
    ];
    const state = buildPanelState({
      watchdog: fakeWatchdog(report, [], 'monitoring'),
    });
    expect(state.overall).toBe('warnings');
  });
});

describe('buildPanelState — AgentController', () => {
  it('сводка контроллера: количество и статусы', () => {
    const state = buildPanelState({
      controller: fakeController([
        controllerStatus('A', 'running'),
        controllerStatus('B', 'error'),
        controllerStatus('C', 'stopped'),
        controllerStatus('D', 'idle'),
      ]),
    });

    expect(state.available.controller).toBe(true);
    expect(state.controller).toMatchObject({
      agentsCount: 4,
      running: 1,
      errors: 1,
      stopped: 1,
    });
    // Ошибка в контроллере → critical
    expect(state.overall).toBe('critical');
  });

  it('без ошибок → overall ok', () => {
    const state = buildPanelState({
      controller: fakeController([controllerStatus('A', 'idle')]),
    });
    expect(state.overall).toBe('ok');
  });
});

describe('buildAgentCatalogCards — каталог всех агентов системы', () => {
  it('дополняет реальные карточки каталогом, известные не дублируются', () => {
    const known: AgentCard[] = [
      {
        name: 'FileAgent',
        status: 'running',
        totalExecutions: 3,
        successes: 2,
        failures: 1,
      },
    ];
    const cards = buildAgentCatalogCards(known);

    expect(cards.length).toBeGreaterThanOrEqual(SYSTEM_AGENT_CATALOG.length);
    const names = cards.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);

    const fileCards = cards.filter((c) => c.name === 'FileAgent');
    expect(fileCards).toHaveLength(1);
    expect(fileCards[0]).toMatchObject({
      status: 'running',
      totalExecutions: 3,
      successes: 2,
      failures: 1,
    });

    const idleCard = cards.find((c) => c.name === 'DataAgent');
    expect(idleCard).toMatchObject({
      status: 'idle',
      totalExecutions: 0,
      successes: 0,
      failures: 0,
    });
  });

  it('без известных карточек возвращает только каталог в статусе idle', () => {
    const cards = buildAgentCatalogCards([]);

    expect(cards).toHaveLength(SYSTEM_AGENT_CATALOG.length);
    expect(cards.every((c) => c.status === 'idle')).toBe(true);
  });
});
