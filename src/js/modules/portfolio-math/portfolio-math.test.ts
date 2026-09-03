import { describe, it, expect } from 'vitest';
import { PortfolioMathModule } from './portfolio-math';
import { MacroGoals, CurrentAsset } from '../xlsx-parser/xlsx-parser';

describe('Инвестиционная математика и жесткие лимиты стратегии', () => {
  it('Должен корректно рассчитывать дефициты, свободный пул и выставлять статусы активов', () => {
    // 1. Инициализируем мок для макроцелей со всеми обязательными полями
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

    // 2. Инициализируем мок для массива активов с обязательным полем targetPercent
    const mockAssets: CurrentAsset[] = [
      {
        name: 'Полюс',
        targetPercent: 20.0,
        liquidationPercent: 25.0,
        balancePercent: 30.0,
        unrealizedProfitRub: -5000,
        dynamicsPercent: -56.34,
      },
      {
        name: 'Сбербанк',
        targetPercent: 15.0,
        liquidationPercent: 10.0,
        balancePercent: 10.0,
        unrealizedProfitRub: 4000,
        dynamicsPercent: 0.1,
      },
    ];

    // 3. Запускаем тестирование комплексного метода analyzePortfolio
    const math = new PortfolioMathModule();
    const result = math.analyzePortfolio(mockMacro, mockAssets);

    // 4. Проверяем расчет адаптивного свободного пула акций для ИИ
    expect(result.freeStocksPoolPercent).toBe(0);

    // 5. Проверяем работу защитных предохранителей (Статусы)
    const polyusAnalysis = result.assetsAnalysis.find(
      (a) => a.name === 'Полюс',
    );
    const sberAnalysis = result.assetsAnalysis.find(
      (a) => a.name === 'Сбербанк',
    );

    expect(polyusAnalysis).toBeDefined();
    expect(sberAnalysis).toBeDefined();

    if (polyusAnalysis && sberAnalysis) {
      // Предохранитель 1: Для «Полюса» всегда должен принудительно возвращаться статус HOLD
      expect(polyusAnalysis.status).toBe('HOLD');

      // Предохранитель 2: Если дефицит Сбербанка существенный, должен быть статус BUY
      expect(sberAnalysis.status).toBe('BUY');

      // Проверяем, что дефицит в рублях рассчитался корректно: (15% - 10%) * 100 000 общего баланса = 5 000 руб.
      expect(sberAnalysis.deficitRub).toBe(5000);
    }
  });
});
