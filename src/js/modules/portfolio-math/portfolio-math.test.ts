import { describe, it, expect } from 'vitest';
import {
  IAsset,
  calculateGlobalAllocation,
  calculateRebalanceDelta,
  analyzeAssetLimits
} from './portfolio-math';

describe('Тестирование математического ядра ребалансировки портфеля', () => {

  // 1. Моделируем тестовый слепок вашего реального портфеля из Excel-отчета QUIK
  const mockAssets: IAsset[] = [
    { instrument: 'ИнтерРАОао', position: 17100, price: 2.2260, costValue: 38090.25, marketValue: 38064.60, assetClass: 'stock', accountType: 'brokerage' },
    { instrument: 'Брус 2P04', position: 100, price: 1014.59, costValue: 101539.00, marketValue: 101459.00, assetClass: 'bond', accountType: 'iis' },
    { instrument: 'Селигдар 10', position: 94, price: 1007.23, costValue: 94670.22, marketValue: 94679.62, assetClass: 'bond', accountType: 'iis' },
    { instrument: 'ѕГТЛК2P-14', position: 6, price: 996.06, costValue: 5977.56, marketValue: 5976.36, assetClass: 'bond', accountType: 'iis' },
    { instrument: 'Сбербанк', position: 140, price: 267.54, costValue: 37457.00, marketValue: 37455.60, assetClass: 'stock', accountType: 'brokerage' },
    { instrument: 'STME ETF', position: 6801, price: 4.17, costValue: 28428.18, marketValue: 28360.17, assetClass: 'stock', accountType: 'brokerage' },
    { instrument: 'Татифт Зао', position: 79, price: 547.00, costValue: 43220.90, marketValue: 43213.00, assetClass: 'stock', accountType: 'iis' },
    { instrument: 'КЦ ИКС 5', position: 26, price: 1747.50, costValue: 45422.00, marketValue: 45435.00, assetClass: 'stock', accountType: 'brokerage' },
    { instrument: 'Полюс', position: 100, price: 1051.40, costValue: 105140.00, marketValue: 105140.00, assetClass: 'stock', accountType: 'iis' }
  ];

  it('1. Должен корректно рассчитывать общие балансы акций и облигаций', () => {
    const allocation = calculateGlobalAllocation(mockAssets);

    // Проверяем, что общая рыночная стоимость портфеля около 500 007 рублей
    expect(allocation.totalValue).toBeCloseTo(499783.35, 1);
    // Проверяем, что котел разделился на две части
    expect(allocation.stockValue).toBeGreaterThan(0);
    expect(allocation.bondValue).toBeGreaterThan(0);
  });

  it('2. Должен выявлять дисбаланс сплита верхнего уровня (текущие доли vs 52/48)', () => {
    const allocation = calculateGlobalAllocation(mockAssets);
    const delta = calculateRebalanceDelta(allocation);

    // У вас сейчас акций ~59.5%, а должно быть 52%. Значит, система должна зафиксировать перебор по акциям
    expect(delta.currentShares.stock).toBeCloseTo(0.595, 2);
    // Проверяем, что дельта для облигаций положительная (требует докупки)
    expect(delta.actions.bondDelta).toBeGreaterThan(0);
  });

  it('3. Должен жестко БЛОКИРОВАТЬ Полюс (>20%) и давать сигнал BUY для ГТЛК (<10%)', () => {
    const allocation = calculateGlobalAllocation(mockAssets);
    const analysis = analyzeAssetLimits(mockAssets, allocation.totalValue);

    const polyus = analysis.find(a => a.instrument === 'Полюс');
    const gtlk = analysis.find(a => a.instrument === 'ѕГТЛК2P-14');

    // Проверяем вердикт по Полюсу
    expect(polyus).toBeDefined();
    expect(polyus!.status).toBe('BLOCK');
    expect(polyus!.suggestedQuantityToBuy).toBe(0);

    // Проверяем вердикт по ГТЛК
    expect(gtlk).toBeDefined();
    expect(gtlk!.status).toBe('BUY');
    // Система должна предложить докупить штуки, так как текущая доля всего 1.2% вместо 10%
    expect(gtlk!.suggestedQuantityToBuy).toBeGreaterThan(0);
  });
});
