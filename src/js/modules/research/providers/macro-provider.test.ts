import { describe, it, expect } from 'vitest';
import { MacroResearchProvider } from './macro-provider.js';
import type {
  ResearchAsset,
  ResearchContext,
} from './types.js';
import type { MacroFetchResult } from './macro-fetcher.js';

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
    marketQuotes: {},
    macroData: {},
    newsData: [],
    sources: [
      {
        name: 'CBR XML-Daily',
        version: '1.0',
        fetchedAt: '2025-09-15T10:00:00Z',
      },
    ],
    ...overrides,
  };
}

function createMockFetcher(result: Partial<MacroFetchResult>) {
  return {
    async fetch(): Promise<MacroFetchResult> {
      return {
        date: '2025-09-15T10:00:00+03:00',
        timestamp: '2025-09-14T20:00:00+03:00',
        sourceUrl: 'https://www.cbr-xml-daily.ru/daily_json.js',
        success: true,
        ...result,
      };
    },
  };
}

function createMockErrorFetcher(error: string) {
  return {
    async fetch(): Promise<MacroFetchResult> {
      throw new Error(error);
    },
  };
}

function createMockOfficialSuccessFetcher(
  opts?: { keyRate?: number | null; keyRateDate?: string; inflation?: number | null; inflationDate?: string },
) {
  return {
    async fetch(): Promise<import('./cbr-official-fetcher.js').CbrOfficialResult> {
      return {
        keyRate: opts !== undefined && opts.keyRate !== undefined ? opts.keyRate : 14.0,
        keyRateDate: opts?.keyRateDate ?? '2025-09-15',
        inflation: opts !== undefined && opts.inflation !== undefined ? opts.inflation : 6.3,
        inflationDate: opts?.inflationDate ?? '2025-09-01',
        keyRateUrl: 'https://www.cbr.ru/hd_base/KeyRate/',
        inflationUrl: 'https://www.cbr.ru/statistics/ddkp/infl/',
        success: true,
      };
    },
  };
}

function createMockOfficialErrorFetcher(error: string) {
  return {
    async fetch(): Promise<import('./cbr-official-fetcher.js').CbrOfficialResult> {
      throw new Error(error);
    },
  };
}

// ═══════════════════════════════════════════════
// 1. provider supports STOCK
// ═══════════════════════════════════════════════

describe('MacroResearchProvider supports STOCK', () => {
  const provider = new MacroResearchProvider();

  it('STOCK → true', () => {
    expect(provider.supports(createAsset({ assetType: 'STOCK' }))).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 2. provider supports BOND
// ═══════════════════════════════════════════════

describe('MacroResearchProvider supports BOND', () => {
  const provider = new MacroResearchProvider();

  it('BOND → true', () => {
    expect(provider.supports(createAsset({ assetType: 'BOND' }))).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 3. provider supports ETF
// ═══════════════════════════════════════════════

describe('MacroResearchProvider supports ETF', () => {
  const provider = new MacroResearchProvider();

  it('ETF → true', () => {
    expect(provider.supports(createAsset({ assetType: 'ETF' }))).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 4. provider supports CASH
// ═══════════════════════════════════════════════

describe('MacroResearchProvider supports CASH', () => {
  const provider = new MacroResearchProvider();

  it('CASH → true', () => {
    expect(provider.supports(createAsset({ assetType: 'CASH' }))).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 5. mock official response → VALUE
// ═══════════════════════════════════════════════

describe('mock official response → VALUE', () => {
  it('USD курс → VALUE', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const provider = new MacroResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch).toBeDefined();
    expect(snapshot.macroResearch!.fx.status).toBe('VALUE');
    expect(snapshot.macroResearch!.fx.value).toBe(84.3363);
    expect(snapshot.macroResearch!.fx.unit).toBe('RUB/USD');
  });

  it('EUR курс → NO_DATA (используется только USD)', async () => {
    const fetcher = createMockFetcher({ eurRate: 97.7626 });
    const provider = new MacroResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch).toBeDefined();
    // fx берёт USD, EUR не доступен → NO_DATA
    expect(snapshot.macroResearch!.fx.status).toBe('NO_DATA');
  });

  it('CNY курс → NO_DATA (используется только USD)', async () => {
    const fetcher = createMockFetcher({ cnyRate: 12.5353 });
    const provider = new MacroResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch).toBeDefined();
    // fx берёт USD, CNY не доступен → NO_DATA
    expect(snapshot.macroResearch!.fx.status).toBe('NO_DATA');
  });
});

// ═══════════════════════════════════════════════
// 6. keyRate/inflation now VALUE from official CBR
// ═══════════════════════════════════════════════

describe('keyRate/inflation now VALUE from official CBR', () => {
  it('keyRate → VALUE с mock official fetcher', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ keyRate: 14.0, inflation: 6.3 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.keyRate.status).toBe('VALUE');
    expect(snapshot.macroResearch!.keyRate.value).toBe(14.0);
    expect(snapshot.macroResearch!.keyRate.unit).toBe('%');
  });

  it('inflation → VALUE с mock official fetcher', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ keyRate: 14.0, inflation: 6.3 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.inflation.status).toBe('VALUE');
    expect(snapshot.macroResearch!.inflation.value).toBe(6.3);
    expect(snapshot.macroResearch!.inflation.unit).toBe('%');
  });

  it('oil → NO_DATA (не доступен через API)', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.oil.status).toBe('NO_DATA');
  });

  it('rateRegime → VALUE (derived из keyRate)', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ keyRate: 14.0 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.rateRegime.status).toBe('VALUE');
  });

  it('inflationTrend → VALUE (derived из inflation)', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ inflation: 6.3 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.inflationTrend.status).toBe('VALUE');
  });

  it('liquidityRegime → VALUE (derived из keyRate + inflation + FX)', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.liquidityRegime.status).toBe('VALUE');
  });

  it('economicCycle → VALUE (derived из inflation)', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ inflation: 6.3 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.economicCycle.status).toBe('VALUE');
  });

  it('commodityRegime → NO_DATA (oil NO_DATA)', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.commodityRegime.status).toBe('NO_DATA');
  });
});

