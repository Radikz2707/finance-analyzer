/**
 * LTM-купоны облигаций: MOEX ISS coupon schedule.
 *
 * Назначение: автоматически заполнять купонную часть дохода для облигаций,
 * когда лист «Купоны» в Excel пуст или равен 0 ₽.
 *
 * Методика:
 * - для каждой из N облигаций запрашиваем /iss/securities/{SECID}/coupons.json;
 * - суммируем выплаты с датой в окне LTM (365 дней): qty × couponValue;
 * - флоатеры (SU29027RMFS8, RU000A109L49, RU000A10EVJ7): значение купона
 *   на прошедшие даты — оценка, помечаем «оценка, плавающий купон»;
 * - НДФЛ 13% вычитаем аналогично дивидендам;
 * - проверка: если бумага покупалась/продавалась в окне LTM (сверить с
 *   историей сделок) — учесть доли владения или пометить неточность;
 * - подпись на дашборде: «Купоны LTM (по графику, оценка)», НЕ «фактические»;
 * - сверка приёмки: сумма 39–48 тыс. ₽ чистыми; если сильно ниже — купоны
 *   потерялись при парсинге графика, показать [BOND_COUPON_LTM] по каждой
 *   бумаге: кол-во выплат × сумма = итого.
 */

import { PortfolioConfig } from '../../../config/portfolio-config.js';
import { fetchMoexCoupons } from '../../api/fundamentals/moex-iss-client.js';
import { parseCalendarDate } from '../../shared/date-utils.js';
import { append } from './diagnostic-log-collector.js';

/** Окно LTM для купонов: 365 дней. */
export const COUPON_LTM_WINDOW_DAYS = 365;

/** Итоговый статус подтверждения купонных данных. */
export type CouponLtmStatus = 'OK' | 'EMPTY' | 'UNAVAILABLE';

/** Источник купонных данных. */
export type CouponLtmSource = 'MOEX_ISS' | 'UNAVAILABLE';

export interface BondCouponLtmResult {
  /** Тикер/ISIN облигации. */
  ticker: string;
  /** Сумма LTM купонов на одну бумагу, ₽. null — нет подтверждённых выплат. */
  ltmPerBond: number | null;
  /** Сколько купонных выплат попало в окно. */
  count: number;
  /** Дата последней учтённой выплаты (YYYY-MM-DD) или null. */
  asOf: string | null;
  /** Источник подтверждённой суммы. */
  source: CouponLtmSource;
  /** Явный статус: OK / EMPTY / UNAVAILABLE. */
  status: CouponLtmStatus;
  /** true если хотя бы одна выплата — флоатер (оценка). */
  isFloaterEstimate: boolean;
  /** Диагностика — для сквозного аудита. */
  diagnostics: {
    /** Количество записей, возвращённых ISS. */
    issRecordsCount: number;
    /** Причина EMPTY/UNAVAILABLE. */
    reason?: string;
  };
}

/**
 * ЛTM-купоны для всего портфеля облигаций.
 */
export interface PortfolioCouponLtmResult {
  /** Общая сумма LTM купонов до НДФЛ, ₽. */
  totalGross: number;
  /** Общая сумма LTM купонов после НДФЛ 13%, ₽. */
  totalNet: number;
  /** Результаты по каждой облигации. */
  bonds: BondCouponLtmResult[];
  /** Статус: OK если хотя бы одна бумага подтверждена. */
  status: CouponLtmStatus;
  /** Предупреждения (неточности, оценки). */
  warnings: string[];
}

