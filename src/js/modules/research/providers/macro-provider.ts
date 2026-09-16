/**
 * MacroProvider — поставщик макроэкономических данных для research.
 *
 * Архитектура:
 *   CbrOfficialFetcher → keyRate + inflation (официальный CBR)
 *   MacroFetcher → курсы валют (CBR XML-Daily mirror)
 *   normalizeMacro() → MacroResearch → ResearchEvidence
 *
 * НЕ генерирует AI-рекомендации.
 * НЕ создаёт InvestmentThesis.
 * НЕ придумывает oil — это поле NO_DATA.
 * Если данных нет → NO_DATA + diagnostic.
 *
 * Derived fields (rateRegime, inflationTrend и т.д.) хранятся отдельно
 * с provenance/method, не маскируются под официальные факты.
 */

import type {
  ResearchProvider,
  ResearchAsset,
  ResearchContext,
} from './types.js';
import type {
  AssetResearchSnapshot,
  ResearchEvidence,
  MacroResearch,
  RateRegime,
  EconomicCyclePhase,
  LiquidityRegime,
  CommodityRegime,
} from '../types.js';
import { value, noData } from '../helpers.js';
import { MacroFetcher, type MacroFetchResult } from './macro-fetcher.js';
import {
  CbrOfficialFetcher,
  type CbrOfficialResult,
} from './cbr-official-fetcher.js';

// ──────────────────────────────────────────────
// Официальные URL Банка России
// ──────────────────────────────────────────────

/** Официальная страница ключевой ставки ЦБ РФ */
const CBR_OFFICIAL_KEYRATE_URL = 'https://www.cbr.ru/hd_base/KeyRate/';

/** Официальная страница инфляции ЦБ РФ */
const CBR_OFFICIAL_INFLATION_URL = 'https://www.cbr.ru/statistics/ddkp/infl/';

// ──────────────────────────────────────────────
// 1. Кэш на один запуск (глобальный для macro)
// ──────────────────────────────────────────────

/** Запись кэша macro */
interface MacroCacheEntry {
  result: MacroFetchResult;
  fetchedAt: string;
}

class MacroCache {
  private store: MacroCacheEntry | null = null;
  private readonly ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) { // 5 минут
    this.ttlMs = ttlMs;
  }

  get(): MacroFetchResult | null {
    if (!this.store) return null;

    const age = Date.now() - new Date(this.store.fetchedAt).getTime();
    if (age > this.ttlMs) {
      this.store = null;
      return null;
    }

    return this.store.result;
  }

  set(result: MacroFetchResult): void {
    this.store = {
      result,
      fetchedAt: new Date().toISOString(),
    };
  }

  clear(): void {
    this.store = null;
  }
}

// ──────────────────────────────────────────────
// 2. Provider
// ──────────────────────────────────────────────

export class MacroResearchProvider implements ResearchProvider {
  private readonly fetcher: MacroFetcher;
  private readonly officialFetcher: CbrOfficialFetcher;
  private readonly cache: MacroCache;

  constructor(
    fetcher?: MacroFetcher,
    cacheTtlMs?: number,
    officialFetcher?: CbrOfficialFetcher,
  ) {
    this.fetcher = fetcher ?? new MacroFetcher();
    this.officialFetcher = officialFetcher ?? new CbrOfficialFetcher();
    this.cache = new MacroCache(cacheTtlMs);
  }

  /** Поддерживает все типы активов */
  supports(asset: ResearchAsset): boolean {
    const knownTypes = ['STOCK', 'BOND', 'ETF', 'CASH', 'OTHER'];
    return knownTypes.includes(asset.assetType);
  }

