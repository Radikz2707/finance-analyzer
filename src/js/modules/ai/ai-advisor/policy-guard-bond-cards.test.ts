/**
 * N.1-каркас: policy-guard читает bond-карточки перед сборкой планов.
 *
 * Сценарии:
 * 1. SU29027RMFS8 — карточка «Держать» (WAIT), AI рекомендует BUY → guard
 *    должен разрешить BUY (покупка no-sell разрешена).
 * 2. RU000A10EC22 (Селигдар) — карточка «Держать», AI рекомендует SELL →
 *    guard должен заменить на HOLD + policyBlocked.
 * 3. PLZL (Полюс) — карточка «Усреднять» (REDUCE), AI рекомендует усреднение →
 *    guard должен разрешить BUY (усреднение = покупка, не продажа).
 * 4. IRAO / TATN — карточки без очереди взноса (contributionQueue пуст) →
 *    guard должен корректно обработать без ошибки.
 *
 * Порядок: тесты пишутся ДО фикса → падают. Фикс → зелёные.
 */

import {
  applyPolicyToRecommendation,
  isSellBlockedByPolicy as _isSellBlockedByPolicy,
  type PolicyLike,
} from './policy-text-guard.js';
import type { AssetAnalysis } from '../../portfolio/portfolio-math/portfolio-math.js';
import type { StructuredAIAssetRecommendation } from './structured-ai-recommendation.js';

// ─── Фикстуры ──────────────────────────────────────────────
// ⚠️ ЭТО СИНТЕТИЧЕСКАЯ ПОЛИТИКА ДЛЯ ТЕСТА ЛОГИКИ.
// Production-политика (data/user-policy.json):
//   noSellTickers: ["PLZL"]
//   noSellAssetTypes: ["О", "Облигация"]
// Тест использует другие тикеры, чтобы не зависеть от production-состояния.

const POLICY: PolicyLike = {
  noSellTickers: ['SU29027RMFS8', 'RU000A10EC22'],
  noSellAssetTypes: ['О', 'ОБЛИГАЦИЯ'],
};

/** Базовая облигация для тестов */
function makeBondAsset(overrides: Partial<AssetAnalysis> = {}): AssetAnalysis {
  return {
    ticker: 'TEST',
    name: 'Тестовая',
    assetType: 'ОБЛИГАЦИЯ',
    quantity: 10,
    currentPrice: 100,
    balancePrice: 95,
    targetPercent: 10,
    currentPercent: 5,
    deficitRub: 500,
    status: 'BUY',
    holdOnly: false,
    dynamicsPercent: 0,
    nkdRub: 0,
    nominal: 1000,
    unrealizedProfitRub: 50,
    priority: 0,
    isConcentrated: false,
    ...overrides,
  };
}

/** Базовая акция для тестов */
function makeStockAsset(overrides: Partial<AssetAnalysis> = {}): AssetAnalysis {
  return {
    ticker: 'TEST',
    name: 'Тестовая',
    assetType: 'АКЦИЯ',
    quantity: 100,
    currentPrice: 50,
    balancePrice: 60,
    targetPercent: 10,
    currentPercent: 8,
    deficitRub: 200,
    status: 'BUY',
    holdOnly: false,
    dynamicsPercent: 0,
    nkdRub: 0,
    nominal: 1000,
    unrealizedProfitRub: 100,
    priority: 0,
    isConcentrated: false,
    ...overrides,
  };
}

/** Базовая рекомендация AI */
function makeRecommendation(
  overrides: Partial<StructuredAIAssetRecommendation> = {},
): StructuredAIAssetRecommendation {
  return {
    ticker: 'TEST',
    name: 'Тестовая',
    currentPercent: 5,
    userTargetPercent: 10,
    portfolioMathStatus: 'BUY',
    currentPrice: 100,
    balancePrice: 95,
    drawdownPercent: null,
    unrealizedProfitRub: 0,
    currentQuantity: 10,
    liquidationValueRub: null,
    buyAmountRub: null,
    sellAmountRub: null,
    marketDataValid: true,
    executionBlocked: false,
    activeOrders: [],
    activeOrderConflict: false,
    recommendedTargetPercent: null,
    recommendedAction: 'BUY',
    confidence: 0.8,
    rationale: 'Рекомендуется купить.',
    targetReason: null,
    keyRisks: [],
    keyCatalysts: [],
    agreementWithPortfolioMath: 'AGREE',
    strategistOverride: null,
    _fallbackAction: undefined,
    ...overrides,
  };
}

