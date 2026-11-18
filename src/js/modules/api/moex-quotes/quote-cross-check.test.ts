import { vi } from 'vitest';

import { PortfolioConfig } from '../../../config/portfolio-config.js';
import { buildLiquidityFact, crossCheckQuotes } from './quote-cross-check.js';

describe('crossCheckQuotes', () => {
  it('в пределах допуска — без warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const [result] = crossCheckQuotes(
      [{ ticker: 'PLZL', price: 1100, asOf: '2026-11-18T13:00:00Z' }],
      [{ ticker: 'PLZL', price: 1105, asOf: '2026-11-18T13:05:00Z' }],
    );

    expect(result?.exceeded).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('превышение допуска → warning с обеими ценами и временем срезов', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const [result] = crossCheckQuotes(
      [
        {
          ticker: 'PLZL',
          price: 1100,
          asOf: '2026-11-18T13:00:00Z',
          source: 'MOEX ISS',
        },
      ],
      [
        {
          ticker: 'PLZL',
          price: 1000,
          asOf: '2026-11-18T13:05:00Z',
          source: 'MOEX ISS',
        },
      ],
    );

    const message = (result?.message ?? '').replace(/\u00a0/g, ' ');
    expect(result?.exceeded).toBe(true);
    expect(message).toContain('1 100,00');
    expect(message).toContain('1 000,00');
    expect(message).toContain('допуске');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[QUOTE_CROSS_CHECK] ticker=PLZL'),
    );
    warn.mockRestore();
  });

  it('допуск берётся из конфига (в тесте — другой)', () => {
    const [strict] = crossCheckQuotes(
      [{ ticker: 'SBER', price: 100 }],
      [{ ticker: 'SBER', price: 103 }],
      1,
    );
    const [loose] = crossCheckQuotes(
      [{ ticker: 'SBER', price: 100 }],
      [{ ticker: 'SBER', price: 103 }],
      5,
    );

    expect(strict?.exceeded).toBe(true);
    expect(loose?.exceeded).toBe(false);
    expect(PortfolioConfig.quoteCrossCheck.tolerancePct).toBe(1);
  });

  it('нет одной из цен → сверка не выполняется (fail-closed)', () => {
    const results = crossCheckQuotes(
      [{ ticker: 'PLZL', price: null }],
      [{ ticker: 'PLZL', price: 1100 }],
    );

    expect(results).toEqual([]);
  });

  it('нет тикера в дашборде → сверка не выполняется', () => {
    const results = crossCheckQuotes(
      [{ ticker: 'PLZL', price: 1100 }],
      [{ ticker: 'SBER', price: 300 }],
    );

    expect(results).toEqual([]);
  });
});

describe('buildLiquidityFact', () => {
  it('считает долю партии в дневном обороте', () => {
    const fact = buildLiquidityFact(100_000, 2_000_000).replace(/\u00a0/g, ' ');
    expect(fact).toContain('5.00%');
    expect(fact).toContain('100 000,00');
  });

  it('нет оборота → «недоступен», а не 0%', () => {
    expect(buildLiquidityFact(100_000, null)).toContain('недоступен');
  });

  it('нет размера партии → только оборот', () => {
    const fact = buildLiquidityFact(null, 2_000_000);
    expect(fact).toContain('Дневной оборот');
    expect(fact).not.toContain('%');
  });
});
