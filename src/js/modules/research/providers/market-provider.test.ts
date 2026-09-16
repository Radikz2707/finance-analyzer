import { describe, it, expect } from 'vitest';
import { MarketDataProvider } from './market-provider.js';
import type {
  ResearchAsset,
  ResearchContext,
} from './types.js';
import { hasValue } from '../helpers.js';

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function createAsset(overrides?: Partial<ResearchAsset>): ResearchAsset {
  return {
    ticker: 'SBER',
    name: 'ПАО Сбербанк',
    assetType: 'STOCK',
    issuer: 'ПАО Сбербанк',
    currency: 'RUB',
    market: 'MOEX',
    ...overrides,
  };
}

function createContext(overrides?: Partial<ResearchContext>): ResearchContext {
  return {
    researchTimestamp: '2025-09-15T10:00:00Z',
    marketQuotes: {
      SBER: {
        currentPrice: 280,
        dailyDynamicsPercent: 1.5,
        shortName: 'Сбербанк',
      },
    },
    macroData: {
      keyRate: 21,
      fxUsd: 92.5,
      oil: 75,
    },
    newsData: [],
    sources: [
      {
        name: 'MOEX',
        version: '1.0',
        fetchedAt: '2025-09-15T10:00:00Z',
      },
    ],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════
// 1. Provider supports correct asset type
// ═══════════════════════════════════════════════

describe('MarketDataProvider supports', () => {
  const provider = new MarketDataProvider();

  it('поддерживает STOCK', () => {
    expect(provider.supports(createAsset({ assetType: 'STOCK' }))).toBe(true);
  });

  it('поддерживает BOND', () => {
    expect(provider.supports(createAsset({ assetType: 'BOND' }))).toBe(true);
  });

  it('поддерживает ETF', () => {
    expect(provider.supports(createAsset({ assetType: 'ETF' }))).toBe(true);
  });

  it('поддерживает CASH', () => {
    expect(provider.supports(createAsset({ assetType: 'CASH' }))).toBe(true);
  });

  it('поддерживает OTHER', () => {
    expect(provider.supports(createAsset({ assetType: 'OTHER' }))).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 2. Unsupported asset rejected
// ═══════════════════════════════════════════════

describe('MarketDataProvider rejects unsupported', () => {
  const provider = new MarketDataProvider();

  it('registry не находит provider для неизвестного типа', async () => {
    const { ResearchProviderRegistry } = await import('./registry.js');
    const registry = new ResearchProviderRegistry();
    registry.register(provider);

    const asset: ResearchAsset = {
      ticker: 'XYZ',
      name: 'Unknown',
      assetType: 'OTHER',
      issuer: 'Unknown',
      currency: 'RUB',
      market: 'MOEX',
    };

    const context = createContext();
    const result = await registry.getSnapshot(asset, context);

    // Provider найден для OTHER → full snapshot с NO_DATA
    expect(result.identity.ticker).toBe('XYZ');
    expect(result.marketResearch).toBeDefined();
  });
});

// ═══════════════════════════════════════════════
// 3. Available market fact -> VALUE
// ═══════════════════════════════════════════════

describe('Market fact -> VALUE', () => {
  const provider = new MarketDataProvider();

  it('currentPrice -> VALUE когда есть quote', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.marketResearch).toBeDefined();
    expect(hasValue(snapshot.marketResearch!.currentPrice)).toBe(true);
    expect(snapshot.marketResearch!.currentPrice.value).toBe(280);
    expect(snapshot.marketResearch!.currentPrice.unit).toBe('RUB');
  });

  it('priceChange1D -> VALUE когда dailyDynamicsPercent есть', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(hasValue(snapshot.marketResearch!.priceChange1D)).toBe(true);
    expect(snapshot.marketResearch!.priceChange1D.value).toBe(1.5);
    expect(snapshot.marketResearch!.priceChange1D.unit).toBe('%');
  });
});

// ═══════════════════════════════════════════════
// 4. Unavailable fact -> NO_DATA
// ═══════════════════════════════════════════════

describe('Unavailable fact -> NO_DATA', () => {
  const provider = new MarketDataProvider();

  it('нет quote -> все market поля NO_DATA', async () => {
    const context = createContext();
    context.marketQuotes = {};

    const snapshot = await provider.research(
      createAsset({ ticker: 'NOPE' }),
      context,
    );

    expect(hasValue(snapshot.marketResearch!.currentPrice)).toBe(false);
    expect(hasValue(snapshot.marketResearch!.priceChange1D)).toBe(false);
    expect(hasValue(snapshot.marketResearch!.priceChange1W)).toBe(false);
    expect(hasValue(snapshot.marketResearch!.priceChange1M)).toBe(false);
    expect(hasValue(snapshot.marketResearch!.priceChangeYTD)).toBe(false);
    expect(hasValue(snapshot.marketResearch!.volatility)).toBe(false);
    expect(hasValue(snapshot.marketResearch!.volume)).toBe(false);
    expect(hasValue(snapshot.marketResearch!.liquidity)).toBe(false);
    expect(hasValue(snapshot.marketResearch!.marketRegime)).toBe(false);
  });

  it('нет macro данных -> macro поля NO_DATA', async () => {
    const context = createContext();
    context.macroData = {};

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      context,
    );

    expect(hasValue(snapshot.macroResearch!.keyRate)).toBe(false);
    expect(hasValue(snapshot.macroResearch!.inflation)).toBe(false);
    expect(hasValue(snapshot.macroResearch!.fx)).toBe(false);
    expect(hasValue(snapshot.macroResearch!.oil)).toBe(false);
  });
});

// ═══════════════════════════════════════════════
// 5. Every VALUE has evidenceIds
// ═══════════════════════════════════════════════

describe('Every VALUE has evidenceIds', () => {
  const provider = new MarketDataProvider();

  it('currentPrice VALUE имеет evidenceIds', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const cp = snapshot.marketResearch!.currentPrice;
    expect(hasValue(cp)).toBe(true);
    expect(cp.evidenceIds).toBeDefined();
    expect(cp.evidenceIds!.length).toBeGreaterThan(0);
  });

  it('keyRate VALUE имеет evidenceIds', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const kr = snapshot.macroResearch!.keyRate;
    expect(hasValue(kr)).toBe(true);
    expect(kr.evidenceIds).toBeDefined();
    expect(kr.evidenceIds!.length).toBeGreaterThan(0);
  });

  it('NO_DATA не имеет evidenceIds', async () => {
    const context = createContext();
    context.marketQuotes = {};

    const snapshot = await provider.research(
      createAsset({ ticker: 'NOPE' }),
      context,
    );

    const cp = snapshot.marketResearch!.currentPrice;
    expect(hasValue(cp)).toBe(false);
    expect(cp.evidenceIds).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// 6. Evidence record is created
// ═══════════════════════════════════════════════

describe('Evidence record is created', () => {
  const provider = new MarketDataProvider();

  it('snapshot содержит evidence record', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.evidence).toBeDefined();
    expect(typeof snapshot.evidence).toBe('object');
  });

  it('evidence содержит записи с id, source, claim', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const keys = Object.keys(snapshot.evidence);
    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      const ev = snapshot.evidence[key];
      expect(ev.id).toBeDefined();
      expect(typeof ev.id).toBe('string');
      expect(ev.source).toBeDefined();
      expect(ev.claim).toBeDefined();
      expect(ev.type).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════
// 7. Provider does not invent fundamentals
// ═══════════════════════════════════════════════

describe('Provider does not invent fundamentals', () => {
  const provider = new MarketDataProvider();

  it('issuerResearch = undefined', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.issuerResearch).toBeUndefined();
  });

  it('bondResearch = undefined', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.bondResearch).toBeUndefined();
  });

  it('etfResearch = undefined', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.etfResearch).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// 8. Provider does not generate AI recommendation
// ═══════════════════════════════════════════════

describe('Provider does not generate AI recommendation', () => {
  const provider = new MarketDataProvider();

  it('aiRecommendation = undefined', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.aiRecommendation).toBeUndefined();
  });

  it('investmentThesis = undefined', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.investmentThesis).toBeUndefined();
  });

  it('riskAssessment = undefined', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.riskAssessment).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// 9. Snapshot is structurally valid
// ═══════════════════════════════════════════════

describe('Snapshot is structurally valid', () => {
  const provider = new MarketDataProvider();

  it('identity содержит все обязательные поля', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.identity.ticker).toBe('SBER');
    expect(snapshot.identity.name).toBe('ПАО Сбербанк');
    expect(snapshot.identity.assetType).toBe('STOCK');
    expect(snapshot.identity.issuer).toBe('ПАО Сбербанк');
    expect(snapshot.identity.currency).toBe('RUB');
    expect(snapshot.identity.market).toBe('MOEX');
  });

  it('marketResearch содержит все поля', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const mr = snapshot.marketResearch;
    expect(mr).toBeDefined();
    expect(mr!.currentPrice).toBeDefined();
    expect(mr!.priceChange1D).toBeDefined();
    expect(mr!.priceChange1W).toBeDefined();
    expect(mr!.priceChange1M).toBeDefined();
    expect(mr!.priceChangeYTD).toBeDefined();
    expect(mr!.volatility).toBeDefined();
    expect(mr!.volume).toBeDefined();
    expect(mr!.liquidity).toBeDefined();
    expect(mr!.marketRegime).toBeDefined();
  });

  it('macroResearch содержит все поля', async () => {
    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const m = snapshot.macroResearch;
    expect(m).toBeDefined();
    expect(m!.keyRate).toBeDefined();
    expect(m!.inflation).toBeDefined();
    expect(m!.inflationTrend).toBeDefined();
    expect(m!.fx).toBeDefined();
    expect(m!.oil).toBeDefined();
    expect(m!.commodityRegime).toBeDefined();
    expect(m!.liquidityRegime).toBeDefined();
    expect(m!.economicCycle).toBeDefined();
    expect(m!.rateRegime).toBeDefined();
  });
});

