/**
 * Research Provider — контракты для заполнения AssetResearchSnapshot
 * реальными данными из доступных источников.
 *
 * Provider НЕ генерирует AI-рекомендации.
 * Provider НЕ обращается к Ollama / LLM.
 * Provider НЕ придумывает fundamentals.
 */

import type {
  AssetType,
  AssetResearchSnapshot,
  ResearchEvidence,
} from '../types.js';

// ──────────────────────────────────────────────
// 1. Контекст исследования
// ──────────────────────────────────────────────

/** Рыночные котировки актива (из xlsx-parser / quotes sheet) */
export interface MarketQuote {
  currentPrice: number;
  dailyDynamicsPercent: number;
  shortName: string;
}

/** Данные макроэкономики (из cbr-rate, news-fetcher и т.д.) */
export interface MacroSnapshot {
  keyRate?: number;
  keyRateDate?: string;
  fxUsd?: number;
  fxEur?: number;
  oil?: number;
}

/** Новостные данные (из news-fetcher) */
export interface NewsDataItem {
  title: string;
  summary: string;
  source: string;
  date: string;
  url?: string;
  relevance: 'high' | 'medium' | 'low';
}

/** Метаданные источника данных */
export interface SourceMetadata {
  name: string;
  version?: string;
  fetchedAt: string;
}

/** Контекст, передаваемый каждому provider'у */
export interface ResearchContext {
  /** Дата/время исследования (ISO 8601) */
  researchTimestamp: string;
  /** Котировки по тикерам */
  marketQuotes: Record<string, MarketQuote>;
  /** Макро-данные */
  macroData: MacroSnapshot;
  /** Новостные данные */
  newsData: NewsDataItem[];
  /** Метаданные источников */
  sources: SourceMetadata[];
  /** TTL кэша в секундах (по умолчанию 300 = 5 минут) */
  ttlSeconds?: number;
}

// ──────────────────────────────────────────────
// 2. Контракт ResearchProvider
// ──────────────────────────────────────────────

/** Минимальная информация об активе для provider'а */
export interface ResearchAsset {
  ticker: string;
  name: string;
  assetType: AssetType;
  issuer: string;
  currency: string;
  market: string;
}

/** Контракт провайдера исследования */
export interface ResearchProvider {
  /** Поддерживает ли provider этот тип актива */
  supports(asset: ResearchAsset): boolean;

  /**
   * Заполнить AssetResearchSnapshot данными из доступных источников.
   *
   * НЕ генерирует AI-рекомендации.
   * НЕ обращается к Ollama.
   * НЕ придумывает fundamentals.
   * Каждый VALUE должен иметь evidenceIds.
   * Если данных нет — NO_DATA.
   */
  research(
    asset: ResearchAsset,
    context: ResearchContext,
  ): Promise<AssetResearchSnapshot>;
}

// ──────────────────────────────────────────────
// 3. Утилиты для создания ResearchEvidence
// ──────────────────────────────────────────────

/** Создать ResearchEvidence из доступных данных */
export function createEvidence(
  type: string,
  source: string,
  claim: string,
  _sources: SourceMetadata[],
  fetchedAt: string,
): ResearchEvidence {
  return {
    id: `ev-${type}-${fetchedAt.slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8)}`,
    type: type as ResearchEvidence['type'],
    source,
    url: '',
    publishedAt: fetchedAt,
    retrievedAt: fetchedAt,
    claim,
    confidence: 0.9,
  };
}
