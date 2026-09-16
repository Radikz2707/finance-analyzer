import { describe, it, expect } from 'vitest';
import {
  value,
  noData,
  notApplicable,
  hasValue,
  getOr,
  getUnsafe,
  raw,
  pct,
  rub,
  str,
} from './helpers.js';
import type {
  ResearchValue,
  AssetIdentity,
  IssuerResearch,
  BondResearch,
  ETFResearch,
  MacroResearch,
  NewsItem,
  ResearchEvidence,
  AssetResearchSnapshot,
  AIRecommendation,
  DataStatus,
} from './types.js';

// ═══════════════════════════════════════════════
// 1. ResearchValue VALUE
// ═══════════════════════════════════════════════

describe('ResearchValue VALUE', () => {
  it('status должен быть "VALUE"', () => {
    const rv = value(42);
    expect(rv.status).toBe('VALUE');
  });

  it('value должен сохраняться', () => {
    const rv = value(42);
    expect(rv.value).toBe(42);
  });

  it('unit должен сохраняться', () => {
    const rv = value(100, { unit: 'RUB' });
    expect(rv.unit).toBe('RUB');
  });

  it('evidenceIds должны сохраняться', () => {
    const ids = ['ev-1', 'ev-2'];
    const rv = value('test', { evidenceIds: ids });
    expect(rv.evidenceIds).toEqual(ids);
  });
});

// ═══════════════════════════════════════════════
// 2. noData()
// ═══════════════════════════════════════════════

describe('noData()', () => {
  it('status должен быть "NO_DATA"', () => {
    const rv = noData();
    expect(rv.status).toBe('NO_DATA');
  });
});

// ═══════════════════════════════════════════════
// 3. notApplicable()
// ═══════════════════════════════════════════════

describe('notApplicable()', () => {
  it('status должен быть "NOT_APPLICABLE"', () => {
    const rv = notApplicable();
    expect(rv.status).toBe('NOT_APPLICABLE');
  });
});

// ═══════════════════════════════════════════════
// 4. pct()
// ═══════════════════════════════════════════════

describe('pct()', () => {
  it('значение 15 → VALUE + unit "%"', () => {
    const rv = pct(15);
    expect(rv.status).toBe('VALUE');
    expect(rv.value).toBe(15);
    expect(rv.unit).toBe('%');
  });

  it('null → NO_DATA', () => {
    const rv = pct(null);
    expect(rv.status).toBe('NO_DATA');
  });
});

// ═══════════════════════════════════════════════
// 5. rub()
// ═══════════════════════════════════════════════

describe('rub()', () => {
  it('значение → VALUE + unit "RUB"', () => {
    const rv = rub(50000);
    expect(rv.status).toBe('VALUE');
    expect(rv.value).toBe(50000);
    expect(rv.unit).toBe('RUB');
  });

  it('null → NO_DATA', () => {
    const rv = rub(null);
    expect(rv.status).toBe('NO_DATA');
  });
});

// ═══════════════════════════════════════════════
// 6. str()
// ═══════════════════════════════════════════════

describe('str()', () => {
  it('нормальная строка → VALUE', () => {
    const rv = str('Hello');
    expect(rv.status).toBe('VALUE');
    expect(rv.value).toBe('Hello');
  });

  it('пустая строка → NO_DATA', () => {
    const rv = str('');
    expect(rv.status).toBe('NO_DATA');
  });
});

// ═══════════════════════════════════════════════
// 7. AssetIdentity
// ═══════════════════════════════════════════════

describe('AssetIdentity', () => {
  it('корректно создаётся и типизируется', () => {
    const identity: AssetIdentity = {
      ticker: 'SBER',
      name: 'ПАО Сбербанк',
      assetType: 'STOCK',
      issuer: 'ПАО Сбербанк',
      currency: 'RUB',
      market: 'MOEX',
    };

    expect(identity.ticker).toBe('SBER');
    expect(identity.name).toBe('ПАО Сбербанк');
    expect(identity.assetType).toBe('STOCK');
    expect(identity.issuer).toBe('ПАО Сбербанк');
    expect(identity.currency).toBe('RUB');
    expect(identity.market).toBe('MOEX');
  });
});

// ═══════════════════════════════════════════════
// 8. IssuerResearch
// ═══════════════════════════════════════════════

