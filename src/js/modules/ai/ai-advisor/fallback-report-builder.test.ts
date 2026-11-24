import type { PortfolioReportData } from '../../portfolio/portfolio-math/portfolio-math.js';
import type { ValidationResult } from '../../portfolio/portfolio-math/portfolio-validator.js';
import type { CalculatedIncome } from './income-calculator.js';
import type { UIOrdersData } from './types.js';
import { buildFallbackReport } from './fallback-report-builder.js';

function createAnalysis(): PortfolioReportData {
  return {
    macro: {
      totalBalance: 1_000_000,
      totalLiquidationValue: 1_000_000,
      cashSource: 'QUIK',

      freeCash: 100_000,
      stocksPercent: 40,
      bondsPercent: 60,
      stocksDeficitRub: 0,
      bondsDeficitRub: 0,
      iisOrdersSum: 0,
      brokerOrdersSum: 0,
      activeOrdersListText: '',
    },
    assetsAnalysis: [
      {
        name: 'Полюс',
        ticker: 'PLZL',
        assetType: 'А',
        currentPercent: 19.8,
        targetPercent: 10,
        deficitRub: -59_805,
        status: 'REDUCE',
        dynamicsPercent: 0,
        nkdRub: 0,
        nominal: 0,
        quantity: 10,
        balancePrice: 1000,
        currentPrice: 420,
        unrealizedProfitRub: -58_000,
        priority: 0,
        isConcentrated: true,
      },
      {
        name: 'Сбербанк',
        ticker: 'SBER',
        assetType: 'А',
        currentPercent: 5,
        targetPercent: 10,
        deficitRub: 50_000,
        status: 'BUY',
        dynamicsPercent: 0,
        nkdRub: 0,
        nominal: 0,
        quantity: 10,
        balancePrice: 300,
        currentPrice: 320,
        unrealizedProfitRub: 2_000,
        priority: 0,
        isConcentrated: false,
      },
    ],
    freeStocksPoolPercent: 20,
  };
}

const income: CalculatedIncome = {
  totalDivsNet: 0,
  totalDivs: 0,
  totalNkd: 0,
  stocks: [],
};

const validation: ValidationResult = {
  isValid: true,
  errors: [],
};

const orders: UIOrdersData = {
  md: '',
};

describe('buildFallbackReport + no-sell policy', () => {
  it('включает NEW-ОФЗ в buyAssets и итог ребалансировки', () => {
    const analysis = createAnalysis();
    analysis.assetsAnalysis[1] = {
      ...analysis.assetsAnalysis[1]!,
      name: 'Ирао',
      ticker: 'IRAO',
      deficitRub: 57_467,
    };
    analysis.assetsAnalysis.push({
      name: 'Татнефть',
      ticker: 'TATN',
      assetType: 'А',
      currentPercent: 2.9,
      targetPercent: 10,
      deficitRub: 43_562,
      status: 'BUY',
      dynamicsPercent: 0,
      nkdRub: 0,
      nominal: 0,
      quantity: 10,
      balancePrice: 500,
      currentPrice: 550,
      unrealizedProfitRub: 0,
      priority: 0,
      isConcentrated: false,
    });
    analysis.assetsAnalysis.push({
      name: 'ОФЗ 26238',
      ticker: 'SU26238RMFS4',
      assetType: 'О',
      currentPercent: 9.5,
      targetPercent: 10,
      deficitRub: 5168,
      status: 'NEW',
      dynamicsPercent: 0,
      nkdRub: 0,
      nominal: 1000,
      quantity: 10,
      balancePrice: 950,
      currentPrice: 950,
      unrealizedProfitRub: 0,
      priority: 0,
      isConcentrated: false,
    });

    const report = buildFallbackReport(
      analysis,
      income,
      validation,
      orders,
      16,
    );

    expect(report).toMatch(/106[\s\u00A0]?197/);
    expect(report).toMatch(/3 актив/);
  });

  it('не выводит sell-секции и sell-шаги по policy-blocked тикеру', () => {
    const report = buildFallbackReport(
      createAnalysis(),
      income,
      validation,
      orders,
      16,
      { noSellTickers: ['PLZL'] },
    );

    expect(report).toContain('4.1 ПОЛИТИКА NO-SELL');
    expect(report).toContain('PLZL');
    expect(report).not.toMatch(/Сократить 1 актив/i);
    expect(report).not.toMatch(/PLZL.*продать позицию/i);
    expect(report).not.toMatch(/РЕКОМЕНДАЦИИ ПО СНИЖЕНИЮ ПОЗИЦИЙ/i);
  });

  it('без политики sell-секция остаётся', () => {
    const report = buildFallbackReport(
      createAnalysis(),
      income,
      validation,
      orders,
      16,
      { noSellTickers: [] },
    );

    expect(report).toContain('РЕКОМЕНДАЦИИ ПО СНИЖЕНИЮ ПОЗИЦИЙ');
  });
});

