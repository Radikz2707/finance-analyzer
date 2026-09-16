/**
 * Research Data Layer — универсальный контракт для структурированных данных
 * об эмитенте, рынке, макроэкономике, новостях и рисках.
 *
 * Ключевой принцип: LLM НЕ является источником фактов.
 * Все факты поступают в ResearchData через providers.
 * LLM только интерпретирует ResearchData.
 */

// ──────────────────────────────────────────────
// 1. Базовая семантика данных
// ──────────────────────────────────────────────

/**
 * Единый статус для всех показателей Research Data.
 *
 * НЕ использовать:
 *   - undefined как смысловой бизнес-статус
 *   - "примерно", "unknown", "-", 0 для отсутствующих данных
 */
export type DataStatus = 'VALUE' | 'NO_DATA' | 'NOT_APPLICABLE';

/**
 * Универсальный тип для показателя с provenance.
 *
 * VALUE — измеренное/полученное значение с метаданными
 * NO_DATA — данные не получены (ожидается поставщик)
 * NOT_APPLICABLE — показатель не применим к этому активу
 */
export type ResearchValue<T> =
  | {
      status: 'VALUE';
      value: T;
      unit?: string;
      evidenceIds: string[];
    }
  | {
      status: Exclude<DataStatus, 'VALUE'>;
      value?: never;
      unit?: never;
      evidenceIds?: never;
    };

/** Результат применения ResearchValue к конкретному типу */
export type NoDataValue = { status: 'NO_DATA' | 'NOT_APPLICABLE' };

/** Утилитарный тип: извлекает T из ResearchValue<T> или never если NO_DATA */
export type ResearchValuePayload<T> =
  T extends ResearchValue<infer V> ? V : never;

// ──────────────────────────────────────────────
// 2. AssetIdentity
// ──────────────────────────────────────────────

export type AssetType = 'STOCK' | 'BOND' | 'ETF' | 'CASH' | 'OTHER';

export interface AssetIdentity {
  /** Тикер актива (например, 'SBER') */
  ticker: string;
  /** Полное наименование */
  name: string;
  /** Тип актива */
  assetType: AssetType;
  /** Эмитент (например, 'ПАО Сбербанк') */
  issuer: string;
  /** Валютина расчётов (например, 'RUB') */
  currency: string;
  /** Рынок / биржа (например, 'MOEX') */
  market: string;
}

// ──────────────────────────────────────────────
// 3. IssuerResearch
// ──────────────────────────────────────────────

/** Финансовые показатели эмитента */
export interface IssuerFinancials {
  revenue: ResearchValue<number>;
  ebitda: ResearchValue<number>;
  netIncome: ResearchValue<number>;
  freeCashFlow: ResearchValue<number>;
  debt: ResearchValue<number>;
  netDebt: ResearchValue<number>;
  roe: ResearchValue<number>;
  roic: ResearchValue<number>;
  margin: ResearchValue<number>;
}

/** Мультипликаторы оценки */
export interface IssuerValuation {
  pe: ResearchValue<number>;
  evEbitda: ResearchValue<number>;
  pb: ResearchValue<number>;
  fcfYield: ResearchValue<number>;
}

/** Тренд прибыльности и guidance */
export interface IssuerEarningsTrend {
  /** Прогноз роста выручки (проценты) */
  revenueGrowth: ResearchValue<number>;
  /** Прогноз роста чистой прибыли (проценты) */
  netIncomeGrowth: ResearchValue<number>;
  guidance: ResearchValue<string>;
}

/** Дивидендная политика */
export interface IssuerDividend {
  lastDividend: ResearchValue<number>;
  dividendYield: ResearchValue<number>;
  payoutRatio: ResearchValue<number>;
}

