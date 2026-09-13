import { describe, it, expect } from 'vitest';
import { buildPortfolioSnapshot, parseBooleanValue, InternalAggregatedAsset } from './portfolio-snapshot.js';

describe('PortfolioSnapshot', () => {
  describe('parseBooleanValue', () => {
    it('true/false', () => {
      expect(parseBooleanValue(true)).toBe(true);
      expect(parseBooleanValue(false)).toBe(false);
    });

    it('1/0', () => {
      expect(parseBooleanValue(1)).toBe(true);
      expect(parseBooleanValue(0)).toBe(false);
    });

    it('TRUE/FALSE', () => {
      expect(parseBooleanValue('TRUE')).toBe(true);
      expect(parseBooleanValue('FALSE')).toBe(false);
    });

    it('да/нет', () => {
      expect(parseBooleanValue('да')).toBe(true);
      expect(parseBooleanValue('нет')).toBe(false);
    });

    it('yes/no', () => {
      expect(parseBooleanValue('yes')).toBe(true);
      expect(parseBooleanValue('no')).toBe(false);
    });

    it('default false', () => {
      expect(parseBooleanValue(null)).toBe(false);
      expect(parseBooleanValue(undefined)).toBe(false);
      expect(parseBooleanValue('')).toBe(false);
      expect(parseBooleanValue('random')).toBe(false);
    });
  });

  describe('buildPortfolioSnapshot', () => {
    // Вспомогательная функция для создания mock AggregatedAsset
    function mockAggregatedAsset(
      ticker: string,
      liqValue: number,
      balancePercent: number,
      liqPercent: number,
      targetPercent: number | undefined,
      holdOnly: boolean,
      excludeFromStockPool: boolean,
      accountId: string,
      accountType: 'IIS' | 'BROKER',
    ) {
      return {
        ticker,
        name: ticker,
        assetType: 'Акция',
        totalLiquidationValue: liqValue,
        totalLiquidationPercent: 0,
        totalBalancePercent: 0,
        targetPercent,
        totalQuantity: 100,
        balancePrice: 1000,
        currentPrice: 1000,
        totalUnrealizedProfitRub: 0,
        dynamicsPercent: 0,
        holdOnly,
        excludeFromStockPool,
        targetPercentConflict: undefined,
        accounts: [{
          accountId,
          accountType,
          liquidationValue: liqValue,
          liquidationPercent: liqPercent,
          balancePercent,
          targetPercent,
          quantity: 100,
          balancePrice: 1000,
          currentPrice: 1000,
          unrealizedProfitRub: 0,
          dynamicsPercent: 0,
          nominal: 1000,
          holdOnly,
          excludeFromStockPool,
        }],
      };
    }

    it('должен правильно пересчитать liquidationWeightPct из liquidationValue', () => {
      // IIS:   PLZL = 100 000
      // BROKER: PLZL = 100 000
      // OTHER: BROKER = 1 000 000
      // Total = 1 200 000
      // PLZL weight = 200 000 / 1 200 000 * 100 = 16.67%

      const aggregated = [
        mockAggregatedAsset('PLZL', 200000, 20, 20, 15, false, false, 'S04J3LB', 'IIS'),
        mockAggregatedAsset('OTHER', 1000000, 100, 100, 0, false, false, '403GPBT', 'BROKER'),
      ];

      const snapshot = buildPortfolioSnapshot(aggregated, {
        totalBalance: 1500000,
        freeCash: 50000,
      }, {
        profitC10: 0,
        profitC11: 0,
        investedNet: 1000000,
      });

      const plzl = snapshot.assets.find((a) => a.ticker === 'PLZL');
      expect(plzl).toBeDefined();
      expect(plzl!.liquidationWeightPct).toBeCloseTo(16.67, 1);

      // НЕ должно быть 20% (процент IIS) или 30% (сумма)
      expect(plzl!.liquidationWeightPct).not.toBe(20);
      expect(plzl!.liquidationWeightPct).not.toBe(30);
    });

    it('должен обнаружить конфликт targetPercent', () => {
      // IIS:   GAZP target = 15%
      // BROKER: GAZP target = 8%
      // Должен быть конфликт

      const aggregated = [
        {
          ...mockAggregatedAsset('GAZP', 100000, 10, 10, 15, false, false, 'S04J3LB', 'IIS'),
          accounts: [
            {
              accountId: 'S04J3LB',
              accountType: 'IIS' as const,
              liquidationValue: 50000,
              liquidationPercent: 5,
              balancePercent: 5,
              targetPercent: 15,
              quantity: 50,
              balancePrice: 1000,
              currentPrice: 1000,
              unrealizedProfitRub: 0,
              dynamicsPercent: 0,
              nominal: 1000,
              holdOnly: false,
              excludeFromStockPool: false,
            },
            {
              accountId: '403GPBT',
              accountType: 'BROKER' as const,
              liquidationValue: 50000,
              liquidationPercent: 5,
              balancePercent: 5,
              targetPercent: 8,
              quantity: 50,
              balancePrice: 1000,
              currentPrice: 1000,
              unrealizedProfitRub: 0,
              dynamicsPercent: 0,
              nominal: 1000,
              holdOnly: false,
              excludeFromStockPool: false,
            },
          ],
        } as InternalAggregatedAsset,
      ];

      const snapshot = buildPortfolioSnapshot(aggregated, {
        totalBalance: 200000,
        freeCash: 0,
      });

      const gazp = snapshot.assets.find((a) => a.ticker === 'GAZP');
      expect(gazp).toBeDefined();
      expect(gazp!.targetPercentConflict).toBe(true);
      // targetWeightPct должен быть undefined при конфликте
      expect(gazp!.targetWeightPct).toBeUndefined();
      // status должен быть 'TARGET_CONFLICT'
      expect(gazp!.status).toBe('TARGET_CONFLICT');
    });

    it('должен агрегировать holdOnly через OR-логику', () => {
      const aggregated = [
        {
          ...mockAggregatedAsset('DEF', 200000, 10, 10, 10, true, false, 'S04J3LB', 'IIS'),
          accounts: [
            {
              accountId: 'S04J3LB',
              accountType: 'IIS' as const,
              liquidationValue: 100000,
              liquidationPercent: 5,
              balancePercent: 5,
              targetPercent: 10,
              quantity: 50,
              balancePrice: 2000,
              currentPrice: 2000,
              unrealizedProfitRub: 0,
              dynamicsPercent: 0,
              nominal: 1000,
              holdOnly: true,
              excludeFromStockPool: false,
            },
            {
              accountId: '403GPBT',
              accountType: 'BROKER' as const,
              liquidationValue: 100000,
              liquidationPercent: 5,
              balancePercent: 5,
              targetPercent: 10,
              quantity: 50,
              balancePrice: 2000,
              currentPrice: 2000,
              unrealizedProfitRub: 0,
              dynamicsPercent: 0,
              nominal: 1000,
              holdOnly: false,
              excludeFromStockPool: false,
            },
          ],
        } as InternalAggregatedAsset,
      ];

      const snapshot = buildPortfolioSnapshot(aggregated, {
        totalBalance: 200000,
        freeCash: 0,

      });

      const def = snapshot.assets.find((a) => a.ticker === 'DEF');
      expect(def).toBeDefined();
      expect(def!.holdOnly).toBe(true);
    });

    it('должен сохранять accounts[] с детализацией по счетам', () => {
      const aggregated = [
        {
          ticker: 'SBER',
          name: 'Сбербанк',
          assetType: 'Акция',
          totalLiquidationValue: 300000,
          totalLiquidationPercent: 0,
          totalBalancePercent: 0,
          targetPercent: 15,
          totalQuantity: 300,
          balancePrice: 300,
          currentPrice: 300,
          totalUnrealizedProfitRub: 0,
          dynamicsPercent: 0,
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
              quantity: 100,
              balancePrice: 300,
              currentPrice: 300,
              unrealizedProfitRub: 0,
              dynamicsPercent: 0,
              nominal: 1000,
              holdOnly: false,
              excludeFromStockPool: false,
            },
            {
              accountId: '403GPBT',
              accountType: 'BROKER' as const,
              liquidationValue: 200000,
              liquidationPercent: 20,
              balancePercent: 20,
              targetPercent: 15,
              quantity: 200,
              balancePrice: 300,
              currentPrice: 300,
              unrealizedProfitRub: 0,
              dynamicsPercent: 0,
              nominal: 1000,
              holdOnly: false,
              excludeFromStockPool: false,
            },
          ],
        } as InternalAggregatedAsset,
      ];

      const snapshot = buildPortfolioSnapshot(aggregated, {
        totalBalance: 1000000,
        freeCash: 100000,

      });

      const sber = snapshot.assets.find((a) => a.ticker === 'SBER');
      expect(sber).toBeDefined();
      expect(sber!.accounts.length).toBe(2);

      // Проверяем детализацию по счетам
      const iisAcc = sber!.accounts.find((a) => a.accountId === 'S04J3LB');
      const brokerAcc = sber!.accounts.find((a) => a.accountId === '403GPBT');

      expect(iisAcc).toBeDefined();
      expect(iisAcc!.liquidationValue).toBe(100000);
      expect(iisAcc!.accountType).toBe('IIS');

      expect(brokerAcc).toBeDefined();
      expect(brokerAcc!.liquidationValue).toBe(200000);
      expect(brokerAcc!.accountType).toBe('BROKER');

      // Проверяем AccountSnapshot
      expect(snapshot.accounts.length).toBe(2);
      const iisSnap = snapshot.accounts.find((a) => a.accountId === 'S04J3LB');
      const brokerSnap = snapshot.accounts.find((a) => a.accountId === '403GPBT');

      expect(iisSnap).toBeDefined();
      expect(iisSnap!.totalLiquidationValue).toBe(100000);
      expect(brokerSnap).toBeDefined();
      expect(brokerSnap!.totalLiquidationValue).toBe(200000);
    });

    it('FinancialSnapshot должен содержать правильные метрики', () => {
      const aggregated = [
        {
          ticker: 'TEST',
          name: 'Тест',
          assetType: 'Акция',
          totalLiquidationValue: 500000,
          totalLiquidationPercent: 0,
          totalBalancePercent: 0,
          targetPercent: 20,
          totalQuantity: 100,
          balancePrice: 5000,
          currentPrice: 5000,
          totalUnrealizedProfitRub: 0,
          dynamicsPercent: 0,
          holdOnly: false,
          excludeFromStockPool: false,
          targetPercentConflict: undefined,
          accounts: [{
            accountId: 'S04J3LB',
            accountType: 'IIS' as const,
            liquidationValue: 500000,
            liquidationPercent: 50,
            balancePercent: 50,
            targetPercent: 20,
            quantity: 100,
            balancePrice: 5000,
            currentPrice: 5000,
            unrealizedProfitRub: 0,
            dynamicsPercent: 0,
            nominal: 1000,
            holdOnly: false,
            excludeFromStockPool: false,
          }],
        } as InternalAggregatedAsset,
      ];

      const snapshot = buildPortfolioSnapshot(aggregated, {
        totalBalance: 1000000,
        freeCash: 200000,

      }, {
        profitC10: 10000,
        profitC11: 15000,
        investedNet: 400000,
      });

      expect(snapshot.financial.currentAssets).toBe(500000);
      expect(snapshot.financial.freeCash).toBe(200000);
      expect(snapshot.financial.contributedCapital).toBe(400000);
      // historicalMarketResult = profitC10 (исторический результат)
      expect(snapshot.financial.historicalMarketResult).toBe(10000);
      // currentEquityGap = profitC11 (текущий дефицит/профицит)
      expect(snapshot.financial.currentEquityGap).toBe(15000);
      expect(snapshot.financial.snapshotTimestamp).toBeTruthy();
    });

    // ─── Тесты для требований 1-6 ─────────────────────────────────────────────

    it('excludeFromStockPool: false + true → true (OR-агрегация)', () => {
      const aggregated = [
        {
          ...mockAggregatedAsset('EXCL', 200000, 10, 10, 10, false, true, 'S04J3LB', 'IIS'),
          accounts: [
            {
              accountId: 'S04J3LB',
              accountType: 'IIS' as const,
              liquidationValue: 100000,
              liquidationPercent: 5,
              balancePercent: 5,
              targetPercent: 10,
              quantity: 50,
              balancePrice: 2000,
              currentPrice: 2000,
              unrealizedProfitRub: 0,
              dynamicsPercent: 0,
              nominal: 1000,
              holdOnly: false,
              excludeFromStockPool: false,
            },
            {
              accountId: '403GPBT',
              accountType: 'BROKER' as const,
              liquidationValue: 100000,
              liquidationPercent: 5,
              balancePercent: 5,
              targetPercent: 10,
              quantity: 50,
              balancePrice: 2000,
              currentPrice: 2000,
              unrealizedProfitRub: 0,
              dynamicsPercent: 0,
              nominal: 1000,
              holdOnly: false,
              excludeFromStockPool: true,
            },
          ],
        } as InternalAggregatedAsset,
      ];

      const snapshot = buildPortfolioSnapshot(aggregated, {
        totalBalance: 200000,
        freeCash: 0,

      });

      const excl = snapshot.assets.find((a) => a.ticker === 'EXCL');
      expect(excl).toBeDefined();
      expect(excl!.excludeFromStockPool).toBe(true);
    });

    it('target conflict: 15% + 8% → targetPercentConflict=true, targetWeightPct=undefined', () => {
      const aggregated = [
        {
          ticker: 'CONFL',
          name: 'Конфликт',
          assetType: 'Акция',
          totalLiquidationValue: 200000,
          totalLiquidationPercent: 0,
          totalBalancePercent: 0,
          targetPercent: 0,
          totalQuantity: 200,
          balancePrice: 1000,
          currentPrice: 1000,
          totalUnrealizedProfitRub: 0,
          dynamicsPercent: 0,
          holdOnly: false,
          excludeFromStockPool: false,
          targetPercentConflict: true,
          accounts: [
            {
              accountId: 'S04J3LB',
              accountType: 'IIS' as const,
              liquidationValue: 100000,
              liquidationPercent: 5,
              balancePercent: 5,
              targetPercent: 15,
              quantity: 100,
              balancePrice: 1000,
              currentPrice: 1000,
              unrealizedProfitRub: 0,
              dynamicsPercent: 0,
              nominal: 1000,
              holdOnly: false,
              excludeFromStockPool: false,
            },
            {
              accountId: '403GPBT',
              accountType: 'BROKER' as const,
              liquidationValue: 100000,
              liquidationPercent: 5,
              balancePercent: 5,
              targetPercent: 8,
              quantity: 100,
              balancePrice: 1000,
              currentPrice: 1000,
              unrealizedProfitRub: 0,
              dynamicsPercent: 0,
              nominal: 1000,
              holdOnly: false,
              excludeFromStockPool: false,
            },
          ],
        } as InternalAggregatedAsset,
      ];

      const snapshot = buildPortfolioSnapshot(aggregated, {
        totalBalance: 200000,
        freeCash: 0,

      });

      const confl = snapshot.assets.find((a) => a.ticker === 'CONFL');
      expect(confl).toBeDefined();
      expect(confl!.targetPercentConflict).toBe(true);
      expect(confl!.targetWeightPct).toBeUndefined();
      expect(confl!.status).toBe('TARGET_CONFLICT');
    });

    it('no conflict: 15% + 15% → targetPercent=15%, targetPercentConflict=false', () => {
      const aggregated = [
        {
          ticker: 'NCONFL',
          name: 'Без конфликта',
          assetType: 'Акция',
          totalLiquidationValue: 200000,
          totalLiquidationPercent: 0,
          totalBalancePercent: 0,
          targetPercent: 15,
          totalQuantity: 200,
          balancePrice: 1000,
          currentPrice: 1000,
          totalUnrealizedProfitRub: 0,
          dynamicsPercent: 0,
          holdOnly: false,
          excludeFromStockPool: false,
          targetPercentConflict: false,
          accounts: [
            {
              accountId: 'S04J3LB',
              accountType: 'IIS' as const,
              liquidationValue: 100000,
              liquidationPercent: 5,
              balancePercent: 5,
              targetPercent: 15,
              quantity: 100,
              balancePrice: 1000,
              currentPrice: 1000,
              unrealizedProfitRub: 0,
              dynamicsPercent: 0,
              nominal: 1000,
              holdOnly: false,
              excludeFromStockPool: false,
            },
            {
              accountId: '403GPBT',
              accountType: 'BROKER' as const,
              liquidationValue: 100000,
              liquidationPercent: 5,
              balancePercent: 5,
              targetPercent: 15,
              quantity: 100,
              balancePrice: 1000,
              currentPrice: 1000,
              unrealizedProfitRub: 0,
              dynamicsPercent: 0,
              nominal: 1000,
              holdOnly: false,
              excludeFromStockPool: false,
            },
          ],
        } as InternalAggregatedAsset,
      ];

      const snapshot = buildPortfolioSnapshot(aggregated, {
        totalBalance: 200000,
        freeCash: 0,

      });

      const nconfl = snapshot.assets.find((a) => a.ticker === 'NCONFL');
      expect(nconfl).toBeDefined();
      expect(nconfl!.targetPercentConflict).toBe(false);
      expect(nconfl!.targetWeightPct).toBe(15);
      expect(nconfl!.status).toBeUndefined();
    });

    it('FinancialSnapshot: currentEquityGap != 0 при передаче deficit', () => {
      const aggregated = [
        {
          ticker: 'EQTEST',
          name: 'EQ Test',
          assetType: 'Акция',
          totalLiquidationValue: 500000,
          totalLiquidationPercent: 0,
          totalBalancePercent: 0,
          targetPercent: 20,
          totalQuantity: 100,
          balancePrice: 5000,
          currentPrice: 5000,
          totalUnrealizedProfitRub: 0,
          dynamicsPercent: 0,
          holdOnly: false,
          excludeFromStockPool: false,
          targetPercentConflict: undefined,
          accounts: [{
            accountId: 'S04J3LB',
            accountType: 'IIS' as const,
            liquidationValue: 500000,
            liquidationPercent: 50,
            balancePercent: 50,
            targetPercent: 20,
            quantity: 100,
            balancePrice: 5000,
            currentPrice: 5000,
            unrealizedProfitRub: 0,
            dynamicsPercent: 0,
            nominal: 1000,
            holdOnly: false,
            excludeFromStockPool: false,
          }],
        } as InternalAggregatedAsset,
      ];

      const snapshot = buildPortfolioSnapshot(aggregated, {
        totalBalance: 1000000,
        freeCash: 200000,

      }, {
        profitC10: 10000,
        profitC11: 15000,
        investedNet: 400000,
      });

      // currentEquityGap = profitC11 (текущий дефицит/профицит)
      expect(snapshot.financial.currentEquityGap).toBe(15000);
      // currentEquityGapPct = 15000 / 500000 * 100 = 3%
      expect(snapshot.financial.currentEquityGapPct).toBeCloseTo(3, 0);
      // historicalMarketResult = profitC10 (исторический результат)
      expect(snapshot.financial.historicalMarketResult).toBe(10000);
      // contributedCapital != 0
      expect(snapshot.financial.contributedCapital).toBe(400000);
    });

    it('target undefined → targetNotSet = true, targetWeightPct = undefined', () => {
      const aggregated = [
        mockAggregatedAsset('NO_TARGET', 100000, 10, 10, undefined, false, false, 'S04J3LB', 'IIS'),
      ];

      const snapshot = buildPortfolioSnapshot(aggregated, {
        totalBalance: 200000,
        freeCash: 0,
      });

      const asset = snapshot.assets.find((a) => a.ticker === 'NO_TARGET');
      expect(asset).toBeDefined();
      expect(asset!.targetWeightPct).toBeUndefined();
      expect(asset!.targetNotSet).toBe(true);
      expect(asset!.targetPercentConflict).toBe(false);
    });

    it('target 15 + 15 → targetWeightPct = 15, targetNotSet = false', () => {
      const aggregated = [
        mockAggregatedAsset('SAME_TARGET', 100000, 10, 10, 15, false, false, 'S04J3LB', 'IIS'),
      ];

      const snapshot = buildPortfolioSnapshot(aggregated, {
        totalBalance: 200000,
        freeCash: 0,
      });

      const asset = snapshot.assets.find((a) => a.ticker === 'SAME_TARGET');
      expect(asset).toBeDefined();
      expect(asset!.targetWeightPct).toBe(15);
      expect(asset!.targetNotSet).toBe(false);
      expect(asset!.targetPercentConflict).toBe(false);
    });
  });
});
