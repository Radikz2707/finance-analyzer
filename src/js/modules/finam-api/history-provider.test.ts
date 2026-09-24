import { describe, it, expect } from 'vitest';
import { calculatePriceMetrics, formatMetrics } from './history-provider.js';
import type { OHLCVBar } from './history-provider.js';

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function createBars(count: number, startPrice: number, volatility: number = 0.02): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 2 * volatility;
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

// ═══════════════════════════════════════════════
// 1. calculatePriceMetrics
// ═══════════════════════════════════════════════

describe('calculatePriceMetrics', () => {
  it('должен вернуть нули для пустых данных', () => {
    const metrics = calculatePriceMetrics([]);
    expect(metrics.totalReturn).toBe(0);
    expect(metrics.sharpeRatio).toBe(0);
    expect(metrics.maxDrawdown).toBe(0);
    expect(metrics.winRate).toBe(0);
  });

  it('должен рассчитать метрики для растущего портфеля', () => {
    const bars: OHLCVBar[] = [
      { date: '2025-09-01', open: 100, high: 102, low: 99, close: 101, volume: 1000 },
      { date: '2025-09-02', open: 101, high: 103, low: 100, close: 102, volume: 1100 },
      { date: '2025-09-03', open: 102, high: 104, low: 101, close: 103, volume: 1200 },
      { date: '2025-09-04', open: 103, high: 105, low: 102, close: 104, volume: 1300 },
      { date: '2025-09-05', open: 104, high: 106, low: 103, close: 105, volume: 1400 },
    ];

    const metrics = calculatePriceMetrics(bars);

    expect(metrics.totalReturn).toBeGreaterThan(0);
    expect(metrics.annualizedReturn).toBeGreaterThan(0);
    expect(metrics.volatility).toBeGreaterThanOrEqual(0);
    expect(metrics.bestDay).toBeGreaterThan(0);
    // worstDay может быть 0 если все дни положительные
    expect(metrics.worstDay).toBeGreaterThanOrEqual(0);
    expect(metrics.averageVolume).toBeGreaterThan(0);
  });

  it('должен рассчитать метрики для падающего портфеля', () => {
    const bars: OHLCVBar[] = [
      { date: '2025-09-01', open: 100, high: 101, low: 99, close: 99, volume: 1000 },
      { date: '2025-09-02', open: 99, high: 100, low: 98, close: 98, volume: 1100 },
      { date: '2025-09-03', open: 98, high: 99, low: 97, close: 97, volume: 1200 },
      { date: '2025-09-04', open: 97, high: 98, low: 96, close: 96, volume: 1300 },
      { date: '2025-09-05', open: 96, high: 97, low: 95, close: 95, volume: 1400 },
    ];

    const metrics = calculatePriceMetrics(bars);

    expect(metrics.totalReturn).toBeLessThan(0);
    expect(metrics.annualizedReturn).toBeLessThan(0);
  });

  it('должен рассчитать Max Drawdown', () => {
    const bars: OHLCVBar[] = [
      { date: '2025-09-01', open: 100, high: 100, low: 100, close: 100, volume: 1000 },
      { date: '2025-09-02', open: 100, high: 100, low: 100, close: 100, volume: 1000 },
      { date: '2025-09-03', open: 100, high: 100, low: 80, close: 80, volume: 1000 },
      { date: '2025-09-04', open: 80, high: 80, low: 80, close: 80, volume: 1000 },
      { date: '2025-09-05', open: 80, high: 80, low: 80, close: 80, volume: 1000 },
    ];

    const metrics = calculatePriceMetrics(bars);

    // Max Drawdown должен быть ~20% (от 100 до 80)
    expect(metrics.maxDrawdown).toBeGreaterThanOrEqual(0.19);
    expect(metrics.maxDrawdown).toBeLessThanOrEqual(0.21);
  });

  it('должен рассчитать Win Rate', () => {
    const bars: OHLCVBar[] = [
      { date: '2025-09-01', open: 100, high: 102, low: 99, close: 101, volume: 1000 },
      { date: '2025-09-02', open: 101, high: 103, low: 100, close: 100, volume: 1100 },
      { date: '2025-09-03', open: 100, high: 102, low: 99, close: 101, volume: 1200 },
      { date: '2025-09-04', open: 101, high: 103, low: 100, close: 100, volume: 1300 },
      { date: '2025-09-05', open: 100, high: 102, low: 99, close: 101, volume: 1400 },
    ];

    const metrics = calculatePriceMetrics(bars);

    // Win Rate должен быть ~50% (2 из 4 дней положительные)
    expect(metrics.winRate).toBeGreaterThanOrEqual(0.4);
    expect(metrics.winRate).toBeLessThanOrEqual(0.6);
  });
});

// ═══════════════════════════════════════════════
// 2. formatMetrics
// ═══════════════════════════════════════════════

describe('formatMetrics', () => {
  it('должен отформатировать метрики в строку', () => {
    const metrics = calculatePriceMetrics(createBars(10, 100));
    const formatted = formatMetrics(metrics);

    expect(formatted).toContain('Доходность:');
    expect(formatted).toContain('Sharpe:');
    expect(formatted).toContain('Max Drawdown:');
    expect(formatted).toContain('Win Rate:');
  });
});
