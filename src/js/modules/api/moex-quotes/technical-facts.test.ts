import { PortfolioConfig } from '../../../config/portfolio-config.js';
import {
  buildTechnicalFacts,
  formatTechnicalFacts,
  type TechnicalBar,
} from './technical-facts.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Бары подряд по дням, последний — 2026-11-18. */
function makeBars(count: number, basePrice = 100): TechnicalBar[] {
  const end = Date.parse('2026-11-18T00:00:00Z');
  const bars: TechnicalBar[] = [];
  for (let index = 0; index < count; index++) {
    const date = new Date(end - (count - 1 - index) * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const close = basePrice + index;
    bars.push({
      date,
      high: close + 10,
      low: close - 10,
      close,
    });
  }
  return bars;
}

function normalize(value: string): string {
  return value.replace(/\u00a0/g, ' ');
}

describe('buildTechnicalFacts — 52w и SMA из истории', () => {
  it('строит 52w-диапазон и SMA по периодам из конфига', () => {
    const bars = makeBars(260, 100);
    const facts = buildTechnicalFacts('SBER', bars);

    expect(facts.ticker).toBe('SBER');
    expect(facts.barsCount).toBe(260);
    expect(facts.asOf).toBe('2026-11-18');
    expect(facts.currentPrice).toBe(359);
    expect(facts.high52w).toBe(369);
    expect(facts.low52w).toBe(90);
    expect(facts.sma.map((fact) => fact.period)).toEqual([
      ...PortfolioConfig.moexQuotes.smaPeriods,
    ]);
    expect(facts.sma.every((fact) => fact.value !== null)).toBe(true);
    expect(facts.unavailable).toEqual([]);
  });

  it('на короткой истории 52w недоступен, длинная SMA — null с причиной', () => {
    const facts = buildTechnicalFacts('SBER', makeBars(100));

    expect(facts.high52w).toBeNull();
    expect(facts.low52w).toBeNull();
    expect(facts.sma[0]?.value).not.toBeNull();
    expect(facts.sma[1]?.value).toBeNull();
    expect(facts.unavailable.join('\n')).toContain('52w: недостаточно истории');
    expect(facts.unavailable.join('\n')).toContain('SMA200');
  });

  it('без истории все показатели недоступны', () => {
    const facts = buildTechnicalFacts('SBER', []);

    expect(facts.asOf).toBeNull();
    expect(facts.currentPrice).toBeNull();
    expect(facts.high52w).toBeNull();
    expect(facts.low52w).toBeNull();
    expect(facts.sma.every((fact) => fact.value === null)).toBe(true);
    expect(facts.unavailable).toContain('история MOEX ISS недоступна');
  });

  it('бары вне окна historyWindowDays не влияют на 52w', () => {
    const bars = makeBars(260, 100);
    bars.push({ date: '2015-01-05', high: 99999, low: 1, close: 500 });
    const facts = buildTechnicalFacts('SBER', bars);

    expect(facts.high52w).toBe(369);
    expect(facts.low52w).toBe(90);
  });

  it('невалидные бары отбрасываются, порядок восстанавливается', () => {
    const bars = makeBars(260, 100).reverse();
    bars.push({ date: '2026-11-19', high: 50, low: 60, close: 55 });
    bars.push({ date: '2026-11-20', high: 50, low: 40, close: 0 });

    const facts = buildTechnicalFacts('sber', bars);

    expect(facts.ticker).toBe('SBER');
    expect(facts.barsCount).toBe(260);
    expect(facts.asOf).toBe('2026-11-18');
    expect(facts.currentPrice).toBe(359);
  });

  it('нет хардкода периодов: список SMA берётся из конфига', () => {
    const facts = buildTechnicalFacts('SBER', makeBars(10));
    expect(facts.sma.map((fact) => fact.period)).toEqual(
      Array.from(PortfolioConfig.moexQuotes.smaPeriods),
    );
  });
});

describe('formatTechnicalFacts', () => {
  it('без истории пишет честное «недоступно»', () => {
    const text = formatTechnicalFacts(buildTechnicalFacts('SBER', []));
    expect(text).toBe(
      'Технические индикаторы: недоступно (нет истории MOEX ISS)',
    );
  });

  it('с историей выводит 52w, SMA, цену, источник и дату', () => {
    const text = normalize(
      formatTechnicalFacts(buildTechnicalFacts('SBER', makeBars(260))),
    );

    expect(text).toContain('52w:');
    expect(text).toContain('SMA50:');
    expect(text).toContain('SMA200:');
    expect(text).toContain('последняя цена:');
    expect(text).toContain('источник: MOEX ISS, 18.11.2026');
  });

  it('на короткой истории помечает 52w и длинную SMA как недоступные', () => {
    const text = normalize(
      formatTechnicalFacts(buildTechnicalFacts('SBER', makeBars(100))),
    );

    expect(text).toContain('52w: недоступно');
    expect(text).toContain('SMA200: недоступно');
  });
});
