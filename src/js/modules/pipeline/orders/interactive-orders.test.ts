/// <reference types="vitest/globals" />
/**
 * Тесты генерации интерактивных ордеров:
 * политика no-sell пользователя — задаётся ВНЕ кода (env/файл user-policy),
 * тикеры из списка не продаются: REDUCE/EXIT → HOLD с guardrail-предупреждением.
 *
 * ИСПРАВЛЕНИЕ P0:
 * - Дедупликация по (ticker, accountId) для разграничения заявок на разных счетах
 * - MathAiAgreement обязателен при наличии активов
 * - Согласование объёма сделки (EXIT vs REDUCE = конфликт)
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
import type { MathAiAgreement } from '../../ai-advisor/math-ai-agreement.js';

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

function makeAgreement(
  overrides?: Partial<MathAiAgreement>,
): MathAiAgreement {
  return {
    ticker: 'SBER',
    mathAction: 'REDUCE',
    aiAction: 'REDUCE',
    finalAction: 'REDUCE',
    conflict: false,
    conflictReason: null,
    requiresReview: false,
    executionAllowed: true,
    status: 'AGREED',
    ...overrides,
  } as MathAiAgreement;
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
    ], [], new Map([['PLZL', makeAgreement({ ticker: 'PLZL' })]]));
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
    ], [], new Map([['PLZL', makeAgreement({ ticker: 'PLZL' })]]));
    expect(firstOrder(orders).action).toBe('HOLD');
  });

  it('REDUCE для обычного тикера остаётся REDUCE (политика не задета)', () => {
    const orders = buildInteractiveOrders([
      makeAsset({ ticker: 'SBER', status: 'REDUCE' }),
    ], [], new Map([['SBER', makeAgreement()]]));
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
    ], [], new Map([['PLZL', makeAgreement({ ticker: 'PLZL' })]]));
    const order = firstOrder(orders);
    expect(order.action).toBe('BUY');
    expect(order.recommendedQuantity).toBeGreaterThan(0);
  });
});

// ============================================================================
// ИСПРАВЛЕНИЕ P0: Дедупликация ордеров по (ticker, accountId)
// ============================================================================

describe('InteractiveOrders: дедупликация по тикеру и счёту', () => {
  it('две заявки STME SELL на разных счетах получают разные ID', () => {
    const assets: AssetAnalysis[] = [
      makeAsset({
        ticker: 'STME',
        accountId: 'S04J3LB',
        status: 'EXIT',
        quantity: 5,
        currentPercent: 0.1,
        targetPercent: 0,
      }),
      makeAsset({
        ticker: 'STME',
        accountId: '403GPBT',
        status: 'EXIT',
        quantity: 3,
        currentPercent: 0.05,
        targetPercent: 0,
      }),
    ];

    const agreements = new Map<string, MathAiAgreement>([
      [
        'STME',
        makeAgreement({
          ticker: 'STME',
          mathAction: 'EXIT',
          aiAction: 'EXIT',
          finalAction: 'EXIT',
        }),
      ],
    ]);

    const orders = buildInteractiveOrders(assets, [], agreements);

    // Должны быть созданы два ордера с разными ID
    expect(orders.length).toBe(2);
    const o0 = orders[0]!;
    const o1 = orders[1]!;
    expect(o0.id).not.toBe(o1.id);
    expect(o0.id).toContain('STME');
    expect(o0.id).toContain('EXIT');
    expect(o0.id).toContain('S04J3LB');
    expect(o1.id).toContain('403GPBT');
  });

  it('одинаковая заявка на одном счёте не дублируется', () => {
    const existingOrders = [
      { ticker: 'SBER', operation: 'BUY' as const, status: 'NEW', accountId: 'S04J3LB' },
    ];

    const assets = [
      makeAsset({
        ticker: 'SBER',
        accountId: 'S04J3LB',
        status: 'BUY',
      }),
    ];

    const agreements = new Map([['SBER', makeAgreement()]]);

    const orders = buildInteractiveOrders(assets, existingOrders, agreements);

    // Заявка уже есть с таким же действием → новая не создаётся
    expect(orders.length).toBe(0);
  });

  it('заявка на другом счёте создаётся даже при наличии заявки на первом', () => {
    const existingOrders = [
      { ticker: 'SBER', operation: 'SELL' as const, status: 'NEW', accountId: 'S04J3LB' },
    ];

    const assets = [
      makeAsset({
        ticker: 'SBER',
        accountId: '403GPBT', // другой счёт
        status: 'REDUCE',
      }),
    ];

    const agreements = new Map([['SBER', makeAgreement()]]);

    const orders = buildInteractiveOrders(assets, existingOrders, agreements);

    // Разный счёт → ордер создаётся
    expect(orders.length).toBe(1);
    expect(orders[0]!.id).toContain('403GPBT');
  });

  it('исполненная заявка (status=FILLED) не блокирует новую', () => {
    const existingOrders = [
      { ticker: 'SBER', operation: 'SELL' as const, status: 'ИСПОЛНЕНА', accountId: 'S04J3LB' },
    ];

    const assets = [
      makeAsset({
        ticker: 'SBER',
        accountId: 'S04J3LB',
        status: 'BUY',
      }),
    ];

    const agreements = new Map([['SBER', makeAgreement()]]);

    const orders = buildInteractiveOrders(assets, existingOrders, agreements);

    // Исполненная заявка не учитывается → новая создаётся
    expect(orders.length).toBe(1);
  });
});

// ============================================================================
// ИСПРАВЛЕНИЕ P0: MathAiAgreement обязателен
// ============================================================================

describe('InteractiveOrders: обязательность MathAiAgreement', () => {
  it('отсутствие mathAiAgreements при наличии активов блокирует генерацию', () => {
    const assets = [makeAsset({ ticker: 'SBER', status: 'BUY' })];

    const orders = buildInteractiveOrders(assets, []);

    expect(orders.length).toBe(0);
  });

  it('пустой массив активов не требует mathAiAgreements', () => {
    const orders = buildInteractiveOrders([]);

    expect(orders.length).toBe(0);
  });

  it('конфликт MathAiAgreement блокирует ордер', () => {
    const assets = [makeAsset({ ticker: 'PLZL', status: 'REDUCE' })];

    const agreements = new Map([
      [
        'PLZL',
        makeAgreement({
          ticker: 'PLZL',
          conflict: true,
          requiresReview: true,
          executionAllowed: false,
        }),
      ],
    ]);

    const orders = buildInteractiveOrders(assets, [], agreements);

    expect(orders.length).toBe(0);
  });
});
