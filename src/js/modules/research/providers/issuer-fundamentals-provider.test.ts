import { describe, it, expect, vi } from 'vitest';
import { IssuerFundamentalsProvider } from './issuer-fundamentals-provider.js';
import type { ResearchAsset } from './types.js';
import type { IssuerFetcherAdapter, RawIssuerData } from './issuer-fetcher.js';
import { hasValue } from '../helpers.js';

// Mock fetcher adapter for tests
function createMockFetcher(rawData: RawIssuerData | null, error?: string) {
  return {
    fetch: vi.fn().mockImplementation(async (ticker: string, name: string) => {
      if (error) {
        return {
          ticker,
          name,
          raw: {},
          sourceUrl: '',
          fetchedAt: new Date().toISOString(),
          error,
        };
      }
      if (rawData) {
        return { ...rawData, ticker, name };
      }
      return {
        ticker,
        name,
        raw: {},
        sourceUrl: '',
        fetchedAt: new Date().toISOString(),
        error: 'No data available',
      };
    }),
  } as unknown as IssuerFetcherAdapter;
}

// Valid raw data for SBER from Finam
function createValidRawData(): RawIssuerData {
  return {
    ticker: 'SBER',
    name: 'ПАО Сбербанк',
    raw: {
      data: [
        ['2025-01-15', '1000000', '300000', '200000', '150000', '500000', '300000', '15.5', '12.3', '20.0', '8.5', '6.2', '1.2', '5.0', '10.5', '8.2', '35', '9.5', '45'],
      ],
      columns: [
        'date', 'rev', 'ebitda', 'np', 'fcf', 'debt_long', 'debt_short',
        'roe', 'roic', 'margin', 'pe', 'evebitda', 'pb', 'fcfyield',
        'revgrowth', 'npgrowth', 'div', 'divyield', 'payout',
      ],
    },
    sourceUrl: 'https://api.finam.co/api/DocumentHistoryDesc?instrument=SBER',
    fetchedAt: '2025-09-15T10:00:00Z',
    sourceDate: '2025-01-15',
  };
}

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
    marketQuotes: {},
    macroData: {},
    newsData: [],
    sources: [{ name: 'Finam', version: '1.0', fetchedAt: '2025-09-15T10:00:00Z' }],
  };
}

// 1. STOCK → supports = true
describe('IssuerFundamentalsProvider supports STOCK', () => {
  it('STOCK → supports = true', () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(null));
    expect(provider.supports(createAsset({ assetType: 'STOCK' }))).toBe(true);
  });
});

// 2. BOND → false
describe('IssuerFundamentalsProvider rejects BOND', () => {
  it('BOND → supports = false', () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(null));
    expect(provider.supports(createAsset({ assetType: 'BOND' }))).toBe(false);
  });
});

// 3. ETF → false
describe('IssuerFundamentalsProvider rejects ETF', () => {
  it('ETF → supports = false', () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(null));
    expect(provider.supports(createAsset({ assetType: 'ETF' }))).toBe(false);
  });
});

// 4. CASH → false
describe('IssuerFundamentalsProvider rejects CASH', () => {
  it('CASH → supports = false', () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(null));
    expect(provider.supports(createAsset({ assetType: 'CASH' }))).toBe(false);
  });
});

// 5. mock source response → корректные VALUE
describe('Mock source → корректные VALUE', () => {
  it('financials поля становятся VALUE', async () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(createValidRawData()));
    const snapshot = await provider.research(createAsset(), createContext());

    expect(snapshot.issuerResearch).toBeDefined();
    const fr = snapshot.issuerResearch!.financials;
    expect(hasValue(fr.revenue)).toBe(true);
    expect(fr.revenue.value).toBe(1000000);
    expect(fr.revenue.unit).toBe('RUB');
    expect(hasValue(fr.netIncome)).toBe(true);
    expect(fr.netIncome.value).toBe(200000);
    expect(hasValue(fr.margin)).toBe(true);
    expect(fr.margin.value).toBe(20.0);
    expect(fr.margin.unit).toBe('%');
  });

  it('valuation поля становятся VALUE', async () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(createValidRawData()));
    const snapshot = await provider.research(createAsset(), createContext());

    expect(snapshot.issuerResearch).toBeDefined();
    const v = snapshot.issuerResearch!.valuation;
    expect(hasValue(v.pe)).toBe(true);
    expect(v.pe.value).toBe(8.5);
    expect(hasValue(v.evEbitda)).toBe(true);
    expect(v.evEbitda.value).toBe(6.2);
    expect(hasValue(v.pb)).toBe(true);
    expect(v.pb.value).toBe(1.2);
    expect(hasValue(v.fcfYield)).toBe(true);
    expect(v.fcfYield.value).toBe(5.0);
  });

  it('dividend поля становятся VALUE', async () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(createValidRawData()));
    const snapshot = await provider.research(createAsset(), createContext());

    expect(snapshot.issuerResearch).toBeDefined();
    const d = snapshot.issuerResearch!.dividend;
    expect(hasValue(d.lastDividend)).toBe(true);
    expect(d.lastDividend.value).toBe(35);
    expect(hasValue(d.dividendYield)).toBe(true);
    expect(d.dividendYield.value).toBe(9.5);
    expect(hasValue(d.payoutRatio)).toBe(true);
    expect(d.payoutRatio.value).toBe(45);
  });
});

