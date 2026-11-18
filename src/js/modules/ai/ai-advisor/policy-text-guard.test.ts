import type { AssetAnalysis } from '../../portfolio/portfolio-math/portfolio-math.js';
import type { StructuredAIAssetRecommendation } from './structured-ai-recommendation.js';
import { PortfolioConfig } from '../../../config/portfolio-config.js';
import {
  applyPolicyToNarrative,
  applyPolicyToRecommendation,
  detectSellDirective,
  isPolicyStatement,
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
    // Политика не дублируется: rationale — одна строка политики,
    // без второго префикса «⛔ Заблокировано политикой no-sell».
    expect(result.rationale).toContain('заблокированы политикой no-sell');
    expect(result.rationale).not.toContain('⛔ Заблокировано политикой');
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

  // ─── Дословные строки прогона 15:12 ───

  it('15:12: «Необходимо продать часть позиции… 59 081 руб.» чистится по имени актива', () => {
    const result = applyPolicyToNarrative(
      'Необходимо продать часть позиции Полюса на 59 081 руб.',
      [createAsset({ ticker: 'PLZL', name: 'Полюс' })],
      POLICY,
    );

    expect(result).not.toMatch(/продать/i);
    expect(result).toContain('PLZL');
  });

  it('15:12: «Продайте PLZL… 59 081 руб.» заменяется императивом guard', () => {
    const result = sanitizePolicyCardText(
      'Продайте PLZL на 59 081 руб. для финансирования докупки.',
      'PLZL',
    );

    expect(result.changed).toBe(true);
    expect(result.text).not.toMatch(/продайте/i);
    expect(result.text).toContain('политикой no-sell');
  });

  it('15:12: «можно продать вторую партию» без тикера чистится по единственному no-sell', () => {
    const result = applyPolicyToNarrative(
      'При отскоке выше 1100-1150 ₽ можно продать вторую партию.',
      [createAsset({ ticker: 'PLZL', name: 'Полюс' })],
      POLICY,
    );

    expect(result).not.toMatch(/продать/i);
    expect(result).toContain('PLZL');
  });

  it('15:12: step.rationale стратега «Продать первую партию PLZL» санируется', () => {
    const result = sanitizePolicyCardText(
      'Продать первую партию PLZL для финансирования дефицита.',
      'PLZL',
    );

    expect(result.changed).toBe(true);
    expect(result.text).not.toMatch(/продать/i);
  });
});

// ─── Контр-тесты: защита от перекоса санации ───
describe('policy-text-guard: контр-тесты санации', () => {
  const assets = [
    createAsset({ ticker: 'PLZL', name: 'Полюс' }),
    createAsset({ ticker: 'SBER', name: 'Сбер', assetType: 'А' }),
  ];

  it('16а: «продажа SBER ≈ 5 964 ₽» не санируется — SBER разрешён политикой', () => {
    const text = 'Источник: свободный кэш 458,34 ₽ + продажа SBER ≈ 5 964 ₽.';
    const result = applyPolicyToNarrative(text, assets, POLICY);

    expect(result).toBe(text);
    expect(result).toContain('продажа SBER');
  });

  it('16б: заголовок S4 сохраняется дословно, даже при единственном no-sell', () => {
    const title = 'Гибкий — докупка дефицита с продажей прибыльных позиций';
    const result = applyPolicyToNarrative(
      title,
      [createAsset({ ticker: 'PLZL', name: 'Полюс' })],
      POLICY,
    );

    expect(result).toBe(title);
  });

  it('16в: нейтральная форма «продажи ограничены ликвидностью» не санируется', () => {
    const text = 'Продажи ограничены ликвидностью инструмента.';
    const result = applyPolicyToNarrative(
      text,
      [createAsset({ ticker: 'PLZL', name: 'Полюс' })],
      POLICY,
    );

    expect(result).toBe(text);
  });

  it('16в: директивная форма «продать часть позиции на 59 081 руб.» санируется в PLZL', () => {
    const result = applyPolicyToNarrative(
      'Продать часть позиции на 59 081 руб.',
      [createAsset({ ticker: 'PLZL', name: 'Полюс' })],
      POLICY,
    );

    expect(result).not.toBe('Продать часть позиции на 59 081 руб.');
    expect(result).toContain('PLZL');
    expect(result).toContain('политикой no-sell');
  });

  it('defaultTicker не реагирует на корень «продаж-» без директивы', () => {
    const text = 'Объём продаж вырос, ликвидность продажи достаточная.';
    const result = applyPolicyToNarrative(
      text,
      [createAsset({ ticker: 'PLZL', name: 'Полюс' })],
      POLICY,
    );

    expect(result).toBe(text);
  });
});

