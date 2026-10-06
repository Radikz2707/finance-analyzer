/**
 * Dashboard Module Tests — рендеринг виджетов, форматирование и пустые данные.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect/vi),
 * а не импорт из 'vitest' (ограничение окружения: vitest 5.x + vite 8.x).
 *
 * Стратегия: модуль зависит от DOM и репозиториев БД, поэтому:
 * 1. Зависимости (db-manager, ai-memory, Director) заменяются моками;
 * 2. Глобальный `document` подменяется лёгким фейком БЕЗ jsdom —
 *    проверяется вся цепочка init() → загрузка данных → рендер элементов.
 *
 * Покрытие:
 * 1. Пустые данные: init() не падает, таблицы показывают «Нет данных»
 * 2. KPI: форматирование чисел ru-RU, знак и цвет прибыли/убытка
 * 3. Таблица портфеля: PnL, проценты, нулевые totalCost
 * 4. Метрики backtesting/оптимизации/качества
 * 5. Алерты: окраска по sentiment, пустой список
 * 6. AI Memory: статистика, стратегические записи, аномалии с severity
 */

/** Моки зависимостей: доступны и в фабриках vi.mock, и в самих тестах. */
const mocks = vi.hoisted(() => ({
  positionsGetAllActive: vi.fn(),
  getPortfolioSummary: vi.fn(),
  pricesGetLast: vi.fn(),
  macroGetLatest: vi.fn(),
  newsGetUnprocessed: vi.fn(),

  getStats: vi.fn(),
  memOpGetRecent: vi.fn(),
  memStratGetAll: vi.fn(),
  cleanup: vi.fn(async () => {}),
  exportMemory: vi.fn(async () => '{}'),

  mountDirectorChat: vi.fn(),
  directorChatStyles: vi.fn(() => ''),
}));

vi.mock('../db-manager/db-manager', () => ({
  positionsRepo: {
    getAllActive: mocks.positionsGetAllActive,
    getPortfolioSummary: mocks.getPortfolioSummary,
  },
  pricesRepo: { getLast: mocks.pricesGetLast },
  macroRepo: { getLatest: mocks.macroGetLatest },
  newsRepo: { getUnprocessed: mocks.newsGetUnprocessed },
}));

vi.mock('../pipeline/ai-memory/index.js', () => ({
  getStats: mocks.getStats,
  operationalMemory: { getRecent: mocks.memOpGetRecent },
  strategicMemory: { getAll: mocks.memStratGetAll },
  cleanup: mocks.cleanup,
  exportMemory: mocks.exportMemory,
}));

vi.mock('../pipeline/director/director.js', () => ({
  DirectorAgent: class {
    setFacts(): void {}
    createSession(): void {}
    processUserMessage(): Promise<unknown> {
      return Promise.resolve({});
    }
    getChatHistory(): unknown[] {
      return [];
    }
    getProactiveMessages(): unknown[] {
      return [];
    }
  },
}));

vi.mock('../pipeline/director/director-chat-widget.js', () => ({
  mountDirectorChat: mocks.mountDirectorChat,
  directorChatStyles: mocks.directorChatStyles,
}));

import { init } from './index.js';
import type { PortfolioPosition, NewsRecord } from '../db-manager/types.js';
import type {
  AIMemoryStats,
  OperationalMemoryEntry,
  StrategicMemoryEntry,
} from '../pipeline/ai-memory/types.js';

// ──────────────────────────────────────────────
// Фейковый DOM (без jsdom)
// ──────────────────────────────────────────────

/** Минимальный элемент, покрывающий все манипуляции dashboard-рендеров */
class FakeElement {
  textContent = '';
  innerHTML = '';
  style: Record<string, string> = {};
  disabled = false;
  dataset: Record<string, string> = {};
  classList = { add: vi.fn(), remove: vi.fn() };
  addEventListener = vi.fn();
  click = vi.fn();
}

/**
 * Элементы, которые dashboard обязан видеть как «отсутствующие»:
 * канвасы Chart.js, контейнер Director-чата и кнопки действий.
 * Их наличие заставило бы модуль трогать window.Chart / Blob / URL.
 */
