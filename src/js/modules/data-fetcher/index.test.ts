// ВНИМАНИЕ: используются глобальные API vitest (globals: true),
// т.к. явный import из 'vitest' ломает runner при CLI-фильтрах на этой машине.
import {
  fetchHistoricalData,
  fetchHistoricalBatch,
  calculatePriceMetrics,
  formatMetrics,
} from './index.js';

// ═══════════════════════════════════════════════
// Mocks
// ═══════════════════════════════════════════════

vi.mock('../finam-api/history-provider.js', () => ({
  fetchHistoricalData: vi.fn(),
  fetchHistoricalBatch: vi.fn(),
}));

vi.mock('../moex-api/history-provider.js', () => ({
  fetchHistoricalData: vi.fn(),
  fetchHistoricalBatch: vi.fn(),
  calculatePriceMetrics: vi.fn((_bars) => ({
    totalReturn: 0.1,
    annualizedReturn: 0.15,
    volatility: 0.2,
    sharpeRatio: 0.5,
    maxDrawdown: 0.1,
    winRate: 0.55,
    bestDay: 0.05,
    worstDay: -0.04,
    averageVolume: 1000000,
  })),
  formatMetrics: vi.fn((metrics) => `Metrics: ${metrics.totalReturn}`),
}));

const { fetchHistoricalData: finamFetch } =
  await import('../finam-api/history-provider.js');
const { fetchHistoricalBatch: finamBatch } =
  await import('../finam-api/history-provider.js');
const { fetchHistoricalData: moexFetch } =
  await import('../moex-api/history-provider.js');
const { fetchHistoricalBatch: moexBatch } =
  await import('../moex-api/history-provider.js');

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function createMockRequest(
  overrides = {},
): Parameters<typeof fetchHistoricalData>[0] {
  return {
    ticker: 'SBER',
    interval: 'D',
    from: '2025-01-01',
    to: '2025-12-31',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════
// 1. fetchHistoricalData — Finam API path
// ═══════════════════════════════════════════════

describe('fetchHistoricalData (Finam API)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FINAM_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.FINAM_API_KEY;
  });

  it('должен использовать Finam API когда установлен FINAM_API_KEY', async () => {
    const mockResult = {
      ticker: 'SBER',
      bars: [
        {
          date: '2025-01-01',
          open: 100,
          high: 102,
          low: 99,
          close: 101,
          volume: 1000,
        },
      ],
      from: '2025-01-01',
      to: '2025-12-31',
      count: 1,
      fromCache: false,
    };

    (finamFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    const result = await fetchHistoricalData(createMockRequest());

    expect(finamFetch).toHaveBeenCalledWith(createMockRequest());
    expect(result.source).toBe('finam');
    expect(result.ticker).toBe('SBER');
    expect(result.count).toBe(1);
  });

  it('должен вернуть корректный результат с данными', async () => {
    const mockResult = {
      ticker: 'GAZP',
      bars: [
        {
          date: '2025-01-01',
          open: 150,
          high: 155,
          low: 148,
          close: 152,
          volume: 500000,
        },
        {
          date: '2025-01-02',
          open: 152,
          high: 158,
          low: 150,
          close: 155,
          volume: 600000,
        },
      ],
      from: '2025-01-01',
      to: '2025-01-31',
      count: 2,
      fromCache: false,
    };

    (finamFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    const result = await fetchHistoricalData({
      ticker: 'GAZP',
      interval: 'D',
      from: '2025-01-01',
      to: '2025-01-31',
    });

    expect(result.bars).toHaveLength(2);
    expect(result.source).toBe('finam');
    expect(result.from).toBe('2025-01-01');
    expect(result.to).toBe('2025-01-31');
  });
});

// ═══════════════════════════════════════════════
// 2. fetchHistoricalData — MOEX fallback path
// ═══════════════════════════════════════════════

describe('fetchHistoricalData (MOEX fallback)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FINAM_API_KEY;
  });

  it('должен использовать MOEX когда FINAM_API_KEY не установлен', async () => {
    const mockResult = {
      ticker: 'SBER',
      bars: [
        {
          date: '2025-01-01',
          open: 100,
          high: 102,
          low: 99,
          close: 101,
          volume: 1000,
        },
      ],
      from: '2025-01-01',
      to: '2025-12-31',
      count: 1,
      fromCache: false,
    };

    (moexFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    const result = await fetchHistoricalData(createMockRequest());

    expect(moexFetch).toHaveBeenCalledWith(createMockRequest());
    expect(result.source).toBe('moex');
  });

  it('должен использовать MOEX когда FINAM_API_KEY пустой строкой', async () => {
    process.env.FINAM_API_KEY = '';
    (finamFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'SBER',
      bars: [],
      from: '2025-01-01',
      to: '2025-12-31',
      count: 0,
      fromCache: false,
    });

    const mockResult = {
      ticker: 'SBER',
      bars: [
        {
          date: '2025-01-01',
          open: 100,
          high: 102,
          low: 99,
          close: 101,
          volume: 1000,
        },
      ],
      from: '2025-01-01',
      to: '2025-12-31',
      count: 1,
      fromCache: false,
    };

    (moexFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    const result = await fetchHistoricalData(createMockRequest());

    expect(result.source).toBe('moex');
  });

  it('должен использовать MOEX когда FINAM_API_KEY состоит из пробелов', async () => {
    process.env.FINAM_API_KEY = '   ';
    (moexFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'SBER',
      bars: [
        {
          date: '2025-01-01',
          open: 100,
          high: 102,
          low: 99,
          close: 101,
          volume: 1000,
        },
      ],
      from: '2025-01-01',
      to: '2025-12-31',
      count: 1,
      fromCache: false,
    });

    const result = await fetchHistoricalData(createMockRequest());

    expect(result.source).toBe('moex');
  });
});

