import { mergeIssQuotes, type MergeableQuote } from './quote-merge.js';
import type { MoexCurrentQuote, MoexQuotesSnapshot } from './moex-quotes.js';

function excelQuote(
  ticker: string,
  overrides: Partial<MergeableQuote> = {},
): MergeableQuote {
  return {
    ticker,
    name: ticker,
    shortName: ticker,
    currentPrice: 100,
    dailyDynamicsPercent: 0,
    source: 'EXCEL',
    asOf: null,
    ...overrides,
  };
}

function issQuote(
  secid: string,
  overrides: Partial<MoexCurrentQuote> = {},
): MoexCurrentQuote {
  return {
    secid,
    board: 'TQBR',
    last: 200,
    changePct: 1.5,
    volume: 1000,
    turnover: 2_000_000,
    asOf: '2026-11-18T15:00:00.000Z',
    ...overrides,
  };
}

function snapshot(
  quotes: Record<string, MoexCurrentQuote>,
  unavailable: string[] = [],
): MoexQuotesSnapshot {
  return {
    asOf: '2026-11-18T15:00:00.000Z',
    quotes,
    unavailable,
  };
}

describe('mergeIssQuotes — MOEX ISS основной, Excel фолбэк', () => {
  it('ISS перезаписывает цену, изменение, оборот и время среза', () => {
    const result = mergeIssQuotes(
      {
        SBER: excelQuote('SBER', {
          currentPrice: 100,
          dailyDynamicsPercent: 9,
        }),
      },
      snapshot({ SBER: issQuote('SBER') }),
    );

    const sber = result.quotes['SBER'];
    expect(sber?.currentPrice).toBe(200);
    expect(sber?.dailyDynamicsPercent).toBe(1.5);
    expect(sber?.volumeTodayRub).toBe(2_000_000);
    expect(sber?.asOf).toBe('2026-11-18T15:00:00.000Z');
    expect(sber?.source).toBe('MOEX ISS');
    expect(result.applied).toEqual(['SBER']);
    expect(result.excelFallback).toEqual([]);
  });

  it('ISS не подтвердил тикер — Excel помечается фолбэком', () => {
    const result = mergeIssQuotes(
      { PLZL: excelQuote('PLZL', { currentPrice: 150 }) },
      snapshot({}, ['PLZL']),
    );

    const plzl = result.quotes['PLZL'];
    expect(plzl?.currentPrice).toBe(150);
    expect(plzl?.source).toBe('EXCEL (фолбэк)');
    expect(result.excelFallback).toEqual(['PLZL']);
    expect(result.issUnavailable).toEqual(['PLZL']);
  });

  it('ISS без изменения дня — сохраняется значение Excel', () => {
    const result = mergeIssQuotes(
      { GAZP: excelQuote('GAZP', { dailyDynamicsPercent: 0.4 }) },
      snapshot({ GAZP: issQuote('GAZP', { changePct: null }) }),
    );

    expect(result.quotes['GAZP']?.dailyDynamicsPercent).toBe(0.4);
    expect(result.quotes['GAZP']?.source).toBe('MOEX ISS');
  });

  it('ISS без оборота — сохраняется оборот Excel', () => {
    const result = mergeIssQuotes(
      { LKOH: excelQuote('LKOH', { volumeTodayRub: 555 }) },
      snapshot({ LKOH: issQuote('LKOH', { turnover: null }) }),
    );

    expect(result.quotes['LKOH']?.volumeTodayRub).toBe(555);
  });

  it('нулевая цена ISS не применяется (fail-closed)', () => {
    const result = mergeIssQuotes(
      { TATN: excelQuote('TATN') },
      snapshot({ TATN: issQuote('TATN', { last: null }) }),
    );

    expect(result.quotes['TATN']?.currentPrice).toBe(100);
    expect(result.quotes['TATN']?.source).toBe('EXCEL (фолбэк)');
    expect(result.applied).toEqual([]);
  });

  it('тикеры из ISS приводятся к верхнему регистру', () => {
    const result = mergeIssQuotes(
      { SBER: excelQuote('SBER') },
      snapshot({ ' sber ': issQuote('SBER') }),
    );

    expect(result.quotes['SBER']?.currentPrice).toBe(200);
    expect(result.applied).toEqual(['SBER']);
  });
});
