/**
 * Structured AI Recommendation — вынос AI-рекомендаций из свободного markdown-текста
 * в структурированный объект.
 *
 * Ключевой принцип:
 * - DETERMINISTIC поля (price, quantity, deficit, amounts) рассчитываются ДО AI
 * - AI возвращает ТОЛЬКО AI-поля (target, action, confidence, rationale, risks, catalysts)
 * - Merge функция объединяет deterministic + AI в единый отчёт
 * - PDF и dashboard берут числовые значения ИСКЛЮЧИТЕЛЬНО из deterministic
 */

import type { AssetAnalysis } from '../../portfolio/portfolio-math/portfolio-math.js';
import type {
  AiAction,
  PortfolioMathStatus,
  MathAgreement,
} from '../../research/types.js';

// ──────────────────────────────────────────────
// 1. AI JSON — то, что возвращает AI-модель
// ──────────────────────────────────────────────

export interface RawAIJson {
  ticker: string;
  recommendedTargetPercent: number | null;
  recommendedAction: string | null;
  confidence: number | null;
  rationale: string | null;
  targetReason: string | null;
  keyRisks: string[] | null;
  keyCatalysts: string[] | null;
  agreementWithPortfolioMath: string | null;
}

// ──────────────────────────────────────────────
// 2. Deterministic — заполняется ДО AI
// ──────────────────────────────────────────────

export interface DeterministicAssetData {
  ticker: string;
  name: string;

  currentPercent: number;
  userTargetPercent: number | null;
  portfolioMathStatus: PortfolioMathStatus;
  currentPrice: number | null;
  /** Средняя цена покупки (из Excel QUIK) — база расчёта просадки */
  balancePrice: number;
  /** Просадка от цены покупки, % (отрицательная = убыток). null если цена покупки неизвестна */
  drawdownPercent: number | null;
  /** Нереализованный P&L по позиции, руб (отрицательный = убыток) */
  unrealizedProfitRub: number;
  currentQuantity: number;
  liquidationValueRub: number | null;
  buyAmountRub: number | null;
  sellAmountRub: number | null;
  marketDataValid: boolean;
  executionBlocked: boolean;
  activeOrders: string[];
  activeOrderConflict: boolean;

  // ─── Bond-specific fields (P0) ───

  /** ISIN облигации — однозначная идентификация выпуска */
  isin?: string;
  /** Номинал облигации (RUB) */
  nominal?: number;
  /**
   * Доходность из QUIK (столбец E).
   * НЕ называть YTM без подтверждения семантики.
   * Единица: %.
   */
  yield?: number;
  /**
   * Дюрация из QUIK (столбец M).
   * НЕ называть модифицированной без подтверждения методики.
   */
  duration?: number;
  /** Оборот из QUIK (столбец F) — оценка ликвидности */
  turnover?: number;
  /** Размер купона из QUIK (столбец H) */
  couponAmount?: number;
  /** Длительность купонного периода (дни) */
  couponPeriodDays?: number;
  /** Ближайшая дата выплаты купона */
  nextCouponDate?: Date | null;
  /** Дата погашения выпуска */
  maturityDate?: Date | null;
  /** НКД рыночный (столбец K листа «Облигации») */
  marketNkd?: number;
}

// ──────────────────────────────────────────────
// 3. StructuredAIAssetRecommendation — финальный объект
// ──────────────────────────────────────────────

/**
 * Переопределение действия стратегом.
 *
 * Стратег — независимый аналитический агент. Он может указать на риск,
 * не согласиться с AI, предложить альтернативное действие, но НЕ имеет
 * права автоматически блокировать или изменять решение AI.
 */
export interface StrategistOverride {
  /** Первоначальное действие, предложенное AI (до вмешательства стратега) */
  originalAction: AiAction | null;
  /** Причина переопределения (человекочитаемая) */
  reason: string;
}

export interface StructuredAIAssetRecommendation {
  // IDENTITY
  ticker: string;
  name: string;

