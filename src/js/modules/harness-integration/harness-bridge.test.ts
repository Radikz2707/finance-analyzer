/**
 * Harness Bridge Tests — агрегатор состояния для UI-интеграции.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect/vi),
 * а не импорт из 'vitest' (ограничение окружения: vitest 5.x + vite 8.x).
 *
 * Покрытие:
 * 1. Пустой мост: scheduler null, пустые аномалии и QUIK-раздел
 * 2. Полный payload: диспетчер + аномалии + новости QUIK + активные заявки
 * 3. attachScheduler(null) сбрасывает ссылку на диспетчер
 * 4. QUIK-канал недоступен → пустые новости и 0 заявок (остальное живо)
 * 5. Ошибка источника аномалий → пустой список, payload не падает
 */

import { HarnessBridge } from './index.js';
import { AdaptiveScheduler } from '../adaptive-scheduler/adaptive-scheduler.js';
import type { IResourceSource } from '../resource-monitor/types.js';
import type { AnomalyDetectionResult } from '../python-engine/types.js';
import type { QuikNewsRecord } from '../quik-gateway/types.js';
import type { QuikOrder } from '../xlsx-parser/quik-orders-parser.js';

/** Фейковый источник ресурсов: свободная система (RAM ~50%) */
class FakeResourceSource implements IResourceSource {
  idle = 80_000;
  total = 100_000;
  totalMemory = 16 * 1024 ** 3;
  freeMemory = 8 * 1024 ** 3;
  busy = false;

  readCpuTimes() {
    return { idle: this.idle, total: this.total };
  }

  readProcessCpuUsage() {
    return { user: 0, system: 0 };
  }

  totalmem() {
    return this.totalMemory;
  }

  freemem() {
    return this.busy ? 1 * 1024 ** 3 : this.freeMemory;
  }
}

/**
 * Диспетчер в режиме active со снятым снимком ресурсов.
 * start() обязателен: до него режим всегда 'manual' (автозапуск выключен).
 * Fake-таймеры нужны, чтобы интервал опроса не удерживал процесс.
 */
function makeScheduler(): AdaptiveScheduler {
  vi.useFakeTimers();
  const scheduler = new AdaptiveScheduler(async () => {}, {
    resourceSource: new FakeResourceSource(),
    minRunIntervalMs: 0,
  });
  scheduler.start();
  return scheduler;
}

/** Полноценный результат детекции аномалий для одного тикера */
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

/** Заявка QUIK (минимальный набор полей QuikOrder) */
function makeQuikOrder(number: string): QuikOrder {
  return {
    number,
    ticker: 'SBER',
    operation: 'BUY',
    qty: 10,
    price: 250,
    pricePercent: 0,
    isBond: false,
    sum: 2500,
    status: 'АКТИВНА',
    account: 'TEST',
  };
}

/** Новость QUIK */
function makeNews(id: string, text: string): QuikNewsRecord {
  return { id, time: '2026-09-26T12:00:00', text };
}

/** Мок QUIK-фасада (структурно совместим с Pick<QuikGateway, ...>) */
function makeGatewayMock(options?: {
  available?: boolean;
  news?: QuikNewsRecord[];
  orders?: QuikOrder[];
  throwOnAvailable?: boolean;
}) {
  const { available = true, news = [], orders = [] } = options ?? {};
  return {
    isAvailable: vi.fn(async () => {
      if (options?.throwOnAvailable) {
        throw new Error('fs error');
      }
      return available;
    }),
    readNews: vi.fn(async () => news),
    readOrders: vi.fn(async () => orders),
  };
}

