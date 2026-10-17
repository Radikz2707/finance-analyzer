/**
 * Shared price metrics — расчёт доходности, волатильности, Sharpe, MaxDD.
 *
 * Единая реализация для moex-api и finam-api (ранее дублировалась).
 *
 * @module shared/price-metrics
 */

import type { OHLCVBar } from '../data-fetcher/contracts.js';

/** Результат расчёта метрик цен */
export interface PriceMetrics {
  /** Общая доходность (close_n / close_0 - 1) */
  totalReturn: number;
  /** Годовая доходность (CAGR) */
  annualizedReturn: number;
  /** Годовая волатильность (std dev daily × sqrt(252)) */
  volatility: number;
  /** Коэффициент Шарпа (risk-free ~7%) */
  sharpeRatio: number;
  /** Максимальная просадка (peak-to-trough) */
  maxDrawdown: number;
  /** Win rate (доля прибыльных дней) */
  winRate: number;
  /** Лучший день (%) */
  bestDay: number;
  /** Худший день (%) */
  worstDay: number;
  /** Средний объём торгов */
  averageVolume: number;
}

/**
 * Рассчитать метрики на основе исторических свечей.
 *
 * @param bars — отсортированные по дате OHLCV-свечи (от старой к новой)
 * @returns объект метрик (нулевые значения при bars.length < 2)
 */
export function calculatePriceMetrics(bars: OHLCVBar[]): PriceMetrics {
  if (bars.length < 2) {
    return {
      totalReturn: 0,
      annualizedReturn: 0,
      volatility: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      winRate: 0,
      bestDay: 0,
      worstDay: 0,
      averageVolume: 0,
    };
  }

  // Доходности по дням
  const dailyReturns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const ret = (bars[i]!.close - bars[i - 1]!.close) / bars[i - 1]!.close;
    dailyReturns.push(ret);
  }

  // Общая доходность
  const totalReturn =
    (bars[bars.length - 1]!.close - bars[0]!.close) / bars[0]!.close;

  // Годовая доходность
  const days = bars.length;
  const years = days / 365;
  const annualizedReturn =
    years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

  // Волатильность (std dev daily returns)
  const meanReturn =
    dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) /
    dailyReturns.length;
  const dailyVolatility = Math.sqrt(variance);
  const annualizedVolatility = dailyVolatility * Math.sqrt(252);

  // Sharpe Ratio (безрисковая ставка ~7%)
  const riskFreeRate = 0.07;
  const sharpeRatio =
    annualizedVolatility > 0
      ? (annualizedReturn - riskFreeRate) / annualizedVolatility
      : 0;

  // Max Drawdown
  let peak = bars[0]!.close;
  let maxDrawdown = 0;
  for (const bar of bars) {
    if (bar.close > peak) {
      peak = bar.close;
    }
    const drawdown = (peak - bar.close) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // Win Rate (процент прибыльных дней)
  const winningDays = dailyReturns.filter((r) => r > 0).length;
  const winRate =
    dailyReturns.length > 0 ? winningDays / dailyReturns.length : 0;

  // Лучший/худший день
  const bestDay = dailyReturns.length > 0 ? Math.max(...dailyReturns) : 0;
  const worstDay = dailyReturns.length > 0 ? Math.min(...dailyReturns) : 0;

  // Средний объём
  const averageVolume =
    bars.reduce((sum, b) => sum + b.volume, 0) / bars.length;

  return {
    totalReturn,
    annualizedReturn,
    volatility: annualizedVolatility,
    sharpeRatio,
    maxDrawdown,
    winRate,
    bestDay,
    worstDay,
    averageVolume,
  };
}

/**
 * Сформировать строку метрик для Telegram-сообщения.
 */
export function formatMetrics(metrics: PriceMetrics): string {
  let text = '<b>📊 Метрики</b>\n\n';
  text += 'Доходность: ' + (metrics.totalReturn * 100).toFixed(2) + '%\n';
  text += 'Годовая: ' + (metrics.annualizedReturn * 100).toFixed(2) + '%\n';
  text += 'Волатильность: ' + (metrics.volatility * 100).toFixed(2) + '%\n';
  text += 'Sharpe: ' + metrics.sharpeRatio.toFixed(2) + '\n';
  text += 'Max Drawdown: ' + (metrics.maxDrawdown * 100).toFixed(2) + '%\n';
  text += 'Win Rate: ' + (metrics.winRate * 100).toFixed(1) + '%\n';
  text += 'Лучший день: ' + (metrics.bestDay * 100).toFixed(2) + '%\n';
  text += 'Худший день: ' + (metrics.worstDay * 100).toFixed(2) + '%\n';

  return text;
}