describe('IssuerResearch', () => {
  it('финансовые и valuation поля принимают ResearchValue', () => {
    const issuer: IssuerResearch = {
      businessDescription: str('Тестовый эмитент'),
      sector: str('Финансы'),
      industry: str('Банки'),
      financials: {
        revenue: rub(1000000),
        ebitda: rub(300000),
        netIncome: rub(200000),
        freeCashFlow: rub(150000),
        debt: rub(500000),
        netDebt: rub(300000),
        roe: pct(15),
        roic: pct(12),
        margin: pct(20),
      },
      valuation: {
        pe: pct(8),
        evEbitda: pct(6),
        pb: pct(1.2),
        fcfYield: pct(5),
      },
      earningsTrend: {
        revenueGrowth: pct(10),
        netIncomeGrowth: pct(8),
        guidance: str('Оптимистичный'),
      },
      guidance: str('Рост на 10%'),
      dividend: {
        lastDividend: rub(35),
        dividendYield: pct(9.5),
        payoutRatio: pct(45),
      },
    };

    expect(hasValue(issuer.financials.revenue)).toBe(true);
    expect(issuer.financials.revenue.value).toBe(1000000);
    expect(hasValue(issuer.valuation.pe)).toBe(true);
    expect(issuer.valuation.pe.value).toBe(8);
    expect(hasValue(issuer.dividend.dividendYield)).toBe(true);
    expect(issuer.dividend.dividendYield.unit).toBe('%');
  });

  it('финансовые поля могут быть NO_DATA', () => {
    const issuer: IssuerResearch = {
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
    };

    expect(hasValue(issuer.financials.revenue)).toBe(false);
    expect(hasValue(issuer.valuation.pe)).toBe(false);
    expect(hasValue(issuer.dividend.dividendYield)).toBe(false);
  });
});

// ═══════════════════════════════════════════════
// 9. BondResearch
// ═══════════════════════════════════════════════

describe('BondResearch', () => {
  it('coupon/nominal/YTM/duration могут быть NO_DATA', () => {
    const bond: BondResearch = {
      issuer: str('ПАО Сбербанк'),
      nominal: noData(),
      couponRate: noData(),
      couponFrequency: noData(),
      maturityDate: noData(),
      yieldToMaturity: noData(),
      duration: noData(),
      creditRating: noData(),
      creditSpread: noData(),
      amortization: noData(),
      callable: noData(),
    };

    expect(hasValue(bond.nominal)).toBe(false);
    expect(hasValue(bond.couponRate)).toBe(false);
    expect(hasValue(bond.yieldToMaturity)).toBe(false);
    expect(hasValue(bond.duration)).toBe(false);
  });

  it('поля могут быть VALUE', () => {
    const bond: BondResearch = {
      issuer: str('ПАО Сбербанк'),
      nominal: rub(1000),
      couponRate: pct(12),
      couponFrequency: value('SEMI_ANNUAL'),
      maturityDate: str('2030-06-15'),
      yieldToMaturity: pct(11.5),
      duration: raw(4.2),
      creditRating: str('AAA'),
      creditSpread: pct(1.5),
      amortization: raw(0),
      callable: value(false),
    };

    expect(hasValue(bond.nominal)).toBe(true);
    expect(bond.nominal.value).toBe(1000);
    expect(hasValue(bond.couponRate)).toBe(true);
    expect(bond.couponRate.value).toBe(12);
    expect(hasValue(bond.yieldToMaturity)).toBe(true);
    expect(bond.yieldToMaturity.value).toBe(11.5);
    expect(hasValue(bond.duration)).toBe(true);
    expect(bond.duration.value).toBe(4.2);
  });
});

// ═══════════════════════════════════════════════
// 10. ETFResearch
// ═══════════════════════════════════════════════

