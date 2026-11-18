import type { StockFundamentals } from '../../api/fundamentals/types.js';
import {
  hasForbiddenGeneralization,
  sanitizeFundamentalText,
  validateFundamentalTextForTicker,
} from './fundamentals-guard.js';

function createFundamentals(
  o: Partial<StockFundamentals> = {},
): StockFundamentals {
  return {
    ticker: 'PLZL',
    name: 'Полюс',
    price: {
      value: 420,
      source: 'MOEX ISS',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    marketCap: {
      value: 1,
      source: 'MOEX ISS',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    pe: {
      value: 5.13,
      source: 'smart-lab.ru',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    ps: {
      value: 1,
      source: 'smart-lab.ru',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    pb: {
      value: 1,
      source: 'smart-lab.ru',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    roe: {
      value: 19,
      source: 'smart-lab.ru',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    roa: {
      value: 10,
      source: 'smart-lab.ru',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    debtToEquity: {
      value: 3.61,
      source: 'smart-lab.ru',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    dividendYield: {
      value: 9,
      source: 'smart-lab.ru',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    dividendPerShare: {
      value: 1,
      source: 'smart-lab.ru',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    nextDividendDate: {
      value: null,
      source: null,
      asOf: null,
      status: 'UNAVAILABLE',
    },
    revenue: {
      value: 1,
      source: 'smart-lab.ru',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    netIncome: {
      value: 1,
      source: 'smart-lab.ru',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    equity: {
      value: 332e9,
      source: 'smart-lab.ru',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    debt: {
      value: 1.2e12,
      source: 'smart-lab.ru',
      asOf: '2026-11-17T00:00:00.000Z',
      status: 'VALUE',
    },
    medians: null,
    fundamentalHealth: 'POSITIVE',
    summary: '',
    unavailable: [],
    conflicts: [],
    sourcesUsed: ['MOEX ISS', 'smart-lab.ru'],
    ...o,
  };
}

describe('sanitizeFundamentalText', () => {
  it('оставляет число с источником и датой', () => {
    const text =
      'P/E 5,13 (smart-lab.ru, 17.11.2026) — ниже медианы 5 лет 5,77.';
    expect(sanitizeFundamentalText(text)).toBe(text);
  });

  it('удаляет обобщение «обычно 15-20%» без источника', () => {
    const result = sanitizeFundamentalText(
      'Дивиденды Татнефти обычно 15-20% в год. ROE 19,0% (smart-lab.ru, 17.11.2026).',
    );
    expect(result).toContain('обобщение без числа и источника запрещено');
    expect(result).toContain('ROE 19,0% (smart-lab.ru, 17.11.2026)');
    expect(result).not.toContain('обычно 15-20%');
  });

  it('удаляет «как правило» и «известен высокой рентабельностью»', () => {
    expect(
      sanitizeFundamentalText('Компания, как правило, платит дивиденды.'),
    ).toContain('обобщение без числа и источника запрещено');
    expect(
      sanitizeFundamentalText('Эмитент известен высокой рентабельностью.'),
    ).toContain('обобщение без числа и источника запрещено');
  });

  it('не трогает нейтральные предложения', () => {
    const text = 'P/E: недоступно (smart-lab.ru не отвечает).';
    expect(sanitizeFundamentalText(text)).toBe(text);
  });

  it('возвращает null для null/undefined', () => {
    expect(sanitizeFundamentalText(null)).toBeNull();
    expect(sanitizeFundamentalText(undefined)).toBeNull();
  });

  it('определяет запрещённые обобщения', () => {
    expect(hasForbiddenGeneralization('обычно 15-20%')).toBe(true);
    expect(
      hasForbiddenGeneralization('P/E 5,13 (smart-lab.ru, 17.11.2026)'),
    ).toBe(false);
  });
});

describe('validateFundamentalTextForTicker', () => {
  it('заменяет числа другого актива и сохраняет источник/дату своего', () => {
    const plzl = createFundamentals();
    const contaminated =
      'Долг/Капитал 3,61 (smart-lab.ru, 17.11.2026) — долг 10,8 млрд ₽ на капитал 1,38 трлн ₽.';

    const result = validateFundamentalTextForTicker(contaminated, 'PLZL', plzl);

    expect(result).toContain('PLZL: Долг/Капитал 3,61');
    expect(result).toContain('smart-lab.ru, 17.11.2026');
    expect(result).toContain('долг 1,20 трлн ₽');
    expect(result).toContain('капитал 332,0 млрд ₽');
    expect(result).not.toContain('10,8 млрд');
    expect(result).not.toContain('1,38 трлн');
  });

  it('заменяет чужой коэффициент Д/К', () => {
    const plzl = createFundamentals();
    const contaminated =
      'Долг/Капитал 0,01 (smart-lab.ru, 17.11.2026) — низкая долговая нагрузка.';

    const result = validateFundamentalTextForTicker(contaminated, 'PLZL', plzl);

    expect(result).toContain('PLZL: Долг/Капитал 3,61');
    expect(result).not.toContain('0,01');
  });

  it('оставляет корректный текст без изменений', () => {
    const plzl = createFundamentals();
    const text =
      'Долг/Капитал 3,61 (smart-lab.ru, 17.11.2026) — долг 1,2 трлн ₽ на капитал 332,0 млрд ₽.';

    expect(validateFundamentalTextForTicker(text, 'PLZL', plzl)).toBe(text);
  });
});
