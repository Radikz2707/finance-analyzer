import { describe, it, expect } from 'vitest';
import { PortfolioMathModule } from './portfolio-math';
import { MacroGoals, CurrentAsset } from '../xlsx-parser/xlsx-parser';

describe('Инвестиционная математика и жесткие лимиты стратегии', () => {
  const mockMacro: MacroGoals = {
    totalBalance: 100000,
    freeCash: 5000,
    stocksPercent: 52,
    bondsPercent: 48,
    stocksDeficitRub: 0,
    bondsDeficitRub: 0,
    iisOrdersSum: 0,
    brokerOrdersSum: 0,
    activeOrdersListText: '',
  };

  const math = new PortfolioMathModule();

  it('Должен корректно рассчитывать дефициты, свободный пул и выставлять статусы активов', () => {
    const mockAssets: CurrentAsset[] = [
      {
        name: 'Полюс',
        ticker: 'PLZL',
        assetType: 'А',
        targetPercent: 20.0,
        liquidationPercent: 25.0,
        balancePercent: 30.0,
        unrealizedProfitRub: -5000,
        dynamicsPercent: -56.34,
        holdOnly: true,
      },
      {
        name: 'Сбербанк',
        ticker: 'SBER',
        assetType: 'А',
        targetPercent: 15.0,
        liquidationPercent: 10.0,
        balancePercent: 10.0,
        unrealizedProfitRub: 4000,
        dynamicsPercent: 0.1,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, mockAssets, 100000);

    // freeStocksPoolPercent = macro.stocksPercent - allocatedStocksPercent
    // allocatedStocksPercent = 15 (только Сбербанк, Полюс исключён через holdOnly)
    expect(result.freeStocksPoolPercent).toBe(37);

    const polyusAnalysis = result.assetsAnalysis.find((a) => a.name === 'Полюс');
    const sberAnalysis = result.assetsAnalysis.find((a) => a.name === 'Сбербанк');

    expect(polyusAnalysis).toBeDefined();
    expect(sberAnalysis).toBeDefined();

    if (polyusAnalysis && sberAnalysis) {
      // Предохранитель 1: Для «Полюса» всегда должен принудительно возвращаться статус HOLD
      expect(polyusAnalysis.status).toBe('HOLD');

      // Предохранитель 2: Если дефицит Сбербанка существенный, должен быть статус BUY
      expect(sberAnalysis.status).toBe('BUY');

      // Проверяем, что дефицит в рублях рассчитался корректно: (15% - 10%) * 100 000 = 5 000 руб.
      expect(sberAnalysis.deficitRub).toBe(5000);
    }
  });

  it('Должен корректно определять статус EXIT: target=0, current>0', () => {
    const mockAssets: CurrentAsset[] = [
      {
        name: 'АктивНаВыход',
        ticker: 'EXIT',
        assetType: 'А',
        targetPercent: 0,
        liquidationPercent: 5.0,
        balancePercent: 5.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, mockAssets, 100000);

    expect(result.assetsAnalysis.length).toBe(1);
    expect(result.assetsAnalysis[0].status).toBe('EXIT');
    // deficitRub = 5% * 100000 = 5000 (нужно продать)
    expect(result.assetsAnalysis[0].deficitRub).toBe(5000);
  });

  it('Должен пропускать активы с target=0 и current=0', () => {
    const mockAssets: CurrentAsset[] = [
      {
        name: 'ПустойАктив',
        ticker: 'EMPTY',
        assetType: 'А',
        targetPercent: 0,
        liquidationPercent: 0,
        balancePercent: 0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, mockAssets, 100000);

    // Актив должен быть пропущен
    expect(result.assetsAnalysis.length).toBe(0);
  });

  it('Должен определять статус NEW: target>0, current=0', () => {
    const mockAssets: CurrentAsset[] = [
      {
        name: 'НовыйАктив',
        ticker: 'NEW',
        assetType: 'А',
        targetPercent: 10.0,
        liquidationPercent: 0,
        balancePercent: 0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, mockAssets, 100000);

    expect(result.assetsAnalysis.length).toBe(1);
    expect(result.assetsAnalysis[0].status).toBe('NEW');
    // deficitRub = 10% * 100000 = 10000 (нужно купить)
    expect(result.assetsAnalysis[0].deficitRub).toBe(10000);
  });

  it('Должен определять статус BUY: target=15, current=10 (deviation=-5 < -2)', () => {
    const mockAssets: CurrentAsset[] = [
      {
        name: 'АктивНаПокупку',
        ticker: 'BUY',
        assetType: 'А',
        targetPercent: 15.0,
        liquidationPercent: 10.0,
        balancePercent: 10.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, mockAssets, 100000);

    expect(result.assetsAnalysis.length).toBe(1);
    expect(result.assetsAnalysis[0].status).toBe('BUY');
    // deviationPct = 10 - 15 = -5, deficitRub = 5% * 100000 = 5000
    expect(result.assetsAnalysis[0].deficitRub).toBe(5000);
  });

  it('Должен определять статус REDUCE: target=15, current=19 (deviation=+4 > +3)', () => {
    const mockAssets: CurrentAsset[] = [
      {
        name: 'АктивНаПродажу',
        ticker: 'REDUCE',
        assetType: 'А',
        targetPercent: 15.0,
        liquidationPercent: 19.0,
        balancePercent: 20.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, mockAssets, 100000);

    expect(result.assetsAnalysis.length).toBe(1);
    expect(result.assetsAnalysis[0].status).toBe('REDUCE');
    // deviationPct = 19 - 15 = +4, deficitRub = -4% * 100000 = -4000
    expect(result.assetsAnalysis[0].deficitRub).toBe(-4000);
  });

  it('Должен определять статус STABLE: target=15, current=14 (deviation=-1, в пределах порогов)', () => {
    const mockAssets: CurrentAsset[] = [
      {
        name: 'СтабильныйАктив',
        ticker: 'STABLE',
        assetType: 'А',
        targetPercent: 15.0,
        liquidationPercent: 14.0,
        balancePercent: 14.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, mockAssets, 100000);

    expect(result.assetsAnalysis.length).toBe(1);
    expect(result.assetsAnalysis[0].status).toBe('STABLE');
  });

  // ─── Тесты для targetPercentConflict и holdOnly ────────────────────────────

  it('holdOnly=true → статус HOLD (не BUY/REDUCE/EXIT)', () => {
    const mockAssets: CurrentAsset[] = [
      {
        name: 'ЗащищенныйАктив',
        ticker: 'HOLD',
        assetType: 'А',
        targetPercent: 10.0,
        liquidationPercent: 5.0, // дефицит 5% → normally BUY
        balancePercent: 5.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
        holdOnly: true,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, mockAssets, 100000);

    expect(result.assetsAnalysis.length).toBe(1);
    expect(result.assetsAnalysis[0].status).toBe('HOLD');
  });

  it('targetPercentConflict=true → статус HOLD (не BUY/REDUCE/EXIT)', () => {
    const mockAssets: CurrentAsset[] = [
      {
        name: 'КонфликтАктив',
        ticker: 'CONFL',
        assetType: 'А',
        targetPercent: 0, // conflict → target = 0
        liquidationPercent: 10.0,
        balancePercent: 10.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
        targetPercentConflict: true,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, mockAssets, 100000);

    expect(result.assetsAnalysis.length).toBe(1);
    // При конфликте target — статус HOLD, deficitRub = 0
    expect(result.assetsAnalysis[0].status).toBe('HOLD');
    expect(result.assetsAnalysis[0].targetPercent).toBeUndefined();
    expect(result.assetsAnalysis[0].deficitRub).toBe(0);
  });

  it('no conflict: 15% + 15% → обычный расчёт BUY/REDUCE/STABLE', () => {
    // target=15, current=10 → BUY
    const buyAssets: CurrentAsset[] = [
      {
        name: 'Покупка',
        ticker: 'BUY',
        assetType: 'А',
        targetPercent: 15.0,
        liquidationPercent: 10.0,
        balancePercent: 10.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
        targetPercentConflict: false,
      },
    ];

    const math = new PortfolioMathModule();
    const buyResult = math.analyzePortfolio(mockMacro, buyAssets, 100000);
    expect(buyResult.assetsAnalysis[0].status).toBe('BUY');

    // target=15, current=15 → STABLE
    const stableAssets: CurrentAsset[] = [
      {
        name: 'Стабильный',
        ticker: 'STB',
        assetType: 'А',
        targetPercent: 15.0,
        liquidationPercent: 15.0,
        balancePercent: 15.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
        targetPercentConflict: false,
      },
    ];

    const stableResult = math.analyzePortfolio(mockMacro, stableAssets, 100000);
    expect(stableResult.assetsAnalysis[0].status).toBe('STABLE');

    // target=15, current=20 → REDUCE
    const reduceAssets: CurrentAsset[] = [
      {
        name: 'Продажа',
        ticker: 'RED',
        assetType: 'А',
        targetPercent: 15.0,
        liquidationPercent: 20.0,
        balancePercent: 20.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
        targetPercentConflict: false,
      },
    ];

    const reduceResult = math.analyzePortfolio(mockMacro, reduceAssets, 100000);
    expect(reduceResult.assetsAnalysis[0].status).toBe('REDUCE');
  });

  // ─── Тест на разницу bases: liquidation vs cost-basis ──────────────────────

  it('deficitRub должен считаться от totalLiquidationValue, а НЕ от macro.totalBalance', () => {
    // Реальные значения из Excel:
    // macro.totalBalance (cost-basis) = 671139.24
    // totalLiquidationValue (market-value) = 569341.60
    const macroWithDifferentBases: MacroGoals = {
      totalBalance: 671139.24, // cost-basis — НЕ используется для rebalance
      freeCash: 15143.05,
      stocksPercent: 52,
      bondsPercent: 48,
      stocksDeficitRub: 0,
      bondsDeficitRub: 0,
      iisOrdersSum: 0,
      brokerOrdersSum: 0,
      activeOrdersListText: '',
    };

    const liquidationBase = 569341.60; // market-value — используется для rebalance

    const asset: CurrentAsset[] = [
      {
        name: 'АктивНаПокупку',
        ticker: 'BUY',
        assetType: 'А',
        targetPercent: 15.0,
        liquidationPercent: 10.0,
        balancePercent: 10.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(macroWithDifferentBases, asset, liquidationBase);

    expect(result.assetsAnalysis[0].status).toBe('BUY');

    // deviation = 10 - 15 = -5%
    // deficitRub = 5% * 569341.60 = 28467.08 (liquidation basis)
    const expectedDeficit = Math.round(0.05 * 569341.60);
    expect(result.assetsAnalysis[0].deficitRub).toBe(expectedDeficit);

    // НЕ 33556.96 (cost-basis)
    expect(result.assetsAnalysis[0].deficitRub).not.toBe(33557);

    // Проверяем точное значение
    expect(result.assetsAnalysis[0].deficitRub).toBe(28467);
  });

  // ─── Тесты для targetPercent undefined / 0 / conflict ──────────────────────

  it('empty target → targetPercent === undefined → NO_TARGET → HOLD → deficitRub = 0', () => {
    const asset: CurrentAsset[] = [
      {
        name: 'БезЦели',
        ticker: 'NO_TARGET',
        assetType: 'А',
        liquidationPercent: 10.0,
        balancePercent: 10.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, asset, 100000);

    expect(result.assetsAnalysis.length).toBe(1);
    expect(result.assetsAnalysis[0].status).toBe('NO_TARGET');
    expect(result.assetsAnalysis[0].targetPercent).toBeUndefined();
    expect(result.assetsAnalysis[0].deficitRub).toBe(0);
    expect(result.assetsAnalysis[0].priority).toBe(0);
  });

  it('explicit target 0 → EXIT', () => {
    const asset: CurrentAsset[] = [
      {
        name: 'ЯвныйНоль',
        ticker: 'EXIT_ZERO',
        assetType: 'А',
        targetPercent: 0,
        liquidationPercent: 10.0,
        balancePercent: 10.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, asset, 100000);

    expect(result.assetsAnalysis.length).toBe(1);
    expect(result.assetsAnalysis[0].status).toBe('EXIT');
    expect(result.assetsAnalysis[0].targetPercent).toBe(0);
    expect(result.assetsAnalysis[0].deficitRub).toBe(10000); // 10% * 100000
  });

  it('target 15 → normal rebalance BUY', () => {
    const asset: CurrentAsset[] = [
      {
        name: 'Целевой',
        ticker: 'TARGET_15',
        assetType: 'А',
        targetPercent: 15.0,
        liquidationPercent: 10.0,
        balancePercent: 10.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, asset, 100000);

    expect(result.assetsAnalysis[0].status).toBe('BUY');
    expect(result.assetsAnalysis[0].targetPercent).toBe(15);
    expect(result.assetsAnalysis[0].deficitRub).toBe(5000); // 5% * 100000
  });

  it('targetPercentConflict → HOLD → deficitRub = 0', () => {
    const asset: CurrentAsset[] = [
      {
        name: 'Конфликт',
        ticker: 'CONFLICT',
        assetType: 'А',
        targetPercent: 10.0,
        liquidationPercent: 10.0,
        balancePercent: 10.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
        targetPercentConflict: true,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, asset, 100000);

    expect(result.assetsAnalysis[0].status).toBe('HOLD');
    expect(result.assetsAnalysis[0].targetPercent).toBeUndefined();
    expect(result.assetsAnalysis[0].deficitRub).toBe(0);
    expect(result.assetsAnalysis[0].priority).toBe(0);
  });

  it('NO_TARGET не должен влиять на freeStocksPoolPercent', () => {
    const assets: CurrentAsset[] = [
      {
        name: 'БезЦели',
        ticker: 'NO_TARGET',
        assetType: 'А',
        liquidationPercent: 10.0,
        balancePercent: 10.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
      },
      {
        name: 'Целевой',
        ticker: 'TARGET',
        assetType: 'А',
        targetPercent: 20.0,
        liquidationPercent: 15.0,
        balancePercent: 15.0,
        unrealizedProfitRub: 0,
        dynamicsPercent: 0,
      },
    ];

    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, assets, 100000);

    // freeStocksPoolPercent = 52 - 20 = 32 (NO_TARGET не учитывается)
    expect(result.freeStocksPoolPercent).toBe(32);
    expect(result.assetsAnalysis.find((a) => a.ticker === 'NO_TARGET')?.status).toBe('NO_TARGET');
    expect(result.assetsAnalysis.find((a) => a.ticker === 'TARGET')?.status).toBe('BUY');
  });

  // ─── Тесты безопасной обработки облигаций (priceUnit) ──────────────────────

  it('bond + nominal unknown → no fabricated price, priceUnit = UNKNOWN', () => {
    const bondUnknownNominal: CurrentAsset = {
      name: 'Облигация А',
      ticker: 'BOND_UNKNOWN',
      assetType: 'О',
      targetPercent: 15,
      liquidationPercent: 10,
      balancePercent: 10,
      unrealizedProfitRub: 0,
      dynamicsPercent: 0,
      nominal: undefined,
      priceUnit: 'UNKNOWN',
      currentPrice: 0,
      balancePrice: 980,
    };

    const result = math.analyzePortfolio(mockMacro, [bondUnknownNominal], 100000);

    expect(result.assetsAnalysis.length).toBe(1);
    expect(result.assetsAnalysis[0].priceUnit).toBe('UNKNOWN');
    expect(result.assetsAnalysis[0].currentPrice).toBe(0);
    // nominal должен быть undefined → 0 (не 1000!)
    expect(result.assetsAnalysis[0].nominal).toBe(0);
    // balancePrice НЕ меняется
    expect(result.assetsAnalysis[0].balancePrice).toBe(980);
  });

  it('bond + nominal known + percent price → correct RUB price, priceUnit = PERCENT_OF_NOMINAL', () => {
    const bondKnownNominal: CurrentAsset = {
      name: 'Облигация Б',
      ticker: 'BOND_KNOWN',
      assetType: 'О',
      targetPercent: 20,
      liquidationPercent: 15,
      balancePercent: 15,
      unrealizedProfitRub: 0,
      dynamicsPercent: 0,
      nominal: 1000,
      priceUnit: 'PERCENT_OF_NOMINAL',
      currentPrice: 980,
      balancePrice: 970,
    };

    const result = math.analyzePortfolio(mockMacro, [bondKnownNominal], 100000);

    expect(result.assetsAnalysis.length).toBe(1);
    expect(result.assetsAnalysis[0].priceUnit).toBe('PERCENT_OF_NOMINAL');
    expect(result.assetsAnalysis[0].currentPrice).toBe(980);
    expect(result.assetsAnalysis[0].nominal).toBe(1000);
    expect(result.assetsAnalysis[0].balancePrice).toBe(970);
    expect(result.assetsAnalysis[0].status).toBe('BUY');
  });

  it('stock → priceUnit = RUB, unchanged', () => {
    const stock: CurrentAsset = {
      name: 'Сбербанк',
      ticker: 'SBER',
      assetType: 'А',
      targetPercent: 15,
      liquidationPercent: 10,
      balancePercent: 10,
      unrealizedProfitRub: 0,
      dynamicsPercent: 5,
      nominal: undefined,
      priceUnit: 'RUB',
      currentPrice: 280,
      balancePrice: 270,
    };

    const result = math.analyzePortfolio(mockMacro, [stock], 100000);

    expect(result.assetsAnalysis.length).toBe(1);
    expect(result.assetsAnalysis[0].priceUnit).toBe('RUB');
    expect(result.assetsAnalysis[0].currentPrice).toBe(280);
    expect(result.assetsAnalysis[0].balancePrice).toBe(270);
    expect(result.assetsAnalysis[0].nominal).toBe(0);
  });

  it('ETF → priceUnit = RUB, unchanged', () => {
    const etf: CurrentAsset = {
      name: 'Т-Конверт',
      ticker: 'TCONV',
      assetType: 'ETF',
      targetPercent: 10,
      liquidationPercent: 8,
      balancePercent: 8,
      unrealizedProfitRub: 0,
      dynamicsPercent: 2,
      nominal: undefined,
      priceUnit: 'RUB',
      currentPrice: 110,
      balancePrice: 108,
    };

    const result = math.analyzePortfolio(mockMacro, [etf], 100000);

    expect(result.assetsAnalysis.length).toBe(1);
    expect(result.assetsAnalysis[0].priceUnit).toBe('RUB');
    expect(result.assetsAnalysis[0].currentPrice).toBe(110);
    expect(result.assetsAnalysis[0].balancePrice).toBe(108);
    expect(result.assetsAnalysis[0].nominal).toBe(0);
  });

  it('bond UNKNOWN → P&L расчёт не влияет на balancePrice', () => {
    const bond: CurrentAsset = {
      name: 'Облигация В',
      ticker: 'BOND_BAL',
      assetType: 'О',
      targetPercent: 10,
      liquidationPercent: 5,
      balancePercent: 5,
      unrealizedProfitRub: 0,
      dynamicsPercent: 0,
      nominal: undefined,
      priceUnit: 'UNKNOWN',
      currentPrice: 0,
      balancePrice: 995.50,
    };

    const result = math.analyzePortfolio(mockMacro, [bond], 100000);

    expect(result.assetsAnalysis[0].balancePrice).toBe(995.50);
    expect(result.assetsAnalysis[0].currentPrice).toBe(0);
    expect(result.assetsAnalysis[0].nominal).toBe(0);
    expect(result.assetsAnalysis[0].priceUnit).toBe('UNKNOWN');
  });
});
