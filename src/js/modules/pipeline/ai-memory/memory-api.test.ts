/**
 * Memory API Tests — тесты для удобного интерфейса работы с памятью.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveOperational,
  savePipelineResult,
  saveDecision,
  saveRecommendation,
  saveConversation,
  saveKpiSnapshot,
  saveTrend,
  saveAnomaly,
  searchByKeywords,
  getByType,
  getByPriority,
  getRecent,
  getKpiTrend,
  buildAiContext,
  getMemoryStats,
  performCleanup,
  deleteEntry,
  getEntryById,
} from './memory-api.js';
import { init as initMemory } from './ai-memory.js';

// ──────────────────────────────────────────────
// Тесты записи в оперативную память
// ──────────────────────────────────────────────

describe('Memory API — Оперативная память', () => {
  beforeEach(() => {  initMemory({ verbose: false });
  });

  it('saveOperational должна сохранить запись', () => {
    const id = saveOperational({
      type: 'conversation',
      content: 'Тестовая запись',
      priority: 'medium',
      keywords: ['тест'],
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
  });

  it('savePipelineResult должна сохранить результат pipeline', () => {
    const id = savePipelineResult('data', { totalValue: 1000000 });
    expect(id).toBeDefined();

    const results = getByType('pipeline_result');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('saveDecision должна сохранить решение', () => {
    const id = saveDecision('Купить SBER', ['SBER', 'покупка']);
    expect(id).toBeDefined();

    const decisions = getByType('decision');
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });

  it('saveRecommendation должна сохранить рекомендацию', () => {
    const id = saveRecommendation('Рекомендую увеличить долю облигаций', 'SBER');
    expect(id).toBeDefined();

    const recommendations = getByType('recommendation');
    expect(recommendations.length).toBeGreaterThanOrEqual(1);
  });

  it('saveConversation должна сохранить переписку', () => {
    const id = saveConversation('Обсуждение портфеля', ['портфель']);
    expect(id).toBeDefined();

    const conversations = getByType('conversation');
    expect(conversations.length).toBeGreaterThanOrEqual(1);
  });
});

// ──────────────────────────────────────────────
// Тесты записи в стратегическую память
// ──────────────────────────────────────────────

describe('Memory API — Стратегическая память', () => {
  beforeEach(() => {  initMemory({ verbose: false });
  });

  it('saveKpiSnapshot должна сохранить KPI-снимок', () => {
    const id = saveKpiSnapshot({
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

    const trend = getKpiTrend(10);
    expect(trend.length).toBeGreaterThanOrEqual(1);
    expect(trend[0].totalValue).toBe(1000000);
  });

  it('saveTrend должна сохранить тренд', () => {
    const id = saveTrend({
      direction: 'up',
      strength: 0.8,
      periodDays: 30,
      description: 'Рост портфеля',
    });

    expect(id).toBeDefined();
  });

  it('saveAnomaly должна сохранить аномалию', () => {
    const id = saveAnomaly({
      type: 'volatility_spike',
      severity: 0.7,
      description: 'Резкий рост волатильности',
    });

    expect(id).toBeDefined();
  });
});

// ──────────────────────────────────────────────
// Тесты поиска
// ──────────────────────────────────────────────

describe('Memory API — Поиск', () => {
  beforeEach(() => {  initMemory({ verbose: false });
  });

  it('searchByKeywords должна найти записи', () => {
    saveOperational({
      type: 'conversation',
      content: 'Обсуждение акций SBER',
      priority: 'medium',
      keywords: ['SBER', 'акции'],
    });

    const results = searchByKeywords(['SBER']);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('getByType должна вернуть записи по типу', () => {
    saveOperational({
      type: 'decision',
      content: 'Решение о покупке',
      priority: 'high',
      keywords: ['покупка'],
    });

    const decisions = getByType('decision');
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });

  it('getByPriority должна вернуть записи по приоритету', () => {
    saveOperational({
      type: 'conversation',
      content: 'Важное сообщение',
      priority: 'critical',
      keywords: ['важное'],
    });

    const critical = getByPriority('critical');
    expect(critical.length).toBeGreaterThanOrEqual(1);
  });

  it('getRecent должна вернуть последние записи', () => {
    saveOperational({
      type: 'conversation',
      content: 'Запись 1',
      priority: 'low',
      keywords: ['тест'],
    });

    saveOperational({
      type: 'conversation',
      content: 'Запись 2',
      priority: 'low',
      keywords: ['тест'],
    });

    const recent = getRecent(1);
    expect(recent.length).toBe(1);
  });
});

// ──────────────────────────────────────────────
// Тесты контекста и статистики
// ──────────────────────────────────────────────

describe('Memory API — Контекст и статистика', () => {
  beforeEach(() => {  initMemory({ verbose: false });
  });

  it('buildAiContext должен сформировать контекст', async () => {
    saveOperational({
      type: 'pipeline_result',
      content: 'Результат pipeline',
      priority: 'high',
      keywords: ['pipeline'],
    });

    const context = await buildAiContext();
    expect(context).toBeDefined();
    expect(typeof context).toBe('string');
    expect(context).toContain('# Контекст из памяти ИИ');
  });

  it('getMemoryStats должна вернуть статистику', () => {
    saveOperational({
      type: 'conversation',
      content: 'Тест',
      priority: 'low',
      keywords: ['тест'],
    });

    const stats = getMemoryStats();
    expect(stats).toBeDefined();
    expect(stats.operationalCount).toBeGreaterThanOrEqual(1);
  });

  it('performCleanup должна выполнить очистку', async () => {
    await performCleanup();
    // Не должно выбросить ошибку
  });

  it('deleteEntry должна удалить запись', () => {
    const id = saveOperational({
      type: 'conversation',
      content: 'Удаляемая запись',
      priority: 'low',
      keywords: ['удалить'],
    });

    const deleted = deleteEntry(id, 'operational');
    expect(deleted).toBe(true);
  });

  it('getEntryById должна найти запись', () => {
    const id = saveOperational({
      type: 'conversation',
      content: 'Искомая запись',
      priority: 'low',
      keywords: ['поиск'],
    });

    const entry = getEntryById(id);
    expect(entry).toBeDefined();
  });
});
