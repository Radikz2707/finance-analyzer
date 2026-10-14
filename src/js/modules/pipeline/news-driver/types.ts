/**
 * NewsDriver — новости как активный драйвер прогноза/оценки/корректировки стратегии.
 *
 * Модуль связывает новостной кэш (gatekeeper/news-cache) с инвестиционным
 * конвейером Director: оценивает влияние новостей на активы портфеля,
 * строит LLM-контекст и корректирует рекомендации.
 *
 * Архитектурное решение: модуль не зависит от director-types напрямую —
 * используются структурные контракты (PortfolioFactsLike, NewsCacheLike,
 * RecommendationLike), совместимые с реальными типами Director/NewsCache.
 */

import type { AiAction } from '../../research/types.js';
import type {
  CachedNewsItem,
  NewsImportance,
  NewsTrend,
} from '../gatekeeper/news-cache.js';

/** Направление влияния новости на актив */
export type ImpactDirection = 'positive' | 'negative' | 'neutral';

/** Влияние новостного фона на актив */
export interface NewsImpact {
  /** Тикер актива */
  ticker: string;
  /** Взвешенный сентимент (-1..1) */
  sentimentScore: number;
  /** Максимальная важность среди новостей тикера */
  importance: NewsImportance;
  /** Направление влияния */
  impactDirection: ImpactDirection;
  /** Затронутые метрики/факторы (дивиденды, санкции, отчётность...) */
  affectedMetrics: string[];
  /** Предлагаемое действие (эвристика; финальное решение — за адаптером) */
  suggestedAction: AiAction | null;
  /** Заголовки новостей, сформировавших impact */
  headlines: string[];
  /** Сводный impact score (0..1) */
  impactScore: number;
  /** Человекочитаемое обоснование */
  reasoning: string;
}

/** Контекст новостного драйвера (для LLM/UI/аудита) */
export interface NewsDriverContext {
  /** Все impact'ы по портфелю */
  impacts: NewsImpact[];
  /** Краткая сводка (для быстрого сканирования) */
  summary: string;
  /** Критические сигналы (важность critical/high + направление) */
  criticalSignals: string[];
}

/** Минимальный контракт фактов портфеля (структурно совместим с DirectorFactsContext) */
export interface PortfolioFactsLike {
  assetsAnalysis: readonly { ticker: string }[];
}

/** Минимальный контракт кэша новостей (структурно совместим с NewsCache) */
export interface NewsCacheLike {
  getByTicker(ticker: string, limit?: number): CachedNewsItem[];
  getTickerTrend?(ticker: string): NewsTrend | undefined;
  getLatest?(limit?: number): CachedNewsItem[];
}

/** Рекомендация, которую корректирует NewsDriver (структурно совместима с DirectorTask['recommendation']) */
export interface RecommendationLike {
  action: AiAction | null;
  confidence: number;
  reasoning: string;
}