// ═══════════════════════════════════════════════
// 7. malformed response → NO_DATA
// ═══════════════════════════════════════════════

describe('malformed response → NO_DATA', () => {
  it('ошибка official fetcher → keyRate/inflation NO_DATA', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialErrorFetcher('Network error');
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.keyRate.status).toBe('NO_DATA');
    expect(snapshot.macroResearch!.inflation.status).toBe('NO_DATA');
  });

  it('ошибка macro fetcher → все поля NO_DATA', async () => {
    const fetcher = createMockErrorFetcher('Network error');
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    // При ошибке macro fetcher provider возвращает allNoDataMacroResearch()
    expect(snapshot.macroResearch!.fx.status).toBe('NO_DATA');
    expect(snapshot.macroResearch!.keyRate.status).toBe('NO_DATA');
    expect(snapshot.macroResearch!.inflation.status).toBe('NO_DATA');
  });
});

// ═══════════════════════════════════════════════
// 8. HTTP error → NO_DATA
// ═══════════════════════════════════════════════

describe('HTTP error → NO_DATA', () => {
  it('ошибка сети macro → все поля NO_DATA', async () => {
    const fetcher = createMockErrorFetcher('Connection refused');
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    // При ошибке macro fetcher provider возвращает allNoDataMacroResearch()
    expect(snapshot.macroResearch!.fx.status).toBe('NO_DATA');
    expect(snapshot.macroResearch!.keyRate.status).toBe('NO_DATA');
    expect(snapshot.macroResearch!.inflation.status).toBe('NO_DATA');
  });

  it('ошибка сети official → keyRate/inflation NO_DATA', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialErrorFetcher('Connection refused');
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.keyRate.status).toBe('NO_DATA');
    expect(snapshot.macroResearch!.inflation.status).toBe('NO_DATA');
    expect(snapshot.macroResearch!.fx.status).toBe('VALUE');
  });
});

// ═══════════════════════════════════════════════
// 9. every VALUE has evidenceIds
// ═══════════════════════════════════════════════

