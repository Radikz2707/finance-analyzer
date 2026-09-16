import { describe, it, expect } from 'vitest';
import type { AssetAnalysis } from '../portfolio-math/portfolio-math.js';
import type {
  ResearchContext,
  ResearchAsset,
} from '../research/providers/types.js';
import {
  buildAssetResearchSnapshot,
  buildPortfolioAssetContext,
} from './snapshot-builder.js';
import { ResearchProviderRegistry } from '../research/providers/registry.js';

function createAsset(o?: Partial<AssetAnalysis>): AssetAnalysis {
  return {
    name: 'SBER',
    ticker: 'SBER',
    assetType: 'STOCK' as const,
    currentPercent: 30,
    targetPercent: 35,
    deficitRub: 50000,
    status: 'BUY',
    dynamicsPercent: 5.2,
    nkdRub: 0,
    nominal: 0,
    quantity: 100,
    balancePrice: 250,
    currentPrice: 280,
    unrealizedProfitRub: 3000,
    priority: 1,
    isConcentrated: false,
    ...o,
  };
}

function createContext(): ResearchContext {
  return {
    researchTimestamp: '2025-09-15T10:00:00Z',
    marketQuotes: {
      SBER: { currentPrice: 280, dailyDynamicsPercent: 1.5, shortName: 'Sber' },
    },
    macroData: { keyRate: 21, fxUsd: 92.5, oil: 75 },
    newsData: [
      {
        title: 'Sber profit',
        summary: 'Q3',
        source: 'Finam',
        date: '2025-09-14',
        url: 'https://finam.ru/t',
        relevance: 'high',
      },
    ],
    sources: [
      { name: 'MOEX', version: '1.0', fetchedAt: '2025-09-15T10:00:00Z' },
    ],
  };
}

// Моковые провайдеры — БЕЗ сети
function createMockMarketProvider(): import('../research/providers/types.js').ResearchProvider {
  return {
    supports: (a: ResearchAsset) =>
      ['STOCK', 'BOND', 'ETF', 'CASH'].includes(a.assetType),
    research: async (a: ResearchAsset) => ({
      identity: {
        ticker: a.ticker,
        name: a.name,
        assetType: a.assetType,
        issuer: a.issuer,
        currency: a.currency,
        market: a.market,
      },
      marketResearch: {
        currentPrice: {
          status: 'VALUE' as const,
          value: 280,
          evidenceIds: ['mock-market'],
        },
        priceChange1D: { status: 'NO_DATA' as const },
        priceChange1W: { status: 'NO_DATA' as const },
        priceChange1M: { status: 'NO_DATA' as const },
        priceChangeYTD: { status: 'NO_DATA' as const },
        volatility: { status: 'NO_DATA' as const },
        volume: { status: 'NO_DATA' as const },
        liquidity: { status: 'NO_DATA' as const },
        marketRegime: { status: 'NO_DATA' as const },
      },
      macroResearch: {
        keyRate: {
          status: 'VALUE' as const,
          value: 21,
          evidenceIds: ['mock-macro'],
        },
        inflation: { status: 'NO_DATA' as const },
        inflationTrend: { status: 'NO_DATA' as const },
        fx: { status: 'NO_DATA' as const },
        oil: { status: 'NO_DATA' as const },
        commodityRegime: { status: 'NO_DATA' as const },
        liquidityRegime: { status: 'NO_DATA' as const },
        economicCycle: { status: 'NO_DATA' as const },
        rateRegime: { status: 'NO_DATA' as const },
      },
      evidence: {
        'mock-market': {
          id: 'mock-market',
          type: 'MARKET',
          source: 'Mock',
          url: '',
          publishedAt: '2025-09-15T10:00:00Z',
          retrievedAt: '2025-09-15T10:00:00Z',
          claim: 'Mock market data',
          confidence: 0.9,
        },
      },
    }),
  };
}

