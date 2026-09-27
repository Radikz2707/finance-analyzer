/**
 * Python Engine Tests — тесты TS↔Python моста и детектора аномалий.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect),
 * а не импорт из 'vitest'. Это требование текущего окружения:
 * import из 'vitest' в воркерах не трансформируется (баг связки
 * vitest 5.x + vite 8.x в этом проекте), globals работают штатно.
 *
 * Покрытие:
 * 1. AnomalyDetector с недоступным Python → TypeScript fallback
 * 2. AnomalyDetector с mock bridge → путь Python (без fallback)
 * 3. detectAnomaliesInTypeScript — математика (детерминированные входы)
 * 4. PythonBridge — ошибки (скрипт не найден)
 */

import {
  AnomalyDetector,
  detectAnomaliesInTypeScript,
  PythonBridge,
} from './index.js';
import type {
  AnomalyDetectionResult,
  IPythonBridge,
  PythonBridgeConfig,
  PythonRequest,
  PriceSeriesInput,
} from './types.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Детерминированная серия цен 100 + sin(i)*amp */
function wavySeries(length: number, amp = 0.8): number[] {
  const prices: number[] = [];
  for (let i = 0; i < length; i++) {
    prices.push(Number((100 + Math.sin(i) * amp).toFixed(4)));
  }
  return prices;
}

/** Монотонный ряд (без аномалий) */
function monotonicSeries(length: number, step = 0.01): number[] {
  const prices: number[] = [];
  for (let i = 0; i < length; i++) {
    prices.push(Number((100 + i * step).toFixed(4)));
  }
  return prices;
}

/** Фейковый bridge для тестирования Python-пути */
class FakeBridge implements IPythonBridge {
  available: boolean;
  data: unknown;
  calls: PythonRequest[] = [];

  constructor(available: boolean, data?: unknown) {
    this.available = available;
    this.data = data;
  }