// ═══════════════════════════════════════════════
// 3. fetchHistoricalBatch
// ═══════════════════════════════════════════════

describe('fetchHistoricalBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('должен использовать Finam API когда установлен ключ', async () => {
    process.env.FINAM_API_KEY = 'test-key';

    const mockMap = new Map<
      string,
      Array<{
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>
    >();
    mockMap.set('SBER', [
      {
        date: '2025-01-01',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      },
    ]);

    (finamBatch as ReturnType<typeof vi.fn>).mockResolvedValue(mockMap);

    const result = await fetchHistoricalBatch(
      ['SBER'],
      '2025-01-01',
      '2025-12-31',
      'D',
    );

    expect(finamBatch).toHaveBeenCalledWith(
      ['SBER'],
      '2025-01-01',
      '2025-12-31',
      'D',
    );
    expect(result.has('SBER')).toBe(true);
  });

  it('должен использовать MOEX когда ключ не установлен', async () => {
    delete process.env.FINAM_API_KEY;

    const mockMap = new Map<
      string,
      Array<{
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>
    >();
    mockMap.set('GAZP', [
      {
        date: '2025-01-01',
        open: 150,
        high: 155,
        low: 148,
        close: 152,
        volume: 500000,
      },
    ]);
    mockMap.set('LKOH', [
      {
        date: '2025-01-01',
        open: 7000,
        high: 7100,
        low: 6950,
        close: 7050,
        volume: 50000,
      },
    ]);

    (moexBatch as ReturnType<typeof vi.fn>).mockResolvedValue(mockMap);

    const result = await fetchHistoricalBatch(
      ['GAZP', 'LKOH'],
      '2025-01-01',
      '2025-12-31',
      'D',
    );

    expect(moexBatch).toHaveBeenCalledWith(
      ['GAZP', 'LKOH'],
      '2025-01-01',
      '2025-12-31',
      'D',
    );
    expect(result.size).toBe(2);
    expect(result.has('GAZP')).toBe(true);
    expect(result.has('LKOH')).toBe(true);
  });

  it('должен использовать интервал W при запросе недельных данных', async () => {
    delete process.env.FINAM_API_KEY;

    const mockMap = new Map();
    mockMap.set('SBER', []);

    (moexBatch as ReturnType<typeof vi.fn>).mockResolvedValue(mockMap);

    await fetchHistoricalBatch(['SBER'], '2025-01-01', '2025-12-31', 'W');

    expect(moexBatch).toHaveBeenCalledWith(
      ['SBER'],
      '2025-01-01',
      '2025-12-31',
      'W',
    );
  });

  it('должен использовать интервал M при запросе месячных данных', async () => {
    delete process.env.FINAM_API_KEY;

    const mockMap = new Map();
    mockMap.set('SBER', []);

    (moexBatch as ReturnType<typeof vi.fn>).mockResolvedValue(mockMap);

    await fetchHistoricalBatch(['SBER'], '2025-01-01', '2025-12-31', 'M');

    expect(moexBatch).toHaveBeenCalledWith(
      ['SBER'],
      '2025-01-01',
      '2025-12-31',
      'M',
    );
  });

  it('должен обработать пустой список тикеров', async () => {
    delete process.env.FINAM_API_KEY;

    const mockMap = new Map();
    (moexBatch as ReturnType<typeof vi.fn>).mockResolvedValue(mockMap);

    const result = await fetchHistoricalBatch(
      [],
      '2025-01-01',
      '2025-12-31',
      'D',
    );

    expect(result.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// 3.1. Проброс ошибок от провайдеров
// ═══════════════════════════════════════════════

describe('fetchHistoricalData (error propagation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.FINAM_API_KEY;
  });

  it('должен пробросить ошибку от Finam API', async () => {
    process.env.FINAM_API_KEY = 'test-key';
    (finamFetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Finam API timeout'),
    );

    await expect(fetchHistoricalData(createMockRequest())).rejects.toThrow(
      'Finam API timeout',
    );
  });

  it('должен пробросить ошибку от MOEX ISS', async () => {
    delete process.env.FINAM_API_KEY;
    (moexFetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('MOEX ISS unavailable'),
    );

    await expect(fetchHistoricalData(createMockRequest())).rejects.toThrow(
      'MOEX ISS unavailable',
    );
  });

  it('должен пробросить ошибку из batch-загрузки', async () => {
    process.env.FINAM_API_KEY = 'test-key';
    (finamBatch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Batch failed'),
    );

    await expect(
      fetchHistoricalBatch(['SBER'], '2025-01-01', '2025-12-31', 'D'),
    ).rejects.toThrow('Batch failed');
  });
});

// ═══════════════════════════════════════════════
// 3.2. Проброс fromCache из результата провайдера
// ═══════════════════════════════════════════════

describe('fetchHistoricalData (fromCache passthrough)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.FINAM_API_KEY;
  });

  it('должен сохранить fromCache=true из результата Finam', async () => {
    process.env.FINAM_API_KEY = 'test-key';
    (finamFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'SBER',
      bars: [
        {
          date: '2025-01-01',
          open: 100,
          high: 102,
          low: 99,
          close: 101,
          volume: 1000,
        },
      ],
      from: '2025-01-01',
      to: '2025-12-31',
      count: 1,
      fromCache: true,
    });

    const result = await fetchHistoricalData(createMockRequest());

    expect(result.fromCache).toBe(true);
  });

  it('должен сохранить fromCache=false из результата MOEX', async () => {
    delete process.env.FINAM_API_KEY;
    (moexFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'SBER',
      bars: [],
      from: '2025-01-01',
      to: '2025-12-31',
      count: 0,
      fromCache: false,
    });

    const result = await fetchHistoricalData(createMockRequest());

    expect(result.fromCache).toBe(false);
  });
});

