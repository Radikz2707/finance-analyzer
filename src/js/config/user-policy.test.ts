import { loadUserPolicy, resetUserPolicyCache } from './user-policy.js';

describe('user-policy', () => {
  afterEach(() => {
    delete process.env.PORTFOLIO_NO_SELL_TICKERS;
    delete process.env.PORTFOLIO_NO_SELL_ASSET_TYPES;
    resetUserPolicyCache();
  });

  it('читает noSellTickers и noSellAssetTypes из env', () => {
    process.env.PORTFOLIO_NO_SELL_TICKERS = 'PLZL, sber';
    process.env.PORTFOLIO_NO_SELL_ASSET_TYPES = 'О, Облигация';
    resetUserPolicyCache();

    const policy = loadUserPolicy();

    expect(policy.noSellTickers).toEqual(['PLZL', 'SBER']);
    expect(policy.noSellAssetTypes).toEqual(['О', 'ОБЛИГАЦИЯ']);
  });

  it('не теряет noSellAssetTypes при переопределении только тикеров', () => {
    process.env.PORTFOLIO_NO_SELL_TICKERS = 'PLZL';
    resetUserPolicyCache();

    const policy = loadUserPolicy();

    expect(policy.noSellTickers).toEqual(['PLZL']);
    expect(Array.isArray(policy.noSellAssetTypes)).toBe(true);
  });
});
