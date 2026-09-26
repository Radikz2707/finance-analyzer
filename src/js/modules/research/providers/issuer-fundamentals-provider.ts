/**
 * Issuer Fundamentals Provider — получение и нормализация
 * финансовых показателей эмитента (STOCK).
 *
 * 3-этапная архитектура:
 *   1. fetchRaw()    — получение сырых данных из источника
 *   2. normalize()   — преобразование в ResearchValue
 *   3. buildSnapshot() — построение IssuerResearch + evidence
 *
 * Источник: Finam API (публичный, бесплатный, без авторизации)
 * URL: https://api.finam.co/api/DocumentHistoryDesc
 *
 * НЕ генерирует AI-рекомендации.
 * НЕ обращается к Ollama.
 * Если данных нет → NO_DATA.
 */

import type {
  ResearchProvider,
  ResearchAsset,
  ResearchContext,
} from './types.js';
import type { RawIssuerData, IssuerFetcherAdapter } from './issuer-fetcher.js';
import type {
  NormalizedFinancials,
  NormalizedValuation,
  NormalizedEarningsTrend,
  NormalizedDividend,
} from './issuer-normalizer.js';
import type { AssetResearchSnapshot } from '../types.js';
import { normalizeIssuerData } from './issuer-normalizer.js';
import { FinamIssuerFetcher } from './issuer-fetcher.js';
import { noData, str } from '../helpers.js';

// ──────────────────────────────────────────────
// 1. Кэш на один запуск
// ──────────────────────────────────────────────

/** Кэш: key = ticker → { data, timestamp } */
interface CacheEntry {
  data: RawIssuerData;
  fetchedAt: string;
}

class IssuerCache {
  private store = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) { // 5 минут по умолчанию
    this.ttlMs = ttlMs;
  }

  get(ticker: string): RawIssuerData | null {
    const entry = this.store.get(ticker);
    if (!entry) return null;

    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (age > this.ttlMs) {
      this.store.delete(ticker);
      return null;
    }

    return entry.data;
  }

  set(ticker: string, data: RawIssuerData): void {
    this.store.set(ticker, {
      data,
      fetchedAt: new Date().toISOString(),
    });
  }

  clear(): void {
    this.store.clear();
  }
}

// ──────────────────────────────────────────────
// 2. Provider
// ──────────────────────────────────────────────

export class IssuerFundamentalsProvider implements ResearchProvider {
  private readonly fetcher: IssuerFetcherAdapter;
  private readonly cache: IssuerCache;

  constructor(
    fetcher?: IssuerFetcherAdapter,
    cacheTtlMs?: number,
  ) {
    this.fetcher = fetcher ?? new FinamIssuerFetcher();
    this.cache = new IssuerCache(cacheTtlMs);
  }

  /** Поддерживает только STOCK */
  supports(asset: ResearchAsset): boolean {
    return asset.assetType === 'STOCK';
  }

  async research(
    asset: ResearchAsset,
    _context: ResearchContext,
  ): Promise<AssetResearchSnapshot> {
    // Этап 1: fetchRaw
    const raw = await this.fetchRaw(asset.ticker, asset.name);

    // Защита от null
    if (!raw) {
      return {
        identity: {
          ticker: asset.ticker,
          name: asset.name,
          assetType: 'STOCK' as const,
          issuer: asset.issuer ?? '',
          currency: asset.currency ?? 'RUB',
          market: asset.market ?? 'MOEX',
        },
        evidence: {},
      };
    }

    // Этап 2: normalize
    const normalized = normalizeIssuerData(raw);

    // Этап 3: buildSnapshot
    return this.buildSnapshot(asset, raw, normalized);
  }

  // ───────────────────────────────────────────
  // Этап 1: fetchRaw
  // ───────────────────────────────────────────

  private async fetchRaw(
    ticker: string,
    name: string,
  ): Promise<RawIssuerData> {
    // Проверка кэша
    const cached = this.cache.get(ticker);
    if (cached) return cached;

    // Запрос к источнику
    const data = await this.fetcher.fetch(ticker, name);

    // Сохранение в кэш
    this.cache.set(ticker, data);

    return data;
  }

  // ───────────────────────────────────────────
  // Этап 3: buildSnapshot
  // ───────────────────────────────────────────