describe('ETFResearch', () => {
  it('benchmark/AUM/expenseRatio могут быть NO_DATA', () => {
    const etf: ETFResearch = {
      benchmark: noData(),
      description: noData(),
      aum: noData(),
      expenseRatio: noData(),
      trackingError: noData(),
      holdings: noData(),
      sectorExposure: noData(),
      currencyExposure: noData(),
      dividendPolicy: noData(),
    };

    expect(hasValue(etf.benchmark)).toBe(false);
    expect(hasValue(etf.aum)).toBe(false);
    expect(hasValue(etf.expenseRatio)).toBe(false);
  });

  it('поля могут быть VALUE', () => {
    const etf: ETFResearch = {
      benchmark: str('IMOEX'),
      description: str('Фонд облигаций'),
      aum: rub(5000000000),
      expenseRatio: pct(0.3),
      trackingError: pct(0.5),
      holdings: value(['GSVD', 'RSNH', 'VTBR']),
      sectorExposure: value({ 'Гос. облигации': 0.6, 'Корпоративные': 0.4 }),
      currencyExposure: value({ RUB: 1 }),
      dividendPolicy: str('Ежеквартально'),
    };

    expect(hasValue(etf.benchmark)).toBe(true);
    expect(etf.benchmark.value).toBe('IMOEX');
    expect(hasValue(etf.aum)).toBe(true);
    expect(etf.aum.value).toBe(5000000000);
    expect(hasValue(etf.expenseRatio)).toBe(true);
    expect(etf.expenseRatio.value).toBe(0.3);
  });
});

// ═══════════════════════════════════════════════
// 11. MacroResearch
// ═══════════════════════════════════════════════

describe('MacroResearch', () => {
  it('keyRate/rateRegime/inflation могут быть VALUE или NO_DATA', () => {
    const macroWithValue: MacroResearch = {
      keyRate: pct(21),
      inflation: pct(7.5),
      inflationTrend: str('Снижение'),
      fx: pct(92.5),
      oil: rub(75),
      commodityRegime: value('SIDEWAYS'),
      liquidityRegime: value('NORMAL'),
      economicCycle: value('EXPANSION'),
      rateRegime: value('HOLDING'),
    };

    expect(hasValue(macroWithValue.keyRate)).toBe(true);
    expect(macroWithValue.keyRate.value).toBe(21);
    expect(hasValue(macroWithValue.rateRegime)).toBe(true);
    expect(macroWithValue.rateRegime.value).toBe('HOLDING');
    expect(hasValue(macroWithValue.inflation)).toBe(true);
    expect(macroWithValue.inflation.value).toBe(7.5);
  });

  it('все поля могут быть NO_DATA', () => {
    const macroNoData: MacroResearch = {
      keyRate: noData(),
      inflation: noData(),
      inflationTrend: noData(),
      fx: noData(),
      oil: noData(),
      commodityRegime: noData(),
      liquidityRegime: noData(),
      economicCycle: noData(),
      rateRegime: noData(),
    };

    expect(hasValue(macroNoData.keyRate)).toBe(false);
    expect(hasValue(macroNoData.rateRegime)).toBe(false);
    expect(hasValue(macroNoData.inflation)).toBe(false);
  });
});

// ═══════════════════════════════════════════════
// 12. NewsResearch
// ═══════════════════════════════════════════════

describe('NewsResearch', () => {
  it('NewsItem содержит importance/sentiment/relevanceToIssuer', () => {
    const newsItem: NewsItem = {
      title: 'Сбербанк отчитался о прибыли',
      date: '2025-04-30T10:00:00Z',
      source: 'Интерфакс',
      url: 'https://example.com/news/1',
      importance: 'HIGH',
      sentiment: 'POSITIVE',
      summary: 'Чистая прибыль выросла на 15%',
      relevanceToIssuer: 0.9,
    };

    expect(newsItem.importance).toBe('HIGH');
    expect(newsItem.sentiment).toBe('POSITIVE');
    expect(newsItem.relevanceToIssuer).toBe(0.9);
    expect(newsItem.relevanceToIssuer).toBeGreaterThanOrEqual(0);
    expect(newsItem.relevanceToIssuer).toBeLessThanOrEqual(1);
  });

  it('NewsResearch содержит массив items', () => {
    const newsResearch: import('./types.js').NewsResearch = {
      items: [
        {
          title: 'Новость 1',
          date: '2025-04-30T10:00:00Z',
          source: 'Источник 1',
          url: 'https://example.com/1',
          importance: 'MEDIUM',
          sentiment: 'NEUTRAL',
          summary: 'Нейтральная новость',
          relevanceToIssuer: 0.5,
        },
        {
          title: 'Новость 2',
          date: '2025-05-01T12:00:00Z',
          source: 'Источник 2',
          url: 'https://example.com/2',
          importance: 'CRITICAL',
          sentiment: 'NEGATIVE',
          summary: 'Важная негативная новость',
          relevanceToIssuer: 0.95,
        },
      ],
    };

    expect(newsResearch.items.length).toBe(2);
    expect(newsResearch.items[0].importance).toBe('MEDIUM');
    expect(newsResearch.items[1].importance).toBe('CRITICAL');
  });
});

