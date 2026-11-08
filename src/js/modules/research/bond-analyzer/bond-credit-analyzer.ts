/**
 * Bond Credit Analyzer — кредитный анализ эмитентов облигаций.
 *
 * Ключевые принципы:
 * - НЕ передавать ISIN непосредственно в STOCK-oriented IssuerFundamentalsProvider.
 * - Установить соответствие конкретного выпуска юридическому лицу-эмитенту.
 * - Различать эмитента, гаранта и материнскую компанию.
 * - Если нет подтверждённых финансовых показателей → INSUFFICIENT_DATA.
 * - НЕ выдавать AI-оценку за официальную кредитную оценку.
 * - НЕ рассчитывать количественную вероятность дефолта без обоснованной модели.
 * - Не использовать FinamIssuerFetcher для BOND-эмитентов напрямую.
 */

import type {
  CreditAssessment,
  CreditQuality,
  DataQualityStatus,
} from './bond-analyzer-types.js';

// ──────────────────────────────────────────────
// 1. Финансовые коэффициенты для кредитного анализа
// ──────────────────────────────────────────────

/** Нормализованные финансовые показатели эмитента */
export interface IssuerFinancials {
  /** Выручка (руб.) */
  revenue?: number;
  /** EBITDA (руб.) */
  ebitda?: number;
  /** Чистая прибыль (руб.) */
  netProfit?: number;
  /** Чистый долг (руб.) */
  netDebt?: number;
  /** Net Debt / EBITDA */
  netDebtToEbitda?: number;
  /** Процентные расходы (руб.) */
  interestExpense?: number;
  /** Interest Coverage (EBITDA / процентные расходы) */
  interestCoverage?: number;
  /** Операционный денежный поток (руб.) */
  operatingCashFlow?: number;
  /** Свободный денежный поток (руб.) */
  freeCashFlow?: number;
  /** Краткосрочные обязательства (руб.) */
  shortTermDebt?: number;
  /** Дата отчётности */
  reportingDate?: string;
}

// ──────────────────────────────────────────────
// 2. Кредитный рейтинг
// ──────────────────────────────────────────────

/** Информация о кредитном рейтинге */
export interface CreditRating {
  /** Рейтинговое агентство */
  agency: string;
  /** Рейтинг (например, 'AAA', 'BBB', 'RD') */
  rating: string;
  /** Прогноз ('POSITIVE', 'STABLE', 'NEGATIVE', 'DEFAULT') */
  outlook: string;
  /** Дата присвоения */
  asOfDate: string;
}

// ──────────────────────────────────────────────
// 3. Риск рефинансирования
// ──────────────────────────────────────────────

/** Оценка риска рефинансирования */
export interface RefinancingRisk {
  /** Уровень риска */
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** Доля долга, требующего рефинансирования в ближайшие 12 мес. (%) */
  refinancingMaturityPct: number;
  /** Общий объём долга, требующего рефинансирования (руб.) */
  refinancingAmount: number;
  /** Резюме */
  summary: string;
}

// ──────────────────────────────────────────────
// 4. Кредитный скоринг
// ──────────────────────────────────────────────

/**
 * Кредитный скоринг эмитента на основе финансовых показателей.
 *
 * НЕ рассчитывать количественную вероятность дефолта без модели.
 * Использовать качественные критерии.
 */
function calculateCreditScore(financials: IssuerFinancials): number {
  let score = 50; // Базовый балл

  // Net Debt / EBITDA
  if (financials.netDebtToEbitda !== undefined) {
    if (financials.netDebtToEbitda < 1) score += 20;
    else if (financials.netDebtToEbitda < 3) score += 10;
    else if (financials.netDebtToEbitda < 5) score -= 10;
    else score -= 20;
  }

  // Interest Coverage
  if (financials.interestCoverage !== undefined) {
    if (financials.interestCoverage > 5) score += 15;
    else if (financials.interestCoverage > 3) score += 10;
    else if (financials.interestCoverage > 1) score -= 5;
    else score -= 15;
  }

  // Net Profit
  if (financials.netProfit !== undefined) {
    if (financials.netProfit > 0) score += 10;
    else score -= 15;
  }

  // Free Cash Flow
  if (financials.freeCashFlow !== undefined) {
    if (financials.freeCashFlow > 0) score += 10;
    else score -= 10;
  }

  // Ограничиваем диапазон [0, 100]
  return Math.max(0, Math.min(100, score));
}

/**
 * Преобразование скорингового балла в кредитное качество.
 */
function scoreToQuality(score: number): CreditQuality {
  if (score >= 75) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  if (score >= 25) return 'LOW';
  return 'INSUFFICIENT_DATA';
}

// ──────────────────────────────────────────────
// 5. Оценка ликвидности выпуска
// ──────────────────────────────────────────────

/**
 * Оценка ликвидности облигации на основе оборота из QUIK.
 *
 * НЕ считать большой номинальный оборот достаточной гарантией ликвидности.
 * Если отсутствуют спред и глубина стакана — статус PARTIAL или INSUFFICIENT_DATA.
 */
