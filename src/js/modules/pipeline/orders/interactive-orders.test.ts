/// <reference types="vitest/globals" />
/**
 * Тесты генерации интерактивных ордеров:
 * политика no-sell пользователя — задаётся ВНЕ кода (env/файл user-policy),
 * тикеры из списка не продаются: REDUCE/EXIT → HOLD с guardrail-предупреждением.
 */

import {
  buildInteractiveOrders,
  type InteractiveOrder,
} from './interactive-orders.js';
import {
  loadUserPolicy,
  resetUserPolicyCache,
} from '../../../config/user-policy.js';
import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';

function makeAsset(overrides: Partial<AssetAnalysis>): AssetAnalysis {
  return {
    ticker: 'SBER',
    name: 'Сбербанк',
    currentPercent: 12,
    targetPercent: 6,
    currentPrice: 100,
    balancePrice: 110,
    quantity: 100,
    deficitRub: -600,
    status: 'REDUCE',
    ...overrides,
  } as unknown as AssetAnalysis;
}

function firstOrder(orders: InteractiveOrder[]): InteractiveOrder {
  const order = orders[0];
  if (!order) throw new Error('Ордера не сгенерированы');
  return order;
}

describe('InteractiveOrders: политика no-sell пользователя', () => {
  beforeAll(() => {
    // Политика задаётся env (в рантайме — файлом data/user-policy.json)
    process.env.PORTFOLIO_NO_SELL_TICKERS = 'PLZL';
    resetUserPolicyCache();
  });

  afterAll(() => {
    delete process.env.PORTFOLIO_NO_SELL_TICKERS;
    resetUserPolicyCache();
  });

  it('политика читается из конфигурации, а не из кода', () => {
    expect(loadUserPolicy().noSellTickers).toEqual(['PLZL']);
  });

  it('REDUCE для no-sell тикера → HOLD с предупреждением NO_SELL_POLICY', () => {
    const orders = buildInteractiveOrders([
      makeAsset({ ticker: 'PLZL', status: 'REDUCE', currentPercent: 28 }),
    ]);
    const order = firstOrder(orders);
    expect(order.action).toBe('HOLD');
    expect(order.recommendedQuantity).toBe(0);
    expect(order.totalAmount).toBe(0);
    expect(
      order.guardrailWarnings?.some((w) => w.includes('NO_SELL_POLICY')),
    ).toBe(true);
  });

  it('EXIT для no-sell тикера → HOLD', () => {
    const orders = buildInteractiveOrders([
      makeAsset({ ticker: 'PLZL', status: 'EXIT' }),
    ]);
    expect(firstOrder(orders).action).toBe('HOLD');
  });

  it('REDUCE для обычного тикера остаётся REDUCE (политика не задета)', () => {
    const orders = buildInteractiveOrders([
      makeAsset({ ticker: 'SBER', status: 'REDUCE' }),
    ]);
    const order = firstOrder(orders);
    expect(order.action).toBe('REDUCE');
    expect(order.recommendedQuantity).toBeGreaterThan(0);
    expect(
      order.guardrailWarnings?.some((w) => w.includes('NO_SELL_POLICY')),
    ).toBeFalsy();
  });

  it('BUY для no-sell тикера не затрагивается политикой', () => {
    const orders = buildInteractiveOrders([
      makeAsset({
        ticker: 'PLZL',
        status: 'BUY',
        deficitRub: 5000,
        currentPercent: 5,
        targetPercent: 8,
      }),
    ]);
    const order = firstOrder(orders);
    expect(order.action).toBe('BUY');
    expect(order.recommendedQuantity).toBeGreaterThan(0);
  });
});
