/**
 * TestFundamentalsProvider — тестовый mock provider.
 *
 * Возвращает "fundamentals" для STOCK и BOND активов.
 * Используется для демонстрации агрегации нескольких providers.
 *
 * НЕ используется в production — только для тестов.
 */

import type {
  ResearchProvider,
  ResearchAsset,
  ResearchContext,
} from './types.js';
import type { AssetResearchSnapshot } from '../types.js';
import { value, str } from '../helpers.js';

export class TestFundamentalsProvider implements ResearchProvider {
  /** Поддерживает STOCK и BOND */
  supports(asset: ResearchAsset): boolean {
    return ['STOCK', 'BOND'].includes(asset.assetType);
  }

  async research(
    asset: ResearchAsset,
    _context: ResearchContext,
  ): Promise<AssetResearchSnapshot> {
    const evidence: Record<string, import('../types.js').ResearchEvidence> = {};

    // --- IssuerResearch для STOCK ---
    let issuerResearch: import('../types.js').IssuerResearch | undefined;
    if (asset.assetType === 'STOCK') {
      issuerResearch = {
        businessDescription: str('Тестовый эмитент'),
        sector: str('Финансы'),
        industry: str('Банки'),
        financials: {
          revenue: value(1000000, { unit: 'RUB' }),
          ebitda: value(300000, { unit: 'RUB' }),
          netIncome: value(200000, { unit: 'RUB' }),
          freeCashFlow: value(150000, { unit: 'RUB' }),
          debt: value(500000, { unit: 'RUB' }),
          netDebt: value(300000, { unit: 'RUB' }),
          roe: value(15, { unit: '%' }),
          roic: value(12, { unit: '%' }),
          margin: value(20, { unit: '%' }),
        },
        valuation: {
          pe: value(8, { unit: 'x' }),
          evEbitda: value(6, { unit: 'x' }),
          pb: value(1.2, { unit: 'x' }),
          fcfYield: value(5, { unit: '%' }),
        },
        earningsTrend: {
          revenueGrowth: value(10, { unit: '%' }),
          netIncomeGrowth: value(8, { unit: '%' }),
          guidance: str('Оптимистичный'),
        },
        guidance: str('Рост на 10%'),
        dividend: {
          lastDividend: value(35, { unit: 'RUB' }),
          dividendYield: value(9.5, { unit: '%' }),
          payoutRatio: value(45, { unit: '%' }),
        },
      };
    }

    // --- BondResearch для BOND ---
    let bondResearch: import('../types.js').BondResearch | undefined;
    if (asset.assetType === 'BOND') {
      bondResearch = {
        issuer: str(asset.issuer ?? 'Эмитент'),
        nominal: value(1000, { unit: 'RUB' }),
        couponRate: value(12, { unit: '%' }),
        couponFrequency: value('SEMI_ANNUAL'),
        maturityDate: str('2030-06-15'),
        yieldToMaturity: value(11.5, { unit: '%' }),
        duration: value(4.2),
        creditRating: str('AAA'),
        creditSpread: value(1.5, { unit: '%' }),
        amortization: value(0),
        callable: value(false),
      };
    }

    return {
      identity: {
        ticker: asset.ticker,
        name: asset.name,
        assetType: asset.assetType as import('../types.js').AssetType,
        issuer: asset.issuer ?? '',
        currency: asset.currency ?? 'RUB',
        market: asset.market ?? 'MOEX',
      },
      issuerResearch,
      bondResearch,
      evidence,
    };
  }
}