describe('HarnessBridge', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('без диспетчера и зависимостей возвращает пустой payload', async () => {
    const bridge = new HarnessBridge();

    const payload = await bridge.getDashboardPayload();

    expect(payload.scheduler).toBeNull();
    expect(payload.anomalies).toEqual([]);
    expect(payload.quikNews).toEqual([]);
    expect(payload.activeOrdersCount).toBe(0);
    expect(typeof payload.generatedAt).toBe('string');
    expect(payload.generatedAt.length).toBeGreaterThan(0);
  });

  it('loadAnomalies маппится в AnomalyBrief; без loadAnomalies список пуст', async () => {
    const loadAnomalies = vi.fn(async () => [
      makeAnomalyResult('SBER'),
      makeAnomalyResult('GAZP', {
        zScoreLast: -1.2,
        isLastAnomaly: false,
        riskLevel: 'low',
        volatilityAnnual: 25.5,
      }),
    ]);

    const bridgeWithSource = new HarnessBridge({ loadAnomalies });
    const payload = await bridgeWithSource.getDashboardPayload();

    // Каждый результат детекции сжат до компактного AnomalyBrief
    expect(payload.anomalies).toHaveLength(2);
    expect(payload.anomalies[0]).toEqual({
      ticker: 'SBER',
      zScoreLast: 2.5,
      isLastAnomaly: true,
      riskLevel: 'high',
      volatilityAnnual: 42.3,
    });
    expect(payload.anomalies[1]).toEqual({
      ticker: 'GAZP',
      zScoreLast: -1.2,
      isLastAnomaly: false,
      riskLevel: 'low',
      volatilityAnnual: 25.5,
    });
    expect(loadAnomalies).toHaveBeenCalledTimes(1);

    // Обратная совместимость: без источника — пустой список без падений
    const bridgeWithoutSource = new HarnessBridge();
    const emptyPayload = await bridgeWithoutSource.getDashboardPayload();
    expect(emptyPayload.anomalies).toEqual([]);
  });

  it('полный payload: диспетчер, аномалии, новости QUIK (до 10) и заявки', async () => {
    const news = Array.from({ length: 12 }, (_, i) =>
      makeNews(`n${i}`, `Новость ${i}`),
    );
    const gateway = makeGatewayMock({
      news,
      orders: [makeQuikOrder('1'), makeQuikOrder('2')],
    });
    const loadAnomalies = vi.fn(async () => [
      makeAnomalyResult('SBER'),
      makeAnomalyResult('GAZP', {
        zScoreLast: -1.2,
        isLastAnomaly: false,
        riskLevel: 'low',
      }),
    ]);

    const bridge = new HarnessBridge({ gateway, loadAnomalies });
    bridge.attachScheduler(makeScheduler());

    const payload = await bridge.getDashboardPayload();

    // Диспетчер
    expect(payload.scheduler).not.toBeNull();
    expect(payload.scheduler?.mode).toBe('active');
    expect(payload.scheduler?.cpuUsagePct).toBe(0);
    expect(payload.scheduler?.memoryUsagePct).toBeGreaterThan(0);
    expect(payload.scheduler?.lastRunAt).not.toBeNull();
    expect(payload.scheduler?.skippedCycles).toBe(0);

    // Аномалии
    expect(payload.anomalies).toHaveLength(2);
    expect(payload.anomalies[0]).toEqual({
      ticker: 'SBER',
      zScoreLast: 2.5,
      isLastAnomaly: true,
      riskLevel: 'high',
      volatilityAnnual: 42.3,
    });

    // QUIK: новости обрезаны до 10, заявок 2
    expect(payload.quikNews).toHaveLength(10);
    expect(payload.quikNews[0]).toEqual({
      time: '2026-09-26T12:00:00',
      text: 'Новость 0',
      sourceName: 'QUIK',
    });
    expect(payload.activeOrdersCount).toBe(2);

    // Источники действительно вызывались
    expect(gateway.isAvailable).toHaveBeenCalledTimes(1);
    expect(gateway.readNews).toHaveBeenCalledTimes(1);
    expect(gateway.readOrders).toHaveBeenCalledTimes(1);
    expect(loadAnomalies).toHaveBeenCalledTimes(1);
  });

  it('attachScheduler(null) сбрасывает ссылку на диспетчер', async () => {
    const bridge = new HarnessBridge();
    bridge.attachScheduler(makeScheduler());
    expect(bridge.getScheduler()).not.toBeNull();

    bridge.attachScheduler(null);

    expect(bridge.getScheduler()).toBeNull();
    const payload = await bridge.getDashboardPayload();
    expect(payload.scheduler).toBeNull();
  });

  it('недоступный QUIK-канал даёт пустые новости и 0 заявок, остальное живо', async () => {
    const gateway = makeGatewayMock({ available: false });
    const loadAnomalies = vi.fn(async () => [makeAnomalyResult('SBER')]);

    const bridge = new HarnessBridge({ gateway, loadAnomalies });
    bridge.attachScheduler(makeScheduler());

    const payload = await bridge.getDashboardPayload();

    expect(payload.quikNews).toEqual([]);
    expect(payload.activeOrdersCount).toBe(0);
    expect(payload.anomalies).toHaveLength(1);
    expect(payload.scheduler).not.toBeNull();
    expect(gateway.readNews).not.toHaveBeenCalled();
    expect(gateway.readOrders).not.toHaveBeenCalled();
  });

  it('ошибка источника аномалий не роняет payload — список пуст', async () => {
    const loadAnomalies = vi.fn(async () => {
      throw new Error('python unavailable');
    });
    const gateway = makeGatewayMock({
      news: [makeNews('n1', 'Срочная новость')],
      orders: [makeQuikOrder('1')],
    });

    const bridge = new HarnessBridge({ gateway, loadAnomalies });
    bridge.attachScheduler(makeScheduler());

    const payload = await bridge.getDashboardPayload();

    expect(payload.anomalies).toEqual([]);
    expect(payload.quikNews).toHaveLength(1);
    expect(payload.activeOrdersCount).toBe(1);
    expect(payload.scheduler).not.toBeNull();
  });

  it('ошибка QUIK-фасада (fs) не роняет payload — раздел пуст', async () => {
    const gateway = makeGatewayMock({ throwOnAvailable: true });
    const loadAnomalies = vi.fn(async () => [makeAnomalyResult('SBER')]);

    const bridge = new HarnessBridge({ gateway, loadAnomalies });
    bridge.attachScheduler(makeScheduler());

    const payload = await bridge.getDashboardPayload();

    expect(payload.quikNews).toEqual([]);
    expect(payload.activeOrdersCount).toBe(0);
    expect(payload.anomalies).toHaveLength(1);
    expect(payload.scheduler).not.toBeNull();
  });
});