  // DETERMINISTIC (заполняется ДО AI, AI НЕ меняет)
  currentPercent: number;
  userTargetPercent: number | null;
  portfolioMathStatus: PortfolioMathStatus;
  currentPrice: number | null;
  /** Средняя цена покупки (из Excel QUIK) */
  balancePrice: number;
  /** Просадка от цены покупки, % (отрицательная = убыток). null если неизвестна */
  drawdownPercent: number | null;
  /** Нереализованный P&L по позиции, руб */
  unrealizedProfitRub: number;
  currentQuantity: number;
  liquidationValueRub: number | null;
  buyAmountRub: number | null;
  sellAmountRub: number | null;
  marketDataValid: boolean;
  executionBlocked: boolean;
  activeOrders: string[];
  activeOrderConflict: boolean;

  // ─── Bond-specific fields (P0) ───
  isin?: string;
  nominal?: number;
  yield?: number;
  duration?: number;
  turnover?: number;
  couponAmount?: number;
  couponPeriodDays?: number;
  nextCouponDate?: Date | null;
  maturityDate?: Date | null;
  marketNkd?: number;

  // STRATEGIST (детерминированные правила защиты портфеля)
  /** Переопределение действия стратегом (если было применено) */
  strategistOverride: StrategistOverride | null;

  // AI (заполняется ИЗ AI JSON)
  recommendedTargetPercent: number | null;
  recommendedAction: AiAction | null;
  confidence: number | null;
  rationale: string | null;
  targetReason: string | null;
  keyRisks: string[];
  keyCatalysts: string[];
  agreementWithPortfolioMath: MathAgreement;

  // ─── Fallback (заполняется ТОЛЬКО когда AI не ответил) ───
  /** Причина fallback (для отладки и объяснений) */
  _fallbackReason?: FallbackReason;
  /** Подробное объяснение fallback */
  _fallbackExplanation?: FallbackExplanation;
  /** Рекомендация что делать при fallback */
  _fallbackAction?: string;
}

// ──────────────────────────────────────────────
// 4. Fallback — AI недоступен
// ──────────────────────────────────────────────

/** Причина fallback — почему AI не смог дать рекомендацию */
export type FallbackReason =
  | 'NO_AI_JSON'
  | 'INVALID_JSON_PARSE'
  | 'MISSING_REQUIRED_FIELDS'
  | 'AI_TIMEOUT'
  | 'AI_EMPTY_RESPONSE';

/** Объяснение fallback — понятный текст для пользователя */
export interface FallbackExplanation {
  reason: FallbackReason;
  /** Краткое объяснение на русском */
  short: string;
  /** Подробное объяснение с рекомендациями */
  detailed: string;
  /** Что делать: рекомендация пользователю */
  action: string;
}

/** Карта объяснений для каждой причины fallback */
const FALLBACK_EXPLANATIONS: Record<FallbackReason, FallbackExplanation> = {
  NO_AI_JSON: {
    reason: 'NO_AI_JSON',
    short: 'AI не вернул JSON-ответ',
    detailed:
      'Нейросетевая модель не вернула структурированный JSON-ответ. ' +
      'Возможные причины: модель была недоступна, ответ превысил лимит времени, ' +
      'или промпт был слишком длинным и модель «заблокировалась».',
    action:
      'Решение принято по формуле: целевая доля - текущая доля = дефицит. ' +
      'Рекомендуется: 1) Перезапустить анализ, 2) Проверить доступность AI-модели, ' +
      '3) Упростить промпт для этого актива.',
  },
  INVALID_JSON_PARSE: {
    reason: 'INVALID_JSON_PARSE',
    short: 'AI вернул невалидный JSON',
    detailed:
      'AI вернул JSON, но он не прошёл валидацию. ' +
      'Возможные причины: незакрытые скобки, неэкранированные кавычки в тексте, ' +
      'или missing-поля (recommendedAction, confidence, rationale).',
    action:
      'Решение принято по формуле: целевая доля - текущая доля = дефицит. ' +
      'Рекомендуется: 1) Перезапустить анализ, 2) Проверить промпт — ' +
      'возможно, нужно добавить пример валидного JSON, ' +
      '3) Уменьшить длину rationale в промпте.',
  },
  MISSING_REQUIRED_FIELDS: {
    reason: 'MISSING_REQUIRED_FIELDS',
    short: 'AI вернул JSON без обязательных полей',
    detailed:
      'AI вернул JSON, но в нём отсутствуют обязательные поля: ' +
      'recommendedAction, confidence, rationale, keyRisks. ' +
      'Это значит, что модель «забыла» заполнить часть полей.',
    action:
      'Решение принято по формуле: целевая доля - текущая доля = дефицит. ' +
      'Рекомендуется: 1) Перезапустить анализ, ' +
      '2) Добавить в промпт: «Обязательно заполните все поля, даже если данных мало».',
  },
  AI_TIMEOUT: {
    reason: 'AI_TIMEOUT',
    short: 'AI превысил лимит времени',
    detailed:
      'AI-модель не ответила в течение установленного лимита времени (обычно 30-60 сек). ' +
      'Это может быть из-за перегрузки модели или длинного промпта.',
    action:
      'Решение принято по формуле: целевая доля - текущая доля = дефицит. ' +
      'Рекомендуется: 1) Увеличить таймаут, 2) Уменьшить размер промпта, ' +
      '3) Проверить производительность AI-модели.',
  },
  AI_EMPTY_RESPONSE: {
    reason: 'AI_EMPTY_RESPONSE',
    short: 'AI вернул пустой ответ',
    detailed:
      'AI вернул пустой ответ или ответ без данных. ' +
      'Это может означать, что модель не смогла обработать запрос.',
    action:
      'Решение принято по формуле: целевая доля - текущая доля = дефицит. ' +
      'Рекомендуется: 1) Перезапустить анализ, 2) Проверить входные данные.',
  },
};

