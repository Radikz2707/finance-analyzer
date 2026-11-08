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
} from './bond-analyzer-types.js';

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
  const { yieldAnalysis, durationAnalysis: _, creditAssessment, portfolioStatus, holdOnly } = params;

  // INSUFFICIENT_DATA — критически не хватает данных
  if (yieldAnalysis.dataQuality === 'MISSING' && creditAssessment.quality === 'INSUFFICIENT_DATA') {
    return 'INSUFFICIENT_DATA';
  }

  // Критический кредитный риск → EXIT (если не holdOnly)
  if (creditAssessment.quality === 'LOW') {
    return holdOnly ? 'HOLD' : 'EXIT';
  }

  // Портфельный статус
  if (portfolioStatus === 'EXIT') {
    return holdOnly ? 'HOLD' : 'EXIT';
  }

  if (portfolioStatus === 'REDUCE') {
    // Если облигация привлекательна — REDUCE, иначе EXIT
    if (yieldAnalysis.ytm !== null && yieldAnalysis.ytm > 0) {
      return 'REDUCE';
    }
    return 'EXIT';
  }

  if (portfolioStatus === 'BUY') {
    // Портфельный дефицит + привлекательная облигация → BUY
    if (yieldAnalysis.ytm !== null && yieldAnalysis.ytm > 0) {
      return 'BUY';
    }
    return 'HOLD';
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
    portfolioStatus: portfolioMathStatus as 'BUY' | 'HOLD' | 'REDUCE' | 'EXIT' | 'NO_TARGET',
    holdOnly,
  });

  // Формирование обоснования
  const rationaleParts: string[] = [];

  // Доходность
  if (yieldAnalysis.ytm !== null) {
    rationaleParts.push(`Доходность к погашению: ${yieldAnalysis.ytm.toFixed(2)}%`);
  } else if (yieldAnalysis.currentYield !== null) {
    rationaleParts.push(`Текущая доходность: ${yieldAnalysis.currentYield.toFixed(2)}% (YTM недоступен)`);
  } else {
    rationaleParts.push('Доходность недоступна');
  }

  if (yieldAnalysis.annualCouponIncome !== null) {
    rationaleParts.push(`Годовой купонный доход: ${yieldAnalysis.annualCouponIncome.toLocaleString('ru-RU')} руб.`);
  }

  // Процентный риск
  if (durationAnalysis.duration !== null) {
    rationaleParts.push(`Дюрация: ${durationAnalysis.duration.toFixed(1)}`);
  }
  if (durationAnalysis.dv01 !== null) {
    rationaleParts.push(`DV01: ${durationAnalysis.dv01.toFixed(2)} руб.`);
  }

  // Кредитное качество
  rationaleParts.push(`Кредитное качество: ${creditAssessment.quality}`);
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
    missingData.push('YTM — расчёт невозможен без полного графика денежных потоков');
  }
  if (yieldAnalysis.dataQuality === 'MISSING') {
    missingData.push('Доходность из QUIK отсутствует');
  }
  if (creditAssessment.quality === 'INSUFFICIENT_DATA') {
    missingData.push('Финансовые показатели эмитента недоступны');
  }

  // Дюрация — детализация missingData по типу
  if (durationAnalysis.durationType === 'UNKNOWN') {
    missingData.push('Тип дюрации не подтверждён — DV01 и сценарный анализ не рассчитаны');
  } else if (durationAnalysis.durationType === 'DV01') {
    missingData.push('Исходный DV01 сохранён — производные расчёты (priceImpact, scenarios) недоступны');
  } else if (durationAnalysis.durationType === 'MACAULAY' && durationAnalysis.derivedDataQuality === 'PARTIAL') {
    missingData.push('Дюрация Macaulay без подтверждённой YTM — расчёты невозможны');
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
    const deficitRub = (targetPercent - currentPercent) / 100 * positionValue;
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
    liquidity: {
      status: 'PARTIAL',
      turnover: null,
      turnoverUnit: null,
      spread: null,
      depth: null,
      summary: 'Детальная оценка ликвидности требует спред и глубину стакана',
    },
    missingData,
    mathAgreement,
    portfolioImpact,
  };
}
