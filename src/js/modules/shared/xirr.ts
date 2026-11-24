/**
 * Расчёт XIRR (Extended Internal Rate of Return) по потоку денежных средств.
 *
 * Алгоритм: бисекция в диапазоне [-100%, +1000%], проверка NPV ≤ 1 ₽.
 * Поддерживает два расчёта: полный портфель и без PLZL.
 */

export interface XirrCashFlow {
  date: Date;
  amount: number;
}

export interface XirrResult {
  rate: number | null;
  reason: string;
  cashFlows: XirrCashFlow[];
  npv: number;
  /** true если выводы имеют даты в источнике, false если агрегированы */
  withdrawalsHaveDates?: boolean;
  withoutPlzl?: XirrResult;
}

/**
 * Вычислить NPV потока при заданной ставке.
 * NPV = Σ CF_i / (1 + rate)^(days_i / 365)
 */
function npv(rate: number, flows: XirrCashFlow[], baseDate: Date): number {
  let sum = 0;
  for (const f of flows) {
    const days = (f.date.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24);
    const exponent = days / 365;
    sum += f.amount / Math.pow(1 + rate, exponent);
  }
  return sum;
}

/**
 * Бисекция для поиска XIRR.
 * Диапазон: [-0.99, 10] (-99% ... +1000%).
 * Точность: 1e-8 (≈ 0.000001%).
 */
function bisectXirr(
  flows: XirrCashFlow[],
  baseDate: Date,
  low: number = -0.99,
  high: number = 10,
  _tolerance: number = 1e-8,
  maxIter: number = 200,
): { rate: number | null; npv: number; reason: string } {
  // Нужно минимум 2 точки
  if (flows.length < 2) {
    return { rate: null, npv: 0, reason: 'Менее 2 точек в потоке' };
  }

  // Проверяем знаки: должны быть и положительные, и отрицательные CF
  const hasPositive = flows.some((f) => f.amount > 0);
  const hasNegative = flows.some((f) => f.amount < 0);
  if (!hasPositive || !hasNegative) {
    return { rate: null, npv: 0, reason: 'Все CF одного знака' };
  }

  for (let i = 0; i < maxIter; i++) {
    const mid = (low + high) / 2;
    const npvMid = npv(mid, flows, baseDate);

    if (Math.abs(npvMid) < 1) {
      return { rate: mid, npv: npvMid, reason: '' };
    }

    // Проверяем знаки NPV на границах
    const npvLow = npv(low, flows, baseDate);
    if (npvMid > 0) {
      if (npvLow > 0) {
        low = mid;
      } else {
        high = mid;
      }
    } else {
      if (npvLow < 0) {
        low = mid;
      } else {
        high = mid;
      }
    }
  }

  // Если не сошлось — возвращаем лучшую оценку
  const bestRate = (low + high) / 2;
  return {
    rate: bestRate,
    npv: npv(bestRate, flows, baseDate),
    reason: 'Не сошлось за 200 итераций',
  };
}

/**
 * Построить поток CF для XIRR полного портфеля.
 * - Каждый взнос: положительный CF на дату взноса
 * - Выводы: отрицательный CF на дату последней записи (без дат — в конец)
 * - Финальная точка: отрицательный CF = -(рыночная + кэш) на сегодня
 */
export function buildCashFlowsForXirr(
  allDeposits: Array<{ value: number; date: Date }>,
  totalWithdrawals: number,
  marketValue: number,
  cash: number,
  today: Date,
): XirrCashFlow[] {
  const flows: XirrCashFlow[] = [];

  // Взносы — положительные CF
  for (const d of allDeposits) {
    flows.push({ date: d.date, amount: d.value });
  }

  // Выводы — отрицательный CF (без дат, ставим в конец)
  if (totalWithdrawals > 0) {
    flows.push({ date: today, amount: -totalWithdrawals });
  }

  // Финальная точка: «продажа» всего портфеля по текущей цене
  const finalValue = -(marketValue + cash);
  flows.push({ date: today, amount: finalValue });

  return flows;
}

/**
 * Построить поток CF для XIRR без PLZL.
 *
 * Правильный метод: удаляем покупки PLZL из потока CF по датам
 * И удаляем текущую стоимость PLZL из финальной точки.
 * Проверка корректности: XIRR_без_PLZL > XIRR_полный (строго),
 * т.к. PLZL — крупнейший источник убытка.
 *
 * @param plzlPurchaseFlows — покупки PLZL из allDeposits (даты + суммы)
 * @param plzlCurrentMarketValue — текущая рыночная стоимость PLZL
 */
