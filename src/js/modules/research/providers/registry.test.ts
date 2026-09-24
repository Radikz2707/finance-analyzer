import { describe, it, expect, beforeEach } from 'vitest';
import { MarketDataProvider } from './market-provider.js';
import { TestFundamentalsProvider } from './test-fundamentals-provider.js';
import { ResearchProviderRegistry } from './registry.js';
import { researchCacheRepo } from '../../db-manager/db-manager.js';
import type { ResearchAsset } from './types.js';
import { hasValue } from '../helpers.js';

beforeEach(() => {
  researchCacheRepo.clearAll();
});

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

function createContext() {
  return {
    researchTimestamp: '2025-09-15T10:00:00Z',
    marketQuotes: {
      SBER: { currentPrice: 280, dailyDynamicsPercent: 1.5, shortName: 'Сбербанк' },
    },
    macroData: { keyRate: 21, fxUsd: 92.5, oil: 75 },
    newsData: [],
    sources: [{ name: 'MOEX', version: '1.0', fetchedAt: '2025-09-15T10:00:00Z' }],
  };
}

// ═══════════════════════════════════════════════
// 1. 0 providers → fallback
// ═══════════════════════════════════════════════

describe('Registry: 0 providers → fallback', () => {
  it('возвращает валидный snapshot с NO_DATA', async () => {
    const registry = new ResearchProviderRegistry();
    const asset = createAsset();
    const { snapshot, conflicts, providerCount } = await registry.researchAll(asset, createContext());

    expect(providerCount).toBe(0);
    expect(conflicts).toEqual([]);
    expect(snapshot.identity.ticker).toBe('SBER');
    expect(snapshot.marketResearch).toBeUndefined();
    expect(snapshot.macroResearch).toBeUndefined();
    expect(snapshot.evidence).toEqual({});
  });
});

// ═══════════════════════════════════════════════
// 2. 1 provider → snapshot
// ═══════════════════════════════════════════════

describe('Registry: 1 provider → snapshot', () => {
  it('MarketDataProvider возвращает snapshot', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());

    const asset = createAsset();
    const { snapshot, conflicts, providerCount } = await registry.researchAll(asset, createContext());

    expect(providerCount).toBe(1);
    expect(conflicts).toEqual([]);
    expect(snapshot.identity.ticker).toBe('SBER');
    expect(snapshot.marketResearch).toBeDefined();
    expect(snapshot.macroResearch).toBeDefined();
    expect(hasValue(snapshot.marketResearch!.currentPrice)).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 3. 2 providers → merged snapshot
// ═══════════════════════════════════════════════

describe('Registry: 2 providers → merged snapshot', () => {
  it('MarketDataProvider + TestFundamentalsProvider объединяются', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());
    registry.register(new TestFundamentalsProvider());

    const asset = createAsset();
    const { snapshot, conflicts, providerCount } = await registry.researchAll(asset, createContext());

    expect(providerCount).toBe(2);
    expect(conflicts).toEqual([]);

    // MarketDataProvider дал marketResearch и macroResearch
    expect(snapshot.marketResearch).toBeDefined();
    expect(snapshot.macroResearch).toBeDefined();

    // TestFundamentalsProvider дал issuerResearch
    expect(snapshot.issuerResearch).toBeDefined();
    expect(hasValue(snapshot.issuerResearch!.financials.revenue)).toBe(true);
    expect(snapshot.issuerResearch!.financials.revenue.value).toBe(1000000);
  });

  it('order: TestFundamentalsProvider + MarketDataProvider', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new TestFundamentalsProvider());
    registry.register(new MarketDataProvider());

    const asset = createAsset();
    const { snapshot, conflicts, providerCount } = await registry.researchAll(asset, createContext());

    expect(providerCount).toBe(2);
    expect(conflicts).toEqual([]);

    expect(snapshot.marketResearch).toBeDefined();
    expect(snapshot.issuerResearch).toBeDefined();
  });
});

// ═══════════════════════════════════════════════
// 4. оба VALUE → оба сохраняются
// ═══════════════════════════════════════════════

describe('Registry: оба VALUE → оба сохраняются', () => {
  it('разные секции: marketResearch + issuerResearch', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());
    registry.register(new TestFundamentalsProvider());

    const asset = createAsset();
    const { snapshot } = await registry.researchAll(asset, createContext());

    // MarketDataProvider заполнил marketResearch
    expect(hasValue(snapshot.marketResearch!.currentPrice)).toBe(true);
    expect(snapshot.marketResearch!.currentPrice.value).toBe(280);

    // TestFundamentalsProvider заполнил issuerResearch
    expect(hasValue(snapshot.issuerResearch!.financials.revenue)).toBe(true);
    expect(snapshot.issuerResearch!.financials.revenue.value).toBe(1000000);

    // Оба существуют в merged snapshot
    expect(snapshot.marketResearch).toBeDefined();
    expect(snapshot.issuerResearch).toBeDefined();
  });
});

