import { describe, it, expect } from 'vitest';
import {
  suggestAllAutoTargets,
} from './auto-target-allocator.js';
import type { CurrentAsset } from '../xlsx-parser/xlsx-parser.js';

// --- Helpers ---

function createMockAsset(options: {
  ticker?: string;
  name?: string;
  assetType?: string;
  targetPercent?: number;
  quantity?: number;
}): CurrentAsset {
  return {
    name: options.name ?? 'Тест',
    ticker: options.ticker ?? 'TEST',
    assetType: options.assetType ?? 'А',
    targetPercent: options.targetPercent,
    liquidationPercent: 0,
    balancePercent: 0,
    unrealizedProfitRub: 0,
    dynamicsPercent: 0,
    quantity: options.quantity,
  };
}

const macroStocksPct = 40;
const macroBondsPct = 40;

// --- Tests ---

describe('Regression: auto-target-allocator semantics', () => {
  // 1. target=0 НЕ получает auto-target
  it('Тест 1: актив с targetPercent=0 НЕ получает auto-target', () => {
    const assets: CurrentAsset[] = [
      createMockAsset({ ticker: 'EXIT1', name: 'Актив EXIT', assetType: 'А', targetPercent: 0, quantity: 100 }),
      createMockAsset({ ticker: 'EXIT2', name: 'Обл EXIT', assetType: 'О', targetPercent: 0, quantity: 50 }),
    ];

    const results = suggestAllAutoTargets(assets, macroStocksPct, macroBondsPct);

    expect(results).toHaveLength(0);
  });

  // 2. target=undefined получает auto-target для UI
  it('Тест 2: актив с targetPercent=undefined получает auto-target', () => {
    const assets: CurrentAsset[] = [
      createMockAsset({ ticker: 'NOMACRO', name: 'Новая акция', assetType: 'А', quantity: 100 }),
    ];

    const results = suggestAllAutoTargets(assets, macroStocksPct, macroBondsPct);

    expect(results).toHaveLength(1);
    expect(results[0].ticker).toBe('NOMACRO');
    expect(results[0].suggestedTargetPercent).toBeGreaterThan(0);
  });

  // 3. target=0 остаётся EXIT (не получает suggestedTargetPercent)
  it('Тест 3: актив с targetPercent=0 остаётся EXIT — без suggestedTargetPercent', () => {
    const assets: CurrentAsset[] = [
      createMockAsset({ ticker: 'STAYEXIT', name: 'Остаюсь EXIT', assetType: 'А', targetPercent: 0, quantity: 200 }),
    ];

    const results = suggestAllAutoTargets(assets, macroStocksPct, macroBondsPct);

    expect(results).toHaveLength(0);
    // Проверяем что EXIT-актив НЕ попал в результаты
    const exitTicker = 'STAYEXIT';
    const found = results.find((r) => r.ticker === exitTicker);
    expect(found).toBeUndefined();
  });

  // 4. newAssetsForAi не содержит "рекомендуется 3%"
  it('Тест 4: newAssetsForAi не содержит "рекомендуется" для exit-активов', () => {
    const assets: CurrentAsset[] = [
      createMockAsset({ ticker: 'EXIT_NO_AUTO', name: 'Exit', assetType: 'А', targetPercent: 0, quantity: 100 }),
      createMockAsset({ ticker: 'AUTO_OK', name: 'Авто', assetType: 'А', quantity: 50 }),
    ];

    const autoTargets = suggestAllAutoTargets(assets, macroStocksPct, macroBondsPct);

    // Формируем newAssetsForAi так же, как в ai-advisor.ts
    let newAssetsForAi = '';
    if (autoTargets.length > 0) {
      newAssetsForAi =
        '\n=== НОВЫЕ АКТИВЫ (без целевой доли) ===\n' +
        autoTargets
          .map(
            (t) =>
              '- ' +
              t.ticker +
              ' (' +
              t.name +
              '): текущая доля 0%, рекомендуется ' +
              t.suggestedTargetPercent +
              '% (' +
              t.reason +
              ')',
          )
          .join('\n') +
        '\n';
    }

    // EXIT-актив НЕ должен быть в newAssetsForAi
    expect(newAssetsForAi).not.toContain('EXIT_NO_AUTO');
  });

  // 5. newAssetsForAi не содержит "Рекомендуемая базовая доля" для exit-активов
  it('Тест 5: newAssetsForAi не содержит "Рекомендуемая базовая доля" для exit-активов', () => {
    const assets: CurrentAsset[] = [
      createMockAsset({ ticker: 'ETF_EXIT', name: 'ETF EXIT', assetType: 'Ф', targetPercent: 0, quantity: 30 }),
    ];

    const autoTargets = suggestAllAutoTargets(assets, macroStocksPct, macroBondsPct);

    expect(autoTargets).toHaveLength(0);

    let newAssetsForAi = '';
    if (autoTargets.length > 0) {
      newAssetsForAi =
        '\n=== НОВЫЕ АКТИВЫ (без целевой доли) ===\n' +
        autoTargets
          .map(
            (t) =>
              '- ' +
              t.ticker +
              ' (' +
              t.name +
              '): текущая доля 0%, рекомендуется ' +
              t.suggestedTargetPercent +
              '% (' +
              t.reason +
              ')',
          )
          .join('\n') +
        '\n';
    }

    // Для exit-активов не должно быть рекомендаций
    expect(newAssetsForAi).not.toContain('ETF_EXIT');
    expect(newAssetsForAi).not.toContain('Рекомендуемая базовая доля');
  });

  // 6. актив с target=0 не попадает в "assets without target"
  it('Тест 6: актив с targetPercent=0 не попадает в assets without target', () => {
    const exitAsset = createMockAsset({
      ticker: 'EXIT_ASSET',
      name: 'Актив на выход',
      assetType: 'А',
      targetPercent: 0,
      quantity: 100,
    });

    const noTargetAsset = createMockAsset({
      ticker: 'NO_TARGET_ASSET',
      name: 'Без цели',
      assetType: 'А',
      quantity: 50,
    });

    const allAssets = [exitAsset, noTargetAsset];

    const autoTargets = suggestAllAutoTargets(allAssets, macroStocksPct, macroBondsPct);

    // Только актив без цели должен попасть в auto-target
    expect(autoTargets).toHaveLength(1);
    expect(autoTargets[0].ticker).toBe('NO_TARGET_ASSET');

    // EXIT-актив не должен быть в результатах
    const exitFound = autoTargets.find((r) => r.ticker === 'EXIT_ASSET');
    expect(exitFound).toBeUndefined();
  });

  // 7. актив без target попадает в assets without target
  it('Тест 7: актив без target (undefined) попадает в assets without target', () => {
    const noTargetAsset1 = createMockAsset({
      ticker: 'NT1',
      name: 'Новая акция 1',
      assetType: 'А',
      quantity: 100,
    });

    const noTargetAsset2 = createMockAsset({
      ticker: 'NT2',
      name: 'Новая облигация',
      assetType: 'О',
      quantity: 50,
    });

    const noTargetFund = createMockAsset({
      ticker: 'NT3',
      name: 'Новый ETF',
      assetType: 'Ф',
      quantity: 30,
    });

    const allAssets = [noTargetAsset1, noTargetAsset2, noTargetFund];

    const autoTargets = suggestAllAutoTargets(allAssets, macroStocksPct, macroBondsPct);

    // Все три актива без цели должны попасть в auto-target
    expect(autoTargets).toHaveLength(3);

    const tickers = autoTargets.map((r) => r.ticker);
    expect(tickers).toContain('NT1');
    expect(tickers).toContain('NT2');
    expect(tickers).toContain('NT3');

    // Каждый должен иметь suggestedTargetPercent > 0
    for (const result of autoTargets) {
      expect(result.suggestedTargetPercent).toBeGreaterThan(0);
    }
  });
});