export function assessLiquidity(
  turnover: number | null,
  quantity: number,
  currentPrice: number,
): {
  status: DataQualityStatus;
  summary: string;
} {
  // Нет данных
  if (turnover === null || turnover === 0) {
    return {
      status: 'MISSING',
      summary: 'Данные об обороте отсутствуют. Оценка ликвидности невозможна.',
    };
  }

  // Рыночная стоимость позиции
  const marketValue = quantity * currentPrice;

  // Если оборот значительно меньше рыночной стоимости — низкая ликвидность
  const liquidityRatio = turnover / (marketValue || 1);

  let status: DataQualityStatus;
  let summary: string;

  if (liquidityRatio > 0.1) {
    status = 'AVAILABLE';
    summary = `Высокая ликвидность: оборот ${(turnover / 1000000).toFixed(1)} млн руб. составляет ${((liquidityRatio) * 100).toFixed(0)}% от рыночной стоимости позиции.`;
  } else if (liquidityRatio > 0.01) {
    status = 'PARTIAL';
    summary = `Умеренная ликвидность: оборот ${(turnover / 1000000).toFixed(1)} млн руб. составляет ${((liquidityRatio) * 100).toFixed(1)}% от рыночной стоимости. Без спреда и глубины стакана оценка неполная.`;
  } else {
    status = 'PARTIAL';
    summary = `Низкая ликвидность: оборот ${(turnover / 1000000).toFixed(1)} млн руб. составляет менее 1% от рыночной стоимости позиции. Возможна продажа с дисконтом.`;
  }

  return { status, summary };
}

// ──────────────────────────────────────────────
// 6. Оценка риска рефинансирования
// ──────────────────────────────────────────────

/**
 * Оценка риска рефинансирования эмитента.
 *
 * @param maturityDate — дата погашения облигации
 * @param issuerDebtProfile — профиль долга эмитента
 * @returns RefinancingRisk
 */
