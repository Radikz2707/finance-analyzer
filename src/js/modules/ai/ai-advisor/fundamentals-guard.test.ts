import type { StockFundamentals } from '../../api/fundamentals/types.js';
import {
  detectForeignMetricMentions,
  hasForbiddenGeneralization,
  sanitizeFundamentalText,
  validateFundamentalTextForTicker,
  validateNarrativeFundamentals,
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

  it('fail-closed: без объекта фундаментала цифра не сохраняется', () => {
    const text = 'Дивидендная доходность 11,3% — привлекательно.';

    const result = validateFundamentalTextForTicker(text, 'PLZL', undefined);

    expect(result).toContain('недоступно (нет подтверждённых данных)');
    expect(result).not.toContain('11,3');
  });

  it('fail-closed: своё значение null — цифра из текста удаляется', () => {
    const plzl = createFundamentals({
      dividendYield: {
        value: null,
        source: null,
        asOf: null,
        status: 'UNAVAILABLE',
      },
    });

    const result = validateFundamentalTextForTicker(
      'Дивидендная доходность 11,3% годовых.',
      'PLZL',
      plzl,
    );

    expect(result).toContain('PLZL: Дивидендная доходность — недоступно');
    expect(result).not.toContain('11,3');
  });

  it('заменяет чужую дивдоходность своим подтверждённым значением', () => {
    const plzl = createFundamentals();

    const result = validateFundamentalTextForTicker(
      'Дивидендная доходность 11,3% (smart-lab.ru, 17.11.2026).',
      'PLZL',
      plzl,
    );

    expect(result).toContain('PLZL: Дивидендная доходность 9,0%');
    expect(result).not.toContain('11,3');
  });

  it('помечает контаминацию соседним тикером', () => {
    const plzl = createFundamentals();
    const irao = createFundamentals({
      ticker: 'IRAO',
      name: 'ИРАО',
      dividendYield: {
        value: 11.3,
        source: 'smart-lab.ru',
        asOf: '2026-11-17T00:00:00.000Z',
        status: 'VALUE',
      },
    });

    const result = validateFundamentalTextForTicker(
      'Дивидендная доходность 11,3% (smart-lab.ru, 17.11.2026).',
      'PLZL',
      plzl,
      [{ ticker: 'IRAO', fundamentals: irao }],
    );

    expect(result).toContain('PLZL: Дивидендная доходность 9,0%');
    expect(result).toContain('значение другого актива отклонено');
    expect(result).not.toContain('11,3');
  });

  it('оставляет корректную дивдоходность без изменений', () => {
    const plzl = createFundamentals();
    const text =
      'Дивидендная доходность 9,0% (smart-lab.ru, 17.11.2026) — стабильно.';

    expect(validateFundamentalTextForTicker(text, 'PLZL', plzl)).toBe(text);
  });
});

describe('detectForeignMetricMentions', () => {
  it('находит число, взятое у соседнего тикера', () => {
    const plzl = createFundamentals();
    const irao = createFundamentals({
      ticker: 'IRAO',
      name: 'ИРАО',
      dividendYield: {
        value: 11.3,
        source: 'smart-lab.ru',
        asOf: '2026-11-17T00:00:00.000Z',
        status: 'VALUE',
      },
    });

    const mentions = detectForeignMetricMentions(
      'Дивидендная доходность 11,3% (smart-lab.ru, 17.11.2026).',
      'PLZL',
      plzl,
      [{ ticker: 'IRAO', fundamentals: irao }],
    );

    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.foreignTicker).toBe('IRAO');
    expect(mentions[0]?.label).toBe('Дивидендная доходность');
  });

  it('не считает контаминацией совпадение со своим значением', () => {
    const plzl = createFundamentals();

    const mentions = detectForeignMetricMentions(
      'Дивидендная доходность 9,0% (smart-lab.ru, 17.11.2026).',
      'PLZL',
      plzl,
      [],
    );

    expect(mentions).toHaveLength(0);
  });

  it('допуск в п.п.: реальные соседи 11,3% и 11,4% не считаются контаминацией', () => {
    const own = createFundamentals({
      dividendYield: {
        value: 11.4,
        source: 'smart-lab.ru',
        asOf: '2026-11-17T00:00:00.000Z',
        status: 'VALUE',
      },
    });
    const sibling = createFundamentals({
      ticker: 'IRAO',
      name: 'ИРАО',
      dividendYield: {
        value: 11.3,
        source: 'smart-lab.ru',
        asOf: '2026-11-17T00:00:00.000Z',
        status: 'VALUE',
      },
    });

    const mentions = detectForeignMetricMentions(
      'Дивидендная доходность 11,3% (smart-lab.ru, 17.11.2026).',
      'PLZL',
      own,
      [{ ticker: 'IRAO', fundamentals: sibling }],
    );

    // 0,1 п.п. — в пределах SIBLING_YIELD_TOLERANCE_PP (0,5 п.п.).
    expect(mentions).toHaveLength(0);
  });

  it('ловит настоящую контаминацию: ROE 80,3% при реальных ~30%', () => {
    const own = createFundamentals({
      roe: {
        value: 30,
        source: 'smart-lab.ru',
        asOf: '2026-11-17T00:00:00.000Z',
        status: 'VALUE',
      },
    });
    const sibling = createFundamentals({
      ticker: 'IRAO',
      name: 'ИРАО',
      roe: {
        value: 80.3,
        source: 'smart-lab.ru',
        asOf: '2026-11-17T00:00:00.000Z',
        status: 'VALUE',
      },
    });

    const mentions = detectForeignMetricMentions(
      'ROE 80,3% (smart-lab.ru, 17.11.2026) — очень высокий.',
      'PLZL',
      own,
      [{ ticker: 'IRAO', fundamentals: sibling }],
    );

    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.label).toBe('ROE');
    expect(mentions[0]?.foreignTicker).toBe('IRAO');
  });
});

