import { describe, it, expect } from 'vitest';
import { IAsset, calculateGlobalAllocation, calculateRebalanceDelta, analyzeAssetLimits } from '../portfolio-math/portfolio-math';
import { generateAiPrompt } from './ai-advisor';

describe('Тестирование модуля генерации промптов ai-advisor', () => {

  // Берем слепок вашего реального портфеля из Excel для проверки связки модулей
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

  it('1. Должен генерировать наполненный текстом промпт на основе переданной математики', () => {
    // 1. Прогоняем данные через математическое ядро
    const globalAllocation = calculateGlobalAllocation(mockAssets);
    const rebalanceDelta = calculateRebalanceDelta(globalAllocation);
    const assetsAnalysis = analyzeAssetLimits(mockAssets, globalAllocation.totalValue);

    // 2. Генерируем итоговый промпт для ИИ
    const prompt = generateAiPrompt({
      globalAllocation,
      rebalanceDelta,
      assetsAnalysis
    });

    // Печатаем сгенерированный промпт в консоль, чтобы вы могли оценить результат живьем
    console.log('\n=== СГЕНЕРИРОВАННЫЙ ПРОМПТ ДЛЯ ЛОКАЛЬНОГО ИИ ===\n', prompt, '\n================================================\n');

    // Тесты-проверки: текст должен быть длинным и содержать ключевые триггеры вашей стратегии
    expect(prompt).toBeDefined();
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain('Радика Нурисламовича');
    expect(prompt).toContain('КРИТИЧЕСКИЙ ПЕРЕБОР'); // Полюс должен затриггерить этот статус
    expect(prompt).toContain('СИГНАЛ НА ПОКУПКУ');    // ГТЛК должна затриггерить этот статус
  });
});
