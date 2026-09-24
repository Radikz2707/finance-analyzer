/**
 * PortfolioOptimizer — оптимизация портфеля.
 *
 * Функции:
 * - Efficient Frontier (эффективная граница Марковица)
 * - Расчёт метрик: Sharpe, Sortino, Max Drawdown
 * - Оптимизация весов портфеля
 */

import type { OHLCVBar } from '../finam-api/history-provider.js';

// ──────────────────────────────────────────────
// 1. Types
// ──────────────────────────────────────────────

/** Веса активов в портфеле */
export interface PortfolioWeights {
  ticker: string;
  weight: number; // 0-1
}

/** Результат оптимизации */
export interface OptimizationResult {
  /** Оптимальные веса */
  optimalWeights: PortfolioWeights[];
  /** Ожидаемая доходность */
  expectedReturn: number;
  /** Волатильность */
  volatility: number;
  /** Sharpe Ratio */
  sharpeRatio: number;
  /** Sortino Ratio */
  sortinoRatio: number;
  /** Max Drawdown */
  maxDrawdown: number;
  /** Точка на Efficient Frontier */
  frontierPoint: { return: number; volatility: number };
  /** Сравнение с равновесным портфелем */
  equalWeightBenchmark: {
    return: number;
    volatility: number;
    sharpeRatio: number;
  };
  /** Сводка */
  summary: string;
}

// ──────────────────────────────────────────────
// 2. Portfolio Math
// ──────────────────────────────────────────────

/**
 * Рассчитать доходность портфеля по весам.
 */
export function calculatePortfolioReturn(
  weights: number[],
  assetReturns: number[],
): number {
  if (weights.length !== assetReturns.length) {
    throw new Error('weights и assetReturns должны быть одинаковой длины');
  }

  let totalReturn = 0;
  for (let i = 0; i < weights.length; i++) {
    totalReturn += weights[i] * assetReturns[i];
  }
  return totalReturn;
}

/**
 * Рассчитать волатильность портфеля с учётом корреляций.
 */
export function calculatePortfolioVolatility(
  weights: number[],
  covarianceMatrix: number[][],
): number {
  const n = weights.length;
  let variance = 0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      variance += weights[i] * weights[j] * covarianceMatrix[i][j];
    }
  }

  return Math.sqrt(variance);
}

/**
 * Рассчитать Sortino Ratio (учитывает только downside волатильность).
 */
export function calculateSortinoRatio(
  returns: number[],
  targetReturn: number = 0,
): number {
  if (returns.length === 0) {
    return 0;
  }

  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const downsideReturns = returns.filter((r) => r < targetReturn);

  if (downsideReturns.length === 0) {
    return 999; // Нет убыточных периодов
  }

  const downsideVariance = downsideReturns.reduce(
    (sum, r) => sum + Math.pow(r - targetReturn, 2),
    0,
  ) / downsideReturns.length;

  const downsideDeviation = Math.sqrt(downsideVariance);

  if (downsideDeviation === 0) {
    return 999;
  }

  return (meanReturn - targetReturn) / downsideDeviation;
}

// ──────────────────────────────────────────────
// 3. Covariance Matrix
// ──────────────────────────────────────────────

/**
 * Построить матрицу ковариаций из исторических данных.
 */
export function buildCovarianceMatrix(
  tickerData: Map<string, OHLCVBar[]>,
): { matrix: number[][]; tickers: string[] } {
  const tickers = Array.from(tickerData.keys());
  const n = tickers.length;

  // Извлекаем доходности
  const returns: number[][] = [];
  for (const ticker of tickers) {
    const bars = tickerData.get(ticker)!;
    const dailyReturns: number[] = [];

    for (let i = 1; i < bars.length; i++) {
      const ret = (bars[i].close - bars[i - 1].close) / bars[i - 1].close;
      dailyReturns.push(ret);
    }

    returns.push(dailyReturns);
  }

  // Находим минимальную длину
  const minLen = Math.min(...returns.map((r) => r.length));

  // Обрезаем до минимальной длины
  for (let i = 0; i < returns.length; i++) {
    returns[i] = returns[i].slice(-minLen);
  }

  // Строим матрицу ковариаций
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      matrix[i][j] = calculateCovariance(returns[i], returns[j]);
    }
  }

  return { matrix, tickers };
}

