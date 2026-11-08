/**
 * Price Metrics — расчёт метрик котировок.
 * Sharpe ratio, max drawdown, win rate, total return, volatility.
 */

/** Свеча OHLCV */
export interface OHLCVBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Метрики цены */
export interface PriceMetrics {
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  bestDay: number;
  worstDay: number;
  averageVolume: number;
}

/**
 * Рассчитать метрики из исторических свечей.
 */
export function calculatePriceMetrics(bars: OHLCVBar[]): PriceMetrics {
  if (!bars || bars.length < 2) {
    return {
      sharpeRatio: 0,
      maxDrawdown: 0,
      winRate: 0,
      totalReturn: 0,
      annualizedReturn: 0,
      volatility: 0,
      bestDay: 0,
      worstDay: 0,
      averageVolume: 0,
    };
  }

  // Рассчитаем daily returns
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1]!.close;
    const currClose = bars[i]!.close;
    returns.push((currClose - prevClose) / prevClose);
  }

  // Total return
  const firstPrice = bars[0]!.close;
  const lastPrice = bars[bars.length - 1]!.close;
  const totalReturn = (lastPrice - firstPrice) / firstPrice;

  // Annualized return
  const tradingDays = bars.length;
  const annualizedReturn =
    Math.pow(1 + totalReturn, 252 / tradingDays) - 1;

  // Volatility (annualized)
  const avgReturn =
    returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
    returns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(252);

  // Sharpe ratio
  const sharpeRatio =
    volatility > 0 ? (avgReturn / (volatility / Math.sqrt(252))) : 0;

  // Best/Worst day
  const bestDay = Math.max(...returns);
  const worstDay = Math.min(...returns);

  // Average volume
  const averageVolume =
    bars.reduce((sum, b) => sum + b.volume, 0) / bars.length;

  // Max drawdown
  let peak = bars[0]!.close;
  let maxDraw = 0;
  for (const bar of bars) {
    if (bar.close > peak) peak = bar.close;
    const drawdown = (peak - bar.close) / peak;
    if (drawdown > maxDraw) maxDraw = drawdown;
  }

  // Win rate
  const wins = returns.filter((r) => r > 0).length;
  const winRate = returns.length > 0 ? wins / returns.length : 0;

  return {
    sharpeRatio,
    maxDrawdown: maxDraw,
    winRate,
    totalReturn,
    annualizedReturn,
    volatility,
    bestDay,
    worstDay,
    averageVolume,
  };
}

/**
 * Форматирование метрик в читаемый текст.
 */
export function formatMetrics(metrics: PriceMetrics): string {
  return [
    `Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}`,
    `Max Drawdown: ${(metrics.maxDrawdown * 100).toFixed(2)}%`,
    `Win Rate: ${(metrics.winRate * 100).toFixed(1)}%`,
    `Total Return: ${(metrics.totalReturn * 100).toFixed(2)}%`,
    `Annualized Return: ${(metrics.annualizedReturn * 100).toFixed(2)}%`,
    `Volatility: ${(metrics.volatility * 100).toFixed(2)}%`,
    `Best Day: ${(metrics.bestDay * 100).toFixed(2)}%`,
    `Worst Day: ${(metrics.worstDay * 100).toFixed(2)}%`,
    `Avg Volume: ${metrics.averageVolume.toFixed(0)}`,
  ].join('\n');
}