  async call<T>(request: PythonRequest): Promise<T> {
    this.calls.push(request);
    return this.data as T;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  isScriptAvailable(): boolean {
    return true;
  }
}

// ──────────────────────────────────────────────
// 1. TypeScript fallback (Python недоступен)
// ──────────────────────────────────────────────

describe('AnomalyDetector (TypeScript fallback)', () => {
  let bridge: FakeBridge;
  let detector: AnomalyDetector;

  beforeEach(() => {
    bridge = new FakeBridge(false);
    detector = new AnomalyDetector(bridge);
  });

  it('должен детектировать аномалию на последнем баре при скачке цены', async () => {
    const prices = [...wavySeries(50), 150];
    const results = await detector.detectAnomalies([
      { ticker: 'SBER', prices },
    ]);

    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.ticker).toBe('SBER');
    expect(r.lastPrice).toBe(150);
    expect(r.isLastAnomaly).toBe(true);
    expect(r.zScoreLast).toBeGreaterThan(2);
    expect(r.anomaliesCount).toBeGreaterThanOrEqual(1);
    expect(r.pointsCount).toBe(51);
  });

  it('не должен находить аномалии на монотонной серии', async () => {
    const prices = monotonicSeries(60);
    const results = await detector.detectAnomalies([
      { ticker: 'GAZP', prices },
    ]);

    const r = results[0]!;
    expect(r.isLastAnomaly).toBe(false);
    expect(r.anomaliesCount).toBe(0);
    expect(Math.abs(r.zScoreLast)).toBeLessThan(2);
  });

  it('должен корректно обрабатывать несколько тикеров', async () => {
    const results = await detector.detectAnomalies([
      { ticker: 'SBER', prices: [...wavySeries(40), 200] },
      { ticker: 'GAZP', prices: monotonicSeries(40) },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.ticker).toBe('SBER');
    expect(results[0]!.isLastAnomaly).toBe(true);
    expect(results[1]!.ticker).toBe('GAZP');
    expect(results[1]!.isLastAnomaly).toBe(false);
  });

  it('должен вернуть безопасный результат для серии короче окна', async () => {
    const results = await detector.detectAnomalies([
      { ticker: 'LKOH', prices: [100, 101, 102] },
    ]);

    const r = results[0]!;
    expect(r.pointsCount).toBe(3);
    expect(r.isLastAnomaly).toBe(false);
    expect(r.anomalies).toEqual([]);
    expect(r.sma20).toBeNull();
  });

  it('должен вернуть пустой массив без входных данных', async () => {
    const results = await detector.detectAnomalies([]);
    expect(results).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// 2. Python-путь (mock bridge доступен)
// ──────────────────────────────────────────────

describe('AnomalyDetector (Python путь)', () => {
  it('должен передать запрос в Python и вернуть его данные', async () => {
    const pythonData: AnomalyDetectionResult[] = [
      {
        ticker: 'FROM_PYTHON',
        lastPrice: 123.45,
        zScoreLast: 3.1,
        isLastAnomaly: true,
        volatilityAnnual: 0.35,
        rsi: 71.2,
        sma20: 120,
        sma50: 118,
        trend: 'up',
        riskLevel: 'high',
        anomaliesCount: 2,
        pointsCount: 60,
        anomalies: [],
      },
    ];
    const bridge = new FakeBridge(true, pythonData);
    const detector = new AnomalyDetector(bridge);

    const results = await detector.detectAnomalies([
      { ticker: 'SBER', prices: wavySeries(60) },
    ]);

    expect(results).toEqual(pythonData);
    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0]!.command).toBe('detect_anomalies');
    expect(bridge.calls[0]!.payload?.series).toHaveLength(1);
    expect(bridge.calls[0]!.config?.zScoreThreshold).toBe(2);
  });

  it('должен переключиться на fallback при ошибке Python', async () => {
    // Эмулируем зависший/упавший Python-процесс
    const brokenBridge: IPythonBridge = {
      async call(): Promise<never> {
        throw new Error('python crashed');
      },
      async isAvailable(): Promise<boolean> {
        return true;
      },
      isScriptAvailable(): boolean {
        return true;
      },
    };
    const detector = new AnomalyDetector(brokenBridge);

    const results = await detector.detectAnomalies([
      { ticker: 'SBER', prices: [...wavySeries(40), 500] },
    ]);

    expect(results[0]!.ticker).toBe('SBER');
    expect(results[0]!.isLastAnomaly).toBe(true);
  });
});

// ──────────────────────────────────────────────
// 3. Чистая математика (detectAnomaliesInTypeScript)
// ──────────────────────────────────────────────

describe('detectAnomaliesInTypeScript', () => {
  it('должен рассчитать SMA20/SMA50 и тренд для восходящего ряда', () => {
    const input: PriceSeriesInput = {
      ticker: 'SBER',
      prices: monotonicSeries(80),
    };

    const result = detectAnomaliesInTypeScript(input);
    expect(result.sma20).not.toBeNull();
    expect(result.sma50).not.toBeNull();
    expect(result.trend).toBe('up');
    expect(result.riskLevel).toBeDefined();
  });

  it('должен корректно маркировать точки аномалий внутри серии', () => {
    const prices = wavySeries(30);
    // Выброс на индексе >= window (20), иначе точка попадает в "слепую зону" Z-score
    prices[25] = 999;
    const input: PriceSeriesInput = { ticker: 'SBER', prices };

    const result = detectAnomaliesInTypeScript(input);
    expect(result.anomaliesCount).toBeGreaterThanOrEqual(1);

    const spike = result.anomalies.find((a) => a.index === 25);
    expect(spike).toBeDefined();
    expect(spike!.price).toBe(999);
    expect(spike!.isAnomaly).toBe(true);
  });

  it('должен сохранять даты из входных данных', () => {
    const dates = Array.from(
      { length: 60 },
      (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`,
    );
    const result = detectAnomaliesInTypeScript({
      ticker: 'SBER',
      prices: monotonicSeries(60),
      dates,
    });

    expect(result.anomalies.every((a) => a.date !== null)).toBe(true);
  });
});

// ──────────────────────────────────────────────
// 4. PythonBridge (ошибки)
// ──────────────────────────────────────────────

describe('PythonBridge', () => {
  it('isScriptAvailable() = false для несуществующего скрипта', () => {
    const bridge = new PythonBridge({ scriptPath: 'nonexistent-main.py' });
    expect(bridge.isScriptAvailable()).toBe(false);
  });

  it('isScriptAvailable() = true для дефолтного пути движка', () => {
    const bridge = new PythonBridge();
    expect(bridge.isScriptAvailable()).toBe(true);
  });

  it('call() должен отклониться, если скрипт не найден', async () => {
    const bridge = new PythonBridge({ scriptPath: 'nonexistent-main.py' });
    await expect(bridge.call({ command: 'health' })).rejects.toThrow(
      /не найден/,
    );
  });
});

// ──────────────────────────────────────────────
// 5. PythonBridge (retry через подкласс runProcess)
// ──────────────────────────────────────────────

/** Подкласс с переопределённым runProcess для проверки retry-логики */
class FlakyBridge extends PythonBridge {
  /** Сколько первых вызовов runProcess бросают ошибку */
  attempts = 0;

  constructor(
    private readonly failFirstAttempts: number,
    private readonly result: unknown,
    config: Partial<PythonBridgeConfig> = {},
  ) {
    super({ retryDelayMs: 1, ...config });
  }

  protected async runProcess<T>(_request: PythonRequest): Promise<T> {
    this.attempts += 1;
    if (this.attempts <= this.failFirstAttempts) {
      throw new Error(`flaky failure #${this.attempts}`);
    }
    return this.result as T;
  }
}

describe('PythonBridge (retry)', () => {
  it('первая попытка падает, повтор успешен (дефолт retries=1)', async () => {
    const bridge = new FlakyBridge(1, { ok: true });
    const data = await bridge.call({ command: 'health' });
    expect(data).toEqual({ ok: true });
    expect(bridge.attempts).toBe(2); // первая + 1 повтор
  });

  it('несколько повторов: retries=2, падают первые 2 попытки', async () => {
    const bridge = new FlakyBridge(2, { ok: true }, { retries: 2 });
    const data = await bridge.call({ command: 'health' });
    expect(data).toEqual({ ok: true });
    expect(bridge.attempts).toBe(3);
  });

  it('все попытки падают → throw (после исчерпания повторов)', async () => {
    const bridge = new FlakyBridge(99, { ok: true });
    await expect(bridge.call({ command: 'health' })).rejects.toThrow(
      /flaky failure/,
    );
    // дефолт retries=1 → ровно 2 попытки
    expect(bridge.attempts).toBe(2);
  });

  it('retries=0 → ровно одна попытка без повторов', async () => {
    const bridge = new FlakyBridge(1, { ok: true }, { retries: 0 });
    await expect(bridge.call({ command: 'health' })).rejects.toThrow(
      /flaky failure/,
    );
    expect(bridge.attempts).toBe(1);
  });

  it('скрипт не найден → throw БЕЗ повторов (runProcess не вызывается)', async () => {
    const bridge = new FlakyBridge(
      0,
      { ok: true },
      { scriptPath: 'nonexistent-main.py' },
    );
    await expect(bridge.call({ command: 'health' })).rejects.toThrow(
      /не найден/,
    );
    expect(bridge.attempts).toBe(0);
  });

  it('isAvailable() = true после успешного повтора (health с retry)', async () => {
    const bridge = new FlakyBridge(1, { python: '3.14', commands: [] });
    const available = await bridge.isAvailable();
    expect(available).toBe(true);
    expect(bridge.attempts).toBe(2);
  });

  it('isAvailable() = false при исчерпании попыток', async () => {
    const bridge = new FlakyBridge(99, { ok: true });
    const available = await bridge.isAvailable();
    expect(available).toBe(false);
  });
});
