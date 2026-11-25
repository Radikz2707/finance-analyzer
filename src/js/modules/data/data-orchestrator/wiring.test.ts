import { describe, it, expect, vi } from 'vitest';
import { createSourceRegistry, createOkDataMapper } from './wiring.js';

vi.mock('../../api/moex-quotes/moex-quotes.js', () => ({
  MoexQuotesClient: vi.fn().mockImplementation(() => ({
    fetchCurrentQuotes: vi.fn().mockResolvedValue({ asOf: '2026-11-25', quotes: {}, unavailable: [] }),
  })),
}));

vi.mock('../../api/fundamentals/moex-iss-client.js', () => ({
  fetchMoexSecurityInfo: vi.fn(),
  fetchMoexDividends: vi.fn(),
  fetchMoexReports: vi.fn(),
  fetchMoexCoupons: vi.fn(),
  toNumber: vi.fn((v) => {
    if (v === null || v === undefined || v === '') return null;
    const num = Number(String(v).replace(',', '.'));
    return Number.isFinite(num) ? num : null;
  }),
}));

vi.mock('../../api/smart-lab-api/smart-lab-api.js', () => ({
  fetchSmartLabBonds: vi.fn(),
  findBondByTicker: vi.fn(),
}));

vi.mock('../../api/fundamentals/smart-lab-client.js', () => ({
  fetchSmartLabFinancials: vi.fn(),
  fetchSmartLabDividends: vi.fn(),
}));

vi.mock('../../ai/ai-advisor/cbr-rate.js', () => ({
  getCbrKeyRate: vi.fn(),
}));

describe('createSourceRegistry', () => {
  it('should register 9 sources (moex-bond-api removed)', async () => {
    const assets = [
      { ticker: 'SBER', assetType: 'STOCK' },
      { ticker: 'GAZP', assetType: 'STOCK' },
    ];
    const registry = createSourceRegistry(assets);
    const activeIds = registry.getActiveSourceIds();
    expect(activeIds.length).toBe(9);
    expect(activeIds).toContain('moex-quotes');
    expect(activeIds).toContain('cbr-rate');
    expect(activeIds).toContain('moex-iss-security');
    expect(activeIds).toContain('moex-iss-dividends');
    expect(activeIds).toContain('moex-iss-reports');
    expect(activeIds).toContain('moex-iss-coupons');
    expect(activeIds).toContain('smartlab-bonds');
    expect(activeIds).toContain('smart-lab-financials');
    expect(activeIds).toContain('smart-lab-dividends');
  });

  it('should filter bondTickers for moex-iss-coupons and smartlab-bonds', async () => {
    const assets = [
      { ticker: 'RU000A10GC20', assetType: 'BOND' },
    ];
    const registry = createSourceRegistry(assets);
    const activeIds = registry.getActiveSourceIds();
    expect(activeIds.length).toBe(9);
    expect(registry.has('moex-iss-coupons')).toBe(true);
    expect(registry.has('smartlab-bonds')).toBe(true);
  });

  it('should handle empty assets array', async () => {
    const registry = createSourceRegistry([]);
    const activeIds = registry.getActiveSourceIds();
    expect(activeIds.length).toBe(9);
  });
});


