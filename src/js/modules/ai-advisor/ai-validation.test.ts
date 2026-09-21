/**
 * Тесты для ai-validation.ts
 *
 * Проверяют:
 *  1. Валидацию направлений (BUY vs REDUCE/EXIT)
 *  2. Удаление галлюцинированных цен/количеств/сумм
 *  3. Проверку исключённых активов
 *  4. Полную пост-обработку
 */

import { describe, it, expect } from 'vitest';
import {
  validateDirections,
  removeHallucinatedData,
  checkExcludedAssets,
  postProcessAiText,
} from './ai-validation.js';
import type { AssetAnalysis } from '../portfolio-math/portfolio-math.js';

// ============================================================================
// Моки для AssetAnalysis
// ============================================================================

function createMockAsset(overrides: Partial<AssetAnalysis> = {}): AssetAnalysis {
  return {
    name: 'Тестовый актив',
    ticker: 'TEST',
    assetType: 'Акция',
    currentPercent: 5,
    targetPercent: 10,
    deficitRub: 50000,
    status: 'BUY',
    dynamicsPercent: 0,
    nkdRub: 0,
    nominal: 100,
    quantity: 100,
    balancePrice: 90,
    currentPrice: 95,
    unrealizedProfitRub: 500,
    priority: 50000,
    isConcentrated: false,
    ...overrides,
  };
}

// ============================================================================
// Тесты валидации направлений
// ============================================================================