/** Получить объяснение для причины fallback */
export function getFallbackExplanation(reason: FallbackReason): FallbackExplanation {
  return FALLBACK_EXPLANATIONS[reason] ?? FALLBACK_EXPLANATIONS.NO_AI_JSON;
}

/**
 * Строит fallback-рекомендацию с понятным объяснением.
 *
 * Вместо «AI analysis unavailable» — подробное объяснение:
 * - ПОЧЕМУ AI не ответил
 * - КАК принято решение (формула)
 * - ЧТО ДЕЛАТЬ (рекомендации)
 *
 * @param det — детерминированные данные актива
 * @param fallbackReason — причина fallback (типовое значение)
 * @param reason — детальное объяснение причины (опционально, переопределяет стандартное)
 */
export function buildFallbackStructuredRecommendation(
  det: DeterministicAssetData,
  fallbackReason: FallbackReason = 'NO_AI_JSON',
  reason?: string,
): StructuredAIAssetRecommendation {
  const explanation = getFallbackExplanation(fallbackReason);

  // Если передано детальное объяснение — используем его
  const detailedExplanation = reason
    ? `${explanation.short}. ${reason}`
    : `${explanation.short}. ${explanation.detailed}`;

  return {
    ticker: det.ticker,
    name: det.name,

    // Deterministic
    currentPercent: det.currentPercent,
    userTargetPercent: det.userTargetPercent,
    portfolioMathStatus: det.portfolioMathStatus,
    currentPrice: det.currentPrice,
    balancePrice: det.balancePrice,
    drawdownPercent: det.drawdownPercent,
    unrealizedProfitRub: det.unrealizedProfitRub,
    currentQuantity: det.currentQuantity,
    liquidationValueRub: det.liquidationValueRub,
    buyAmountRub: det.buyAmountRub,
    sellAmountRub: det.sellAmountRub,
    marketDataValid: det.marketDataValid,
    executionBlocked: det.executionBlocked,
    activeOrders: det.activeOrders,
    activeOrderConflict: det.activeOrderConflict,

    // Bond-specific
    isin: det.isin,
    nominal: det.nominal,
    yield: det.yield,
    duration: det.duration,
    turnover: det.turnover,
    couponAmount: det.couponAmount,
    couponPeriodDays: det.couponPeriodDays,
    nextCouponDate: det.nextCouponDate,
    maturityDate: det.maturityDate,
    marketNkd: det.marketNkd,

    // STRATEGIST: AI недоступен → action=null, вмешательство не требуется
    strategistOverride: null,

    // AI fallback
    recommendedTargetPercent: null,
    recommendedAction: null,
    confidence: null,
    rationale: detailedExplanation,
    targetReason: null,
    keyRisks: [],
    keyCatalysts: [],
    agreementWithPortfolioMath: 'UNCERTAIN',

    // ─── Новые поля для fallback ───
    /** Причина fallback */
    _fallbackReason: fallbackReason,
    /** Подробное объяснение */
    _fallbackExplanation: {
      reason: fallbackReason,
      short: explanation.short,
      detailed: reason || explanation.detailed,
      action: explanation.action,
    },
    /** Рекомендация что делать */
    _fallbackAction: explanation.action,
  };
}

