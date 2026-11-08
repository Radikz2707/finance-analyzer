// TЗ: Тесты для benchmark-calculator
import {
  calculateReturnPct,
  calculateDepositReturn,
  determineVerdict,
  formatBenchmarkSummary,
} from './benchmark-calculator.js';

describe('Benchmark Calculator — расчёт бенчмарков', () => {
  // ─── calculateReturnPct ───
  it('должен рассчитать доходность между двумя ценами', () => {
    const prices = [
      { close: 100 },
      { close: 110 },
      { close: 105 },
    ];
    expect(calculateReturnPct(prices)).toBeCloseTo(5, 1);
  });

  it('должен вернуть 0 при одной цене', () => {
    expect(calculateReturnPct([{ close: 50 }])).toBe(0);
  });

  it('должен вернуть 0 при первой цене 0', () => {
    expect(calculateReturnPct([{ close: 0 }, { close: 100 }])).toBe(0);
  });

  it('должен рассчитать отрицательную доходность', () => {
    const prices = [{ close: 200 }, { close: 150 }];
    expect(calculateReturnPct(prices)).toBeCloseTo(-25, 1);
  });

  // ─── calculateDepositReturn ───
  it('должен рассчитать доходность депозита за год', () => {
    // 14% годовых за 365 дней = 14%
    expect(calculateDepositReturn(14, 365)).toBeCloseTo(14, 1);
  });

  it('должен рассчитать доходность депозита за полгода', () => {
    // 14% годовых за 182 дня ≈ 7%
    expect(calculateDepositReturn(14, 182)).toBeCloseTo(6.99, 1);
  });

  it('должен вернуть 0 при 0 днях', () => {
    expect(calculateDepositReturn(14, 0)).toBe(0);
  });

  it('должен вернуть 0 при отрицательных днях', () => {
    expect(calculateDepositReturn(14, -10)).toBe(0);
  });

  // ─── determineVerdict ───
  it('должен вернуть BEAT_MARKET когда портфель лучше обоих', () => {
    expect(determineVerdict(20, 15, 10)).toBe('BEAT_MARKET');
  });

  it('должен вернуть BEAT_DEPOSIT когда лучше депозита, но хуже рынка', () => {
    expect(determineVerdict(12, 15, 5)).toBe('BEAT_DEPOSIT');
  });

  it('должен вернуть UNDERPERFORM когда хуже обоих', () => {
    expect(determineVerdict(3, 15, 10)).toBe('UNDERPERFORM');
  });

  // ─── formatBenchmarkSummary ───
  it('должен использовать реальную ставку депозита в тексте', () => {
    const result = {
      portfolioReturnPct: 10,
      period: 'тест',
      imoexReturnPct: 8,
      imoexrReturnPct: 12,
      depositReturnPct: 7,
      bondBenchmarkYield: 12.5,
      imoexAlpha: 2,
      depositAlpha: 3,
      bondAlpha: 7.5,
      verdict: 'BEAT_MARKET' as const,
      summaryText: '',
    };
    const text = formatBenchmarkSummary(result, 16);
    expect(text).toContain('16% годовых');
    expect(text).toContain('Облигации');
    expect(text).not.toContain('14% годовых');
  });

  it('должен показать положительную разницу с плюсом', () => {
    const result = {
      portfolioReturnPct: 20,
      period: 'тест',
      imoexReturnPct: 10,
      imoexrReturnPct: 15,
      depositReturnPct: 7,
      bondBenchmarkYield: 11,
      imoexAlpha: 10,
      depositAlpha: 13,
      bondAlpha: 9,
      verdict: 'BEAT_MARKET' as const,
      summaryText: '',
    };
    const text = formatBenchmarkSummary(result, 14);
    expect(text).toContain('+10.0 п.п.');
    expect(text).toContain('+13.0 п.п.');
  });

  it('должен показать отрицательную разницу без плюса', () => {
    const result = {
      portfolioReturnPct: 5,
      period: 'тест',
      imoexReturnPct: 15,
      imoexrReturnPct: 12,
      depositReturnPct: 10,
      bondBenchmarkYield: 13,
      imoexAlpha: -10,
      depositAlpha: -5,
      bondAlpha: -8,
      verdict: 'UNDERPERFORM' as const,
      summaryText: '',
    };
    const text = formatBenchmarkSummary(result, 14);
    expect(text).toContain('-10.0 п.п.');
    expect(text).toContain('-5.0 п.п.');
  });
});