describe('validateNarrativeFundamentals (задача 2)', () => {
  const plzl = createFundamentals();
  const assets = [
    { ticker: 'PLZL', name: 'Полюс', fundamentals: plzl },
    {
      ticker: 'IRAO',
      name: 'Интер РАО',
      fundamentals: createFundamentals({ ticker: 'IRAO', name: 'Интер РАО' }),
    },
  ];

  it('заменяет «P/E 7,18, ROE 80,3%» на своё значение с источником и датой', () => {
    const result =
      validateNarrativeFundamentals(
        'PLZL: P/E 7,18, ROE 80,3% — выглядит дёшево.',
        assets,
      ) ?? '';

    expect(result).not.toContain('7,18');
    expect(result).not.toContain('80,3');
    expect(result).toContain('5,13');
    expect(result).toContain('19,0');
    expect(result).toContain('(smart-lab.ru, 17.11.2026)');
  });

  it('переносит активный тикер на следующее предложение', () => {
    const result =
      validateNarrativeFundamentals(
        'PLZL выглядит дёшево. P/E 7,18 — ниже рынка.',
        assets,
      ) ?? '';

    expect(result).not.toContain('7,18');
    expect(result).toContain('5,13');
    expect(result).toContain('smart-lab.ru');
  });

  it('без тикера число не сохраняется (fail-closed, reason=no_ticker)', () => {
    const result =
      validateNarrativeFundamentals(
        'P/E 7,18 при нейтральном прогнозе.',
        assets,
      ) ?? '';

    expect(result).not.toContain('7,18');
    expect(result).toContain('тикер не определён');
  });

  it('нет подтверждённого значения → «недоступно», а не число', () => {
    const unavailable = createFundamentals({
      pe: {
        value: null,
        source: null,
        asOf: null,
        status: 'UNAVAILABLE',
      },
    });
    const result =
      validateNarrativeFundamentals('PLZL: P/E 7,18.', [
        { ticker: 'PLZL', name: 'Полюс', fundamentals: unavailable },
      ]) ?? '';

    expect(result).not.toContain('7,18');
    expect(result).toContain('недоступно');
  });

  it('не трогает предложения без чисел метрик', () => {
    const text = 'PLZL: структура портфеля сбалансирована.';
    expect(validateNarrativeFundamentals(text, assets)).toBe(text);
  });

  it('оставляет диапазон 9–12%, если он покрывает подтверждённые значения', () => {
    const rangeAssets = [
      {
        ticker: 'PLZL',
        name: 'Полюс',
        fundamentals: createFundamentals({
          dividendYield: {
            value: 9.4,
            source: 'smart-lab.ru',
            asOf: '2026-11-17T00:00:00.000Z',
            status: 'VALUE',
          },
        }),
      },
      {
        ticker: 'IRAO',
        name: 'Интер РАО',
        fundamentals: createFundamentals({
          ticker: 'IRAO',
          name: 'Интер РАО',
          dividendYield: {
            value: 11.6,
            source: 'smart-lab.ru',
            asOf: '2026-11-17T00:00:00.000Z',
            status: 'VALUE',
          },
        }),
      },
    ];

    const text =
      'Дивидендная доходность Полюса и Интер РАО составляет 9–12% годовых.';
    expect(validateNarrativeFundamentals(text, rangeAssets)).toBe(text);
  });

  it('заменяет диапазон вне подтверждённых значений (reason=range_violation)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rangeAssets = [
      {
        ticker: 'PLZL',
        name: 'Полюс',
        fundamentals: createFundamentals({
          dividendYield: {
            value: 9.4,
            source: 'smart-lab.ru',
            asOf: '2026-11-17T00:00:00.000Z',
            status: 'VALUE',
          },
        }),
      },
      {
        ticker: 'IRAO',
        name: 'Интер РАО',
        fundamentals: createFundamentals({
          ticker: 'IRAO',
          name: 'Интер РАО',
          dividendYield: {
            value: 11.6,
            source: 'smart-lab.ru',
            asOf: '2026-11-17T00:00:00.000Z',
            status: 'VALUE',
          },
        }),
      },
    ];

    const result =
      validateNarrativeFundamentals(
        'Дивидендная доходность Полюса и Интер РАО составляет 20–25% годовых.',
        rangeAssets,
      ) ?? '';

    expect(result).not.toContain('20–25');
    expect(result).toContain('9,4');
    expect(result).toContain('11,6');
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes('reason=range_violation'),
      ),
    ).toBe(true);
    warn.mockRestore();
  });
});