describe('createOkDataMapper', () => {
  it('should map okData to AssetResearchSnapshot', () => {
    const mapper = createOkDataMapper();
    const assets = [
      { ticker: 'SBER', assetType: 'STOCK' },
    ];
    const okData = new Map();
    okData.set('moex-quotes', { asOf: '2026-11-25', quotes: { SBER: { last: 250, changePct: 2.5, turnover: 1000000, volume: 500000 } }, unavailable: [] });
    okData.set('moex-iss-security', { SBER: { shortName: 'Сбербанк', isin: 'RU00081015PM' } });
    okData.set('cbr-rate', { rate: 21, date: '2026-11-25', source: 'test' });

    const snapshots = mapper(okData, assets);
    const snapshot = snapshots.get('SBER');

    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect(snapshot.identity.ticker).toBe('SBER');
    expect(snapshot.identity.name).toBe('Сбербанк');
    expect(snapshot.identity.isin).toBe('RU00081015PM');
    expect(snapshot.identity.type).toBe('STOCK');
  });

  it('should return NO_DATA for missing fields', () => {
    const mapper = createOkDataMapper();
    const assets = [
      { ticker: 'SBER', assetType: 'STOCK' },
    ];
    const okData = new Map();

    const snapshots = mapper(okData, assets);
    const snapshot = snapshots.get('SBER');

    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    if (!snapshot.marketResearch) throw new Error('marketResearch is null');
    if (!snapshot.issuerResearch) throw new Error('issuerResearch is null');
    expect(snapshot.marketResearch.currentPrice.status).toBe('NO_DATA');
    expect(snapshot.marketResearch.priceChange1D.status).toBe('NO_DATA');
    expect(snapshot.issuerResearch.financials.revenue.status).toBe('NO_DATA');
    expect(snapshot.issuerResearch.dividend.dividendYield.status).toBe('NO_DATA');
  });

  it('should handle bond with ISIN ticker', () => {
    const mapper = createOkDataMapper();
    const assets = [
      { ticker: 'RU000A10GC20', assetType: 'BOND' },
    ];
    const okData = new Map();
    okData.set('smartlab-bonds', { RU000A10GC20: { ticker: 'БО-П17', sector: 'Корпорации' } });

    const snapshots = mapper(okData, assets);
    const snapshot = snapshots.get('RU000A10GC20');

    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect(snapshot.identity.type).toBe('BOND');
    expect(snapshot.identity.assetType).toBe('BOND');
    expect(snapshot.identity.isin).toBe('RU000A10GC20');
  });

  it('should map macroResearch from cbr-rate', () => {
    const mapper = createOkDataMapper();
    const assets = [
      { ticker: 'SBER', assetType: 'STOCK' },
    ];
    const okData = new Map();
    okData.set('cbr-rate', { rate: 21, date: '2026-11-25', source: 'test' });

    const snapshots = mapper(okData, assets);
    const snapshot = snapshots.get('SBER');

    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect(snapshot.macroResearch).not.toBeNull();
    if (!snapshot.macroResearch) return;
    expect(snapshot.macroResearch.keyRate.status).toBe('VALUE');
    expect(snapshot.macroResearch.keyRate.value).toBe(21);
  });

  it('should handle null from toFiniteNumber (null price)', () => {
    const mapper = createOkDataMapper();
    const assets = [
      { ticker: 'SBER', assetType: 'STOCK' },
    ];
    const okData = new Map();
    okData.set('moex-quotes', { asOf: '2026-11-25', quotes: { SBER: { last: null, changePct: null, turnover: null, volume: null } }, unavailable: [] });

    const snapshots = mapper(okData, assets);
    const snapshot = snapshots.get('SBER');

    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    if (!snapshot.marketResearch) throw new Error('marketResearch is null');
    expect(snapshot.marketResearch.currentPrice.status).toBe('NO_DATA');
    expect(snapshot.marketResearch.priceChange1D.status).toBe('NO_DATA');
    expect(snapshot.marketResearch.volume.status).toBe('NO_DATA');
  });

  it('should map multiple assets', () => {
    const mapper = createOkDataMapper();
    const assets = [
      { ticker: 'SBER', assetType: 'STOCK' },
      { ticker: 'GAZP', assetType: 'STOCK' },
      { ticker: 'RU000A10GC20', assetType: 'BOND' },
    ];
    const okData = new Map();
    okData.set('moex-quotes', {
      asOf: '2026-11-25',
      quotes: {
        SBER: { last: 250, changePct: 2.5, turnover: 1000000, volume: 500000 },
        GAZP: { last: 160, changePct: -1.2, turnover: 500000, volume: 250000 },
      },
      unavailable: [],
    });
    okData.set('cbr-rate', { rate: 21, date: '2026-11-25', source: 'test' });

    const snapshots = mapper(okData, assets);

    expect(snapshots.size).toBe(3);
    const sber = snapshots.get('SBER');
    const gazp = snapshots.get('GAZP');
    const bond = snapshots.get('RU000A10GC20');
    expect(sber).not.toBeNull();
    expect(gazp).not.toBeNull();
    expect(bond).not.toBeNull();
    if (sber) expect(sber.identity.type).toBe('STOCK');
    if (gazp) expect(gazp.identity.type).toBe('STOCK');
    if (bond) expect(bond.identity.type).toBe('BOND');
  });
});

