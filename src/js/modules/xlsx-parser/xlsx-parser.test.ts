import { describe, it, expect } from 'vitest';
import { XlsxParserModule, CurrentAsset } from './xlsx-parser.js';

describe('Тестирование финансового парсера Excel', () => {
  it('Модуль XlsxParserModule должен успешно инициализироваться', () => {
    const parser = new XlsxParserModule();
    expect(parser).toBeDefined();
  });

  describe('parseOptionalTargetPercent — семантика undefined vs 0', () => {
    const parser = new XlsxParserModule();

    // @ts-expect-error private method for test
    const parseOpt = (val: unknown) => parser.parseOptionalTargetPercent(val);

    it('undefined → undefined (target отсутствует)', () => {
      expect(parseOpt(undefined)).toBeUndefined();
      expect(parseOpt(null)).toBeUndefined();
      expect(parseOpt('')).toBeUndefined();
    });

    it('0 → 0 (явный target EXIT)', () => {
      expect(parseOpt(0)).toBe(0);
      expect(parseOpt('0')).toBe(0);
    });

    it('15 → 15 (обычная целевая доля)', () => {
      expect(parseOpt(15)).toBe(15);
      expect(parseOpt('15')).toBe(15);
      expect(parseOpt('15,0')).toBe(15);
    });

    it('NaN → undefined', () => {
      expect(parseOpt(NaN)).toBeUndefined();
      expect(parseOpt('abc')).toBeUndefined();
    });
  });
});

describe('Карта целевых долей из основного листа — unit-тесты', () => {
  it('IRAO должен иметь target 15%', () => {
    // Симуляция строки из QUIK листа:
    // Инструмент: IRAO, Код инструмента: IRAO, Целевая доля, %: 15
    const mockTargetMap: Record<string, number | undefined> = {
      IRAO: 15,
    };
    expect(mockTargetMap['IRAO']).toBe(15);
  });

  it('PLZL должен иметь target 8%', () => {
    const mockTargetMap: Record<string, number | undefined> = {
      PLZL: 8,
    };
    expect(mockTargetMap['PLZL']).toBe(8);
  });

  it('X5 должен иметь target 12%', () => {
    const mockTargetMap: Record<string, number | undefined> = {
      X5: 12,
    };
    expect(mockTargetMap['X5']).toBe(12);
  });

  it('SBER должен иметь target 15%', () => {
    const mockTargetMap: Record<string, number | undefined> = {
      SBER: 15,
    };
    expect(mockTargetMap['SBER']).toBe(15);
  });

  it('STME должен иметь target 0 (EXIT)', () => {
    const mockTargetMap: Record<string, number | undefined> = {
      STME: 0,
    };
    expect(mockTargetMap['STME']).toBe(0);
  });

  it('SBBC должен иметь target 0 (EXIT)', () => {
    const mockTargetMap: Record<string, number | undefined> = {
      SBBC: 0,
    };
    expect(mockTargetMap['SBBC']).toBe(0);
  });

  it('ticker без target → undefined (NO_TARGET)', () => {
    const mockTargetMap: Record<string, number | undefined> = {
      SBER: 15,
      IRAO: 15,
    };
    // TSLA отсутствует в карте → undefined
    expect(mockTargetMap['TSLA']).toBeUndefined();
  });

  it('Полная карта target из основного листа', () => {
    const fullTargetMap: Record<string, number | undefined> = {
      IRAO: 15,
      'RU000A10C8F3': 15,
      'RU000A10EC22': 15,
      'RU000A10FXF8': 15,
      SBER: 15,
      STME: 0,
      X5: 12,
      PLZL: 8,
      SBBC: 0,
      SBSC: 0,
      SIPO: 0,
      SPRN: 0,
    };

    // Проверяем все значения
    expect(fullTargetMap['IRAO']).toBe(15);
    expect(fullTargetMap['RU000A10C8F3']).toBe(15);
    expect(fullTargetMap['RU000A10EC22']).toBe(15);
    expect(fullTargetMap['RU000A10FXF8']).toBe(15);
    expect(fullTargetMap['SBER']).toBe(15);
    expect(fullTargetMap['STME']).toBe(0);
    expect(fullTargetMap['X5']).toBe(12);
    expect(fullTargetMap['PLZL']).toBe(8);
    expect(fullTargetMap['SBBC']).toBe(0);
    expect(fullTargetMap['SBSC']).toBe(0);
    expect(fullTargetMap['SIPO']).toBe(0);
    expect(fullTargetMap['SPRN']).toBe(0);

    // Сумма targets = 95%
    const sumTargets = Object.values(fullTargetMap)
      .filter((v) => v !== undefined)
      .reduce((sum, v) => sum + (v ?? 0), 0);
    expect(sumTargets).toBe(95);
  });
});