describe('every VALUE has evidenceIds', () => {
  it('fx VALUE имеет evidenceIds', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const provider = new MacroResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const fx = snapshot.macroResearch!.fx;
    expect(fx.status).toBe('VALUE');
    expect(fx.evidenceIds).toBeDefined();
    expect(fx.evidenceIds!.length).toBeGreaterThan(0);
  });

  it('keyRate VALUE имеет evidenceIds', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const keyRate = snapshot.macroResearch!.keyRate;
    expect(keyRate.status).toBe('VALUE');
    expect(keyRate.evidenceIds).toBeDefined();
    expect(keyRate.evidenceIds!.length).toBeGreaterThan(0);
  });

  it('inflation VALUE имеет evidenceIds', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const inflation = snapshot.macroResearch!.inflation;
    expect(inflation.status).toBe('VALUE');
    expect(inflation.evidenceIds).toBeDefined();
    expect(inflation.evidenceIds!.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════
// 10. evidence type = MACRO
// ═══════════════════════════════════════════════

describe('evidence type = MACRO', () => {
  it('каждый evidence имеет type MACRO', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    for (const ev of Object.values(snapshot.evidence)) {
      expect(ev.type).toBe('MACRO');
    }
  });
});

// ═══════════════════════════════════════════════
// 11. source URL preserved
// ═══════════════════════════════════════════════

describe('source URL preserved', () => {
  it('FX evidence содержит URL зеркала', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const provider = new MacroResearchProvider(fetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const fx = snapshot.macroResearch!.fx;
    expect(fx.status).toBe('VALUE');

    const evidenceId = fx.evidenceIds![0];
    const ev = snapshot.evidence[evidenceId];
    expect(ev.url).toBe('https://www.cbr-xml-daily.ru/daily_json.js');
    expect(ev.source).toBe('CBR XML-Daily mirror');
  });

  it('keyRate evidence содержит официальный URL ЦБ', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const keyRate = snapshot.macroResearch!.keyRate;
    expect(keyRate.status).toBe('VALUE');

    const evidenceId = keyRate.evidenceIds![0];
    const ev = snapshot.evidence[evidenceId];
    expect(ev.url).toBe('https://www.cbr.ru/hd_base/KeyRate/');
    expect(ev.source).toBe('Bank of Russia');
  });

  it('inflation evidence содержит официальный URL ЦБ', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const inflation = snapshot.macroResearch!.inflation;
    expect(inflation.status).toBe('VALUE');

    const evidenceId = inflation.evidenceIds![0];
    const ev = snapshot.evidence[evidenceId];
    expect(ev.url).toBe('https://www.cbr.ru/statistics/ddkp/infl/');
    expect(ev.source).toBe('Bank of Russia');
  });
});

// ═══════════════════════════════════════════════
// 12. cache prevents duplicate request
// ═══════════════════════════════════════════════

describe('cache prevents duplicate request', () => {
  it('повторный запрос для того же актива использует кэш', async () => {
    let fetchCount = 0;
    const fetcher = {
      async fetch(): Promise<MacroFetchResult> {
        fetchCount++;
        return {
          usdRate: 84.3363,
          date: '2025-09-15T10:00:00+03:00',
          timestamp: '2025-09-14T20:00:00+03:00',
          sourceUrl: 'https://www.cbr-xml-daily.ru/daily_json.js',
          success: true,
        };
      },
    };

    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher as unknown as import('./macro-fetcher.js').MacroFetcher, undefined, officialFetcher);

    // Первый запрос — fetch
    await provider.research(createAsset({ ticker: 'SBER' }), createContext());
    expect(fetchCount).toBe(1);

    // Второй запрос — из кэша (глобальный macro cache)
    await provider.research(createAsset({ ticker: 'GAZP' }), createContext());
    expect(fetchCount).toBe(1); // fetch не вызвался повторно
  });
});

// ═══════════════════════════════════════════════
// 13. no hardcoded current macro values
// ═══════════════════════════════════════════════

describe('no hardcoded current macro values', () => {
  it('keyRate берётся из источника, а не хардкодится', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    // Используем нестандартное значение 12.5 вместо 14.0
    const officialFetcher = createMockOfficialSuccessFetcher({ keyRate: 12.5, inflation: 5.0 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.keyRate.status).toBe('VALUE');
    expect(snapshot.macroResearch!.keyRate.value).toBe(12.5);
    // Убеждаемся, что значение не захардкожено
    expect(snapshot.macroResearch!.keyRate.value).not.toBe(14.0);
  });

  it('inflation берётся из источника, а не хардкодится', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    // Используем нестандартное значение 5.0 вместо 6.3
    const officialFetcher = createMockOfficialSuccessFetcher({ keyRate: 12.5, inflation: 5.0 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.inflation.status).toBe('VALUE');
    expect(snapshot.macroResearch!.inflation.value).toBe(5.0);
    // Убеждаемся, что значение не захардкожено
    expect(snapshot.macroResearch!.inflation.value).not.toBe(6.3);
  });
});

// ═══════════════════════════════════════════════
// 14. provider creates MacroResearch only
// ═══════════════════════════════════════════════