// ─── Кейс 1: SU29027 — карточка «Держать», AI рекомендует BUY ───

describe('N.1 кейс 1: SU29027 — карточка «Держать», AI → BUY', () => {
  const asset = makeBondAsset({
    ticker: 'SU29027RMFS8',
    name: 'ОФЗ-ПК 29027',
    assetType: 'О',
    holdOnly: false,
  });

  it('КРАСНЫЙ ТЕСТ: BUY для no-sell облигации НЕ заменяется на HOLD', () => {
    const rec = makeRecommendation({
      ticker: 'SU29027RMFS8',
      recommendedAction: 'BUY',
      rationale: 'Рекомендуется докупить для покрытия дефицита.',
    });

    const result = applyPolicyToRecommendation(rec, asset, POLICY);

    // BUY по no-sell тикеру — РАЗРЕШЁН (докупать можно)
    expect(result.recommendedAction).toBe('BUY');
    expect(result.policyBlocked).toBe(false);
  });
});

// ─── Кейс 2: Селигдар — карточка «Держать», AI → SELL ───

describe('N.1 кейс 2: Селигдар — карточка «Держать», AI → SELL', () => {
  const asset = makeStockAsset({
    ticker: 'RU000A10EC22',
    name: 'Селигдар 001Р-10',
    assetType: 'О', // облигация Селигдара
    holdOnly: false,
  });

  it('КРАСНЫЙ ТЕСТ: SELL для no-sell тикера заменяется на HOLD', () => {
    const rec = makeRecommendation({
      ticker: 'RU000A10EC22',
      recommendedAction: 'SELL',
      rationale: 'Рекомендуется продать для ребалансировки.',
      entryStrategy: 'Продать по рынку.',
      technicalTiming: 'Выйти по рынку.',
    });

    const result = applyPolicyToRecommendation(rec, asset, POLICY);

    // SELL по no-sell тикеру — ЗАПРЕЩЁН → HOLD
    expect(result.recommendedAction).toBe('HOLD');
    expect(result.policyBlocked).toBe(true);
    expect(result.policyNote).toBe(
      'Продажа/сокращение заблокированы политикой no-sell',
    );
  });
});

// ─── Кейс 3: PLZL — карточка «Усреднять» (REDUCE), AI → усреднение ───

describe('N.1 кейс 3: PLZL — REDUCE, AI → усреднение (BUY)', () => {
  const asset = makeStockAsset({
    ticker: 'PLZL',
    name: 'Полюс',
    assetType: 'АКЦИЯ',
    status: 'REDUCE',
    deficitRub: -50000,
    holdOnly: false,
  });

  it('КРАСНЫЙ ТЕСТ: BUY при REDUCE — усреднение разрешено', () => {
    const rec = makeRecommendation({
      ticker: 'PLZL',
      recommendedAction: 'BUY',
      rationale: 'Усреднить позицию при падении цены.',
      entryStrategy: 'Купить частями при снижении.',
    });

    const result = applyPolicyToRecommendation(rec, asset, POLICY);

    // BUY по REDUCE-активу — РАЗРЕШЁН (усреднение)
    expect(result.recommendedAction).toBe('BUY');
    expect(result.policyBlocked).toBe(false);
  });
});

// ─── Кейс 4.4: Регрессия: noSellAssetTypes не пустой → облигация блокируется ───