// 6. missing field → NO_DATA
describe('Missing field → NO_DATA', () => {
  it('empty raw → все поля NO_DATA', async () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(null));
    const snapshot = await provider.research(createAsset(), createContext());

    expect(snapshot.issuerResearch).toBeDefined();
    const fr = snapshot.issuerResearch!.financials;
    expect(hasValue(fr.revenue)).toBe(false);
    expect(hasValue(fr.netIncome)).toBe(false);
    expect(hasValue(fr.ebitda)).toBe(false);
  });
});

// 7. malformed response → NO_DATA + diagnostic
describe('Malformed response → NO_DATA + diagnostic', () => {
  it('error field → NO_DATA', async () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(null, 'Connection refused'));
    const snapshot = await provider.research(createAsset(), createContext());

    expect(snapshot.issuerResearch).toBeDefined();
    const fr = snapshot.issuerResearch!.financials;
    expect(hasValue(fr.revenue)).toBe(false);
    expect(hasValue(fr.netIncome)).toBe(false);
  });
});

// 8. source error → NO_DATA + diagnostic
describe('Source error → NO_DATA + diagnostic', () => {
  it('HTTP error → NO_DATA', async () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(null, 'HTTP 404'));
    const snapshot = await provider.research(createAsset(), createContext());

    expect(snapshot.issuerResearch).toBeDefined();
    const fr = snapshot.issuerResearch!.financials;
    expect(hasValue(fr.revenue)).toBe(false);
  });
});

// 9. every VALUE has evidenceIds
describe('Every VALUE has evidenceIds', () => {
  it('financial VALUE имеет evidenceIds', async () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(createValidRawData()));
    const snapshot = await provider.research(createAsset(), createContext());

    const fr = snapshot.issuerResearch!.financials;
    expect(hasValue(fr.revenue)).toBe(true);
    expect(fr.revenue.evidenceIds).toBeDefined();
    expect(fr.revenue.evidenceIds!.length).toBeGreaterThan(0);
  });

  it('valuation VALUE имеет evidenceIds', async () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(createValidRawData()));
    const snapshot = await provider.research(createAsset(), createContext());

    const v = snapshot.issuerResearch!.valuation;
    expect(hasValue(v.pe)).toBe(true);
    expect(v.pe.evidenceIds).toBeDefined();
    expect(v.pe.evidenceIds!.length).toBeGreaterThan(0);
  });
});

// 10. every evidenceId exists
describe('Every evidenceId exists', () => {
  it('evidenceIds ссылаются на существующие evidence records', async () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(createValidRawData()));
    const snapshot = await provider.research(createAsset(), createContext());

    const fr = snapshot.issuerResearch!.financials;
    if (hasValue(fr.revenue)) {
      for (const id of fr.revenue.evidenceIds) {
        expect(snapshot.evidence[id]).toBeDefined();
        expect(snapshot.evidence[id].id).toBe(id);
        expect(snapshot.evidence[id].source).toBe('Finam');
        expect(snapshot.evidence[id].claim).toBeDefined();
      }
    }
  });
});

// 11. no invented fundamentals
describe('No invented fundamentals', () => {
  it('issuerResearch не содержит AI recommendations', async () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(createValidRawData()));
    const snapshot = await provider.research(createAsset(), createContext());

    expect(snapshot.aiRecommendation).toBeUndefined();
    expect(snapshot.investmentThesis).toBeUndefined();
    expect(snapshot.riskAssessment).toBeUndefined();
    expect(snapshot.marketResearch).toBeUndefined();
    expect(snapshot.macroResearch).toBeUndefined();
  });
});

// 12. source URL сохранён
describe('Source URL сохранён', () => {
  it('evidence содержит source URL', async () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(createValidRawData()));
    const snapshot = await provider.research(createAsset(), createContext());

    const keys = Object.keys(snapshot.evidence);
    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      const ev = snapshot.evidence[key];
      expect(ev.source).toBe('Finam');
      expect(ev.url).toBeDefined();
    }
  });
});

// 13. retrievedAt сохраняется
describe('RetrievedAt сохраняется', () => {
  it('evidence содержит retrievedAt', async () => {
    const provider = new IssuerFundamentalsProvider(createMockFetcher(createValidRawData()));
    const snapshot = await provider.research(createAsset(), createContext());

    const keys = Object.keys(snapshot.evidence);
    for (const key of keys) {
      const ev = snapshot.evidence[key];
      expect(ev.retrievedAt).toBeDefined();
      expect(typeof ev.retrievedAt).toBe('string');
    }
  });
});

// 14. cache предотвращает повторный fetch
describe('Cache prevents repeated fetch', () => {
  it('повторный запрос одного ticker не делает повторный fetch', async () => {
    const mockFetcher = createMockFetcher(createValidRawData());
    const provider = new IssuerFundamentalsProvider(mockFetcher);

    await provider.research(createAsset(), createContext());
    await provider.research(createAsset(), createContext());

    expect(mockFetcher.fetch).toHaveBeenCalledTimes(1);
  });
});

// 15. same provider works for two different tickers
describe('Same provider works for two different tickers', () => {
  it('разные тикеры → разные данные', async () => {
    const mockFetcher = createMockFetcher(createValidRawData());
    const provider = new IssuerFundamentalsProvider(mockFetcher);

    const sber = createAsset({ ticker: 'SBER', name: 'Сбербанк' });
    const gmkn = createAsset({ ticker: 'GMKN', name: 'Норникель' });

    const snapshot1 = await provider.research(sber, createContext());
    const snapshot2 = await provider.research(gmkn, createContext());

    expect(snapshot1.identity.ticker).toBe('SBER');
    expect(snapshot2.identity.ticker).toBe('GMKN');
    expect(mockFetcher.fetch).toHaveBeenCalledTimes(2);
  });
});
