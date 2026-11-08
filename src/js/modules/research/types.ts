/**
 * Research types — общие типы для research-модулей.
 */

/** Тип актива */
export type AssetType = 'STOCK' | 'BOND' | 'ETF' | 'CASH' | 'OTHER';

/** Идентификатор актива */
export interface AssetIdentity {
  ticker: string;
  name?: string;
  type: AssetType;
  isin?: string;
  assetType?: string;
  issuer?: string;
  currency?: string;
  market?: string;
}

/** Рыночные данные */
export interface MarketResearch {
  currentPrice: ResearchValue<number>;
  priceChange1D: ResearchValue<number>;
  priceChange1W: ResearchValue<number>;
  priceChange1M: ResearchValue<number>;
  priceChangeYTD: ResearchValue<number>;
  volatility: ResearchValue<number>;
  volume: ResearchValue<number>;
  liquidity: ResearchValue<string>;
  marketRegime: ResearchValue<string>;
}

/** Эмиссионные данные */
export interface IssuerResearch {
  businessDescription: ResearchValue<string>;
  sector: ResearchValue<string>;
  industry: ResearchValue<string>;
  financials: {
    revenue: ResearchValue<number>;
    ebitda: ResearchValue<number>;
    netIncome: ResearchValue<number>;
    freeCashFlow: ResearchValue<number>;
    debt: ResearchValue<number>;
    netDebt: ResearchValue<number>;
    roe: ResearchValue<number>;
    roic: ResearchValue<number>;
    margin: ResearchValue<number>;
  };
  valuation: {
    pe: ResearchValue<number>;
    evEbitda: ResearchValue<number>;
    pb: ResearchValue<number>;
    fcfYield: ResearchValue<number>;
  };
  earningsTrend: {
    revenueGrowth: ResearchValue<number>;
    netIncomeGrowth: ResearchValue<number>;
    guidance: ResearchValue<string>;
  };
  guidance: ResearchValue<string>;
  dividend: {
    lastDividend: ResearchValue<number>;
    dividendYield: ResearchValue<number>;
    payoutRatio: ResearchValue<number>;
  };
}

/** Исследование новостей */
export interface NewsResearch {
  title: string;
  date: string;
  source: string;
  url: string;
  importance: 'HIGH' | 'MEDIUM' | 'LOW';
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  summary: string;
  relevanceToIssuer: number;
}

/** Макроэкономические данные */
export interface MacroResearch {
  keyRate: ResearchValue<number>;
  inflation: ResearchValue<number>;
  inflationTrend: ResearchValue<string>;
  fx: ResearchValue<number>;
  oil: ResearchValue<number>;
  commodityRegime: ResearchValue<string>;
  liquidityRegime: ResearchValue<string>;
  economicCycle: ResearchValue<string>;
  rateRegime: ResearchValue<string>;
}

/** Значение с подтверждением */
export interface ResearchValue<T = unknown> {
  status: 'VALUE' | 'NO_DATA' | 'ERROR' | 'NOT_APPLICABLE';
  value?: T;
  confidence?: number;
  source?: string;
  evidenceIds?: string[];
}

/** Исследовательское доказательство */
export interface ResearchEvidence {
  id: string;
  type: string;
  source: string;
  url: string;
  publishedAt: string;
  retrievedAt: string;
  claim: string;
  confidence: number;
}

/** Исследование одного актива */
export interface AssetResearchSnapshot {
  identity: AssetIdentity;
  marketResearch: MarketResearch | null;
  issuerResearch: IssuerResearch | null;
  fundamentals: ResearchValue[];
  newsResearch: NewsResearch[];
  macroResearch: MacroResearch | null;
  aiRecommendation?: AIRecommendation | null;
  evidence?: ResearchEvidence[];
  investmentThesis?: string;
  // Legacy compatibility
  market?: MarketResearch | null;
  issuer?: IssuerResearch | null;
  news?: NewsResearch[];
  macro?: MacroResearch | null;
}

/** Рекомендация AI */
export interface AIRecommendation {
  ticker: string;
  aiRecommendedAction: { value: AiAction };
  reasoning?: string;
}

/** Действие AI — расширенный набор */
export type AiAction =
  | 'BUY'
  | 'SELL'
  | 'HOLD'
  | 'REDUCE'
  | 'EXIT'
  | 'AVOID'
  | 'AVERAGE'
  | 'NEW'
  | 'NO_TARGET'
  | 'STABLE';