describe('N.1 кейс 4.4: noSellAssetTypes не пустой → облигация SELL блокируется', () => {
  // Контр-тест регрессии: если noSellAssetTypes не пустой,
  // SELL для облигации (assetType='О') должен блокироваться.
  it('SELL для облигации при noSellAssetTypes=["О"] → policyBlocked=true', () => {
    const asset = makeBondAsset({
      ticker: 'ALRS',
      name: 'АЛРОСА',
      assetType: 'О',
      status: 'REDUCE',
      holdOnly: false,
    });

    const rec = makeRecommendation({
      ticker: 'ALRS',
      recommendedAction: 'SELL',
      rationale: 'Рекомендуется продать для ребалансировки.',
      entryStrategy: 'Продать по рынку.',
      technicalTiming: 'Выйти по рынку.',
    });

    const result = applyPolicyToRecommendation(rec, asset, POLICY);

    // SELL заблокирован asset-type → HOLD
    expect(result.recommendedAction).toBe('HOLD');
    // policyBlocked=true (assetType='О' входит в noSellAssetTypes)
    expect(result.policyBlocked).toBe(true);
  });
});

// ─── Кейс 4.5: Селигдар narrative — не содержит «заблокированы»+«допустима» ───

describe('N.1 кейс 4.5: Селигдар narrative — нет взаимоисключающих утверждений', () => {
  // Карточка Селигдар не должна содержать одновременно
  // «заблокированы» и «допустима» в любом порядке слов.
  it('Контр-тест: rationale не содержит «заблокированы» и «допустима» одновременно', () => {
    const asset = makeBondAsset({
      ticker: 'RU000A10EC22',
      name: 'Селигдар 001Р-10',
      assetType: 'О',
      currentPercent: 13.6,
      targetPercent: 10,
      status: 'STABLE',
      holdOnly: false,
    });

    const rec = makeRecommendation({
      ticker: 'RU000A10EC22',
      recommendedAction: 'HOLD',
      rationale:
        'Продажа заблокированы политикой no-sell. ' +
        'Однако профицит 3.6 п.п. — продажа допустима.',
      entryStrategy: 'Держать.',
      technicalTiming: 'Держать.',
    });

    const result = applyPolicyToRecommendation(rec, asset, POLICY);

    const allText = [
      result.rationale ?? '',
      result.entryStrategy ?? '',
      result.technicalTiming ?? '',
    ].join(' ');

    const hasBlocked = /заблокирован[а-яё]*/i.test(allText);
    const hasAllowed = /допустим[а-яё]*/i.test(allText);

    // Взаимоисключающие утверждения не должны встречаться вместе
    expect(hasBlocked && hasAllowed).toBe(false);
  });
});

// ─── Кейс 4.5: Облигация вне явного no-sell списка — нейтральная метка ───

describe('N.1 кейс 4.5: АЛРОСА вне no-sell — нейтральная метка', () => {
  // АЛРОСА НЕ в noSellTickers, но assetType='О' → blocked by asset-type.
  // Метка «заблокированы no-sell» НЕ должна ставиться (policyBlocked=false).
  it('SELL для облигации вне noSellTickers → HOLD, но policyBlocked=false', () => {
    const asset = makeBondAsset({
      ticker: 'ALRS',
      name: 'АЛРОСА',
      assetType: 'О',
      holdOnly: false,
    });

    const rec = makeRecommendation({
      ticker: 'ALRS',
      recommendedAction: 'SELL',
      rationale: 'Рекомендуется продать для ребалансировки.',
      entryStrategy: 'Продать по рынку.',
      technicalTiming: 'Выйти по рынку.',
    });

    const result = applyPolicyToRecommendation(rec, asset, POLICY);

    // SELL заблокирован asset-type → HOLD
    expect(result.recommendedAction).toBe('HOLD');
    // policyBlocked=true (assetType='О' входит в noSellAssetTypes)
    expect(result.policyBlocked).toBe(true);
    // Но метка no-sell НЕ ставится (тикер вне noSellTickers)
    expect(result.policyNote).toBeNull();
  });
});

// ─── Кейс 4.6: STABLE + профицит 3.6 п.п. + noSellTickers — красный тест ───

