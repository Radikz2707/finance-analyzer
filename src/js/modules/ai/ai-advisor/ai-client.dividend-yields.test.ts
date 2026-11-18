import { buildDividendYieldsFromFundamentals } from './ai-client.js';
import type {
  PortfolioFundamentalsContext,
  StockFundamentals,
} from '../../api/fundamentals/types.js';

function stock(
  ticker: string,
  dividendYield: number | null,
): StockFundamentals {
  return {
    ticker,
    dividendYield: {
      value: dividendYield,
      source: dividendYield === null ? null : 'smart-lab.ru',
      asOf: dividendYield === null ? null : '2026-11-17T00:00:00.000Z',
      status: dividendYield === null ? 'UNAVAILABLE' : 'VALUE',
    },
  } as unknown as StockFundamentals;
}

function context(assets: StockFundamentals[]): PortfolioFundamentalsContext {
  return {
    assets,
    warnings: [],
    asOf: '2026-11-17T00:00:00.000Z',
    smartLabEnabled: true,
  };
}

describe('buildDividendYieldsFromFundamentals', () => {
  it('извлекает положительные дивидендные доходности и нормализует тикер', () => {
    const result = buildDividendYieldsFromFundamentals(
      context([
        stock('irao', 9.4),
        stock('TATN', 7.1),
        stock('SBER', 0),
        stock('PLZL', null),
      ]),
    );

    expect(result).toEqual({ IRAO: 9.4, TATN: 7.1 });
  });

  it('пустой контекст → пустой объект', () => {
    expect(buildDividendYieldsFromFundamentals(undefined)).toEqual({});
    expect(buildDividendYieldsFromFundamentals(context([]))).toEqual({});
  });
});
