/**
 * Тесты для DataQualityValidator — валидации качества research-данных.
 *
 * Покрытие:
 * - validateAsset: отсутствие данных, полнота, freshness, статусы ResearchValue,
 *   аномальные цены, evidence, issuerResearch
 * - validateMultiple: агрегированный отчёт и сводка
 * - Настраиваемый maxAgeHours
 *
 * ВНИМАНИЕ: используются глобальные API vitest (globals: true),
 * т.к. явный import из 'vitest' ломает runner при CLI-фильтрах на этой машине.
 */

import type {
  AssetResearchSnapshot,
  IssuerResearch,
  MarketResearch,
  ResearchEvidence,
  AssetType,
} from '../../research/types.js';
import { DataQualityValidator } from './validation.js';

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function noData() {
  return { status: 'NO_DATA' } as const;
}

function createEvidence(id = 'ev1'): ResearchEvidence {
  return {
    id,
    type: 'MARKET',
    source: 'Moscow Exchange',
    url: 'https://www.moex.com',
    publishedAt: '2025-09-01T10:00:00Z',
    retrievedAt: '2025-09-01T10:00:00Z',
    claim: 'Цена закрытия 280 руб.',
    confidence: 0.95,
  };
}

function createMarketResearch(
  overrides?: Partial<MarketResearch>,
): MarketResearch {
  return {
    currentPrice: { status: 'VALUE', value: 280, evidenceIds: [] },
    volume: { status: 'VALUE', value: 1_000_000, evidenceIds: [] },
    priceChange1D: noData(),
    priceChange1W: noData(),
    priceChange1M: noData(),
    priceChangeYTD: noData(),
    volatility: noData(),
    liquidity: noData(),
    marketRegime: noData(),
    ...overrides,
  };
}