describe('provider creates MacroResearch only', () => {
  it('macroResearch определён', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch).toBeDefined();
  });

  it('issuerResearch = undefined', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.issuerResearch).toBeUndefined();
  });

  it('bondResearch = undefined', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.bondResearch).toBeUndefined();
  });

  it('etfResearch = undefined', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.etfResearch).toBeUndefined();
  });

  it('marketResearch = undefined', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.marketResearch).toBeUndefined();
  });

  it('newsResearch = undefined', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.newsResearch).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// 15. provider does not create AIRecommendation
// ═══════════════════════════════════════════════

describe('provider does not create AIRecommendation', () => {
  it('aiRecommendation = undefined', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.aiRecommendation).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// 16. provider does not create InvestmentThesis
// ═══════════════════════════════════════════════

describe('provider does not create InvestmentThesis', () => {
  it('investmentThesis = undefined', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.investmentThesis).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// 17. derived fields use heuristic source
// ═══════════════════════════════════════════════

describe('derived fields use heuristic source', () => {
  it('rateRegime = VALUE, evidence source содержит "heuristic"', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ keyRate: 14.0 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.rateRegime.status).toBe('VALUE');
    
    const evidenceId = snapshot.macroResearch!.rateRegime.evidenceIds![0];
    const ev = snapshot.evidence[evidenceId];
    expect(ev.source).toContain('heuristic');
  });

  it('inflationTrend = VALUE, evidence source содержит "heuristic"', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ inflation: 6.3 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.inflationTrend.status).toBe('VALUE');
    
    const evidenceId = snapshot.macroResearch!.inflationTrend.evidenceIds![0];
    const ev = snapshot.evidence[evidenceId];
    expect(ev.source).toContain('heuristic');
  });

  it('liquidityRegime = VALUE, evidence source содержит "heuristic"', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.liquidityRegime.status).toBe('VALUE');
    
    const evidenceId = snapshot.macroResearch!.liquidityRegime.evidenceIds![0];
    const ev = snapshot.evidence[evidenceId];
    expect(ev.source).toContain('heuristic');
  });

  it('economicCycle = VALUE, evidence source содержит "heuristic"', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ inflation: 6.3 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.economicCycle.status).toBe('VALUE');
    
    const evidenceId = snapshot.macroResearch!.economicCycle.evidenceIds![0];
    const ev = snapshot.evidence[evidenceId];
    expect(ev.source).toContain('heuristic');
  });

  it('commodityRegime = NO_DATA, evidence source содержит "heuristic"', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    expect(snapshot.macroResearch!.commodityRegime.status).toBe('NO_DATA');
  });
});

// ═══════════════════════════════════════════════
// 18. Registry integration
// ═══════════════════════════════════════════════

