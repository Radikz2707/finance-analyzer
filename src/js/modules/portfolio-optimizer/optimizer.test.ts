import { describe, it, expect } from 'vitest';
import {
  calculatePortfolioReturn,
  calculatePortfolioVolatility,
  calculateSortinoRatio,
  buildCovarianceMatrix,
  optimizePortfolio,
} from './optimizer.js';
import type { OHLCVBar } from '../finam-api/history-provider.js';

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function createMockBars(_ticker: string, count: number, startPrice: number): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 0.04;
    price = price * (1 + change);

    bars.push({
      date: `2025-09-${String(i + 1).padStart(2, '0')}`,
      open: price,
      high: price * (1 + Math.random() * 0.01),
      low: price * (1 - Math.random() * 0.01),
      close: price,
      volume: Math.floor(Math.random() * 1000000),
    });
  }

  return bars;
}

function createMockData(tickers: string[], startPrices: number[]): Map<string, OHLCVBar[]> {
  const data = new Map<string, OHLCVBar[]>();
  for (let i = 0; i < tickers.length; i++) {
    data.set(tickers[i], createMockBars(tickers[i], 60, startPrices[i]));
  }
  return data;
}

// ═══════════════════════════════════════════════
// 1. calculatePortfolioReturn
// ═══════════════════════════════════════════════

describe('calculatePortfolioReturn', () => {
  it('должен рассчитать средневзвешенную доходность', () => {
    const weights = [0.6, 0.4];
    const returns = [0.1, 0.2];

    const result = calculatePortfolioReturn(weights, returns);
    expect(result).toBeCloseTo(0.14, 4); // 0.6*0.1 + 0.4*0.2 = 0.14
  });

  it('должен выбросить ошибку при разной длине массивов', () => {
    expect(() => calculatePortfolioReturn([0.5], [0.1, 0.2])).toThrow();
  });
});

// ═══════════════════════════════════════════════
// 2. calculatePortfolioVolatility
// ═══════════════════════════════════════════════

describe('calculatePortfolioVolatility', () => {
  it('должен рассчитать волатильность портфеля', () => {
    const weights = [0.5, 0.5];
    const covarianceMatrix = [
      [0.04, 0.01],
      [0.01, 0.09],
    ];

    const result = calculatePortfolioVolatility(weights, covarianceMatrix);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('должен рассчитать волатильность для одноактивного портфеля', () => {
    const weights = [1];
    const covarianceMatrix = [[0.04]];

    const result = calculatePortfolioVolatility(weights, covarianceMatrix);
    expect(result).toBeCloseTo(0.2, 4); // sqrt(0.04) = 0.2
  });
});

// ═══════════════════════════════════════════════
// 3. calculateSortinoRatio
// ═══════════════════════════════════════════════

describe('calculateSortinoRatio', () => {
  it('должен рассчитать Sortino Ratio', () => {
    const returns = [0.01, -0.02, 0.03, -0.01, 0.02];
    const sortino = calculateSortinoRatio(returns);
    expect(typeof sortino).toBe('number');
  });

  it('должен вернуть 0 для пустого массива', () => {
    const sortino = calculateSortinoRatio([]);
    expect(sortino).toBe(0);
  });

  it('должен вернуть 999 при отсутствии убыточных дней', () => {
    const returns = [0.01, 0.02, 0.03, 0.04, 0.05];
    const sortino = calculateSortinoRatio(returns);
    expect(sortino).toBe(999);
  });
});

// ═══════════════════════════════════════════════
// 4. buildCovarianceMatrix
// ═══════════════════════════════════════════════

describe('buildCovarianceMatrix', () => {
  it('должен построить матрицу ковариаций для 2 активов', () => {
    const data = createMockData(['SBER', 'GAZP'], [280, 160]);
    const result = buildCovarianceMatrix(data);

    expect(result.tickers).toHaveLength(2);
    expect(result.matrix).toHaveLength(2);
    expect(result.matrix[0]).toHaveLength(2);
    expect(result.matrix[1]).toHaveLength(2);

    // Матрица ковариаций симметрична
    expect(result.matrix[0][1]).toBeCloseTo(result.matrix[1][0], 6);
  });
});

// ═══════════════════════════════════════════════
// 5. optimizePortfolio
// ═══════════════════════════════════════════════

describe('optimizePortfolio', () => {
  it('должен оптимизировать портфель из 3 активов', () => {
    const data = createMockData(['SBER', 'GAZP', 'LKOH'], [280, 160, 7000]);
    const result = optimizePortfolio(data, 500);

    expect(result.optimalWeights).toHaveLength(3);
    expect(result.expectedReturn).toBeDefined();
    expect(result.volatility).toBeGreaterThan(0);
    expect(result.sharpeRatio).toBeDefined();
    expect(result.sortinoRatio).toBeDefined();
    expect(result.equalWeightBenchmark.sharpeRatio).toBeDefined();
    expect(result.summary).toContain('Оптимизация');
  });

  it('должен выбрать веса, суммирующиеся до 1', () => {
    const data = createMockData(['SBER', 'GAZP', 'LKOH', 'MGNT'], [280, 160, 7000, 180]);
    const result = optimizePortfolio(data, 500);

    const totalWeight = result.optimalWeights.reduce((sum, w) => sum + w.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 2);
  });
});
