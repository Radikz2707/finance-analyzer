import type { MoexBondQuote } from './bond-api.js';
import { compareBondYtm, type ExcelBondYield } from './bond-ytm-iss.js';

function makeIss(overrides: Partial<MoexBondQuote> = {}): MoexBondQuote {
  return {
    isin: 'BRUS2P04',
    nominal: 1000,
    pricePct: 84.28,
    yieldPct: 39.71,
    couponAmount: null,
    couponPeriodDays: null,
    board: 'TQCB',
    couponTypeInfo: {
      type: 'UNKNOWN',
      raw: null,
      source: 'ISS_DESCRIPTION',
    },
    asOf: '2026-11-18',
    ...overrides,
  };
}

function makeExcel(overrides: Partial<ExcelBondYield> = {}): ExcelBondYield {
  return {
    pricePct: 87.6,
    yieldPct: 35.65,
    asOf: '2026-11-13',
    ...overrides,
  };
}

function normalize(value: string): string {
  return value.replace(/\u00a0/g, ' ');
}

describe('compareBondYtm — Excel против MOEX ISS', () => {
  it('кейс Брус 2Р04: две доходности при двух ценах — оба значения корректны', () => {
    const result = compareBondYtm({
      isin: ' brus2p04 ',
      excel: makeExcel(),
      iss: makeIss(),
    });

    expect(result.isin).toBe('BRUS2P04');
    expect(result.iss?.yieldPct).toBe(39.71);
    expect(result.iss?.asOf).toBe('2026-11-18');
    expect(result.excel?.yieldPct).toBe(35.65);
    expect(result.excel?.asOf).toBe('2026-11-13');
    expect(result.priceDiffPct).toBeCloseTo(3.32, 2);
    expect(result.yieldDiffPct).toBeCloseTo(4.06, 2);
    expect(result.conflict).toBe(false);

    const explanation = normalize(result.explanation);
    expect(explanation).toContain(
      '39,71% при цене 84,28% (MOEX ISS, 18.11.2026)',
    );
    expect(explanation).toContain('35,65% при цене 87,60% (EXCEL, 13.11.2026)');
    expect(explanation).toContain('оба значения корректны при своих ценах');
  });

  it('одинаковая цена и расходящаяся доходность — противоречие источников', () => {
    const result = compareBondYtm({
      isin: 'BRUS2P04',
      excel: makeExcel({ pricePct: 84.3, yieldPct: 35.65 }),
      iss: makeIss(),
    });

    expect(result.conflict).toBe(true);
    expect(normalize(result.explanation)).toContain('Противоречие источников');
  });

  it('одинаковая цена и близкая доходность — источники согласованы', () => {
    const result = compareBondYtm({
      isin: 'BRUS2P04',
      excel: makeExcel({ pricePct: 84.3, yieldPct: 39.5 }),
      iss: makeIss(),
    });

    expect(result.conflict).toBe(false);
    expect(normalize(result.explanation)).toContain(
      'Источники согласованы в пределах допуска',
    );
  });

  it('без ISS-котировки остаётся Excel-проекция', () => {
    const result = compareBondYtm({
      isin: 'BRUS2P04',
      excel: makeExcel(),
      iss: null,
    });

    expect(result.iss).toBeNull();
    expect(result.excel?.yieldPct).toBe(35.65);
    expect(result.explanation).toContain('Котировка MOEX ISS недоступна');
  });

  it('без Excel-проекции остаётся доходность ISS', () => {
    const result = compareBondYtm({
      isin: 'BRUS2P04',
      excel: null,
      iss: makeIss(),
    });

    expect(result.excel).toBeNull();
    expect(result.explanation).toContain(
      'Excel-проекция недоступна, используется доходность MOEX ISS',
    );
  });

  it('нет ни Excel, ни ISS — честное «недоступно»', () => {
    const result = compareBondYtm({
      isin: 'BRUS2P04',
      excel: null,
      iss: null,
    });

    expect(result.iss).toBeNull();
    expect(result.excel).toBeNull();
    expect(result.conflict).toBe(false);
    expect(result.explanation).toBe(
      'Доходность недоступна: нет ни котировки MOEX ISS, ни Excel-проекции.',
    );
  });

  it('ISS без доходности: цена есть, доходность помечена недоступной', () => {
    const result = compareBondYtm({
      isin: 'BRUS2P04',
      excel: null,
      iss: makeIss({ yieldPct: null }),
    });

    expect(result.iss?.pricePct).toBe(84.28);
    expect(result.iss?.yieldPct).toBeNull();
    expect(result.yieldDiffPct).toBeNull();
    expect(normalize(result.explanation)).toContain('доходность недоступна');
  });

  it('нулевые и отрицательные значения не попадают в результат', () => {
    const result = compareBondYtm({
      isin: 'BRUS2P04',
      excel: { pricePct: 0, yieldPct: -5, asOf: null },
      iss: makeIss({ pricePct: 0, yieldPct: 0 }),
    });

    expect(result.iss).toBeNull();
    expect(result.excel).toBeNull();
  });
});
