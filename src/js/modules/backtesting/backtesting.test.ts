import { describe, it, expect } from 'vitest';
import { runBacktest } from './backtesting.js';
import type { PipelineResult } from '../pipeline/pipeline-coordinator.js';

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function createMockPipelineResultWithRecommendations(): PipelineResult {
  const structuredRecommendations = new Map();

  // Добавляем рекомендации для нескольких тикеров
  for (const ticker of ['SBER', 'GAZP', 'LKOH']) {
    structuredRecommendations.set(ticker, {
      aiRecommendedAction: { value: 'HOLD' },
      confidence: { value: 75 },
      userTargetPercent: 20,
      portfolioMathStatus: 'AGREE' as const,
      aiRecommendedTargetPercent: { status: 'VALUE' as const, value: 20 },
      rationale: 'Test rationale',
      targetReason: 'Test reason',
      keyRisks: [],
      keyCatalysts: [],
      agreementWithPortfolioMath: 'AGREE' as const,
    });
  }

  return {
    success: true,
    totalDurationMs: 5000,
    stages: {
      data: {
        durationMs: 1000,
        result: { success: true, data: {} },
      },
      research: {
        durationMs: 2000,
        result: { success: true, data: {} },
      },
      analysis: {
        durationMs: 1000,
        result: { success: true, data: {} },
      },
      ai: {
        durationMs: 500,
        result: {
          success: true,
          data: {
            structuredRecommendations,
          },
        },
      },
      review: {
        durationMs: 500,
        result: { success: true, data: undefined },
      },
      notification: {
        durationMs: 0,
        result: { success: true, data: {} },
      },
    },
    reviewResult: undefined,
    error: undefined,
  } as unknown as PipelineResult;
}

// ═══════════════════════════════════════════════
// 1. runBacktest
// ═══════════════════════════════════════════════

describe('runBacktest', () => {
  it('должен вернуть пустой результат при отсутствии AI данных', async () => {
    const result = {
      success: true,
      totalDurationMs: 5000,
      stages: {
        data: { durationMs: 1000, result: { success: true, data: {} } },
        research: { durationMs: 2000, result: { success: true, data: {} } },
        analysis: { durationMs: 1000, result: { success: true, data: {} } },
        ai: {
          durationMs: 500,
          result: { success: true, data: { structuredRecommendations: new Map() } },
        },
        review: { durationMs: 500, result: { success: true, data: undefined } },
        notification: { durationMs: 0, result: { success: true, data: {} } },
      },
      reviewResult: undefined,
      error: undefined,
    } as unknown as PipelineResult;

    const backtestResult = await runBacktest(result, 30);

    expect(backtestResult.assetResults).toHaveLength(0);
    expect(backtestResult.overallAccuracy).toBe(0);
    expect(backtestResult.summary).toContain('Нет рекомендаций');
  });

  it('должен вернуть пустой результат при ошибке AI Agent', async () => {
    const result = {
      success: true,
      totalDurationMs: 5000,
      stages: {
        data: { durationMs: 1000, result: { success: true, data: {} } },
        research: { durationMs: 2000, result: { success: true, data: {} } },
        analysis: { durationMs: 1000, result: { success: true, data: {} } },
        ai: { durationMs: 500, result: { success: false, data: undefined, error: new Error('AI error') } },
        review: { durationMs: 500, result: { success: true, data: undefined } },
        notification: { durationMs: 0, result: { success: true, data: {} } },
      },
      reviewResult: undefined,
      error: undefined,
    } as unknown as PipelineResult;

    const backtestResult = await runBacktest(result, 30);

    expect(backtestResult.assetResults).toHaveLength(0);
    expect(backtestResult.summary).toContain('AI Agent не выполнился');
  });

  it('должен создать результаты для активов с рекомендациями', async () => {
    const mockResult = createMockPipelineResultWithRecommendations();
    const backtestResult = await runBacktest(mockResult, 30);

    expect(backtestResult.assetResults.length).toBe(3);
    expect(backtestResult.assetResults[0].ticker).toBeDefined();
    expect(backtestResult.assetResults[0].recommendation).toBe('HOLD');
    expect(backtestResult.overallAccuracy).toBeGreaterThanOrEqual(0);
    expect(backtestResult.overallAccuracy).toBeLessThanOrEqual(100);
    expect(backtestResult.summary).toContain('Backtesting');
  });

  it('должен рассчитать averageSharpe, averageMaxDrawdown, averageWinRate', async () => {
    const mockResult = createMockPipelineResultWithRecommendations();
    const backtestResult = await runBacktest(mockResult, 30);

    expect(backtestResult.averageSharpe).toBeDefined();
    expect(backtestResult.averageMaxDrawdown).toBeDefined();
    expect(backtestResult.averageWinRate).toBeDefined();
  });

  it('должен определить best и worst активы', async () => {
    const mockResult = createMockPipelineResultWithRecommendations();
    const backtestResult = await runBacktest(mockResult, 30);

    expect(backtestResult.bestAsset).toBeDefined();
    expect(backtestResult.worstAsset).toBeDefined();
    expect(backtestResult.bestAsset!.roiPercent).toBeGreaterThanOrEqual(backtestResult.worstAsset!.roiPercent);
  });

  it('должен обработать разные типы рекомендаций', async () => {
    const structuredRecommendations = new Map();

    structuredRecommendations.set('SBER', {
      aiRecommendedAction: { value: 'BUY' },
      confidence: { value: 80 },
      userTargetPercent: 20,
      portfolioMathStatus: 'AGREE' as const,
      aiRecommendedTargetPercent: { status: 'VALUE' as const, value: 25 },
      rationale: 'Test',
      targetReason: 'Test',
      keyRisks: [],
      keyCatalysts: [],
      agreementWithPortfolioMath: 'AGREE' as const,
    });

    structuredRecommendations.set('GAZP', {
      aiRecommendedAction: { value: 'SELL' },
      confidence: { value: 60 },
      userTargetPercent: 15,
      portfolioMathStatus: 'DISAGREE' as const,
      aiRecommendedTargetPercent: { status: 'VALUE' as const, value: 10 },
      rationale: 'Test',
      targetReason: 'Test',
      keyRisks: [],
      keyCatalysts: [],
      agreementWithPortfolioMath: 'DISAGREE' as const,
    });

    const result = {
      success: true,
      totalDurationMs: 5000,
      stages: {
        data: { durationMs: 1000, result: { success: true, data: {} } },
        research: { durationMs: 2000, result: { success: true, data: {} } },
        analysis: { durationMs: 1000, result: { success: true, data: {} } },
        ai: { durationMs: 500, result: { success: true, data: { structuredRecommendations } } },
        review: { durationMs: 500, result: { success: true, data: undefined } },
        notification: { durationMs: 0, result: { success: true, data: {} } },
      },
      reviewResult: undefined,
      error: undefined,
    } as unknown as PipelineResult;

    const backtestResult = await runBacktest(result, 30);

    expect(backtestResult.assetResults.length).toBe(2);

    const sber = backtestResult.assetResults.find((r) => r.ticker === 'SBER');
    expect(sber?.recommendation).toBe('BUY');

    const gazp = backtestResult.assetResults.find((r) => r.ticker === 'GAZP');
    expect(gazp?.recommendation).toBe('SELL');
  });
});