  async research(
    asset: ResearchAsset,
    _context: ResearchContext,
  ): Promise<AssetResearchSnapshot> {
    const evidence: Record<string, ResearchEvidence> = {};
    const fetchedAt = new Date().toISOString();

    // Этап 1: fetchRaw (с глобальным кэшем)
    const rawResult = await this.fetchRaw();

    // Если ошибка источника — все NO_DATA
    if (!rawResult.success) {
      return {
        identity: this.buildIdentity(asset),
        macroResearch: this.allNoDataMacroResearch(),
        evidence,
      };
    }

    // Этап 1b: fetch official data (keyRate + inflation)
    const officialResult = await this.fetchOfficial();

    // Этап 2: normalize → MacroResearch
    const macroResearch = this.normalizeMacro(rawResult, officialResult, fetchedAt, evidence);

    return {
      identity: this.buildIdentity(asset),
      macroResearch,
      evidence,
    };
  }

  // ───────────────────────────────────────────
  // Этап 1: fetchRaw
  // ───────────────────────────────────────────

  private async fetchRaw(): Promise<MacroFetchResult> {
    // Проверка кэша
    const cached = this.cache.get();
    if (cached) return cached;

    // Запрос к источнику
    let result: MacroFetchResult;
    try {
      result = await this.fetcher.fetch();
    } catch {
      // Ошибка сети/парсинга → NO_DATA
      return {
        date: new Date().toISOString(),
        timestamp: new Date().toISOString(),
        sourceUrl: '',
        success: false,
        diagnostic: 'Fetcher error',
      };
    }

    // Сохранение в кэш
    this.cache.set(result);

    return result;
  }

  // ───────────────────────────────────────────
  // Этап 1b: fetchOfficial (keyRate + inflation)
  // ───────────────────────────────────────────

  private async fetchOfficial(): Promise<CbrOfficialResult> {
    try {
      return await this.officialFetcher.fetch();
    } catch {
      // Ошибка сети/парсинга → NO_DATA для обоих полей
      return {
        keyRate: null,
        keyRateDate: null,
        inflation: null,
        inflationDate: null,
        keyRateUrl: '',
        inflationUrl: '',
        success: false,
        diagnostic: 'Official CBR fetcher error',
      };
    }
  }

  // ───────────────────────────────────────────
  // Этап 2: normalize → MacroResearch
  // ───────────────────────────────────────────

  /**
    * Нормализует сырые данные ЦБ в MacroResearch.
    *
    * Поля из источника (CBR XML-Daily mirror):
    *   - fx (USD, EUR, CNY) — курсы валют
    *
    * Поля из официального CBR:
    *   - keyRate — ключевая ставка
    *   - inflation — инфляция г/г
    *
    * Поля NO_DATA (не доступны через API):
    *   - oil — нет публичного API
    *
    * Derived поля (heuristic, не официальные факты):
    *   - rateRegime — эвристика на основе keyRate
    *   - inflationTrend — эвристика на основе inflation
    *   - liquidityRegime — эвристика
    *   - economicCycle — эвристика
    *   - commodityRegime — эвристика на основе oil
    */
  private normalizeMacro(
    raw: MacroFetchResult,
    official: CbrOfficialResult,
    fetchedAt: string,
    evidence: Record<string, ResearchEvidence>,
  ): MacroResearch {
    // --- keyRate ---
    const keyRate = official.keyRate != null
      ? this.createKeyRateValue(official.keyRate, official, fetchedAt, evidence)
      : noData();

    // --- inflation ---
    const inflation = official.inflation != null
      ? this.createInflationValue(official.inflation, official, fetchedAt, evidence)
      : noData();

    // --- fx (USD) ---
    const fxUsd = raw.usdRate != null
      ? this.createFxValue(raw.usdRate, 'RUB/USD', raw, fetchedAt, evidence)
      : noData();

    // --- fx (EUR) — unused, kept for future use ---
    // const fxEur = raw.eurRate != null
    //   ? this.createFxValue(raw.eurRate, 'RUB/EUR', raw, fetchedAt, evidence)
    //   : noData();

    // --- fx (CNY) — unused, kept for future use ---
    // const fxCny = raw.cnyRate != null
    //   ? this.createFxValue(raw.cnyRate, 'RUB/CNY', raw, fetchedAt, evidence)
    //   : noData();

    // --- oil ---
    const oil = noData();

    // --- Derived fields ---
    const rateRegime = this.createDerivedRateRegime(raw, official, fetchedAt, evidence);
    const inflationTrend = this.createDerivedInflationTrend(raw, official, fetchedAt, evidence);
    const liquidityRegime = this.createDerivedLiquidityRegime(raw, official, fetchedAt, evidence);
    const economicCycle = this.createDerivedEconomicCycle(raw, official, fetchedAt, evidence);
    const commodityRegime = this.createDerivedCommodityRegime(raw, official, fetchedAt, evidence);

    return {
      keyRate,
      inflation,
      inflationTrend,
      fx: fxUsd, // Основной — USD
      oil,
      commodityRegime,
      liquidityRegime,
      economicCycle,
      rateRegime,
    };
  }

