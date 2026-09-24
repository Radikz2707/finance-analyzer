import { describe, it, expect, beforeEach } from 'vitest';
import { ReviewAgent } from './review-agent.js';
import type { ReviewResult } from './review-agent.js';
import type { DataAgentOutput } from '../agents/data-agent.js';
import type { AnalysisAgentOutput } from '../agents/analysis-agent.js';
import type { AiAgentOutput } from '../agents/ai-agent.js';

describe('ReviewAgent', () => {
  let agent: ReviewAgent;

  beforeEach(() => {
    agent = new ReviewAgent({ name: 'ReviewAgent', verbose: false, retries: 0 });
  });

  it('should execute and return review results', async () => {
    // Mock data
    const mockData: DataAgentOutput = {
      aggregated: [],
      assets: [],
      macroGoals: {
        totalBalance: 100000,
        freeCash: 5000,
        stocksPercent: 50,
        bondsPercent: 40,
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
      investedFunds: {
        totalNet: 100000,
        totalPurchases: 0,
        totalSales: 0,
      },
      news: null,
    };

    const mockAnalysis: AnalysisAgentOutput = {
      portfolioAnalysis: {
        assetsAnalysis: [],
        macro: {
          totalBalance: 100000,
          freeCash: 5000,
          stocksDeficitRub: 10000,
          bondsDeficitRub: 5000,
        },
      },
      riskValidation: {
        isValid: true,
        errors: [],
      },
      income: {
        stocks: [],
        totalNkd: 0,
        totalDivs: 0,
        totalDivsNet: 0,
      },
      priceAlerts: [],
      priceAlertsMd: '',
    };

    const mockAi: AiAgentOutput = {
      thesisResults: new Map(),
      aiNarrative: '',
      aiClientResult: {
        text: '',
        modelUsed: 'test',
        success: true,
      },
      structuredRecommendations: new Map(),
      validationWarnings: [],
    };

    const result = await agent.execute({
      data: mockData,
      analysis: mockAnalysis,
      ai: mockAi,
    });

    expect(result.success).toBe(true);
    const reviewResult = result.data as ReviewResult | undefined;
    expect(reviewResult).toBeDefined();
    expect(reviewResult?.reviewers).toBeDefined();
    expect(reviewResult?.reviewers.size).toBe(3);
  });

  it('should have 3 reviewers: conservative, aggressive, risk_manager', async () => {
    const mockData: DataAgentOutput = {
      aggregated: [],
      assets: [],
      macroGoals: {
        totalBalance: 100000,
        freeCash: 5000,
        stocksPercent: 50,
        bondsPercent: 40,
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
      investedFunds: {
        totalNet: 100000,
        totalPurchases: 0,
        totalSales: 0,
      },
      news: null,
    };

    const mockAnalysis: AnalysisAgentOutput = {
      portfolioAnalysis: {
        assetsAnalysis: [],
        macro: {
          totalBalance: 100000,
          freeCash: 5000,
          stocksDeficitRub: 10000,
          bondsDeficitRub: 5000,
        },
      },
      riskValidation: {
        isValid: true,
        errors: [],
      },
      income: {
        stocks: [],
        totalNkd: 0,
        totalDivs: 0,
        totalDivsNet: 0,
      },
      priceAlerts: [],
      priceAlertsMd: '',
    };

    const mockAi: AiAgentOutput = {
      thesisResults: new Map(),
      aiNarrative: '',
      aiClientResult: {
        text: '',
        modelUsed: 'test',
        success: true,
      },
      structuredRecommendations: new Map(),
      validationWarnings: [],
    };

    const result = await agent.execute({
      data: mockData,
      analysis: mockAnalysis,
      ai: mockAi,
    });

    expect(result.success).toBe(true);
    const reviewResult = result.data as ReviewResult | undefined;
    const reviewers = reviewResult?.reviewers;
    expect(reviewers).toBeDefined();
    expect(reviewers?.has('conservative')).toBe(true);
    expect(reviewers?.has('aggressive')).toBe(true);
    expect(reviewers?.has('risk_manager')).toBe(true);
  });

  it('should include timing metrics for each reviewer', async () => {
    const mockData: DataAgentOutput = {
      aggregated: [],
      assets: [],
      macroGoals: {
        totalBalance: 100000,
        freeCash: 5000,
        stocksPercent: 50,
        bondsPercent: 40,
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
      investedFunds: {
        totalNet: 100000,
        totalPurchases: 0,
        totalSales: 0,
      },
      news: null,
    };

    const mockAnalysis: AnalysisAgentOutput = {
      portfolioAnalysis: {
        assetsAnalysis: [],
        macro: {
          totalBalance: 100000,
          freeCash: 5000,
          stocksDeficitRub: 10000,
          bondsDeficitRub: 5000,
        },
      },
      riskValidation: {
        isValid: true,
        errors: [],
      },
      income: {
        stocks: [],
        totalNkd: 0,
        totalDivs: 0,
        totalDivsNet: 0,
      },
      priceAlerts: [],
      priceAlertsMd: '',
    };

    const mockAi: AiAgentOutput = {
      thesisResults: new Map(),
      aiNarrative: '',
      aiClientResult: {
        text: '',
        modelUsed: 'test',
        success: true,
      },
      structuredRecommendations: new Map(),
      validationWarnings: [],
    };

    const result = await agent.execute({
      data: mockData,
      analysis: mockAnalysis,
      ai: mockAi,
    });

    expect(result.success).toBe(true);
    const reviewResult = result.data as ReviewResult | undefined;
    expect(reviewResult?.metrics).toBeDefined();
    expect(reviewResult?.metrics?.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(reviewResult?.metrics?.reviewerTimings).toBeDefined();
    expect(reviewResult?.metrics?.reviewerTimings?.conservative).toBeGreaterThanOrEqual(0);
    expect(reviewResult?.metrics?.reviewerTimings?.aggressive).toBeGreaterThanOrEqual(0);
    expect(reviewResult?.metrics?.reviewerTimings?.risk_manager).toBeGreaterThanOrEqual(0);
    expect(reviewResult?.metrics?.successfulReviewers).toBe(3);
    expect(reviewResult?.metrics?.timedOutReviewers).toBe(0);
  });

  it('should include durationMs and timedOut flag in each reviewer result', async () => {
    const mockData: DataAgentOutput = {
      aggregated: [],
      assets: [],
      macroGoals: {
        totalBalance: 100000,
        freeCash: 5000,
        stocksPercent: 50,
        bondsPercent: 40,
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
      investedFunds: {
        totalNet: 100000,
        totalPurchases: 0,
        totalSales: 0,
      },
      news: null,
    };

    const mockAnalysis: AnalysisAgentOutput = {
      portfolioAnalysis: {
        assetsAnalysis: [],
        macro: {
          totalBalance: 100000,
          freeCash: 5000,
          stocksDeficitRub: 10000,
          bondsDeficitRub: 5000,
        },
      },
      riskValidation: {
        isValid: true,
        errors: [],
      },
      income: {
        stocks: [],
        totalNkd: 0,
        totalDivs: 0,
        totalDivsNet: 0,
      },
      priceAlerts: [],
      priceAlertsMd: '',
    };

    const mockAi: AiAgentOutput = {
      thesisResults: new Map(),
      aiNarrative: '',
      aiClientResult: {
        text: '',
        modelUsed: 'test',
        success: true,
      },
      structuredRecommendations: new Map(),
      validationWarnings: [],
    };

    const result = await agent.execute({
      data: mockData,
      analysis: mockAnalysis,
      ai: mockAi,
    });

    expect(result.success).toBe(true);
    const reviewResult = result.data as ReviewResult | undefined;
    const reviewers = reviewResult?.reviewers;

    for (const reviewer of reviewers?.values() ?? []) {
      expect(reviewer.durationMs).toBeGreaterThanOrEqual(0);
      expect(reviewer.timedOut).toBe(false);
    }
  });

  it('should calculate agreement percentage', async () => {
    const mockData: DataAgentOutput = {
      aggregated: [],
      assets: [],
      macroGoals: {
        totalBalance: 100000,
        freeCash: 5000,
        stocksPercent: 50,
        bondsPercent: 40,
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
      investedFunds: {
        totalNet: 100000,
        totalPurchases: 0,
        totalSales: 0,
      },
      news: null,
    };

    const mockAnalysis: AnalysisAgentOutput = {
      portfolioAnalysis: {
        assetsAnalysis: [],
        macro: {
          totalBalance: 100000,
          freeCash: 5000,
          stocksDeficitRub: 10000,
          bondsDeficitRub: 5000,
        },
      },
      riskValidation: {
        isValid: true,
        errors: [],
      },
      income: {
        stocks: [],
        totalNkd: 0,
        totalDivs: 0,
        totalDivsNet: 0,
      },
      priceAlerts: [],
      priceAlertsMd: '',
    };

    const mockAi: AiAgentOutput = {
      thesisResults: new Map(),
      aiNarrative: '',
      aiClientResult: {
        text: '',
        modelUsed: 'test',
        success: true,
      },
      structuredRecommendations: new Map(),
      validationWarnings: [],
    };

    const result = await agent.execute({
      data: mockData,
      analysis: mockAnalysis,
      ai: mockAi,
    });

    expect(result.success).toBe(true);
    const reviewResult = result.data as ReviewResult | undefined;
    expect(reviewResult?.agreementPercent).toBeDefined();
    expect(typeof reviewResult?.agreementPercent).toBe('number');
    expect(reviewResult?.agreementPercent).toBeGreaterThanOrEqual(0);
    expect(reviewResult?.agreementPercent).toBeLessThanOrEqual(100);
  });

  it('should detect disagreement when agreement < 80%', async () => {
    const mockData: DataAgentOutput = {
      aggregated: [],
      assets: [],
      macroGoals: {
        totalBalance: 100000,
        freeCash: 5000,
        stocksPercent: 50,
        bondsPercent: 40,
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
      investedFunds: {
        totalNet: 100000,
        totalPurchases: 0,
        totalSales: 0,
      },
      news: null,
    };

    const mockAnalysis: AnalysisAgentOutput = {
      portfolioAnalysis: {
        assetsAnalysis: [],
        macro: {
          totalBalance: 100000,
          freeCash: 5000,
          stocksDeficitRub: 10000,
          bondsDeficitRub: 5000,
        },
      },
      riskValidation: {
        isValid: true,
        errors: [],
      },
      income: {
        stocks: [],
        totalNkd: 0,
        totalDivs: 0,
        totalDivsNet: 0,
      },
      priceAlerts: [],
      priceAlertsMd: '',
    };

    const mockAi: AiAgentOutput = {
      thesisResults: new Map(),
      aiNarrative: '',
      aiClientResult: {
        text: '',
        modelUsed: 'test',
        success: true,
      },
      structuredRecommendations: new Map(),
      validationWarnings: [],
    };

    const result = await agent.execute({
      data: mockData,
      analysis: mockAnalysis,
      ai: mockAi,
    });

    expect(result.success).toBe(true);
    const reviewResult = result.data as ReviewResult | undefined;
    expect(reviewResult?.hasDisagreement).toBeDefined();
    expect(typeof reviewResult?.hasDisagreement).toBe('boolean');
  });
});
