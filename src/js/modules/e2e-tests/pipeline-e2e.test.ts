/**
 * Pipeline E2E Tests — сквозной прогон конвейера БЕЗ внешней сети и БЕЗ AI.
 *
 * Цепочка: Quik/RSS/MOEX → Gatekeeper → DataAgentOutput → Python Engine
 * (аномалии) → Analysis → InteractiveOrders → ReviewAgent.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect),
 * а не импорт из 'vitest' — требование текущего окружения (см. другие тесты).
 *
 * Сетевая независимость:
 * - RSS/MOEX заменены моками с фиксированными RawNewsItem[];
 * - QUIK читается из временного каталога os.tmpdir() (реальный QuikNewsSource);
 * - Python вызывается через реальный AnomalyDetector, но с bridge,
 *   помеченным как недоступный → детерминированный TypeScript-fallback
 *   (та же математика, что и в src/python/anomalies.py).
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Gatekeeper } from '../pipeline/gatekeeper/index.js';
import type {
  GatekeeperResult,
  INewsSource,
  NewsSource,
  RawNewsItem,
} from '../pipeline/gatekeeper/types.js';
import { QuikNewsSource } from '../quik-gateway/index.js';
import type { QuikNewsRecord } from '../quik-gateway/types.js';
import { AnomalyDetector } from '../python-engine/index.js';
import type {
  AnomalyDetectionResult,
  IPythonBridge,
  PriceSeriesInput,
} from '../python-engine/types.js';
import { buildInteractiveOrders } from '../pipeline/orders/interactive-orders.js';
import type { InteractiveOrder } from '../pipeline/orders/interactive-orders.js';
import {
  checkGuardrails,
  validateAllRecommendations,
} from '../pipeline/guardrails/guardrails.js';
import { ReviewAgent } from '../pipeline/review/review-agent.js';
import type { ReviewResult } from '../pipeline/review/review-agent.js';
import type { DataAgentOutput } from '../pipeline/agents/data-agent.js';
import type { AnalysisAgentOutput } from '../pipeline/agents/analysis-agent.js';
import type { AiAgentOutput } from '../pipeline/agents/ai-agent.js';
import type { AssetAnalysis } from '../portfolio-math/portfolio-math.js';
import type { PortfolioPosition } from '../db-manager/types.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Детерминированная серия цен 100 + sin(i)*amp (без аномалий) */
function wavySeries(length: number, amp = 0.8): number[] {
  const prices: number[] = [];
  for (let i = 0; i < length; i++) {
    prices.push(Number((100 + Math.sin(i) * amp).toFixed(4)));
  }
  return prices;
}

