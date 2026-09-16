/**
 * MarketDataProvider — первый Research Provider.
 *
 * Заполняет AssetResearchSnapshot данными из доступных источников:
 * - AssetIdentity (из ResearchAsset)
 * - MarketResearch (из marketQuotes)
 * - MacroResearch (из macroData)
 * - ResearchEvidence (для каждого факта)
 *
 * НЕ генерирует AI-рекомендации.
 * НЕ обращается к Ollama.
 * НЕ придумывает fundamentals (issuerResearch, bondResearch, etfResearch = undefined).
 * Если данных нет — NO_DATA.
 */

import type {
  ResearchProvider,
  ResearchAsset,
  ResearchContext,
  MarketQuote,
  MacroSnapshot,
  NewsDataItem,
  SourceMetadata,
} from './types.js';
import type { AssetResearchSnapshot, ResearchEvidence } from '../types.js';
import {
  value,
  noData,
  pct,
  raw,
} from '../helpers.js';

export class MarketDataProvider implements ResearchProvider {
  /** Поддерживает все известные типы активов */
  supports(asset: ResearchAsset): boolean {
    const knownTypes = ['STOCK', 'BOND', 'ETF', 'CASH', 'OTHER'];
    return knownTypes.includes(asset.assetType);
  }

  async research(
    asset: ResearchAsset,
    context: ResearchContext,
  ): Promise<AssetResearchSnapshot> {
    const { researchTimestamp, marketQuotes, macroData, newsData, sources } = context;

    // --- Identity ---
    const identity = {
      ticker: asset.ticker,
      name: asset.name,
      assetType: asset.assetType as 'STOCK' | 'BOND' | 'ETF' | 'CASH' | 'OTHER',
      issuer: asset.issuer ?? '',
      currency: asset.currency ?? 'RUB',
      market: asset.market ?? 'MOEX',
    };

    // --- Evidence store ---
    const evidence: Record<string, ResearchEvidence> = {};

    // --- Market Research ---
    const quote = marketQuotes[asset.ticker];
    const marketResearch = this.buildMarketResearch(quote, asset.ticker, sources, researchTimestamp, evidence);

    // --- Macro Research ---
    const macroResearch = this.buildMacroResearch(macroData, sources, researchTimestamp, evidence);

    // --- News Research ---
    const newsResearch = this.buildNewsResearch(newsData, asset, sources, researchTimestamp, evidence);

    return {
      identity,
      marketResearch,
      macroResearch,
      newsResearch,
      evidence,
    };
  }

  // ───────────────────────────────────────────
  // Market Research builder
  // ───────────────────────────────────────────

  private buildMarketResearch(
    quote: MarketQuote | undefined,
    ticker: string,
    sources: SourceMetadata[],
    fetchedAt: string,
    evidence: Record<string, ResearchEvidence>,
  ): import('../types.js').MarketResearch {
    if (!quote) {
      return {
        currentPrice: noData(),
        priceChange1D: noData(),
        priceChange1W: noData(),
        priceChange1M: noData(),
        priceChangeYTD: noData(),
        volatility: noData(),
        volume: noData(),
        liquidity: noData(),
        marketRegime: noData(),
      };
    }

    return {
      currentPrice: value(quote.currentPrice, {
        unit: 'RUB',
        evidenceIds: this.registerEvidence('MARKET', `Price ${ticker} = ${quote.currentPrice}`, sources, fetchedAt, evidence),
      }),
      priceChange1D: pct(quote.dailyDynamicsPercent != null ? quote.dailyDynamicsPercent : null),
      priceChange1W: noData(),
      priceChange1M: noData(),
      priceChangeYTD: noData(),
      volatility: noData(),
      volume: raw(quote.currentPrice > 0 ? 0 : null),
      liquidity: noData(),
      marketRegime: noData(),
    };
  }

  // ───────────────────────────────────────────
  // Macro Research builder
  // ───────────────────────────────────────────

