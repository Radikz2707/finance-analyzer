import {
  buildPortfolioFundamentalsCacheKey,
  getPortfolioFundamentalsOnce,
  resetPortfolioFundamentalsOnce,
} from './fundamentals-api.js';

describe('getPortfolioFundamentalsOnce', () => {
  beforeEach(() => {
    resetPortfolioFundamentalsOnce();
  });

  it('возвращает один и тот же объект для одного набора тикеров', async () => {
    const first = await getPortfolioFundamentalsOnce([], {});
    const second = await getPortfolioFundamentalsOnce([], {});

    expect(first).toBe(second);
  });

  it('после reset создаёт новый объект', async () => {
    const first = await getPortfolioFundamentalsOnce([], {});
    resetPortfolioFundamentalsOnce();
    const second = await getPortfolioFundamentalsOnce([], {});

    expect(first).not.toBe(second);
  });

  it('нормализует порядок и регистр тикеров в ключе кэша', () => {
    expect(buildPortfolioFundamentalsCacheKey(['sber', 'TATN'])).toBe(
      buildPortfolioFundamentalsCacheKey(['TATN', 'SBER']),
    );
  });
});