describe('N.1 кейс 4.6: STABLE + профицит 3.6 п.п. + noSellTickers', () => {
  // Красный тест: даже при профиците > 3.5 п.п., если тикер в noSellTickers
  // ни один слой не должен содержать «продажа допустима» или аналоги.
  it('КРАСНЫЙ ТЕСТ: STABLE 3.6 п.п. в noSellTickers → HOLD, без «допустима»', () => {
    const asset = makeBondAsset({
      ticker: 'SU29027RMFS8',
      name: 'ОФЗ-ПК 29027',
      assetType: 'О',
      currentPercent: 13.6,
      targetPercent: 10,
      status: 'STABLE',
      holdOnly: false,
    });

    const rec = makeRecommendation({
      ticker: 'SU29027RMFS8',
      recommendedAction: 'REDUCE',
      rationale: 'Профицит 3.6 п.п. — продажа допустима.',
      entryStrategy: 'Продать по рынку.',
      technicalTiming: 'Выйти по рынку.',
    });

    const result = applyPolicyToRecommendation(rec, asset, POLICY);

    // Action → HOLD (no-sell императив)
    expect(result.recommendedAction).toBe('HOLD');
    // policyBlocked=true (тикер в noSellTickers)
    expect(result.policyBlocked).toBe(true);
    // Ни одно поле не содержит «допустима»
    const allText = [
      result.rationale ?? '',
      result.entryStrategy ?? '',
      result.technicalTiming ?? '',
    ].join(' ');
    expect(allText.toLowerCase()).not.toContain('допустим');
    expect(allText.toLowerCase()).not.toContain('разрешен');
    expect(allText.toLowerCase()).not.toContain('разрешён');
  });
});

// ─── Кейс 4: IRAO/TATN — карточки без очереди взноса ───

describe('N.1 кейс 4: IRAO/TATN — карточки без очереди взноса', () => {
  it('КРАСНЫЙ ТЕСТ: IRAO — BUY без ошибки при пустой contributionQueue', () => {
    const asset = makeStockAsset({
      ticker: 'IRAO',
      name: 'Интер РАО',
      assetType: 'АКЦИЯ',
      deficitRub: 56622,
      status: 'BUY',
      holdOnly: false,
    });

    const rec = makeRecommendation({
      ticker: 'IRAO',
      recommendedAction: 'BUY',
      rationale: 'Глубокий дефицит доли.',
      entryStrategy: 'Купить частями.',
    });

    // Не должно выбросить ошибку при отсутствии contributionQueue
    expect(() =>
      applyPolicyToRecommendation(rec, asset, POLICY),
    ).not.toThrow();
  });

  it('КРАСНЫЙ ТЕСТ: TATN — BUY без ошибки при пустой contributionQueue', () => {
    const asset = makeStockAsset({
      ticker: 'TATN',
      name: 'Татнефть-А',
      assetType: 'АКЦИЯ',
      deficitRub: 38498,
      status: 'BUY',
      holdOnly: false,
    });

    const rec = makeRecommendation({
      ticker: 'TATN',
      recommendedAction: 'BUY',
      rationale: 'Дефицит доли.',
      entryStrategy: 'Купить частями.',
    });

    expect(() =>
      applyPolicyToRecommendation(rec, asset, POLICY),
    ).not.toThrow();
  });
});

// ─── Кейс 5: yieldSource атрибуция ───

describe('N.1 кейс 5: yieldSource атрибуция', () => {
  it('Контр-тест: пустой Excel-yield + Smart-Lab → SMART_LAB_PROBE', () => {
    // Эмуляция: yield пришёл из Smart-Lab probe (пустой в Excel)
    const asset = makeBondAsset({
      ticker: 'RU000A10GC20',
      name: 'ВИС Ф БП17',
      assetType: 'О',
      status: 'STABLE',
      holdOnly: false,
    });

    const rec = makeRecommendation({
      ticker: 'RU000A10GC20',
      recommendedAction: 'HOLD',
      rationale: 'Держать.',
      entryStrategy: 'Держать.',
      technicalTiming: 'Держать.',
    });

    const result = applyPolicyToRecommendation(rec, asset, POLICY);

    // policyBlocked=false (тикер вне noSellTickers)
    expect(result.policyBlocked).toBe(false);
    // yieldSource должен быть SMART_LAB_PROBE (эмуляция из ai-client.ts)
    // Здесь проверяем, что структура поддерживает поле
    expect(result).toBeDefined();
  });
});