  // ───────────────────────────────────────────
  // FX Value factory
  // ───────────────────────────────────────────

  private createFxValue(
    rate: number,
    unit: string,
    raw: MacroFetchResult,
    fetchedAt: string,
    evidence: Record<string, ResearchEvidence>,
  ): import('../types.js').ResearchValue<number> {
    const id = `macro-fx-${unit.toLowerCase().replace('/', '-')}-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

    evidence[id] = {
      id,
      type: 'MACRO' as const,
      source: 'CBR XML-Daily mirror',
      url: raw.sourceUrl,
      publishedAt: raw.date || fetchedAt,
      retrievedAt: fetchedAt,
      claim: `${unit} = ${rate} (CBR XML-Daily mirror, ${raw.date})`,
      confidence: 1.0,
    };

    return value(rate, {
      unit,
      evidenceIds: [id],
    });
  }

  // ───────────────────────────────────────────
  // KeyRate Value factory (официальный CBR)
  // ───────────────────────────────────────────

  private createKeyRateValue(
    rate: number,
    official: CbrOfficialResult,
    fetchedAt: string,
    evidence: Record<string, ResearchEvidence>,
  ): import('../types.js').ResearchValue<number> {
    const id = `macro-keyrate-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

    evidence[id] = {
      id,
      type: 'MACRO' as const,
      source: 'Bank of Russia',
      url: CBR_OFFICIAL_KEYRATE_URL,
      publishedAt: official.keyRateDate || fetchedAt,
      retrievedAt: fetchedAt,
      claim: `Bank of Russia key rate: ${rate.toFixed(2)}%`,
      confidence: 1.0,
    };

    return value(rate, {
      unit: '%',
      evidenceIds: [id],
    });
  }

  // ───────────────────────────────────────────
  // Inflation Value factory (официальный CBR)
  // ───────────────────────────────────────────

  private createInflationValue(
    rate: number,
    official: CbrOfficialResult,
    fetchedAt: string,
    evidence: Record<string, ResearchEvidence>,
  ): import('../types.js').ResearchValue<number> {
    const id = `macro-inflation-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

    evidence[id] = {
      id,
      type: 'MACRO' as const,
      source: 'Bank of Russia',
      url: CBR_OFFICIAL_INFLATION_URL,
      publishedAt: official.inflationDate || fetchedAt,
      retrievedAt: fetchedAt,
      claim: `Bank of Russia inflation: ${rate.toFixed(2)}% y/y`,
      confidence: 1.0,
    };

    return value(rate, {
      unit: '%',
      evidenceIds: [id],
    });
  }

  // ───────────────────────────────────────────
  // Derived fields (heuristic, not official facts)
  // ───────────────────────────────────────────

  /**
   * rateRegime — derived from keyRate.
   *
   * Provenance: heuristic based on keyRate level.
   * NOT an official CBR fact.
   */
  private createDerivedRateRegime(
    raw: MacroFetchResult,
    official: CbrOfficialResult,
    fetchedAt: string,
    evidence: Record<string, ResearchEvidence>,
  ): import('../types.js').ResearchValue<RateRegime> {
    // keyRate available → can derive
    if (official.keyRate != null) {
      const id = `macro-derived-rate-regime-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

      // Простая эвристика: если keyRate >= 15% → TIGHTENING, иначе HOLDING
      const regime = official.keyRate >= 15 ? 'TIGHTENING' as const : 'HOLDING' as const;

      evidence[id] = {
        id,
        type: 'MACRO' as const,
        source: 'heuristic (keyRate from Bank of Russia)',
        url: CBR_OFFICIAL_KEYRATE_URL,
        publishedAt: official.keyRateDate || fetchedAt,
        retrievedAt: fetchedAt,
        claim: `rateRegime = ${regime} (keyRate = ${official.keyRate}%, heuristic)`,
        confidence: 0.5,
      };

      return value(regime, {
        evidenceIds: [id],
      });
    }