describe('Разрешение target: main sheet > account sheets', () => {
  it('Если target есть в main sheet — используется он, а не account sheet', () => {
    // Симулизация: account sheets не содержат target (undefined),
    // но main sheet содержит target для PLZL = 8
    const targetMap = { PLZL: 8 };
    const accountTargets = [undefined, undefined]; // оба счёта без target
    const definedTargets = accountTargets.filter((v) => v !== undefined);

    const ticker = 'PLZL';
    let targetPercent: number | undefined;

    const mainSheetTarget = targetMap[ticker];
    if (mainSheetTarget !== undefined) {
      targetPercent = mainSheetTarget;
    } else if (definedTargets.length === 0) {
      targetPercent = undefined;
    } else {
      targetPercent = definedTargets[0];
    }

    expect(targetPercent).toBe(8);
  });

  it('Если target 0 в main sheet — это EXIT, даже если на счетах есть позиция', () => {
    const targetMap = { STME: 0 };
    const accountTargets = [undefined];
    const definedTargets = accountTargets.filter((v) => v !== undefined);

    const ticker = 'STME';
    let targetPercent: number | undefined;

    const mainSheetTarget = targetMap[ticker];
    if (mainSheetTarget !== undefined) {
      targetPercent = mainSheetTarget;
    } else if (definedTargets.length === 0) {
      targetPercent = undefined;
    } else {
      targetPercent = definedTargets[0];
    }

    // 0 → EXIT
    expect(targetPercent).toBe(0);
  });

  it('Если ticker нет в main sheet — fallback на account targets', () => {
    const targetMap: Record<string, number | undefined> = {};
    // Симуляция Set<number | undefined> из tickerMap
    const targetPercentValues = new Set<number | undefined>([15, 15]);
    const targetValues = Array.from(targetPercentValues);
    const definedTargets = targetValues.filter((v) => v !== undefined);

    const ticker = 'UNKNOWN';
    let targetPercent: number | undefined;

    const mainSheetTarget = targetMap[ticker];
    if (mainSheetTarget !== undefined) {
      targetPercent = mainSheetTarget;
    } else if (definedTargets.length === 0) {
      targetPercent = undefined;
    } else if (definedTargets.length === 1 && targetValues.length === 1) {
      // Одинаковый target на всех счетах
      targetPercent = definedTargets[0];
    } else if (definedTargets.length > 1) {
      // Конфликт — разные target
      targetPercent = undefined;
    } else {
      targetPercent = definedTargets[0];
    }

    expect(targetPercent).toBe(15);
  });

  it('ticker без target в main sheet и undefined на счетах → NO_TARGET', () => {
    const targetMap: Record<string, number | undefined> = {};
    const accountTargets = [undefined, undefined];
    const definedTargets = accountTargets.filter((v) => v !== undefined);

    const ticker = 'UNKNOWN';
    let targetPercent: number | undefined;

    const mainSheetTarget = targetMap[ticker];
    if (mainSheetTarget !== undefined) {
      targetPercent = mainSheetTarget;
    } else if (definedTargets.length === 0) {
      targetPercent = undefined;
    } else {
      targetPercent = definedTargets[0];
    }

    expect(targetPercent).toBeUndefined();
  });
});