/** Полное исследование эмитента */
export interface IssuerResearch {
  businessDescription: ResearchValue<string>;
  sector: ResearchValue<string>;
  industry: ResearchValue<string>;
  financials: IssuerFinancials;
  valuation: IssuerValuation;
  earningsTrend: IssuerEarningsTrend;
  guidance: ResearchValue<string>;
  dividend: IssuerDividend;
}

// ──────────────────────────────────────────────
// 4. BondResearch
// ──────────────────────────────────────────────

export type CouponFrequency = 'ANNUAL' | 'SEMI_ANNUAL' | 'QUARTERLY' | 'OTHER';

export interface BondResearch {
  issuer: ResearchValue<string>;
  nominal: ResearchValue<number>;
  couponRate: ResearchValue<number>;
  couponFrequency: ResearchValue<CouponFrequency>;
  maturityDate: ResearchValue<string>;
  yieldToMaturity: ResearchValue<number>;
  duration: ResearchValue<number>;
  creditRating: ResearchValue<string>;
  creditSpread: ResearchValue<number>;
  amortization: ResearchValue<number>;
  callable: ResearchValue<boolean>;
}

// ──────────────────────────────────────────────
// 5. ETFResearch
// ──────────────────────────────────────────────

export interface ETFResearch {
  benchmark: ResearchValue<string>;
  description: ResearchValue<string>;
  aum: ResearchValue<number>;
  expenseRatio: ResearchValue<number>;
  trackingError: ResearchValue<number>;
  holdings: ResearchValue<string[]>;
  sectorExposure: ResearchValue<Record<string, number>>;
  currencyExposure: ResearchValue<Record<string, number>>;
  dividendPolicy: ResearchValue<string>;
}

// ──────────────────────────────────────────────
// 6. MarketResearch
// ──────────────────────────────────────────────

export type MarketRegime = 'BULL' | 'BEAR' | 'SIDEWAYS' | 'UNKNOWN';

export interface MarketResearch {
  currentPrice: ResearchValue<number>;
  priceChange1D: ResearchValue<number>;
  priceChange1W: ResearchValue<number>;
  priceChange1M: ResearchValue<number>;
  priceChangeYTD: ResearchValue<number>;
  volatility: ResearchValue<number>;
  volume: ResearchValue<number>;
  liquidity: ResearchValue<string>;
  marketRegime: ResearchValue<MarketRegime>;
}

// ──────────────────────────────────────────────
// 7. MacroResearch
// ──────────────────────────────────────────────

export type EconomicCyclePhase = 'EXPANSION' | 'PEAK' | 'RECESSION' | 'TRough';
export type RateRegime = 'EASING' | 'HOLDING' | 'TIGHTENING' | 'UNKNOWN';
export type CommodityRegime = 'BULL' | 'BEAR' | 'SIDEWAYS' | 'UNKNOWN';
export type LiquidityRegime = 'ABUNDANT' | 'NORMAL' | 'TIGHT' | 'CRISIS';

export interface MacroResearch {
  keyRate: ResearchValue<number>;
  inflation: ResearchValue<number>;
  inflationTrend: ResearchValue<string>;
  fx: ResearchValue<number>;
  oil: ResearchValue<number>;
  commodityRegime: ResearchValue<CommodityRegime>;
  liquidityRegime: ResearchValue<LiquidityRegime>;
  economicCycle: ResearchValue<EconomicCyclePhase>;
  rateRegime: ResearchValue<RateRegime>;
}

// ──────────────────────────────────────────────
// 8. NewsResearch
// ──────────────────────────────────────────────

export type NewsImportance = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type NewsSentiment = 'NEGATIVE' | 'NEUTRAL' | 'POSITIVE' | 'UNKNOWN';

export interface NewsItem {
  title: string;
  date: string; // ISO 8601
  source: string;
  url: string;
  importance: NewsImportance;
  sentiment: NewsSentiment;
  summary: string;
  relevanceToIssuer: number; // 0..1
}

export interface NewsResearch {
  items: NewsItem[];
}

