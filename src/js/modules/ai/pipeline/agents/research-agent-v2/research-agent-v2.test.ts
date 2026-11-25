/**
 * Тесты для ResearchAgentV2 — честные статусы (honest-output).
 *
 * Покрытие:
 * - performCrossChecks: available: false, confidence НЕ 'high'
 * - simulateHistoricalAnalysis: available: false при ошибке, true при успехе
 * - Экспорт: CSV и Markdown корректно отображают статусы
 *
 * ВНИМАНИЕ: используются глобальные API vitest (globals: true).
 */

import { ResearchAgentV2 } from './research-agent-v2.js';
import type {
  CrossCheckResult,
  HistoricalAnalysis,
  ResearchAgentV2Input,
  ExportParams,
} from './types.js';
import type { AgentConfig } from '../../agent/types.js';
import * as dataFetcherModule from '../../../../data/data-fetcher/index.js';

// ═══════════════════════════════════════════════
// Result types — mirror internal executeInternal return shapes
// ═══════════════════════════════════════════════

interface CrossCheckResultPayload {
  crossChecks: CrossCheckResult[];
}

interface HistoricalAnalysisPayload {
  historical: HistoricalAnalysis;
}

interface ExportResultPayload {
  success: boolean;
  exportResult?: {
    content: string;
  };
}

// ═══════════════════════════════════════════════
// Testable subclass — для доступа к protected executeInternal
// ═══════════════════════════════════════════════

class TestableResearchAgentV2 extends ResearchAgentV2 {
  constructor() {
    super({
      name: 'research-agent-v2',
      version: '2.0.0',
      timeoutMs: 60000,
    } as AgentConfig);
  }

  public testExecuteInternal(input: ResearchAgentV2Input) {
    return this.executeInternal(input);
  }
}

// ═══════════════════════════════════════════════
// Cross-checks
// ═══════════════════════════════════════════════

describe('performCrossChecks — honest-output', () => {
  let agent: TestableResearchAgentV2;

  beforeEach(() => {
    agent = new TestableResearchAgentV2();
  });

  it('возвращает available: false при отсутствии реализации', async () => {
    const result = await agent.testExecuteInternal({
      action: 'cross-check',
      params: { tickers: ['SBER'] },
    });

    const payload = result as CrossCheckResultPayload;
    const crossChecks = payload.crossChecks;

    expect(crossChecks.length).toBeGreaterThan(0);
    for (const cc of crossChecks) {
      expect(cc.available).toBe(false);
      expect(cc.isConsistent).toBe(false);
      expect(cc.confidence).not.toBe('high');
    }
  });

  it('не содержит confidence: high без фактической проверки', async () => {
    const result = await agent.testExecuteInternal({
      action: 'cross-check',
      params: { tickers: ['SBER', 'GAZP'] },
    });

    const payload = result as CrossCheckResultPayload;
    const crossChecks = payload.crossChecks;

    const highConfidence = crossChecks.filter(
      (c) => c.confidence === 'high' && c.available === false,
    );
    expect(highConfidence.length).toBe(0);
  });

  it('возвращает результаты для всех типов проверок', async () => {
    const result = await agent.testExecuteInternal({
      action: 'cross-check',
      params: { tickers: ['SBER'], types: ['price', 'volume', 'fundamentals'] },
    });

    const payload = result as CrossCheckResultPayload;
    const crossChecks = payload.crossChecks;

    const types = crossChecks.map((c) => c.type);
    expect(types).toContain('price');
    expect(types).toContain('volume');
    expect(types).toContain('fundamentals');
  });
});

// ═══════════════════════════════════════════════
// Historical analysis
// ═══════════════════════════════════════════════

