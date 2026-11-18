import { vi } from 'vitest';

import {
  loadUserPolicy,
  loadUserPolicyWithMeta,
  resetUserPolicyCache,
} from './user-policy.js';

// Тест не должен зависеть от реального data/user-policy.json пользователя.
// Подменяем только проверку существования файла политики.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (target: Parameters<typeof actual.existsSync>[0]) =>
      String(target).endsWith('user-policy.json')
        ? false
        : actual.existsSync(target),
  };
});

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

  it('не подставляет тикеры по умолчанию и предупреждает о пустой политике', () => {
    // Изолируемся от .env: в рабочем окружении пользователь может задать
    // PORTFOLIO_NO_SELL_TICKERS, но код не должен подставлять тикеры сам.
    process.env.PORTFOLIO_NO_SELL_TICKERS = '';
    process.env.PORTFOLIO_NO_SELL_ASSET_TYPES = '';
    resetUserPolicyCache();

    const result = loadUserPolicyWithMeta();

    expect(result.policy.noSellTickers).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/тикерные запреты не настроены/i);
    // Запреты по типам активов остаются страховочным дефолтом.
    expect(result.policy.noSellAssetTypes.length).toBeGreaterThan(0);
    expect(result.restrictionsActive).toBe(true);
  });
});
