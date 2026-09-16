/**
 * Issuer Normalizer — преобразование сырых данных эмитента
 * в ResearchValue<T>.
 *
 * 3-этапная архитектура:
 *   1. fetchRaw()    — получение сырых данных (issuer-fetcher.ts)
 *   2. normalize()   — преобразование в ResearchValue (этот файл)
 *   3. buildSnapshot() — построение IssuerResearch (provider)
 *
 * НЕ выдумывает данные.
 * Если поле отсутствует или невалидно → NO_DATA.
 */

import type { RawIssuerData } from './issuer-fetcher.js';
import type { ResearchEvidence } from '../types.js';
import { value, noData } from '../helpers.js';

// ──────────────────────────────────────────────
// 1. Типы результатов нормализации
// ──────────────────────────────────────────────

/** Результат нормализации одного показателя */
export interface NormalizedField<T> {
  /** ResearchValue с нормализованным значением */
  researchValue: import('../types.js').ResearchValue<T>;
  /** ID созданного ResearchEvidence (если есть VALUE) */
  evidenceId?: string;
}

/** Результат нормализации всех финансовых показателей */
export interface NormalizedFinancials {
  revenue: NormalizedField<number>;
  ebitda: NormalizedField<number>;
  netIncome: NormalizedField<number>;
  freeCashFlow: NormalizedField<number>;
  debt: NormalizedField<number>;
  netDebt: NormalizedField<number>;
  roe: NormalizedField<number>;
  roic: NormalizedField<number>;
  margin: NormalizedField<number>;
}

/** Результат нормализации всех мультипликаторов */
export interface NormalizedValuation {
  pe: NormalizedField<number>;
  evEbitda: NormalizedField<number>;
  pb: NormalizedField<number>;
  fcfYield: NormalizedField<number>;
}

/** Результат нормализации тренда прибыльности */
export interface NormalizedEarningsTrend {
  revenueGrowth: NormalizedField<number>;
  netIncomeGrowth: NormalizedField<number>;
  guidance: NormalizedField<string>;
}

/** Результат нормализации дивидендов */
export interface NormalizedDividend {
  lastDividend: NormalizedField<number>;
  dividendYield: NormalizedField<number>;
  payoutRatio: NormalizedField<number>;
}

// ──────────────────────────────────────────────
// 2. Утилиты создания ResearchValue + Evidence
// ──────────────────────────────────────────────

/**
 * Создать ResearchValue из числа с привязкой к evidence.
 * Если value === null/undefined → NO_DATA.
 */
function createNumberField(
  raw: unknown,
  evidence: Record<string, ResearchEvidence>,
  type: string,
  claim: string,
  sourceUrl: string,
  fetchedAt: string,
  unit?: string,
): NormalizedField<number> {
  if (raw === null || raw === undefined) {
    return { researchValue: noData() };
  }

  const num = typeof raw === 'number' ? raw : Number(raw);

  if (Number.isNaN(num) || !Number.isFinite(num)) {
    return { researchValue: noData() };
  }

  const evidenceId = `fin-${type}-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

  evidence[evidenceId] = {
    id: evidenceId,
    type: 'FINANCIAL' as const,
    source: 'Finam',
    url: sourceUrl,
    publishedAt: fetchedAt,
    retrievedAt: fetchedAt,
    claim,
    confidence: 0.85,
  };

  return {
    researchValue: value(num, { unit, evidenceIds: [evidenceId] }),
    evidenceId,
  };
}

/**
 * Создать ResearchValue из строки.
 * Если строка пустая → NO_DATA.
 */
function createStringField(
  raw: unknown,
  evidence: Record<string, ResearchEvidence>,
  type: string,
  claim: string,
  sourceUrl: string,
  fetchedAt: string,
): NormalizedField<string> {
  const str = typeof raw === 'string' ? raw.trim() : '';

  if (str === '') {
    return { researchValue: noData() };
  }

  const evidenceId = `fin-${type}-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

  evidence[evidenceId] = {
    id: evidenceId,
    type: 'FINANCIAL' as const,
    source: 'Finam',
    url: sourceUrl,
    publishedAt: fetchedAt,
    retrievedAt: fetchedAt,
    claim,
    confidence: 0.85,
  };

  return {
    researchValue: value(str, { evidenceIds: [evidenceId] }),
    evidenceId,
  };
}

