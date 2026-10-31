/**
 * Bond Yield Calculator — расчёт доходности облигаций.
 *
 * Ключевые принципы:
 * - Приоритет: показатель yield из QUIK (столбец E листа «Облигации»).
 *   НЕ называть его YTM без подтверждения семантики.
 * - Current Yield = (годовой купонный доход / рыночная цена) × 100%.
 *   НЕ использовать формулу с добавлением разницы номинал-цена.
 * - Самостоятельный расчёт YTM — только при наличии полного графика
 *   будущих денежных потоков.
 * - Для переменных купонов, флоатеров и амортизируемых выпусков
 *   учитывать особенности конкретного выпуска.
 * - НЕ классифицировать тип купона без достоверных данных → UNKNOWN.
 */

import type {
  CouponType,
  YieldAnalysis,
  CouponProjection,
} from './bond-analyzer-types.js';

// ──────────────────────────────────────────────
// 1. Константы
// ──────────────────────────────────────────────

/** Среднее количество дней в году (учёт високосных лет) */
const DAYS_PER_YEAR = 365.25;

// ──────────────────────────────────────────────
// 2. Определение типа купона
// ──────────────────────────────────────────────

/**
 * Определение типа купона.
 *
 * НЕ определять FIXED/FLOATER/ZERO_COUPON только по размеру купона,
 * номиналу и рыночной цене. Если нет достоверной информации об условиях
 * выпуска — возвращать UNKNOWN.
 *
 * Эвристика (только для справки, не для финальной классификации):
 * - couponAmount === 0 → возможно ZERO_COUPON
 * - couponAmount > 0 и couponPeriodDays > 0 → возможно FIXED
 * - Если известны условия плавающего купона → FLOATER
 */
export function determineCouponType(
  couponAmount: number,
  _nominal: number,
  _lastPrice: number,
  couponPeriodDays: number,
  hasFloatingTerms: boolean = false,
): CouponType {
  // Если известны условия плавающего купона → FLOATER
  if (hasFloatingTerms) {
    return 'FLOATER';
  }

  // Нулевой купон → ZERO_COUPON
  if (couponAmount <= 0) {
    return 'ZERO_COUPON';
  }

  // Есть купон и период → FIXED (эвристика, не гарантия)
  if (couponAmount > 0 && couponPeriodDays > 0) {
    return 'FIXED';
  }

  // Не хватает данных → UNKNOWN
  return 'UNKNOWN';
}

// ──────────────────────────────────────────────
// 3. Current Yield
// ──────────────────────────────────────────────

/**
 * Текущая доходность (Current Yield).
 *
 * CY = (годовой купонный доход / рыночная цена) × 100%
 *
 * НЕ использовать формулу с добавлением разницы между номиналом
 * и рыночной ценой погашения.
 *
 * @param annualCouponIncome — годовой купонный доход на 1 облигацию (RUB)
 * @param marketPrice — рыночная цена 1 облигации (RUB)
 * @returns Current Yield в % или null если данные недостаточны
 */
export function currentYield(
  annualCouponIncome: number,
  marketPrice: number,
): number | null {
  if (annualCouponIncome <= 0 || marketPrice <= 0) {
    return null;
  }
  return (annualCouponIncome / marketPrice) * 100;
}

// ──────────────────────────────────────────────
// 4. Годовой купонный доход
// ──────────────────────────────────────────────

/**
 * Годовой купонный доход на одну облигацию.
 *
 * annualCoupon = couponAmount × (365.25 / couponPeriodDays)
 *
 * @param couponAmount — размер купона на 1 облигацию (RUB)
 * @param couponPeriodDays — длительность купонного периода (дни)
 * @returns годовой купонный доход или null
 */
export function annualCouponPerBond(
  couponAmount: number,
  couponPeriodDays: number,
): number | null {
  if (couponAmount <= 0 || couponPeriodDays <= 0) {
    return null;
  }
  return couponAmount * (DAYS_PER_YEAR / couponPeriodDays);
}

/**
 * Годовой купонный доход на позицию.
 *
 * @param couponAmount — размер купона на 1 облигацию (RUB)
 * @param couponPeriodDays — длительность купонного периода (дни)
 * @param quantity — количество бумаг
 * @returns годовой купонный доход для позиции (RUB)
 */
export function annualCouponIncome(
  couponAmount: number,
  couponPeriodDays: number,
  quantity: number,
): number | null {
  const perBond = couponAmount > 0 && couponPeriodDays > 0
    ? couponAmount * (DAYS_PER_YEAR / couponPeriodDays)
    : null;
  if (perBond === null) return null;
  return perBond * quantity;
}