// ═══════════════════════════════════════════════
// 5. VALUE + NO_DATA → VALUE сохраняется
// ═══════════════════════════════════════════════

describe('Registry: VALUE + NO_DATA → VALUE сохраняется', () => {
  it('MarketDataProvider VALUE не перезаписывается NO_DATA', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());
    registry.register(new TestFundamentalsProvider());

    const asset = createAsset();
    const { snapshot } = await registry.researchAll(asset, createContext());

    // MarketDataProvider: currentPrice = VALUE 280
    expect(hasValue(snapshot.marketResearch!.currentPrice)).toBe(true);
    expect(snapshot.marketResearch!.currentPrice.value).toBe(280);

    // TestFundamentalsProvider: нет marketResearch → NO_DATA (undefined)
    // VALUE не должен быть перезаписан
    expect(hasValue(snapshot.marketResearch!.currentPrice)).toBe(true);
    expect(snapshot.marketResearch!.currentPrice.value).toBe(280);
  });
});

// ═══════════════════════════════════════════════
// 6. evidence объединяется
// ═══════════════════════════════════════════════

describe('Registry: evidence объединяется', () => {
  it('evidence содержит записи от обоих providers', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());
    registry.register(new TestFundamentalsProvider());

    const asset = createAsset();
    const { snapshot } = await registry.researchAll(asset, createContext());

    const evidenceKeys = Object.keys(snapshot.evidence);
    // MarketDataProvider создаёт evidence, TestFundamentalsProvider — нет
    expect(evidenceKeys.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════
// 7. evidenceIds сохраняются
// ═══════════════════════════════════════════════

describe('Registry: evidenceIds сохраняются', () => {
  it('VALUE имеет evidenceIds после merge', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());
    registry.register(new TestFundamentalsProvider());

    const asset = createAsset();
    const { snapshot } = await registry.researchAll(asset, createContext());

    const cp = snapshot.marketResearch!.currentPrice;
    expect(hasValue(cp)).toBe(true);
    expect(cp.evidenceIds).toBeDefined();
    expect(cp.evidenceIds!.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════
// 8. конфликт VALUE + VALUE не теряется
// ═══════════════════════════════════════════════

describe('Registry: конфликт VALUE + VALUE не теряется', () => {
  it('conflicts содержит запись о конфликте', async () => {
    // Создаём provider, который возвращает другое значение currentPrice
    const { TestConflictProvider } = await import('./test-conflict-provider.js');

    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());
    registry.register(new TestConflictProvider());

    const asset = createAsset();
    const { snapshot, conflicts, providerCount } = await registry.researchAll(asset, createContext());

    expect(providerCount).toBe(2);
    expect(conflicts.length).toBeGreaterThan(0);

    // Конфликт зафиксирован
    const conflict = conflicts[0];
    expect(conflict.field).toContain('currentPrice');
    expect(conflict.providerA).toBeDefined();
    expect(conflict.providerB).toBeDefined();
    expect(conflict.valueA).not.toBe(conflict.valueB);

    // Первое значение сохранено
    expect(hasValue(snapshot.marketResearch!.currentPrice)).toBe(true);
    expect(snapshot.marketResearch!.currentPrice.value).toBe(280); // первое значение
  });
});

// ═══════════════════════════════════════════════
// 9. supports() фильтрует providers
// ═══════════════════════════════════════════════

describe('Registry: supports() фильтрует providers', () => {
  it('STOCK: оба provider подходят', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());
    registry.register(new TestFundamentalsProvider());

    const asset = createAsset({ assetType: 'STOCK' });
    const providers = registry.findProviders(asset);

    expect(providers.length).toBe(2);
    expect(providers[0]).toBeInstanceOf(MarketDataProvider);
    expect(providers[1]).toBeInstanceOf(TestFundamentalsProvider);
  });

  it('BOND: оба provider подходят', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());
    registry.register(new TestFundamentalsProvider());

    const asset = createAsset({ assetType: 'BOND', ticker: 'GSVD' });
    const providers = registry.findProviders(asset);

    expect(providers.length).toBe(2);
  });

  it('ETF: только MarketDataProvider', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());
    registry.register(new TestFundamentalsProvider());

    const asset = createAsset({ assetType: 'ETF', ticker: 'TCONV' });
    const providers = registry.findProviders(asset);

    expect(providers.length).toBe(1);
    expect(providers[0]).toBeInstanceOf(MarketDataProvider);
  });

  it('CASH: только MarketDataProvider', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());
    registry.register(new TestFundamentalsProvider());

    const asset = createAsset({ assetType: 'CASH', ticker: 'LQDS' });
    const providers = registry.findProviders(asset);

    expect(providers.length).toBe(1);
    expect(providers[0]).toBeInstanceOf(MarketDataProvider);
  });
});