// ──────────────────────────────────────────────
// 3. Извлечение полей из сырых данных Finam
// ──────────────────────────────────────────────

/**
 * Извлечь числовое поле из сырых данных Finam.
 *
 * Finam API возвращает данные в формате:
 *   { data: [[date, val1, val2, ...], ...], columns: [...] }
 *
 * Поля в raw.data[0] (последний период):
 *   - rev (выручка)
 *   - np (чистая прибыль)
 *   - debt_long, debt_short (долг)
 *   - fcf (денежный поток)
 */
function extractField(
  raw: RawIssuerData,
  fieldKey: string,
): number | null {
  if (!raw.raw || typeof raw.raw !== 'object') {
    return null;
  }

  const data = (raw.raw as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const columns = (raw.raw as Record<string, string[]>).columns;
  if (!Array.isArray(columns)) {
    return null;
  }

  const colIndex = columns.indexOf(fieldKey);
  if (colIndex === -1) {
    return null;
  }

  const row = data[0]; // последний период
  if (!Array.isArray(row) || colIndex >= row.length) {
    return null;
  }

  const val = row[colIndex];
  if (val === null || val === undefined || val === '') {
    return null;
  }

  const num = Number(val);
  return Number.isNaN(num) ? null : num;
}

// ──────────────────────────────────────────────
// 4. Нормализация
// ──────────────────────────────────────────────

/**
 * Нормализовать сырые данные эмитента в ResearchValue.
 *
 * Этап 2 из 3:
 *   fetchRaw() → normalize() → buildSnapshot()
 */
export function normalizeIssuerData(
  raw: RawIssuerData,
): {
  financials: NormalizedFinancials;
  valuation: NormalizedValuation;
  earningsTrend: NormalizedEarningsTrend;
  dividend: NormalizedDividend;
  evidence: Record<string, ResearchEvidence>;
  error?: string;
} {
  const evidence: Record<string, ResearchEvidence> = {};

  // Если есть ошибка источника — все поля NO_DATA
  if (raw.error) {
    return {
      financials: createAllNoDataFinancials(),
      valuation: createAllNoDataValuation(),
      earningsTrend: createAllNoDataEarningsTrend(),
      dividend: createAllNoDataDividend(),
      evidence: {},
      error: raw.error,
    };
  }

  // --- Financials ---
  const revenue = extractField(raw, 'rev');
  const netIncome = extractField(raw, 'np');
  const debtLong = extractField(raw, 'debt_long');
  const debtShort = extractField(raw, 'debt_short');
  const fcf = extractField(raw, 'fcf');

  const financials: NormalizedFinancials = {
    revenue: createNumberField(
      revenue, evidence, 'revenue',
      `Revenue for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, 'RUB',
    ),
    ebitda: createNumberField(
      extractField(raw, 'ebitda'), evidence, 'ebitda',
      `EBITDA for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, 'RUB',
    ),
    netIncome: createNumberField(
      netIncome, evidence, 'netIncome',
      `Net income for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, 'RUB',
    ),
    freeCashFlow: createNumberField(
      fcf, evidence, 'fcf',
      `Free cash flow for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, 'RUB',
    ),
    debt: createNumberField(
      debtLong !== null && debtShort !== null
        ? debtLong + debtShort
        : null,
      evidence, 'debt',
      `Total debt for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, 'RUB',
    ),
    netDebt: createNumberField(
      null, evidence, 'netDebt',
      `Net debt for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, 'RUB',
    ),
    roe: createNumberField(
      null, evidence, 'roe',
      `ROE for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, '%',
    ),
    roic: createNumberField(
      null, evidence, 'roic',
      `ROIC for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, '%',
    ),
    margin: createNumberField(
      revenue !== null && netIncome !== null && revenue !== 0
        ? (netIncome / revenue) * 100
        : null,
      evidence, 'margin',
      `Margin for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, '%',
    ),
  };

  // --- Valuation ---
  const pe = extractField(raw, 'pe');
  const evEbitda = extractField(raw, 'evebitda');
  const pb = extractField(raw, 'pb');
  const fcfYield = extractField(raw, 'fcfyield');

  const valuation: NormalizedValuation = {
    pe: createNumberField(
      pe, evidence, 'pe',
      `P/E for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, 'x',
    ),
    evEbitda: createNumberField(
      evEbitda, evidence, 'evebitda',
      `EV/EBITDA for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, 'x',
    ),
    pb: createNumberField(
      pb, evidence, 'pb',
      `P/B for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, 'x',
    ),
    fcfYield: createNumberField(
      fcfYield, evidence, 'fcfyield',
      `FCF yield for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, '%',
    ),
  };

  // --- Earnings Trend ---
  const revenueGrowth = extractField(raw, 'revgrowth');
  const netIncomeGrowth = extractField(raw, 'npgrowth');

  const earningsTrend: NormalizedEarningsTrend = {
    revenueGrowth: createNumberField(
      revenueGrowth, evidence, 'revgrowth',
      `Revenue growth for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, '%',
    ),
    netIncomeGrowth: createNumberField(
      netIncomeGrowth, evidence, 'npgrowth',
      `Net income growth for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, '%',
    ),
    guidance: createStringField(
      null, evidence, 'guidance',
      `Guidance for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt,
    ),
  };

  // --- Dividend ---
  const lastDividend = extractField(raw, 'div');
  const dividendYield = extractField(raw, 'divyield');
  const payoutRatio = extractField(raw, 'payout');

  const dividend: NormalizedDividend = {
    lastDividend: createNumberField(
      lastDividend, evidence, 'div',
      `Last dividend for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, 'RUB',
    ),
    dividendYield: createNumberField(
      dividendYield, evidence, 'divyield',
      `Dividend yield for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, '%',
    ),
    payoutRatio: createNumberField(
      payoutRatio, evidence, 'payout',
      `Payout ratio for ${raw.ticker}`, raw.sourceUrl, raw.fetchedAt, '%',
    ),
  };

  return { financials, valuation, earningsTrend, dividend, evidence };
}

/** Создать все поля как NO_DATA */
function createAllNoDataFinancials(): {
  revenue: NormalizedField<number>;
  ebitda: NormalizedField<number>;
  netIncome: NormalizedField<number>;
  freeCashFlow: NormalizedField<number>;
  debt: NormalizedField<number>;
  netDebt: NormalizedField<number>;
  roe: NormalizedField<number>;
  roic: NormalizedField<number>;
  margin: NormalizedField<number>;
} {
  return {
    revenue: { researchValue: noData() },
    ebitda: { researchValue: noData() },
    netIncome: { researchValue: noData() },
    freeCashFlow: { researchValue: noData() },
    debt: { researchValue: noData() },
    netDebt: { researchValue: noData() },
    roe: { researchValue: noData() },
    roic: { researchValue: noData() },
    margin: { researchValue: noData() },
  };
}

function createAllNoDataValuation(): {
  pe: NormalizedField<number>;
  evEbitda: NormalizedField<number>;
  pb: NormalizedField<number>;
  fcfYield: NormalizedField<number>;
} {
  return {
    pe: { researchValue: noData() },
    evEbitda: { researchValue: noData() },
    pb: { researchValue: noData() },
    fcfYield: { researchValue: noData() },
  };
}

function createAllNoDataEarningsTrend(): {
  revenueGrowth: NormalizedField<number>;
  netIncomeGrowth: NormalizedField<number>;
  guidance: NormalizedField<string>;
} {
  return {
    revenueGrowth: { researchValue: noData() },
    netIncomeGrowth: { researchValue: noData() },
    guidance: { researchValue: noData() },
  };
}

function createAllNoDataDividend(): {
  lastDividend: NormalizedField<number>;
  dividendYield: NormalizedField<number>;
  payoutRatio: NormalizedField<number>;
} {
  return {
    lastDividend: { researchValue: noData() },
    dividendYield: { researchValue: noData() },
    payoutRatio: { researchValue: noData() },
  };
}
