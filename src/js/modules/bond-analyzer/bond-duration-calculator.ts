/**
 * Bond Duration Calculator — анализ процентного риска облигаций.
 *
 * Ключевые принципы:
 * - НЕ считать поле duration модифицированной дюрацией до подтверждения
 *   методики и единиц измерения QUIK.
 * - Использовать duration для анализа только после проверки.
 * - При расчёте процентного риска применять корректную формулу
 *   с учётом типа дюрации и изменения доходности.
 * - Отображать сценарную оценку как приближение, если не учитывается
 *   выпуклость (convexity).
 * - Для флоатеров отдельно учитывать особенности плавающего купона.
 * - НЕ применять общие правила вида «при ключевой ставке ниже 12%
 *   продавать облигации». Каждый выпуск оценивается отдельно.
 */

import type {
  DurationType,
  DurationAnalysis,
} from './bond-analyzer-types.js';

// ──────────────────────────────────────────────
// 1. Определение типа дюрации
// ──────────────────────────────────────────────

/**
 * Определение типа дюрации.
 *
 * НЕ называть модифицированной без подтверждения методики QUIK.
 * По умолчанию — UNKNOWN.
 */
export function determineDurationType(
  isModified: boolean = false,
  isMacaulay: boolean = false,
  isEffective: boolean = false,
): DurationType {
  if (isModified) return 'MODIFIED';
  if (isMacaulay) return 'MACAULAY';
  if (isEffective) return 'EFFECTIVE';
  return 'UNKNOWN';
}

// ──────────────────────────────────────────────
// 2. Price impact (изменение цены при сдвиге доходности)
// ──────────────────────────────────────────────

/**
 * Оценка изменения цены облигации при изменении доходности.
 *
 * Формула: ΔP/P ≈ -Duration × Δy
 *
 * Для Modified Duration:
 *   ΔP/P ≈ -ModDur × Δy
 *
 * Для Macaulay Duration:
 *   ΔP/P ≈ -(MacDur / (1 + y)) × Δy
 *
 * @param duration — значение дюрации из QUIK
 * @param durationType — тип дюрации
 * @param yield — текущая доходность (для Macaulay)
 * @param yieldChangePct — изменение доходности в % (например, 1 для +1%)
 * @returns процентное изменение цены или null
 */
export function priceImpact(
  duration: number,
  durationType: DurationType,
  yield_: number,
  yieldChangePct: number,
): number | null {
  if (duration <= 0 || yieldChangePct === 0) {
    return null;
  }

  let modifiedDuration: number;

  if (durationType === 'MACAULAY') {
    // Macaulay → Modified: ModDur = MacDur / (1 + y)
    const annualYield = yield_ / 100;
    if (1 + annualYield === 0) return null;
    modifiedDuration = duration / (1 + annualYield);
  } else {
    // MODIFIED, EFFECTIVE, UNKNOWN — используем как есть
    modifiedDuration = duration;
  }

  // ΔP/P ≈ -ModDur × Δy
  const yieldChangeDecimal = yieldChangePct / 100;
  return -modifiedDuration * yieldChangeDecimal * 100; // в %
}

// ──────────────────────────────────────────────
// 3. DV01 — изменение цены при сдвиге на 1 базисный пункт
// ──────────────────────────────────────────────

/**
 * DV01 — изменение цены облигации при изменении доходности на 1 б.п. (0.01%).
 *
 * DV01 ≈ ModDur × Price × 0.0001
 *
 * @param duration — значение дюрации
 * @param durationType — тип дюрации
 * @param price — рыночная цена 1 облигации (RUB)
 * @param quantity — количество бумаг
 * @returns DV01 для позиции (RUB) или null
 */
export function dv01(
  duration: number,
  durationType: DurationType,
  price: number,
  quantity: number,
  yield_: number,
): number | null {
  if (duration <= 0 || price <= 0 || quantity <= 0) {
    return null;
  }

  let modifiedDuration: number;

  if (durationType === 'MACAULAY') {
    const annualYield = yield_ / 100;
    if (1 + annualYield === 0) return null;
    modifiedDuration = duration / (1 + annualYield);
  } else {
    modifiedDuration = duration;
  }

  // DV01 = ModDur × Price × Quantity × 0.0001
  return modifiedDuration * price * quantity * 0.0001;
}

// ──────────────────────────────────────────────
// 4. Сценарный анализ
// ──────────────────────────────────────────────

/**
 * Сценарный анализ процентного риска.
 *
 * @param duration — значение дюрации из QUIK
 * @param durationType — тип дюрации
 * @param currentPrice — текущая цена 1 облигации (RUB)
 * @param quantity — количество бумаг
 * @param currentYield — текущая доходность (%)
 * @param scenarios — массив сценариев изменения доходности в % (например, [1, 2, 3])
 * @returns массив результатов сценариев
 */
