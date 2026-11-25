import { SourceRegistry } from './source-registry.js';
import { MoexQuotesClient } from '../../api/moex-quotes/moex-quotes.js';
import { fetchMoexSecurityInfo, fetchMoexDividends, fetchMoexReports, fetchMoexCoupons, toNumber } from '../../api/fundamentals/moex-iss-client.js';
import { fetchSmartLabBonds, findBondByTicker } from '../../api/smart-lab-api/smart-lab-api.js';
import { fetchSmartLabFinancials, fetchSmartLabDividends } from '../../api/fundamentals/smart-lab-client.js';
import { getCbrKeyRate } from '../../ai/ai-advisor/cbr-rate.js';
import type { AssetInput } from './data-orchestrator.js';
import type { AssetResearchSnapshot } from '../../research/types.js';

async function _batchAll<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = 5) {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const i = index++;
        const item = items[i];
        if (item !== undefined) {
          results[i] = await fn(item);
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function isIsinLike(value: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(value.trim().toUpperCase());
}

function makeNoData() {
  return { status: 'NO_DATA' as const };
}

function makeValue<T>(v: T) {
  return { status: 'VALUE' as const, value: v };
}


export function createSourceRegistry(assets: AssetInput[]) {
  const registry = new SourceRegistry({ cacheTtlMs: 60_000 });
  const tickers = assets.map((a) => a.ticker.toUpperCase());
  const stockTickers = tickers.filter((t) => !isIsinLike(t));
  const bondTickers = tickers.filter((t) => isIsinLike(t));

  // 1. moex-quotes — batch через MoexQuotesClient (окно 1, один HTTP-запрос на тикер)
  registry.register({
    id: 'moex-quotes',
    fetcher: async () => {
      if (stockTickers.length === 0) return { asOf: new Date().toISOString(), quotes: {}, unavailable: [] };
      const client = new MoexQuotesClient({ timeoutMs: 15_000 });
      return client.fetchCurrentQuotes(stockTickers);
    },
    timeoutMs: 15_000,
    phase: 1,
  });

  // 2. cbr-rate — batch
  registry.register({
    id: 'cbr-rate',
    fetcher: async () => {
      const rateData = await getCbrKeyRate();
      return { rate: rateData.rate, date: rateData.date, source: rateData.source };
    },
    timeoutMs: 10_000,
    phase: 1,
  });


  // 3. moex-iss-security — per-ticker, окно 5
  registry.register({
    id: 'moex-iss-security',
    fetcher: async () => {
      const results = await _batchAll(tickers, async (ticker) => {
        const info = await fetchMoexSecurityInfo(ticker);
        return { ticker, data: info };
      }, 5);
      return Object.fromEntries(results.map((r) => [r.ticker, r.data]));
    },
    timeoutMs: 30_000,
    phase: 1,
  });

  // 4. moex-iss-dividends — per-ticker, окно 5
  registry.register({
    id: 'moex-iss-dividends',
    fetcher: async () => {
      const results = await _batchAll(tickers, async (ticker) => {
        const divs = await fetchMoexDividends(ticker);
        return { ticker, data: divs };
      }, 5);
      return Object.fromEntries(results.map((r) => [r.ticker, r.data]));
    },
    timeoutMs: 30_000,
    phase: 1,
  });

  // 5. moex-iss-reports — per-ticker, окно 5
  registry.register({
    id: 'moex-iss-reports',
    fetcher: async () => {
      const results = await _batchAll(tickers, async (ticker) => {
        const reports = await fetchMoexReports(ticker);
        return { ticker, data: reports };
      }, 5);
      return Object.fromEntries(results.map((r) => [r.ticker, r.data]));
    },
    timeoutMs: 30_000,
    phase: 1,
  });

  // 6. moex-iss-coupons — per-ticker, окно 5, только облигации
  registry.register({
    id: 'moex-iss-coupons',
    fetcher: async () => {
      if (bondTickers.length === 0) return {};
      const results = await _batchAll(bondTickers, async (ticker) => {
        const coupons = await fetchMoexCoupons(ticker);
        return { ticker, data: coupons };
      }, 5);
      return Object.fromEntries(results.map((r) => [r.ticker, r.data]));
    },
    timeoutMs: 30_000,
    phase: 1,
  });


  // 7. smartlab-bonds — batch + findBondByTicker (один слот, не дубль)
  registry.register({
    id: 'smartlab-bonds',
    fetcher: async () => {
      const allBonds = await fetchSmartLabBonds();
      const bondMap: Record<string, unknown> = {};
      for (const ticker of bondTickers) {
        const bond = findBondByTicker(allBonds, ticker);
        if (bond) {
          bondMap[ticker] = bond;
        }
      }
      return bondMap;
    },
    timeoutMs: 30_000,
    phase: 1,
  });

  // 8. smart-lab-financials — per-ticker, сериализуется internally
  registry.register({
    id: 'smart-lab-financials',
    fetcher: async () => {
      const results = await _batchAll(tickers, async (ticker) => {
        const financials = await fetchSmartLabFinancials(ticker);
        return { ticker, data: financials };
      }, 1);
      return Object.fromEntries(results.map((r) => [r.ticker, r.data]));
    },
    timeoutMs: 30_000,
    phase: 1,
  });

  // 9. smart-lab-dividends — per-ticker, сериализуется internally
  registry.register({
    id: 'smart-lab-dividends',
    fetcher: async () => {
      const results = await _batchAll(tickers, async (ticker) => {
        const divs = await fetchSmartLabDividends(ticker);
        return { ticker, data: divs };
      }, 1);
      return Object.fromEntries(results.map((r) => [r.ticker, r.data]));
    },
    timeoutMs: 30_000,
    phase: 1,
  });

  return registry;
}


// ──────────────────────────────────────────────
// 4. Маппинг okData → AssetResearchSnapshot
// ──────────────────────────────────────────────

export function createOkDataMapper() {
  return function mapOkDataToSnapshots(okData: Map<string, unknown>, assets: AssetInput[]): Map<string, AssetResearchSnapshot | null> {
    const result = new Map<string, AssetResearchSnapshot | null>();

    const isRecord = (v: unknown): v is Record<string, unknown> =>
      v !== null && typeof v === 'object' && !Array.isArray(v);

    for (const asset of assets) {
      const ticker = asset.ticker.toUpperCase();
      const isBond = isIsinLike(ticker);

      const moexQuotesRaw = okData.get('moex-quotes');
      const moexSecurityRaw = okData.get('moex-iss-security');
      const moexDividendsRaw = okData.get('moex-iss-dividends');
      const moexReportsRaw = okData.get('moex-iss-reports');
      const smartlabBondsRaw = okData.get('smartlab-bonds');
      const smartLabFinancialsRaw = okData.get('smart-lab-financials');
      const smartLabDividendsRaw = okData.get('smart-lab-dividends');
      const cbrRateRaw = okData.get('cbr-rate');

      const moexQuotesSnapshot = isRecord(moexQuotesRaw) ? moexQuotesRaw as Record<string, unknown> : {};
      const quotesRecord = isRecord(moexQuotesSnapshot?.quotes) ? moexQuotesSnapshot.quotes : {};
      const moexSecurity = isRecord(moexSecurityRaw) ? moexSecurityRaw : {};
      const moexDividends = isRecord(moexDividendsRaw) ? moexDividendsRaw : {};
      const moexReports = isRecord(moexReportsRaw) ? moexReportsRaw : {};
      const smartlabBonds = isRecord(smartlabBondsRaw) ? smartlabBondsRaw : {};
      const smartLabFinancials = isRecord(smartLabFinancialsRaw) ? smartLabFinancialsRaw : {};
      const smartLabDividends = isRecord(smartLabDividendsRaw) ? smartLabDividendsRaw : {};
      const cbrRate = isRecord(cbrRateRaw) ? cbrRateRaw : {};

      const securityData = moexSecurity[ticker] as Record<string, unknown> | undefined;
      const smartlabBondData = isBond && smartlabBonds[ticker] ? (smartlabBonds[ticker] as Record<string, unknown>) : null;

      const identity = {
        ticker,
        name: (securityData?.shortName as string) || (smartlabBondData?.ticker as string) || ticker,
        type: isBond ? 'BOND' as const : 'STOCK' as const,
        assetType: isBond ? 'BOND' as const : 'STOCK' as const,
        isin: (securityData?.isin as string) || (isBond ? ticker : undefined),
      };


      // MoexQuotesSnapshot: { asOf, quotes: Record<string, MoexCurrentQuote>, unavailable }
      const quote = quotesRecord[ticker] as Record<string, unknown> | undefined;
      const marketResearch = {
        currentPrice: (quote?.last != null && typeof quote.last === 'number')
          ? makeValue(quote.last) : makeNoData(),
        priceChange1D: (quote?.changePct != null && typeof quote.changePct === 'number')
          ? makeValue(quote.changePct) : makeNoData(),
        volume: (quote?.turnover != null && typeof quote.turnover === 'number')
          ? makeValue(quote.turnover) : makeNoData(),
        priceChange1W: makeNoData(),
        priceChange1M: makeNoData(),
        priceChangeYTD: makeNoData(),
        volatility: makeNoData(),
        liquidity: makeNoData(),
        marketRegime: makeNoData(),
      };

      const reportData = moexReports[ticker] as unknown[] | undefined;
      const financialsData = smartLabFinancials[ticker] as Record<string, unknown> | undefined;
      const divData = smartLabDividends[ticker] as Record<string, unknown> | undefined;
      const divIssData = moexDividends[ticker] as unknown[] | undefined;

      let revenue: number | null = null;
      if (Array.isArray(reportData)) {
        for (const r of reportData) {
          if (typeof r !== 'object' || r === null) continue;
          const rev = toNumber((r as Record<string, unknown>).revenue ?? (r as Record<string, unknown>).REVENUE ?? (r as Record<string, unknown>).SALES);
          if (rev != null && rev > 0) { revenue = rev; break; }
        }
      }

      let dividendYield: number | null = null;
      if (divData && typeof divData === 'object' && 'dividendYield' in divData) {
        const rawYield = divData.dividendYield;
        if (typeof rawYield === 'number' && Number.isFinite(rawYield)) {
          dividendYield = rawYield;
        }
      }

      let lastDividend: number | null = null;
      if (Array.isArray(divIssData) && divIssData.length > 0) {
        const last = divIssData[divIssData.length - 1];
        if (typeof last === 'object' && last !== null) {
          lastDividend = toNumber((last as Record<string, unknown>).value ?? (last as Record<string, unknown>).DIVIDEND);
        }
      }


      const issuerResearch = {
        businessDescription: makeNoData(),
        sector: (smartlabBondData && (smartlabBondData.sector as string)) ? makeValue(smartlabBondData.sector as string) : makeNoData(),
        industry: makeNoData(),
        financials: {
          revenue: revenue != null ? makeValue(revenue) : makeNoData(),
          ebitda: makeNoData(),
          netIncome: makeNoData(),
          freeCashFlow: makeNoData(),
          debt: makeNoData(),
          netDebt: makeNoData(),
          roe: (financialsData?.roe != null && typeof financialsData.roe === 'number')
            ? makeValue(financialsData.roe) : makeNoData(),
          roic: makeNoData(),
          margin: makeNoData(),
        },
        valuation: {
          pe: (financialsData?.pe != null && typeof financialsData.pe === 'number')
            ? makeValue(financialsData.pe) : makeNoData(),
          evEbitda: makeNoData(),
          pb: makeNoData(),
          fcfYield: makeNoData(),
        },
        earningsTrend: {
          revenueGrowth: makeNoData(),
          netIncomeGrowth: makeNoData(),
          guidance: makeNoData(),
        },
        guidance: makeNoData(),
        dividend: {
          lastDividend: lastDividend != null ? makeValue(lastDividend) : makeNoData(),
          dividendYield: dividendYield != null ? makeValue(dividendYield) : makeNoData(),
          payoutRatio: makeNoData(),
        },
      };

      let macroResearch = null;
      if (cbrRate && typeof cbrRate === 'object' && 'rate' in cbrRate && typeof cbrRate.rate === 'number') {
        macroResearch = {
          keyRate: makeValue(cbrRate.rate),
          inflation: makeNoData(),
          inflationTrend: makeNoData(),
          fx: makeNoData(),
          oil: makeNoData(),
          commodityRegime: makeNoData(),
          liquidityRegime: makeNoData(),
          economicCycle: makeNoData(),
          rateRegime: makeNoData(),
        };
      }

      const snapshot: AssetResearchSnapshot = {
        identity,
        marketResearch,
        issuerResearch,
        fundamentals: [],
        newsResearch: [],
        macroResearch,
        evidence: [],
      };

      result.set(ticker, snapshot);
    }

    return result;
  };
}


