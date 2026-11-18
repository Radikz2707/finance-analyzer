import type { AssetAnalysis } from '../../portfolio/portfolio-math/portfolio-math.js';
import type { StructuredAIAssetRecommendation } from './structured-ai-recommendation.js';
import {
  applyPolicyToNarrative,
  applyPolicyToRecommendation,
  isSellBlockedByPolicy,
  sanitizePolicyCardText,
  sanitizePolicyText,
} from './policy-text-guard.js';

const POLICY = { noSellTickers: ['PLZL'] };

function createAsset(o: Partial<AssetAnalysis> = {}): AssetAnalysis {
  return {
    name: 'Полюс',
    ticker: 'PLZL',
    assetType: 'А',
    currentPercent: 19.8,
    targetPercent: 10,
    deficitRub: -50000,
    status: 'REDUCE',
    dynamicsPercent: 0,
    nkdRub: 0,
    nominal: 0,
    quantity: 10,
    balancePrice: 1000,
    currentPrice: 420,
    unrealizedProfitRub: -58000,
    priority: 0,
    isConcentrated: true,
    ...o,
  };
}

function createRecommendation(
  o: Partial<StructuredAIAssetRecommendation> = {},
): StructuredAIAssetRecommendation {
  return {
    ticker: 'PLZL',
    name: 'Полюс',
    currentPercent: 19.8,
    userTargetPercent: 10,
    portfolioMathStatus: 'REDUCE',
    currentPrice: 420,
    balancePrice: 1000,
    drawdownPercent: -58,
    unrealizedProfitRub: -58000,
    currentQuantity: 10,
    liquidationValueRub: 4200,
    buyAmountRub: null,
    sellAmountRub: 50000,
    marketDataValid: true,
    executionBlocked: false,
    activeOrders: [],
    activeOrderConflict: false,
    strategistOverride: null,
    recommendedTargetPercent: null,
    recommendedAction: 'REDUCE',
    confidence: 0.8,
    rationale: 'Рекомендуется продать часть PLZL.',
    targetReason: null,
    keyRisks: [],
    keyCatalysts: [],
    agreementWithPortfolioMath: 'AGREE',
    technicalTiming: 'Сократите долю PLZL при отскоке.',
    entryStrategy: 'Продавайте PLZL в 1-2 партии.',
    ...o,
  };
}