/** Имя файла новостей QUIK: news_ГГГГММДД.json (локальная дата) */
function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${mm}${dd}`;
}

/** Мок источника новостей (вместо RssNewsSource / MoexNewsSource) */
function makeMockSource(name: NewsSource, items: RawNewsItem[]): INewsSource {
  return {
    name,
    enabled: true,
    async fetch(): Promise<RawNewsItem[]> {
      return items;
    },
    async healthCheck(): Promise<boolean> {
      return true;
    },
  };
}

/** Bridge, эмулирующий недоступность Python → детерминированный fallback */
const unavailablePythonBridge: IPythonBridge = {
  async call<T>(): Promise<T> {
    throw new Error('python unavailable (e2e)');
  },
  async isAvailable(): Promise<boolean> {
    return false;
  },
  isScriptAvailable(): boolean {
    return true;
  },
};

// ──────────────────────────────────────────────
// E2E-тест
// ──────────────────────────────────────────────

describe('E2E: сквозной конвейер (без сети и AI)', () => {
  let tmpDir: string;

  // Результаты звеньев конвейера (заполняются в beforeAll)
  let gatekeeperResult: GatekeeperResult;
  let anomalies: AnomalyDetectionResult[];

  beforeAll(async () => {
    // ─── Шаг A: источники новостей ───
    // 1. Реальный QuikNewsSource читает JSON из временного каталога
    tmpDir = path.join(
      os.tmpdir(),
      `finance-analyzer-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });

    const nowIso = new Date().toISOString();
    const quikRecords: QuikNewsRecord[] = [
      {
        id: 'e2e-quik-0001',
        className: 'info',
        time: nowIso,
        text: 'SBER: банк повысил прогноз по чистой прибыли на текущий год',
      },
    ];
    await fs.writeFile(
      path.join(tmpDir, `news_${todayStamp()}.json`),
      JSON.stringify(quikRecords),
      'utf-8',
    );

    const quikSource = new QuikNewsSource({
      enabled: true,
      newsDir: tmpDir,
      daysBack: 0,
    });

    // 2. RSS/MOEX — моки с фиксированными новостями (без сети)
    const rssMock = makeMockSource('custom_rss', [
      {
        title: 'GAZP объявил о дивидендах за прошлый год',
        description: 'Газпром утвердил размер дивидендов на одну акцию.',
        url: 'https://example.com/rss/gazp-dividends',
        date: nowIso,
        metadata: { sourceName: 'mock-rss' },
      },
    ]);

    const moexNoise: RawNewsItem = {
      title: 'Анонс вебинара по трейдингу',
      description: 'Мероприятие пройдёт на следующей неделе.',
      url: 'https://example.com/moex/webinar',
      date: nowIso,
    };
    const moexNotRelevant: RawNewsItem = {
      title: 'Московская биржа представила отчёт по оборотам',
      description: 'Обороты торгов выросли по всем секциям.',
      url: 'https://example.com/moex/report',
      date: nowIso,
    };
    const moexMock = makeMockSource('moex', [moexNoise, moexNotRelevant]);

    // ─── Шаг B: реальный Gatekeeper ───
    const gatekeeper = new Gatekeeper(
      { monitoredTickers: ['SBER', 'GAZP'], verbose: false },
      [rssMock, moexMock, quikSource],
    );
    gatekeeperResult = await gatekeeper.run();

    // ─── Шаг C: Python Engine (аномалии) ───
    const detector = new AnomalyDetector(unavailablePythonBridge);
    const series: PriceSeriesInput[] = [
      // SBER: резкий скачок цены на последнем баре → аномалия
      { ticker: 'SBER', prices: [...wavySeries(50), 150] },
      // GAZP: стабильная цена без изменений → аномалий нет
      { ticker: 'GAZP', prices: Array.from({ length: 60 }, () => 200) },
    ];
    anomalies = await detector.detectAnomalies(series);
  });

  afterAll(async () => {
    // Очистка временных файлов
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('Шаг B: Gatekeeper одобряет новости по тикерам и отсекает шум', () => {
    expect(gatekeeperResult.approvedNews.length).toBe(2);

    const sberNews = gatekeeperResult.approvedNews.find((n) =>
      n.relevantTickers.includes('SBER'),
    );
    const gazpNews = gatekeeperResult.approvedNews.find((n) =>
      n.relevantTickers.includes('GAZP'),
    );

    expect(sberNews).toBeDefined();
    expect(sberNews!.filterStatus).toBe('approved');
    expect(sberNews!.title).toContain('SBER');
    // Gatekeeper нормализует все источники в 'custom_rss' (реальное поведение
    // normalizeRaw); исходный источник сохраняется в rawData.metadata
    expect(sberNews!.rawData?.sourceName).toBe('quik');

    expect(gazpNews).toBeDefined();
    expect(gazpNews!.filterStatus).toBe('approved');
    expect(gazpNews!.rawData?.sourceName).toBe('mock-rss');

    // Шум отфильтрован
    expect(
      gatekeeperResult.filteredOut.byReason.noise ?? 0,
    ).toBeGreaterThanOrEqual(1);
    // Новость без тикеров отфильтрована как нерелевантная
    expect(
      gatekeeperResult.filteredOut.byReason.not_relevant ?? 0,
    ).toBeGreaterThanOrEqual(1);

    // Статистика по источникам: total считается по исходному источнику,
    // approved — после нормализации (Gatekeeper сводит все источники
    // к 'custom_rss', поэтому одобренные QUIK/RSS числятся как custom_rss)
    expect(gatekeeperResult.sourceStats.quik.total).toBe(1);
    expect(gatekeeperResult.sourceStats.quik.approved).toBe(0);
    expect(gatekeeperResult.sourceStats.custom_rss.total).toBe(1);
    expect(gatekeeperResult.sourceStats.custom_rss.approved).toBe(2);
    expect(gatekeeperResult.sourceStats.moex.total).toBe(2);
    expect(gatekeeperResult.sourceStats.moex.approved).toBe(0);
  });

  it('Шаг C: Python Engine — SBER с аномалией, GAZP стабилен', () => {
    expect(anomalies).toHaveLength(2);

    const sber = anomalies.find((a) => a.ticker === 'SBER');
    const gazp = anomalies.find((a) => a.ticker === 'GAZP');

    expect(sber).toBeDefined();
    expect(sber!.lastPrice).toBe(150);
    expect(sber!.isLastAnomaly).toBe(true);
    expect(sber!.zScoreLast).toBeGreaterThan(2);
    expect(sber!.riskLevel).toBe('high');

    expect(gazp).toBeDefined();
    expect(gazp!.isLastAnomaly).toBe(false);
    expect(gazp!.riskLevel).toBe('low');
    expect(gazp!.anomaliesCount).toBe(0);
  });

  it('Шаг D: InteractiveOrders + guardrail RECOVERY_ONLY блокирует SELL/REDUCE', () => {
    // Анализ активов: SBER (профицит → REDUCE), GAZP (дефицит → BUY)
    const sberAnalysis: AssetAnalysis = {
      name: 'Сбербанк',
      ticker: 'SBER',
      assetType: 'STOCK',
      currentPercent: 12,
      targetPercent: 8,
      deficitRub: -500000,
      status: 'REDUCE',
      dynamicsPercent: 1.2,
      dailyDynamicsPercent: 0.8,
      nkdRub: 0,
      nominal: 1,
      quantity: 500,
      balancePrice: 260,
      currentPrice: 240,
      unrealizedProfitRub: -10000,
      priority: 1,
      isConcentrated: false,
    };
    const gazpAnalysis: AssetAnalysis = {
      name: 'Газпром',
      ticker: 'GAZP',
      assetType: 'STOCK',
      currentPercent: 4,
      targetPercent: 6,
      deficitRub: 120000,
      status: 'BUY',
      dynamicsPercent: 0.5,
      dailyDynamicsPercent: 0.3,
      nkdRub: 0,
      nominal: 1,
      quantity: 100,
      balancePrice: 150,
      currentPrice: 160,
      unrealizedProfitRub: 1000,
      priority: 2,
      isConcentrated: false,
    };
    const assetsAnalysis = [sberAnalysis, gazpAnalysis];

    // Реальный генератор интерактивных ордеров
    const orders: InteractiveOrder[] = buildInteractiveOrders(assetsAnalysis);
    expect(orders).toHaveLength(2);

    const sberOrder = orders.find((o) => o.ticker === 'SBER');
    const gazpOrder = orders.find((o) => o.ticker === 'GAZP');

    expect(sberOrder).toBeDefined();
    expect(sberOrder!.action).toBe('REDUCE');
    expect(gazpOrder).toBeDefined();
    expect(gazpOrder!.action).toBe('BUY');

    // Стратегический запрет: ни один ордер НЕ является SELL
    expect(orders.some((o) => o.action === 'SELL')).toBe(false);

    // Guardrails: актив SBER в режиме RECOVERY_ONLY (запрет фиксации убытка)
    const sberPosition: PortfolioPosition = {
      ticker: 'SBER',
      name: 'Сбербанк',
      assetType: 'STOCK',
      issuer: 'ПАО Сбербанк',
      currency: 'RUB',
      market: 'MOEX',
      quantity: 500,
      avgPrice: 260,
      totalCost: 130000,
      currentPrice: 240,
      currentMarketValue: 120000,
      targetPercent: 8,
      status: 'RECOVERY_ONLY',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const positionsRepo = {
      getByTicker: (ticker: string): PortfolioPosition | undefined =>
        ticker === 'SBER' ? sberPosition : undefined,
      getAll: (): PortfolioPosition[] => [sberPosition],
    };

    // SELL для RECOVERY_ONLY → заблокирован
    const sellCheck = checkGuardrails(
      'SELL',
      'SBER',
      positionsRepo,
      assetsAnalysis,
    );
    expect(sellCheck.isSafe).toBe(false);
    expect(sellCheck.blockedActions).toHaveLength(1);
    expect(sellCheck.blockedActions[0]).toMatchObject({
      ticker: 'SBER',
      action: 'SELL',
    });
    expect(sellCheck.blockedActions[0]!.reason).toContain('RECOVERY_ONLY');

    // REDUCE (реальное действие сгенерированного ордера) → тоже заблокирован
    const reduceCheck = checkGuardrails(
      'REDUCE',
      'SBER',
      positionsRepo,
      assetsAnalysis,
    );
    expect(reduceCheck.isSafe).toBe(false);

    // Обычный актив без ограничений → BUY безопасен
    const buyCheck = checkGuardrails(
      'BUY',
      'GAZP',
      positionsRepo,
      assetsAnalysis,
    );
    expect(buyCheck.isSafe).toBe(true);

    // Массовая проверка рекомендаций блокирует только SBER
    const allCheck = validateAllRecommendations(
      [
        { ticker: 'SBER', action: 'SELL' },
        { ticker: 'GAZP', action: 'BUY' },
      ],
      positionsRepo,
      assetsAnalysis,
    );
    expect(allCheck.isSafe).toBe(false);
    expect(allCheck.blockedActions).toHaveLength(1);
    expect(allCheck.blockedActions[0]!.ticker).toBe('SBER');
  });

  it('Шаг E: ReviewAgent формирует итоговый ReviewResult по всем данным', async () => {
    // DataAgentOutput с РЕАЛЬНЫМИ news (Шаг B) и anomalies (Шаг C)
    const data: DataAgentOutput = {
      aggregated: [],
      assets: [],
      macroGoals: {
        totalBalance: 1000000,
        freeCash: 50000,
        stocksPercent: 60,
        bondsPercent: 30,
        stocksDeficitRub: 100000,
        bondsDeficitRub: 50000,
        iisOrdersSum: 0,
        brokerOrdersSum: 0,
        activeOrdersListText: '',
      },
      accounts: [],
      quotes: {},
      activeOrders: [],
      historicalTrades: {
        tradesCount: 0,
        totalPurchasesSum: 0,
        totalSalesSum: 0,
        profitC10: 0,
        profitC11: 0,
        totalHistoricalCommission: 0,
      },
      investedFunds: {
        totalNet: 1000000,
        totalPurchases: 0,
        totalSales: 0,
      },
      news: gatekeeperResult,
      anomalies,
      keyRate: 0,
      keyRateDate: '—',
    };

    // Минимальные mock-данные анализа (без AI-вызовов)
    const analysis: AnalysisAgentOutput = {
      portfolioAnalysis: {
        assetsAnalysis: [
          {
            name: 'Сбербанк',
            ticker: 'SBER',
            assetType: 'STOCK',
            currentPercent: 12,
            targetPercent: 8,
            deficitRub: -500000,
            status: 'REDUCE',
            dynamicsPercent: 1.2,
            nkdRub: 0,
            nominal: 1,
            quantity: 500,
            balancePrice: 260,
            currentPrice: 240,
            unrealizedProfitRub: -10000,
            priority: 1,
            isConcentrated: false,
          },
        ],
        macro: {
          totalBalance: 1000000,
          freeCash: 50000,
          stocksDeficitRub: 100000,
          bondsDeficitRub: 50000,
        },
      },
      riskValidation: {
        isValid: true,
        errors: [],
      },
      income: {
        stocks: [],
        totalNkd: 0,
        totalDivs: 0,
        totalDivsNet: 0,
      },
      priceAlerts: [],
      priceAlertsMd: '',
    };

    const ai: AiAgentOutput = {
      thesisResults: new Map(),
      aiNarrative: '',
      aiClientResult: {
        text: '',
        modelUsed: 'e2e-mock',
        success: true,
      },
      structuredRecommendations: new Map(),
      validationWarnings: [],
    };

    const reviewAgent = new ReviewAgent({
      name: 'ReviewAgent',
      verbose: false,
      retries: 0,
    });
    (reviewAgent as unknown as { isOllamaReady: () => Promise<boolean> }).isOllamaReady = () => Promise.resolve(false);

    const agentResult = await reviewAgent.execute({ data, analysis, ai });

    expect(agentResult.success).toBe(true);
    const review = agentResult.data as ReviewResult;
    expect(review).toBeDefined();

    // Все 3 ревизора отработали (пункты итогового review)
    expect(review.reviewers.size).toBe(3);
    for (const reviewer of review.reviewers.values()) {
      expect(reviewer.summary.length).toBeGreaterThan(0);
    }

    expect(review.finalRecommendation.length).toBeGreaterThan(0);
    expect(review.reviewedAt).toBeTruthy();
    expect(review.metrics.successfulReviewers).toBe(3);
    expect(review.metrics.timedOutReviewers).toBe(0);
  });
});