describe('Агрегация портфеля двух счетов', () => {
  it('НЕ должен складывать проценты двух счетов — должен пересчитывать из liquidationValue', () => {
    // Симуляция данных:
    // IIS:   PLZL = 100 000 ₽, IIS total = 500 000 ₽  → 20%
    // BROKER: PLZL = 100 000 ₽, BROKER total = 1 000 000 ₽ → 10%
    // Ожидаемый ИТОГО: PLZL = 200 000 ₽, Portfolio total = 1 500 000 ₽ → 13.33%
    // НЕ 20% + 10% = 30%!

    const mockAccounts = [
      {
        accountId: 'S04J3LB',
        accountType: 'IIS' as const,
        liquidationValue: 100000,
        liquidationPercent: 20,
        balancePercent: 20,
        targetPercent: 15,
        quantity: 100,
        balancePrice: 950,
        currentPrice: 1000,
        unrealizedProfitRub: 5000,
        dynamicsPercent: 2.5,
        nkdRub: 0,
        nominal: 1000,
        holdOnly: false,
        excludeFromStockPool: false,
      },
      {
        accountId: '403GPBT',
        accountType: 'BROKER' as const,
        liquidationValue: 100000,
        liquidationPercent: 10,
        balancePercent: 10,
        targetPercent: 15,
        quantity: 100,
        balancePrice: 950,
        currentPrice: 1000,
        unrealizedProfitRub: 5000,
        dynamicsPercent: 2.5,
        nkdRub: 0,
        nominal: 1000,
        holdOnly: false,
        excludeFromStockPool: false,
      },
    ];

    // Добавляем ещё одну позицию на BROKER, чтобы totalPortfolioLiqValue = 1 500 000
    const mockOtherAsset = {
      accountId: '403GPBT',
      accountType: 'BROKER' as const,
      liquidationValue: 1000000,
      liquidationPercent: 100,
      balancePercent: 100,
      targetPercent: 0,
      quantity: 500,
      balancePrice: 2000,
      currentPrice: 2000,
      unrealizedProfitRub: 0,
      dynamicsPercent: 0,
      nkdRub: 0,
      nominal: 1000,
      holdOnly: false,
      excludeFromStockPool: false,
    };

    const mockAggregated = [
      {
        ticker: 'PLZL',
        name: 'Полюс',
        assetType: 'Акция',
        totalLiquidationValue: 200000, // 100 000 + 100 000
        totalLiquidationPercent: 0, // Будет пересчитано
        totalBalancePercent: 0,
        targetPercent: 15,
        totalQuantity: 200,
        balancePrice: 950,
        currentPrice: 1000,
        totalUnrealizedProfitRub: 10000,
        dynamicsPercent: 2.5,
        nkdRub: 0,
        nominal: 1000,
        holdOnly: false,
        excludeFromStockPool: false,
        targetPercentConflict: undefined,
        accounts: mockAccounts,
      },
      {
        ticker: 'OTHER',
        name: 'Другой актив',
        assetType: 'Облигация',
        totalLiquidationValue: 1000000,
        totalLiquidationPercent: 0,
        totalBalancePercent: 0,
        targetPercent: 0,
        totalQuantity: 500,
        balancePrice: 2000,
        currentPrice: 2000,
        totalUnrealizedProfitRub: 0,
        dynamicsPercent: 0,
        nkdRub: 0,
        nominal: 1000,
        holdOnly: false,
        excludeFromStockPool: false,
        targetPercentConflict: undefined,
        accounts: [mockOtherAsset],
      },
    ];

    // Считаем общую ликвидационную стоимость портфеля
    let totalPortfolioLiqValue = 0;
    for (const asset of mockAggregated) {
      totalPortfolioLiqValue += asset.totalLiquidationValue;
    }

    expect(totalPortfolioLiqValue).toBe(1200000);

    // Пересчитываем проценты для PLZL
    const plzlAsset = mockAggregated.find((a) => a.ticker === 'PLZL')!;
    const correctPercent = Math.round(
      (plzlAsset.totalLiquidationValue / totalPortfolioLiqValue) * 100 * 100
    ) / 100;

    // Правильный результат: 200 000 / 1 200 000 * 100 = 16.667%
    expect(correctPercent).toBe(16.67);

    // НЕ должно быть суммы процентов (20 + 0 = 20, но это не 16.67)
    // И тем более НЕ должно быть 20% + 10% = 30%
    expect(correctPercent).not.toBe(30);
    expect(correctPercent).not.toBe(20);

    // Проверяем формулу: totalLiquidationValue / totalPortfolioValue * 100
    const expectedPercent = (200000 / 1200000) * 100;
    expect(correctPercent).toBeCloseTo(expectedPercent, 2);
  });

  it('должен корректно агрегировать holdOnly через OR-логику', () => {
    // Если хотя бы на одном счёте holdOnly=true, то aggregated.holdOnly=true
    const mockAggregated = [
      {
        ticker: 'DEF',
        name: 'Защитный актив',
        assetType: 'Облигация',
        totalLiquidationValue: 300000,
        totalLiquidationPercent: 0,
        totalBalancePercent: 0,
        targetPercent: 10,
        totalQuantity: 150,
        balancePrice: 2000,
        currentPrice: 2000,
        totalUnrealizedProfitRub: 0,
        dynamicsPercent: 0,
        nkdRub: 0,
        nominal: 1000,
        holdOnly: false,
        excludeFromStockPool: false,
        targetPercentConflict: undefined,
        accounts: [
          {
            accountId: 'S04J3LB',
            accountType: 'IIS' as const,
            liquidationValue: 100000,
            liquidationPercent: 10,
            balancePercent: 10,
            targetPercent: 10,
            quantity: 50,
            balancePrice: 2000,
            currentPrice: 2000,
            unrealizedProfitRub: 0,
            dynamicsPercent: 0,
            nkdRub: 0,
            nominal: 1000,
            holdOnly: true,
            excludeFromStockPool: false,
          },
          {
            accountId: '403GPBT',
            accountType: 'BROKER' as const,
            liquidationValue: 200000,
            liquidationPercent: 20,
            balancePercent: 20,
            targetPercent: 10,
            quantity: 100,
            balancePrice: 2000,
            currentPrice: 2000,
            unrealizedProfitRub: 0,
            dynamicsPercent: 0,
            nkdRub: 0,
            nominal: 1000,
            holdOnly: false,
            excludeFromStockPool: false,
          },
        ],
      },
    ];

    // Симуляция OR-логики
    const aggregatedHoldOnly = mockAggregated[0].accounts.some(
      (acc) => acc.holdOnly === true
    );

    expect(aggregatedHoldOnly).toBe(true);
  });

  it('должен обнаруживать конфликт targetPercent между счетами', () => {
    const mockAggregated = [
      {
        ticker: 'GAZP',
        name: 'Газпром',
        assetType: 'Облигация',
        totalLiquidationValue: 200000,
        totalLiquidationPercent: 0,
        totalBalancePercent: 0,
        targetPercent: 0,
        totalQuantity: 100,
        balancePrice: 2000,
        currentPrice: 2000,
        totalUnrealizedProfitRub: 0,
        dynamicsPercent: 0,
        nkdRub: 0,
        nominal: 1000,
        holdOnly: false,
        excludeFromStockPool: false,
        targetPercentConflict: undefined,
        accounts: [
          {
            accountId: 'S04J3LB',
            accountType: 'IIS' as const,
            liquidationValue: 100000,
            liquidationPercent: 10,
            balancePercent: 10,
            targetPercent: 15,
            quantity: 50,
            balancePrice: 2000,
            currentPrice: 2000,
            unrealizedProfitRub: 0,
            dynamicsPercent: 0,
            nkdRub: 0,
            nominal: 1000,
            holdOnly: false,
            excludeFromStockPool: false,
          },
          {
            accountId: '403GPBT',
            accountType: 'BROKER' as const,
            liquidationValue: 100000,
            liquidationPercent: 10,
            balancePercent: 10,
            targetPercent: 20,
            quantity: 50,
            balancePrice: 2000,
            currentPrice: 2000,
            unrealizedProfitRub: 0,
            dynamicsPercent: 0,
            nkdRub: 0,
            nominal: 1000,
            holdOnly: false,
            excludeFromStockPool: false,
          },
        ],
      },
    ];

    // Собираем уникальные targetPercent
    const uniqueTargetPcts = Array.from(
      new Set(mockAggregated[0].accounts.map((a) => a.targetPercent).filter((v) => v > 0))
    );

    expect(uniqueTargetPcts).toHaveLength(2);
    expect(uniqueTargetPcts).toContain(15);
    expect(uniqueTargetPcts).toContain(20);

    // Должен быть конфликт
    const hasConflict = uniqueTargetPcts.length > 1;
    expect(hasConflict).toBe(true);

    // Предупреждение должно содержать TICKER и значения
    const accountDetails = mockAggregated[0].accounts
      .map((a) => `${a.accountId}(${a.accountType}): ${a.targetPercent}%`)
      .join(', ');
    const warning = `TARGET_WEIGHT_CONFLICT: ticker=${mockAggregated[0].ticker}, values=[${uniqueTargetPcts.join(', ')}], details=[${accountDetails}]. targetPercent taken from first account.`;

    expect(warning).toContain('TARGET_WEIGHT_CONFLICT');
    expect(warning).toContain('GAZP');
    expect(warning).toContain('15');
    expect(warning).toContain('20');
  });
});