// ═══════════════════════════════════════════════
// 13. ResearchEvidence
// ═══════════════════════════════════════════════

describe('ResearchEvidence', () => {
  it('evidence имеет id, source, claim и provenance поля', () => {
    const evidence: ResearchEvidence = {
      id: 'ev-001',
      type: 'FINANCIAL',
      source: 'Отчёт ПАО Сбербанк',
      url: 'https://www.sberbank.ru/ru/investor/financial_reports',
      publishedAt: '2025-03-31T00:00:00Z',
      retrievedAt: '2025-04-01T10:00:00Z',
      claim: 'Выручка за 2024 год составила 4.5 трлн рублей',
      confidence: 0.95,
    };

    expect(evidence.id).toBe('ev-001');
    expect(evidence.type).toBe('FINANCIAL');
    expect(evidence.source).toBe('Отчёт ПАО Сбербанк');
    expect(evidence.claim).toBe('Выручка за 2024 год составила 4.5 трлн рублей');
    expect(evidence.confidence).toBe(0.95);
    expect(evidence.url).toBe('https://www.sberbank.ru/ru/investor/financial_reports');
    expect(evidence.publishedAt).toBe('2025-03-31T00:00:00Z');
    expect(evidence.retrievedAt).toBe('2025-04-01T10:00:00Z');
  });
});

// ═══════════════════════════════════════════════
// 14. Evidence linkage
// ═══════════════════════════════════════════════

describe('Evidence linkage', () => {
  it('ResearchValue.evidenceIds может ссылаться на ResearchEvidence.id', () => {
    const evidence: ResearchEvidence = {
      id: 'ev-revenue-001',
      type: 'FINANCIAL',
      source: 'Бухгалтерская отчётность',
      url: 'https://example.com/report',
      publishedAt: '2025-01-01T00:00:00Z',
      retrievedAt: '2025-01-02T00:00:00Z',
      claim: 'Выручка = 1 000 000',
      confidence: 1.0,
    };

    const revenue: ResearchValue<number> = value(1000000, {
      unit: 'RUB',
      evidenceIds: [evidence.id],
    });

    expect(revenue.status).toBe('VALUE');
    expect(revenue.value).toBe(1000000);
    expect(revenue.evidenceIds).toContain(evidence.id);
    expect(revenue.evidenceIds).toEqual(['ev-revenue-001']);
  });
});

// ═══════════════════════════════════════════════
// 15. AssetResearchSnapshot
// ═══════════════════════════════════════════════

