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

import { PortfolioConfig } from '../../../config/portfolio-config.js';
import type {
  CouponType,
  CouponTypeReason,
  CouponTypeSource,
  YtmMethod,
  YieldAnalysis,
  CouponProjection,
} from './bond-analyzer-types.js';
import { formatCalendarDate } from '../../shared/date-utils.js';

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
 *
 * @param isCouponDataActive — true если данные купона подтверждены
 *   из авторитетного источника (ISS description, серия ОФЗ). Если false
 *   и couponAmount === 0 → UNKNOWN вместо ZERO_COUPON: нулевой купон
 *   на неактивной строке Excel — это «нет данных», а не «бескупонная».
 */
export function determineCouponType(
  couponAmount: number,
  _nominal: number,
  _lastPrice: number,
  couponPeriodDays: number,
  hasFloatingTerms: boolean = false,
  isCouponDataActive: boolean = true,
): CouponType {
  // Если известны условия плавающего купона → FLOATER
  if (hasFloatingTerms) {
    return 'FLOATER';
  }

  // Нулевой купон: только если данные активны — иначе UNKNOWN
  if (couponAmount <= 0) {
    return isCouponDataActive ? 'ZERO_COUPON' : 'UNKNOWN';
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
  const perBond =
    couponAmount > 0 && couponPeriodDays > 0
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
    currentDate = new Date(
      currentDate.getTime() + couponPeriodDays * 24 * 60 * 60 * 1000,
    );
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
      dnpv -=
        (t * cf) / (discount * (1 + ytm / periodsPerYear) * periodsPerYear);
    }

    const diff = npv - price;

    if (Math.abs(diff) < tolerance) {
      return ytm * 100;
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

  const periodicRate = nominalYTM / 100 / periodsPerYear;
  return (Math.pow(1 + periodicRate, periodsPerYear) - 1) * 100;
}

// ──────────────────────────────────────────────
// 9. Основной интерфейс — YieldAnalysis
// ──────────────────────────────────────────────

/** Тип купона, однозначно заданный серией ОФЗ. */
export type OfzSeries =
  'FIXED' | 'FLOATER' | 'FIXED_AMORTIZING' | 'INFLATION_LINKED' | 'UNKNOWN';

const OFZ_SERIES_BY_PREFIX: Readonly<Record<string, OfzSeries>> =
  PortfolioConfig.bondOfz.seriesByPrefix;

/**
 * Определить серию ОФЗ по государственному регистрационному номеру.
 *
 * Фактическая раскладка (см. PortfolioConfig.bondOfz):
 * - 24xxx, 29xxx — ОФЗ-ПК (плавающий купон);
 * - 25xxx, 26xxx — ОФЗ-ПД (фиксированный купон);
 * - 46xxx — ОФЗ-АД (фиксированный купон + амортизация долга);
 * - 52xxx — ОФЗ-ИН (индексируемый номинал).
 *
 * Префикс-карта — только фолбэк: основной путь — couponType из description
 * MOEX ISS. Распознанный госрегномер с неизвестным префиксом даёт UNKNOWN
 * (тип не определён), а не класс по умолчанию. null — если это не
 * госрегномер ОФЗ.
 */
export function classifyOfzSeries(
  identifier: string | undefined,
): OfzSeries | null {
  const match = /^(SU)?(\d{2})\d{3}/i.exec((identifier ?? '').trim());
  if (!match) return null;
  const prefix = match[2];
  if (!prefix) return 'UNKNOWN';
  return OFZ_SERIES_BY_PREFIX[prefix] ?? 'UNKNOWN';
}

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
  /**
   * Идентификатор бумаги (ISIN или госрегномер). Нужен для фолбэка
   * классификации купона по префиксу 29xxx (ОФЗ).
   */
  identifier?: string;
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
  /**
   * Тип купона из description MOEX ISS — основной источник.
   * Передаётся как OfzSeries (включая FIXED_AMORTIZING / INFLATION_LINKED).
   */
  issCouponType?: OfzSeries;
  /** Сырое значение из ISS (например, «ОФЗ-ПК») для атрибуции конфликта. */
  issCouponTypeRaw?: string | null;
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
    issCouponType,
    issCouponTypeRaw,
    identifier,
  } = params;

  // Классификация типа купона.
  // Приоритет: description ISS → серия ОФЗ из конфига → эвристика по Excel.
  // «Excel FIXED» — это эвристика determineCouponType (купон > 0), а не
  // подтверждённый источник. Конфликт с FLOATER даёт UNKNOWN, а не FIXED.
  // isCouponDataActive: данные купона активны, если ISS дал тип или серия ОФЗ подтверждена.
  const issType =
    issCouponType && issCouponType !== 'UNKNOWN' ? issCouponType : null;
  const seriesType = classifyOfzSeries(identifier);
  const isCouponDataActive =
    issType !== null || (seriesType && seriesType !== 'UNKNOWN') || false;
  const excelType = determineCouponType(
    couponAmount,
    nominal,
    marketPrice,
    couponPeriodDays,
    hasFloatingTerms,
    isCouponDataActive,
  );
  const authoritative = issType
    ? { type: issType, source: 'ISS' as CouponTypeSource }
    : seriesType && seriesType !== 'UNKNOWN'
      ? { type: seriesType, source: 'SERIES' as CouponTypeSource }
      : null;

  let couponType: CouponType;
  let couponTypeReason: CouponTypeReason | null = null;
  let couponTypeReasonDetail: string | null = null;
  let couponTypeSource: CouponTypeSource | null = null;

  if (authoritative) {
    const label = authoritative.source === 'ISS' ? 'ISS' : 'серия';
    if (authoritative.type === 'FLOATER' && excelType === 'FIXED') {
      // Excel (эвристика) даёт FIXED, а ISS/серия — FLOATER: источники
      // противоречат, тип не подтверждён. Это и есть кейс 29027.
      couponType = 'UNKNOWN';
      couponTypeReason = 'excel_conflict';
      couponTypeReasonDetail =
        `Excel FIXED, ${label} FLOATER` +
        (issCouponTypeRaw ? ` (${issCouponTypeRaw})` : '');
    } else {
      couponType = authoritative.type;
      couponTypeSource = authoritative.source;
    }
  } else if (seriesType === 'UNKNOWN') {
    // Госрегномер распознан, но префикс не из карты: тип не определён.
    couponType = 'UNKNOWN';
    couponTypeReason = 'type_unconfirmed';
    couponTypeReasonDetail =
      'префикс серии не распознан — тип купона не определён';
  } else {
    couponType = excelType;
    couponTypeSource = 'EXCEL';
  }

  console.log(
    `[BOND_CARD] id=${identifier ?? 'n/a'} couponType=${couponType} ` +
      `source=${couponTypeSource ?? 'none'} raw=${issCouponTypeRaw ?? 'null'} ` +
      `reason=${couponTypeReason ?? 'none'}`,
  );

  // Годовой купонный доход на 1 облигацию
  const annualCouponPerBondVal = annualCouponPerBond(
    couponAmount,
    couponPeriodDays,
  );

  // Годовой купонный доход на позицию
  const annualCouponIncomeVal = annualCouponIncome(
    couponAmount,
    couponPeriodDays,
    quantity,
  );

  // Следующая купонная выплата
  const nextCouponVal = couponAmount > 0 ? couponAmount * quantity : 0;

  // Current Yield
  const currentYieldVal =
    annualCouponPerBondVal !== null
      ? currentYield(annualCouponPerBondVal, marketPrice)
      : null;

  // YTM из QUIK (приоритет)
  let ytm: number | null =
    quikYield !== undefined && quikYield > 0 ? quikYield : null;

  // Расчёт YTM — только при наличии полного графика
  if (
    ytm === null &&
    maturityDate &&
    couponPeriodDays > 0 &&
    couponAmount >= 0
  ) {
    ytm = calculateYTM(
      marketPrice,
      couponAmount,
      couponPeriodDays,
      maturityDate,
      nominal,
    );
  }

  // Эффективная доходность
  let effectiveYieldVal: number | null = null;
  if (ytm !== null) {
    const periodsPerYear =
      couponPeriodDays > 0 ? DAYS_PER_YEAR / couponPeriodDays : 1;
    effectiveYieldVal = effectiveYield(ytm, periodsPerYear);
  }

  // Проекция купонных выплат (для будущего использования)
  if (
    nextCouponDate &&
    maturityDate &&
    couponAmount > 0 &&
    couponPeriodDays > 0
  ) {
    // couponFlow = projectedCouponFlow(...) — используется в P2 для cashflow-анализа
  }

  // Дата ближайшей выплаты: только подтверждённая источником.
  // null означает «дата не указана», а не «сегодня».
  // Форматтер календарный: локальная полночь Excel иначе даёт день-1.
  const nextCouponDateIso = formatCalendarDate(nextCouponDate);

  // Методика YTM: карточка обязана её подписать, особенно для флоатера.
  let ytmMethod: YtmMethod | null = null;
  if (ytm !== null) {
    if (quikYield !== undefined && quikYield > 0) {
      ytmMethod = 'QUIK';
    } else if (couponType === 'FLOATER') {
      ytmMethod = 'FLOATER_ASSUMED_CONSTANT_RATE';
    } else if (couponType === 'FIXED_AMORTIZING') {
      ytmMethod = 'AMORTIZING_NOT_ADJUSTED';
    } else {
      ytmMethod = 'CALCULATED_FIXED_COUPON';
    }
  }

  // Статус качества данных
  let dataQuality: 'AVAILABLE' | 'PARTIAL' | 'MISSING' = 'AVAILABLE';
  if (quikYield === undefined && ytm === null) {
    dataQuality = 'MISSING';
  } else if (quikYield === undefined && ytm !== null) {
    dataQuality = 'PARTIAL'; // YTM рассчитан, но QUIK-значение отсутствует
  }

  // Пункт 2 плана: UNKNOWN купон + nextCouponDate = оксюморон.
  // Бескупонная/неподтверждённая бумага не имеет следующей выплаты —
  // карточка не должна показывать «следующая выплата: 12.12.2026»
  // для UNKNOWN couponType когда дата не подтверждена источником.
  // Для excel_conflict (29027) — дата подтверждена, показываем.
  // Для type_unconfirmed / null — дата не подтверждена, null.
  const finalNextCouponDate =
    couponType === 'UNKNOWN' && !nextCouponDateIso ? null : nextCouponDateIso;

  return {
    currentYield: currentYieldVal,
    ytm,
    effectiveYield: effectiveYieldVal,
    annualCouponIncome: annualCouponIncomeVal,
    nextCouponPayment: nextCouponVal > 0 ? nextCouponVal : null,
    nextCouponDate: finalNextCouponDate,
    couponType,
    couponTypeReason,
    couponTypeReasonDetail,
    couponTypeSource,
    ytmMethod,
    dataQuality,
  };
}