/** Согласие математики и AI */
export type MathAgreement =
  | 'AGREE'
  | 'DISAGREE'
  | 'UNCERTAIN'
  | 'INSUFFICIENT_DATA'
  | 'agrees'
  | 'disagrees'
  | 'no-opinion';

/** Состояние PortfolioMath */
export type PortfolioMathStatus =
  | 'balanced'
  | 'overweight'
  | 'underweight'
  | 'empty'
  | 'BUY'
  | 'SELL'
  | 'HOLD'
  | 'STABLE'
  | 'REDUCE'
  | 'NEW'
  | 'EXIT'
  | 'NO_TARGET'
  | 'AVOID'
  | 'AVERAGE';

/** Проверка наличия значения */
export function hasValue<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/** Актив для исследования */
export interface ResearchAsset {
  ticker: string;
  name?: string;
  type: AssetType;
  assetType?: string;
  issuer?: string;
  currency?: string;
  market?: string;
}

/** Контекст исследования */
export interface ResearchContext {
  totalPortfolioValue: number;
  currentPrices?: Map<string, number>;
  researchTimestamp?: string;
  marketQuotes?: Map<string, number>;
}

/** Контекст актива для инвестиционного тезиса */
export interface PortfolioAssetContext {
  currentPercent: number;
  targetPercent: number;
  portfolioMathStatus: string;
  currentPriceRub: number;
  balancePrice: number;
  quantity: number;
  unrealizedProfitRub: number;
  totalPortfolioValue: number;
}

/** Результат инвестиционного тезиса */
export interface InvestmentThesisResult {
  ticker: string;
  thesis: string;
  confidence: number;
  factors: string[];
  bullCase?: string;
  baseCase?: string;
  bearCase?: string;
  assetType?: string;
  keyDrivers?: string[];
  keyRisks?: string[];
  keyCatalysts?: string[];
  valuationView?: string;
  macroSensitivity?: string;
  evidenceReferences?: string[];
}

/** Движок инвестиционного тезиса (stub) */
export class InvestmentThesisEngine {
  analyze(
    _asset: ResearchAsset,
    _context: ResearchContext,
  ): Promise<InvestmentThesisResult> {
    return Promise.resolve({ ticker: '', thesis: '', confidence: 0, factors: [] });
  }

  generate(
    _asset: ResearchAsset,
    _context: ResearchContext,
  ): Promise<InvestmentThesisResult> {
    return Promise.resolve({ ticker: '', thesis: '', confidence: 0, factors: [] });
  }

  /** Generate from snapshot and portfolio context (legacy API) */
  generateFromSnapshot(
    _params: { snapshot: AssetResearchSnapshot; portfolioContext: PortfolioAssetContext },
  ): InvestmentThesisResult {
    return {
      ticker: _params.snapshot.identity.ticker || '',
      thesis: 'Generated thesis',
      bullCase: 'Bull case',
      baseCase: 'Base case',
      bearCase: 'Bear case',
      assetType: _params.snapshot.identity.assetType || '',
      keyDrivers: [],
      keyRisks: [],
      keyCatalysts: [],
      valuationView: 'Fair value',
      macroSensitivity: 'Medium',
      confidence: 0.7,
      evidenceReferences: [],
      factors: [],
    };
  }

  static async analyzeStatic(
    _asset: ResearchAsset,
    _context: ResearchContext,
  ): Promise<InvestmentThesisResult> {
    return { ticker: '', thesis: '', confidence: 0, factors: [] };
  }

  static async generateStatic(
    _asset: ResearchAsset,
    _context: ResearchContext,
  ): Promise<InvestmentThesisResult> {
    return { ticker: '', thesis: '', confidence: 0, factors: [] };
  }
}

/** Результат провайдера (stub) */
export interface FetchResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Провайдер исследований (stub) */
export abstract class ResearchProvider {
  abstract name: string;
  abstract research(
    _asset: ResearchAsset,
    _context: ResearchContext,
  ): Promise<AssetResearchSnapshot>;
}

/** Registry провайдеров (stub) */
export class ResearchProviderRegistry {
  private static providers: Array<{ name: string; research: unknown }> = [];

  static register(_name: string, _researchFn: unknown): void {
    this.providers.push({ name: _name, research: _researchFn });
  }