describe('validateDirections', () => {
  it('должна возвращать valid=true когда AI не конфликтует с PortfolioMath', () => {
    const assets: AssetAnalysis[] = [
      createMockAsset({
        ticker: 'SBER',
        status: 'BUY',
        deficitRub: 100000,
      }),
    ];

    const aiText = 'Для SBER рекомендуется докупка для достижения целевой доли.';
    const result = validateDirections(aiText, assets);

    expect(result.valid).toBe(true);
    expect(result.discrepancies).toHaveLength(0);
  });

  it('должна обнаруживать конфликт BUY vs продажа', () => {
    const assets: AssetAnalysis[] = [
      createMockAsset({
        ticker: 'SBER',
        status: 'BUY',
        deficitRub: 100000,
      }),
    ];

    const aiText = 'SBER: рекомендуется продажа позиции, так как перебор.';
    const result = validateDirections(aiText, assets);

    expect(result.valid).toBe(false);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].ticker).toBe('SBER');
    expect(result.discrepancies[0].portfolioMathStatus).toBe('BUY');
    expect(result.discrepancies[0].severity).toBe('medium');
  });

  it('должна обнаруживать конфликт EXIT vs докупка', () => {
    const assets: AssetAnalysis[] = [
      createMockAsset({
        ticker: 'SBRB',
        status: 'EXIT',
        deficitRub: -50000,
      }),
    ];

    const aiText = 'SBRB: нужно докупить больше акций.';
    const result = validateDirections(aiText, assets);

    expect(result.valid).toBe(false);
    expect(result.discrepancies).toHaveLength(1);
  });

  it('должна игнорировать HOLD и STABLE', () => {
    const assets: AssetAnalysis[] = [
      createMockAsset({
        ticker: 'GMKN',
        status: 'HOLD',
      }),
    ];

    const aiText = 'GMKN: можно продать или купить.';
    const result = validateDirections(aiText, assets);

    expect(result.valid).toBe(true);
  });

  it('должна игнорировать активы без тикера в тексте', () => {
    const assets: AssetAnalysis[] = [
      createMockAsset({
        ticker: 'ROSN',
        status: 'BUY',
      }),
    ];

    const aiText = 'Для других активов ситуация нейтральная.';
    const result = validateDirections(aiText, assets);

    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// Тесты удаления галлюцинированных данных
// ============================================================================

describe('removeHallucinatedData', () => {
  it('должна удалять "по текущей цене [число] ₽"', () => {
    const text = 'Для SBER рекомендуется докупка по текущей цене 1012.22 ₽.';
    const result = removeHallucinatedData(text);

    expect(result.cleanedText).not.toContain('1012.22');
    expect(result.cleanedText).toContain('[ДАННЫЕ_УДАЛЕНЫ]');
    expect(result.removedHallucinations).toHaveLength(1);
    expect(result.removedHallucinations[0].type).toBe('price');
  });

  it('должна удалять "по цене [число] ₽"', () => {
    const text = 'Рекомендуется докупка по цене 1785 ₽.';
    const result = removeHallucinatedData(text);

    expect(result.cleanedText).not.toContain('1785');
    expect(result.removedHallucinations).toHaveLength(1);
  });

  it('должна удалять "на сумму [число] ₽"', () => {
    const text = 'Рекомендуется продажа части позиции на сумму 17 304 ₽.';
    const result = removeHallucinatedData(text);

    expect(result.cleanedText).not.toContain('17 304');
    expect(result.cleanedText).toContain('[ДАННЫЕ_УДАЛЕНЫ]');
    expect(result.removedHallucinations[0].type).toBe('amount');
  });

  it('должна удалять "Рекомендуется продажа по текущей цене"', () => {
    const text = 'SBRB: Рекомендуется полная продажа по текущей цене 19.032 ₽.';
    const result = removeHallucinatedData(text);

    expect(result.cleanedText).not.toContain('19.032');
    expect(result.removedHallucinations.length).toBeGreaterThan(0);
  });

  it('должна удалять "[ТИКЕР]: [число] ₽"', () => {
    const text = 'PLZL: 44 266 ₽ — это галлюцинация.';
    const result = removeHallucinatedData(text);

    expect(result.cleanedText).not.toContain('44 266');
    expect(result.removedHallucinations[0].type).toBe('amount');
  });

  it('должна удалять "[ТИКЕР] по цене [число]"', () => {
    const text = 'SBER по цене 280 руб — это выдуманная цена.';
    const result = removeHallucinatedData(text);

    expect(result.cleanedText).not.toContain('280');
    expect(result.removedHallucinations[0].type).toBe('price');
  });

  it('должна удалять "[ТИКЕР]: [число] шт"', () => {
    const text = 'SBER: 100 шт — это выдуманное количество.';
    const result = removeHallucinatedData(text);

    expect(result.cleanedText).not.toContain('100 шт');
    expect(result.removedHallucinations[0].type).toBe('quantity');
  });

  it('должна оставлять детерминированные данные без цен/количеств', () => {
    const text = 'Дефицит +8 137 ₽. Целевая доля 12%.';
    const result = removeHallucinatedData(text);

    // Эти числа не должны удаляться — это не цены и не количества
    expect(result.cleanedText).toContain('8 137');
    expect(result.removedHallucinations).toHaveLength(0);
  });

  it('должна обрабатывать множественные галлюцинации', () => {
    const text = 'SBER по текущей цене 100 ₽. Купить на сумму 50 000 ₽. GMKN: 50 шт.';
    const result = removeHallucinatedData(text);

    expect(result.cleanedText).not.toContain('100');
    expect(result.cleanedText).not.toContain('50 000');
    expect(result.cleanedText).not.toContain('50 шт');
    expect(result.removedHallucinations).toHaveLength(3);
  });
});

// ============================================================================
// Тесты проверки исключённых активов
// ============================================================================

describe('checkExcludedAssets', () => {
  it('должна обнаруживать "Итого"', () => {
    const text = 'Итого портфель стоит 1 000 000 ₽.';
    const result = checkExcludedAssets(text);

    expect(result.valid).toBe(false);
    expect(result.foundMentions).toHaveLength(1);
    expect(result.foundMentions[0].assetName.toLowerCase()).toContain('итого');
  });

  it('должна обнаруживать "Баланс"', () => {
    const text = 'Баланс активов составляет 500 000 ₽.';
    const result = checkExcludedAssets(text);

    expect(result.valid).toBe(false);
  });

  it('должна обнаруживать "общая сумма"', () => {
    const text = 'Общая сумма позиций — 750 000 ₽.';
    const result = checkExcludedAssets(text);

    expect(result.valid).toBe(false);
  });

  it('должна пропускать нормальный текст', () => {
    const text = 'SBER показывает рост на 5%.';
    const result = checkExcludedAssets(text);

    expect(result.valid).toBe(true);
    expect(result.foundMentions).toHaveLength(0);
  });
});

// ============================================================================
// Тесты полной пост-обработки
// ============================================================================

describe('postProcessAiText', () => {
  it('должна выполнять все проверки и возвращать warnings', () => {
    const assets: AssetAnalysis[] = [
      createMockAsset({
        ticker: 'SBER',
        status: 'BUY',
        deficitRub: 100000,
      }),
    ];

    const aiText = 'SBER: рекомендуется продажа по текущей цене 100 ₽. Итого портфель стоит 1 000 000 ₽.';
    const result = postProcessAiText(aiText, assets);

    expect(result.directionValidation.valid).toBe(false);
    expect(result.hallucinationRemoval.removedHallucinations.length).toBeGreaterThan(0);
    expect(result.excludedAssetsCheck.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('должна возвращать пустые warnings для чистого текста', () => {
    const assets: AssetAnalysis[] = [
      createMockAsset({
        ticker: 'SBER',
        status: 'BUY',
      }),
    ];

    const aiText = 'SBER соответствует стратегии. Рекомендуется мониторинг.';
    const result = postProcessAiText(aiText, assets);

    expect(result.warnings).toHaveLength(0);
    expect(result.cleanedText).toBe(aiText);
  });

  it('должна очищать текст из примера со скриншота', () => {
    const assets: AssetAnalysis[] = [
      createMockAsset({
        ticker: 'T90',
        name: 'Т90 (Точка-90)',
        status: 'BUY',
        deficitRub: 8137,
      }),
      createMockAsset({
        ticker: 'SBRB',
        name: 'SBRB ETF',
        status: 'EXIT',
        deficitRub: -9500000,
      }),
    ];

    const aiText =
      '• T90 (Точка-90): Статус BUY. Дефицит +8 137 ₽. Рекомендуется докупка по текущей цене 1012.22 ₽.\n' +
      '• SBRB: Статус EXIT. Рекомендуется полная продажа по текущей цене 19.032 ₽.';

    const result = postProcessAiText(aiText, assets);

    // Проверка что цены удалены
    expect(result.cleanedText).not.toContain('1012.22');
    expect(result.cleanedText).not.toContain('19.032');

    // Проверка что есть предупреждения
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
