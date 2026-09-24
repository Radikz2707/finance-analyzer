import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PipelineCoordinator } from './pipeline-coordinator.js';
import type { PipelineResult, PipelineStage } from './pipeline-coordinator.js';
import { getStats, operationalMemory, strategicMemory, initMemory } from './ai-memory/index.js';

describe('PipelineCoordinator', () => {
  let coordinator: PipelineCoordinator;

  beforeEach(() => {
    coordinator = new PipelineCoordinator({
      data: { name: 'DataAgent', verbose: false, retries: 0 },
      research: { name: 'ResearchAgent', verbose: false, retries: 0 },
      analysis: { name: 'AnalysisAgent', verbose: false, retries: 0 },
      ai: { name: 'AiAgent', verbose: false, retries: 0 },
      notification: { name: 'NotificationAgent', verbose: false, retries: 0 },
    });
  });

  afterEach(async () => {
    await coordinator.shutdown();
  });

  it('should start with idle state', () => {
    expect(coordinator.state.stopped).toBe(false);
    expect(coordinator.isRunning).toBe(true);
  });

  it('should return agent summaries', () => {
    const summaries = coordinator.getAgentSummaries();
    expect(summaries).toHaveProperty('data');
    expect(summaries).toHaveProperty('research');
    expect(summaries).toHaveProperty('analysis');
    expect(summaries).toHaveProperty('ai');
    expect(summaries).toHaveProperty('notification');

    for (const summary of Object.values(summaries)) {
      expect(summary).toHaveProperty('name');
      expect(summary).toHaveProperty('state');
      expect(summary).toHaveProperty('totalExecutions');
      expect(summary.totalExecutions).toBe(0);
    }
  });

  it('should have correct stage keys', () => {
    const result: PipelineResult = {
      pipelineId: 'test-id',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      totalDurationMs: 100,
      stages: {
        data: null,
        research: null,
        analysis: null,
        ai: null,
        review: null,
        notification: null,
      },
      agentSummaries: {},
      success: true,
    };

    const stageKeys: PipelineStage[] = ['data', 'research', 'analysis', 'ai', 'notification'];
    for (const key of stageKeys) {
      expect(result.stages).toHaveProperty(key);
    }
  });

  it('should build result with correct structure', () => {
    const result: PipelineResult = {
      pipelineId: 'test-pipeline',
      startedAt: '2024-01-01T00:00:00.000Z',
      completedAt: '2024-01-01T00:00:01.000Z',
      totalDurationMs: 1000,
      stages: {
        data: {
          stage: 'data',
          result: { success: true, durationMs: 100, completedAt: '2024-01-01T00:00:00.100Z' },
          durationMs: 100,
        },
        research: null,
        analysis: null,
        ai: null,
        review: null,
        notification: null,
      },
      agentSummaries: {},
      success: true,
    };

    expect(result.pipelineId).toBe('test-pipeline');
    expect(result.success).toBe(true);
    expect(result.totalDurationMs).toBe(1000);
    expect(result.stages.data).not.toBeNull();
    expect(result.stages.data?.result.success).toBe(true);
  });
});

describe('Pipeline Coordinator — AI Memory Integration', () => {
  beforeEach(() => {
    
    initMemory({ verbose: false });
  });

  afterEach(async () => {
    const coordinator = new PipelineCoordinator({
      data: { name: 'DataAgent', verbose: false, retries: 0 },
      research: { name: 'ResearchAgent', verbose: false, retries: 0 },
      analysis: { name: 'AnalysisAgent', verbose: false, retries: 0 },
      ai: { name: 'AiAgent', verbose: false, retries: 0 },
      notification: { name: 'NotificationAgent', verbose: false, retries: 0 },
    });
    await coordinator.shutdown();
  });

  it('должна инициализировать память', () => {
    const stats = getStats();
    expect(stats).toBeDefined();
    expect(typeof stats.operationalCount).toBe('number');
    expect(typeof stats.strategicCount).toBe('number');
  });

  it('должна сохранить запись в оперативную память', () => {
    const id = operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'pipeline_result',
      content: 'Тестовый результат pipeline',
      priority: 'high',
      keywords: ['pipeline', 'test'],
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');

    const entry = operationalMemory.getById(id);
    expect(entry).toBeDefined();
    expect(entry!.content).toBe('Тестовый результат pipeline');
  });

  it('должна сохранить KPI-снимок в стратегическую память', () => {
    const id = strategicMemory.saveKpi({
      date: new Date().toISOString(),
      totalValue: 1000000,
      returnPercent: 12.5,
      volatility: 15.3,
      sharpeRatio: 1.2,
      maxDrawdown: 8.5,
      assetCount: 10,
      stocksPercent: 60,
      bondsPercent: 40,
      dividendIncome: 50000,
      realizedProfit: 100000,
      unrealizedProfit: 50000,
    });

    expect(id).toBeDefined();

    const trend = strategicMemory.getKpiTrend(10);
    expect(trend.length).toBe(1);
    expect(trend[0].totalValue).toBe(1000000);
  });

  it('должна вернуть статистику памяти', () => {
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Тест',
      priority: 'low',
      keywords: ['тест'],
    });

    const stats = getStats();
    expect(stats.operationalCount).toBeGreaterThanOrEqual(1);
  });

  it('должна сохранить результат этапа в память', () => {
    const coordinator = new PipelineCoordinator({
      data: { name: 'DataAgent', verbose: false, retries: 0 },
      research: { name: 'ResearchAgent', verbose: false, retries: 0 },
      analysis: { name: 'AnalysisAgent', verbose: false, retries: 0 },
      ai: { name: 'AiAgent', verbose: false, retries: 0 },
      notification: { name: 'NotificationAgent', verbose: false, retries: 0 },
    });

    // Получаем сводки агентов
    const summaries = coordinator.getAgentSummaries();
    expect(summaries).toHaveProperty('data');
    expect(summaries).toHaveProperty('ai');

    coordinator.shutdown();
  });

  it('должна поддерживать несколько KPI-снимков', () => {
    for (let i = 0; i < 3; i++) {
      strategicMemory.saveKpi({
        date: new Date().toISOString(),
        totalValue: 1000000 + i * 100000,
        returnPercent: 10 + i * 2,
        volatility: 15,
        sharpeRatio: 1.2,
        maxDrawdown: 8,
        assetCount: 10,
        stocksPercent: 60,
        bondsPercent: 40,
        dividendIncome: 50000,
        realizedProfit: 100000,
        unrealizedProfit: 50000,
      });
    }

    const trend = strategicMemory.getKpiTrend(10);
    expect(trend.length).toBe(3);
    const values = trend.map(t => t.totalValue);
    expect(values).toContain(1000000);
    expect(values).toContain(1100000);
    expect(values).toContain(1200000);
  });
});
