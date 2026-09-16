import type { ResearchProvider, ResearchAsset, ResearchContext } from './types.js';
import type { AssetResearchSnapshot } from '../types.js';
import { value, noData } from '../helpers.js';

/**
 * TestConflictProvider — тестовый provider, возвращающий конфликтующее значение.
 *
 * currentPrice = 200 (вместо 280 у MarketDataProvider).
 * Используется для проверки конфликтов VALUE+VALUE.
 */
export class TestConflictProvider implements ResearchProvider {
  supports(_asset: ResearchAsset): boolean {
    return ['STOCK', 'BOND', 'ETF', 'CASH'].includes(_asset.assetType);
  }

  async research(
    _asset: ResearchAsset,
    _context: ResearchContext,
  ): Promise<AssetResearchSnapshot> {
    return {
      identity: {
        ticker: _asset.ticker,
        name: _asset.name,
        assetType: _asset.assetType as 'STOCK' | 'BOND' | 'ETF' | 'CASH' | 'OTHER',
        issuer: _asset.issuer ?? '',
        currency: _asset.currency ?? 'RUB',
        market: _asset.market ?? 'MOEX',
      },
      marketResearch: {
        currentPrice: value(200, { unit: 'RUB' }),
        priceChange1D: noData(),
        priceChange1W: noData(),
        priceChange1M: noData(),
        priceChangeYTD: noData(),
        volatility: noData(),
        volume: noData(),
        liquidity: noData(),
        marketRegime: noData(),
      },
      macroResearch: {
        keyRate: noData(),
        inflation: noData(),
        inflationTrend: noData(),
        fx: noData(),
        oil: noData(),
        commodityRegime: noData(),
        liquidityRegime: noData(),
        economicCycle: noData(),
        rateRegime: noData(),
      },
      evidence: {},
    };
  }
}