// ═══════════════════════════════════════════════
// 4. calculatePriceMetrics (re-export)
// ═══════════════════════════════════════════════

describe('calculatePriceMetrics (re-export)', () => {
  it('должен вернуть метрики из переэкспортированной функции', () => {
    const bars = [
      {
        date: '2025-01-01',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      },
      {
        date: '2025-01-02',
        open: 101,
        high: 103,
        low: 100,
        close: 102,
        volume: 1100,
      },
      {
        date: '2025-01-03',
        open: 102,
        high: 104,
        low: 101,
        close: 103,
        volume: 1200,
      },
    ];

    const metrics = calculatePriceMetrics(bars);

    expect(metrics).toBeDefined();
    expect(typeof metrics.totalReturn).toBe('number');
    expect(typeof metrics.volatility).toBe('number');
    expect(typeof metrics.sharpeRatio).toBe('number');
  });
});

// ═══════════════════════════════════════════════
// 5. formatMetrics (re-export)
// ═══════════════════════════════════════════════

describe('formatMetrics (re-export)', () => {
  it('должен вернуть отформатированную строку', () => {
    const metrics = {
      totalReturn: 0.15,
      annualizedReturn: 0.18,
      volatility: 0.22,
      sharpeRatio: 0.55,
      maxDrawdown: 0.08,
      winRate: 0.6,
      bestDay: 0.05,
      worstDay: -0.04,
      averageVolume: 1000000,
    };

    const formatted = formatMetrics(metrics);

    expect(formatted).toBeDefined();
    expect(typeof formatted).toBe('string');
  });
});