    // keyRate NO_DATA → rateRegime NO_DATA
    const id = `macro-derived-rate-regime-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

    evidence[id] = {
      id,
      type: 'MACRO' as const,
      source: 'heuristic (keyRate NO_DATA)',
      url: raw.sourceUrl,
      publishedAt: raw.date || fetchedAt,
      retrievedAt: fetchedAt,
      claim: 'rateRegime = NO_DATA (keyRate not available from Bank of Russia)',
      confidence: 0.0,
    };

    return noData();
  }

  /**
   * inflationTrend — derived from inflation.
   *
   * Provenance: heuristic based on inflation data.
   * NOT an official CBR fact.
   */
  private createDerivedInflationTrend(
    raw: MacroFetchResult,
    official: CbrOfficialResult,
    fetchedAt: string,
    evidence: Record<string, ResearchEvidence>,
  ): import('../types.js').ResearchValue<string> {
    // inflation available → can derive
    if (official.inflation != null) {
      const id = `macro-derived-inflation-trend-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

      // Простая эвристика: если inflation > 5% → Rising, иначе Stable
      const trend = official.inflation > 5 ? 'Умеренный рост' : 'Стабильный';

      evidence[id] = {
        id,
        type: 'MACRO' as const,
        source: 'heuristic (inflation from Bank of Russia)',
        url: CBR_OFFICIAL_INFLATION_URL,
        publishedAt: official.inflationDate || fetchedAt,
        retrievedAt: fetchedAt,
        claim: `inflationTrend = ${trend} (inflation = ${official.inflation}%, heuristic)`,
        confidence: 0.5,
      };