  private buildMacroResearch(
    macro: MacroSnapshot,
    sources: SourceMetadata[],
    fetchedAt: string,
    evidence: Record<string, ResearchEvidence>,
  ): import('../types.js').MacroResearch {
    return {
      keyRate: macro.keyRate != null
        ? value(macro.keyRate, {
            unit: '%',
            evidenceIds: this.registerEvidence('MACRO', `Key rate ${macro.keyRate}%`, sources, fetchedAt, evidence),
          })
        : noData(),
      inflation: noData(),
      inflationTrend: noData(),
      fx: macro.fxUsd != null
        ? value(macro.fxUsd, {
            unit: 'RUB/USD',
            evidenceIds: this.registerEvidence('MACRO', `FX USD ${macro.fxUsd}`, sources, fetchedAt, evidence),
          })
        : noData(),
      oil: macro.oil != null
        ? value(macro.oil, {
            unit: 'USD/bbl',
            evidenceIds: this.registerEvidence('MACRO', `Oil ${macro.oil}`, sources, fetchedAt, evidence),
          })
        : noData(),
      commodityRegime: noData(),
      liquidityRegime: noData(),
      economicCycle: noData(),
      rateRegime: noData(),
    };
  }

  // ───────────────────────────────────────────
  // News Research builder
  // ───────────────────────────────────────────

  private buildNewsResearch(
    newsData: NewsDataItem[],
    asset: ResearchAsset,
    _sources: SourceMetadata[],
    _fetchedAt: string,
    _evidence: Record<string, ResearchEvidence>,
  ): import('../types.js').NewsResearch | undefined {
    if (newsData.length === 0) {
      return undefined;
    }

    const items: import('../types.js').NewsItem[] = newsData
      .filter((n) => this.isRelevantToAsset(n, asset))
      .map((n) => {
        const importance = this.relevanceToImportance(n.relevance);
        const sentiment = this.relevanceToSentiment(n.relevance);
        return {
          title: n.title,
          date: n.date,
          source: n.source,
          url: n.url ?? '',
          importance,
          sentiment,
          summary: n.summary,
          relevanceToIssuer: this.computeRelevance(n, asset),
        };
      });

    if (items.length === 0) {
      return undefined;
    }

    return { items };
  }

  // ───────────────────────────────────────────
  // Evidence registration
  // ───────────────────────────────────────────

  /** Создаёт ResearchEvidence и возвращает её id */
  private registerEvidence(
    type: string,
    claim: string,
    sources: SourceMetadata[],
    fetchedAt: string,
    evidence: Record<string, ResearchEvidence>,
  ): string[] {
    if (sources.length === 0) return [];

    const id = `${type}-${sources[0].name}-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

    if (!evidence[id]) {
      evidence[id] = {
        id,
        type: type as ResearchEvidence['type'],
        source: sources[0].name,
        url: '',
        publishedAt: fetchedAt,
        retrievedAt: fetchedAt,
        claim,
        confidence: 0.9,
      };
    }

    return [id];
  }

  // ───────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────

  private isRelevantToAsset(
    news: NewsDataItem,
    asset: ResearchAsset,
  ): boolean {
    const keywords = [asset.ticker.toLowerCase(), asset.name.toLowerCase()];
    if (asset.issuer) {
      keywords.push(asset.issuer.toLowerCase());
    }
    const text = `${news.title} ${news.summary}`.toLowerCase();
    return keywords.some((kw) => text.includes(kw));
  }

  private relevanceToImportance(relevance: string): import('../types.js').NewsImportance {
    switch (relevance) {
      case 'high': return 'HIGH';
      case 'medium': return 'MEDIUM';
      case 'low': return 'LOW';
      default: return 'MEDIUM';
    }
  }

  private relevanceToSentiment(_relevance: string): import('../types.js').NewsSentiment {
    return 'NEUTRAL';
  }

  private computeRelevance(
    news: NewsDataItem,
    asset: ResearchAsset,
  ): number {
    const keywords = [asset.ticker.toLowerCase(), asset.name.toLowerCase()];
    const text = `${news.title} ${news.summary}`.toLowerCase();
    const matches = keywords.filter((kw) => text.includes(kw)).length;
    return Math.min(matches / keywords.length, 1);
  }
}