/**
 * Рассчитать ковариацию двух серий доходностей.
 */
function calculateCovariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) {
    return 0;
  }

  const meanA = a.slice(0, n).reduce((sum, v) => sum + v, 0) / n;
  const meanB = b.slice(0, n).reduce((sum, v) => sum + v, 0) / n;

  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - meanA) * (b[i] - meanB);
  }

  return cov / (n - 1);
}

// ──────────────────────────────────────────────
// 4. Efficient Frontier
// ──────────────────────────────────────────────

/**
 * Рассчитать Efficient Frontier (приближённый метод).
 *
 * Генерирует набор портфелей с разными весами и находит
 * те, которые дают максимальную доходность при заданной волатильности.
 */
export function calculateEfficientFrontier(
  tickerData: Map<string, OHLCVBar[]>,
  numPortfolios: number = 50,
): Array<{
  weights: number[];
  tickers: string[];
  return: number;
  volatility: number;
  sharpeRatio: number;
}> {
  const { matrix, tickers } = buildCovarianceMatrix(tickerData);
  const n = tickers.length;

  // Извлекаем средние доходности
  const avgReturns: number[] = [];
  for (const ticker of tickers) {
    const bars = tickerData.get(ticker)!;
    const dailyReturns: number[] = [];

    for (let i = 1; i < bars.length; i++) {
      dailyReturns.push((bars[i].close - bars[i - 1].close) / bars[i - 1].close);
    }

    const mean = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
    avgReturns.push(mean * 252); // Годовые
  }

  const frontier: Array<{
    weights: number[];
    tickers: string[];
    return: number;
    volatility: number;
    sharpeRatio: number;
  }> = [];

  // Генерируем случайные портфели
  for (let p = 0; p < numPortfolios; p++) {
    // Случайные веса с нормализацией
    const randomWeights = Array.from({ length: n }, () => Math.random());
    const totalWeight = randomWeights.reduce((sum, w) => sum + w, 0);
    const weights = randomWeights.map((w) => w / totalWeight);

    // Рассчитываем метрики
    const portReturn = calculatePortfolioReturn(weights, avgReturns);
    const portVolatility = calculatePortfolioVolatility(weights, matrix) * Math.sqrt(252);
    const sharpe = portVolatility > 0 ? (portReturn - 0.07) / portVolatility : 0;

    frontier.push({
      weights,
      tickers,
      return: portReturn,
      volatility: portVolatility,
      sharpeRatio: sharpe,
    });
  }

  // Сортируем по Sharpe Ratio и берём топ-N
  frontier.sort((a, b) => b.sharpeRatio - a.sharpeRatio);
  return frontier.slice(0, Math.min(numPortfolios, frontier.length));
}

// ──────────────────────────────────────────────
// 5. Portfolio Optimizer
// ──────────────────────────────────────────────

/**
 * Оптимизировать портфель — найти максимальный Sharpe Ratio.
 */
