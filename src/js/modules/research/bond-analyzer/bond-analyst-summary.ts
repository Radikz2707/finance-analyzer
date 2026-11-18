/**
 * Bond Analyst Summary — итоговая оценка облигации.
 *
 * Разделяет три вопроса:
 * 1. Качество эмитента: способен ли он обслуживать обязательства?
 * 2. Привлекательность выпуска: компенсирует ли доходность принимаемые риски?
 * 3. Портфельная целесообразность: нужно ли увеличивать позицию?
 *
 * Не сводит эти вопросы к одному сигналу BUY/HOLD/SELL без объяснения.
 */

import type {
  BondRecommendation,
  BondFinalAssessment,
  YieldAnalysis,
  DurationAnalysis,
  CreditAssessment,
  LiquidityAssessment,
} from './bond-analyzer-types.js';

/** Купон следует за ставкой — YTM не является доходностью к погашению. */
function isFloatingCoupon(couponType: YieldAnalysis['couponType']): boolean {
  return couponType === 'FLOATER';
}

/**
 * Дефолт/реструктуризация: покупка запрещена независимо от доходности.
 * Признак берём только из подтверждённых полей, без догадок.
 */
function isDefaultOrRestructuring(credit: CreditAssessment): boolean {
  const outlook = (credit.rating?.outlook ?? '').toUpperCase();
  const rating = (credit.rating?.rating ?? '').toUpperCase();
  if (outlook.includes('DEFAULT')) return true;
  if (rating === 'RD' || rating === 'D' || rating === 'SD') return true;
  return /реструктуризац|дефолт/i.test(credit.summary);
}

/** Порог, выше которого доходность трактуется как компенсация риска. */
const HIGH_YTM_THRESHOLD_PCT = 25;

/** Дата кредитного источника: «дата не указана» вместо пустоты. */
function formatCreditAsOf(value: string | null): string {
  if (!value) return 'дата не указана';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('ru-RU');
}

// ──────────────────────────────────────────────
// 1. Итоговая рекомендация
// ──────────────────────────────────────────────

/**
 * Формирование итоговой рекомендации по облигации.
 *
 * Рекомендации:
 * - BUY — облигация привлекательна, портфельный дефицит
 * - HOLD — облигация привлекательна, позиция в норме
 * - REDUCE — облигация привлекательна, но портфельный профицит
 * - EXIT — облигация НЕ привлекательна или портфельный профицит
 * - WAIT — недостаточно данных для решения
 * - INSUFFICIENT_DATA — критически не хватает данных
 */
export function determineBondRecommendation(params: {
  yieldAnalysis: YieldAnalysis;
  durationAnalysis: DurationAnalysis;
  creditAssessment: CreditAssessment;
  portfolioStatus: 'BUY' | 'HOLD' | 'REDUCE' | 'EXIT' | 'NO_TARGET';
  holdOnly?: boolean;
}): BondRecommendation {
  const {
    yieldAnalysis,
    durationAnalysis: _,
    creditAssessment,
    portfolioStatus,
    holdOnly,
  } = params;

  // INSUFFICIENT_DATA — критически не хватает данных
  if (
    yieldAnalysis.dataQuality === 'MISSING' &&
    creditAssessment.quality === 'INSUFFICIENT_DATA'
  ) {
    return 'INSUFFICIENT_DATA';
  }

  // Дефолт/реструктуризация: доходность не должна перекрывать статус.
  if (isDefaultOrRestructuring(creditAssessment)) {
    return holdOnly ? 'HOLD' : 'EXIT';
  }

  // Критический кредитный риск → EXIT (если не holdOnly)
  if (creditAssessment.quality === 'LOW') {
    return holdOnly ? 'HOLD' : 'EXIT';
  }

  // Портфельный статус
  if (portfolioStatus === 'EXIT') {
    return holdOnly ? 'HOLD' : 'EXIT';
  }

  // Привлекательность выпуска.
  // YTM-критерий применим только к подтверждённому фиксированному купону.
  // Для флоатера, ИН и неподтверждённого типа YTM — проекция, поэтому
  // критерий — текущая доходность, а не «доходность к погашению».
  const ytmBased =
    yieldAnalysis.couponType === 'FIXED' ||
    yieldAnalysis.couponType === 'FIXED_AMORTIZING';
  const attractive = ytmBased
    ? yieldAnalysis.ytm !== null && yieldAnalysis.ytm > 0
    : yieldAnalysis.currentYield !== null && yieldAnalysis.currentYield > 0;

  if (portfolioStatus === 'REDUCE') {
    // Если облигация привлекательна — REDUCE, иначе EXIT
    return attractive ? 'REDUCE' : 'EXIT';
  }

  if (portfolioStatus === 'BUY') {
    // Портфельный дефицит + привлекательная облигация → BUY
    return attractive ? 'BUY' : 'HOLD';
  }

  // HOLD / NO_TARGET
  if (creditAssessment.quality === 'INSUFFICIENT_DATA') {
    return 'WAIT';
  }

  return 'HOLD';
}