function createMockIssuerProvider(): import('../research/providers/types.js').ResearchProvider {
  return {
    supports: (a: ResearchAsset) => ['STOCK', 'BOND'].includes(a.assetType),
    research: async (a: ResearchAsset) => ({
      identity: {
        ticker: a.ticker,
        name: a.name,
        assetType: a.assetType,
        issuer: a.issuer,
        currency: a.currency,
        market: a.market,
      },
      issuerResearch:
        a.assetType === 'STOCK'
          ? {
              businessDescription: {
                status: 'VALUE' as const,
                value: 'Mock issuer',
                evidenceIds: ['mock-issuer'],
              },
              sector: {
                status: 'VALUE' as const,
                value: 'Finance',
                evidenceIds: ['mock-issuer'],
              },
              industry: {
                status: 'VALUE' as const,
                value: 'Banking',
                evidenceIds: ['mock-issuer'],
              },
              financials: {
                revenue: {
                  status: 'VALUE' as const,
                  value: 1000000,
                  evidenceIds: ['mock-issuer'],
                },
                ebitda: {
                  status: 'VALUE' as const,
                  value: 300000,
                  evidenceIds: ['mock-issuer'],
                },
                netIncome: {
                  status: 'VALUE' as const,
                  value: 200000,
                  evidenceIds: ['mock-issuer'],
                },
                freeCashFlow: { status: 'NO_DATA' as const },
                debt: { status: 'NO_DATA' as const },
                netDebt: { status: 'NO_DATA' as const },
                roe: { status: 'NO_DATA' as const },
                roic: { status: 'NO_DATA' as const },
                margin: { status: 'NO_DATA' as const },
              },
              valuation: {
                pe: {
                  status: 'VALUE' as const,
                  value: 8,
                  evidenceIds: ['mock-issuer'],
                },
                evEbitda: {
                  status: 'VALUE' as const,
                  value: 6,
                  evidenceIds: ['mock-issuer'],
                },
                pb: { status: 'NO_DATA' as const },
                fcfYield: { status: 'NO_DATA' as const },
              },
              earningsTrend: {
                revenueGrowth: {
                  status: 'VALUE' as const,
                  value: 10,
                  evidenceIds: ['mock-issuer'],
                },
                netIncomeGrowth: {
                  status: 'VALUE' as const,
                  value: 8,
                  evidenceIds: ['mock-issuer'],
                },
                guidance: {
                  status: 'VALUE' as const,
                  value: 'Positive',
                  evidenceIds: ['mock-issuer'],
                },
              },
              guidance: {
                status: 'VALUE' as const,
                value: 'Growth 10%',
                evidenceIds: ['mock-issuer'],
              },
              dividend: {
                lastDividend: {
                  status: 'VALUE' as const,
                  value: 35,
                  evidenceIds: ['mock-issuer'],
                },
                dividendYield: {
                  status: 'VALUE' as const,
                  value: 9.5,
                  evidenceIds: ['mock-issuer'],
                },
                payoutRatio: { status: 'NO_DATA' as const },
              },
            }
          : undefined,
      evidence: {
        'mock-issuer': {
          id: 'mock-issuer',
          type: 'FINANCIAL',
          source: 'Mock',
          url: '',
          publishedAt: '2025-09-15T10:00:00Z',
          retrievedAt: '2025-09-15T10:00:00Z',
          claim: 'Mock issuer data',
          confidence: 0.9,
        },
      },
    }),
  };
}

function createMockNewsProvider(): import('../research/providers/types.js').ResearchProvider {
  return {
    supports: (a: ResearchAsset) => ['STOCK'].includes(a.assetType),
    research: async (a: ResearchAsset) => ({
      identity: {
        ticker: a.ticker,
        name: a.name,
        assetType: a.assetType,
        issuer: a.issuer,
        currency: a.currency,
        market: a.market,
      },
      newsResearch: {
        items: [
          {
            title: 'Sber profit',
            date: '2025-09-14',
            source: 'Mock',
            url: 'https://mock.ru',
            importance: 'HIGH',
            sentiment: 'POSITIVE',
            summary: 'Q3 results',
            relevanceToIssuer: 0.95,
          },
        ],
      },
      evidence: {
        'mock-news': {
          id: 'mock-news',
          type: 'NEWS',
          source: 'Mock',
          url: '',
          publishedAt: '2025-09-15T10:00:00Z',
          retrievedAt: '2025-09-15T10:00:00Z',
          claim: 'Mock news',
          confidence: 0.9,
        },
      },
    }),
  };
}

