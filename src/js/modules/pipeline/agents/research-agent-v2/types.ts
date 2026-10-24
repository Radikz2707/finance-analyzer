/**
 * ResearchAgentV2 — глубокое исследование активов с кросс-проверкой,
 * историческим анализом и экспортом.
 */

// ──────────────────────────────────────────────
// 1. Типы исследования
// ──────────────────────────────────────────────

/** Глубина исследования */
export type ResearchDepth = 'quick' | 'standard' | 'deep';

/** Источник данных */
export type DataSource =
  | 'market'
  | 'fundamentals'
  | 'news'
  | 'macro'
  | 'social'
  | 'historical';

/** Уровень доверия к данным */
export type DataConfidence = 'low' | 'medium' | 'high' | 'verified';

/** Тип кросс-проверки */
export type CrossCheckType = 'price' | 'volume' | 'fundamentals' | 'news_sentiment';

// ──────────────────────────────────────────────
// 2. Интерфейсы
// ──────────────────────────────────────────────

/** Результат кросс-проверки */
export interface CrossCheckResult {
  type: CrossCheckType;
  ticker: string;
  isConsistent: boolean;
  discrepancies: string[];
  confidence: DataConfidence;
}

/** Историческая точка данных */
export interface HistoricalDataPoint {
  date: string;
  price: number;
  volume: number;
  changePercent: number;
}

/** Результат исторического анализа */
export interface HistoricalAnalysis {
  ticker: string;
  dataPoints: HistoricalDataPoint[];
  averageChange: number;
  volatility: number;
  trend: 'up' | 'down' | 'neutral';
  maxDrawdown: number;
  sharpeRatio?: number;
}

/** Результат анализа настроений */
export interface SentimentAnalysis {
  ticker: string;
  score: number; // -1 to 1
  label: 'bearish' | 'neutral' | 'bullish';
  keyPhrases: string[];
  sourceCount: number;
}

/** Глубокий снимок актива */
export interface DeepAssetSnapshot {
  ticker: string;
  crossChecks: CrossCheckResult[];
  historicalAnalysis?: HistoricalAnalysis;
  sentimentAnalysis?: SentimentAnalysis;
  researchDepth: ResearchDepth;
  completedAt: string;
  dataSources: DataSource[];
}

// ──────────────────────────────────────────────
// 3. Входы и выходы
// ──────────────────────────────────────────────

/** Действия ResearchAgentV2 */
export type ResearchAgentV2Action =
  | 'deep-research'
  | 'cross-check'
  | 'historical-analysis'
  | 'sentiment-analysis'
  | 'export-research'
  | 'get-cache'
  | 'clear-cache';

/** Вход для deep-research */
export interface DeepResearchParams {
  tickers: string[];
  depth?: ResearchDepth;
  includeHistorical?: boolean;
  includeSentiment?: boolean;
}

/** Вход для cross-check */
export interface CrossCheckParams {
  tickers: string[];
  types?: CrossCheckType[];
}

/** Вход для historical-analysis */
export interface HistoricalParams {
  ticker: string;
  periodDays?: number;
}

/** Текстовый источник для анализа настроений */
export interface TextSentimentSource {
  /** Заголовок или название источника */
  title: string;
  /** Полный текст */
  text: string;
  /** Источник (news, social, report и т.д.) */
  sourceType: 'news' | 'social' | 'report' | 'blog' | 'unknown';
  /** Дата (ISO string) */
  date?: string;
}

/** Вход для sentiment-analysis */
export interface SentimentParams {
  ticker: string;
  sources?: TextSentimentSource[];
}

/** Вход для export-research */
export interface ExportParams {
  tickers?: string[];
  format: 'json' | 'markdown' | 'csv';
}

/** Входные данные для V1-совместимости */
export interface V1FactsParams {
  /** Тикеры для анализа (пустой список = весь портфель) */
  tickers?: string[];
  /** Факты портфеля (копия, не мутация) */
  facts: DirectorFactsContext;
  /** Новостные воздействия (NewsDriver) */
  newsImpacts?: NewsImpact[];
}

/** Вход ResearchAgentV2 */
export type ResearchAgentV2Input =
  | { action: 'deep-research'; params: DeepResearchParams }
  | { action: 'cross-check'; params: CrossCheckParams }
  | { action: 'historical-analysis'; params: HistoricalParams }
  | { action: 'sentiment-analysis'; params: SentimentParams }
  | { action: 'export-research'; params: ExportParams }
  | { action: 'facts'; params: V1FactsParams }
  | { action: 'get-cache'; params?: Record<string, never> }
  | { action: 'clear-cache'; params?: Record<string, never> };

/** Результат операции */
export interface ResearchOperationResult {
  success: boolean;
  message: string;
  snapshots?: DeepAssetSnapshot[];
  crossChecks?: CrossCheckResult[];
  historical?: HistoricalAnalysis;
  sentiment?: SentimentAnalysis;
  exportResult?: ExportResult;
  cacheStats?: CacheStats;
}

/** Статистика кэша */
export interface CacheStats {
  totalEntries: number;
  tickers: string[];
  oldestEntry: string;
  newestEntry: string;
}

/** Результат экспорта */
export interface ExportResult {
  format: 'json' | 'markdown' | 'csv';
  content: string;
  tickers: string[];
}

/** Выход ResearchAgentV2 */
export type ResearchAgentV2Output = ResearchOperationResult;

// ──────────────────────────────────────────────
// 4. V1-совместимость: факты, новости, алерты
// ──────────────────────────────────────────────

// NewsDriver удалён — используем заглушку
type NewsImpact = { ticker: string; impact: number; sentiment: 'positive' | 'negative' | 'neutral' };
import type { DirectorFactsContext } from '../../director/director-types.js';

/** Действие для V1-совместимости */
export type ResearchAction = 'facts' | 'news' | 'alerts';

/** Выходные данные для action 'facts' (V1-совместимость) */
export interface ResearchV1Output {
  action: ResearchAction;
  success: boolean;
  /** Снимки исследований по тикерам */
  snapshots?: Map<string, { snapshot: unknown }>;
  /** Мнение агента для Consilium */
  opinion?: {
    role: string;
    position: string;
    action: string | null;
    confidence: number;
    arguments: string[];
  };
  /** Проверенные алерты */
  priceAlerts?: number;
  /** Проверенные новости */
  newsImpacts?: number;
  /** Новостная сводка */
  newsSummary?: string;
  message?: string;
  /** Дополнительные данные */
  data?: {
    opinion?: ResearchV1Output['opinion'];
    priceAlerts?: number;
    newsImpacts?: number;
    newsSummary?: string;
    sentimentData?: Record<string, {
      score: number;
      label: 'bullish' | 'bearish' | 'neutral';
      keyPhrases: string[];
      sourceCount: number;
      newsSummary?: string;
    }>;
  };
}
