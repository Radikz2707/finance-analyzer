import { PortfolioConfig } from '../../../config/portfolio-config.js';
import { assessDailyMove, assessDailyMoves } from './daily-move.js';

function normalize(value: string): string {
  return value.replace(/\u00a0/g, ' ');
}

describe('assessDailyMove — движение на низкой ликвидности', () => {
  it('ЕвроТранс −9,90% при обороте 1,7 млн ₽ — не сигнал', () => {
    const result = assessDailyMove({
      ticker: 'ETRN',
      dayChangePct: -9.9,
      turnoverRub: 1_700_000,
    });

    expect(result.isSignificantMove).toBe(true);
    expect(result.isLowLiquidity).toBe(true);
    expect(result.verdict).toBe('low_liquidity_noise');
    const message = normalize(result.message);
    expect(message).toContain('-9,90%');
    expect(message).toContain('1 700 000');
    expect(message).toContain('движение на низкой ликвидности, не сигнал');
  });

  it('то же движение при достаточном обороте — сигнал', () => {
    const result = assessDailyMove({
      ticker: 'ETRN',
      dayChangePct: -9.9,
      turnoverRub: 50_000_000,
    });

    expect(result.verdict).toBe('signal');
    expect(result.isLowLiquidity).toBe(false);
    expect(normalize(result.message)).toContain('значимое движение');
  });

  it('движение ниже порога не считается сигналом', () => {
    const result = assessDailyMove({
      ticker: 'SBER',
      dayChangePct: -2,
      turnoverRub: 100_000_000,
    });

    expect(result.isSignificantMove).toBe(false);
    expect(result.verdict).toBe('not_significant');
    expect(normalize(result.message)).toContain(
      `ниже порога ${PortfolioConfig.anomaly.dayChangePct}%`,
    );
  });

  it('ровно на пороге движение и оборот считаются значимыми', () => {
    const result = assessDailyMove({
      ticker: 'SBER',
      dayChangePct: PortfolioConfig.anomaly.dayChangePct,
      turnoverRub: PortfolioConfig.anomaly.minTurnoverRub,
    });

    expect(result.verdict).toBe('signal');
  });

  it('без дневного изменения — unknown', () => {
    const result = assessDailyMove({
      ticker: 'SBER',
      dayChangePct: null,
      turnoverRub: 10_000_000,
    });

    expect(result.verdict).toBe('unknown');
    expect(result.message).toContain('дневное изменение недоступно');
  });

  it('без оборота сигнал не подтверждается (fail-closed)', () => {
    const result = assessDailyMove({
      ticker: 'SBER',
      dayChangePct: -7,
      turnoverRub: null,
    });

    expect(result.isSignificantMove).toBe(true);
    expect(result.verdict).toBe('signal_unconfirmed');
    expect(result.message).toContain('оборот недоступен');
  });

  it('нулевой оборот трактуется как отсутствие данных', () => {
    const result = assessDailyMove({
      ticker: 'SBER',
      dayChangePct: -7,
      turnoverRub: 0,
    });

    expect(result.turnoverRub).toBeNull();
    expect(result.verdict).toBe('signal_unconfirmed');
  });

  it('тикер нормализуется', () => {
    const result = assessDailyMove({
      ticker: ' etrn ',
      dayChangePct: 1,
      turnoverRub: 10_000_000,
    });

    expect(result.ticker).toBe('ETRN');
  });

  it('пороги берутся из конфига, а не из литералов', () => {
    const belowConfig = PortfolioConfig.anomaly.dayChangePct - 0.01;
    const result = assessDailyMove({
      ticker: 'SBER',
      dayChangePct: belowConfig,
      turnoverRub: 100_000_000,
    });

    expect(result.isSignificantMove).toBe(false);
  });

  it('assessDailyMoves обрабатывает список', () => {
    const results = assessDailyMoves([
      { ticker: 'SBER', dayChangePct: 1, turnoverRub: 100_000_000 },
      { ticker: 'ETRN', dayChangePct: -9.9, turnoverRub: 1_700_000 },
    ]);

    expect(results.map((result) => result.verdict)).toEqual([
      'not_significant',
      'low_liquidity_noise',
    ]);
  });
});