function createMockRegistry(): ResearchProviderRegistry {
  const registry = new ResearchProviderRegistry();
  registry.register(createMockMarketProvider());
  registry.register(createMockIssuerProvider());
  registry.register(createMockNewsProvider());
  return registry;
}

const mockRegistry = createMockRegistry();

// Test 1
describe('Test 1: snapshot-builder вызывает Registry', () => {
  it('buildAssetResearchSnapshot с context вызывает registry.researchAll', async () => {
    const asset = createAsset();
    const context = createContext();
    const result = await buildAssetResearchSnapshot(
      asset,
      context,
      mockRegistry,
    );
    expect(result.snapshot.identity.ticker).toBe('SBER');
    expect(result.snapshot.identity.name).toBe('SBER');
  });
});

// Test 2
describe('Test 2: STOCK получает MarketResearch', () => {
  it('MarketResearch определён для STOCK', async () => {
    const asset = createAsset({assetType: 'STOCK' as const });
    const context = createContext();
    const result = await buildAssetResearchSnapshot(
      asset,
      context,
      mockRegistry,
    );
    expect(result.snapshot.marketResearch).toBeDefined();
    expect(result.snapshot.marketResearch!.currentPrice.status).toBe('VALUE');
  });
});

// Test 3
describe('Test 3: STOCK получает IssuerResearch', () => {
  it('IssuerResearch определён для STOCK', async () => {
    const asset = createAsset({assetType: 'STOCK' as const });
    const context = createContext();
    const result = await buildAssetResearchSnapshot(
      asset,
      context,
      mockRegistry,
    );
    expect(result.snapshot.issuerResearch).toBeDefined();
  });
});

// Test 4
describe('Test 4: STOCK получает NewsResearch при наличии news', () => {
  it('NewsResearch определён когда newsData не пуст', async () => {
    const asset = createAsset({assetType: 'STOCK' as const });
    const context = createContext();
    const result = await buildAssetResearchSnapshot(
      asset,
      context,
      mockRegistry,
    );
    expect(result.snapshot.newsResearch).toBeDefined();
  });
});

// Test 5
describe('Test 5: STOCK получает MacroResearch', () => {
  it('MacroResearch определён для STOCK', async () => {
    const asset = createAsset({assetType: 'STOCK' as const });
    const context = createContext();
    const result = await buildAssetResearchSnapshot(
      asset,
      context,
      mockRegistry,
    );
    expect(result.snapshot.macroResearch).toBeDefined();
    expect(result.snapshot.macroResearch!.keyRate.status).toBe('VALUE');
  });
});

// Test 6
describe('Test 6: несколько providers агрегируются в один snapshot', () => {
  it('marketResearch + macroResearch + newsResearch в одном snapshot', async () => {
    const asset = createAsset({assetType: 'STOCK' as const });
    const context = createContext();
    const result = await buildAssetResearchSnapshot(
      asset,
      context,
      mockRegistry,
    );
    expect(result.snapshot.marketResearch).toBeDefined();
    expect(result.snapshot.macroResearch).toBeDefined();
    expect(result.snapshot.newsResearch).toBeDefined();
  });
});

// Test 7
describe('Test 7: evidence сохраняется', () => {
  it('snapshot содержит evidence от providers', async () => {
    const asset = createAsset({assetType: 'STOCK' as const });
    const context = createContext();
    const result = await buildAssetResearchSnapshot(
      asset,
      context,
      mockRegistry,
    );
    expect(result.snapshot.evidence).toBeDefined();
    expect(typeof result.snapshot.evidence).toBe('object');
  });
});