  private buildSnapshot(
    asset: ResearchAsset,
    raw: RawIssuerData,
    normalized: ReturnType<typeof normalizeIssuerData>,
  ): AssetResearchSnapshot {
    const { financials, valuation, earningsTrend, dividend, error, evidence } = normalized;

    // Если есть ошибка источника — не добавляем fake данные
    const issuerResearch = this.buildIssuerResearch(
      asset, raw, financials, valuation, earningsTrend, dividend, error,
    );

    return {
      identity: {
        ticker: asset.ticker,
        name: asset.name,
        assetType: 'STOCK' as const,
        issuer: asset.issuer ?? '',
        currency: asset.currency ?? 'RUB',
        market: asset.market ?? 'MOEX',
      },
      issuerResearch,
      evidence,
    };
  }

  private buildIssuerResearch(
    asset: ResearchAsset,
    _raw: RawIssuerData,
    financials: NormalizedFinancials,
    valuation: NormalizedValuation,
    earningsTrend: NormalizedEarningsTrend,
    dividend: NormalizedDividend,
    error?: string,
  ): AssetResearchSnapshot['issuerResearch'] {
    // Если есть ошибка источника — все NO_DATA
    if (error) {
      return {
        businessDescription: str(`Ошибка источника: ${error}`),
        sector: noData(),
        industry: noData(),
        financials: this.allNoDataFinancials(),
        valuation: this.allNoDataValuation(),
        earningsTrend: this.allNoDataEarningsTrend(),
        guidance: noData(),
        dividend: this.allNoDataDividend(),
      };
    }

    return {
      businessDescription: str(`Финансовые данные ${asset.ticker} из Finam`),
      sector: noData(),
      industry: noData(),
      financials: {
        revenue: financials.revenue.researchValue,
        ebitda: financials.ebitda.researchValue,
        netIncome: financials.netIncome.researchValue,
        freeCashFlow: financials.freeCashFlow.researchValue,
        debt: financials.debt.researchValue,
        netDebt: financials.netDebt.researchValue,
        roe: financials.roe.researchValue,
        roic: financials.roic.researchValue,
        margin: financials.margin.researchValue,
      },
      valuation: {
        pe: valuation.pe.researchValue,
        evEbitda: valuation.evEbitda.researchValue,
        pb: valuation.pb.researchValue,
        fcfYield: valuation.fcfYield.researchValue,
      },
      earningsTrend: {
        revenueGrowth: earningsTrend.revenueGrowth.researchValue,
        netIncomeGrowth: earningsTrend.netIncomeGrowth.researchValue,
        guidance: earningsTrend.guidance.researchValue,
      },
      guidance: noData(),
      dividend: {
        lastDividend: dividend.lastDividend.researchValue,
        dividendYield: dividend.dividendYield.researchValue,
        payoutRatio: dividend.payoutRatio.researchValue,
      },
    };
  }

  // ───────────────────────────────────────────
  // NO_DATA factories
  // ───────────────────────────────────────────

  private allNoDataFinancials(): {
    revenue: import('../types.js').ResearchValue<number>;
    ebitda: import('../types.js').ResearchValue<number>;
    netIncome: import('../types.js').ResearchValue<number>;
    freeCashFlow: import('../types.js').ResearchValue<number>;
    debt: import('../types.js').ResearchValue<number>;
    netDebt: import('../types.js').ResearchValue<number>;
    roe: import('../types.js').ResearchValue<number>;
    roic: import('../types.js').ResearchValue<number>;
    margin: import('../types.js').ResearchValue<number>;
  } {
    return {
      revenue: noData(),
      ebitda: noData(),
      netIncome: noData(),
      freeCashFlow: noData(),
      debt: noData(),
      netDebt: noData(),
      roe: noData(),
      roic: noData(),
      margin: noData(),
    };
  }

  private allNoDataValuation(): {
    pe: import('../types.js').ResearchValue<number>;
    evEbitda: import('../types.js').ResearchValue<number>;
    pb: import('../types.js').ResearchValue<number>;
    fcfYield: import('../types.js').ResearchValue<number>;
  } {
    return {
      pe: noData(),
      evEbitda: noData(),
      pb: noData(),
      fcfYield: noData(),
    };
  }

  private allNoDataEarningsTrend(): {
    revenueGrowth: import('../types.js').ResearchValue<number>;
    netIncomeGrowth: import('../types.js').ResearchValue<number>;
    guidance: import('../types.js').ResearchValue<string>;
  } {
    return {
      revenueGrowth: noData(),
      netIncomeGrowth: noData(),
      guidance: noData(),
    };
  }

  private allNoDataDividend(): {
    lastDividend: import('../types.js').ResearchValue<number>;
    dividendYield: import('../types.js').ResearchValue<number>;
    payoutRatio: import('../types.js').ResearchValue<number>;
  } {
    return {
      lastDividend: noData(),
      dividendYield: noData(),
      payoutRatio: noData(),
    };
  }
}