// ──────────────────────────────────────────────
// 2. Итоговая оценка облигации
// ──────────────────────────────────────────────

/**
 * Полная итоговая оценка облигации.
 *
 * @param params — все параметры для оценки
 * @returns BondFinalAssessment
 */
export function buildBondFinalAssessment(params: {
  /** Доходность */
  yieldAnalysis: YieldAnalysis;
  /** Процентный риск */
  durationAnalysis: DurationAnalysis;
  /** Кредитное качество */
  creditAssessment: CreditAssessment;
  /** Ликвидность */
  liquidityAssessment: LiquidityAssessment;
  /** Портфельный статус (из PortfolioMath) */
  portfolioMathStatus: string;
  /** Текущая доля в портфеле (%) */
  currentPercent: number;
  /** Целевая доля в портфеле (%) */
  targetPercent: number | null;
  /** Номинал позиции (руб.) */
  positionValue: number;
  /** ISIN облигации */
  isin: string;
  /** Название выпуска */
  instrumentName: string;
  /** holdOnly */
  holdOnly?: boolean;
}): BondFinalAssessment {
  const {
    yieldAnalysis,
    durationAnalysis,
    creditAssessment,
    liquidityAssessment,
    portfolioMathStatus,
    currentPercent,
    targetPercent,
    positionValue,
    isin: _isin,
    instrumentName: _instrumentName,
    holdOnly,
  } = params;

  // Итоговая рекомендация
  const recommendation = determineBondRecommendation({
    yieldAnalysis,
    durationAnalysis,
    creditAssessment,
    portfolioStatus: portfolioMathStatus as
      'BUY' | 'HOLD' | 'REDUCE' | 'EXIT' | 'NO_TARGET',
    holdOnly,
  });

  // Формирование обоснования
  const rationaleParts: string[] = [];

  // Доходность.
  // Для флоатера «доходность к погашению» — неверная подпись: купон следует
  // за ставкой, поэтому YTM здесь только проекция при текущей ставке.
  const floating = isFloatingCoupon(yieldAnalysis.couponType);
  if (floating) {
    const current = yieldAnalysis.currentYield;
    rationaleParts.push(
      current !== null
        ? `Купон плавающий (${yieldAnalysis.couponType}): текущая доходность ${current.toFixed(2)}%; ` +
            'YTM не является доходностью к погашению — это проекция при предположении неизменной ставки'
        : `Купон плавающий (${yieldAnalysis.couponType}): YTM не является доходностью к погашению — ` +
            'это проекция при предположении неизменной ставки',
    );
  } else if (yieldAnalysis.ytm !== null) {
    // «Доходность к погашению» допустима только для подтверждённого
    // фиксированного купона. Для UNKNOWN/ИН формулировка запрещена:
    // 29027 не должен подтверждать FIXED.
    if (yieldAnalysis.couponType === 'UNKNOWN') {
      rationaleParts.push(
        `YTM: ${yieldAnalysis.ytm.toFixed(2)}% — тип купона не подтверждён, ` +
          'формулировка «доходность к погашению» не применяется',
      );
    } else if (yieldAnalysis.couponType === 'INFLATION_LINKED') {
      rationaleParts.push(
        `YTM: ${yieldAnalysis.ytm.toFixed(2)}% — индексируемый номинал, ` +
          'методика не подтверждена',
      );
    } else if (yieldAnalysis.couponType === 'FIXED_AMORTIZING') {
      rationaleParts.push(
        `Доходность к погашению: ${yieldAnalysis.ytm.toFixed(2)}% ` +
          '(без учёта амортизации номинала)',
      );
    } else {
      rationaleParts.push(
        `Доходность к погашению: ${yieldAnalysis.ytm.toFixed(2)}%`,
      );
    }
  } else if (yieldAnalysis.currentYield !== null) {
    rationaleParts.push(
      `Текущая доходность: ${yieldAnalysis.currentYield.toFixed(2)}% (YTM недоступен)`,
    );
  } else {
    rationaleParts.push('Доходность недоступна');
  }

  if (yieldAnalysis.annualCouponIncome !== null) {
    rationaleParts.push(
      `Годовой купонный доход: ${yieldAnalysis.annualCouponIncome.toLocaleString('ru-RU')} руб.`,
    );
  }

  // Процентный риск
  if (durationAnalysis.duration !== null) {
    rationaleParts.push(`Дюрация: ${durationAnalysis.duration.toFixed(1)}`);
  }
  if (durationAnalysis.dv01 !== null) {
    rationaleParts.push(
      `DV01: ${durationAnalysis.dv01.toFixed(2)} руб. (потеря на 1 п.п. изменения доходности)`,
    );
  }

  // YTM semantics — чёткое разграничение
  if (yieldAnalysis.ytm !== null) {
    rationaleParts.push(
      floating
        ? `⚠️ YTM=${yieldAnalysis.ytm.toFixed(2)}% — проекция при предположении неизменной ставки ` +
            '(методика FLOATER_ASSUMED_CONSTANT_RATE), не гарантия и не «доходность к погашению»'
        : `⚠️ YTM=${yieldAnalysis.ytm.toFixed(2)}% — это ПРОЕКЦИЯ, не гарантия (купонные выплаты могут быть reinvested по иной ставке)`,
    );
  }

  // Высокая доходность при неподтверждённом качестве — это риск, не «привлекательность».
  if (
    yieldAnalysis.ytm !== null &&
    yieldAnalysis.ytm >= HIGH_YTM_THRESHOLD_PCT &&
    creditAssessment.quality !== 'HIGH'
  ) {
    rationaleParts.push(
      `⚠️ Доходность ${yieldAnalysis.ytm.toFixed(2)}% при кредитном качестве ${creditAssessment.quality} — ` +
        'это компенсация кредитного риска, а не признак привлекательности',
    );
  }

  // Кредитное качество — всегда с источником и датой.
  rationaleParts.push(
    `Кредитное качество: ${creditAssessment.quality} ` +
      `(${creditAssessment.source}, ${formatCreditAsOf(creditAssessment.asOfDate)})`,
  );
  if (creditAssessment.rating) {
    rationaleParts.push(
      `Рейтинг ${creditAssessment.rating.agency}: ${creditAssessment.rating.rating} ` +
        `(прогноз: ${creditAssessment.rating.outlook})`,
    );
  }
  if (isDefaultOrRestructuring(creditAssessment)) {
    rationaleParts.push(
      '⛔ Статус эмитента: дефолт/реструктуризация — покупка запрещена',
    );
  }

  // Ликвидность
  if (liquidityAssessment.summary) {
    rationaleParts.push(`Ликвидность: ${liquidityAssessment.summary}`);
  }
  if (creditAssessment.summary) {
    rationaleParts.push(creditAssessment.summary);
  }

  // Портфельная целесообразность
  if (targetPercent !== null) {
    const deviation = currentPercent - targetPercent;
    if (Math.abs(deviation) > 1) {
      rationaleParts.push(
        `Портфельное отклонение: ${deviation > 0 ? '+' : ''}${deviation.toFixed(1)} п.п. (текущая ${currentPercent.toFixed(1)}% vs целевая ${targetPercent.toFixed(1)}%)`,
      );
    }
  }

  // holdOnly
  if (holdOnly) {
    rationaleParts.push('⚠️ holdOnly: продажа заблокирована');
  }

  // Недостающие данные
  const missingData: string[] = [];
  if (yieldAnalysis.ytm === null) {
    missingData.push(
      'YTM — расчёт невозможен без полного графика денежных потоков',
    );
  }
  if (yieldAnalysis.dataQuality === 'MISSING') {
    missingData.push('Доходность из QUIK отсутствует');
  }
  if (creditAssessment.quality === 'INSUFFICIENT_DATA') {
    missingData.push('Финансовые показатели эмитента недоступны');
  }

  // Дюрация — детализация missingData по типу
  if (durationAnalysis.durationType === 'UNKNOWN') {
    missingData.push(
      'Тип дюрации не подтверждён — DV01 и сценарный анализ не рассчитаны',
    );
  } else if (durationAnalysis.durationType === 'DV01') {
    missingData.push(
      'Исходный DV01 сохранён — производные расчёты (priceImpact, scenarios) недоступны',
    );
  } else if (
    durationAnalysis.durationType === 'MACAULAY' &&
    durationAnalysis.derivedDataQuality === 'PARTIAL'
  ) {
    missingData.push(
      'Дюрация Macaulay без подтверждённой YTM — расчёты невозможны',
    );
  }

  // Согласованность с PortfolioMath
  let mathAgreement = 'AGREE';
  if (recommendation === 'BUY' && portfolioMathStatus === 'NO_TARGET') {
    mathAgreement = 'DISAGREE';
  } else if (recommendation === 'EXIT' && portfolioMathStatus === 'BUY') {
    mathAgreement = 'DISAGREE';
  }

  // Влияние на структуру портфеля
  let portfolioImpact = 'Не влияет на структуру портфеля';
  if (targetPercent !== null) {
    const deficitRub = ((targetPercent - currentPercent) / 100) * positionValue;
    if (deficitRub > 0) {
      portfolioImpact = `Портфельный дефицит: ${deficitRub.toLocaleString('ru-RU')} руб. для достижения целевой доли ${targetPercent.toFixed(1)}%`;
    } else if (deficitRub < 0) {
      portfolioImpact = `Портфельный профицит: ${Math.abs(deficitRub).toLocaleString('ru-RU')} руб. избыток позиции`;
    }
  }

  return {
    recommendation,
    rationale: rationaleParts.join('. '),
    yield: yieldAnalysis,
    duration: durationAnalysis,
    credit: creditAssessment,
    liquidity: liquidityAssessment,
    missingData,
    mathAgreement,
    portfolioImpact,
  };
}