// Test 8
describe('Test 8: evidenceIds сохраняются', () => {
  it('VALUE имеет evidenceIds', async () => {
    const asset = createAsset({assetType: 'STOCK' as const });
    const context = createContext();
    const result = await buildAssetResearchSnapshot(
      asset,
      context,
      mockRegistry,
    );
    const cp = result.snapshot.marketResearch!.currentPrice;
    expect(cp.status).toBe('VALUE');
    expect(cp.evidenceIds).toBeDefined();
    expect(Array.isArray(cp.evidenceIds)).toBe(true);
  });
});

// Test 9
describe('Test 9: provider conflict не теряется', () => {
  it('conflicts возвращается из buildAssetResearchSnapshot', async () => {
    const asset = createAsset({assetType: 'STOCK' as const });
    const context = createContext();
    const result = await buildAssetResearchSnapshot(
      asset,
      context,
      mockRegistry,
    );
    expect(result.conflicts).toBeDefined();
    expect(Array.isArray(result.conflicts)).toBe(true);
  });
});

// Test 10 — без изменений (не использует registry)
describe('Test 10: отсутствие provider → fallback snapshot', () => {
  it('без context → fallback snapshot с NO_DATA', async () => {
    const asset = createAsset({assetType: 'STOCK' as const });
    const result = await buildAssetResearchSnapshot(asset, undefined);
    expect(result.snapshot.identity.ticker).toBe('SBER');
    expect(result.snapshot.marketResearch).toBeUndefined();
    expect(result.snapshot.macroResearch).toBeUndefined();
    expect(result.snapshot.evidence).toEqual({});
    expect(result.conflicts).toEqual([]);
  });
});

// Test 11
describe('Test 11: snapshot-builder не создаёт AIRecommendation', () => {
  it('snapshot не содержит aiRecommendation', async () => {
    const asset = createAsset({assetType: 'STOCK' as const });
    const context = createContext();
    const result = await buildAssetResearchSnapshot(
      asset,
      context,
      mockRegistry,
    );
    expect(result.snapshot.aiRecommendation).toBeUndefined();
  });
});

// Test 12
describe('Test 12: snapshot-builder не создаёт InvestmentThesis', () => {
  it('snapshot не содержит investmentThesis', async () => {
    const asset = createAsset({assetType: 'STOCK' as const });
    const context = createContext();
    const result = await buildAssetResearchSnapshot(
      asset,
      context,
      mockRegistry,
    );
    expect(result.snapshot.investmentThesis).toBeUndefined();
  });
});

// Test 13
describe('Test 13: NO_DATA не превращается в VALUE', () => {
  it('отсутствующие данные остаются NO_DATA', async () => {
    const asset = createAsset({assetType: 'STOCK' as const });
    const context = createContext();
    const result = await buildAssetResearchSnapshot(
      asset,
      context,
      mockRegistry,
    );
    const pc1w = result.snapshot.marketResearch!.priceChange1W;
    expect(pc1w.status).toBe('NO_DATA');
    expect(pc1w.value).toBeUndefined();
  });
});

// Test 14 — без изменений (не использует registry)
describe('Test 14: существующий PortfolioMath не меняется', () => {
  it('buildPortfolioAssetContext возвращает корректный контекст', () => {
    const asset = createAsset({
      currentPercent: 30,
      targetPercent: 35,
      status: 'BUY',
      currentPrice: 280,
      balancePrice: 250,
      quantity: 100,
      unrealizedProfitRub: 3000,
    });
    const ctx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 1000000,
    });
    expect(ctx.currentPercent).toBe(30);
    expect(ctx.targetPercent).toBe(35);
    expect(ctx.currentPriceRub).toBe(280);
    expect(ctx.balancePrice).toBe(250);
    expect(ctx.quantity).toBe(100);
    expect(ctx.unrealizedProfitRub).toBe(3000);
    expect(ctx.totalPortfolioValue).toBe(1000000);
  });
});
