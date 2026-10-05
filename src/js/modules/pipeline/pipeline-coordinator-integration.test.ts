/**
 * PipelineCoordinator Integration Tests — Watchdog-мониторинг и memorySink.
 *
 * Агенты подменяются mock'ами через приватные поля координатора (без I/O).
 * Проверяется:
 * 1. Агенты регистрируются в Watchdog, health-отчёт заполняется, healthy.
 * 2. memorySink вызывается после успешного run().
 * 3. memorySink НЕ вызывается при ошибке run().
 */

import { PipelineCoordinator } from './pipeline-coordinator.js';
import type { PipelineResult } from './pipeline-coordinator.js';
import type {
  AgentResult,
  AgentState,
  AgentSummary,
  IAgent,
} from './agent/types.js';
import { Watchdog } from './watchdog/watchdog.js';
import type { DataAgentOutput } from './agents/data-agent.js';
import type { ResearchAgentOutput } from './agents/research-agent.js';
import type { AnalysisAgentOutput } from './agents/analysis-agent.js';
import type { AiAgentOutput } from './agents/ai-agent.js';
import type { NotificationAgentOutput } from './agents/notification-agent.js';
import type { ReviewResult, ReviewerResult } from './review/review-agent.js';

// ──────────────────────────────────────────────
// Mock Agent
// ──────────────────────────────────────────────

/** Простой детерминированный агент без I/O */
class MockAgent implements IAgent {
  readonly name: string;
  state: AgentState = 'idle';
  private readonly data: unknown;
  private readonly fail: boolean;

  constructor(name: string, data: unknown, opts: { fail?: boolean } = {}) {
    this.name = name;
    this.data = data;
    this.fail = opts.fail ?? false;
  }

  async execute(): Promise<AgentResult> {
    if (this.fail) {
      // Падение агента симулируется исключением — именно так runStage
      // видит ошибку этапа (AgentBase возвращает success=false, но
      // координатор в лямбде берёт только result.data).
      throw new Error(`${this.name} mock failure`);
    }
    return {
      success: true,
      data: this.data,
      durationMs: 1,
      completedAt: new Date().toISOString(),
    };
  }

  async stop(): Promise<void> {}

  getSummary(): AgentSummary {
    return {
      name: this.name,
      state: this.state,
      totalExecutions: 1,
      totalSuccesses: this.fail ? 0 : 1,
      totalFailures: this.fail ? 1 : 0,
    };
  }
}

/** Подменить приватных агентов координатора mock'ами */
function injectAgents(
  coordinator: PipelineCoordinator,
  agents: {
    data: IAgent;
    research: IAgent;
    analysis: IAgent;
    ai: IAgent;
    review: IAgent;
    notification: IAgent;
  },
): void {
  const internals = coordinator as unknown as {
    dataAgent: IAgent;
    researchAgent: IAgent;
    analysisAgent: IAgent;
    aiAgent: IAgent;
    reviewAgent: IAgent;
    notificationAgent: IAgent;
  };
  internals.dataAgent = agents.data;
  internals.researchAgent = agents.research;
  internals.analysisAgent = agents.analysis;
  internals.aiAgent = agents.ai;
  internals.reviewAgent = agents.review;
  internals.notificationAgent = agents.notification;
}

/** Детерминированный «быстрый» Watchdog (все агенты healthy) */
function makeFastWatchdog(): Watchdog {
  const watchdog = new Watchdog({ checkIntervalMs: 60_000, verbose: false });
  (
    watchdog as unknown as { getRandomResponseTime: () => number }
  ).getRandomResponseTime = () => 500; // < healthyMaxMs → healthy
  return watchdog;
}

// ──────────────────────────────────────────────
// Данные агентов
// ──────────────────────────────────────────────

const iso = new Date().toISOString();

function makeDataOutput(): DataAgentOutput {
  return {
    aggregated: [],
    assets: [],
    macroGoals: {
      totalBalance: 400000,
      freeCash: 20000,
      stocksPercent: 55,
      bondsPercent: 35,
      stocksDeficitRub: 10000,
      bondsDeficitRub: 5000,
      iisOrdersSum: 0,
      brokerOrdersSum: 0,
      activeOrdersListText: '',
    },
    accounts: [],
    quotes: {},
    activeOrders: [],
    historicalTrades: {
      tradesCount: 0,
      totalPurchasesSum: 0,
      totalSalesSum: 0,
      profitC10: 0,
      profitC11: 0,
      totalHistoricalCommission: 0,
    },
    investedFunds: { totalNet: 400000, totalPurchases: 0, totalSales: 0 },
    news: null,
    anomalies: [],
    keyRate: 21,
    keyRateDate: '29.10.2024',
  };
}

function makeResearchOutput(): ResearchAgentOutput {
  return {
    snapshots: new Map(),
    allConflicts: [],
    totalAssets: 0,
    researchTimestamp: iso,
  };
}

function makeAnalysisOutput(): AnalysisAgentOutput {
  return {
    portfolioAnalysis: {
      assetsAnalysis: [],
      macro: {
        totalBalance: 400000,
        freeCash: 20000,
        stocksDeficitRub: 10000,
        bondsDeficitRub: 5000,
      },
    },
    riskValidation: { isValid: true, errors: [] },
    income: { stocks: [], totalNkd: 0, totalDivs: 0, totalDivsNet: 0 },
    priceAlerts: [],
    priceAlertsMd: '',
  };
}

function makeAiOutput(): AiAgentOutput {
  return {
    thesisResults: new Map(),
    aiNarrative: '',
    aiClientResult: { text: '', modelUsed: 'test', success: true },
    structuredRecommendations: new Map(),
    validationWarnings: [],
  };
}

