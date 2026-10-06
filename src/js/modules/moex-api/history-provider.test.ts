/**
 * Тесты для MoexHistoryProvider — загрузки исторических данных через MOEX ISS API.
 *
 * Покрытие:
 * - Кэширование в SQLite (чтение из кэша / запись после загрузки)
 * - Парсинг candles.json endpoint + фильтрация по датам
 * - Fallback на history.json endpoint
 * - Определение режима торгов (TQBR для акций, TQOB для облигаций)
 * - Обработка ошибок (HTTP-ошибки, сетевые сбои)
 * - fetchHistoricalBatch
 * - calculatePriceMetrics и formatMetrics
 *
 * ВНИМАНИЕ: используются глобальные API vitest (globals: true),
 * т.к. явный import из 'vitest' ломает runner при CLI-фильтрах на этой машине.
 */

import type { OHLCVBar, MoexHistoryRequest } from './history-provider.js';
import {
  fetchHistoricalData,
  fetchHistoricalBatch,
  calculatePriceMetrics,
  formatMetrics,
} from './history-provider.js';

// ═══════════════════════════════════════════════
// Mocks: SQLite (in-memory fake) и глобальный fetch
// ═══════════════════════════════════════════════

const mocks = vi.hoisted(() => {
  let cachedRows: Array<Record<string, unknown>> = [];
  return {
    setCachedRows(rows: Array<Record<string, unknown>>): void {
      cachedRows = rows;
    },
    getCachedRows(): Array<Record<string, unknown>> {
      return cachedRows;
    },
  };
});

