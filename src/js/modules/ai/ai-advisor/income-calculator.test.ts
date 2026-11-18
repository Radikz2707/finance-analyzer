import {
  buildExcelDividendYields,
  calculatePortfolioIncome,
  type CalculatedIncome,
} from './income-calculator.js';

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
    expect(income.stocks[0]?.source).toBe('EXCEL_DIVIDENDS');
    expect(income.dividendSource).toBe('EXCEL_DIVIDENDS');
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
        source: 'EXCEL_DIVIDENDS',
        asOf: '2026-11-17T00:00:00.000Z',
      },
    ],
    excelAsOf: '2026-11-17T00:00:00.000Z',
  };

  it('LTM: yield = сумма/кол-во/цена, source=EXCEL_DIVIDENDS', () => {
    const result = buildExcelDividendYields(baseIncome, [
      { ticker: 'SBER', currentPrice: 100 },
    ]);

    expect(result.yields.SBER).toBe(50);
    expect(result.meta.SBER?.source).toBe('EXCEL_DIVIDENDS');
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