export function assessRefinancingRisk(
  maturityDate: Date,
  issuerDebtProfile?: {
    totalDebt: number;
    debtMaturity12M: number;
    debtMaturity24M: number;
  },
): RefinancingRisk {
  const daysToMaturity = Math.round(
    (maturityDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  if (daysToMaturity <= 0) {
    // Облигация погашена
    return {
      level: 'LOW',
      refinancingMaturityPct: 0,
      refinancingAmount: 0,
      summary: 'Облигация погашена. Риск рефинансирования отсутствует.',
    };
  }

  // Если нет данных о профиле долга — оценка по сроку до погашения
  if (!issuerDebtProfile) {
    if (daysToMaturity > 730) {
      return {
        level: 'LOW',
        refinancingMaturityPct: 0,
        refinancingAmount: 0,
        summary: 'Срок до погашения > 2 лет. Риск рефинансирования низкий.',
      };
    }
    if (daysToMaturity > 180) {
      return {
        level: 'MEDIUM',
        refinancingMaturityPct: 0,
        refinancingAmount: 0,
        summary: 'Срок до погашения 6-24 мес. Требуется мониторинг.',
      };
    }
    return {
      level: 'HIGH',
      refinancingMaturityPct: 100,
      refinancingAmount: 0,
      summary: 'Срок до погашения < 6 мес. Высокий риск рефинансирования.',
    };
  }

  // Расчёт на основе профиля долга
  const refinancingPct =
    issuerDebtProfile.totalDebt > 0
      ? (issuerDebtProfile.debtMaturity12M / issuerDebtProfile.totalDebt) * 100
      : 0;

  let level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  if (refinancingPct > 50) level = 'CRITICAL';
  else if (refinancingPct > 30) level = 'HIGH';
  else if (refinancingPct > 15) level = 'MEDIUM';
  else level = 'LOW';

  return {
    level,
    refinancingMaturityPct: refinancingPct,
    refinancingAmount: issuerDebtProfile.debtMaturity12M,
    summary: `Доля долга к рефинансированию в течение 12 мес.: ${refinancingPct.toFixed(1)}%. Уровень риска: ${level}.`,
  };
}

// ──────────────────────────────────────────────
// 7. Основной интерфейс — CreditAssessment
// ──────────────────────────────────────────────

/**
 * Полный кредитный анализ эмитента облигации.
 *
 * @param params — параметры для анализа
 * @returns CreditAssessment
 */
export function analyzeCredit(params: {
  /** Финансовые показатели эмитента */
  financials?: IssuerFinancials;
  /** Кредитный рейтинг */
  rating?: CreditRating;
  /**
   * Внутренний рейтинг МОEX (ICBRR).
   * Приоритет: если передан — используется для определения качества.
   */
  icbrrRating?: string;
  /** Профиль долга эмитента */
  issuerDebtProfile?: {
    totalDebt: number;
    debtMaturity12M: number;
    debtMaturity24M: number;
  };
  /** Дата погашения облигации */
  maturityDate?: Date | null;
  /** Оборот из QUIK */
  turnover?: number | null;
  /** Количество бумаг */
  quantity?: number;
  /** Текущая цена */
  currentPrice?: number;
  /** Источник данных */
  dataSource: string;
}): CreditAssessment {
  const {
    financials,
    rating,
    icbrrRating,
    issuerDebtProfile,
    maturityDate,
    turnover,
    quantity = 0,
    currentPrice = 0,
    dataSource,
  } = params;

  // Кредитный скоринг
  let quality: CreditQuality = 'INSUFFICIENT_DATA';
  let financialSummary = '';

  // Приоритет: icbrrRating из MOEX > rating из Smart-Lab/MOEX > financials
  if (icbrrRating) {
    quality = icbrrToQuality(icbrrRating);
    financialSummary = `ICBRR рейтинг: ${icbrrRating}`;
  } else if (rating) {
    quality = mapRatingToQuality(rating.rating);
    financialSummary = `${rating.agency}: ${rating.rating} (${rating.outlook})`;
  } else if (financials) {
    const creditScore = calculateCreditScore(financials);
    quality = scoreToQuality(creditScore);

    const parts: string[] = [];
    if (financials.netDebtToEbitda !== undefined) {
      parts.push(`Net Debt/EBITDA: ${financials.netDebtToEbitda.toFixed(1)}`);
    }
    if (financials.interestCoverage !== undefined) {
      parts.push(`Interest Coverage: ${financials.interestCoverage.toFixed(1)}`);
    }
    if (financials.netProfit !== undefined) {
      parts.push(`Чистая прибыль: ${financials.netProfit.toLocaleString('ru-RU')} руб.`);
    }
    financialSummary = parts.join(', ');
  }

  // Риск рефинансирования
  let refinancingSummary = '';
  if (maturityDate) {
    const refRisk = assessRefinancingRisk(maturityDate, issuerDebtProfile);
    refinancingSummary = refRisk.summary;
  }

  // Ликвидность
  let liquiditySummary = '';
  if (turnover !== undefined) {
    const liquidity = assessLiquidity(turnover, quantity, currentPrice);
    liquiditySummary = liquidity.summary;
  }

  // Итоговое качество — если нет данных ни от одного источника
  if (quality === 'INSUFFICIENT_DATA') {
    quality = 'INSUFFICIENT_DATA';
  }

  return {
    quality,
    source: dataSource,
    asOfDate: financials?.reportingDate ?? rating?.asOfDate ?? null,
    financials: financials ? {
      revenue: financials.revenue,
      ebitda: financials.ebitda,
      netProfit: financials.netProfit,
      netDebt: financials.netDebt,
      netDebtToEbitda: financials.netDebtToEbitda,
      interestCoverage: financials.interestCoverage,
      freeCashFlow: financials.freeCashFlow,
    } : undefined,
    rating: rating ? {
      agency: rating.agency,
      rating: rating.rating,
      outlook: rating.outlook,
    } : undefined,
    summary: [
      financialSummary,
      refinancingSummary,
      liquiditySummary,
    ].filter(Boolean).join('. ') || 'Кредитный анализ недоступен.',
  };
}

/**
 * Преобразование рейтинга агентства в качественную оценку.
 */
function mapRatingToQuality(rating: string): CreditQuality {
  const upper = rating.toUpperCase();

  // Инвестиционный уровень
  if (upper.startsWith('AAA') || upper.startsWith('AA') || upper.startsWith('A')) {
    return 'HIGH';
  }

  // Ближе к спекулятивному
  if (upper.startsWith('BBB') || upper.startsWith('BB')) {
    return 'MEDIUM';
  }

  // Спекулятивный уровень
  if (upper.startsWith('B') || upper.startsWith('CCC')) {
    return 'LOW';
  }

  // Дефолт или близок к нему
  if (upper.includes('RD') || upper.includes('SD') || upper.includes('DEFAULT')) {
    return 'LOW';
  }

  // Неизвестный рейтинг
  return 'INSUFFICIENT_DATA';
}

/**
 * Преобразование ICBRR рейтинга МОEX в качественную оценку.
 *
 * ICBRR (Internal Credit Rating of MOEX):
 * AAA — высшее качество
 * AA — высокое качество
 * A — хорошее качество
 * BBB — среднее качество
 * BB — ниже среднего
 * B — низкое качество
 * C — высокий риск
 */
function icbrrToQuality(rating: string): CreditQuality {
  const upper = rating.trim().toUpperCase();

  if (upper.startsWith('AAA') || upper.startsWith('AA')) {
    return 'HIGH';
  }

  if (upper.startsWith('A') || upper.startsWith('BBB')) {
    return 'MEDIUM';
  }

  if (upper.startsWith('BB') || upper.startsWith('B')) {
    return 'LOW';
  }

  if (upper.startsWith('C') || upper.includes('D')) {
    return 'LOW';
  }

  return 'INSUFFICIENT_DATA';
}