// ─── Задача 1: стемминг, pipeline-строки и ложные срабатывания ───
describe('policy-text-guard: стемминг и защита pipeline-строк', () => {
  const assets = [createAsset({ ticker: 'PLZL', name: 'Полюс' })];

  it('16:53: «Продайте 50% позиции (сумма профицита 58 819 ₽)» ловится', () => {
    const result = applyPolicyToNarrative(
      'Продайте 50% позиции (сумма профицита 58 819 ₽).',
      assets,
      POLICY,
    );

    expect(result).not.toMatch(/продайте/i);
    expect(result).toContain('политикой no-sell');
  });

  it('«реализуйте половину позиции PLZL» ловится', () => {
    const result = applyPolicyToNarrative(
      'Реализуйте половину позиции PLZL.',
      assets,
      POLICY,
    );

    expect(result).not.toMatch(/реализуйте/i);
    expect(result).toContain('политикой no-sell');
  });

  it('«пересмотрите решение о продаже» без суммы и тикера НЕ ловится', () => {
    const text = 'Пересмотрите решение о продаже.';
    expect(applyPolicyToNarrative(text, assets, POLICY)).toBe(text);
  });

  it('«нереализованный P&L» и «реализованный убыток» НЕ ловятся (FP корня реализ)', () => {
    const text =
      'PLZL: нереализованный P&L −134 760 ₽, реализованный убыток 12 000 ₽.';

    expect(applyPolicyToNarrative(text, assets, POLICY)).toBe(text);
    expect(sanitizePolicyCardText(text, 'PLZL').changed).toBe(false);
  });

  it('pipeline-строка политики не санируется ни в narrative, ни в карточке', () => {
    const neutral =
      'PLZL: держать — продажа/сокращение заблокированы политикой no-sell.';

    expect(isPolicyStatement(neutral)).toBe(true);
    expect(applyPolicyToNarrative(neutral, assets, POLICY)).toBe(neutral);
    expect(sanitizePolicyCardText(neutral, 'PLZL').changed).toBe(false);
    expect(
      sanitizePolicyText(neutral, 'PLZL', POLICY, { requireTicker: false })
        .changed,
    ).toBe(false);
  });

  it('pipeline-строка облигации (14 карточек) не переписывается', () => {
    const line =
      'SU29027RMFS8: держать — продажа/сокращение заблокированы политикой no-sell.';
    const result = sanitizePolicyCardText(line, 'SU29027RMFS8');

    expect(result.changed).toBe(false);
    expect(result.text).toBe(line);
  });

  it('санация идемпотентна: повторный прогон не трогает результат', () => {
    const once = applyPolicyToNarrative(
      'Продайте 50% позиции (сумма профицита 58 819 ₽).',
      assets,
      POLICY,
    );

    expect(applyPolicyToNarrative(once, assets, POLICY)).toBe(once);
  });

  it('«сократите долю PLZL с 17,4% до ~12%» ловится (доля — маркер)', () => {
    const result = applyPolicyToNarrative(
      'Сократите долю PLZL с 17,4% до ~12%.',
      assets,
      POLICY,
    );

    expect(result).not.toMatch(/сократите/i);
    expect(result).toContain('политикой no-sell');
  });

  it('маркер «доля» не срабатывает на «доллар»', () => {
    const text = 'Курс доллара вырос, PLZL не затронут.';
    expect(applyPolicyToNarrative(text, assets, POLICY)).toBe(text);
  });

  it('корни берутся из конфига: незаданный корень не детектируется', () => {
    // «ликвидир» есть в конфиге — директива ловится.
    expect(
      detectSellDirective('Ликвидируйте позицию PLZL', 'card'),
    ).not.toBeNull();
    // «аннулир» в конфиге нет — не выдумываем правила в коде.
    expect(detectSellDirective('Аннулируйте позицию PLZL', 'card')).toBeNull();
    expect(PortfolioConfig.narrativePolicy.directiveStems).toContain(
      'ликвидир',
    );
  });
});

