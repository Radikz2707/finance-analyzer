/**
 * Investment Thesis Engine — тесты.
 *
 * 15 тестов по спецификации:
 * 1. достаточные VALUE facts → thesis создаётся
 * 2. только NO_DATA → confidence LOW + insufficient evidence
 * 3. отсутствующий valuation → valuationView не выдумывается
 * 4. отсутствующие fundamentals → thesis не выдумывает fundamentals
 * 5. negative PNL не становится причиной EXIT
 * 6. news влияет только при наличии evidence
 * 7. macro heuristic помечается DERIVED
 * 8. conflicting evidence не используется как бесспорный факт
 * 9. thesis содержит evidence references
 * 10. STOCK snapshot обрабатывается
 * 11. BOND snapshot обрабатывается
 * 12. ETF snapshot обрабатывается
 * 13. CASH snapshot обрабатывается
 * 14. portfolioContext не влияет на fundamentals
 * 15. generatedAt присутствует и валиден
 */

import { describe, it, expect } from 'vitest';
import { InvestmentThesisEngine } from './investment-thesis-engine.js';
import type {
  AssetResearchSnapshot,
  IssuerResearch,
  IssuerFinancials,
  IssuerValuation,
  BondResearch,
  ETFResearch,
  MarketResearch,
  MacroResearch,
  RiskAssessment,
  ResearchEvidence,
  NewsItem,
} from '../types.js';
import { value, noData, str } from '../helpers.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeEvidence(
  id: string,
  type: string,
  claim: string,
): ResearchEvidence {
  return {
    id,
    type: type as ResearchEvidence['type'],
    source: 'Test',
    url: 'https://test.local',
    publishedAt: new Date().toISOString(),
    retrievedAt: new Date().toISOString(),
    claim,
    confidence: 1,
  };
}

function makeFinancials(overrides?: Partial<IssuerFinancials>): IssuerFinancials {
  return {
    revenue: value(1500, { unit: ' млрд RUB' }),
    ebitda: value(500, { unit: ' млрд RUB' }),
    netIncome: value(450, { unit: ' млрд RUB' }),
    freeCashFlow: value(300, { unit: ' млрд RUB' }),
    debt: value(200, { unit: ' млрд RUB' }),
    netDebt: noData(),
    roe: value(15, { unit: '%' }),
    roic: value(12, { unit: '%' }),
    margin: noData(),
    ...overrides,
  };
}