describe('simulateHistoricalAnalysis — honest-output', () => {
  let agent: TestableResearchAgentV2;

  beforeEach(() => {
    agent = new TestableResearchAgentV2();
  });

  it('возвращает available: false при ошибке fetch (неизвестный тикер)', async () => {
    const result = await agent.testExecuteInternal({
      action: 'historical-analysis',
      params: { ticker: 'NONEXISTENT_TICKER_XYZ' },
    });

    const payload = result as HistoricalAnalysisPayload;
    const analysis = payload.historical;

    expect(analysis.ticker).toBe('NONEXISTENT_TICKER_XYZ');
    expect(analysis.available).toBe(false);
    expect(analysis.volatility).toBe(0);
    expect(analysis.trend).toBe('neutral');
  });

  it('успешный расчёт возвращает available: true', async () => {
    const mockBars = Array.from({ length: 20 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      open: 100 + i * 0.5,
      high: 101 + i * 0.5,
      low: 99 + i * 0.5,
      close: 100 + i * 0.5 + Math.sin(i) * 3,
      volume: 1000000,
    }));

    vi.spyOn(dataFetcherModule, 'fetchHistoricalBatch').mockResolvedValue(
      new Map([['SBER', mockBars]]),
    );

    try {
      const result = await agent.testExecuteInternal({
        action: 'historical-analysis',
        params: { ticker: 'SBER' },
      });

      const payload = result as HistoricalAnalysisPayload;
      const analysis = payload.historical;

      expect(analysis.available).toBe(true);
      expect(analysis.volatility).toBeGreaterThan(0);
      expect(analysis.trend).toBeDefined();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

// ═══════════════════════════════════════════════
// Export: CSV and Markdown render availability
// ═══════════════════════════════════════════════

describe('exportResearch — honest-output rendering', () => {
  let agent: TestableResearchAgentV2;

  beforeEach(() => {
    agent = new TestableResearchAgentV2();
  });

  it('CSV-экспорт содержит колонку historical_available', async () => {
    const snapshot = {
      ticker: 'SBER',
      crossChecks: [] as CrossCheckResult[],
      historicalAnalysis: {
        ticker: 'SBER',
        dataPoints: [],
        averageChange: 0,
        volatility: 0,
        trend: 'neutral' as const,
        maxDrawdown: 0,
        sharpeRatio: 0,
        available: false,
      } as HistoricalAnalysis,
      researchDepth: 'standard' as const,
      completedAt: new Date().toISOString(),
      dataSources: ['market'],
    };

    // @ts-expect-error — private cache
    agent['cache'].set('SBER', snapshot);

    const result = await agent.testExecuteInternal({
      action: 'export-research',
      params: { tickers: ['SBER'], format: 'csv' } as ExportParams,
    });

    const payload = result as ExportResultPayload;
    expect(payload.success).toBe(true);
    const exportResult = payload.exportResult;
    expect(typeof exportResult?.content).toBe('string');

    const header = exportResult!.content.split('\n')[0];
    expect(header).toContain('historical_available');
  });

  it('Markdown-экспорт показывает доступность исторического анализа', async () => {
    const snapshot = {
      ticker: 'SBER',
      crossChecks: [] as CrossCheckResult[],
      historicalAnalysis: {
        ticker: 'SBER',
        dataPoints: [],
        averageChange: 0,
        volatility: 0,
        trend: 'neutral' as const,
        maxDrawdown: 0,
        sharpeRatio: 0,
        available: false,
      } as HistoricalAnalysis,
      researchDepth: 'standard' as const,
      completedAt: new Date().toISOString(),
      dataSources: ['market'],
    };

    // @ts-expect-error — private cache
    agent['cache'].set('SBER', snapshot);

    const result = await agent.testExecuteInternal({
      action: 'export-research',
      params: { tickers: ['SBER'], format: 'markdown' } as ExportParams,
    });

    const payload = result as ExportResultPayload;
    expect(payload.success).toBe(true);
    const content = payload.exportResult!.content;
    expect(content).toContain('**Historical**:');
    expect(content).toContain('unavailable');
  });

  it('Markdown-экспорт показывает trend только при available: true', async () => {
    const snapshot = {
      ticker: 'GAZP',
      crossChecks: [] as CrossCheckResult[],
      historicalAnalysis: {
        ticker: 'GAZP',
        dataPoints: [],
        averageChange: 0.001,
        volatility: 0.25,
        trend: 'up' as const,
        maxDrawdown: 0.1,
        sharpeRatio: 0.5,
        available: true,
      } as HistoricalAnalysis,
      researchDepth: 'standard' as const,
      completedAt: new Date().toISOString(),
      dataSources: ['market', 'historical'],
    };

    // @ts-expect-error — private cache
    agent['cache'].set('GAZP', snapshot);

    const result = await agent.testExecuteInternal({
      action: 'export-research',
      params: { tickers: ['GAZP'], format: 'markdown' } as ExportParams,
    });

    const payload = result as ExportResultPayload;
    const content = payload.exportResult!.content;

    expect(content).toContain('**Historical**: available');
    expect(content).toContain('**Trend**: up');
  });
});