export function scenarioAnalysis(
  duration: number,
  durationType: DurationType,
  currentPrice: number,
  quantity: number,
  currentYield: number,
  scenarios: number[],
): Array<{
  yieldChangePct: number;
  priceImpactPct: number;
  priceImpactRub: number;
  newPrice: number;
  newPositionValue: number;
}> {
  const results: Array<{
    yieldChangePct: number;
    priceImpactPct: number;
    priceImpactRub: number;
    newPrice: number;
    newPositionValue: number;
  }> = [];

  for (const scenario of scenarios) {
    const impactPct = priceImpact(duration, durationType, currentYield, scenario);

    if (impactPct === null) continue;

    const newPrice = currentPrice * (1 + impactPct / 100);
    const newPositionValue = newPrice * quantity;
    const impactRub = newPositionValue - (currentPrice * quantity);

    results.push({
      yieldChangePct: scenario,
      priceImpactPct: impactPct,
      priceImpactRub: impactRub,
      newPrice: newPrice,
      newPositionValue: newPositionValue,
    });
  }

  return results;
}

// ──────────────────────────────────────────────
// 5. Определение типа облигации
// ──────────────────────────────────────────────

/**
 * Определение типа облигации.
 *
 * НЕ определять FIXED/FLOATER/ZERO_COUPON только по размеру купона,
 * номиналу и рыночной цене. Если нет достоверной информации — UNKNOWN.
 */
export function determineBondType(
  couponAmount: number,
  _nominal: number,
  _lastPrice: number,
  couponPeriodDays: number,
  hasFloatingTerms: boolean = false,
): 'FIXED' | 'FLOATER' | 'ZERO_COUPON' | 'AMORTIZING' | 'UNKNOWN' {
  if (hasFloatingTerms) {
    return 'FLOATER';
  }
  if (couponAmount <= 0) {
    return 'ZERO_COUPON';
  }
  if (couponAmount > 0 && couponPeriodDays > 0) {
    return 'FIXED';
  }
  return 'UNKNOWN';
}

// ──────────────────────────────────────────────
// 6. Чувствительность к ключевой ставке
// ──────────────────────────────────────────────

/**
 * Оценка влияния изменения ключевой ставки ЦБ на облигацию.
 *
 * НЕ применять общие правила. Каждый выпуск оценивается отдельно.
 * Для флоатеров чувствительность к ключевой ставке ниже, чем у фиксов.
 *
 * @param duration — дюрация
 * @param durationType — тип дюрации
 * @param currentPrice — текущая цена
 * @param quantity — количество
 * @param bondType — тип облигации
 * @param keyRateChangePct — изменение ключевой ставки (%)
 * @returns процентное изменение цены
 */
export function keyRateSensitivity(
  duration: number,
  durationType: DurationType,
  _currentPrice: number,
  _quantity: number,
  bondType: string,
  keyRateChangePct: number,
): number | null {
  if (duration <= 0) return null;

  // Для флоатеров чувствительность ниже (коэффициент 0.1-0.3)
  let sensitivityMultiplier = 1;
  if (bondType === 'FLOATER') {
    sensitivityMultiplier = 0.2; // Эвристика: флоатеры менее чувствительны
  } else if (bondType === 'ZERO_COUPON') {
    sensitivityMultiplier = 1.2; // Дисконтные более чувствительны
  }

  const adjustedDuration = duration * sensitivityMultiplier;
  return priceImpact(adjustedDuration, durationType, 0, keyRateChangePct);
}

// ──────────────────────────────────────────────
// 7. Основной интерфейс — DurationAnalysis
// ──────────────────────────────────────────────

/**
 * Полный анализ процентного риска облигации.
 *
 * @param params — параметры облигации
 * @returns DurationAnalysis
 */
export function analyzeDuration(params: {
  duration: number;
  durationType: DurationType;
  currentYield: number;
  currentPrice: number;
  quantity: number;
  scenarios?: number[];
  bondType?: 'FIXED' | 'FLOATER' | 'ZERO_COUPON' | 'AMORTIZING' | 'UNKNOWN';
}): DurationAnalysis {
  const {
    duration,
    durationType,
    currentYield,
    currentPrice,
    quantity,
    scenarios = [1, 2, 3, -1, -2, -3],
  } = params;

  // DV01
  const dv01Val = dv01(duration, durationType, currentPrice, quantity, currentYield);

  // Сценарный анализ
  const scenariosResults = scenarioAnalysis(
    duration,
    durationType,
    currentPrice,
    quantity,
    currentYield,
    scenarios,
  );

  // Статус качества данных
  let dataQuality: 'AVAILABLE' | 'PARTIAL' | 'MISSING' = 'AVAILABLE';
  if (duration <= 0) {
    dataQuality = 'MISSING';
  } else if (durationType === 'UNKNOWN') {
    dataQuality = 'PARTIAL'; // Значение есть, но тип не подтверждён
  }

  return {
    duration: duration > 0 ? duration : null,
    durationType,
    dv01: dv01Val,
    scenarios: scenariosResults,
    dataQuality,
  };
}
