/**
 * Research Provider types and implementations.
 */

import type {
  AssetResearchSnapshot,
  ResearchAsset,
  ResearchContext,
} from '../types.js';

/** Провайдер исследований */
export abstract class ResearchProvider {
  abstract name: string;
  abstract supports(asset: ResearchAsset): boolean;
  abstract research(
    asset: ResearchAsset,
    context: ResearchContext,
  ): Promise<AssetResearchSnapshot>;
}

/** Сводка конфликта данных */
export interface ValueConflict {
  providerA: string;
  providerB: string;
  field: string;
  valueA: unknown;
  valueB: unknown;
}

/** Market Data Provider */
export class MarketDataProvider extends ResearchProvider {
  name = 'market';
  supports(_asset: ResearchAsset): boolean {
    return true;
  }
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

/** Issuer Fundamentals Provider */
export class IssuerFundamentalsProvider extends ResearchProvider {
  name = 'issuer';
  supports(_asset: ResearchAsset): boolean {
    return true;
  }
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

/** News Research Provider */
export class NewsResearchProvider extends ResearchProvider {
  name = 'news';
  supports(_asset: ResearchAsset): boolean {
    return true;
  }
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

/** Macro Research Provider */
export class MacroResearchProvider extends ResearchProvider {
  name = 'macro';
  supports(_asset: ResearchAsset): boolean {
    return true;
  }
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