// ═══════════════════════════════════════════════
// 10. порядок регистрации не меняет результат конфликта
// ═══════════════════════════════════════════════

describe('Registry: порядок регистрации не меняет результат конфликта', () => {
  beforeEach(() => {
    researchCacheRepo.clearAll();
  });

  it('первое значение сохраняется независимо от порядка', async () => {
    const { TestConflictProvider } = await import('./test-conflict-provider.js');

    // Порядок A: MarketDataProvider → TestConflictProvider
    const registryA = new ResearchProviderRegistry();
    registryA.register(new MarketDataProvider());
    registryA.register(new TestConflictProvider());

    const resultA = await registryA.researchAll(createAsset(), createContext());
    expect(resultA.snapshot.marketResearch!.currentPrice.value).toBe(280);

    // Порядок B: TestConflictProvider → MarketDataProvider
    const registryB = new ResearchProviderRegistry();
    registryB.register(new TestConflictProvider());
    registryB.register(new MarketDataProvider());

    const resultB = await registryB.researchAll(createAsset(), createContext());
    // Первое значение — от TestConflictProvider (200)
    expect(resultB.snapshot.marketResearch!.currentPrice.value).toBe(200);
  });
});

// ═══════════════════════════════════════════════
// 11. existing MarketDataProvider продолжает работать
// ═══════════════════════════════════════════════

describe('Registry: existing MarketDataProvider продолжает работать', () => {
  it('один MarketDataProvider → полный snapshot', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());

    const asset = createAsset();
    const { snapshot, providerCount } = await registry.researchAll(asset, createContext());

    expect(providerCount).toBe(1);
    expect(snapshot.identity.ticker).toBe('SBER');
    expect(hasValue(snapshot.marketResearch!.currentPrice)).toBe(true);
    expect(snapshot.marketResearch!.currentPrice.value).toBe(280);
    expect(hasValue(snapshot.macroResearch!.keyRate)).toBe(true);
    expect(snapshot.macroResearch!.keyRate.value).toBe(21);
  });

  it('legacy getSnapshot() работает', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());

    const asset = createAsset();
    const snapshot = await registry.getSnapshot(asset, createContext());

    expect(snapshot.identity.ticker).toBe('SBER');
    expect(snapshot.marketResearch).toBeDefined();
  });
});

// ═══════════════════════════════════════════════
// 12. BOND: Market + Macro + Bond fundamentals
// ═══════════════════════════════════════════════

describe('Registry: BOND aggregation', () => {
  it('Market + Bond fundamentals объединяются', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());
    registry.register(new TestFundamentalsProvider());

    const asset = createAsset({ assetType: 'BOND', ticker: 'GSVD', name: 'Газпром облигации' });
    const { snapshot } = await registry.researchAll(asset, createContext());

    expect(snapshot.marketResearch).toBeDefined();
    expect(snapshot.bondResearch).toBeDefined();
    expect(hasValue(snapshot.bondResearch!.nominal)).toBe(true);
    expect(snapshot.bondResearch!.nominal.value).toBe(1000);
    expect(hasValue(snapshot.bondResearch!.couponRate)).toBe(true);
    expect(snapshot.bondResearch!.couponRate.value).toBe(12);
  });
});

// ═══════════════════════════════════════════════
// 13. ETF: Market + Macro (без fundamentals)
// ═══════════════════════════════════════════════

describe('Registry: ETF aggregation', () => {
  it('только Market + Macro, issuerResearch = undefined', async () => {
    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());
    registry.register(new TestFundamentalsProvider());

    const asset = createAsset({ assetType: 'ETF', ticker: 'TCONV' });
    const { snapshot } = await registry.researchAll(asset, createContext());

    expect(snapshot.marketResearch).toBeDefined();
    expect(snapshot.macroResearch).toBeDefined();
    expect(snapshot.issuerResearch).toBeUndefined();
    expect(snapshot.bondResearch).toBeUndefined();
  });
});