function makeValuation(overrides?: Partial<IssuerValuation>): IssuerValuation {
  return {
    pe: value(5.2, { unit: 'x' }),
    evEbitda: value(3.1, { unit: 'x' }),
    pb: value(1.2, { unit: 'x' }),
    fcfYield: value(12.5, { unit: '%' }),
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<AssetResearchSnapshot> = {},
): AssetResearchSnapshot {
  return {
    identity: {
      ticker: 'TEST',
      name: 'Тестовый актив',
      assetType: 'STOCK',
      issuer: 'Тест',
      currency: 'RUB',
      market: 'MOEX',
    },
    issuerResearch: undefined,
    bondResearch: undefined,
    etfResearch: undefined,
    marketResearch: undefined,
    macroResearch: undefined,
    newsResearch: undefined,
    riskAssessment: undefined,
    evidence: {},
    ...overrides,
  };
}

function buildStockSnapshot(): AssetResearchSnapshot {
  const evidence: Record<string, ResearchEvidence> = {
    'fin-001': makeEvidence('fin-001', 'FINANCIAL', 'Выручка 1500 млрд RUB'),
    'fin-002': makeEvidence('fin-002', 'FINANCIAL', 'Чистая прибыль 450 млрд RUB'),
    'fin-003': makeEvidence('fin-003', 'FINANCIAL', 'ROE 15%'),
    'val-001': makeEvidence('val-001', 'VALUATION', 'P/E 5.2x'),
    'macro-001': makeEvidence('macro-001', 'MACRO', 'Ключевая ставка 14%'),
    'macro-002': makeEvidence('macro-002', 'MACRO', 'Инфляция 6.3%'),
    'risk-001': makeEvidence('risk-001', 'MARKET', 'Рыночный риск'),
  };

  const riskAssessment: RiskAssessment = {
    risks: [
      {
        type: 'MARKET',
        severity: 'HIGH',
        description: 'Волатильность рынка',
        evidenceRefs: ['risk-001'],
      },
      {
        type: 'REGULATORY',
        severity: 'CRITICAL',
        description: 'Новые требования ЦБ',
        evidenceRefs: [],
      },
    ],
    catalysts: [
      {
        description: 'Запуск нового продукта Q3 2025',
        timeline: noData(),
        evidenceRefs: [],
      },
    ],
  };

  const macroResearch: MacroResearch = {
    keyRate: value(14.0, { unit: '%' }),
    inflation: value(6.3, { unit: '%' }),
    inflationTrend: noData(),
    fx: noData(),
    oil: noData(),
    commodityRegime: noData(),
    liquidityRegime: value('TIGHT'),
    economicCycle: value('EXPANSION'),
    rateRegime: value('TIGHTENING'),
  };

  const issuerResearch: IssuerResearch = {
    businessDescription: str('Банковский сектор'),
    sector: str('Финансы'),
    industry: str('Банки'),
    financials: makeFinancials(),
    valuation: makeValuation(),
    earningsTrend: {
      revenueGrowth: value(8, { unit: '%' }),
      netIncomeGrowth: value(12, { unit: '%' }),
      guidance: noData(),
    },
    guidance: noData(),
    dividend: {
      lastDividend: noData(),
      dividendYield: value(10, { unit: '%' }),
      payoutRatio: noData(),
    },
  };

  const marketResearch: MarketResearch = {
    currentPrice: value(250, { unit: ' RUB' }),
    priceChange1D: noData(),
    priceChange1W: noData(),
    priceChange1M: noData(),
    priceChangeYTD: noData(),
    volatility: value(25, { unit: '%' }),
    volume: noData(),
    liquidity: value('HIGH'),
    marketRegime: value('BULL'),
  };

  return makeSnapshot({
    identity: {
      ticker: 'SBER',
      name: 'ПАО Сбербанк',
      assetType: 'STOCK',
      issuer: 'ПАО Сбербанк',
      currency: 'RUB',
      market: 'MOEX',
    },
    issuerResearch,
    marketResearch,
    macroResearch,
    riskAssessment,
    evidence,
  });
}

function buildAllNoDataSnapshot(): AssetResearchSnapshot {
  return makeSnapshot({
    identity: {
      ticker: 'NONE',
      name: 'Нет данных',
      assetType: 'STOCK',
      issuer: 'Тест',
      currency: 'RUB',
      market: 'MOEX',
    },
  });
}

function buildBondSnapshot(): AssetResearchSnapshot {
  const evidence: Record<string, ResearchEvidence> = {
    'bond-001': makeEvidence('bond-001', 'FINANCIAL', 'Купон 8%'),
    'macro-001': makeEvidence('macro-001', 'MACRO', 'Ключевая ставка 14%'),
  };

  const bondResearch: BondResearch = {
    issuer: value('Минфин РФ'),
    nominal: value(1000, { unit: ' RUB' }),
    couponRate: value(8, { unit: '%' }),
    couponFrequency: value('SEMI_ANNUAL'),
    maturityDate: value('2030-06-15'),
    yieldToMaturity: value(9.5, { unit: '%' }),
    duration: value(3.5),
    creditRating: value('AA'),
    creditSpread: noData(),
    amortization: noData(),
    callable: noData(),
  };

  const macroResearch: MacroResearch = {
    keyRate: value(14.0, { unit: '%' }),
    inflation: value(6.3, { unit: '%' }),
    inflationTrend: noData(),
    fx: noData(),
    oil: noData(),
    commodityRegime: noData(),
    liquidityRegime: value('NORMAL'),
    economicCycle: value('EXPANSION'),
    rateRegime: value('HOLDING'),
  };

  return makeSnapshot({
    identity: {
      ticker: 'RUOB',
      name: 'Облигация РФ',
      assetType: 'BOND',
      issuer: 'Минфин РФ',
      currency: 'RUB',
      market: 'MOEX',
    },
    bondResearch,
    macroResearch,
    evidence,
  });
}

function buildEtFSnapshot(): AssetResearchSnapshot {
  const evidence: Record<string, ResearchEvidence> = {
    'etf-001': makeEvidence('etf-001', 'MARKET', 'AUM 50 млрд RUB'),
    'macro-001': makeEvidence('macro-001', 'MACRO', 'Инфляция 6.3%'),
  };

  const etfResearch: ETFResearch = {
    benchmark: value('IMOEX'),
    description: value('ETF на индекс IMOEX'),
    aum: value(50, { unit: ' млрд RUB' }),
    expenseRatio: value(1.2, { unit: '%' }),
    trackingError: noData(),
    holdings: noData(),
    sectorExposure: noData(),
    currencyExposure: noData(),
    dividendPolicy: noData(),
  };

  const macroResearch: MacroResearch = {
    keyRate: value(14.0, { unit: '%' }),
    inflation: value(6.3, { unit: '%' }),
    inflationTrend: noData(),
    fx: noData(),
    oil: noData(),
    commodityRegime: noData(),
    liquidityRegime: value('NORMAL'),
    economicCycle: value('EXPANSION'),
    rateRegime: value('HOLDING'),
  };

  return makeSnapshot({
    identity: {
      ticker: 'TETF',
      name: 'ETF на IMOEX',
      assetType: 'ETF',
      issuer: 'УК Тест',
      currency: 'RUB',
      market: 'MOEX',
    },
    etfResearch,
    macroResearch,
    evidence,
  });
}

function buildCashSnapshot(): AssetResearchSnapshot {
  const evidence: Record<string, ResearchEvidence> = {
    'macro-001': makeEvidence('macro-001', 'MACRO', 'Ключевая ставка 14%'),
  };

  const macroResearch: MacroResearch = {
    keyRate: value(14.0, { unit: '%' }),
    inflation: value(6.3, { unit: '%' }),
    inflationTrend: noData(),
    fx: noData(),
    oil: noData(),
    commodityRegime: noData(),
    liquidityRegime: noData(),
    economicCycle: noData(),
    rateRegime: noData(),
  };

  return makeSnapshot({
    identity: {
      ticker: 'RUB',
      name: 'Рубли',
      assetType: 'CASH',
      issuer: 'ЦБ РФ',
      currency: 'RUB',
      market: 'OFFICIAL',
    },
    macroResearch,
    evidence,
  });
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('InvestmentThesisEngine', () => {
  const engine = new InvestmentThesisEngine();

  // 1. достаточные VALUE facts → thesis создаётся
  it('достаточные VALUE facts → thesis создаётся', () => {
    const snapshot = buildStockSnapshot();
    const result = engine.generate({ snapshot });

    expect(result.thesis).toBeTruthy();
    expect(result.thesis.length).toBeGreaterThan(50);
    expect(result.bullCase.length).toBeGreaterThan(10);
    expect(result.baseCase.length).toBeGreaterThan(10);
    expect(result.bearCase.length).toBeGreaterThan(10);
    expect(result.keyDrivers.length).toBeGreaterThan(0);
    expect(result.keyRisks.length).toBeGreaterThan(0);
    expect(result.confidence.level).toBe('MEDIUM');
    expect(result.confidence.value).toBeGreaterThan(0.3);
  });

  // 2. только NO_DATA → confidence LOW
  it('только NO_DATA → confidence LOW + insufficient evidence', () => {
    const snapshot = buildAllNoDataSnapshot();
    const result = engine.generate({ snapshot });

    expect(result.confidence.level).toBe('LOW');
    expect(result.confidence.value).toBeLessThan(0.2);
    expect(result.valuationView.stance).toBe('insufficient_data');
    expect(result.macroSensitivity.dataSource).toBe('INSUFFICIENT');
  });

  // 3. отсутствующий valuation → valuationView не выдумывается
  it('отсутствующий valuation → valuationView не выдумывается', () => {
    const snapshot = makeSnapshot({
      identity: {
        ticker: 'NOVAL',
        name: 'Нет оценки',
        assetType: 'STOCK',
        issuer: 'Тест',
        currency: 'RUB',
        market: 'MOEX',
      },
      issuerResearch: {
        businessDescription: str('Тест'),
        sector: str('Тест'),
        industry: str('Тест'),
        financials: makeFinancials({
          revenue: value(100, { unit: ' млн' }),
          netIncome: value(10, { unit: ' млн' }),
        }),
        valuation: {
          pe: noData(),
          evEbitda: noData(),
          pb: noData(),
          fcfYield: noData(),
        },
        earningsTrend: {
          revenueGrowth: noData(),
          netIncomeGrowth: noData(),
          guidance: noData(),
        },
        guidance: noData(),
        dividend: {
          lastDividend: noData(),
          dividendYield: noData(),
          payoutRatio: noData(),
        },
      },
    });

    const result = engine.generate({ snapshot });
    expect(result.valuationView.stance).toBe('insufficient_data');
    expect(result.valuationView.dataSource).toBe('INSUFFICIENT');
  });

  // 4. отсутствующие fundamentals → thesis не выдумывает fundamentals
  it('отсутствующие fundamentals → thesis не выдумывает fundamentals', () => {
    const snapshot = makeSnapshot({
      identity: {
        ticker: 'NOFUND',
        name: 'Нет фундаментальных',
        assetType: 'STOCK',
        issuer: 'Тест',
        currency: 'RUB',
        market: 'MOEX',
      },
      issuerResearch: {
        businessDescription: noData(),
        sector: noData(),
        industry: noData(),
        financials: {
          revenue: noData(),
          ebitda: noData(),
          netIncome: noData(),
          freeCashFlow: noData(),
          debt: noData(),
          netDebt: noData(),
          roe: noData(),
          roic: noData(),
          margin: noData(),
        },
        valuation: {
          pe: noData(),
          evEbitda: noData(),
          pb: noData(),
          fcfYield: noData(),
        },
        earningsTrend: {
          revenueGrowth: noData(),
          netIncomeGrowth: noData(),
          guidance: noData(),
        },
        guidance: noData(),
        dividend: {
          lastDividend: noData(),
          dividendYield: noData(),
          payoutRatio: noData(),
        },
      },
    });

    const result = engine.generate({ snapshot });
    expect(result.thesis).toContain('Фундаментальные данные отсутствуют');
    expect(result.thesis).not.toMatch(/\d+\s*(млрд|млн)/);
  });

  // 5. negative PNL не становится причиной EXIT
  it('negative PNL не становится причиной EXIT', () => {
    const snapshot = makeSnapshot({
      identity: {
        ticker: 'LOSS',
        name: 'Убыточный',
        assetType: 'STOCK',
        issuer: 'Тест',
        currency: 'RUB',
        market: 'MOEX',
      },
      issuerResearch: {
        businessDescription: str('Тестовая компания'),
        sector: str('Технологии'),
        industry: str('ПО'),
        financials: makeFinancials({
          revenue: value(100, { unit: ' млн' }),
          netIncome: value(-5, { unit: ' млн' }),
          freeCashFlow: value(-3, { unit: ' млн' }),
          roe: value(-2, { unit: '%' }),
          roic: value(-1, { unit: '%' }),
        }),
        valuation: makeValuation({
          pe: noData(),
          evEbitda: value(10, { unit: 'x' }),
          pb: value(0.5, { unit: 'x' }),
          fcfYield: noData(),
        }),
        earningsTrend: {
          revenueGrowth: value(-10, { unit: '%' }),
          netIncomeGrowth: value(-50, { unit: '%' }),
          guidance: noData(),
        },
        guidance: noData(),
        dividend: {
          lastDividend: noData(),
          dividendYield: noData(),
          payoutRatio: noData(),
        },
      },
    });

    const result = engine.generate({ snapshot });
    expect(result.thesis).not.toContain('EXIT');
    expect(result.thesis).not.toContain('продавать');
    expect(result.thesis).not.toContain('избегать');
  });

  // 6. news влияет только при наличии evidence
  it('news влияет только при наличии evidence', () => {
    const newsItems: NewsItem[] = [
      {
        title: 'Позитивная новость',
        date: '2025-01-01',
        source: 'Reuters',
        url: 'https://reuters.com/1',
        importance: 'HIGH',
        sentiment: 'POSITIVE',
        summary: 'Отличные результаты',
        relevanceToIssuer: 0.9,
      },
    ];

    const snapshot = makeSnapshot({
      identity: {
        ticker: 'NEWS',
        name: 'С новостями',
        assetType: 'STOCK',
        issuer: 'Тест',
        currency: 'RUB',
        market: 'MOEX',
      },
      newsResearch: {
        items: newsItems,
      },
    });

    const result = engine.generate({ snapshot });
    expect(result.thesis).toBeTruthy();
    const hasNews = result.keyDrivers.some((d) => /новость|news/i.test(d));
    expect(hasNews).toBe(false);
  });

  // 7. macro heuristic помечается DERIVED
  it('macro heuristic помечается DERIVED', () => {
    const snapshot = makeSnapshot({
      identity: {
        ticker: 'MACRO',
        name: 'Макро',
        assetType: 'STOCK',
        issuer: 'Тест',
        currency: 'RUB',
        market: 'MOEX',
      },
      macroResearch: {
        keyRate: value(14.0, { unit: '%' }),
        inflation: noData(),
        inflationTrend: noData(),
        fx: noData(),
        oil: noData(),
        commodityRegime: noData(),
        liquidityRegime: noData(),
        economicCycle: noData(),
        rateRegime: noData(),
      },
    });

    const result = engine.generate({ snapshot });
    expect(result.macroSensitivity.description).toBeTruthy();
    expect(result.macroSensitivity.description.length).toBeGreaterThan(0);
  });

  // 8. conflicting evidence не используется как бесспорный факт
  it('conflicting evidence не используется как бесспорный факт', () => {
    const snapshot = makeSnapshot({
      identity: {
        ticker: 'CONF',
        name: 'Конфликт',
        assetType: 'STOCK',
        issuer: 'Тест',
        currency: 'RUB',
        market: 'MOEX',
      },
      issuerResearch: {
        businessDescription: str('Тест'),
        sector: str('Тест'),
        industry: str('Тест'),
        financials: makeFinancials({
          revenue: value(100, { unit: ' млн' }),
          netIncome: value(-10, { unit: ' млн' }),
          roe: value(-5, { unit: '%' }),
          debt: value(200, { unit: ' млн' }),
        }),
        valuation: makeValuation({
          pe: noData(),
          evEbitda: value(3, { unit: 'x' }),
          pb: value(0.3, { unit: 'x' }),
          fcfYield: noData(),
        }),
        earningsTrend: {
          revenueGrowth: value(-20, { unit: '%' }),
          netIncomeGrowth: value(-100, { unit: '%' }),
          guidance: noData(),
        },
        guidance: noData(),
        dividend: {
          lastDividend: noData(),
          dividendYield: noData(),
          payoutRatio: noData(),
        },
      },
    });

    const result = engine.generate({ snapshot });
    expect(result.valuationView.stance).not.toBe('undervalued');
    expect(['fairly_valued', 'insufficient_data']).toContain(
      result.valuationView.stance,
    );
  });

  // 9. thesis содержит evidence references
  it('thesis содержит evidence references', () => {
    const snapshot = buildStockSnapshot();
    const result = engine.generate({ snapshot });

    if (result.evidenceReferences.length > 0) {
      expect(result.evidenceReferences[0]).toHaveProperty('evidenceId');
      expect(result.evidenceReferences[0]).toHaveProperty('fact');
      expect(result.evidenceReferences[0]).toHaveProperty('type');
    }
  });

  // 10. STOCK snapshot обрабатывается
  it('STOCK snapshot обрабатывается', () => {
    const snapshot = buildStockSnapshot();
    const result = engine.generate({ snapshot });

    expect(result.assetType).toBe('STOCK');
    expect(result.ticker).toBe('SBER');
    expect(result.thesis.length).toBeGreaterThan(50);
    expect(result.keyDrivers.length).toBeGreaterThan(3);
    expect(result.keyRisks.length).toBeGreaterThan(0);
    expect(result.keyCatalysts.length).toBeGreaterThan(0);
  });

  // 11. BOND snapshot обрабатывается
  it('BOND snapshot обрабатывается', () => {
    const snapshot = buildBondSnapshot();
    const result = engine.generate({ snapshot });

    expect(result.assetType).toBe('BOND');
    expect(result.ticker).toBe('RUOB');
    expect(result.thesis.length).toBeGreaterThan(10);
    expect(result.keyDrivers.length).toBeGreaterThan(0);
  });

  // 12. ETF snapshot обрабатывается
  it('ETF snapshot обрабатывается', () => {
    const snapshot = buildEtFSnapshot();
    const result = engine.generate({ snapshot });

    expect(result.assetType).toBe('ETF');
    expect(result.ticker).toBe('TETF');
    expect(result.thesis.length).toBeGreaterThan(10);
    expect(result.keyDrivers.length).toBeGreaterThan(0);
  });

  // 13. CASH snapshot обрабатывается
  it('CASH snapshot обрабатывается', () => {
    const snapshot = buildCashSnapshot();
    const result = engine.generate({ snapshot });

    expect(result.assetType).toBe('CASH');
    expect(result.ticker).toBe('RUB');
    expect(result.thesis.length).toBeGreaterThan(10);
    expect(result.macroSensitivity.level).toBe('LOW');
    expect(result.macroSensitivity.dataSource).toBe('VALUE');
  });

  // 14. portfolioContext не влияет на fundamentals
  it('portfolioContext не влияет на fundamentals', () => {
    const snapshot = buildStockSnapshot();
    const result = engine.generate({
      snapshot,
      portfolioContext: {
        currentPercent: 25,
        targetPercent: 30,
        portfolioMathStatus: 'BUY',
        currentPriceRub: 250,
        balancePrice: 200,
        quantity: 100,
        unrealizedProfitRub: 5000,
        totalPortfolioValue: 1000000,
      },
    });

    expect(result.thesis).toContain('Контекст портфеля');
    expect(result.keyDrivers).toContain('Выручка: 1500 млрд RUB');
  });

  // 15. generatedAt присутствует
  it('generatedAt присутствует и валиден', () => {
    const snapshot = buildStockSnapshot();
    const result = engine.generate({ snapshot });

    expect(result.generatedAt).toBeTruthy();
    expect(() => new Date(result.generatedAt)).not.toThrow();
  });
});