const NULL_ELEMENT_IDS = new Set([
  'chartPortfolio',
  'chartReturns',
  'chartAccuracy',
  'chartROI',
  'chartFrontier',
  'chartWeights',
  'chartKpiTrend',
  'directorChat',
  'btnCleanupMemory',
  'btnExportMemoryJson',
  'btnExportMemoryMd',
  'btnRunPipeline',
  'btnRefresh',
]);

function createFakeDocument(elements: Map<string, FakeElement>) {
  return {
    readyState: 'complete',
    addEventListener: vi.fn(),
    querySelectorAll: () => [] as FakeElement[],
    getElementById: (id: string): FakeElement | null => {
      if (NULL_ELEMENT_IDS.has(id)) return null;
      // Автосоздание: рендер-функции вызывают getElementById в момент init()
      let element = elements.get(id);
      if (!element) {
        element = new FakeElement();
        elements.set(id, element);
      }
      return element;
    },
    createElement: () => new FakeElement(),
  };
}

// ──────────────────────────────────────────────
// Фабрики тестовых данных
// ──────────────────────────────────────────────

function makePosition(
  overrides: Partial<PortfolioPosition> = {},
): PortfolioPosition {
  return {
    ticker: 'SBER',
    name: 'Сбербанк',
    assetType: 'STOCK',
    issuer: 'Сбер',
    currency: 'RUB',
    market: 'MOEX',
    quantity: 10,
    avgPrice: 100,
    totalCost: 1000,
    currentPrice: 150,
    currentMarketValue: 1500,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeNews(overrides: Partial<NewsRecord> = {}): NewsRecord {
  return {
    title: 'Новость',
    date: '2026-10-05',
    source: 'CBR',
    url: 'https://example.com/news',
    importance: 'MEDIUM',
    sentiment: 'NEUTRAL',
    summary: 'Сводка новости',
    relevanceToTicker: 'SBER',
    isProcessed: false,
    createdAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  };
}

function makeStats(overrides: Partial<AIMemoryStats> = {}): AIMemoryStats {
  return {
    operationalCount: 0,
    strategicCount: 0,
    operationalSizeBytes: 0,
    strategicSizeBytes: 0,
    avgOperationalAgeDays: 0,
    maxStrategicAgeDays: 0,
    recentAnomalies: 0,
    ...overrides,
  };
}

function makeOperationalEntry(
  overrides: Partial<OperationalMemoryEntry> = {},
): OperationalMemoryEntry {
  return {
    id: 'o1',
    type: 'conversation',
    createdAt: '2026-10-05T00:00:00.000Z',
    lastAccessedAt: '2026-10-05T00:00:00.000Z',
    priority: 'medium',
    keywords: ['sber'],
    content: 'Текст записи оперативной памяти',
    sizeBytes: 100,
    ...overrides,
  };
}

function makeStrategicEntry(
  overrides: Partial<StrategicMemoryEntry> = {},
): StrategicMemoryEntry {
  return {
    id: 's1',
    type: 'kpi_snapshot',
    date: '2026-09-30',
    compressedData: '',
    raw: {
      date: '2026-09-30',
      totalValue: 1_500_000,
      returnPercent: 12.5,
      volatility: 9.2,
      sharpeRatio: 1.4,
      maxDrawdown: -5,
      assetCount: 5,
      stocksPercent: 60,
      bondsPercent: 40,
      dividendIncome: 0,
      realizedProfit: 0,
      unrealizedProfit: 150_000,
    },
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Setup
// ──────────────────────────────────────────────

let elements: Map<string, FakeElement>;

/** Получить фейк-элемент по id (создаётся при первом обращении) */
function el(id: string): FakeElement {
  let element = elements.get(id);
  if (!element) {
    element = new FakeElement();
    elements.set(id, element);
  }
  return element;
}

beforeEach(() => {
  elements = new Map();
  vi.stubGlobal('document', createFakeDocument(elements));

  // Дефолтные моки — «пустые» данные
  mocks.positionsGetAllActive.mockReturnValue([]);
  mocks.getPortfolioSummary.mockReturnValue({
    totalCost: 0,
    totalMarketValue: 0,
    totalGain: 0,
    totalGainPercent: 0,
    activeCount: 0,
    recoveryOnlyCount: 0,
  });
  mocks.newsGetUnprocessed.mockReturnValue([]);
  mocks.pricesGetLast.mockReturnValue([]);
  mocks.getStats.mockReturnValue(makeStats());
  mocks.memOpGetRecent.mockReturnValue([]);
  mocks.memStratGetAll.mockReturnValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Dashboard', () => {
  it('init() с пустыми данными не падает и рисует заглушки «Нет данных»', () => {
    expect(() => init()).not.toThrow();

    expect(el('portfolioBody').innerHTML).toContain('Нет данных');
    expect(el('qualityBody').innerHTML).toContain('Нет данных');
    expect(el('alertsList').innerHTML).toContain('Нет алертов');
    expect(el('memoryOperationalBody').innerHTML).toContain('Нет данных');
    expect(el('memoryStrategicBody').innerHTML).toContain('Нет данных');
    expect(el('memoryAnomaliesBody').innerHTML).toContain(
      'Аномалий не обнаружено',
    );
  });

  it('рендерит KPI: баланс, прибыль со знаком плюс, активы и качество', () => {
    mocks.getPortfolioSummary.mockReturnValue({
      totalCost: 1_222_222,
      totalMarketValue: 1_234_567,
      totalGain: 12_345,
      totalGainPercent: 1.01,
      activeCount: 5,
      recoveryOnlyCount: 0,
    });

    init();

    expect(el('kpiTotalBalance').textContent).toBe(
      `${(1_234_567).toLocaleString('ru-RU')} ₽`,
    );
    expect(el('kpiTotalGain').textContent).toBe(
      `+${(12_345).toLocaleString('ru-RU')} ₽`,
    );
    expect(el('kpiTotalGain').style['color']).toBe(
      'var(--color-success, #16a34a)',
    );
    expect(el('kpiAssets').textContent).toBe('5');
    expect(el('kpiQuality').textContent).toBe('85%');
  });

  it('при отрицательной прибыли KPI показывает минус и красный цвет', () => {
    mocks.getPortfolioSummary.mockReturnValue({
      totalCost: 1_005_000,
      totalMarketValue: 1_000_000,
      totalGain: -5_000,
      totalGainPercent: -0.5,
      activeCount: 1,
      recoveryOnlyCount: 0,
    });

    init();

    expect(el('kpiTotalGain').textContent).toBe(
      `-${(5_000).toLocaleString('ru-RU')} ₽`,
    );
    expect(el('kpiTotalGain').style['color']).toBe(
      'var(--color-danger, #dc2626)',
    );
  });

  it('рендерит таблицу портфеля с PnL и процентной доходностью', () => {
    mocks.positionsGetAllActive.mockReturnValue([
      makePosition({
        ticker: 'SBER',
        name: 'Сбербанк',
        quantity: 10,
        avgPrice: 100,
        totalCost: 1000,
        currentPrice: 150,
        currentMarketValue: 1500,
      }),
    ]);

    init();

    const html = el('portfolioBody').innerHTML;
    expect(html).toContain('<strong>SBER</strong>');
    expect(html).toContain('Сбербанк');
    // pnl = 1500 - 1000 = 500 → +500.00 ₽; pct = 500/1000*100 = 50.00%
    expect(html).toContain('+500.00 ₽');
    expect(html).toContain('50.00%');
    expect(html).toContain('#16a34a');
  });

  it('позиция без totalCost даёт 0.00% без деления на ноль', () => {
    mocks.positionsGetAllActive.mockReturnValue([
      makePosition({ totalCost: 0, currentMarketValue: 0, currentPrice: 0 }),
    ]);

    init();

    const html = el('portfolioBody').innerHTML;
    expect(html).toContain('0.00%');
    expect(html).not.toContain('NaN');
  });

  it('рендерит метрики backtesting, оптимизации и качества', () => {
    mocks.positionsGetAllActive.mockReturnValue(
      Array.from({ length: 10 }, (_, i) =>
        makePosition({ ticker: `TICK${i}` }),
      ),
    );

    init();

    // Backtesting (фиксированные демо-значения модуля)
    expect(el('btAccuracy').textContent).toBe('72%');
    expect(el('btSharpe').textContent).toBe('1.45');
    expect(el('btDrawdown').textContent).toBe('12.3%');
    expect(el('btWinRate').textContent).toBe('65%');

    // Оптимизация
    expect(el('optSharpe').textContent).toBe('1.82');
    expect(el('optSharpeEq').textContent).toBe('1.15');
    expect(el('optSortino').textContent).toBe('2.34');
    expect(el('optImprovement').textContent).toBe('+28%');

    // Качество: 10 позиций → good=6, fair=3, poor=1
    expect(el('qualityScore').textContent).toBe('85%');
    expect(el('qualityGood').textContent).toBe('6');
    expect(el('qualityFair').textContent).toBe('3');
    expect(el('qualityPoor').textContent).toBe('1');
  });

  it('окрашивает алерты по sentiment (POSITIVE/NEGATIVE/NEUTRAL)', () => {
    mocks.newsGetUnprocessed.mockReturnValue([
      makeNews({ title: 'Рост', sentiment: 'POSITIVE' }),
      makeNews({ title: 'Падение', sentiment: 'NEGATIVE' }),
      makeNews({ title: 'Нейтрально', sentiment: 'NEUTRAL' }),
    ]);

    init();

    const html = el('alertsList').innerHTML;
    expect(html).toContain('Рост');
    expect(html).toContain('Падение');
    expect(html).toContain('#16a34a'); // POSITIVE
    expect(html).toContain('#dc2626'); // NEGATIVE
    expect(html).toContain('#f59e0b'); // NEUTRAL
  });

  it('рендерит статистику AI Memory и KPI тренд из стратегических записей', () => {
    mocks.getStats.mockReturnValue(
      makeStats({
        operationalCount: 12,
        strategicCount: 3,
        operationalSizeBytes: 20_480,
        recentAnomalies: 2,
      }),
    );
    mocks.memStratGetAll.mockReturnValue([
      makeStrategicEntry({
        raw: {
          date: '2026-09-30',
          totalValue: 1_500_000,
          returnPercent: 12.5,
          volatility: 9.2,
          sharpeRatio: 1.4,
          maxDrawdown: -5,
          assetCount: 5,
          stocksPercent: 60,
          bondsPercent: 40,
          dividendIncome: 0,
          realizedProfit: 0,
          unrealizedProfit: 150_000,
        },
      }),
    ]);

    init();

    expect(el('memOperationalCount').textContent).toBe('12');
    expect(el('memStrategicCount').textContent).toBe('3');
    expect(el('memOperationalSize').textContent).toBe('20 КБ');
    expect(el('memAnomalies').textContent).toBe('2');

    const strategicHtml = el('memoryStrategicBody').innerHTML;
    // toLocaleString('ru-RU') ставит неразрывный пробел — считаем так же
    expect(strategicHtml).toContain(`${(1_500_000).toLocaleString('ru-RU')} ₽`);
    expect(strategicHtml).toContain('+12.5%');
    expect(strategicHtml).toContain('1.40');
  });

  it('рендерит оперативные записи памяти с цветом приоритета', () => {
    mocks.memOpGetRecent.mockReturnValue([
      makeOperationalEntry({
        id: 'o1',
        type: 'conversation',
        priority: 'critical',
        keywords: ['sber', 'buy'],
        content: 'Длинный текст записи для проверки обрезки в таблице памяти',
      }),
    ]);

    init();

    const html = el('memoryOperationalBody').innerHTML;
    expect(html).toContain('conversation');
    expect(html).toContain('#dc2626'); // critical
    expect(html).toContain('sber, buy');
  });

  it('сортирует и раскрашивает аномалии по severity (критическая первой)', () => {
    mocks.memStratGetAll.mockReturnValue([
      makeStrategicEntry({
        id: 's2',
        type: 'kpi_snapshot',
        anomalies: [{ type: 'drop', severity: 0.4, description: 'Падение' }],
        raw: undefined,
      }),
      makeStrategicEntry({
        id: 's1',
        type: 'kpi_snapshot',
        anomalies: [
          { type: 'spike', severity: 0.9, description: 'Резкий рост цены' },
        ],
        raw: undefined,
      }),
    ]);

    init();

    const html = el('memoryAnomaliesBody').innerHTML;
    expect(html).toContain('Критическая (90%)');
    expect(html).toContain('Средняя (40%)');
    expect(html).toContain('#dc2626'); // severity >= 0.8
    expect(html).toContain('#2563eb'); // severity >= 0.3
    // loadAnomalies сортирует по убыванию severity
    expect(html.indexOf('Критическая')).toBeLessThan(html.indexOf('Средняя'));
  });
});