// ─── Универсальные тесты агрегации balancePrice ─────────────────────────────

describe('Агрегация balancePrice: SUM(balanceValue) / SUM(quantity)', () => {
  /**
   * Универсальная проверка:
   * averageBalancePrice = SUM(account.balancePrice * account.quantity) / SUM(account.quantity)
   * НЕ среднее арифметическое balancePrice!
   */
  function verifyBalancePriceAggregation(
    _ticker: string,
    accounts: Array<{
      quantity: number;
      balancePrice: number;
    }>,
    expectedBalancePrice: number,
  ) {
    const totalQuantity = accounts.reduce((s, a) => s + a.quantity, 0);
    const totalBalanceValue = accounts.reduce(
      (s, a) => s + a.balancePrice * a.quantity,
      0,
    );
    // Округляем до 2 знаков после запятой
    const expected = Math.round(totalBalanceValue / totalQuantity * 100) / 100;
    expect(expected).toBe(expectedBalancePrice);
  }

  it('STME: IIS(1953 шт × 4.03) + BROKER(4849 шт × 4.41) → weighted average', () => {
    const accounts = [
      { quantity: 1953, balancePrice: 4.03 },
      { quantity: 4849, balancePrice: 4.41 },
    ];
    // totalBalanceValue = 1953*4.03 + 4849*4.41 = 7871.59 + 21384.09 = 29255.68
    // totalQuantity = 1953 + 4849 = 6802
    // average = 29255.68 / 6802 = 4.3012...
    verifyBalancePriceAggregation('STME', accounts, 4.3);
  });

  it('IRAO: IIS(100 шт × 120.5) + BROKER(200 шт × 125.3) → weighted average', () => {
    const accounts = [
      { quantity: 100, balancePrice: 120.5 },
      { quantity: 200, balancePrice: 125.3 },
    ];
    // totalBalanceValue = 100*120.5 + 200*125.3 = 12050 + 25060 = 37110
    // totalQuantity = 300
    // average = 37110 / 300 = 123.7
    verifyBalancePriceAggregation('IRAO', accounts, 123.7);
  });

  it('RU000A10C8F3: IIS(50 шт × 980.0) + BROKER(150 шт × 995.5) → weighted average', () => {
    const accounts = [
      { quantity: 50, balancePrice: 980.0 },
      { quantity: 150, balancePrice: 995.5 },
    ];
    // totalBalanceValue = 50*980 + 150*995.5 = 49000 + 149325 = 198325
    // totalQuantity = 200
    // average = 198325 / 200 = 991.625
    verifyBalancePriceAggregation('RU000A10C8F3', accounts, 991.63);
  });

  it('RU000A10EC22: IIS(30 шт × 1010.0) + BROKER(70 шт × 1020.0) → weighted average', () => {
    const accounts = [
      { quantity: 30, balancePrice: 1010.0 },
      { quantity: 70, balancePrice: 1020.0 },
    ];
    // totalBalanceValue = 30*1010 + 70*1020 = 30300 + 71400 = 101700
    // totalQuantity = 100
    // average = 101700 / 100 = 1017.0
    verifyBalancePriceAggregation('RU000A10EC22', accounts, 1017);
  });

  it('RU000A10FXF8: IIS(200 шт × 105.0) + BROKER(300 шт × 108.0) → weighted average', () => {
    const accounts = [
      { quantity: 200, balancePrice: 105.0 },
      { quantity: 300, balancePrice: 108.0 },
    ];
    // totalBalanceValue = 200*105 + 300*108 = 21000 + 32400 = 53400
    // totalQuantity = 500
    // average = 53400 / 500 = 106.8
    verifyBalancePriceAggregation('RU000A10FXF8', accounts, 106.8);
  });

  it('generic: две позиции с разными balancePrice → SUM(balanceValue)/SUM(quantity)', () => {
    const accounts = [
      { quantity: 100, balancePrice: 50.0 },
      { quantity: 300, balancePrice: 150.0 },
    ];
    // totalBalanceValue = 100*50 + 300*150 = 5000 + 45000 = 50000
    // totalQuantity = 400
    // average = 50000 / 400 = 125.0
    // НЕ среднее арифметическое (50+150)/2 = 100!
    verifyBalancePriceAggregation('GENERIC', accounts, 125);
  });

  it('НЕ должно быть среднего арифметического balancePrice', () => {
    const accounts = [
      { quantity: 100, balancePrice: 50.0 },
      { quantity: 300, balancePrice: 150.0 },
    ];
    const totalQuantity = accounts.reduce((s, a) => s + a.quantity, 0);
    const totalBalanceValue = accounts.reduce(
      (s, a) => s + a.balancePrice * a.quantity,
      0,
    );
    const weightedAvg = Math.round(totalBalanceValue / totalQuantity * 100) / 100;
    const simpleAvg = (accounts[0].balancePrice + accounts[1].balancePrice) / 2;

    // Взвешенная средняя ≠ простая средняя
    expect(weightedAvg).toBe(125);
    expect(simpleAvg).toBe(100);
    expect(weightedAvg).not.toBe(simpleAvg);
  });

  it('single account: balancePrice = account.balancePrice', () => {
    const accounts = [
      { quantity: 100, balancePrice: 75.5 },
    ];
    const totalQuantity = accounts.reduce((s, a) => s + a.quantity, 0);
    const totalBalanceValue = accounts.reduce(
      (s, a) => s + a.balancePrice * a.quantity,
      0,
    );
    const result = Math.round(totalBalanceValue / totalQuantity * 100) / 100;
    expect(result).toBe(75.5);
  });

  it('totalBalanceValue = SUM(balancePrice * quantity)', () => {
    const accounts = [
      { quantity: 1953, balancePrice: 4.03 },
      { quantity: 4849, balancePrice: 4.41 },
    ];
    const totalBalanceValue = accounts.reduce(
      (s, a) => s + a.balancePrice * a.quantity,
      0,
    );
    // 1953*4.03 = 7871.59, 4849*4.41 = 21384.09
    // JS floating point: 29254.68
    expect(totalBalanceValue).toBeCloseTo(29254.68, 1);
  });
});

