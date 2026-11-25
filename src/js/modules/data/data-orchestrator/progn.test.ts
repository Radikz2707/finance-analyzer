import { describe, it, expect, vi } from 'vitest';
import { DataOrchestrator } from './data-orchestrator.js';
import { SourceRegistry } from './source-registry.js';

vi.mock('../../api/moex-quotes/moex-quotes.js', () => ({
  MoexQuotesClient: vi.fn().mockImplementation(() => ({
    fetchCurrentQuotes: vi.fn().mockResolvedValue({
      asOf: '2026-11-25',
      quotes: { SBER: { last: 250, changePct: 2.5, turnover: 500000, volume: 1000000 } },
      unavailable: [],
    }),
  })),
}));

vi.mock('../../api/fundamentals/moex-iss-client.js', () => ({
  fetchMoexSecurityInfo: vi.fn().mockResolvedValue(null),
  fetchMoexDividends: vi.fn().mockResolvedValue(null),
  fetchMoexReports: vi.fn().mockResolvedValue(null),
  fetchMoexCoupons: vi.fn().mockResolvedValue(null),
  toNumber: vi.fn((v) => {
    if (v === null || v === undefined || v === '') return null;
    const num = Number(String(v).replace(',', '.'));
    return Number.isFinite(num) ? num : null;
  }),
}));

vi.mock('../../api/smart-lab-api/smart-lab-api.js', () => ({
  fetchSmartLabBonds: vi.fn().mockResolvedValue([]),
  findBondByTicker: vi.fn().mockReturnValue(null),
}));

vi.mock('../../api/fundamentals/smart-lab-client.js', () => ({
  fetchSmartLabFinancials: vi.fn().mockResolvedValue(null),
  fetchSmartLabDividends: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../ai/ai-advisor/cbr-rate.js', () => ({
  getCbrKeyRate: vi.fn().mockResolvedValue({ rate: 21, date: '2026-11-25', source: 'test' }),
}));

const configEnabledFalse = {
  enabled: false,
  defaultTimeoutMs: 15_000,
  cacheTtlMs: 60_000,
  mode: 'stop' as const,
  minQualityScore: 55,
  minSourcesOkRatio: 0.5,
  poorAssetsRatio: 0.5,
};

const configEnabledTrue = {
  enabled: true,
  defaultTimeoutMs: 15_000,
  cacheTtlMs: 60_000,
  mode: 'stop' as const,
  minQualityScore: 55,
  minSourcesOkRatio: 0.5,
  poorAssetsRatio: 0.5,
};

describe('Progn a: enabled=false', () => {
  it('should return skipped=true with flag-off', async () => {
    const orchestrator = new DataOrchestrator(configEnabledFalse);
    const assets = [{ ticker: 'SBER', assetType: 'STOCK' }];
    const result = await orchestrator.execute(assets);

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('flag-off');
    console.log('[PROGN A] enabled=false -> skipped=true, skipReason=flag-off');
    console.log('[PROGN A] snapshot.sources:', result.snapshot.sources.length);
    console.log('[PROGN A] snapshot.okData.size:', result.snapshot.okData.size);
  });
});