export function buildCashFlowsWithoutPlzl(
  allDeposits: Array<{ value: number; date: Date }>,
  plzlPurchaseFlows: Array<{ value: number; date: Date }>,
  totalWithdrawals: number,
  marketValueWithoutPlzl: number,
  cash: number,
  today: Date,
): XirrCashFlow[] {
  const flows: XirrCashFlow[] = [];

  // Взносы БЕЗ покупок PLZL
  for (const d of allDeposits) {
    // Исключаем покупки PLZL по датам
    const isPlzl = plzlPurchaseFlows.some(
      (p) =>
        p.date.getTime() === d.date.getTime() &&
        Math.abs(p.value - d.value) < 0.01,
    );
    if (!isPlzl) {
      flows.push({ date: d.date, amount: d.value });
    }
  }

  // Выводы — отрицательный CF (без дат, ставим в конец)
  if (totalWithdrawals > 0) {
    flows.push({ date: today, amount: -totalWithdrawals });
  }

  // Финальная точка: «продажа» всего портфеля БЕЗ PLZL по текущей цене
  const finalValue = -(marketValueWithoutPlzl + cash);
  flows.push({ date: today, amount: finalValue });

  return flows;
}

/**
 * Рассчитать XIRR для полного портфеля.
 *
 * Дополнительно рассчитывает XIRR без PLZL, если переданы данные:
 * - plzlPurchaseFlows: покупки PLZL из allDeposits (даты + суммы)
 * - plzlCurrentMarketValue: текущая рыночная стоимость PLZL
 *
 * Проверка корректности: XIRR_без_PLZL > XIRR_полный (строго).
 * Если проверка не проходит — withoutPlzl не выводится.
 */
export function calculateXirr(
  allDeposits: Array<{ value: number; date: Date }>,
  totalWithdrawals: number,
  marketValue: number,
  cash: number,
  today: Date,
  /** Опционально: покупки PLZL для расчёта XIRR без PLZL */
  plzlPurchaseFlows?: Array<{ value: number; date: Date }>,
  /** Опционально: текущая рыночная стоимость PLZL */
  plzlCurrentMarketValue?: number,
  /** Опционально: true если выводы имеют даты в источнике */
  withdrawalsHaveDates?: boolean,
): XirrResult {
  const flows = buildCashFlowsForXirr(
    allDeposits,
    totalWithdrawals,
    marketValue,
    cash,
    today,
  );

  const { rate, npv, reason } = bisectXirr(flows, today);

  const result: XirrResult = {
    rate: rate !== null ? rate * 100 : null,
    reason: reason || `${flows.length} точек, NPV=${npv.toFixed(2)} ₽`,
    cashFlows: flows,
    npv,
    withdrawalsHaveDates: withdrawalsHaveDates ?? false,
  };

  // ─── XIRR без PLZL ───
  if (
    plzlPurchaseFlows &&
    plzlPurchaseFlows.length > 0 &&
    plzlCurrentMarketValue !== undefined &&
    plzlCurrentMarketValue > 0
  ) {
    const marketValueWithoutPlzl = marketValue - plzlCurrentMarketValue;

    if (marketValueWithoutPlzl > 0) {
      const flowsWithoutPlzl = buildCashFlowsWithoutPlzl(
        allDeposits,
        plzlPurchaseFlows,
        totalWithdrawals,
        marketValueWithoutPlzl,
        cash,
        today,
      );

      const { rate: rateWithoutPlzl, npv: npvWithoutPlzl, reason: reasonWithoutPlzl } =
        bisectXirr(flowsWithoutPlzl, today);

      const xirrWithoutPlzl = {
        rate: rateWithoutPlzl !== null ? rateWithoutPlzl * 100 : null,
        reason:
          reasonWithoutPlzl ||
          `${flowsWithoutPlzl.length} точек, NPV=${npvWithoutPlzl.toFixed(2)} ₽`,
        cashFlows: flowsWithoutPlzl,
        npv: npvWithoutPlzl,
      };

      // Проверка корректности: XIRR_без_PLZL > XIRR_полный
      // PLZL — крупнейший источник убытка, поэтому исключение должно
      // улучшать доходность
      if (
        xirrWithoutPlzl.rate !== null &&
        result.rate !== null &&
        xirrWithoutPlzl.rate > result.rate
      ) {
        result.withoutPlzl = xirrWithoutPlzl;
      } else {
        // Метод не дал ожидаемого результата — не выводим ложную цифру
        console.warn(
          `[XIRR] Без PLZL: ${xirrWithoutPlzl.rate?.toFixed(2) ?? 'н/д'}% ` +
            `не > полный ${result.rate?.toFixed(2) ?? 'н/д'}% — не выводим`,
        );
      }
    }
  }

  return result;
}
