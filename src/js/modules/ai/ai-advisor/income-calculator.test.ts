import {
  buildExcelDividendYields,
  calculatePortfolioIncome,
  type CalculatedIncome,
} from './income-calculator.js';
import type { DividendLtmResult } from './dividend-ltm.js';

const {
  mockExistsSync,
  mockStatSync,
  mockReadFile,
  mockDecodeRange,
  mockEncodeCell,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockReadFile: vi.fn(),
  mockDecodeRange: vi.fn(),
  mockEncodeCell: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    statSync: mockStatSync,
  },
  existsSync: mockExistsSync,
  statSync: mockStatSync,
}));

vi.mock('xlsx', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    utils: {
      decode_range: (...args: unknown[]) => mockDecodeRange(...args),
      encode_cell: (...args: unknown[]) => mockEncodeCell(...args),
    },
  },
}));

type Sheet = Record<string, unknown> & { '!ref': string };

function makeSheet(headers: string[], rows: unknown[][]): Sheet {
  const sheet: Sheet = { '!ref': `A1:J${rows.length + 1}` };
  headers.forEach((header, col) => {
    sheet[`${col},0`] = { v: header };
  });
  rows.forEach((row, rowIndex) => {
    row.forEach((value, col) => {
      sheet[`${col},${rowIndex + 1}`] = { v: value };
    });
  });
  return sheet;
}

function setupWorkbook(sheet: Sheet): void {
  mockExistsSync.mockReturnValue(true);
  mockStatSync.mockReturnValue({
    mtime: new Date('2026-11-17T00:00:00.000Z'),
  });
  const lastRow = Number(
    sheet['!ref'].split(':')[1]?.replace(/[A-Z]+/g, '') ?? 0,
  );
  mockDecodeRange.mockReturnValue({
    s: { r: 0, c: 0 },
    e: { r: lastRow, c: 10 },
  });
  mockEncodeCell.mockImplementation(
    ({ r, c }: { r: number; c: number }) => `${c},${r}`,
  );
  mockReadFile.mockReturnValue({ Sheets: { QUIK: sheet } });
}

const baseHeaders = [
  'Код инструмента',
  'Вид активов',
  'Инструмент',
  'Позиция',
  'НКД',
];

describe('calculatePortfolioIncome — QUIK dividends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('LTM на всю позицию: не умножает на количество и считает НДФЛ', async () => {
    setupWorkbook(
      makeSheet(
        [...baseHeaders, 'Дивиденды LTM'],
        [
          ['RU000A', 'О', 'ОФЗ', 10, 3731.32, 0],
          ['SBER', 'А', 'Сбербанк', 100, 0, 5000],
        ],
      ),
    );

    const income = await calculatePortfolioIncome();

    expect(income.totalNkd).toBe(3731.32);
    expect(income.totalDivs).toBe(5000);
    expect(income.totalDivsNet).toBe(4350);
    expect(income.stocks).toHaveLength(1);
    expect(income.stocks[0]?.rate).toBe(50);
    expect(income.stocks[0]?.source).toBe('BROKER');
    expect(income.dividendSource).toBe('BROKER');
    expect(income.excelAsOf).toBe('2026-11-17T00:00:00.000Z');
  });

  it('объявленные дивиденды не смешиваются с LTM', async () => {
    setupWorkbook(
      makeSheet(
        [...baseHeaders, 'Объявленные дивиденды'],
        [['SBER', 'А', 'Сбербанк', 100, 0, 5000]],
      ),
    );

    const income = await calculatePortfolioIncome();

    expect(income.totalDivs).toBe(0);
    expect(income.totalDivsNet).toBe(0);
    expect(income.declaredDivs).toBe(5000);
    expect(income.declaredDivsNet).toBe(4350);
    expect(income.dividendSource).toBe('EXCEL_DECLARED');
    expect(income.dividendKind).toBe('DECLARED');
  });

  it('столбец есть, но все значения 0 — плитки нулевые, warning зафиксирован', async () => {
    setupWorkbook(
      makeSheet(
        [...baseHeaders, 'Дивиденды LTM'],
        [['SBER', 'А', 'Сбербанк', 100, 0, 0]],
      ),
    );

    const income = await calculatePortfolioIncome();

    expect(income.totalDivs).toBe(0);
    expect(income.totalDivsNet).toBe(0);
    expect(income.stocks).toHaveLength(0);
    expect(income.dividendWarnings).toContain(
      'dividend column found but all values are 0/empty',
    );
  });

  it('positional fallback: колонка правее купонной, облигации строго 0', async () => {
    setupWorkbook(
      makeSheet(
        [...baseHeaders, 'Купон, %', ''],
        [
          ['RU000A', 'О', 'ОФЗ', 10, 3731.32, 7.5, 0],
          ['SBER', 'А', 'Сбербанк', 100, 0, 0, 5000],
        ],
      ),
    );

    const income = await calculatePortfolioIncome();

    expect(income.totalDivs).toBe(5000);
    expect(
      income.dividendWarnings?.some((warning) =>
        warning.includes('positional fallback'),
      ),
    ).toBe(true);
  });

  it('несколько positional-кандидатов → ambiguous, без молчаливого выбора', async () => {
    setupWorkbook(
      makeSheet(
        [...baseHeaders, 'Купон, %', '', ''],
        [
          ['RU000A', 'О', 'ОФЗ', 10, 3731.32, 7.5, 0, 0],
          ['SBER', 'А', 'Сбербанк', 100, 0, 0, 5000, 4000],
        ],
      ),
    );

    const income = await calculatePortfolioIncome();

    expect(income.totalDivs).toBe(0);
    expect(
      income.dividendWarnings?.some((warning) =>
        warning.includes('ambiguous positional'),
      ),
    ).toBe(true);
  });
});