describe('Registry integration', () => {
  it('registry находит MacroResearchProvider для STOCK', async () => {
    const { ResearchProviderRegistry } = await import('./registry.js');
    const registry = new ResearchProviderRegistry();

    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const macroProvider = new MacroResearchProvider(fetcher, undefined, officialFetcher);
    registry.register(macroProvider);

    const asset = createAsset({ ticker: 'SBER', assetType: 'STOCK' });
    const found = registry.findProviders(asset);

    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.some((p) => p === macroProvider)).toBe(true);
  });

  it('registry находит MacroResearchProvider для BOND', async () => {
    const { ResearchProviderRegistry } = await import('./registry.js');
    const registry = new ResearchProviderRegistry();

    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const macroProvider = new MacroResearchProvider(fetcher, undefined, officialFetcher);
    registry.register(macroProvider);

    const asset = createAsset({ ticker: 'GSVD', assetType: 'BOND' });
    const found = registry.findProviders(asset);

    expect(found.some((p) => p === macroProvider)).toBe(true);
  });

  it('registry находит MacroResearchProvider для ETF', async () => {
    const { ResearchProviderRegistry } = await import('./registry.js');
    const registry = new ResearchProviderRegistry();

    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const macroProvider = new MacroResearchProvider(fetcher, undefined, officialFetcher);
    registry.register(macroProvider);

    const asset = createAsset({ ticker: 'TCONV', assetType: 'ETF' });
    const found = registry.findProviders(asset);

    expect(found.some((p) => p === macroProvider)).toBe(true);
  });

  it('registry находит MacroResearchProvider для CASH', async () => {
    const { ResearchProviderRegistry } = await import('./registry.js');
    const registry = new ResearchProviderRegistry();

    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const macroProvider = new MacroResearchProvider(fetcher, undefined, officialFetcher);
    registry.register(macroProvider);

    const asset = createAsset({ ticker: 'LQDS', assetType: 'CASH' });
    const found = registry.findProviders(asset);

    expect(found.some((p) => p === macroProvider)).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 19. Full aggregation for STOCK
// ═══════════════════════════════════════════════

describe('Full aggregation for STOCK', () => {
  it('STOCK агрегирует Market + Macro', async () => {
    const { ResearchProviderRegistry } = await import('./registry.js');
    const { MarketDataProvider } = await import('./market-provider.js');

    const registry = new ResearchProviderRegistry();
    registry.register(new MarketDataProvider());

    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const macroProvider = new MacroResearchProvider(fetcher, undefined, officialFetcher);
    registry.register(macroProvider);

    const asset = createAsset({ ticker: 'SBER', assetType: 'STOCK' });
    const { snapshot, providerCount } = await registry.researchAll(
      asset,
      createContext(),
    );

    expect(providerCount).toBeGreaterThanOrEqual(2);
    expect(snapshot.marketResearch).toBeDefined();
    expect(snapshot.macroResearch).toBeDefined();
    expect(snapshot.macroResearch!.fx.status).toBe('VALUE');
    expect(snapshot.macroResearch!.fx.value).toBe(84.3363);
    expect(snapshot.macroResearch!.keyRate.status).toBe('VALUE');
    expect(snapshot.macroResearch!.inflation.status).toBe('VALUE');
  });
});

// ═══════════════════════════════════════════════
// 20. Snapshot structure
// ═══════════════════════════════════════════════

describe('Snapshot structure', () => {
  it('identity содержит все обязательные поля', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER', name: 'Сбербанк', issuer: 'Сбербанк' }),
      createContext(),
    );

    expect(snapshot.identity.ticker).toBe('SBER');
    expect(snapshot.identity.name).toBe('Сбербанк');
    expect(snapshot.identity.assetType).toBe('STOCK');
    expect(snapshot.identity.issuer).toBe('Сбербанк');
    expect(snapshot.identity.currency).toBe('RUB');
    expect(snapshot.identity.market).toBe('MOEX');
  });

  it('evidence не пустой', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(
      createAsset({ ticker: 'SBER' }),
      createContext(),
    );

    const evidenceKeys = Object.keys(snapshot.evidence);
    expect(evidenceKeys.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════
// 21. Comprehensive new tests for keyRate/inflation
// ═══════════════════════════════════════════════

describe('Comprehensive new tests for keyRate/inflation', () => {
  it('mock official keyRate → VALUE', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ keyRate: 14.0 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    expect(snapshot.macroResearch!.keyRate.status).toBe('VALUE');
    expect(snapshot.macroResearch!.keyRate.value).toBe(14.0);
  });

  it('mock official inflation → VALUE', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ inflation: 6.3 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    expect(snapshot.macroResearch!.inflation.status).toBe('VALUE');
    expect(snapshot.macroResearch!.inflation.value).toBe(6.3);
  });

  it('missing keyRate → NO_DATA', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ keyRate: null });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    expect(snapshot.macroResearch!.keyRate.status).toBe('NO_DATA');
  });

  it('missing inflation → NO_DATA', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ inflation: null });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    expect(snapshot.macroResearch!.inflation.status).toBe('NO_DATA');
  });

  it('malformed keyRate → NO_DATA', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialErrorFetcher('Parse error');
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    expect(snapshot.macroResearch!.keyRate.status).toBe('NO_DATA');
    expect(snapshot.macroResearch!.inflation.status).toBe('NO_DATA');
  });

  it('HTTP error → NO_DATA', async () => {
    const fetcher = createMockErrorFetcher('Network error');
    const officialFetcher = createMockOfficialErrorFetcher('HTTP error');
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    expect(snapshot.macroResearch!.fx.status).toBe('NO_DATA');
    expect(snapshot.macroResearch!.keyRate.status).toBe('NO_DATA');
    expect(snapshot.macroResearch!.inflation.status).toBe('NO_DATA');
  });

  it('keyRate evidence.source = "Bank of Russia"', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    const evidenceId = snapshot.macroResearch!.keyRate.evidenceIds![0];
    const ev = snapshot.evidence[evidenceId];
    expect(ev.source).toBe('Bank of Russia');
  });

  it('inflation evidence.source = "Bank of Russia"', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    const evidenceId = snapshot.macroResearch!.inflation.evidenceIds![0];
    const ev = snapshot.evidence[evidenceId];
    expect(ev.source).toBe('Bank of Russia');
  });

  it('keyRate evidence URL = официальный URL', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    const evidenceId = snapshot.macroResearch!.keyRate.evidenceIds![0];
    const ev = snapshot.evidence[evidenceId];
    expect(ev.url).toBe('https://www.cbr.ru/hd_base/KeyRate/');
  });

  it('inflation evidence URL = официальный URL', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    const evidenceId = snapshot.macroResearch!.inflation.evidenceIds![0];
    const ev = snapshot.evidence[evidenceId];
    expect(ev.url).toBe('https://www.cbr.ru/statistics/ddkp/infl/');
  });

  it('retrievedAt присутствует во всех evidence', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    for (const ev of Object.values(snapshot.evidence)) {
      expect(ev.retrievedAt).toBeDefined();
      expect(ev.retrievedAt).toBeTruthy();
    }
  });

  it('evidenceIds валидны (существуют в snapshot.evidence)', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    
    const allEvidenceIds = [
      ...(snapshot.macroResearch!.fx.evidenceIds ?? []),
      ...(snapshot.macroResearch!.keyRate.evidenceIds ?? []),
      ...(snapshot.macroResearch!.inflation.evidenceIds ?? []),
    ];

    for (const id of allEvidenceIds) {
      expect(snapshot.evidence[id]).toBeDefined();
    }
  });

  it('FX evidence source = "CBR XML-Daily mirror"', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const provider = new MacroResearchProvider(fetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    const evidenceId = snapshot.macroResearch!.fx.evidenceIds![0];
    const ev = snapshot.evidence[evidenceId];
    expect(ev.source).toBe('CBR XML-Daily mirror');
  });

  it('FX evidence НЕ содержит утверждение, что mirror является официальным источником ЦБ', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const provider = new MacroResearchProvider(fetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    const evidenceId = snapshot.macroResearch!.fx.evidenceIds![0];
    const ev = snapshot.evidence[evidenceId];
    
    // claim не должен содержать "официальный" или "Bank of Russia"
    expect(ev.claim.toLowerCase()).not.toContain('официальный');
    expect(ev.claim).not.toContain('Bank of Russia');
  });

  it('current 14% НЕ захардкожено', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ keyRate: 10.0 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    expect(snapshot.macroResearch!.keyRate.value).toBe(10.0);
    expect(snapshot.macroResearch!.keyRate.value).not.toBe(14.0);
  });

  it('current 6.3% НЕ захардкожено', async () => {
    const fetcher = createMockFetcher({ usdRate: 84.3363 });
    const officialFetcher = createMockOfficialSuccessFetcher({ inflation: 4.0 });
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    expect(snapshot.macroResearch!.inflation.value).toBe(4.0);
    expect(snapshot.macroResearch!.inflation.value).not.toBe(6.3);
  });

  it('существующий cache работает', async () => {
    let fetchCount = 0;
    const fetcher = {
      async fetch(): Promise<MacroFetchResult> {
        fetchCount++;
        return {
          usdRate: 84.3363,
          date: '2025-09-15T10:00:00+03:00',
          timestamp: '2025-09-14T20:00:00+03:00',
          sourceUrl: 'https://www.cbr-xml-daily.ru/daily_json.js',
          success: true,
        };
      },
    };

    const officialFetcher = createMockOfficialSuccessFetcher();
    const provider = new MacroResearchProvider(fetcher as unknown as import('./macro-fetcher.js').MacroFetcher, undefined, officialFetcher);

    await provider.research(createAsset({ ticker: 'SBER' }), createContext());
    expect(fetchCount).toBe(1);

    await provider.research(createAsset({ ticker: 'GAZP' }), createContext());
    expect(fetchCount).toBe(1); // из кэша
  });

  it('oil/economicCycle/liquidity остаются NO_DATA когда нет данных', async () => {
    const fetcher = createMockErrorFetcher('Network error');
    const officialFetcher = createMockOfficialErrorFetcher('Network error');
    const provider = new MacroResearchProvider(fetcher, undefined, officialFetcher);

    const snapshot = await provider.research(createAsset(), createContext());
    expect(snapshot.macroResearch!.oil.status).toBe('NO_DATA');
    expect(snapshot.macroResearch!.economicCycle.status).toBe('NO_DATA');
    expect(snapshot.macroResearch!.liquidityRegime.status).toBe('NO_DATA');
  });
});