vi.mock('../db-manager/db-manager.js', () => ({
  db: {
    prepare: vi.fn(() => ({
      all: vi.fn(() => mocks.getCachedRows()),
      run: vi.fn(() => ({ changes: 1 })),
    })),
    transaction: vi.fn((fn: (bars: unknown[]) => void) => fn),
  },
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => '',
  } as unknown as Response;
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function createRequest(
  overrides?: Partial<MoexHistoryRequest>,
): MoexHistoryRequest {
  return {
    ticker: 'SBER',
    interval: 'D',
    from: '2025-01-01',
    to: '2025-12-31',
    ...overrides,
  };
}

function candlesResponse(
  rows: unknown[][],
  columns: string[] = ['begin', 'open', 'high', 'low', 'close', 'volume'],
): Response {
  return jsonResponse({ candles: { columns, data: rows } });
}

function historyResponse(
  rows: unknown[][],
  columns: string[] = ['date', 'open', 'high', 'low', 'close', 'volume'],
): Response {
  return jsonResponse({ history: { meta: { columns }, data: rows } });
}

function mockCandlesWithBars(bars: OHLCVBar[]): void {
  fetchMock.mockResolvedValue(
    candlesResponse(
      bars.map((b) => [b.date, b.open, b.high, b.low, b.close, b.volume]),
    ),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.setCachedRows([]);
});

// ═══════════════════════════════════════════════
// 1. fetchHistoricalData — кэширование
// ═══════════════════════════════════════════════

describe('fetchHistoricalData (кэш)', () => {
  it('должен вернуть данные из кэша, не обращаясь к API', async () => {
    mocks.setCachedRows([
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
    ]);

    const result = await fetchHistoricalData(createRequest());

    expect(result.fromCache).toBe(true);
    expect(result.count).toBe(2);
    expect(result.bars).toHaveLength(2);
    expect(result.bars[0]?.close).toBe(101);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('должен загрузить данные с API и сохранить их при пустом кэше', async () => {
    mocks.setCachedRows([]);
    mockCandlesWithBars([
      {
        date: '2025-01-01 10:00:00',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      },
      {
        date: '2025-01-02 10:00:00',
        open: 101,
        high: 103,
        low: 100,
        close: 102,
        volume: 1100,
      },
    ]);

    const result = await fetchHistoricalData(createRequest());

    expect(result.fromCache).toBe(false);
    expect(result.count).toBe(2);
    expect(result.bars[0]?.date).toBe('2025-01-01 10:00:00');
    expect(result.bars[0]?.close).toBe(101);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('должен использовать candles endpoint с interval=24 для акций', async () => {
    mockCandlesWithBars([
      {
        date: '2025-01-01 10:00:00',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      },
    ]);

    await fetchHistoricalData(createRequest());

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('boards/TQBR/securities/SBER/candles.json'),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('interval=24'),
    );
  });

  it('должен использовать TQOB для облигаций (RU00...)', async () => {
    mockCandlesWithBars([
      {
        date: '2025-01-01 10:00:00',
        open: 1000,
        high: 1005,
        low: 995,
        close: 1002,
        volume: 100,
      },
    ]);

    await fetchHistoricalData(createRequest({ ticker: 'RU000A10FXF8' }));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        'boards/TQOB/securities/RU000A10FXF8/candles.json',
      ),
    );
  });
});

// ═══════════════════════════════════════════════
// 2. fetchHistoricalData — фильтрация и fallback
// ═══════════════════════════════════════════════

describe('fetchHistoricalData (фильтрация и fallback)', () => {
  it('должен отфильтровать свечи по диапазону дат', async () => {
    mockCandlesWithBars([
      {
        date: '2025-01-10 10:00:00',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      },
      {
        date: '2025-01-20 10:00:00',
        open: 101,
        high: 103,
        low: 100,
        close: 102,
        volume: 1100,
      },
      {
        date: '2025-02-01 10:00:00',
        open: 102,
        high: 104,
        low: 101,
        close: 103,
        volume: 1200,
      },
    ]);

    const result = await fetchHistoricalData(
      createRequest({ from: '2025-01-15', to: '2025-01-31' }),
    );

    expect(result.bars).toHaveLength(1);
    expect(result.bars[0]?.date).toBe('2025-01-20 10:00:00');
  });

  it('должен использовать history.json fallback когда candles пустые', async () => {
    fetchMock.mockResolvedValueOnce(candlesResponse([]));
    fetchMock.mockResolvedValueOnce(
      historyResponse([
        ['2025-01-01', 100, 102, 99, 101, 1000],
        ['2025-01-02', 101, 103, 100, 102, 1100],
      ]),
    );

    const result = await fetchHistoricalData(createRequest());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/history.json'),
    );
    expect(result.fromCache).toBe(false);
    expect(result.count).toBe(2);
    expect(result.bars[0]?.date).toBe('2025-01-01');
  });

  it('должен передавать даты в history.json', async () => {
    fetchMock.mockResolvedValueOnce(candlesResponse([]));
    fetchMock.mockResolvedValueOnce(historyResponse([]));

    await fetchHistoricalData(
      createRequest({ from: '2025-03-01', to: '2025-04-30' }),
    );

    const historyCall = fetchMock.mock.calls[1]?.[0] as string | undefined;
    expect(historyCall).toContain('from=2025-03-01');
    expect(historyCall).toContain('to=2025-04-30');
    expect(historyCall).toContain('symbols=SBER');
  });
});

// ═══════════════════════════════════════════════
// 3. fetchHistoricalData — обработка ошибок
// ═══════════════════════════════════════════════

describe('fetchHistoricalData (ошибки)', () => {
  it('должен вернуть пустой результат при HTTP-ошибке', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 500));

    const result = await fetchHistoricalData(createRequest());

    expect(result.count).toBe(0);
    expect(result.bars).toEqual([]);
    expect(result.fromCache).toBe(false);
  });

  it('должен вернуть пустой результат при некорректном JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }));

    const result = await fetchHistoricalData(createRequest());

    expect(result.count).toBe(0);
  });

  it('должен вернуть пустой результат при сетевом сбое', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await fetchHistoricalData(createRequest());

    expect(result.count).toBe(0);
    expect(result.bars).toEqual([]);
  });

  it('должен игнорировать свечи без колонки close', async () => {
    fetchMock.mockResolvedValue(
      candlesResponse([['2025-01-01 10:00:00', 100]], ['begin', 'open']),
    );

    const result = await fetchHistoricalData(createRequest());

    expect(result.count).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// 4. fetchHistoricalBatch
// ═══════════════════════════════════════════════

describe('fetchHistoricalBatch', () => {
  it('должен загрузить данные для нескольких тикеров', async () => {
    mocks.setCachedRows([]);
    mockCandlesWithBars([
      {
        date: '2025-01-01 10:00:00',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      },
    ]);

    const results = await fetchHistoricalBatch(
      ['SBER', 'GAZP'],
      '2025-01-01',
      '2025-12-31',
      'D',
    );

    expect(results.size).toBe(2);
    expect(results.has('SBER')).toBe(true);
    expect(results.has('GAZP')).toBe(true);
    expect(results.get('SBER')).toHaveLength(1);
    expect(results.get('GAZP')).toHaveLength(1);
  });

  it('должен вернуть пустую карту для пустого списка тикеров', async () => {
    const results = await fetchHistoricalBatch([], '2025-01-01', '2025-12-31');

    expect(results.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════
// 5. calculatePriceMetrics
// ═══════════════════════════════════════════════

describe('calculatePriceMetrics', () => {
  it('должен вернуть нули для пустых данных', () => {
    const metrics = calculatePriceMetrics([]);

    expect(metrics.totalReturn).toBe(0);
    expect(metrics.annualizedReturn).toBe(0);
    expect(metrics.volatility).toBe(0);
    expect(metrics.sharpeRatio).toBe(0);
    expect(metrics.maxDrawdown).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.averageVolume).toBe(0);
  });

  it('должен вернуть нули для одного бара', () => {
    const metrics = calculatePriceMetrics([
      {
        date: '2025-01-01',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      },
    ]);

    expect(metrics.totalReturn).toBe(0);
    expect(metrics.volatility).toBe(0);
  });

  it('должен рассчитать метрики для растущего ряда', () => {
    const bars: OHLCVBar[] = [
      {
        date: '2025-09-01',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      },
      {
        date: '2025-09-02',
        open: 101,
        high: 103,
        low: 100,
        close: 102,
        volume: 1100,
      },
      {
        date: '2025-09-03',
        open: 102,
        high: 104,
        low: 101,
        close: 103,
        volume: 1200,
      },
      {
        date: '2025-09-04',
        open: 103,
        high: 105,
        low: 102,
        close: 104,
        volume: 1300,
      },
      {
        date: '2025-09-05',
        open: 104,
        high: 106,
        low: 103,
        close: 105,
        volume: 1400,
      },
    ];

    const metrics = calculatePriceMetrics(bars);

    expect(metrics.totalReturn).toBeGreaterThan(0);
    expect(metrics.annualizedReturn).toBeGreaterThan(0);
    expect(metrics.volatility).toBeGreaterThanOrEqual(0);
    expect(metrics.bestDay).toBeGreaterThan(0);
    expect(metrics.worstDay).toBeGreaterThanOrEqual(0);
    expect(metrics.averageVolume).toBeGreaterThan(0);
  });

  it('должен рассчитать метрики для падающего ряда', () => {
    const bars: OHLCVBar[] = [
      {
        date: '2025-09-01',
        open: 100,
        high: 101,
        low: 99,
        close: 99,
        volume: 1000,
      },
      {
        date: '2025-09-02',
        open: 99,
        high: 100,
        low: 98,
        close: 98,
        volume: 1100,
      },
      {
        date: '2025-09-03',
        open: 98,
        high: 99,
        low: 97,
        close: 97,
        volume: 1200,
      },
      {
        date: '2025-09-04',
        open: 97,
        high: 98,
        low: 96,
        close: 96,
        volume: 1300,
      },
      {
        date: '2025-09-05',
        open: 96,
        high: 97,
        low: 95,
        close: 95,
        volume: 1400,
      },
    ];

    const metrics = calculatePriceMetrics(bars);

    expect(metrics.totalReturn).toBeLessThan(0);
    expect(metrics.annualizedReturn).toBeLessThan(0);
  });

  it('должен рассчитать Max Drawdown ~20%', () => {
    const bars: OHLCVBar[] = [
      {
        date: '2025-09-01',
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1000,
      },
      {
        date: '2025-09-02',
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1000,
      },
      {
        date: '2025-09-03',
        open: 100,
        high: 100,
        low: 80,
        close: 80,
        volume: 1000,
      },
      {
        date: '2025-09-04',
        open: 80,
        high: 80,
        low: 80,
        close: 80,
        volume: 1000,
      },
      {
        date: '2025-09-05',
        open: 80,
        high: 80,
        low: 80,
        close: 80,
        volume: 1000,
      },
    ];

    const metrics = calculatePriceMetrics(bars);

    expect(metrics.maxDrawdown).toBeGreaterThanOrEqual(0.19);
    expect(metrics.maxDrawdown).toBeLessThanOrEqual(0.21);
  });

  it('должен рассчитать Win Rate ~50%', () => {
    const bars: OHLCVBar[] = [
      {
        date: '2025-09-01',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      },
      {
        date: '2025-09-02',
        open: 101,
        high: 103,
        low: 100,
        close: 100,
        volume: 1100,
      },
      {
        date: '2025-09-03',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1200,
      },
      {
        date: '2025-09-04',
        open: 101,
        high: 103,
        low: 100,
        close: 100,
        volume: 1300,
      },
      {
        date: '2025-09-05',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1400,
      },
    ];

    const metrics = calculatePriceMetrics(bars);

    expect(metrics.winRate).toBeGreaterThanOrEqual(0.4);
    expect(metrics.winRate).toBeLessThanOrEqual(0.6);
  });
});

// ═══════════════════════════════════════════════
// 6. formatMetrics
// ═══════════════════════════════════════════════

describe('formatMetrics', () => {
  it('должен отформатировать метрики в строку', () => {
    const metrics = calculatePriceMetrics([
      {
        date: '2025-09-01',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      },
      {
        date: '2025-09-02',
        open: 101,
        high: 103,
        low: 100,
        close: 102,
        volume: 1100,
      },
      {
        date: '2025-09-03',
        open: 102,
        high: 104,
        low: 101,
        close: 103,
        volume: 1200,
      },
    ]);

    const formatted = formatMetrics(metrics);

    expect(formatted).toContain('📊 Метрики');
    expect(formatted).toContain('Доходность:');
    expect(formatted).toContain('Годовая:');
    expect(formatted).toContain('Волатильность:');
    expect(formatted).toContain('Sharpe:');
    expect(formatted).toContain('Max Drawdown:');
    expect(formatted).toContain('Win Rate:');
    expect(formatted).toContain('Лучший день:');
    expect(formatted).toContain('Худший день:');
  });
});