function makeReviewOutput(): ReviewResult {
  const reviewer: ReviewerResult = {
    reviewerType: 'conservative',
    name: 'Консервативный ревизор',
    warnings: [],
    recommendations: '',
    confidence: 85,
    summary: 'ok',
    durationMs: 1,
    timedOut: false,
  };
  return {
    reviewers: new Map([
      ['conservative', reviewer],
      [
        'aggressive',
        {
          ...reviewer,
          reviewerType: 'aggressive',
          name: 'Агрессивный ревизор',
        },
      ],
      [
        'risk_manager',
        { ...reviewer, reviewerType: 'risk_manager', name: 'Risk Manager' },
      ],
    ]),
    agreementPercent: 90,
    hasDisagreement: false,
    finalRecommendation: 'Все ревизоры согласны',
    reviewedAt: iso,
    metrics: {
      totalDurationMs: 3,
      reviewerTimings: { conservative: 1, aggressive: 1, risk_manager: 1 },
      successfulReviewers: 3,
      timedOutReviewers: 0,
    },
  };
}

function makeNotificationOutput(): NotificationAgentOutput {
  return {
    htmlPath: 'report.html',
    mdPath: 'report.md',
    htmlContent: '',
    mdContent: '',
    browserOpened: false,
    interactiveOrders: [],
  };
}

/** Полный набор успешных mock-агентов */
function buildAllAgents(): {
  data: IAgent;
  research: IAgent;
  analysis: IAgent;
  ai: IAgent;
  review: IAgent;
  notification: IAgent;
} {
  return {
    data: new MockAgent('DataAgent', makeDataOutput()),
    research: new MockAgent('ResearchAgent', makeResearchOutput()),
    analysis: new MockAgent('AnalysisAgent', makeAnalysisOutput()),
    ai: new MockAgent('AiAgent', makeAiOutput()),
    review: new MockAgent('ReviewAgent', makeReviewOutput()),
    notification: new MockAgent('NotificationAgent', makeNotificationOutput()),
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('PipelineCoordinator — Watchdog integration', () => {
  it('регистрирует агентов и заполняет health-отчёт (все healthy)', async () => {
    const watchdog = makeFastWatchdog();
    const coordinator = new PipelineCoordinator({}, { watchdog });
    injectAgents(coordinator, buildAllAgents());

    const result = await coordinator.run();

    expect(result.success).toBe(true);

    const report = watchdog.getHealthReport();
    expect(report.agents).toHaveLength(8);

    const names = report.agents.map((a) => a.agentName).sort();
    expect(names).toEqual(
      [
        'DataAgent',
        'ResearchAgent',
        'AnalysisAgent',
        'AiAgent',
        'ReviewAgent',
        'ScenarioAgent',
        'StrategistAgent',
        'NotificationAgent',
      ].sort(),
    );

    // Быстрые агенты → без проблемных
    expect(report.unhealthyAgents).toHaveLength(0);
    for (const agent of report.agents) {
      expect(agent.status).toBe('healthy');
    }

    // Отчёт попадает в PipelineResult
    expect(result.watchdogHealth).toBeDefined();
    expect(result.watchdogHealth!.agents).toHaveLength(8);
    expect(result.watchdogHealth!.unhealthyAgents).toHaveLength(0);

    await coordinator.shutdown();
  });

  it('watchdog по умолчанию создаётся и останавливается через shutdown', async () => {
    const coordinator = new PipelineCoordinator({});
    injectAgents(coordinator, buildAllAgents());

    // run() сам стартует/останавливает watchdog
    const result = await coordinator.run();
    expect(result.success).toBe(true);

    await coordinator.shutdown();
    expect(coordinator.state.stopped).toBe(true);
  });
});

describe('PipelineCoordinator — memorySink', () => {
  it('вызывает memorySink после успешного run()', async () => {
    let sinkCalls = 0;
    let sinkResult: PipelineResult | undefined;

    const coordinator = new PipelineCoordinator(
      {},
      {
        watchdog: makeFastWatchdog(),
        memorySink: async (r) => {
          sinkCalls++;
          sinkResult = r;
        },
      },
    );
    injectAgents(coordinator, buildAllAgents());

    const result = await coordinator.run();

    expect(result.success).toBe(true);
    expect(sinkCalls).toBe(1);
    expect(sinkResult?.pipelineId).toBe(result.pipelineId);
    expect(sinkResult?.success).toBe(true);

    await coordinator.shutdown();
  });

  it('НЕ вызывает memorySink при ошибке run()', async () => {
    let sinkCalls = 0;

    const coordinator = new PipelineCoordinator(
      {},
      {
        watchdog: makeFastWatchdog(),
        memorySink: async () => {
          sinkCalls++;
        },
      },
    );

    const agents = buildAllAgents();
    agents.data = new MockAgent('DataAgent', makeDataOutput(), {
      fail: true,
    });
    injectAgents(coordinator, agents);

    const result = await coordinator.run();

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(sinkCalls).toBe(0);

    await coordinator.shutdown();
  });

  it('падение memorySink не роняет run()', async () => {
    const coordinator = new PipelineCoordinator(
      {},
      {
        watchdog: makeFastWatchdog(),
        memorySink: async () => {
          throw new Error('sink down');
        },
      },
    );
    injectAgents(coordinator, buildAllAgents());

    const result = await coordinator.run();

    expect(result.success).toBe(true);

    await coordinator.shutdown();
  });
});