describe('AssetResearchSnapshot', () => {
  it('объединяет research-сущности и evidence', () => {
    const evidence1: ResearchEvidence = {
      id: 'ev-1',
      type: 'FINANCIAL',
      source: 'Отчёт',
      url: 'https://example.com/1',
      publishedAt: '2025-01-01T00:00:00Z',
      retrievedAt: '2025-01-02T00:00:00Z',
      claim: 'Revenue = 1M',
      confidence: 0.9,
    };

    const evidence2: ResearchEvidence = {
      id: 'ev-2',
      type: 'MARKET',
      source: 'MOEX',
      url: 'https://example.com/2',
      publishedAt: '2025-01-01T00:00:00Z',
      retrievedAt: '2025-01-02T00:00:00Z',
      claim: 'Price = 280',
      confidence: 0.95,
    };

    const snapshot: AssetResearchSnapshot = {
      identity: {
        ticker: 'SBER',
        name: 'ПАО Сбербанк',
        assetType: 'STOCK',
        issuer: 'ПАО Сбербанк',
        currency: 'RUB',
        market: 'MOEX',
      },
      issuerResearch: {
        businessDescription: str('Крупнейший банк России'),
        sector: str('Финансы'),
        industry: str('Банки'),
        financials: {
          revenue: value(1000000, { unit: 'RUB', evidenceIds: [evidence1.id] }),
          ebitda: value(300000, { unit: 'RUB' }),
          netIncome: value(200000, { unit: 'RUB' }),
          freeCashFlow: value(150000, { unit: 'RUB' }),
          debt: value(500000, { unit: 'RUB' }),
          netDebt: value(300000, { unit: 'RUB' }),
          roe: pct(15),
          roic: pct(12),
          margin: pct(20),
        },
        valuation: {
          pe: pct(8),
          evEbitda: pct(6),
          pb: pct(1.2),
          fcfYield: pct(5),
        },
        earningsTrend: {
          revenueGrowth: pct(10),
          netIncomeGrowth: pct(8),
          guidance: str('Рост'),
        },
        guidance: str('Оптимистичный'),
        dividend: {
          lastDividend: rub(35),
          dividendYield: pct(9.5),
          payoutRatio: pct(45),
        },
      },
      marketResearch: {
        currentPrice: value(280, { unit: 'RUB', evidenceIds: [evidence2.id] }),
        priceChange1D: pct(0.5),
        priceChange1W: pct(2.0),
        priceChange1M: pct(5.0),
        priceChangeYTD: pct(15.0),
        volatility: pct(25),
        volume: raw(15000000),
        liquidity: str('Высокая'),
        marketRegime: value('BULL'),
      },
      evidence: {
        'ev-1': evidence1,
        'ev-2': evidence2,
      },
    };

    expect(snapshot.identity.ticker).toBe('SBER');
    expect(hasValue(snapshot.issuerResearch!.financials.revenue)).toBe(true);
    expect(snapshot.issuerResearch!.financials.revenue.evidenceIds).toContain('ev-1');
    expect(hasValue(snapshot.marketResearch!.currentPrice)).toBe(true);
    expect(snapshot.marketResearch!.currentPrice.evidenceIds).toContain('ev-2');
    expect(Object.keys(snapshot.evidence)).toHaveLength(2);
    expect(snapshot.evidence['ev-1'].id).toBe('ev-1');
  });
});

// ═══════════════════════════════════════════════
// 16. AIRecommendation
// ═══════════════════════════════════════════════

describe('AIRecommendation', () => {
  it('содержит все обязательные поля', () => {
    const recommendation: AIRecommendation = {
      userTargetPercent: 15,
      portfolioMathStatus: 'BUY',
      aiRecommendedTargetPercent: pct(18),
      aiRecommendedAction: value('BUY'),
      confidence: pct(0.85),
      rationale: 'Актив недооценён по мультипликаторам',
      targetReason: 'Рост выручки на 15% в этом году',
      keyRisks: ['Регуляторный риск', 'Конкуренция'],
      keyCatalysts: ['Новый продукт', 'Выход на новый рынок'],
      agreementWithPortfolioMath: 'AGREE',
    };

    expect(recommendation.userTargetPercent).toBe(15);
    expect(recommendation.portfolioMathStatus).toBe('BUY');
    expect(hasValue(recommendation.aiRecommendedTargetPercent)).toBe(true);
    expect(recommendation.aiRecommendedTargetPercent.value).toBe(18);
    expect(hasValue(recommendation.aiRecommendedAction)).toBe(true);
    expect(recommendation.aiRecommendedAction.value).toBe('BUY');
    expect(recommendation.confidence.value).toBe(0.85);
    expect(recommendation.agreementWithPortfolioMath).toBe('AGREE');
    expect(recommendation.rationale).toBe('Актив недооценён по мультипликаторам');
    expect(recommendation.keyRisks).toHaveLength(2);
    expect(recommendation.keyCatalysts).toHaveLength(2);
  });

  it('aiRecommendedTargetPercent может быть NO_DATA', () => {
    const recommendation: AIRecommendation = {
      userTargetPercent: 10,
      portfolioMathStatus: 'NO_TARGET',
      aiRecommendedTargetPercent: noData(),
      aiRecommendedAction: noData(),
      confidence: noData(),
      rationale: 'Недостаточно данных для рекомендации',
      targetReason: '',
      keyRisks: [],
      keyCatalysts: [],
      agreementWithPortfolioMath: 'UNCERTAIN',
    };

    expect(hasValue(recommendation.aiRecommendedTargetPercent)).toBe(false);
    expect(hasValue(recommendation.aiRecommendedAction)).toBe(false);
    expect(hasValue(recommendation.confidence)).toBe(false);
    expect(recommendation.agreementWithPortfolioMath).toBe('UNCERTAIN');
  });
});