describe('Progn b: enabled=true, 9 источников', () => {
  it('should run orchestrator with 9 sources', async () => {
    const registry = new SourceRegistry({ cacheTtlMs: 60_000 });
    
    registry.register({
      id: 'moex-quotes',
      fetcher: async () => ({ asOf: '2026-11-25', quotes: { SBER: { last: 250, changePct: null, turnover: 500000, volume: 1000000 } }, unavailable: [] }),
      timeoutMs: 15_000,
      phase: 1,
    });
    
    registry.register({
      id: 'cbr-rate',
      fetcher: async () => ({ rate: 21, date: '2026-11-25', source: 'test' }),
      timeoutMs: 10_000,
      phase: 1,
    });
    
    registry.register({
      id: 'moex-iss-security',
      fetcher: async () => ({ SBER: { shortName: 'Сбербанк', isin: 'RU00081015PM' } }),
      timeoutMs: 30_000,
      phase: 1,
    });
    
    registry.register({
      id: 'moex-iss-dividends',
      fetcher: async () => ({}),
      timeoutMs: 30_000,
      phase: 1,
    });
    
    registry.register({
      id: 'moex-iss-reports',
      fetcher: async () => ({ SBER: [{ revenue: 1200000000000 }] }),
      timeoutMs: 30_000,
      phase: 1,
    });
    
    registry.register({
      id: 'moex-iss-coupons',
      fetcher: async () => ({}),
      timeoutMs: 30_000,
      phase: 1,
    });
    
    registry.register({
      id: 'smartlab-bonds',
      fetcher: async () => ({}),
      timeoutMs: 30_000,
      phase: 1,
    });
    
    registry.register({
      id: 'smart-lab-financials',
      fetcher: async () => ({ SBER: { roe: 0.18, pe: 4.5 } }),
      timeoutMs: 30_000,
      phase: 1,
    });
    
    registry.register({
      id: 'smart-lab-dividends',
      fetcher: async () => ({ SBER: { dividendYield: 8.5 } }),
      timeoutMs: 30_000,
      phase: 1,
    });

    const { createOkDataMapper } = await import('./wiring.js');
    const mapper = createOkDataMapper();

    const orchestrator = new DataOrchestrator(configEnabledTrue, registry);
    orchestrator.setMapper(mapper);
    
    const assets = [{ ticker: 'SBER', assetType: 'STOCK' }];
    const result = await orchestrator.execute(assets);

    expect(result.skipped).toBe(false);
    // 9/9 ok, qualityScore >= 55 → pass
    expect(result.gateDecision).toBe('pass');
    
    const okCount = result.snapshot.okData.size;
    const totalCount = result.snapshot.sources.length;
    const avgScore = result.qualityReport?.averageQualityScore ?? 0;
    
    console.log('[PROGN B] sourcesOk=' + okCount + '/' + totalCount);
    console.log('[PROGN B] qualityScore=' + avgScore + '%');
    console.log('[PROGN B] gateDecision=pass (9/9 ok, reports→revenue VALUE, financials→roe VALUE)');
    console.log('[PROGN B] skipped=' + result.skipped);
  });
});

describe('Progn c: source failure', () => {
  it('should handle one source throwing error', async () => {
    const registry = new SourceRegistry({ cacheTtlMs: 60_000 });
    
    registry.register({
      id: 'moex-quotes',
      fetcher: async () => ({ asOf: '2026-11-25', quotes: { SBER: { last: 250, changePct: null, turnover: 500000, volume: 1000000 } }, unavailable: [] }),
      timeoutMs: 15_000,
      phase: 1,
    });
    
    registry.register({
      id: 'cbr-rate',
      fetcher: async () => ({ rate: 21, date: '2026-11-25', source: 'test' }),
      timeoutMs: 10_000,
      phase: 1,
    });
    
    // moex-iss-security ok — маппится на identity (name, isin), не penalize
    registry.register({
      id: 'moex-iss-security',
      fetcher: async () => ({ SBER: { shortName: 'Сбербанк', isin: 'RU00081015PM' } }),
      timeoutMs: 30_000,
      phase: 1,
    });
    
    registry.register({
      id: 'moex-iss-dividends',
      fetcher: async () => ({}),
      timeoutMs: 30_000,
      phase: 1,
    });
    
    // moex-iss-reports бросает ошибку → revenue=NO_DATA → penalize снижает score
    registry.register({
      id: 'moex-iss-reports',
      fetcher: async () => { throw new Error('ISS reports unavailable'); },
      timeoutMs: 30_000,
      phase: 1,
    });
    
    registry.register({
      id: 'moex-iss-coupons',
      fetcher: async () => ({}),
      timeoutMs: 30_000,
      phase: 1,
    });
    
    registry.register({
      id: 'smartlab-bonds',
      fetcher: async () => ({}),
      timeoutMs: 30_000,
      phase: 1,
    });
    
    // smart-lab-financials ok — roe/pe VALUE
    registry.register({
      id: 'smart-lab-financials',
      fetcher: async () => ({ SBER: { roe: 0.18, pe: 4.5 } }),
      timeoutMs: 30_000,
      phase: 1,
    });
    
    // smart-lab-dividends ok — dividendYield VALUE
    registry.register({
      id: 'smart-lab-dividends',
      fetcher: async () => ({ SBER: { dividendYield: 8.5 } }),
      timeoutMs: 30_000,
      phase: 1,
    });

    const { createOkDataMapper } = await import('./wiring.js');
    const mapper = createOkDataMapper();

    // minQualityScore=85: progn c (только reports fail → revenue NO_DATA) → score=80% < 85 → stop
    const configStop = {
      enabled: true,
      defaultTimeoutMs: 15_000,
      cacheTtlMs: 60_000,
      mode: 'stop' as const,
      minQualityScore: 85,
      minSourcesOkRatio: 0.5,
      degradeSourcesOkRatio: 0.7,
      poorAssetsRatio: 0.5,
    };
    const orchestrator = new DataOrchestrator(configStop, registry);
    orchestrator.setMapper(mapper);

    const assets = [{ ticker: 'SBER', assetType: 'STOCK' }];
    const result = await orchestrator.execute(assets);

    expect(result.skipped).toBe(false);
    // 8/9 ok >= 50% → не stop на гейте 1
    // qualityScore < 55 (revenue NO_DATA penalize) → stop
    expect(result.gateDecision).toBe('stop');

    const okCountC = result.snapshot.okData.size;
    const totalCountC = result.snapshot.sources.length;
    const avgScoreC = result.qualityReport?.averageQualityScore ?? 0;
    console.log('[PROGN C] sourcesOk=' + okCountC + '/' + totalCountC);
    console.log('[PROGN C] qualityScore=' + avgScoreC + '%');
    console.log('[PROGN C] gateDecision=stop (только reports fail → revenue NO_DATA penalize)');
  });
});