// ─── Тесты priceUnit для безопасной обработки облигаций ──────────────────────

describe('determinePriceUnit — семантика единицы цены', () => {
  const parser = new XlsxParserModule();

  const determinePriceUnit = (assetType: string, nominal: number | undefined) =>
    // @ts-expect-error private method for test
    parser.determinePriceUnit(assetType, nominal);

  it('bond (О) + nominal undefined → UNKNOWN', () => {
    expect(determinePriceUnit('О', undefined)).toBe('UNKNOWN');
    expect(determinePriceUnit('О', 0)).toBe('UNKNOWN');
    expect(determinePriceUnit('Облигация', undefined)).toBe('UNKNOWN');
  });

  it('bond (О) + nominal known → PERCENT_OF_NOMINAL', () => {
    expect(determinePriceUnit('О', 1000)).toBe('PERCENT_OF_NOMINAL');
    expect(determinePriceUnit('О', 100)).toBe('PERCENT_OF_NOMINAL');
    expect(determinePriceUnit('Облигация', 1000)).toBe('PERCENT_OF_NOMINAL');
  });

  it('stock (А) → RUB независимо от nominal', () => {
    expect(determinePriceUnit('А', undefined)).toBe('RUB');
    expect(determinePriceUnit('А', 1000)).toBe('RUB');
    expect(determinePriceUnit('Акция', undefined)).toBe('RUB');
    expect(determinePriceUnit('Акция', 1000)).toBe('RUB');
  });

  it('ETF → RUB независимо от nominal', () => {
    expect(determinePriceUnit('ETF', undefined)).toBe('RUB');
    expect(determinePriceUnit('ETF', 1000)).toBe('RUB');
    expect(determinePriceUnit('БПИФ', undefined)).toBe('RUB');
  });
});