  static async researchAll(
    _asset: ResearchAsset,
    _context: ResearchContext,
  ): Promise<AssetResearchSnapshot> {
    return {
      identity: { ticker: '', type: 'OTHER' },
      marketResearch: null,
      issuerResearch: null,
      fundamentals: [],
      newsResearch: [],
      macroResearch: null,
    };
  }

  static getConflicts(_snapshots: AssetResearchSnapshot[]): Array<{
    providerA: string;
    providerB: string;
    field: string;
    valueA: unknown;
    valueB: unknown;
  }> {
    return [];
  }
}

/** Сводка для уведомлений */
export interface NotificationSummary {
  ticker: string;
  action: AiAction;
  reasoning: string;
  currentPrice: number;
  targetPrice?: number;
}

/** Метод с обработкой ошибок провайдера (stub) */
export async function withProviderFallback<T>(
  _primary: { name: string; fetch: () => Promise<T> },
  _fallbacks: Array<{ name: string; fetch: () => Promise<T> }>,
): Promise<{ value: T; source: string; attempts: number }> {
  try {
    const value = await _primary.fetch();
    return { value, source: _primary.name, attempts: 1 };
  } catch {
    for (const fb of _fallbacks) {
      try {
        const value = await fb.fetch();
        return { value, source: fb.name, attempts: _fallbacks.indexOf(fb) + 2 };
      } catch {
        // try next fallback
      }
    }
  }
  throw new Error('All providers failed');
}

/** Фетчер макроданных (stub) */
export abstract class MacroFetcher {
  abstract fetch(): Promise<MacroResearch>;
}
export class CbrOfficialFetcher extends MacroFetcher {
  async fetch(): Promise<MacroResearch> {
    return {
      keyRate: { status: 'VALUE', value: 0 },
      inflation: { status: 'NO_DATA' },
      inflationTrend: { status: 'NO_DATA' },
      fx: { status: 'NO_DATA' },
      oil: { status: 'NO_DATA' },
      commodityRegime: { status: 'NO_DATA' },
      liquidityRegime: { status: 'NO_DATA' },
      economicCycle: { status: 'NO_DATA' },
      rateRegime: { status: 'NO_DATA' },
    };
  }
}
export class MarketDataProvider extends MacroFetcher {
  async fetch(): Promise<MacroResearch> {
    return {
      keyRate: { status: 'NO_DATA' },
      inflation: { status: 'NO_DATA' },
      inflationTrend: { status: 'NO_DATA' },
      fx: { status: 'NO_DATA' },
      oil: { status: 'NO_DATA' },
      commodityRegime: { status: 'NO_DATA' },
      liquidityRegime: { status: 'NO_DATA' },
      economicCycle: { status: 'NO_DATA' },
      rateRegime: { status: 'NO_DATA' },
    };
  }
}

/** Фетчер новостей (stub) */
export abstract class NewsFetcher {
  abstract fetch(): Promise<NewsResearch[]>;
}
export class NewsResearchProvider extends NewsFetcher {
  async fetch(): Promise<NewsResearch[]> {
    return [];
  }
}

/** Провайдер макро (stub) */
export abstract class MacroResearchProvider extends ResearchProvider {
  name = 'macro';
}
export class MacroResearchProviderImpl extends MacroResearchProvider {
  async research(
    _asset: ResearchAsset,
    _context: ResearchContext,
  ): Promise<AssetResearchSnapshot> {
    return {
      identity: { ticker: '', type: 'OTHER' },
      marketResearch: null,
      issuerResearch: null,
      fundamentals: [],
      newsResearch: [],
      macroResearch: null,
    };
  }
}

/** Провайдер новостей (stub) */
export class NewsResearchProviderImpl extends ResearchProvider {
  name = 'news';
  async research(
    _asset: ResearchAsset,
    _context: ResearchContext,
  ): Promise<AssetResearchSnapshot> {
    return {
      identity: { ticker: '', type: 'OTHER' },
      marketResearch: null,
      issuerResearch: null,
      fundamentals: [],
      newsResearch: [],
      macroResearch: null,
    };
  }
}

/** Хелперы исследования (stub) */
export function hasValueWithEvidence(_snapshot: AssetResearchSnapshot): boolean {
  return _snapshot.fundamentals.length > 0;
}