describe('Progn d: degradeSourcesOkRatio 0.7', () => {
  it('6/9=66.7% при degradeThreshold=0.7 → gateDecision=degrade', async () => {
    const registry = new SourceRegistry({ cacheTtlMs: 60_000 });

    registry.register({
      id: 'moex-quotes',
      fetcher: async () => ({ asOf: '2026-11-25', quotes: { SBER: { last: 250, changePct: null, turnover: 500000, volume: 1000000 } }, unavailable: [] }),
      timeoutMs: 15_000,
      phase: 1,
    });
    registry.register({
      id: 'cbr-rate',
      fetcher: async () => ({ rate: 21, date: '2026-11-25', source: 'test' }),
      timeoutMs: 10_000,
      phase: 1,
    });
    // security fail — не penalize поле (identity)
    registry.register({
      id: 'moex-iss-security',
      fetcher: async () => { throw new Error('security fail'); },
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'moex-iss-dividends',
      fetcher: async () => { throw new Error('dividends fail'); },
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'moex-iss-reports',
      fetcher: async () => ({ SBER: [{ revenue: 1200000000000 }] }),
      timeoutMs: 30_000,
      phase: 1,
    });
    // coupons fail — 3-й fail
    registry.register({
      id: 'moex-iss-coupons',
      fetcher: async () => { throw new Error('coupons fail'); },
      timeoutMs: 30_000,
      phase: 1,
    });
    // smart-lab ok — revenue/roe/dividendYield VALUE
    registry.register({
      id: 'smartlab-bonds',
      fetcher: async () => ({}),
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'smart-lab-financials',
      fetcher: async () => ({ SBER: { roe: 0.18, pe: 4.5 } }),
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'smart-lab-dividends',
      fetcher: async () => ({ SBER: { dividendYield: 8.5 } }),
      timeoutMs: 30_000,
      phase: 1,
    });

    const { createOkDataMapper } = await import('./wiring.js');
    const mapper = createOkDataMapper();

    const configWithDegrade = {
      enabled: true,
      defaultTimeoutMs: 15_000,
      cacheTtlMs: 60_000,
      mode: 'stop' as const,
      minQualityScore: 55,
      minSourcesOkRatio: 0.5,
      degradeSourcesOkRatio: 0.7,
      poorAssetsRatio: 0.5,
    };

    const orchestrator = new DataOrchestrator(configWithDegrade, registry);
    orchestrator.setMapper(mapper);

    const assets = [{ ticker: 'SBER', assetType: 'STOCK' }];
    const result = await orchestrator.execute(assets);

    expect(result.skipped).toBe(false);
    // 6/9 = 66.7% >= 50% → не stop
    // 6/9 = 66.7% < 70% → degrade
    expect(result.gateDecision).toBe('degrade');

    const okCount = result.snapshot.okData.size;
    const totalCount = result.snapshot.sources.length;
    console.log('[PROGN D] sourcesOk=' + okCount + '/' + totalCount);
    console.log('[PROGN D] gateDecision=degrade (66.7% в окне 50%-70%)');
  });
});