describe('policy-text-guard', () => {
  it('заменяет императив «Продавайте PLZL»', () => {
    const result = sanitizePolicyText(
      'Продавайте PLZL в 1-2 партии.',
      'PLZL',
      POLICY,
      { requireTicker: false },
    );

    expect(result.changed).toBe(true);
    expect(result.text).toContain('держать');
    expect(result.text).not.toMatch(/Продавайте/i);
  });

  it('заменяет «Фиксация прибыли по PLZL»', () => {
    const result = sanitizePolicyText(
      'Фиксация прибыли по PLZL при отскоке.',
      'PLZL',
      POLICY,
      { requireTicker: false },
    );

    expect(result.changed).toBe(true);
    expect(result.text).toContain('держать');
    expect(result.text).not.toMatch(/Фиксация/i);
  });

  it('заменяет императив «Продайте PLZL на сумму -59 805 Р»', () => {
    const result = sanitizePolicyText(
      '1. Продайте PLZL на сумму -59 805 Р.',
      'PLZL',
      POLICY,
      { requireTicker: false },
    );

    expect(result.changed).toBe(true);
    expect(result.text).toContain('держать');
    expect(result.text).not.toMatch(/Продайте/i);
  });

  it('заменяет инфинитив «Рекомендуется продать часть PLZL»', () => {
    const result = sanitizePolicyText(
      'Рекомендуется продать часть PLZL.',
      'PLZL',
      POLICY,
      { requireTicker: false },
    );

    expect(result.changed).toBe(true);
    expect(result.text).toContain('держать');
    expect(result.text).not.toMatch(/продать/i);
  });

  it('заменяет «Сократите долю PLZL»', () => {
    const result = sanitizePolicyText(
      'Сократите долю PLZL при отскоке.',
      'PLZL',
      POLICY,
      { requireTicker: false },
    );

    expect(result.changed).toBe(true);
    expect(result.text).toContain('держать');
  });

  it('НЕ трогает нейтральное описание «ликвидность продажи»', () => {
    const text = 'Ликвидность продажи PLZL остаётся низкой.';
    const result = sanitizePolicyText(text, 'PLZL', POLICY, {
      requireTicker: false,
    });

    expect(result.changed).toBe(false);
    expect(result.text).toBe(text);
  });

  it('НЕ трогает нейтральное «объём продаж PLZL вырос»', () => {
    const text = 'Объём продаж PLZL вырос за неделю.';
    const result = sanitizePolicyText(text, 'PLZL', POLICY, {
      requireTicker: false,
    });

    expect(result.changed).toBe(false);
    expect(result.text).toBe(text);
  });

  it('НЕ трогает покупку no-sell тикера', () => {
    const text = 'Покупайте PLZL частями при просадке.';
    const result = sanitizePolicyText(text, 'PLZL', POLICY, {
      requireTicker: false,
    });

    expect(result.changed).toBe(false);
    expect(result.text).toBe(text);
  });

  it('sanitizePolicyCardText чистит весь блок PLZL: фиксацию, риск продажи, партии выхода', () => {
    const block = [
      'Как покупать/продавать:',
      'Частичная фиксация прибыли при отскоке к 450 ₽.',
      'Риск продажи по низкой цене высокий.',
      'План: первая партия выхода сейчас, вторая — при пробое 400 ₽.',
      'Покупайте в 2-3 партии только при закреплении выше 420 ₽.',
    ].join('\n');

    const result = sanitizePolicyCardText(block, 'PLZL');

    expect(result.changed).toBe(true);
    expect(result.text).not.toMatch(/частичн\w*\s+фиксац/i);
    expect(result.text).not.toMatch(/риск\w*\s+продаж/i);
    expect(result.text).not.toMatch(/парти\w*\s+выход/i);
    // Покупательная строка не должна быть удалена
    expect(result.text).toContain('Покупайте в 2-3 партии');
  });

  it('в narrative заменяет только предложение с no-sell тикером', () => {
    const assets = [
      createAsset(),
      createAsset({ ticker: 'SBER', name: 'Сбербанк', assetType: 'А' }),
    ];
    const text = 'Продавайте PLZL в 1-2 партии. Продавайте SBER при росте.';
    const result = applyPolicyToNarrative(text, assets, POLICY);

    expect(result).toContain('PLZL: держать');
    expect(result).not.toMatch(/Продавайте PLZL/i);
    expect(result).toContain('Продавайте SBER');
  });

  it('narrative line-context: строка без тикера после заголовка PLZL тоже чистится', () => {
    const assets = [createAsset()];
    const text = [
      '## 2. План ребалансировки',
      'PLZL:',
      '1. Продайте на сумму -59 805 Р.',
      '2. → рекомендуется сократить на 59 805 ₽.',
      '## 3. Мониторинг',
      'SBER: покупать частями.',
    ].join('\n');

    const result = applyPolicyToNarrative(text, assets, POLICY);

    expect(result).not.toMatch(/Продайте PLZL/i);
    expect(result).not.toMatch(/сократить на 59 805/i);
    expect(result).toContain('PLZL: держать');
    expect(result).toContain('SBER: покупать частями');
  });

  it('applyPolicyToRecommendation: REDUCE → HOLD и нейтральный entryStrategy', () => {
    const result = applyPolicyToRecommendation(
      createRecommendation(),
      createAsset(),
      POLICY,
    );

    expect(result.recommendedAction).toBe('HOLD');
    expect(result.policyBlocked).toBe(true);
    expect(result.entryStrategy).toContain('Держать');
    expect(result.entryStrategy).not.toMatch(/Продавайте/i);
    expect(result.rationale).toContain('Заблокировано политикой');
  });

  it('applyPolicyToRecommendation: REDUCE чистит technicalTiming и entryStrategy целиком', () => {
    const result = applyPolicyToRecommendation(
      createRecommendation({
        technicalTiming:
          'Лучшая точка для сделки: частичная фиксация прибыли на 450 ₽. Риск продажи по низкой цене.',
        entryStrategy:
          'Продавайте PLZL в 1-2 партии. Первая партия выхода сейчас, вторая — ниже 400 ₽.',
      }),
      createAsset(),
      POLICY,
    );

    expect(result.recommendedAction).toBe('HOLD');
    expect(result.technicalTiming).toBe(
      'Держать. Продажа/сокращение заблокированы политикой no-sell.',
    );
    expect(result.entryStrategy).toBe(
      'Держать. Продажа/сокращение заблокированы политикой no-sell.',
    );
    expect(result.technicalTiming).not.toMatch(/фиксац|риск продаж/i);
    expect(result.entryStrategy).not.toMatch(/парти\w*\s+выход/i);
  });

  it('applyPolicyToRecommendation: BUY сохраняется, но sell-текст чистится', () => {
    const result = applyPolicyToRecommendation(
      createRecommendation({
        recommendedAction: 'BUY',
        rationale: 'Покупайте PLZL частями.',
        entryStrategy: 'Продавайте PLZL в 1-2 партии.',
      }),
      createAsset(),
      POLICY,
    );

    expect(result.recommendedAction).toBe('BUY');
    expect(result.policyBlocked).toBe(false);
    expect(result.policyTextBlocked).toBe(true);
    expect(result.entryStrategy).not.toMatch(/Продавайте/i);
  });

  it('narrative: indirect sell и хвост «5%) слишком высока» заменяются целым предложением', () => {
    const text =
      'Доля PLZL (17,7% → 5%) слишком высока для спутникового актива. ' +
      'Средства от продажи PLZL направим в ОФЗ. ' +
      'Продажи (за счет профицита PLZL) профинансируют покупки.';

    const result = applyPolicyToNarrative(text, [createAsset()], POLICY);

    expect(result).not.toMatch(/5%\)\s*слишком высока/i);
    expect(result).not.toMatch(/средства от продажи/i);
    expect(result).not.toMatch(/за счет профицита/i);
    expect(result).toContain('политикой no-sell');
  });

  it('technicalTiming: «точка для фиксации части прибыли» санируется при policy-blocked', () => {
    const result = applyPolicyToRecommendation(
      createRecommendation({
        recommendedAction: 'HOLD',
        technicalTiming:
          'Лучшая точка для сделки: точка для фиксации части прибыли при отскоке.',
      }),
      createAsset(),
      POLICY,
    );

    expect(result.technicalTiming).not.toMatch(/фиксац/i);
    expect(result.technicalTiming).toContain('политикой no-sell');
    expect(result.policyTextBlocked).toBe(true);
  });

  it('isSellBlockedByPolicy: тикер и тип актива', () => {
    expect(isSellBlockedByPolicy(createAsset(), POLICY)).toBe(true);
    expect(
      isSellBlockedByPolicy(
        createAsset({ ticker: 'RU000A10C8F3', assetType: 'О' }),
        { noSellAssetTypes: ['О'] },
      ),
    ).toBe(true);
    expect(isSellBlockedByPolicy(createAsset({ ticker: 'SBER' }), POLICY)).toBe(
      false,
    );
  });
});
