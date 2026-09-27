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

import type { AssetAnalysis } from '../portfolio-math/portfolio-math.js';
import type {
  AiAction,
  PortfolioMathStatus,
  MathAgreement,
} from '../research/types.js';

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
}

// ──────────────────────────────────────────────
// 3. StructuredAIAssetRecommendation — финальный объект
// ──────────────────────────────────────────────

/**
 * Переопределение действия стратегом.
 *
 * Стратег — детерминированный слой защиты портфеля (НЕ LLM): применяет
 * жёсткие правила, которые AI не может обойти. Основное правило:
 * нельзя фиксировать глубокий убыток (продавать в минус) без
 * подтверждённого катализатора — цель портфеля выход в зелёную зону.
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
}

// ──────────────────────────────────────────────
// 4. Fallback — AI недоступен
// ──────────────────────────────────────────────

export function buildFallbackStructuredRecommendation(
  det: DeterministicAssetData,
): StructuredAIAssetRecommendation {
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

    // STRATEGIST: AI недоступен → action=null, вмешательство не требуется
    strategistOverride: null,

    // AI fallback
    recommendedTargetPercent: null,
    recommendedAction: null,
    confidence: null,
    rationale: 'AI analysis unavailable',
    targetReason: null,
    keyRisks: [],
    keyCatalysts: [],
    agreementWithPortfolioMath: 'UNCERTAIN',
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
    unrealizedProfitRub: asset.unrealizedProfitRub ?? 0,
    currentQuantity: asset.quantity,
    liquidationValueRub,
    buyAmountRub,
    sellAmountRub,
    marketDataValid,
    executionBlocked,
    activeOrders,
    activeOrderConflict,
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
  const validActions: AiAction[] = ['BUY', 'SELL', 'HOLD', 'REDUCE', 'AVOID'];
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

  // 4. recommendedTargetPercent >= 0
  if (json.recommendedTargetPercent !== null) {
    if (typeof json.recommendedTargetPercent !== 'number') {
      errors.push({
        field: 'recommendedTargetPercent',
        message: 'recommendedTargetPercent должен быть числом или null',
      });
    } else if (json.recommendedTargetPercent < 0) {
      errors.push({
        field: 'recommendedTargetPercent',
        message: `recommendedTargetPercent не может быть отрицательным: ${json.recommendedTargetPercent}`,
      });
    }
  }

  // 5. agreementWithPortfolioMath допустим
  const validAgreements: MathAgreement[] = ['AGREE', 'DISAGREE', 'UNCERTAIN'];
  if (json.agreementWithPortfolioMath !== null) {
    if (typeof json.agreementWithPortfolioMath !== 'string') {
      errors.push({
        field: 'agreementWithPortfolioMath',
        message: 'agreementWithPortfolioMath должен быть строкой или null',
      });
    } else if (
      !validAgreements.includes(
        json.agreementWithPortfolioMath as MathAgreement,
      )
    ) {
      errors.push({
        field: 'agreementWithPortfolioMath',
        message: `недопустимое согласие '${json.agreementWithPortfolioMath}', допустимые: ${validAgreements.join(', ')}`,
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
  if (
    !json.targetReason ||
    typeof json.targetReason !== 'string' ||
    json.targetReason.trim().length === 0
  ) {
    errors.push({
      field: 'targetReason',
      message: 'targetReason обязателен и не может быть пустым',
    });
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
): StructuredAIAssetRecommendation {
  // Если AI JSON невалиден или отсутствует — используем fallback
  if (!aiJson || !validation || !validation.valid) {
    return buildFallbackStructuredRecommendation(det);
  }

  // Преобразуем строковые значения в typed
  const recommendedAction = validAiAction(aiJson.recommendedAction)
    ? aiJson.recommendedAction
    : null;

  const agreement = validMathAgreement(aiJson.agreementWithPortfolioMath)
    ? aiJson.agreementWithPortfolioMath
    : 'UNCERTAIN';

  // Правила стратега: детерминированная защита портфеля от фиксации
  // глубокого убытка. Этот слой AI обойти не может.
  const strategist = applyStrategistRules(
    det,
    recommendedAction,
    aiJson.keyCatalysts || [],
    aiJson.rationale,
  );

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

    // STRATEGIST
    strategistOverride: strategist.override,

    // AI (из aiJson, валидированные; action мог быть переопределён стратегом)
    recommendedTargetPercent: aiJson.recommendedTargetPercent,
    recommendedAction: strategist.action,
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
  const valid: AiAction[] = ['BUY', 'SELL', 'HOLD', 'REDUCE', 'AVOID'];
  return valid.includes(value as AiAction);
}

function validMathAgreement(value: string | null): value is MathAgreement {
  if (!value) return false;
  const valid: MathAgreement[] = ['AGREE', 'DISAGREE', 'UNCERTAIN'];
  return valid.includes(value as MathAgreement);
}

// ──────────────────────────────────────────────
// 9. Strategist rules — детерминированная защита портфеля
// ──────────────────────────────────────────────

/**
 * Порог просадки: глубже этого значения (в %) продажа позиции без
 * подтверждённого катализатора блокируется и заменяется на HOLD.
 * Цель портфеля — выход в зелёную зону, а не фиксация глубокого убытка.
 */