describe('Progn e: ISS-провал в degrade-режиме (minQualityScore=55)', () => {
  it('полный провал ISS (5/9=55.6%) → degrade при minQualityScore=55', async () => {
    // Конфиг: minQualityScore=55 (degrade-режим), poorAssetsRatio=0.5
    // 5/9 ok, 4 ISS fail (вкл. reports → revenue NO_DATA)
    // qualityScore=80% >= 55 → poorAssets=0/1, но sourcesOk=55.6% < 70% → degrade
    const registry = new SourceRegistry({ cacheTtlMs: 60_000 });

    registry.register({
      id: 'moex-quotes',
      fetcher: async () => ({ asOf: '2026-11-25', quotes: { SBER: { last: 250, changePct: null, turnover: 500000, volume: 1000000 } }, unavailable: [] }),
      timeoutMs: 15_000,
      phase: 1,
    });
    registry.register({
      id: 'cbr-rate',
      fetcher: async () => ({ rate: 21, date: '2026-11-25', source: 'test' }),
      timeoutMs: 10_000,
      phase: 1,
    });
    registry.register({
      id: 'smartlab-bonds',
      fetcher: async () => ({}),
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'smart-lab-financials',
      fetcher: async () => ({ SBER: { roe: 0.18, pe: 4.5 } }),
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'smart-lab-dividends',
      fetcher: async () => ({ SBER: { dividendYield: 8.5 } }),
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'moex-iss-security',
      fetcher: async () => { throw new Error('ISS fail'); },
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'moex-iss-dividends',
      fetcher: async () => { throw new Error('ISS fail'); },
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'moex-iss-reports',
      fetcher: async () => { throw new Error('ISS fail'); },
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'moex-iss-coupons',
      fetcher: async () => { throw new Error('ISS fail'); },
      timeoutMs: 30_000,
      phase: 1,
    });

    const { createOkDataMapper } = await import('./wiring.js');
    const mapper = createOkDataMapper();

    const configDefaults = {
      enabled: true,
      defaultTimeoutMs: 15_000,
      cacheTtlMs: 60_000,
      mode: 'stop' as const,
      minQualityScore: 55,
      minSourcesOkRatio: 0.5,
      degradeSourcesOkRatio: 0.7,
      poorAssetsRatio: 0.5,
    };

    const orchestrator = new DataOrchestrator(configDefaults, registry);
    orchestrator.setMapper(mapper);

    const assets = [{ ticker: 'SBER', assetType: 'STOCK' }];
    const result = await orchestrator.execute(assets);

    expect(result.skipped).toBe(false);
    expect(result.gateDecision).toBe('degrade');

    const okCount = result.snapshot.okData.size;
    const totalCount = result.snapshot.sources.length;
    console.log('[PROGN E] sourcesOk=' + okCount + '/' + totalCount + ' (' + ((okCount / totalCount) * 100).toFixed(1) + '%)');
    console.log('[PROGN E] gateDecision=degrade (55.6% в окне 50%-70%)');
  });

  it('пустое окно (degradeSourcesOkRatio = minSourcesOkRatio=55) → pass', async () => {
    // Конфиг: minQualityScore=55, degradeSourcesOkRatio=55 (пустое окно)
    // poorAssets=0/1 (qualityScore=100% >= 55) → pass
    const registry = new SourceRegistry({ cacheTtlMs: 60_000 });

    registry.register({
      id: 'moex-quotes',
      fetcher: async () => ({ asOf: '2026-11-25', quotes: { SBER: { last: 250, changePct: null, turnover: 500000, volume: 1000000 } }, unavailable: [] }),
      timeoutMs: 15_000,
      phase: 1,
    });
    registry.register({
      id: 'cbr-rate',
      fetcher: async () => ({ rate: 21, date: '2026-11-25', source: 'test' }),
      timeoutMs: 10_000,
      phase: 1,
    });
    registry.register({
      id: 'moex-iss-security',
      fetcher: async () => ({ SBER: { shortName: 'Сбербанк', isin: 'RU00081015PM' } }),
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'moex-iss-dividends',
      fetcher: async () => ({}),
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'moex-iss-reports',
      fetcher: async () => ({ SBER: [{ revenue: 1200000000000 }] }),
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'moex-iss-coupons',
      fetcher: async () => ({}),
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'smartlab-bonds',
      fetcher: async () => ({}),
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'smart-lab-financials',
      fetcher: async () => ({ SBER: { roe: 0.18, pe: 4.5 } }),
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'smart-lab-dividends',
      fetcher: async () => ({ SBER: { dividendYield: 8.5 } }),
      timeoutMs: 30_000,
      phase: 1,
    });

    const { createOkDataMapper } = await import('./wiring.js');
    const mapper = createOkDataMapper();

    const configEmptyWindow = {
      enabled: true,
      defaultTimeoutMs: 15_000,
      cacheTtlMs: 60_000,
      mode: 'stop' as const,
      minQualityScore: 55,
      minSourcesOkRatio: 0.5,
      degradeSourcesOkRatio: 0.5,
      poorAssetsRatio: 0.5,
    };

    const orchestrator = new DataOrchestrator(configEmptyWindow, registry);
    orchestrator.setMapper(mapper);

    const assets = [{ ticker: 'SBER', assetType: 'STOCK' }];
    const result = await orchestrator.execute(assets);

    expect(result.skipped).toBe(false);
    expect(result.gateDecision).toBe('pass');

    const okCount = result.snapshot.okData.size;
    const totalCount = result.snapshot.sources.length;
    console.log('[PROGN EMPTY] sourcesOk=' + okCount + '/' + totalCount + ' → gateDecision=pass (пустое окно degrade)');
  });
});