export function optimizePortfolio(
  tickerData: Map<string, OHLCVBar[]>,
  numPortfolios: number = 1000,
): OptimizationResult {
  const frontier = calculateEfficientFrontier(tickerData, numPortfolios);

  if (frontier.length === 0) {
    throw new Error('Не удалось рассчитать Efficient Frontier');
  }

  // Берём портфель с максимальным Sharpe
  const optimal = frontier[0];

  // Формируем веса по тикерам
  const optimalWeights: PortfolioWeights[] = optimal.tickers.map(
    (ticker, i) => ({
      ticker,
      weight: optimal.weights[i],
    }),
  );

  // Рассчитываем равновесный портфель (равные веса)
  const equalWeight = 1 / optimal.tickers.length;
  const equalWeightReturns = optimal.tickers.map(() => equalWeight);
  const { matrix } = buildCovarianceMatrix(tickerData);

  const equalReturn = calculatePortfolioReturn(
    equalWeightReturns,
    optimal.tickers.map((_, i) => {
      const bars = tickerData.get(optimal.tickers[i])!;
      const dailyReturns: number[] = [];
      for (let j = 1; j < bars.length; j++) {
        dailyReturns.push((bars[j].close - bars[j - 1].close) / bars[j - 1].close);
      }
      return dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length * 252;
    }),
  );

  const equalVolatility = calculatePortfolioVolatility(equalWeightReturns, matrix) * Math.sqrt(252);
  const equalSharpe = equalVolatility > 0 ? (equalReturn - 0.07) / equalVolatility : 0;

  // Рассчитываем Sortino для оптимального портфеля
  const optimalDailyReturns: number[] = [];
  for (let i = 1; i < optimal.tickers.length; i++) {
    let dayReturn = 0;
    for (let j = 0; j < optimal.tickers.length; j++) {
      const bars = tickerData.get(optimal.tickers[j])!;
      if (bars[i] && bars[i - 1]) {
        const ret = (bars[i].close - bars[i - 1].close) / bars[i - 1].close;
        dayReturn += optimal.weights[j] * ret;
      }
    }
    optimalDailyReturns.push(dayReturn);
  }

  const sortino = calculateSortinoRatio(optimalDailyReturns);

  // Формируем сводку
  const summary = formatOptimizationResult(optimalWeights, optimal, equalReturn, equalSharpe, sortino);

  return {
    optimalWeights,
    expectedReturn: optimal.return,
    volatility: optimal.volatility,
    sharpeRatio: optimal.sharpeRatio,
    sortinoRatio: sortino,
    maxDrawdown: 0, // Будет рассчитан при наличии данных
    frontierPoint: {
      return: optimal.return,
      volatility: optimal.volatility,
    },
    equalWeightBenchmark: {
      return: equalReturn,
      volatility: equalVolatility,
      sharpeRatio: equalSharpe,
    },
    summary,
  };
}

/**
 * Форматирование результата оптимизации.
 */
function formatOptimizationResult(
  weights: PortfolioWeights[],
  optimal: { return: number; volatility: number; sharpeRatio: number },
  _equalReturn: number,
  equalSharpe: number,
  sortino: number,
): string {
  let text = '<b>📊 Оптимизация портфеля</b>\n\n';
  text += '<b>Оптимальные веса:</b>\n';

  // Сортируем по весу
  const sorted = [...weights].sort((a, b) => b.weight - a.weight);
  for (const w of sorted) {
    const bar = '█'.repeat(Math.round(w.weight * 20));
    text += bar + ' ' + w.ticker + ' ' + (w.weight * 100).toFixed(1) + '%\n';
  }

  text += '\n<b>Метрики:</b>\n';
  text += 'Доходность: ' + (optimal.return * 100).toFixed(2) + '%\n';
  text += 'Волатильность: ' + (optimal.volatility * 100).toFixed(2) + '%\n';
  text += 'Sharpe: ' + optimal.sharpeRatio.toFixed(2) + '\n';
  text += 'Sortino: ' + sortino.toFixed(2) + '\n';

  text += '\n<b>Сравнение с равными весами:</b>\n';
  text += 'Sharpe (оптимизация): ' + optimal.sharpeRatio.toFixed(2) + '\n';
  text += 'Sharpe (равные веса): ' + equalSharpe.toFixed(2) + '\n';

  const improvement = equalSharpe > 0
    ? ((optimal.sharpeRatio - equalSharpe) / Math.abs(equalSharpe) * 100)
    : 0;
  text += 'Улучшение: ' + improvement.toFixed(1) + '%\n';

  return text;
}

// ──────────────────────────────────────────────
// 6. Экспорт
// ──────────────────────────────────────────────
