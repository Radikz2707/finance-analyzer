import { buildQuotesBlock, type StockQuote } from './report-builders.js';

function quote(overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    ticker: 'SBER',
    name: 'Сбербанк',
    shortName: 'Сбербанк',
    currentPrice: 300,
    dailyDynamicsPercent: 1,
    volumeTodayRub: 100_000_000,
    source: 'MOEX ISS',
    asOf: '2026-11-18T13:00:00Z',
    ...overrides,
  };
}

describe('buildQuotesBlock — движение на низкой ликвидности', () => {
  it('помечает −9,90% при обороте 1,7 млн ₽ как «не сигнал»', () => {
    const result = buildQuotesBlock([
      quote({
        ticker: 'ETRN',
        shortName: 'ЕвроТранс',
        dailyDynamicsPercent: -9.9,
        volumeTodayRub: 1_700_000,
      }),
      quote(),
    ]);

    expect(result.lowLiquidityNote).toContain('ETRN');
    expect(result.lowLiquidityNote).toContain(
      'движение на низкой ликвидности, не сигнал',
    );
    expect(result.lowLiquidityNote).toContain(
      'Движение на низкой ликвидности (не сигнал)',
    );
  });

  it('значимое движение при достаточном обороте не помечается', () => {
    const result = buildQuotesBlock([
      quote({
        ticker: 'ETRN',
        dailyDynamicsPercent: -9.9,
        volumeTodayRub: 50_000_000,
      }),
    ]);

    expect(result.lowLiquidityNote).toBe('');
  });

  it('пустой список котировок — пустая пометка', () => {
    expect(buildQuotesBlock([]).lowLiquidityNote).toBe('');
  });
});

describe('buildQuotesBlock — изменение дня (fail-closed)', () => {
  it('NaN и undefined → «н/д», а не «NaN%»', () => {
    const result = buildQuotesBlock([
      quote({
        ticker: 'SELG',
        shortName: 'Селигдар',
        dailyDynamicsPercent: Number.NaN,
      }),
      quote({
        ticker: 'TATN',
        shortName: 'Татнефть',
        dailyDynamicsPercent: undefined as unknown as number,
      }),
    ]);

    expect(result.quotesTableRows).toContain('н/д');
    expect(result.quotesTableRows).not.toContain('NaN');
  });

  it('валидное изменение рендерится со знаком', () => {
    const result = buildQuotesBlock([
      quote({ ticker: 'SBER', dailyDynamicsPercent: 1.5 }),
      quote({ ticker: 'GAZP', dailyDynamicsPercent: -2.25 }),
    ]);

    expect(result.quotesTableRows).toContain('+1.50%');
    expect(result.quotesTableRows).toContain('-2.25%');
  });

  it('нулевое изменение остаётся «0.00%», а не «н/д»', () => {
    const result = buildQuotesBlock([quote({ dailyDynamicsPercent: 0 })]);

    expect(result.quotesTableRows).toContain('0.00%');
    expect(result.quotesTableRows).not.toContain('н/д');
  });
});

describe('buildQuotesBlock — порог заметности anomaly.noticePct', () => {
  it('движение 0,4% не попадает в топ и помечается шумом', () => {
    const result = buildQuotesBlock([
      quote({ ticker: 'SBER', dailyDynamicsPercent: 0.4 }),
      quote({ ticker: 'GAZP', dailyDynamicsPercent: -0.6 }),
    ]);

    expect(result.topGainers).toContain('Нет акций с положительной динамикой');
    expect(result.topLosers).toContain('Нет акций с отрицательной динамикой');
    expect(result.lowLiquidityNote).toContain(
      'Движения ниже порога заметности 1% — шум, топ не сформирован.',
    );
  });

  it('движение 1,2% попадает в топ роста', () => {
    const result = buildQuotesBlock([
      quote({ ticker: 'SBER', dailyDynamicsPercent: 1.2 }),
    ]);

    expect(result.topGainers).toContain('Сбербанк');
    expect(result.topGainers).toContain('+1.20%');
    expect(result.lowLiquidityNote).not.toContain('порог заметности');
  });

  it('движение −1,2% попадает в антитоп', () => {
    const result = buildQuotesBlock([
      quote({
        ticker: 'GAZP',
        shortName: 'Газпром',
        dailyDynamicsPercent: -1.2,
      }),
    ]);

    expect(result.topLosers).toContain('Газпром');
    expect(result.topLosers).toContain('-1.20%');
  });

  it('ровно порог 1% считается заметным', () => {
    const result = buildQuotesBlock([
      quote({ ticker: 'SBER', dailyDynamicsPercent: 1 }),
    ]);

    expect(result.topGainers).toContain('Сбербанк');
    expect(result.lowLiquidityNote).not.toContain('порог заметности');
  });
});