// ──────────────────────────────────────────────
// 5. Build DeterministicAssetData из AssetAnalysis
// ──────────────────────────────────────────────

export function buildDeterministicAssetData(
  asset: AssetAnalysis,
  activeOrders: string[] = [],
): DeterministicAssetData {
  const hasUserTarget = asset.targetPercent !== undefined;
  const userTargetPercent: number | null = hasUserTarget
    ? asset.targetPercent!
    : null;

  // Execution safety: PortfolioMath currentPrice = authoritative
  const marketDataValid = (asset.currentPrice ?? 0) > 0;
  const executionBlocked = !marketDataValid;

  // Просадка от цены покупки (для правил стратега)
  const balancePrice = asset.balancePrice ?? 0;
  const drawdownPercent =
    marketDataValid && balancePrice > 0
      ? ((asset.currentPrice! - balancePrice) / balancePrice) * 100
      : null;

  // Liquidation value
  const liquidationValueRub = marketDataValid
    ? asset.currentPrice! * asset.quantity
    : null;

  // P&L: рассчитывается из реальных данных (currentPrice - balancePrice) * quantity,
  // а не берётся из Excel (unrealizedProfitRub может быть 0 при реальной просадке).
  // fallback на Excel только если currentPrice/balancePrice недоступны.
  let unrealizedProfitRub: number;
  if (marketDataValid && balancePrice > 0) {
    unrealizedProfitRub = (asset.currentPrice! - balancePrice) * asset.quantity;
  } else {
    unrealizedProfitRub = asset.unrealizedProfitRub ?? 0;
  }

  // Buy / Sell amounts from deterministic
  let buyAmountRub: number | null = null;
  let sellAmountRub: number | null = null;

  if (asset.deficitRub > 0) {
    buyAmountRub = asset.deficitRub;
  } else if (asset.deficitRub < 0) {
    sellAmountRub = Math.abs(asset.deficitRub);
  }

  // Active order conflict
  let activeOrderConflict = false;
  if (activeOrders.length > 0) {
    const hasBuyOrder = activeOrders.some((o) => o.toUpperCase() === 'BUY');
    const hasSellOrder = activeOrders.some((o) => o.toUpperCase() === 'SELL');

    if (asset.status === 'BUY' && hasSellOrder) {
      activeOrderConflict = true;
    }
    if (asset.status === 'REDUCE' && hasBuyOrder) {
      activeOrderConflict = true;
    }
  }

  return {
    ticker: asset.ticker,
    name: asset.name,
    currentPercent: asset.currentPercent,
    userTargetPercent,
    portfolioMathStatus: asset.status,
    currentPrice: marketDataValid ? asset.currentPrice : null,
    balancePrice,
    drawdownPercent,
    unrealizedProfitRub,
    currentQuantity: asset.quantity,
    liquidationValueRub,
    buyAmountRub,
    sellAmountRub,
    marketDataValid,
    executionBlocked,
    activeOrders,
    activeOrderConflict,

    // Bond-specific fields
    isin: asset.ticker.startsWith('RU000') ? asset.ticker : undefined,
    nominal: asset.nominal,
    yield: undefined, // Заполняется из BondMarketData в AI Agent
    duration: undefined,
    turnover: undefined,
    couponAmount: undefined,
    couponPeriodDays: undefined,
    nextCouponDate: undefined,
    maturityDate: undefined,
    marketNkd: undefined,
  };
}