describe('buildExcelDividendYields — слой якоря', () => {
  const baseIncome: CalculatedIncome = {
    totalNkd: 0,
    totalDivs: 5000,
    totalDivsNet: 4350,
    stocks: [
      {
        name: 'Сбербанк',
        ticker: 'SBER',
        quantity: 100,
        rate: 50,
        grossIncome: 5000,
        netIncome: 4350,
        kind: 'LTM',
        source: 'BROKER',
        asOf: '2026-11-17T00:00:00.000Z',
      },
    ],
    excelAsOf: '2026-11-17T00:00:00.000Z',
  };

  it('LTM: yield = сумма/кол-во/цена, source=BROKER', () => {
    const result = buildExcelDividendYields(baseIncome, [
      { ticker: 'SBER', currentPrice: 100 },
    ]);

    expect(result.yields.SBER).toBe(50);
    expect(result.meta.SBER?.source).toBe('BROKER');
    expect(result.meta.SBER?.asOf).toBe('2026-11-17T00:00:00.000Z');
  });

  it('DECLARED: source=EXCEL_DECLARED', () => {
    const result = buildExcelDividendYields(
      {
        ...baseIncome,
        stocks: [],
        declaredStocks: [
          {
            ...baseIncome.stocks[0]!,
            kind: 'DECLARED',
            source: 'EXCEL_DECLARED',
          },
        ],
      },
      [{ ticker: 'SBER', currentPrice: 100 }],
    );

    expect(result.yields.SBER).toBe(50);
    expect(result.meta.SBER?.source).toBe('EXCEL_DECLARED');
    expect(result.meta.SBER?.kind).toBe('DECLARED');
  });

  it('аномалия <0.5% и >100% не попадает в карту', () => {
    const low = buildExcelDividendYields(
      {
        ...baseIncome,
        stocks: [{ ...baseIncome.stocks[0]!, grossIncome: 10 }],
      },
      [{ ticker: 'SBER', currentPrice: 100 }],
    );
    expect(low.yields.SBER).toBeUndefined();
    expect(low.warnings[0]).toContain('status=PARSE_ERROR');

    const high = buildExcelDividendYields(
      {
        ...baseIncome,
        stocks: [{ ...baseIncome.stocks[0]!, grossIncome: 20000 }],
      },
      [{ ticker: 'SBER', currentPrice: 100 }],
    );
    expect(high.yields.SBER).toBeUndefined();
    expect(high.warnings[0]).toContain('status=PARSE_ERROR');
  });
});

