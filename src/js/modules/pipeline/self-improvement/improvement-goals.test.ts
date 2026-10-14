/**
 * ImprovementGoals — тесты генерации целей улучшения из слабых категорий
 * FeedbackLoop.analyze().
 *
 * Покрытие:
 * - слабая категория (win rate < 0.4) → цель «Пересмотреть подход к X»;
 * - критически слабая (win rate < 0.25) → приоритет high;
 * - категория без реализованных решений → пропускается (метрики ненадёжны);
 * - сильная/нейтральная категория → цели нет;
 * - пустой/нулевой анализ → пустой список;
 * - сортировка: критичные первыми, затем по возрастанию win rate;
 * - summarizeImprovementGoals.
 */

import {
  CRITICAL_WIN_RATE_THRESHOLD,
  WEAK_WIN_RATE_THRESHOLD,
  generateImprovementGoals,
  summarizeImprovementGoals,
} from './improvement-goals.js';
import type { AnalysisResult } from '../feedback-loop/types.js';

/** Построить AnalysisResult с заданными категориями */
function makeAnalysis(
  byCategory: Array<{
    category: string;
    winRate: number;
    implementedCount: number;
  }>,
): AnalysisResult {
  return {
    metrics: {
      totalDecisions: 0,
      totalOutcomes: 0,
      overallWinRate: 0,
      implementationRate: 0,
      avgConfidence: 0,
      avgSatisfaction: 0,
      avgRoi: 0,
      byCategory: byCategory.map((c) => ({
        category: c.category,
        totalDecisions: c.implementedCount,
        implementedCount: c.implementedCount,
        positiveCount: 0,
        negativeCount: 0,
        ignoredCount: 0,
        winRate: c.winRate,
        avgConfidence: 0,
        avgSatisfaction: 0,
        avgRoi: 0,
        avgActionDelayMs: 0,
      })),
      byTicker: {},
      byAgent: {},
      trend: [],
    },
    strengths: [],
    weaknesses: [],
    recommendations: [],
    warnings: [],
  };
}

describe('improvement-goals: генерация целей из слабых категорий', () => {
  it('слабая категория (win rate < 0.4) → цель «Пересмотреть подход»', () => {
    const analysis = makeAnalysis([
      { category: 'asset', winRate: 0.2, implementedCount: 5 },
    ]);
    const goals = generateImprovementGoals(analysis);
    expect(goals).toHaveLength(1);
    expect(goals[0]?.category).toBe('asset');
    expect(goals[0]?.winRate).toBe(0.2);
    expect(goals[0]?.goal).toContain('Пересмотреть подход к категории «asset»');
    expect(goals[0]?.priority).toBe('high'); // 0.2 < 0.25
  });

  it('критически слабая категория получает приоритет high', () => {
    const analysis = makeAnalysis([
      { category: 'scenario', winRate: 0.1, implementedCount: 3 },
    ]);
    const goals = generateImprovementGoals(analysis);
    expect(goals[0]?.priority).toBe('high');
  });

  it('умеренно слабая категория (0.25..0.4) получает приоритет normal', () => {
    const analysis = makeAnalysis([
      { category: 'portfolio', winRate: 0.3, implementedCount: 4 },
    ]);
    const goals = generateImprovementGoals(analysis);
    expect(goals[0]?.priority).toBe('normal');
  });

  it('категория с win rate >= 0.4 → цели нет', () => {
    const analysis = makeAnalysis([
      { category: 'asset', winRate: 0.5, implementedCount: 5 },
    ]);
    expect(generateImprovementGoals(analysis)).toHaveLength(0);
  });

  it('категория без реализованных решений пропускается (метрики ненадёжны)', () => {
    const analysis = makeAnalysis([
      { category: 'market', winRate: 0.1, implementedCount: 0 },
    ]);
    expect(generateImprovementGoals(analysis)).toHaveLength(0);
  });

  it('нулевой анализ → пустой список (честно: нет данных)', () => {
    expect(generateImprovementGoals(null)).toHaveLength(0);
    expect(generateImprovementGoals(undefined)).toHaveLength(0);
  });

  it('сортировка: критичные первыми, затем по возрастанию win rate', () => {
    const analysis = makeAnalysis([
      { category: 'asset', winRate: 0.3, implementedCount: 2 },
      { category: 'scenario', winRate: 0.1, implementedCount: 2 },
      { category: 'portfolio', winRate: 0.35, implementedCount: 2 },
    ]);
    const goals = generateImprovementGoals(analysis);
    expect(goals.map((g) => g.category)).toEqual([
      'scenario', // high (0.1)
      'asset', // normal (0.3)
      'portfolio', // normal (0.35)
    ]);
  });

  it('пороги экспортируются и согласованы', () => {
    expect(WEAK_WIN_RATE_THRESHOLD).toBe(0.4);
    expect(CRITICAL_WIN_RATE_THRESHOLD).toBe(0.25);
  });
});

describe('improvement-goals: summarizeImprovementGoals', () => {
  it('пустой список → «цели не требуются»', () => {
    expect(summarizeImprovementGoals([])).toContain('не требуются');
  });

  it('непустой список → перечисляет цели', () => {
    const analysis = makeAnalysis([
      { category: 'asset', winRate: 0.2, implementedCount: 5 },
    ]);
    const goals = generateImprovementGoals(analysis);
    const summary = summarizeImprovementGoals(goals);
    expect(summary).toContain('asset');
    expect(summary).toContain('20%');
  });
});
