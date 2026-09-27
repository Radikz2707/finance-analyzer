/**
 * KPI Sink Tests — авто-архивация сжатых KPI в стратегическую память.
 */

import {
  savePortfolioKpi,
  buildCompactKpi,
  type KpiMemory,
} from './kpi-sink.js';
import type { PortfolioKpiSnapshot } from './types.js';
import type { PipelineResult } from '../pipeline-coordinator.js';
import type { DataAgentOutput } from '../agents/data-agent.js';
import type { AnalysisAgentOutput } from '../agents/analysis-agent.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeDataOutput(
  overrides: Partial<DataAgentOutput> = {},
): DataAgentOutput {
  return {
    aggregated: [],
    assets: [
      {
        name: 'Сбербанк',
        ticker: 'SBER',
        assetType: 'А',
        liquidationPercent: 40,
        balancePercent: 40,
        unrealizedProfitRub: 5000,
        dynamicsPercent: 1,
        dailyDynamicsPercent: 1.5,
      },
    ],
    macroGoals: {
      totalBalance: 500000,
      freeCash: 10000,
      stocksPercent: 60,
      bondsPercent: 30,
      stocksDeficitRub: 10000,
      bondsDeficitRub: 5000,
      iisOrdersSum: 0,
      brokerOrdersSum: 0,
      activeOrdersListText: '',
    },
    accounts: [],
    quotes: {
      SBER: {
        ticker: 'SBER',
        name: 'Сбербанк',
        shortName: 'SBER',
        currentPrice: 250,
        dailyDynamicsPercent: 5.2,
      },
      GAZP: {
        ticker: 'GAZP',
        name: 'Газпром',
        shortName: 'GAZP',
        currentPrice: 160,
        dailyDynamicsPercent: -3.1,
      },
    },
    activeOrders: [],
    historicalTrades: {
      tradesCount: 0,
      totalPurchasesSum: 0,
      totalSalesSum: 0,
      profitC10: 15000,
      profitC11: 0,
      totalHistoricalCommission: 0,
    },
    investedFunds: { totalNet: 500000, totalPurchases: 0, totalSales: 0 },
    news: null,
    anomalies: [
      {
        ticker: 'SBER',
        lastPrice: 250,
        zScoreLast: 2.5,
        isLastAnomaly: true,
        volatilityAnnual: 30,
        rsi: 70,
        sma20: 240,
        sma50: 235,
        trend: 'up',
        riskLevel: 'medium',
        anomaliesCount: 2,
        pointsCount: 60,
        anomalies: [],
      },
    ],
    ...overrides,
  };
}

function makeAnalysisOutput(
  overrides: Partial<AnalysisAgentOutput> = {},
): AnalysisAgentOutput {
  return {
    portfolioAnalysis: {
      assetsAnalysis: [],
      macro: {
        totalBalance: 500000,
        freeCash: 10000,
        stocksDeficitRub: 10000,
        bondsDeficitRub: 5000,
      },
    },
    riskValidation: { isValid: true, errors: [] },
    income: { stocks: [], totalNkd: 0, totalDivs: 12000, totalDivsNet: 10000 },
    priceAlerts: [],
    priceAlertsMd: '',
    ...overrides,
  };
}

function makeResult(
  data?: DataAgentOutput,
  analysis?: AnalysisAgentOutput,
  success = true,
): PipelineResult {
  const iso = new Date().toISOString();
  return {
    pipelineId: 'test-pipeline',
    startedAt: iso,
    completedAt: iso,
    totalDurationMs: 1,
    stages: {
      data: data
        ? {
            stage: 'data',
            result: { success: true, data, durationMs: 1, completedAt: iso },
            durationMs: 1,
          }
        : null,
      research: null,
      analysis: analysis
        ? {
            stage: 'analysis',
            result: {
              success: true,
              data: analysis,
              durationMs: 1,
              completedAt: iso,
            },
            durationMs: 1,
          }
        : null,
      ai: null,
      review: null,
      notification: null,
    },
    agentSummaries: {},
    success,
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('KPI Sink', () => {
  it('вызывает saveStrategicKpi с KPI-снимком из реальных данных', async () => {
    const saved: PortfolioKpiSnapshot[] = [];
    const memory: KpiMemory = {
      saveStrategicKpi: async (snapshot) => {
        saved.push(snapshot);
      },
    };

    const result = makeResult(makeDataOutput(), makeAnalysisOutput());
    const ok = await savePortfolioKpi(memory, result);

    expect(ok).toBe(true);
    expect(saved).toHaveLength(1);

    const snapshot = saved[0];
    expect(snapshot!.date).toBeDefined();
    expect(snapshot!.totalValue).toBe(500000);
    expect(snapshot!.stocksPercent).toBe(60);
    expect(snapshot!.bondsPercent).toBe(30);
    expect(snapshot!.assetCount).toBe(1);
    expect(snapshot!.dividendIncome).toBe(10000);
    expect(snapshot!.realizedProfit).toBe(15000);
    expect(snapshot!.unrealizedProfit).toBe(5000);
  });

  it('buildCompactKpi собирает только реальные поля', () => {
    const result = makeResult(makeDataOutput(), makeAnalysisOutput());
    const kpi = buildCompactKpi(result);

    expect(kpi).not.toBeNull();
    expect(kpi?.totalValue).toBe(500000);
    expect(kpi?.stocksShare).toBe(60);
    expect(kpi?.bondsShare).toBe(30);
    expect(kpi?.freeCash).toBe(10000);
    expect(kpi?.riskLevel).toBe('low');
    expect(kpi?.anomaliesCount).toBe(1);
    // Топ-движущиеся: SBER (+5.2%) и GAZP (-3.1%)
    expect(kpi?.topMovers).toHaveLength(2);
    expect(kpi?.topMovers?.[0]).toMatchObject({
      ticker: 'SBER',
      dailyDynamicsPercent: 5.2,
    });
  });

  it('с пустыми данными (нет value/долей) — save НЕ вызывается', async () => {
    let calls = 0;
    const memory: KpiMemory = {
      saveStrategicKpi: async () => {
        calls++;
      },
    };

    // Пустой результат без stages.data и stages.analysis
    const emptyResult = makeResult(undefined, undefined);
    const ok = await savePortfolioKpi(memory, emptyResult);

    expect(ok).toBe(false);
    expect(calls).toBe(0);
  });

  it('memory отсутствует → false без вызова', async () => {
    const result = makeResult(makeDataOutput(), makeAnalysisOutput());
    const ok = await savePortfolioKpi(null, result);
    expect(ok).toBe(false);
  });

  it('ошибка сохранения в памяти → false (не роняет вызов)', async () => {
    const memory: KpiMemory = {
      saveStrategicKpi: async () => {
        throw new Error('db locked');
      },
    };

    const result = makeResult(makeDataOutput(), makeAnalysisOutput());
    const ok = await savePortfolioKpi(memory, result);
    expect(ok).toBe(false);
  });
});
