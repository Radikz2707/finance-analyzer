/**
 * Классификация дневного движения цены с учётом ликвидности.
 *
 * Зачем: движение −9,90% при обороте 1,7 млн ₽ — это шум низкой
 * ликвидности, а не рыночный сигнал. Отчёт не должен подавать его как
 * значимое событие.
 *
 * Принципы:
 * - порог движения и минимальный оборот — только из
 *   `PortfolioConfig.anomaly` (никаких чисел в коде);
 * - нет дневного изменения → `unknown`;
 * - движение есть, а оборот неизвестен → сигнал не подтверждён
 *   (`signal_unconfirmed`), а не «подтверждён»;
 * - функция чистая, без I/O.
 */

import { PortfolioConfig } from '../../../config/portfolio-config.js';

/** Входные данные по одному инструменту. */
export interface DailyMoveInput {
  ticker: string;
  /** Дневное изменение цены, % (может быть отрицательным). */
  dayChangePct: number | null;
  /** Дневной оборот, ₽; null — источник не дал. */
  turnoverRub: number | null;
}

/** Итог классификации. */
export type DailyMoveVerdict =
  | 'not_significant'
  | 'low_liquidity_noise'
  | 'signal'
  | 'signal_unconfirmed'
  | 'unknown';

/** Результат классификации одного инструмента. */
export interface DailyMoveAssessment {
  ticker: string;
  dayChangePct: number | null;
  turnoverRub: number | null;
  /** |изменение| >= порога из конфига. */
  isSignificantMove: boolean;
  /** Оборот ниже минимального порога из конфига. */
  isLowLiquidity: boolean;
  verdict: DailyMoveVerdict;
  message: string;
}

const CONFIG = PortfolioConfig.anomaly;

function formatPct(value: number): string {
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRub(value: number): string {
  return value.toLocaleString('ru-RU', {
    maximumFractionDigits: 0,
  });
}

/**
 * Оценить дневное движение: значимо ли оно и подтверждено ли ликвидностью.
 */
export function assessDailyMove(input: DailyMoveInput): DailyMoveAssessment {
  const ticker = input.ticker.trim().toUpperCase();
  const dayChangePct =
    input.dayChangePct !== null && Number.isFinite(input.dayChangePct)
      ? input.dayChangePct
      : null;
  const turnoverRub =
    input.turnoverRub !== null &&
    Number.isFinite(input.turnoverRub) &&
    input.turnoverRub > 0
      ? input.turnoverRub
      : null;

  if (dayChangePct === null) {
    return {
      ticker,
      dayChangePct: null,
      turnoverRub,
      isSignificantMove: false,
      isLowLiquidity: false,
      verdict: 'unknown',
      message: `${ticker}: дневное изменение недоступно`,
    };
  }

  const isSignificantMove = Math.abs(dayChangePct) >= CONFIG.dayChangePct;
  if (!isSignificantMove) {
    return {
      ticker,
      dayChangePct,
      turnoverRub,
      isSignificantMove: false,
      isLowLiquidity:
        turnoverRub !== null && turnoverRub < CONFIG.minTurnoverRub,
      verdict: 'not_significant',
      message:
        `${ticker}: ${formatPct(dayChangePct)}% — движение ниже порога ` +
        `${CONFIG.dayChangePct}%`,
    };
  }

  if (turnoverRub === null) {
    return {
      ticker,
      dayChangePct,
      turnoverRub: null,
      isSignificantMove: true,
      isLowLiquidity: false,
      verdict: 'signal_unconfirmed',
      message:
        `${ticker}: ${formatPct(dayChangePct)}% — оборот недоступен, ` +
        'сигнал не подтверждён ликвидностью',
    };
  }

  if (turnoverRub < CONFIG.minTurnoverRub) {
    return {
      ticker,
      dayChangePct,
      turnoverRub,
      isSignificantMove: true,
      isLowLiquidity: true,
      verdict: 'low_liquidity_noise',
      message:
        `${ticker}: ${formatPct(dayChangePct)}% при обороте ` +
        `${formatRub(turnoverRub)} ₽ (ниже ${formatRub(CONFIG.minTurnoverRub)} ₽) — ` +
        'движение на низкой ликвидности, не сигнал',
    };
  }

  return {
    ticker,
    dayChangePct,
    turnoverRub,
    isSignificantMove: true,
    isLowLiquidity: false,
    verdict: 'signal',
    message:
      `${ticker}: ${formatPct(dayChangePct)}% при обороте ` +
      `${formatRub(turnoverRub)} ₽ — значимое движение`,
  };
}

/** Оценить список инструментов. */
export function assessDailyMoves(
  inputs: readonly DailyMoveInput[],
): DailyMoveAssessment[] {
  return inputs.map((input) => assessDailyMove(input));
}