// ──────────────────────────────────────────────
// 6. Validation — проверка AI JSON
// ──────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export function validateStructuredAIJson(
  json: RawAIJson,
  knownTickers: string[],
): ValidationResult {
  const errors: ValidationError[] = [];

  // 1. ticker существует в PortfolioSnapshot
  if (!json.ticker || typeof json.ticker !== 'string') {
    errors.push({
      field: 'ticker',
      message: 'ticker обязателен и должен быть строкой',
    });
  } else if (
    !knownTickers.some((t) => t.toUpperCase() === json.ticker!.toUpperCase())
  ) {
    errors.push({
      field: 'ticker',
      message: `ticker '${json.ticker}' не найден в портфеле`,
    });
  }

  // 2. recommendedAction входит в допустимый AiAction
  const validActions: AiAction[] = [
    'BUY',
    'SELL',
    'HOLD',
    'STABLE',
    'REDUCE',
    'EXIT',
    'AVOID',
    'AVERAGE',
  ];
  if (json.recommendedAction !== null) {
    if (typeof json.recommendedAction !== 'string') {
      errors.push({
        field: 'recommendedAction',
        message: 'recommendedAction должен быть строкой или null',
      });
    } else if (!validActions.includes(json.recommendedAction as AiAction)) {
      errors.push({
        field: 'recommendedAction',
        message: `недопустимое действие '${json.recommendedAction}', допустимые: ${validActions.join(', ')}`,
      });
    }
  }

  // 3. confidence 0..1
  if (json.confidence !== null) {
    if (typeof json.confidence !== 'number') {
      errors.push({
        field: 'confidence',
        message: 'confidence должен быть числом или null',
      });
    } else if (json.confidence < 0 || json.confidence > 1) {
      errors.push({
        field: 'confidence',
        message: `confidence должен быть в диапазоне 0..1, получено: ${json.confidence}`,
      });
    }
  }

  // 4. recommendedTargetPercent — валидация диапазона 0..100
  if (json.recommendedTargetPercent !== null) {
    if (typeof json.recommendedTargetPercent !== 'number') {
      errors.push({
        field: 'recommendedTargetPercent',
        message: 'recommendedTargetPercent должен быть числом или null',
      });
    } else if (
      json.recommendedTargetPercent !== json.recommendedTargetPercent || // NaN проверка
      !isFinite(json.recommendedTargetPercent) // Infinity/-Infinity проверка
    ) {
      errors.push({
        field: 'recommendedTargetPercent',
        message: `recommendedTargetPercent должен быть конечным числом, получено: ${json.recommendedTargetPercent}`,
      });
    } else if (json.recommendedTargetPercent < 0) {
      errors.push({
        field: 'recommendedTargetPercent',
        message: `recommendedTargetPercent не может быть отрицательным: ${json.recommendedTargetPercent}`,
      });
    } else if (json.recommendedTargetPercent > 100) {
      errors.push({
        field: 'recommendedTargetPercent',
        message: `recommendedTargetPercent не может превышать 100%, получено: ${json.recommendedTargetPercent}`,
      });
    }
  }

  // 5. agreementWithPortfolioMath допустим
  const validAgreements: MathAgreement[] = ['AGREE', 'DISAGREE', 'UNCERTAIN', 'INSUFFICIENT_DATA'];
  if (json.agreementWithPortfolioMath !== null && json.agreementWithPortfolioMath !== undefined) {
    // AI может вернуть boolean или число — конвертируем в строку
    let agreementValue: string;
    if (typeof json.agreementWithPortfolioMath === 'boolean') {
      agreementValue = json.agreementWithPortfolioMath ? 'AGREE' : 'DISAGREE';
    } else if (typeof json.agreementWithPortfolioMath === 'number') {
      agreementValue = json.agreementWithPortfolioMath > 0 ? 'AGREE' : 'DISAGREE';
    } else {
      agreementValue = json.agreementWithPortfolioMath;
    }
    
    if (typeof agreementValue !== 'string') {
      errors.push({
        field: 'agreementWithPortfolioMath',
        message: 'agreementWithPortfolioMath должен быть строкой или null',
      });
    } else if (
      !validAgreements.includes(agreementValue as MathAgreement)
    ) {
      errors.push({
        field: 'agreementWithPortfolioMath',
        message: `недопустимое согласие '${agreementValue}', допустимые: ${validAgreements.join(', ')}`,
      });
    }
  }

  // 6. Обязательные текстовые поля присутствуют
  if (
    !json.rationale ||
    typeof json.rationale !== 'string' ||
    json.rationale.trim().length === 0
  ) {
    errors.push({
      field: 'rationale',
      message: 'rationale обязателен и не может быть пустым',
    });
  }
  // targetReason — необязателен, если пустой — дадим дефолтное значение
  if (
    json.targetReason &&
    typeof json.targetReason === 'string' &&
    json.targetReason.trim().length > 0
  ) {
    // OK — заполнено
  } else {
    // Дадим дефолтное значение
    json.targetReason = 'целевая доля не меняется';
  }

  // 7. keyRisks и keyCatalysts — массивы строк или null
  if (json.keyRisks !== null && !Array.isArray(json.keyRisks)) {
    errors.push({
      field: 'keyRisks',
      message: 'keyRisks должен быть массивом строк или null',
    });
  }
  if (json.keyCatalysts !== null && !Array.isArray(json.keyCatalysts)) {
    errors.push({
      field: 'keyCatalysts',
      message: 'keyCatalysts должен быть массивом строк или null',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ──────────────────────────────────────────────
// 7. Merge — объединяет deterministic + AI
// ──────────────────────────────────────────────

export function buildStructuredAIRecommendation(
  det: DeterministicAssetData,
  aiJson: RawAIJson | null,
  validation: ValidationResult | null,
  fallbackReason: FallbackReason = 'NO_AI_JSON',
): StructuredAIAssetRecommendation {
  // Если AI JSON невалиден или отсутствует — используем fallback
  if (!aiJson || !validation || !validation.valid) {
    return buildFallbackStructuredRecommendation(det, fallbackReason);
  }

  // Преобразуем строковые значения в typed
  const recommendedAction = validAiAction(aiJson.recommendedAction)
    ? aiJson.recommendedAction
    : null;

  const agreement = validMathAgreement(aiJson.agreementWithPortfolioMath)
    ? aiJson.agreementWithPortfolioMath
    : 'UNCERTAIN';

  return {
    // IDENTITY
    ticker: det.ticker,
    name: det.name,

    // DETERMINISTIC (из det, AI НЕ меняет)
    currentPercent: det.currentPercent,
    userTargetPercent: det.userTargetPercent,
    portfolioMathStatus: det.portfolioMathStatus,
    currentPrice: det.currentPrice,
    balancePrice: det.balancePrice,
    drawdownPercent: det.drawdownPercent,
    unrealizedProfitRub: det.unrealizedProfitRub,
    currentQuantity: det.currentQuantity,
    liquidationValueRub: det.liquidationValueRub,
    buyAmountRub: det.buyAmountRub,
    sellAmountRub: det.sellAmountRub,
    marketDataValid: det.marketDataValid,
    executionBlocked: det.executionBlocked,
    activeOrders: det.activeOrders,
    activeOrderConflict: det.activeOrderConflict,

    // STRATEGIST: больше не блокирует действия AI
    strategistOverride: null,

    // AI (из aiJson, валидированные; действие НЕ переопределяется стратегом)
    recommendedTargetPercent: aiJson.recommendedTargetPercent,
    recommendedAction,
    confidence: aiJson.confidence,
    rationale: aiJson.rationale || null,
    targetReason: aiJson.targetReason || null,
    keyRisks: aiJson.keyRisks || [],
    keyCatalysts: aiJson.keyCatalysts || [],
    agreementWithPortfolioMath: agreement,
  };
}

// ──────────────────────────────────────────────
// 8. Helpers
// ──────────────────────────────────────────────

function validAiAction(value: string | null): value is AiAction {
  if (!value) return false;
  const valid: AiAction[] = [
    'BUY',
    'SELL',
    'HOLD',
    'STABLE',
    'REDUCE',
    'EXIT',
    'AVOID',
    'AVERAGE',
  ];
  return valid.includes(value as AiAction);
}

function validMathAgreement(value: string | null): value is MathAgreement {
  const valid: MathAgreement[] = ['AGREE', 'DISAGREE', 'UNCERTAIN', 'INSUFFICIENT_DATA'];
  return valid.includes(value as MathAgreement);
}

// ──────────────────────────────────────────────
// 9. Strategist rules — удалены
// ──────────────────────────────────────────────
//
// Все инвестиционные veto/guardrail-правила удалены:
// - STRATEGIST_LOSS_BLOCK_THRESHOLD_PCT (-30%) — удалён
// - SELL/REDUCE блокировка при глубокой просадке — удалена
// - LOSS_FIX_PATTERNS / SELL_REASON_HINTS — удалены
// - applyStrategistRules — удалена
//
// AI имеет полную свободу инвестиционного анализа и принятия решений.
// AI самостоятельно определяет BUY/SELL/HOLD/REDUCE/EXIT/AVERAGE.
// AI может не соглашаться с PortfolioMath и USER_TARGET.