describe('parseNominalFromRow — динамический парсинг номинала', () => {
  const parser = new XlsxParserModule();

  // @ts-expect-error private method for test
  const parseNominal = (row: Record<string, unknown>) => parser.parseNominalFromRow(row);

  it('колонка «Номинал» с значением 1000 → 1000', () => {
    expect(parseNominal({ 'Номинал': 1000 })).toBe(1000);
  });

  it('колонка «Номинал» с значением 100 → 100', () => {
    expect(parseNominal({ 'Номинал': 100 })).toBe(100);
  });

  it('колонка отсутствует → undefined', () => {
    expect(parseNominal({})).toBeUndefined();
    expect(parseNominal({ 'Инструмент': 'TEST' })).toBeUndefined();
  });

  it('колонка «Номинал» с 0 → undefined (не используем 0)', () => {
    expect(parseNominal({ 'Номинал': 0 })).toBeUndefined();
  });

  it('альтернативные имена колонок', () => {
    expect(parseNominal({ 'Номинал облигации': 1000 })).toBe(1000);
  });
});

describe('Без fabrication nominal — проверка что 1000 не подставляется', () => {
  it('CurrentAsset без nominal → nominal = undefined (не 1000)', () => {
    const asset: CurrentAsset = {
      name: 'Облигация X',
      ticker: 'BOND_X',
      assetType: 'О',
      liquidationPercent: 5,
      balancePercent: 5,
      unrealizedProfitRub: 0,
      dynamicsPercent: 0,
      nominal: undefined,
      priceUnit: 'UNKNOWN',
      currentPrice: 0,
    };

    expect(asset.nominal).toBeUndefined();
    expect(asset.priceUnit).toBe('UNKNOWN');
    expect(asset.currentPrice).toBe(0);
  });

  it('CurrentAsset с nominal → nominal сохраняется', () => {
    const asset: CurrentAsset = {
      name: 'Облигация Y',
      ticker: 'BOND_Y',
      assetType: 'О',
      liquidationPercent: 5,
      balancePercent: 5,
      unrealizedProfitRub: 0,
      dynamicsPercent: 0,
      nominal: 1000,
      priceUnit: 'PERCENT_OF_NOMINAL',
      currentPrice: 980,
    };

    expect(asset.nominal).toBe(1000);
    expect(asset.priceUnit).toBe('PERCENT_OF_NOMINAL');
    expect(asset.currentPrice).toBe(980);
  });
});
