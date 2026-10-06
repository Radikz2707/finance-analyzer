/**
 * Бенчмарк полного цикла PipelineCoordinator.
 *
 * Все 8 агентов подменяются mock'ами без I/O (по образцу интеграционных
 * тестов) — это чистый CPU-прогон: 8 стадий + consilium + watchdog,
 * без сети, БД и файловой системы.
 */

import { PipelineCoordinator } from '../pipeline-coordinator.js';
import type {
  AgentResult,
  AgentState,
  AgentSummary,
  IAgent,
} from '../agent/types.js';
import { Watchdog } from '../watchdog/watchdog.js';
import type { DataAgentOutput } from '../agents/data-agent.js';
import type { ResearchAgentOutput } from '../agents/research-agent.js';
import type { AnalysisAgentOutput } from '../agents/analysis-agent.js';
import type { AiAgentOutput } from '../agents/ai-agent.js';
import type { NotificationAgentOutput } from '../agents/notification-agent.js';
import type { ReviewResult, ReviewerResult } from '../review/review-agent.js';
import type { ScenarioAgentOutput } from '../agents/scenario-agent.js';
import type { StrategistAgentOutput } from '../agents/strategist-agent.js';
import { measure, type BenchmarkResult } from './benchmark-runner.js';

// ──────────────────────────────────────────────
// Mock-агент (без I/O)
// ──────────────────────────────────────────────

/** Детерминированный агент-заглушка: мгновенно возвращает подготовленные данные. */
class MockAgent implements IAgent {
  readonly name: string;
  state: AgentState = 'idle';
  private readonly data: unknown;

  constructor(name: string, data: unknown) {
    this.name = name;
    this.data = data;
  }

  async execute(): Promise<AgentResult> {
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
      totalSuccesses: 1,
      totalFailures: 0,
    };
  }
}

// ──────────────────────────────────────────────
// Данные агентов (синтетика в памяти)
// ──────────────────────────────────────────────

const iso = new Date().toISOString();

function makeDataOutput(): DataAgentOutput {
  return {
    aggregated: [],
    assets: [],
    macroGoals: {
      totalBalance: 4_800_000,
      freeCash: 200_000,
      stocksPercent: 60,
      bondsPercent: 35,
      stocksDeficitRub: 50_000,
      bondsDeficitRub: 0,
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
    investedFunds: { totalNet: 4_800_000, totalPurchases: 0, totalSales: 0 },
    news: null,
    anomalies: [],
    keyRate: 21,
    keyRateDate: '06.10.2026',
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
        totalBalance: 4_800_000,
        freeCash: 200_000,
        stocksDeficitRub: 50_000,
        bondsDeficitRub: 0,
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
    aiClientResult: { text: '', modelUsed: 'BENCH_MOCK', success: true },
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
      ['aggressive', { ...reviewer, reviewerType: 'aggressive' }],
      ['risk_manager', { ...reviewer, reviewerType: 'risk_manager' }],
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

function makeScenarioOutput(): ScenarioAgentOutput {
  return {
    scenarios: [],
    bestScenarioId: null,
    summary: {
      scenariosBuilt: 0,
      baselineDeviationPct: 0,
      bestImprovementPct: 0,
    },
  };
}

function makeStrategistOutput(): StrategistAgentOutput {
  return {
    decisions: [],
    summary: { assetsChecked: 0, goal: 'bench' },
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

// ──────────────────────────────────────────────
// Инъекция моков в приватные поля координатора
// ──────────────────────────────────────────────

interface CoordinatorInternals {
  dataAgent: IAgent;
  researchAgent: IAgent;
  analysisAgent: IAgent;
  aiAgent: IAgent;
  reviewAgent: IAgent;
  scenarioAgent: IAgent;
  strategistAgent: IAgent;
  notificationAgent: IAgent;
}

function injectAllAgents(coordinator: PipelineCoordinator): void {
  const internals = coordinator as unknown as CoordinatorInternals;
  internals.dataAgent = new MockAgent('DataAgent', makeDataOutput());
  internals.researchAgent = new MockAgent(
    'ResearchAgent',
    makeResearchOutput(),
  );
  internals.analysisAgent = new MockAgent(
    'AnalysisAgent',
    makeAnalysisOutput(),
  );
  internals.aiAgent = new MockAgent('AiAgent', makeAiOutput());
  internals.reviewAgent = new MockAgent('ReviewAgent', makeReviewOutput());
  internals.scenarioAgent = new MockAgent(
    'ScenarioAgent',
    makeScenarioOutput(),
  );
  internals.strategistAgent = new MockAgent(
    'StrategistAgent',
    makeStrategistOutput(),
  );
  internals.notificationAgent = new MockAgent(
    'NotificationAgent',
    makeNotificationOutput(),
  );
}

// ──────────────────────────────────────────────
// Замер
// ──────────────────────────────────────────────

/** Выполнить fn, временно заглушив консоль (координатор логирует каждый этап). */
async function withSilencedConsole<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
}

/** Замер полного цикла pipeline: среднее время и p95 по N прогонам. */
export async function runPipelineTimingBenchmarks(): Promise<
  BenchmarkResult[]
> {
  // «Быстрый» watchdog: агенты всегда healthy, без случайных задержек.
  const watchdog = new Watchdog({ checkIntervalMs: 60_000, verbose: false });
  (
    watchdog as unknown as { getRandomResponseTime: () => number }
  ).getRandomResponseTime = () => 0;

  const coordinator = new PipelineCoordinator({}, { watchdog });
  injectAllAgents(coordinator);

  try {
    const result = await withSilencedConsole(() =>
      measure(
        'pipeline-full-cycle (8 stages, mocks)',
        () => coordinator.run(),
        { iterations: 10, warmup: 1 },
      ),
    );
    return [result];
  } finally {
    await withSilencedConsole(() => coordinator.shutdown());
  }
}
