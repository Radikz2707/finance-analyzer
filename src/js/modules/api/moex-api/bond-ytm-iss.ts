/**
 * Сверка доходности облигации: Excel-проекция против MOEX ISS.
 *
 * Зачем: карточка показывала одну доходность без цены и даты, из-за чего
 * расхождение «35,65% против 39,71%» выглядело ошибкой. На деле это две
 * корректные доходности при разных ценах и датах:
 *   Excel — 35,65% при цене 87,6% (13.11.2026);
 *   MOEX ISS — 39,71% при цене 84,28% (18.11.2026).
 *
 * Принципы:
 * - доходность всегда идёт вместе с ценой и датой среза (атрибуция);
 * - допуски — из `PortfolioConfig.bondYtm`;
 * - нет данных → «недоступно», не 0;
 * - функция чистая: сеть и Excel остаются у вызывающего кода.
 */

import { PortfolioConfig } from '../../../config/portfolio-config.js';
import type { MoexBondQuote } from './bond-api.js';

/** Excel-проекция доходности. */
export interface ExcelBondYield {
  /** Цена, % от номинала. */
  pricePct: number | null;
  /** Доходность к погашению, % годовых. */
  yieldPct: number | null;
  /** Дата котировки (ISO), если известна. */
  asOf: string | null;
}

/** Входные данные для сверки. */
export interface BondYtmInput {
  isin: string;
  /** Excel-проекция из листа «Облигации». */
  excel: ExcelBondYield | null;
  /** Котировка MOEX ISS (цена + доходность + asOf). */
  iss: MoexBondQuote | null;
}

/** Срез доходности с обязательной атрибуцией. */
export interface BondYieldPoint {
  pricePct: number | null;
  yieldPct: number | null;
  asOf: string | null;
  source: 'MOEX ISS' | 'EXCEL';
}

/** Результат сверки. */
export interface BondYtmComparison {
  isin: string;
  iss: BondYieldPoint | null;
  excel: BondYieldPoint | null;
  /** Расхождение цен, п.п. цены. */
  priceDiffPct: number | null;
  /** Расхождение доходностей, п.п. */
  yieldDiffPct: number | null;
  /**
   * true — цены практически совпадают, а доходности расходятся больше
   * допуска: источники противоречат друг другу.
   */
  conflict: boolean;
  /** Человекочитаемое объяснение с источниками и датами. */
  explanation: string;
}

const CONFIG = PortfolioConfig.bondYtm;

function isPositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function formatPct(value: number): string {
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return 'дата не указана';
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

function describePoint(point: BondYieldPoint): string {
  const price =
    point.pricePct !== null
      ? `${formatPct(point.pricePct)}%`
      : 'цена недоступна';
  const yieldValue =
    point.yieldPct !== null
      ? `${formatPct(point.yieldPct)}%`
      : 'доходность недоступна';
  return `${yieldValue} при цене ${price} (${point.source}, ${formatDate(point.asOf)})`;
}

/**
 * Сверить Excel-проекцию и котировку MOEX ISS.
 *
 * YTM берётся из `iss.yieldPct` — MOEX считает её по своей цене. Excel-строка
 * остаётся рядом как проекция на дату Excel; она не «перезаписывается»
 * значением ISS.
 */
export function compareBondYtm(input: BondYtmInput): BondYtmComparison {
  const isin = input.isin.trim().toUpperCase();

  const iss: BondYieldPoint | null =
    input.iss &&
    (isPositive(input.iss.pricePct) || isPositive(input.iss.yieldPct))
      ? {
          pricePct: isPositive(input.iss.pricePct) ? input.iss.pricePct : null,
          yieldPct: isPositive(input.iss.yieldPct) ? input.iss.yieldPct : null,
          asOf: input.iss.asOf ?? null,
          source: 'MOEX ISS',
        }
      : null;

  const excel: BondYieldPoint | null =
    input.excel &&
    (isPositive(input.excel.pricePct) || isPositive(input.excel.yieldPct))
      ? {
          pricePct: isPositive(input.excel.pricePct)
            ? input.excel.pricePct
            : null,
          yieldPct: isPositive(input.excel.yieldPct)
            ? input.excel.yieldPct
            : null,
          asOf: input.excel.asOf ?? null,
          source: 'EXCEL',
        }
      : null;

  const priceDiffPct =
    iss?.pricePct != null && excel?.pricePct != null
      ? Math.abs(iss.pricePct - excel.pricePct)
      : null;
  const yieldDiffPct =
    iss?.yieldPct != null && excel?.yieldPct != null
      ? Math.abs(iss.yieldPct - excel.yieldPct)
      : null;

  const conflict =
    priceDiffPct !== null &&
    yieldDiffPct !== null &&
    priceDiffPct <= CONFIG.priceTolerancePct &&
    yieldDiffPct > CONFIG.yieldTolerancePct;

  let explanation: string;
  if (iss && excel) {
    if (conflict) {
      explanation =
        `Противоречие источников: ${describePoint(excel)} и ${describePoint(iss)} — ` +
        'при практически одинаковой цене доходности расходятся больше допуска.';
    } else if (
      priceDiffPct !== null &&
      priceDiffPct > CONFIG.priceTolerancePct
    ) {
      explanation =
        `${describePoint(iss)}; ${describePoint(excel)}. ` +
        'Разные доходности объясняются разными ценами и датами — оба значения корректны при своих ценах.';
    } else {
      explanation =
        `${describePoint(iss)}; ${describePoint(excel)}. ` +
        'Источники согласованы в пределах допуска.';
    }
  } else if (iss) {
    explanation = `${describePoint(iss)}. Excel-проекция недоступна, используется доходность MOEX ISS.`;
  } else if (excel) {
    explanation = `${describePoint(excel)}. Котировка MOEX ISS недоступна, используется Excel-проекция.`;
  } else {
    explanation =
      'Доходность недоступна: нет ни котировки MOEX ISS, ни Excel-проекции.';
  }

  return {
    isin,
    iss,
    excel,
    priceDiffPct,
    yieldDiffPct,
    conflict,
    explanation,
  };
}