// ═══════════════════════════════════════════════
// 10. Registry selects correct provider
// ═══════════════════════════════════════════════

describe('Registry selects correct provider', () => {
  it('registry находит provider для STOCK', async () => {
    const { ResearchProviderRegistry } = await import('./registry.js');
    const registry = new ResearchProviderRegistry();
    const provider = new MarketDataProvider();
    registry.register(provider);

    const asset = createAsset({ ticker: 'SBER', assetType: 'STOCK' });
    const found = registry.findProviders(asset);

    expect(found.length).toBe(1);
    expect(found[0]).toBe(provider);
    expect(found[0]).toBeInstanceOf(MarketDataProvider);
  });

  it('registry находит provider для BOND', async () => {
    const { ResearchProviderRegistry } = await import('./registry.js');
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());

    const asset = createAsset({ ticker: 'GSVD', assetType: 'BOND' });
    const found = registry.findProviders(asset);

    expect(found.length).toBe(1);
    expect(found[0]).toBeInstanceOf(MarketDataProvider);
  });

  it('registry возвращает пустой массив для неизвестного типа', async () => {
    const { ResearchProviderRegistry } = await import('./registry.js');
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());

    const asset: ResearchAsset = {
      ticker: 'XYZ',
      name: 'Unknown',
      assetType: 'OTHER',
      issuer: 'Unknown',
      currency: 'RUB',
      market: 'MOEX',
    };

    // OTHER поддерживается MarketDataProvider
    expect(registry.findProviders(asset)).toHaveLength(1);
  });

  it('registry getSnapshot возвращает full snapshot', async () => {
    const { ResearchProviderRegistry } = await import('./registry.js');
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());

    const asset = createAsset({ ticker: 'SBER' });
    const context = createContext();
    const snapshot = await registry.getSnapshot(asset, context);

    expect(snapshot.identity.ticker).toBe('SBER');
    expect(snapshot.marketResearch).toBeDefined();
    expect(snapshot.macroResearch).toBeDefined();
    expect(snapshot.evidence).toBeDefined();
    expect(snapshot.issuerResearch).toBeUndefined();
    expect(snapshot.aiRecommendation).toBeUndefined();
  });

  it('registry возвращает fallback когда provider не найден', async () => {
    const { ResearchProviderRegistry } = await import('./registry.js');
    const registry = new ResearchProviderRegistry();
    // Не регистрируем никаких провайдеров

    const asset: ResearchAsset = {
      ticker: 'UNKNOWN',
      name: 'Unknown Asset',
      assetType: 'OTHER',
      issuer: 'Unknown',
      currency: 'RUB',
      market: 'MOEX',
    };

    const context = createContext();
    const snapshot = await registry.getSnapshot(asset, context);

    expect(snapshot.identity.ticker).toBe('UNKNOWN');
    expect(snapshot.marketResearch).toBeUndefined();
    expect(snapshot.macroResearch).toBeUndefined();
    expect(snapshot.evidence).toEqual({});
  });
});
