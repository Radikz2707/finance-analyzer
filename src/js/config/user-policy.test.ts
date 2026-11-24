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
    // Запрет по asset-type также не подставляется по умолчанию —
    // пользователь должен явно объявить его в user-policy.json.
    process.env.PORTFOLIO_NO_SELL_TICKERS = '';
    process.env.PORTFOLIO_NO_SELL_ASSET_TYPES = '';
    resetUserPolicyCache();

    const result = loadUserPolicyWithMeta();

    expect(result.policy.noSellTickers).toEqual([]);
    expect(result.policy.noSellAssetTypes).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/тикерные запреты не настроены/i);
    // Нет действующих запретов → restrictionsActive=false
    expect(result.restrictionsActive).toBe(false);
  });

  it('КРАСНЫЙ ТЕСТ: полный список тикеров «RU000A10EC22, PLZL» → оба в noSellTickers', () => {
    // Пользователь задаёт через env: "RU000A10EC22, PLZL"
    // Парсер должен распарсить ОБА идентификатора, не потерять ни один.
    process.env.PORTFOLIO_NO_SELL_TICKERS = 'RU000A10EC22, PLZL';
    resetUserPolicyCache();

    const policy = loadUserPolicy();

    expect(policy.noSellTickers).toContain('RU000A10EC22');
    expect(policy.noSellTickers).toContain('PLZL');
    expect(policy.noSellTickers).toHaveLength(2);
  });

  it('КРАСНЫЙ ТЕСТ: список из трёх тикеров с разными разделителями', () => {
    process.env.PORTFOLIO_NO_SELL_TICKERS = 'PLZL; SBER, GAZP';
    resetUserPolicyCache();

    const policy = loadUserPolicy();

    expect(policy.noSellTickers).toEqual(['PLZL', 'SBER', 'GAZP']);
  });
});