export const STRATEGIST_LOSS_BLOCK_THRESHOLD_PCT = -30;

/** Действия, уменьшающие позицию (потенциальная фиксация убытка) */
const SELL_LIKE_ACTIONS: ReadonlySet<AiAction> = new Set(['SELL', 'REDUCE']);

/** Явные признаки «фиксации убытка» — это НЕ веская причина для продажи */
const LOSS_FIX_PATTERNS: readonly string[] = [
  'зафиксировать убыток',
  'зафиксиров',
  'stop-loss',
  'стоп-лосс',
  'сократить потери',
  'уменьшить убыток',
  'списать',
  'выйти в ноль',
];

/** Признаки веской причины для продажи (фундамент/оценка/катализатор) */
const SELL_REASON_HINTS: readonly string[] = [
  'фундамент',
  'оценк',
  'мультипликатор',
  'дисконт',
  'дивиденд',
  'выкуп',
  'байбэк',
  'рост',
  'отчёт',
  'перспектив',
  'недооцен',
  'долг',
  'свободный денежный',
  'ebitda',
  'прибыл',
  'выручк',
  'геополитик',
  'санкци',
  'ключевая ставка',
  'процентн',
  'инфляци',
];

/**
 * Есть ли в rationale веская причина для продажи?
 * Признаки «фиксации убытка» не считаются веской причиной.
 */
function hasSellRationale(rationale: string | null): boolean {
  if (!rationale) return false;
  const r = rationale.toLowerCase();
  if (LOSS_FIX_PATTERNS.some((p) => r.includes(p))) return false;
  return SELL_REASON_HINTS.some((h) => r.includes(h));
}

/**
 * Применить правила стратега к действию AI.
 *
 * Блокирует SELL/REDUCE при глубокой просадке (drawdownPercent ниже
 * STRATEGIST_LOSS_BLOCK_THRESHOLD_PCT), если нет подтверждённого
 * катализатора (keyCatalysts) или веской причины в rationale.
 * В этом случае действие заменяется на HOLD, а причина переопределения
 * сохраняется в override для отображения пользователю.
 *
 * @param det       Детерминированные данные актива (содержат drawdownPercent).
 * @param action    Действие, предложенное AI.
 * @param catalysts Список катализаторов от AI.
 * @param rationale Обоснование AI.
 * @returns Итоговое действие (возможно изменённое) и информацию об override.
 */
export function applyStrategistRules(
  det: DeterministicAssetData,
  action: AiAction | null,
  catalysts: string[],
  rationale: string | null,
): { action: AiAction | null; override: StrategistOverride | null } {
  // Правило применяется только к продаже/уменьшению при известной просадке
  if (
    !action ||
    !SELL_LIKE_ACTIONS.has(action) ||
    det.drawdownPercent === null ||
    det.drawdownPercent > STRATEGIST_LOSS_BLOCK_THRESHOLD_PCT
  ) {
    return { action, override: null };
  }

  const hasCatalyst = catalysts.length > 0 || hasSellRationale(rationale);
  if (hasCatalyst) {
    return { action, override: null };
  }

  return {
    action: 'HOLD',
    override: {
      originalAction: action,
      reason:
        'Стратег заблокировал ' +
        action +
        ': просадка ' +
        det.drawdownPercent.toFixed(1) +
        '% от цены покупки без подтверждённого катализатора. ' +
        'Цель портфеля — выход в зелёную зону: фиксация глубокого убытка ' +
        'не является стратегией. Держать позицию до появления катализатора ' +
        'или улучшения фундаментальных показателей.',
    },
  };
}