function createIssuerResearch(revenueValue?: number): IssuerResearch {
  return {
    businessDescription: noData(),
    sector: noData(),
    industry: noData(),
    financials: {
      revenue:
        revenueValue !== undefined
          ? { status: 'VALUE', value: revenueValue, evidenceIds: [] }
          : noData(),
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
}

function createSnapshot(
  overrides?: Partial<AssetResearchSnapshot>,
): AssetResearchSnapshot {
  return {
    identity: {
      ticker: 'SBER',
      name: 'ПАО Сбербанк',
      type: 'STOCK' as AssetType,
      assetType: 'STOCK',
      issuer: 'ПАО Сбербанк',
      currency: 'RUB',
      market: 'MOEX',
    },
    marketResearch: createMarketResearch(),
    issuerResearch: null,
    fundamentals: [],
    newsResearch: [],
    macroResearch: null,
    evidence: [createEvidence()],
    ...overrides,
  };
}

function findField(
  report: ReturnType<DataQualityValidator['validateAsset']>,
  fieldName: string,
) {
  return report.fields.find((f) => f.fieldName === fieldName);
}

// ═══════════════════════════════════════════════
// 1. validateAsset — отсутствие данных
// ═══════════════════════════════════════════════

describe('DataQualityValidator.validateAsset', () => {
  it('должен вернуть qualityScore 0 для null snapshot', () => {
    const report = new DataQualityValidator().validateAsset('SBER', null, null);

    expect(report.ticker).toBe('SBER');
    expect(report.qualityScore).toBe(0);
    expect(report.errors).toEqual(['Нет данных для актива']);
    expect(report.fields).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('должен вернуть 100% для полного валидного snapshot', () => {
    const report = new DataQualityValidator().validateAsset(
      'SBER',
      createSnapshot(),
      null,
    );

    expect(report.qualityScore).toBe(100);
    expect(report.errors).toEqual([]);
    expect(report.fields.map((f) => f.fieldName)).toEqual([
      'currentPrice',
      'volume',
      'evidenceCount',
    ]);
  });

  it('должен включить revenue при наличии issuerResearch', () => {
    const snapshot = createSnapshot({
      issuerResearch: createIssuerResearch(1_200_000_000_000),
    });
    const report = new DataQualityValidator().validateAsset(
      'SBER',
      snapshot,
      null,
    );

    expect(report.qualityScore).toBe(100);
    const revenue = findField(report, 'revenue');
    expect(revenue?.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 2. validateAsset — freshness
// ═══════════════════════════════════════════════

describe('DataQualityValidator.validateAsset (freshness)', () => {
  const HOUR_MS = 60 * 60 * 1000;

  it('должен пометить свежие данные как валидные', () => {
    const lastFetchedAt = new Date(Date.now() - HOUR_MS).toISOString();
    const report = new DataQualityValidator().validateAsset(
      'SBER',
      createSnapshot(),
      lastFetchedAt,
    );

    const freshness = findField(report, 'freshness');
    expect(freshness?.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.qualityScore).toBe(100);
  });

  it('должен пометить устаревшие данные как невалидные', () => {
    const lastFetchedAt = new Date(Date.now() - 48 * HOUR_MS).toISOString();
    const report = new DataQualityValidator().validateAsset(
      'SBER',
      createSnapshot(),
      lastFetchedAt,
    );

    const freshness = findField(report, 'freshness');
    expect(freshness?.valid).toBe(false);
    expect(freshness?.error).toContain('Данные устарели');
    expect(report.errors.some((e) => e.startsWith('Данные устарели:'))).toBe(
      true,
    );
    // 3 валидных поля из 4 → 75%
    expect(report.qualityScore).toBe(75);
  });

  it('должен учитывать кастомный maxAgeHours', () => {
    const validator = new DataQualityValidator({ maxAgeHours: 1 });

    const freshAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const staleAt = new Date(Date.now() - 2 * HOUR_MS).toISOString();

    const freshReport = validator.validateAsset(
      'SBER',
      createSnapshot(),
      freshAt,
    );
    const staleReport = validator.validateAsset(
      'SBER',
      createSnapshot(),
      staleAt,
    );

    expect(findField(freshReport, 'freshness')?.valid).toBe(true);
    expect(findField(staleReport, 'freshness')?.valid).toBe(false);
  });

  it('не должен добавлять поле freshness при отсутствии lastFetchedAt', () => {
    const report = new DataQualityValidator().validateAsset(
      'SBER',
      createSnapshot(),
      null,
    );

    expect(findField(report, 'freshness')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// 3. validateAsset — marketResearch и ResearchValue
// ═══════════════════════════════════════════════

describe('DataQualityValidator.validateAsset (marketResearch)', () => {
  it('должен пометить отсутствие marketResearch как ошибку', () => {
    const snapshot = createSnapshot({ marketResearch: undefined });
    const report = new DataQualityValidator().validateAsset(
      'SBER',
      snapshot,
      null,
    );

    const marketField = findField(report, 'marketResearch');
    expect(marketField?.valid).toBe(false);
    expect(marketField?.error).toBe('marketResearch отсутствует');
    expect(report.errors).toContain('marketResearch отсутствует');
    // marketResearch (invalid) + evidenceCount (valid) → 50%
    expect(report.qualityScore).toBe(50);
  });

  it('должен считать NO_DATA валидным статусом', () => {
    const snapshot = createSnapshot({
      marketResearch: createMarketResearch({
        currentPrice: { status: 'NO_DATA' },
      }),
    });
    const report = new DataQualityValidator().validateAsset(
      'SBER',
      snapshot,
      null,
    );

    const currentPrice = findField(report, 'currentPrice');
    expect(currentPrice?.valid).toBe(true);
    expect(currentPrice?.value).toBe('NO_DATA');
    expect(report.qualityScore).toBe(100);
  });

  it('должен считать NOT_APPLICABLE валидным статусом', () => {
    const snapshot = createSnapshot({
      marketResearch: createMarketResearch({
        currentPrice: { status: 'NOT_APPLICABLE' },
      }),
    });
    const report = new DataQualityValidator().validateAsset(
      'SBER',
      snapshot,
      null,
    );

    expect(findField(report, 'currentPrice')?.valid).toBe(true);
  });

  it('должен пометить отсутствие currentPrice как ошибку', () => {
    const snapshot = createSnapshot({
      marketResearch: createMarketResearch({ currentPrice: undefined }),
    });
    const report = new DataQualityValidator().validateAsset(
      'SBER',
      snapshot,
      null,
    );

    const currentPrice = findField(report, 'currentPrice');
    expect(currentPrice?.valid).toBe(false);
    expect(currentPrice?.error).toBe('currentPrice отсутствует');
    expect(report.errors).toContain('currentPrice отсутствует');
  });
});

// ═══════════════════════════════════════════════
// 4. validateAsset — аномалии и evidence
// ═══════════════════════════════════════════════

describe('DataQualityValidator.validateAsset (аномалии и evidence)', () => {
  it('должен обнаружить цену <= 0', () => {
    const snapshot = createSnapshot({
      marketResearch: createMarketResearch({
        currentPrice: { status: 'VALUE', value: 0, evidenceIds: [] },
      }),
    });
    const report = new DataQualityValidator().validateAsset(
      'SBER',
      snapshot,
      null,
    );

    const priceField = findField(report, 'price');
    expect(priceField?.valid).toBe(false);
    expect(priceField?.error).toBe('Цена <= 0');
    expect(report.errors).toContain('Аномальная цена: <= 0');
  });

  it('должен добавить warning при отсутствии evidence', () => {
    const snapshot = createSnapshot({ evidence: [] });
    const report = new DataQualityValidator().validateAsset(
      'SBER',
      snapshot,
      null,
    );

    const evidenceCount = findField(report, 'evidenceCount');
    expect(evidenceCount?.valid).toBe(false);
    expect(report.warnings).toContain('Нет evidence для актива');
  });

  it('должен пройти валидацию с evidence', () => {
    const report = new DataQualityValidator().validateAsset(
      'SBER',
      createSnapshot(),
      null,
    );

    const evidenceCount = findField(report, 'evidenceCount');
    expect(evidenceCount?.valid).toBe(true);
    expect(evidenceCount?.value).toBe(1);
    expect(report.warnings).toEqual([]);
  });
});

// ═══════════════════════════════════════════════
// 5. validateMultiple — агрегированный отчёт
// ═══════════════════════════════════════════════

describe('DataQualityValidator.validateMultiple', () => {
  it('должен вернуть пустой отчёт для пустого списка', () => {
    const report = new DataQualityValidator().validateMultiple([]);

    expect(report.totalAssets).toBe(0);
    expect(report.averageQualityScore).toBe(0);
    expect(report.assetReports).toEqual([]);
    expect(report.globalWarnings).toEqual([]);
    expect(report.reportDate).toBeDefined();
  });

  it('должен посчитать средний quality score и собрать warnings', () => {
    const report = new DataQualityValidator().validateMultiple([
      { ticker: 'SBER', snapshot: createSnapshot(), lastFetchedAt: null },
      { ticker: 'GAZP', snapshot: null, lastFetchedAt: null },
    ]);

    expect(report.totalAssets).toBe(2);
    expect(report.averageQualityScore).toBe(50);
    expect(report.globalWarnings).toEqual(['❌ GAZP: Нет данных для актива']);
    expect(report.assetReports).toHaveLength(2);
    expect(report.assetReports[0]?.qualityScore).toBe(100);
    expect(report.assetReports[1]?.qualityScore).toBe(0);
  });

  it('должен сформировать сводку с категориями', () => {
    const report = new DataQualityValidator().validateMultiple([
      { ticker: 'SBER', snapshot: createSnapshot(), lastFetchedAt: null },
      { ticker: 'GAZP', snapshot: null, lastFetchedAt: null },
    ]);

    expect(report.summary).toContain('Отчёт о качестве данных');
    expect(report.summary).toContain('Активов проверено: 2');
    expect(report.summary).toContain('Средний quality score: 50%');
    expect(report.summary).toContain('✅ Отлично: 1');
    expect(report.summary).toContain('⚠️ Требует внимания: 0');
    expect(report.summary).toContain('❌ Критично: 1');
    expect(report.summary).toContain('❌ GAZP: Нет данных для актива');
  });
});

// ═══════════════════════════════════════════════
// 6. DataQualityValidator — evidenceMode
// ═══════════════════════════════════════════════

describe('DataQualityValidator — evidenceMode', () => {
  it('evidenceMode=error (дефолт): evidence влияет на qualityScore', () => {
    const validator = new DataQualityValidator(); // дефолт 'error'
    const report = validator.validateAsset(
      'SBER',
      createSnapshot({ evidence: [] }),
      null,
    );

    // evidenceCount в fields → invalid → qualityScore падает
    const evidenceField = findField(report, 'evidenceCount');
    expect(evidenceField).toBeDefined();
    expect(evidenceField?.valid).toBe(false);
    expect(report.qualityScore).toBeLessThan(100);
  });

  it('evidenceMode=warning: evidence не влияет на qualityScore', () => {
    const validator = new DataQualityValidator({ evidenceMode: 'warning' });
    const report = validator.validateAsset(
      'SBER',
      createSnapshot({ evidence: [] }),
      null,
    );

    // evidenceCount НЕ в fields
    expect(findField(report, 'evidenceCount')).toBeUndefined();
    // qualityScore 100% (marketResearch currentPrice + volume валидны)
    expect(report.qualityScore).toBe(100);
    // Но warning есть
    expect(report.warnings).toContain('Нет evidence для актива');
  });

  it('evidenceMode=warning: с evidence — score 100%, без warnings', () => {
    const validator = new DataQualityValidator({ evidenceMode: 'warning' });
    const report = validator.validateAsset(
      'SBER',
      createSnapshot(), // evidence: [createEvidence()]
      null,
    );

    expect(report.qualityScore).toBe(100);
    expect(report.warnings).toEqual([]);
  });

  it('evidenceMode=error: с evidence — score 100%', () => {
    const validator = new DataQualityValidator({ evidenceMode: 'error' });
    const report = validator.validateAsset(
      'SBER',
      createSnapshot(),
      null,
    );

    expect(report.qualityScore).toBe(100);
  });

  it('бит-в-бит: без evidenceMode — прежнее поведение (error)', () => {
    const validator = new DataQualityValidator();
    const reportWithEvidence = validator.validateAsset(
      'SBER',
      createSnapshot(),
      null,
    );
    const reportWithoutEvidence = validator.validateAsset(
      'SBER',
      createSnapshot({ evidence: [] }),
      null,
    );

    // С evidence — 100%, без — < 100%
    expect(reportWithEvidence.qualityScore).toBe(100);
    expect(reportWithoutEvidence.qualityScore).toBeLessThan(100);
  });
});

// ═══════════════════════════════════════════════
// 7. DataQualityValidator — noDataMode
// ═══════════════════════════════════════════════

describe('DataQualityValidator — noDataMode', () => {
  it('noDataMode=skip (дефолт): NO_DATA не влияет на score', () => {
    const validator = new DataQualityValidator({ noDataMode: 'skip' });
    const snapshot = createSnapshot({
      marketResearch: createMarketResearch({
        currentPrice: noData(),
        volume: noData(),
      }),
      issuerResearch: createIssuerResearch(), // revenue = NO_DATA
    });
    const report = validator.validateAsset(
      'SBER',
      snapshot,
      null,
      'STOCK',
    );

    // NO_DATA считается валидным → score 100%
    expect(report.qualityScore).toBe(100);
    expect(report.errors).toEqual([]);
  });

  it('noDataMode=penalize: NO_DATA критичных полей снижает score', () => {
    const validator = new DataQualityValidator({ noDataMode: 'penalize' });
    const snapshot = createSnapshot({
      marketResearch: createMarketResearch({
        currentPrice: noData(),
        volume: noData(),
      }),
      issuerResearch: createIssuerResearch(), // revenue = NO_DATA
    });
    const report = validator.validateAsset(
      'SBER',
      snapshot,
      null,
      'STOCK',
    );

    // currentPrice, volume, revenue — критичные STOCK поля, все NO_DATA
    const criticalErrors = report.errors.filter((e) =>
      e.includes('NO_DATA') && e.includes('Критичное поле'),
    );
    expect(criticalErrors.length).toBeGreaterThanOrEqual(1);
    expect(report.qualityScore).toBeLessThan(100);
  });

  it('noDataMode=penalize: STOCK с полными данными → 100%', () => {
    const validator = new DataQualityValidator({ noDataMode: 'penalize' });
    const snapshot = createSnapshot(); // все поля VALUE
    const report = validator.validateAsset(
      'SBER',
      snapshot,
      null,
      'STOCK',
    );

    expect(report.qualityScore).toBe(100);
    const penalizeErrors = report.errors.filter((e) =>
      e.includes('NO_DATA') && e.includes('Критичное поле'),
    );
    expect(penalizeErrors.length).toBe(0);
  });

  it('noDataMode=penalize: BOND с sector=NO_DATA снижает score', () => {
    const validator = new DataQualityValidator({ noDataMode: 'penalize' });
    const snapshot = createSnapshot({
      marketResearch: createMarketResearch(),
      issuerResearch: createIssuerResearch(),
    });
    const report = validator.validateAsset(
      'RU000A10GC20',
      snapshot,
      null,
      'BOND',
    );

    // sector — критичное BOND поле, NO_DATA → penalty
    const sectorPenalty = report.errors.find((e) =>
      e.includes('sector') && e.includes('NO_DATA'),
    );
    expect(sectorPenalty).toBeDefined();
    expect(report.qualityScore).toBeLessThan(100);
  });

  it('noDataMode=penalize: BOND с sector+lastDividend=VALUE → 100%', () => {
    const validator = new DataQualityValidator({ noDataMode: 'penalize' });
    const snapshot = createSnapshot({
      issuerResearch: {
        ...createIssuerResearch(),
        sector: { status: 'VALUE', value: 'Корпорации', evidenceIds: [] },
        dividend: {
          lastDividend: { status: 'VALUE', value: 15.5, evidenceIds: [] },
          dividendYield: noData(),
          payoutRatio: noData(),
        },
      },
    });
    const report = validator.validateAsset(
      'RU000A10GC20',
      snapshot,
      null,
      'BOND',
    );

    expect(report.qualityScore).toBe(100);
  });

  it('noDataMode=penalize: BOND с lastDividend=NO_DATA снижает score', () => {
    const validator = new DataQualityValidator({ noDataMode: 'penalize' });
    const snapshot = createSnapshot({
      marketResearch: createMarketResearch(),
      issuerResearch: createIssuerResearch(),
    });
    const report = validator.validateAsset(
      'RU000A10GC20',
      snapshot,
      null,
      'BOND',
    );

    // lastDividend — критичное BOND поле, NO_DATA → penalty
    const lastDivPenalty = report.errors.find((e) =>
      e.includes('lastDividend') && e.includes('NO_DATA'),
    );
    expect(lastDivPenalty).toBeDefined();
    expect(report.qualityScore).toBeLessThan(100);
  });

  it('noDataMode=penalize: BOND с lastDividend=VALUE → 100%', () => {
    const validator = new DataQualityValidator({ noDataMode: 'penalize' });
    const snapshot = createSnapshot({
      marketResearch: createMarketResearch(),
      issuerResearch: {
        ...createIssuerResearch(),
        sector: { status: 'VALUE', value: 'Корпорации', evidenceIds: [] },
        dividend: {
          lastDividend: { status: 'VALUE', value: 15.5, evidenceIds: [] },
          dividendYield: noData(),
          payoutRatio: noData(),
        },
      },
    });
    const report = validator.validateAsset(
      'RU000A10GC20',
      snapshot,
      null,
      'BOND',
    );

    expect(report.qualityScore).toBe(100);
  });

  it('noDataMode=skip: бит-в-бит с дефолтом', () => {
    const defaultValidator = new DataQualityValidator();
    const skipValidator = new DataQualityValidator({ noDataMode: 'skip' });

    const snapshot = createSnapshot({
      marketResearch: createMarketResearch({
        currentPrice: noData(),
      }),
      issuerResearch: createIssuerResearch(),
    });

    const defaultReport = defaultValidator.validateAsset(
      'SBER',
      snapshot,
      null,
      'STOCK',
    );
    const skipReport = skipValidator.validateAsset(
      'SBER',
      snapshot,
      null,
      'STOCK',
    );

    // skip и дефолт должны давать одинаковый результат
    expect(skipReport.qualityScore).toBe(defaultReport.qualityScore);
  });

  it('validateMultiple передаёт assetType в validateAsset', () => {
    const validator = new DataQualityValidator({ noDataMode: 'penalize' });
    const report = validator.validateMultiple([
      {
        ticker: 'SBER',
        snapshot: createSnapshot({
          marketResearch: createMarketResearch({
            currentPrice: noData(),
          }),
        }),
        lastFetchedAt: null,
        assetType: 'STOCK',
      },
      {
        ticker: 'RU000A10GC20',
        snapshot: createSnapshot({
          issuerResearch: {
            ...createIssuerResearch(),
            sector: { status: 'VALUE', value: 'ОФЗ', evidenceIds: [] },
          },
        }),
        lastFetchedAt: null,
        assetType: 'BOND',
      },
    ]);

    expect(report.totalAssets).toBe(2);
    // SBER: STOCK с currentPrice=NO_DATA → penalty
    expect(report.assetReports[0]?.qualityScore).toBeLessThan(100);
    // GAZP: BOND с sector=VALUE → без penalty за sector
    expect(report.assetReports[1]?.qualityScore).toBeGreaterThanOrEqual(50);
  });
});