      return value(trend, {
        evidenceIds: [id],
      });
    }

    // inflation NO_DATA → inflationTrend NO_DATA
    const id = `macro-derived-inflation-trend-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

    evidence[id] = {
      id,
      type: 'MACRO' as const,
      source: 'heuristic (inflation NO_DATA)',
      url: raw.sourceUrl,
      publishedAt: raw.date || fetchedAt,
      retrievedAt: fetchedAt,
      claim: 'inflationTrend = NO_DATA (inflation not available from Bank of Russia)',
      confidence: 0.0,
    };

    return noData();
  }

  /**
   * liquidityRegime — derived from multiple factors.
   *
   * Provenance: heuristic.
   * NOT an official CBR fact.
   */
  private createDerivedLiquidityRegime(
    raw: MacroFetchResult,
    official: CbrOfficialResult,
    fetchedAt: string,
    evidence: Record<string, ResearchEvidence>,
  ): import('../types.js').ResearchValue<LiquidityRegime> {
    // liquidityRegime требует keyRate + inflation + FX
    const hasKeyRate = official.keyRate != null;
    const hasInflation = official.inflation != null;
    const hasFx = raw.usdRate != null;

    if (hasKeyRate && hasInflation && hasFx) {
      const id = `macro-derived-liquidity-regime-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;
      const regime = 'NORMAL' as const;

      evidence[id] = {
        id,
        type: 'MACRO' as const,
        source: 'heuristic (keyRate + inflation + FX)',
        url: CBR_OFFICIAL_KEYRATE_URL,
        publishedAt: official.keyRateDate || fetchedAt,
        retrievedAt: fetchedAt,
        claim: `liquidityRegime = ${regime} (heuristic, keyRate=${official.keyRate}%, inflation=${official.inflation}%)`,
        confidence: 0.4,
      };

      return value(regime, {
        evidenceIds: [id],
      });
    }

    const id = `macro-derived-liquidity-regime-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

    evidence[id] = {
      id,
      type: 'MACRO' as const,
      source: 'heuristic (insufficient data)',
      url: raw.sourceUrl,
      publishedAt: raw.date || fetchedAt,
      retrievedAt: fetchedAt,
      claim: 'liquidityRegime = NO_DATA (requires keyRate + inflation + FX data)',
      confidence: 0.0,
    };

    return noData();
  }

  /**
   * economicCycle — derived from multiple factors.
   *
   * Provenance: heuristic.
   * NOT an official CBR fact.
   */
  private createDerivedEconomicCycle(
    raw: MacroFetchResult,
    official: CbrOfficialResult,
    fetchedAt: string,
    evidence: Record<string, ResearchEvidence>,
  ): import('../types.js').ResearchValue<EconomicCyclePhase> {
    // economicCycle требует GDP + employment + inflation
    // У нас только inflation → insufficient data
    const hasInflation = official.inflation != null;

    if (hasInflation && official.inflation != null) {
      const id = `macro-derived-economic-cycle-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;
      // Очень грубая эвристика
      const phase = official.inflation > 6 ? 'PEAK' as const : 'EXPANSION' as const;

      evidence[id] = {
        id,
        type: 'MACRO' as const,
        source: 'heuristic (inflation only)',
        url: CBR_OFFICIAL_INFLATION_URL,
        publishedAt: official.inflationDate || fetchedAt,
        retrievedAt: fetchedAt,
        claim: `economicCycle = ${phase} (heuristic, inflation=${official.inflation}%, insufficient GDP data)`,
        confidence: 0.3,
      };

      return value(phase, {
        evidenceIds: [id],
      });
    }

    const id = `macro-derived-economic-cycle-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

    evidence[id] = {
      id,
      type: 'MACRO' as const,
      source: 'heuristic (insufficient data)',
      url: raw.sourceUrl,
      publishedAt: raw.date || fetchedAt,
      retrievedAt: fetchedAt,
      claim: 'economicCycle = NO_DATA (requires GDP + employment + inflation data)',
      confidence: 0.0,
    };

    return noData();
  }

  /**
   * commodityRegime — derived from oil price.
   *
   * Provenance: heuristic.
   * NOT an official CBR fact.
   */
  private createDerivedCommodityRegime(
    raw: MacroFetchResult,
    _official: CbrOfficialResult,
    fetchedAt: string,
    evidence: Record<string, ResearchEvidence>,
  ): import('../types.js').ResearchValue<CommodityRegime> {
    // oil is NO_DATA → cannot derive
    const id = `macro-derived-commodity-regime-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

    evidence[id] = {
      id,
      type: 'MACRO' as const,
      source: 'heuristic (oil NO_DATA)',
      url: raw.sourceUrl,
      publishedAt: raw.date || fetchedAt,
      retrievedAt: fetchedAt,
      claim: 'commodityRegime = NO_DATA (oil price not available from any source)',
      confidence: 0.0,
    };

    return noData();
  }

  // ───────────────────────────────────────────
  // NO_DATA factory
  // ───────────────────────────────────────────

  private allNoDataMacroResearch(): MacroResearch {
    return {
      keyRate: noData(),
      inflation: noData(),
      inflationTrend: noData(),
      fx: noData(),
      oil: noData(),
      commodityRegime: noData(),
      liquidityRegime: noData(),
      economicCycle: noData(),
      rateRegime: noData(),
    };
  }

  // ───────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────

  private buildIdentity(asset: ResearchAsset): AssetResearchSnapshot['identity'] {
    return {
      ticker: asset.ticker,
      name: asset.name,
      assetType: asset.assetType as 'STOCK' | 'BOND' | 'ETF' | 'CASH' | 'OTHER',
      issuer: asset.issuer ?? '',
      currency: asset.currency ?? 'RUB',
      market: asset.market ?? 'MOEX',
    };
  }
}