// ──────────────────────────────────────────────
// 5. Следующая купонная выплата
// ──────────────────────────────────────────────

/**
 * Следующая купонная выплата на позицию.
 *
 * @param couponAmount — размер купона на 1 облигацию (RUB)
 * @param quantity — количество бумаг
 * @returns сумма следующей выплаты (RUB)
 */
export function nextCouponPayment(
  couponAmount: number,
  quantity: number,
): number {
  return couponAmount * quantity;
}

// ──────────────────────────────────────────────
// 6. Проекция купонных выплат до погашения
// ──────────────────────────────────────────────

/**
 * Распределение купонных выплат до погашения.
 *
 * @param nextCouponDate — ближайшая дата выплаты
 * @param couponAmount — размер купона на 1 облигацию (RUB)
 * @param couponPeriodDays — длительность купонного периода (дни)
 * @param maturityDate — дата погашения
 * @param quantity — количество бумаг
 * @returns массив проекций выплат
 */
export function projectedCouponFlow(
  nextCouponDate: Date,
  couponAmount: number,
  couponPeriodDays: number,
  maturityDate: Date,
  quantity: number,
): CouponProjection[] {
  const projections: CouponProjection[] = [];

  if (couponAmount <= 0 || couponPeriodDays <= 0) {
    return projections;
  }

  let currentDate = new Date(nextCouponDate);
  const end = new Date(maturityDate);

  // Генерируем выплаты до погашения
  while (currentDate <= end) {
    projections.push({
      date: new Date(currentDate),
      couponPerBond: couponAmount,
      couponForPosition: couponAmount * quantity,
      daysUntil: Math.round(
        (currentDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      ),
    });

    // Следующая дата выплаты
    currentDate = new Date(currentDate.getTime() + couponPeriodDays * 24 * 60 * 60 * 1000);
  }

  return projections;
}

// ──────────────────────────────────────────────
// 7. YTM (доходность к погашению)
// ──────────────────────────────────────────────

/**
 * Расчёт YTM через метод Ньютона-Рафсона.
 *
 * Используется ТОЛЬКО при наличии полного графика денежных потоков.
 * Приоритет: показатель yield из QUIK.
 *
 * YTM — это ставка, при которой NPV всех будущих денежных потоков
 * равна текущей рыночной цене.
 *
 * @param price — рыночная цена 1 облигации (RUB)
 * @param couponAmount — размер купона (RUB)
 * @param couponPeriodDays — период между выплатами (дни)
 * @param maturityDate — дата погашения
 * @param nominal — номинал
 * @param frequency — количество выплат в год (автоматически из couponPeriodDays)
 * @returns YTM в % или null если расчёт невозможен
 */
export function calculateYTM(
  price: number,
  couponAmount: number,
  couponPeriodDays: number,
  maturityDate: Date,
  nominal: number,
): number | null {
  // Валидация входных данных
  if (price <= 0 || couponAmount < 0 || nominal <= 0) {
    return null;
  }

  // Количество периодов до погашения
  const daysToMaturity = Math.round(
    (maturityDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  if (daysToMaturity <= 0) {
    // Облигация погашена
    return price >= nominal ? 0 : null;
  }

  const periods = Math.floor(daysToMaturity / (couponPeriodDays || 365));
  if (periods <= 0) {
    return null;
  }

  // Параметры расчёта
  const periodsPerYear = DAYS_PER_YEAR / (couponPeriodDays || 365);
  const maxIterations = 100;
  const tolerance = 1e-8;
  let ytm = couponAmount / price; // Начальное приближение

  for (let iter = 0; iter < maxIterations; iter++) {
    let npv = 0;
    let dnpv = 0;

    for (let t = 1; t <= periods; t++) {
      const discount = Math.pow(1 + ytm / periodsPerYear, t);
      const cf = t < periods ? couponAmount : couponAmount + nominal;
      npv += cf / discount;
      dnpv -= (t * cf) / (discount * (1 + ytm / periodsPerYear) * periodsPerYear);
    }

    const diff = npv - price;

    if (Math.abs(diff) < tolerance) {
      return (ytm * 100);
    }

    if (Math.abs(dnpv) < 1e-12) {
      break;
    }

    ytm = ytm - diff / dnpv;

    // Защита от расходимости
    if (ytm < -1 || ytm > 2) {
      break;
    }
  }

  return null;
}

// ──────────────────────────────────────────────
// 8. Эффективная доходность
// ──────────────────────────────────────────────

/**
 * Эффективная годовая доходность.
 *
 * EY = (1 + periodicYTM / n)^n - 1
 *
 * @param nominalYTM — номинальная YTM в %
 * @param periodsPerYear — количество выплат в год
 * @returns эффективная доходность в % или null
 */
export function effectiveYield(
  nominalYTM: number,
  periodsPerYear: number,
): number | null {
  if (nominalYTM <= -100) return null;

  const periodicRate = (nominalYTM / 100) / periodsPerYear;
  return (Math.pow(1 + periodicRate, periodsPerYear) - 1) * 100;
}

// ──────────────────────────────────────────────
// 9. Основной интерфейс — YieldAnalysis
// ──────────────────────────────────────────────

/**
 * Полный расчёт доходности облигации.
 *
 * Приоритет:
 * 1. yield из QUIK (столбец E) — использовать как первичный
 * 2. Расчёт Current Yield из couponAmount и marketPrice
 * 3. Расчёт YTM — только при наличии полного графика
 *
 * @param params — параметры облигации
 * @returns YieldAnalysis
 */
export function analyzeYield(params: {
  /** Доходность из QUIK (столбец E). НЕ называть YTM без подтверждения. */
  quikYield?: number;
  /** Размер купона на 1 облигацию (RUB) */
  couponAmount: number;
  /** Длительность купонного периода (дни) */
  couponPeriodDays: number;
  /** Рыночная цена 1 облигации (RUB) */
  marketPrice: number;
  /** Номинал */
  nominal: number;
  /** Количество бумаг */
  quantity: number;
  /** Ближайшая дата выплаты купона */
  nextCouponDate?: Date | null;
  /** Дата погашения */
  maturityDate?: Date | null;
  /** Известны ли условия плавающего купона */
  hasFloatingTerms?: boolean;
}): YieldAnalysis {
  const {
    quikYield,
    couponAmount,
    couponPeriodDays,
    marketPrice,
    nominal,
    quantity,
    nextCouponDate,
    maturityDate,
    hasFloatingTerms,
  } = params;

  // Определение типа купона
  const couponType = determineCouponType(
    couponAmount,
    nominal,
    marketPrice,
    couponPeriodDays,
    hasFloatingTerms,
  );

  // Годовой купонный доход на 1 облигацию
  const annualCouponPerBondVal = annualCouponPerBond(couponAmount, couponPeriodDays);

  // Годовой купонный доход на позицию
  const annualCouponIncomeVal = annualCouponIncome(
    couponAmount,
    couponPeriodDays,
    quantity,
  );

  // Следующая купонная выплата
  const nextCouponVal = couponAmount > 0 ? couponAmount * quantity : 0;

  // Current Yield
  const currentYieldVal = annualCouponPerBondVal !== null
    ? currentYield(annualCouponPerBondVal, marketPrice)
    : null;

  // YTM из QUIK (приоритет)
  let ytm: number | null = quikYield !== undefined && quikYield > 0
    ? quikYield
    : null;

  // Расчёт YTM — только при наличии полного графика
  if (ytm === null && maturityDate && couponPeriodDays > 0 && couponAmount >= 0) {
    ytm = calculateYTM(marketPrice, couponAmount, couponPeriodDays, maturityDate, nominal);
  }

  // Эффективная доходность
  let effectiveYieldVal: number | null = null;
  if (ytm !== null) {
    const periodsPerYear = couponPeriodDays > 0
      ? DAYS_PER_YEAR / couponPeriodDays
      : 1;
    effectiveYieldVal = effectiveYield(ytm, periodsPerYear);
  }

  // Проекция купонных выплат (для будущего использования)
  if (nextCouponDate && maturityDate && couponAmount > 0 && couponPeriodDays > 0) {
    // couponFlow = projectedCouponFlow(...) — используется в P2 для cashflow-анализа
  }

  // Статус качества данных
  let dataQuality: 'AVAILABLE' | 'PARTIAL' | 'MISSING' = 'AVAILABLE';
  if (quikYield === undefined && ytm === null) {
    dataQuality = 'MISSING';
  } else if (quikYield === undefined && ytm !== null) {
    dataQuality = 'PARTIAL'; // YTM рассчитан, но QUIK-значение отсутствует
  }

  return {
    currentYield: currentYieldVal,
    ytm,
    effectiveYield: effectiveYieldVal,
    annualCouponIncome: annualCouponIncomeVal,
    nextCouponPayment: nextCouponVal > 0 ? nextCouponVal : null,
    couponType,
    dataQuality,
  };
}