describe('Progn g: полный провал ISS, продакшн-дефолты (85/0.5/0.7/0.5)', () => {
  it('5/9 ok, qualityScore=80% < 85 → stop через poorAssets', async () => {
    // Продакшн-конфиг: minQualityScore=85, minSourcesOkRatio=0.5, degradeSourcesOkRatio=0.7, poorAssetsRatio=0.5
    // 4 ISS fail (вкл. reports → revenue NO_DATA)
    // qualityScore=80% < 85 → poorAssets=1/1 ≥ 0.5 → stop

    const registry = new SourceRegistry({ cacheTtlMs: 60_000 });

    // Non-ISS — ok
    registry.register({
      id: 'moex-quotes',
      fetcher: async () => ({ asOf: '2026-11-25', quotes: { SBER: { last: 250, changePct: null, turnover: 500000, volume: 1000000 } }, unavailable: [] }),
      timeoutMs: 15_000,
      phase: 1,
    });
    registry.register({
      id: 'cbr-rate',
      fetcher: async () => ({ rate: 21, date: '2026-11-25', source: 'test' }),
      timeoutMs: 10_000,
      phase: 1,
    });
    registry.register({
      id: 'smartlab-bonds',
      fetcher: async () => ({}),
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'smart-lab-financials',
      fetcher: async () => ({ SBER: { roe: 0.18, pe: 4.5 } }),
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'smart-lab-dividends',
      fetcher: async () => ({ SBER: { dividendYield: 8.5 } }),
      timeoutMs: 30_000,
      phase: 1,
    });

    // 4 ISS fail
    registry.register({
      id: 'moex-iss-security',
      fetcher: async () => { throw new Error('ISS fail'); },
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'moex-iss-dividends',
      fetcher: async () => { throw new Error('ISS fail'); },
      timeoutMs: 30_000,
      phase: 1,
    });
    // reports fail → revenue NO_DATA → penalize → qualityScore < 85 → poorAssets=1/1
    registry.register({
      id: 'moex-iss-reports',
      fetcher: async () => { throw new Error('ISS fail'); },
      timeoutMs: 30_000,
      phase: 1,
    });
    registry.register({
      id: 'moex-iss-coupons',
      fetcher: async () => { throw new Error('ISS fail'); },
      timeoutMs: 30_000,
      phase: 1,
    });

    const { createOkDataMapper } = await import('./wiring.js');
    const mapper = createOkDataMapper();

    // Продакшн-дефолты: minQualityScore=85
    const configProduction = {
      enabled: true,
      defaultTimeoutMs: 15_000,
      cacheTtlMs: 60_000,
      mode: 'stop' as const,
      minQualityScore: 85,
      minSourcesOkRatio: 0.5,
      degradeSourcesOkRatio: 0.7,
      poorAssetsRatio: 0.5,
    };

    const orchestrator = new DataOrchestrator(configProduction, registry);
    orchestrator.setMapper(mapper);

    const assets = [{ ticker: 'SBER', assetType: 'STOCK' }];
    const result = await orchestrator.execute(assets);

    expect(result.skipped).toBe(false);
    // 5/9 = 55.6% >= 50% → не stop на гейте 1
    // qualityScore=80% < 85 → poorAssets=1/1 ≥ 0.5 → stop
    expect(result.gateDecision).toBe('stop');

    const okCount = result.snapshot.okData.size;
    const totalCount = result.snapshot.sources.length;
    const avgScore = result.qualityReport?.averageQualityScore ?? 0;
    const poorAssets = result.qualityReport?.assetReports?.filter(a => a.qualityScore < 55).length ?? 0;
    console.log('[PROGN G] sourcesOk=' + okCount + '/' + totalCount + ' (' + ((okCount / totalCount) * 100).toFixed(1) + '%)');
    console.log('[PROGN G] qualityScore=' + avgScore + '%, poorAssets=' + poorAssets);
    console.log('[PROGN G] gateDecision=stop (qualityScore=80% < 85 → poorAssets=1/1 ≥ 0.5)');
  });
});


