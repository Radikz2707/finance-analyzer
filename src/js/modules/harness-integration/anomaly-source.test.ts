/**
 * Anomaly Source Tests — источник живых z-score аномалий для HarnessBridge.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect/vi),
 * а не импорт из 'vitest' (ограничение окружения: vitest 5.x + vite 8.x).
 *
 * Покрытие:
 * 1. Нет тикеров → [] (загрузчик и детектор не вызываются)
 * 2. Мок-источник → серии >= 21 бара передаются детектору, результат проброшен
 * 3. Короткие серии (< 21 бара) отфильтровываются до детектора
 * 4. Ошибка загрузчика истории → [] (детектор не вызывается)
 * 5. Ошибка источника тикеров → []
 */

// Изолируем тест от Node-цепочки anomaly-source.ts: история Finam тянет
// better-sqlite3 (db-manager), детектор — PythonBridge, xlsx — fs/xlsx.
// Все зависимости в тесте подменяются через DI, поэтому моки пустые.
vi.mock('../finam-api/history-provider.js', () => ({
  fetchHistoricalBatch: vi.fn(),
}));
vi.mock('../python-engine/anomaly-detector.js', () => ({
  AnomalyDetector: class {
    detectAnomalies() {
      return [];
    }
  },
}));
vi.mock('../xlsx-parser/xlsx-parser.js', () => ({
  XlsxParserModule: class {},
}));

import { createAnomalySource } from './anomaly-source.js';
import type { AnomalyDetectionResult } from '../python-engine/types.js';
import type { OHLCVBar } from '../finam-api/history-provider.js';

/** Сгенерировать массив свечей заданной длины с близкой ценой */
function makeBars(count: number, startPrice = 100): OHLCVBar[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: startPrice + i,
    high: startPrice + i + 1,
    low: startPrice + i - 1,
    close: startPrice + i,
    volume: 1000,
  }));
}

/** Полноценный результат детекции для одного тикера */
function makeAnomalyResult(
  ticker: string,
  overrides: Partial<AnomalyDetectionResult> = {},
): AnomalyDetectionResult {
  return {
    ticker,
    lastPrice: 100,
    zScoreLast: 2.5,
    isLastAnomaly: true,
    volatilityAnnual: 42.3,
    rsi: 70,
    sma20: 99,
    sma50: 95,
    trend: 'up',
    riskLevel: 'high',
    anomaliesCount: 3,
    pointsCount: 30,
    anomalies: [],
    ...overrides,
  };
}

/** Мок детектора: возвращает результат для каждого тикера серии */
function makeDetectorMock() {
  return {
    detectAnomalies: vi.fn(async (series: Array<{ ticker: string }>) =>
      series.map((s) => makeAnomalyResult(s.ticker)),
    ),
  };
}

describe('AnomalySource', () => {
  it('нет тикеров портфеля → [] без вызова загрузчика и детектора', async () => {
    const fetchHistory = vi.fn();
    const detector = makeDetectorMock();

    const source = createAnomalySource({
      getTickers: async () => [],
      fetchHistory,
      detector,
    });

    const result = await source.load();

    expect(result).toEqual([]);
    expect(fetchHistory).not.toHaveBeenCalled();
    expect(detector.detectAnomalies).not.toHaveBeenCalled();
  });

  it('мок-источник: серии >= 21 бара передаются детектору, результат проброшен', async () => {
    const fetchHistory = vi.fn(
      async (
        _tickers: string[],
        _from: string,
        _to: string,
        interval: string,
      ) => {
        expect(interval).toBe('D');
        return new Map([
          ['SBER', makeBars(30, 250)],
          ['GAZP', makeBars(30, 200)],
        ]);
      },
    );
    const detector = makeDetectorMock();

    const source = createAnomalySource({
      getTickers: async () => ['SBER', 'GAZP'],
      fetchHistory,
      detector,
    });

    const result = await source.load();

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.ticker)).toEqual(['SBER', 'GAZP']);
    expect(result[0]!.zScoreLast).toBe(2.5);

    // Детектор получил обе серии с ценами закрытия и датами
    const seriesArg = (detector.detectAnomalies as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as Array<{
      ticker: string;
      prices: number[];
      dates: string[];
    }>;
    expect(seriesArg).toHaveLength(2);
    expect(seriesArg[0]!.ticker).toBe('SBER');
    expect(seriesArg[0]!.prices).toHaveLength(30);
    expect(seriesArg[0]!.dates).toHaveLength(30);
  });

  it('серии короче 21 бара отфильтровываются до детектора', async () => {
    const fetchHistory = vi.fn(
      async () =>
        new Map([
          ['SBER', makeBars(30)],
          ['SHORT', makeBars(5)],
        ]),
    );
    const detector = makeDetectorMock();

    const source = createAnomalySource({
      getTickers: async () => ['SBER', 'SHORT'],
      fetchHistory,
      detector,
    });

    await source.load();

    const seriesArg = (detector.detectAnomalies as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as Array<{ ticker: string }>;
    expect(seriesArg).toHaveLength(1);
    expect(seriesArg[0]!.ticker).toBe('SBER');
  });

  it('ошибка загрузчика истории → [] (детектор не вызывается)', async () => {
    const fetchHistory = vi.fn(async () => {
      throw new Error('finam unavailable');
    });
    const detector = makeDetectorMock();

    const source = createAnomalySource({
      getTickers: async () => ['SBER'],
      fetchHistory,
      detector,
    });

    const result = await source.load();

    expect(result).toEqual([]);
    expect(detector.detectAnomalies).not.toHaveBeenCalled();
  });

  it('ошибка источника тикеров (нет Excel) → []', async () => {
    const fetchHistory = vi.fn();
    const detector = makeDetectorMock();

    const source = createAnomalySource({
      getTickers: async () => {
        throw new Error('file not found');
      },
      fetchHistory,
      detector,
    });

    const result = await source.load();

    expect(result).toEqual([]);
    expect(fetchHistory).not.toHaveBeenCalled();
    expect(detector.detectAnomalies).not.toHaveBeenCalled();
  });
});