// ═══════════════════════════════════════════════
// 17. DataStatus semantics
// ═══════════════════════════════════════════════

describe('DataStatus semantics', () => {
  it('VALUE, NO_DATA и NOT_APPLICABLE не смешиваются', () => {
    const valueRv: ResearchValue<number> = value(42);
    const noDataRv: ResearchValue<never> = noData();
    const notApplicableRv: ResearchValue<never> = notApplicable();

    expect(valueRv.status).toBe('VALUE');
    expect(noDataRv.status).toBe('NO_DATA');
    expect(notApplicableRv.status).toBe('NOT_APPLICABLE');

    expect(valueRv.status).not.toBe(noDataRv.status);
    expect(valueRv.status).not.toBe(notApplicableRv.status);
    expect(noDataRv.status).not.toBe(notApplicableRv.status);

    expect(hasValue(valueRv)).toBe(true);
    expect(hasValue(noDataRv)).toBe(false);
    expect(hasValue(notApplicableRv)).toBe(false);
  });

  it('DataStatus принимает только 3 значения', () => {
    const statuses: DataStatus[] = ['VALUE', 'NO_DATA', 'NOT_APPLICABLE'];
    expect(statuses).toHaveLength(3);
    expect(statuses).toContain('VALUE');
    expect(statuses).toContain('NO_DATA');
    expect(statuses).toContain('NOT_APPLICABLE');
  });
});

// ═══════════════════════════════════════════════
// 18. getOr() и hasValue()
// ═══════════════════════════════════════════════

describe('getOr() и hasValue()', () => {
  it('getOr() возвращает значение для VALUE', () => {
    const rv = value(100);
    expect(getOr(rv, 0)).toBe(100);
  });

  it('getOr() возвращает defaultValue для NO_DATA', () => {
    const rv = noData();
    expect(getOr(rv, 42)).toBe(42);
  });

  it('getOr() возвращает defaultValue для NOT_APPLICABLE', () => {
    const rv = notApplicable();
    expect(getOr(rv, 99)).toBe(99);
  });

  it('hasValue() возвращает true только для VALUE', () => {
    const rvValue = value(42);
    const rvNoData = noData();
    const rvNotApplicable = notApplicable();

    expect(hasValue(rvValue)).toBe(true);
    expect(hasValue(rvNoData)).toBe(false);
    expect(hasValue(rvNotApplicable)).toBe(false);
  });
});

// ═══════════════════════════════════════════════
// 19. getUnsafe() compatibility
// ═══════════════════════════════════════════════

describe('getUnsafe()', () => {
  it('возвращает значение для VALUE', () => {
    const rv = value('test');
    expect(getUnsafe(rv)).toBe('test');
  });

  it('возвращает undefined для NO_DATA', () => {
    const rv = noData();
    expect(getUnsafe(rv)).toBeUndefined();
  });

  it('возвращает undefined для NOT_APPLICABLE', () => {
    const rv = notApplicable();
    expect(getUnsafe(rv)).toBeUndefined();
  });

  it('не ломает compatibility: можно использовать в if', () => {
    const rvValue = value(42);
    const rvNoData = noData();

    let result: number | undefined;

    if ((result = getUnsafe(rvValue))) {
      expect(result).toBe(42);
    }

    result = getUnsafe(rvNoData);
    expect(result).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// 20. NO_DATA не представляется числом 0
// ═══════════════════════════════════════════════

describe('NO_DATA не представляется числом 0', () => {
  it('NO_DATA.status !== "VALUE"', () => {
    const noDataRv = noData();
    expect(noDataRv.status).not.toBe('VALUE');
  });

  it('NO_DATA.value === undefined (не 0)', () => {
    const noDataRv = noData();
    expect(noDataRv.value).toBeUndefined();
    expect(noDataRv.value).not.toBe(0);
  });

  it('hasValue(NO_DATA) === false', () => {
    const noDataRv = noData();
    expect(hasValue(noDataRv)).toBe(false);
  });

  it('getOr(NO_DATA, 0) === 0, но это defaultValue, не значение', () => {
    const noDataRv = noData();
    const result = getOr(noDataRv, 0);
    expect(result).toBe(0);
    expect(noDataRv.status).toBe('NO_DATA');
  });
});
