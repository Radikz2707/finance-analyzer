/**
 * Research Data Layer — barrel export.
 *
 * Все публичные типы и утилиты экспортируются отсюда.
 * Внешний код импортирует только из этого файла.
 */

// ── Типы ──────────────────────────────────────
export type {
  DataStatus,
  ResearchValue,
  NoDataValue,
  ResearchValuePayload,
  AssetType,
  AssetIdentity,
  IssuerFinancials,
  IssuerValuation,
  IssuerEarningsTrend,
  IssuerDividend,
  IssuerResearch,
  CouponFrequency,
  BondResearch,
  ETFResearch,
  MarketRegime,
  MarketResearch,
  EconomicCyclePhase,
  RateRegime,
  CommodityRegime,
  LiquidityRegime,
  MacroResearch,
  NewsImportance,
  NewsSentiment,
  NewsItem,
  NewsResearch,
  RiskType,
  SeverityLevel,
  RiskItem,
  CatalystItem,
  RiskAssessment,
  InvestmentThesis,
  AiAction,
  PortfolioMathStatus,
  MathAgreement,
  AIRecommendation,
  EvidenceType,
  ResearchEvidence,
  AssetResearchSnapshot,
} from './types.js';

// ── Investment Thesis Engine ──────────────────
export { InvestmentThesisEngine } from './investment-thesis/investment-thesis-engine.js';
export type {
  InvestmentThesisInput,
  InvestmentThesisResult,
  ValuationView,
  MacroSensitivity,
  ThesisConfidence,
  EvidenceReference,
  PortfolioAssetContext,
  ValuationDataSource,
  MacroSensitivitySource,
  ThesisConfidenceLevel,
} from './investment-thesis/types.js';

// ── Фабрики и утилиты ─────────────────────────
export {
  value,
  noData,
  notApplicable,
  hasValue,
  getOr,
  getUnsafe,
  pct,
  rub,
  raw,
  measure,
  str,
  bool,
  arr,
  rec,
} from './helpers.js';