/** Вычесть дни из даты UTC. */
function minusDaysUtc(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

/** Нижняя граница окна LTM (UTC). */
export function couponLtmCutoff(now: Date = new Date()): Date {
  return minusDaysUtc(now, COUPON_LTM_WINDOW_DAYS);
}

/**
 * Сумма LTM купонов на одну бумагу по записям источника.
 *
 * Учитываются только рублёвые выплаты с корректной датой внутри
 * окна [now − 365 дней; now]. Дубли не суммируются дважды.
 */
export function computeLtmCoupons(
  records: Array<{
    eventDate: string | null;
    eventValue: number | null;
    couponValue: number | null;
    couponType: string | null;
  }>,
  now: Date = new Date(),
): {
  ltmPerBond: number | null;
  count: number;
  asOf: string | null;
  isFloaterEstimate: boolean;
} {
  if (records.length === 0) {
    return { ltmPerBond: null, count: 0, asOf: null, isFloaterEstimate: false };
  }

  const cutoffMs = couponLtmCutoff(now).getTime();
  const nowMs = now.getTime();

  let sum = 0;
  let count = 0;
  let asOf: string | null = null;
  let isFloaterEstimate = false;
  const seen = new Set<string>();

  for (const record of records) {
    if (!record.eventDate) continue;

    const date = parseCalendarDate(record.eventDate);
    if (!date) continue;
    const dateMs = date.getTime();
    if (dateMs < cutoffMs || dateMs > nowMs) continue;

    // Берем eventValue (фактическая выплата) или couponValue (плановый купон)
    const value = record.eventValue ?? record.couponValue;
    if (value === null || !Number.isFinite(value) || value <= 0) continue;

    const key = `${record.eventDate}|${value}`;
    if (seen.has(key)) continue;
    seen.add(key);

    sum += value;
    count += 1;
    if (!asOf || record.eventDate > asOf) {
      asOf = record.eventDate;
    }

    // Помечаем флоатеры — их купон на прошедшие даты является оценкой
    const ct = (record.couponType ?? '').toUpperCase();
    if (ct === 'FLOATER' || ct === 'MICROFIX') {
      isFloaterEstimate = true;
    }
  }

  if (count === 0) {
    return { ltmPerBond: null, count: 0, asOf: null, isFloaterEstimate: false };
  }

  return {
    ltmPerBond: Math.round(sum * 100) / 100,
    count,
    asOf,
    isFloaterEstimate,
  };
}

/**
 * Загрузить LTM-купоны по тикеру облигации.
 */
export async function fetchBondCouponLtm(
  ticker: string,
  quantity: number,
  now: Date = new Date(),
): Promise<BondCouponLtmResult> {
  const normalized = (ticker ?? '').trim().toUpperCase();
  if (!normalized) {
    return {
      ticker: normalized,
      ltmPerBond: null,
      count: 0,
      asOf: null,
      source: 'UNAVAILABLE',
      status: 'UNAVAILABLE',
      isFloaterEstimate: false,
      diagnostics: { issRecordsCount: 0, reason: 'пустой тикер' },
    };
  }

  let records: Array<{
    eventDate: string | null;
    eventValue: number | null;
    couponValue: number | null;
    couponType: string | null;
  }> | null = null;

  try {
    const raw = await fetchMoexCoupons(normalized);
    if (raw) {
      records = raw.map((r) => ({
        eventDate: r.eventDate,
        eventValue: r.eventValue,
        couponValue: r.couponValue,
        couponType: r.couponType,
      }));
    }
  } catch {
    records = null;
  }

  const issRecordsCount = records?.length ?? 0;

  if (!records || records.length === 0) {
    append(
      'BOND_COUPON_LTM',
      `ticker=${normalized} status=UNAVAILABLE source=MOEX_ISS reason=no_coupons_table issRecordsCount=${issRecordsCount}`,
    );
    return {
      ticker: normalized,
      ltmPerBond: null,
      count: 0,
      asOf: null,
      source: 'UNAVAILABLE',
      status: 'UNAVAILABLE',
      isFloaterEstimate: false,
      diagnostics: {
        issRecordsCount,
        reason: records === null ? 'endpoint недоступен' : 'нет выплат в окне',
      },
    };
  }

  const computed = computeLtmCoupons(records, now);

  const status: CouponLtmStatus = computed.ltmPerBond !== null ? 'OK' : 'EMPTY';

  append(
    'BOND_COUPON_LTM',
    `ticker=${normalized} status=${status} source=MOEX_ISS ltmPerBond=${computed.ltmPerBond ?? 'null'} qty=${quantity} gross=${computed.ltmPerBond !== null ? (computed.ltmPerBond * quantity).toFixed(2) : 'N/A'} count=${computed.count} asOf=${computed.asOf ?? 'n/a'} isFloater=${computed.isFloaterEstimate} issRecordsCount=${issRecordsCount}`,
  );

  return {
    ticker: normalized,
    ltmPerBond: computed.ltmPerBond,
    count: computed.count,
    asOf: computed.asOf,
    source: 'MOEX_ISS',
    status,
    isFloaterEstimate: computed.isFloaterEstimate,
    diagnostics: { issRecordsCount },
  };
}

/**
 * Рассчитать LTM-купоны для всего портфеля облигаций.
 */
export async function fetchPortfolioBondCouponsLtm(
  bonds: Array<{
    ticker: string;
    quantity: number;
  }>,
  now: Date = new Date(),
): Promise<PortfolioCouponLtmResult> {
  const results = await Promise.all(
    bonds.map((b) => fetchBondCouponLtm(b.ticker, b.quantity, now)),
  );

  let totalGross = 0;
  const ndflRate = PortfolioConfig.tax.dividendNdflRate;
  const warnings: string[] = [];

  // Сумма купонов на ПОЗИЦИЮ, а не на одну бумагу.
  // Раньше здесь складывался ltmPerBond без умножения на quantity,
  // из-за чего плитка купонов занижала доход в разы относительно
  // per-bond лога и якоря сценариев.
  for (let index = 0; index < results.length; index++) {
    const result = results[index]!;
    if (result.ltmPerBond !== null && result.ltmPerBond > 0) {
      const quantity = bonds[index]?.quantity ?? 1;
      totalGross += result.ltmPerBond * quantity;
    }

    if (result.isFloaterEstimate && result.status === 'OK') {
      warnings.push(
        `${result.ticker}: купон LTM — оценка (плавающий купон, ${result.count} выплат в окне)`,
      );
    }
    if (result.status === 'UNAVAILABLE') {
      warnings.push(
        `${result.ticker}: купоны LTM недоступны (MOEX ISS не ответил)`,
      );
    }
    if (result.status === 'EMPTY') {
      warnings.push(
        `${result.ticker}: нет купонных выплат в окне LTM (365 дней)`,
      );
    }
  }

  const totalNet = totalGross * (1 - ndflRate);
  const hasOk = results.some((r) => r.status === 'OK');
  const status: CouponLtmStatus = hasOk
    ? 'OK'
    : results.length > 0
      ? 'EMPTY'
      : 'UNAVAILABLE';

  append(
    'BOND_COUPON_LTM_SUMMARY',
    `gross=${totalGross.toFixed(2)} net=${totalNet.toFixed(2)} bonds=${results.length} ok=${results.filter((r) => r.status === 'OK').length} status=${status} ndflRate=${(ndflRate * 100).toFixed(0)}%`,
  );

  return {
    totalGross: Math.round(totalGross * 100) / 100,
    totalNet: Math.round(totalNet * 100) / 100,
    bonds: results,
    status,
    warnings,
  };
}