describe('policy-text-guard: аргументные фразы карточек (прогон 21:44)', () => {
  it('«<Актив>: держать — …заблокированы» не искажается и не дублируется', () => {
    const line =
      'Брус 2Р04: держать — продажа/сокращение заблокированы политикой no-sell.';

    expect(isPolicyStatement(line)).toBe(true);
    expect(sanitizePolicyCardText(line, 'RU000A10GC20')).toEqual({
      text: line,
      changed: false,
    });
    expect(applyPolicyToNarrative(line, [createAsset()], POLICY)).toBe(line);
  });

  it('искажённое извлечением «политикой поsell» остаётся текстом политики', () => {
    const line =
      'Брус 2Р04: держать — продажа/сокращение заблокированы политикой поsell.';

    expect(isPolicyStatement(line)).toBe(true);
    expect(sanitizePolicyCardText(line, 'RU000A10GC20').changed).toBe(false);
    expect(applyPolicyToNarrative(line, [createAsset()], POLICY)).toBe(line);
  });

  it('BUY по no-sell: действие не меняется, баннер не выставляется', () => {
    const asset = createAsset({
      ticker: 'ALRS',
      name: 'АЛРОСА',
      status: 'BUY',
      currentPercent: 5,
      targetPercent: 15,
      deficitRub: 50000,
    });
    const rec = createRecommendation({
      ticker: 'ALRS',
      name: 'АЛРОСА',
      recommendedAction: 'BUY',
      rationale: 'Покупать частями при просадке.',
      entryStrategy: 'Покупать.',
      technicalTiming: 'После отскока.',
      sellAmountRub: null,
    });

    const result = applyPolicyToRecommendation(rec, asset, {
      noSellTickers: ['ALRS'],
    });

    expect(result.recommendedAction).toBe('BUY');
    expect(result.policyBlocked).not.toBe(true);
  });

  it('REDUCE по no-sell: действие → HOLD, policyBlocked=true (баннер уместен)', () => {
    const result = applyPolicyToRecommendation(
      createRecommendation(),
      createAsset(),
      POLICY,
    );

    expect(result.recommendedAction).toBe('HOLD');
    expect(result.policyBlocked).toBe(true);
  });

  it('версотест: дубль политики и «после» схлопываются в одну чистую строку', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const text =
      'Брус 2Р04: держать — продажа/сокращение заблокированы политикой no-sell. ' +
      'Держать — продажа/сокращение заблокированы политикой поsell.';

    const result = sanitizePolicyCardText(text, 'RU000A10GC20');

    expect(result.changed).toBe(true);
    expect(result.text?.match(/заблокированы/gi)).toHaveLength(1);
    expect(result.text).toContain('политикой no-sell');
    expect(result.text).not.toContain('после');
    expect(
      log.mock.calls.some((call) =>
        String(call[0]).includes('[POLICY_TEXT] layer=dedupe'),
      ),
    ).toBe(true);
    log.mockRestore();
  });
});