// ──────────────────────────────────────────────
// 9. RiskAssessment
// ──────────────────────────────────────────────

export type RiskType =
  | 'MARKET'
  | 'CREDIT'
  | 'LIQUIDITY'
  | 'OPERATIONAL'
  | 'REGULATORY'
  | 'GEOPOLITICAL'
  | 'CURRENCY'
  | 'CONCENTRATION'
  | 'OTHER';

export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskItem {
  type: RiskType;
  severity: SeverityLevel;
  description: string;
  evidenceRefs: string[];
}

export interface CatalystItem {
  description: string;
  timeline: ResearchValue<string>;
  evidenceRefs: string[];
}

export interface RiskAssessment {
  risks: RiskItem[];
  catalysts: CatalystItem[];
}

// ──────────────────────────────────────────────
// 10. InvestmentThesis
// ──────────────────────────────────────────────

export interface InvestmentThesis {
  thesis: string;
  bullCase: string;
  baseCase: string;
  bearCase: string;
  keyDrivers: string[];
  keyRisks: string[];
  keyCatalysts: string[];
  valuationView: string;
  macroSensitivity: string;
  confidence: number; // 0..1
}

// ──────────────────────────────────────────────
// 11. AIRecommendation
// ──────────────────────────────────────────────

export type AiAction = 'BUY' | 'SELL' | 'HOLD' | 'REDUCE' | 'AVOID';

export type PortfolioMathStatus =
  | 'HOLD'
  | 'BUY'
  | 'STABLE'
  | 'REDUCE'
  | 'NEW'
  | 'EXIT'
  | 'NO_TARGET';

export type MathAgreement = 'AGREE' | 'DISAGREE' | 'UNCERTAIN';

export interface AIRecommendation {
  userTargetPercent: number;
  portfolioMathStatus: PortfolioMathStatus;

  aiRecommendedTargetPercent: ResearchValue<number>;
  aiRecommendedAction: ResearchValue<AiAction>;
  confidence: ResearchValue<number>;

  rationale: string;
  targetReason: string;
  keyRisks: string[];
  keyCatalysts: string[];

  agreementWithPortfolioMath: MathAgreement;
}

// ──────────────────────────────────────────────
// 12. ResearchEvidence
// ──────────────────────────────────────────────

export type EvidenceType =
  | 'COMPANY'
  | 'FINANCIAL'
  | 'VALUATION'
  | 'MARKET'
  | 'MACRO'
  | 'NEWS'
  | 'REGULATORY'
  | 'GEOPOLITICAL'
  | 'OTHER';

export interface ResearchEvidence {
  /** Уникальный идентификатор доказательства */
  id: string;
  /** Тип доказательства */
  type: EvidenceType;
  /** Источник (например, 'Moscow Exchange', 'CBR', 'Company Report') */
  source: string;
  /** URL источника */
  url: string;
  /** Дата публикации источника */
  publishedAt: string;
  /** Дата получения доказательства системой */
  retrievedAt: string;
  /** Фактическое утверждение/значение */
  claim: string;
  /** Уверенность в достоверности (0..1) */
  confidence: number;
}

// ──────────────────────────────────────────────
// 13. AssetResearchSnapshot
// ──────────────────────────────────────────────

/**
 * Полный снимок исследования актива.
 * Объединяет все аспекты: от идентификации до рекомендаций ИИ.
 */
export interface AssetResearchSnapshot {
  identity: AssetIdentity;
  issuerResearch?: IssuerResearch;
  bondResearch?: BondResearch;
  etfResearch?: ETFResearch;
  marketResearch?: MarketResearch;
  macroResearch?: MacroResearch;
  newsResearch?: NewsResearch;
  riskAssessment?: RiskAssessment;
  investmentThesis?: InvestmentThesis;
  aiRecommendation?: AIRecommendation;
  evidence: Record<string, ResearchEvidence>;
}