describe('calculatePortfolioIncome — LTM из MOEX ISS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('заполненный Excel — приоритетный override BROKER, ISS не вызывается', async () => {
    setupWorkbook(
      makeSheet(
        [...baseHeaders, 'Дивиденды LTM'],
        [['SBER', 'А', 'Сбербанк', 100, 0, 5000]],
      ),
    );
    const fetchLtm = vi.fn();

    const income = await calculatePortfolioIncome(undefined, {
      moexLtm: true,
      fetchLtm,
    });

    expect(income.stocks[0]?.source).toBe('BROKER');
    expect(income.dividendSource).toBe('BROKER');
    expect(fetchLtm).not.toHaveBeenCalled();
  });

  it('пустой Excel + ISS → MOEX_ISS, НДФЛ из конфига', async () => {
    setupWorkbook(
      makeSheet(
        [...baseHeaders, 'Дивиденды LTM'],
        [['PLZL', 'А', 'Полюс', 10, 0, 0]],
      ),
    );
    const fetchLtm = vi.fn(
      async (ticker: string): Promise<DividendLtmResult> => ({
        ticker,
        secid: ticker,
        ltmPerShare: 121.85,
        count: 2,
        asOf: '2026-07-10',
        source: 'MOEX_ISS',
        status: 'OK',
        diagnostics: {
          iss: 'OK',
          smartLab: 'SKIPPED',
          smartLabSecid: null,
        },
      }),
    );

    const income = await calculatePortfolioIncome(undefined, {
      moexLtm: true,
      fetchLtm,
    });

    expect(fetchLtm).toHaveBeenCalledWith('PLZL', 'Полюс');
    expect(income.totalDivs).toBe(1218.5);
    expect(income.totalDivsNet).toBeCloseTo(1218.5 * 0.87, 2);
    expect(income.stocks).toHaveLength(1);
    expect(income.stocks[0]?.source).toBe('MOEX_ISS');
    expect(income.stocks[0]?.rate).toBe(121.85);
    expect(income.stocks[0]?.asOf).toBe('2026-07-10');
    expect(income.dividendSource).toBe('MOEX_ISS');
    expect(income.dividendDataStatus).toBe('OK');
  });

  it('источники недоступны → «недоступно», не 0 и не «нет выплат»', async () => {
    setupWorkbook(
      makeSheet(
        [...baseHeaders, 'Дивиденды LTM'],
        [['TATN', 'А', 'Татнефть', 10, 0, 0]],
      ),
    );
    const fetchLtm = vi.fn(
      async (ticker: string): Promise<DividendLtmResult> => ({
        ticker,
        secid: ticker,
        ltmPerShare: null,
        count: 0,
        asOf: null,
        source: 'UNAVAILABLE',
        status: 'UNAVAILABLE',
        diagnostics: {
          iss: 'UNAVAILABLE',
          smartLab: 'UNAVAILABLE',
          smartLabSecid: ticker,
        },
      }),
    );

    const income = await calculatePortfolioIncome(undefined, {
      moexLtm: true,
      fetchLtm,
    });

    expect(income.totalDivs).toBe(0);
    expect(income.totalDivsNet).toBe(0);
    expect(income.stocks).toHaveLength(0);
    expect(income.dividendDataStatus).toBe('UNAVAILABLE');
    expect(income.dividendWarnings).toContain(
      'TATN: дивиденды LTM недоступны — источники не ответили (MOEX ISS, smart-lab)',
    );
  });

  it('источники ответили без выплат → EMPTY («нет данных»), не 0 ₽ в плитке', async () => {
    setupWorkbook(
      makeSheet(
        [...baseHeaders, 'Дивиденды LTM'],
        [['TATN', 'А', 'Татнефть', 10, 0, 0]],
      ),
    );
    const fetchLtm = vi.fn(
      async (ticker: string): Promise<DividendLtmResult> => ({
        ticker,
        secid: ticker,
        ltmPerShare: null,
        count: 0,
        asOf: null,
        source: 'UNAVAILABLE',
        status: 'EMPTY',
        diagnostics: { iss: 'EMPTY', smartLab: 'EMPTY', smartLabSecid: ticker },
      }),
    );

    const income = await calculatePortfolioIncome(undefined, {
      moexLtm: true,
      fetchLtm,
    });

    expect(income.dividendDataStatus).toBe('EMPTY');
    expect(income.dividendWarnings).toContain(
      'TATN: нет подтверждённых дивидендов LTM за 13 мес (MOEX ISS, smart-lab)',
    );
  });

  it('BROKER + MOEX_ISS в одном портфеле → dividendSource=MIXED', async () => {
    setupWorkbook(
      makeSheet(
        [...baseHeaders, 'Дивиденды LTM'],
        [
          ['SBER', 'А', 'Сбербанк', 100, 0, 5000],
          ['PLZL', 'А', 'Полюс', 10, 0, 0],
        ],
      ),
    );
    const fetchLtm = vi.fn(
      async (ticker: string): Promise<DividendLtmResult> => ({
        ticker,
        secid: ticker,
        ltmPerShare: 121.85,
        count: 2,
        asOf: '2026-07-10',
        source: 'MOEX_ISS',
        status: 'OK',
        diagnostics: {
          iss: 'OK',
          smartLab: 'SKIPPED',
          smartLabSecid: null,
        },
      }),
    );

    const income = await calculatePortfolioIncome(undefined, {
      moexLtm: true,
      fetchLtm,
    });

    expect(income.dividendSource).toBe('MIXED');
    expect(income.stocks.map((stock) => stock.source)).toEqual([
      'BROKER',
      'MOEX_ISS',
    ]);
  });
});
