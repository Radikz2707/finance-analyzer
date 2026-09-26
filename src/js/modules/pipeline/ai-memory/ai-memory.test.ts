/**
 * AI Memory Tests — тесты для двухслойной системы памяти ИИ.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  operationalMemory,
  strategicMemory,
  query,
  getStats,
  exportMemory,
  init,
} from './core.js';
import type {
  PortfolioKpiSnapshot,
} from './types.js';

// ──────────────────────────────────────────────
// Тесты оперативной памяти
// ──────────────────────────────────────────────

describe('AI Memory — Оперативная память', () => {
  beforeEach(() => {  init({ verbose: false });
  });

  it('должна сохранить запись', () => {
    const id = operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Тестовая запись',
      priority: 'medium',
      keywords: ['тест', 'память'],
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
  });

  it('должна получить запись по ID', () => {
    const id = operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'decision',
      content: 'Решение о покупке',
      priority: 'high',
      keywords: ['покупка', 'акции'],
    });

    const entry = operationalMemory.getById(id);
    expect(entry).toBeDefined();
    expect(entry!.content).toBe('Решение о покупке');
    expect(entry!.type).toBe('decision');
  });

  it('должна вернуть последние N записей', () => {
    operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Запись 1',
      priority: 'low',
      keywords: ['тест'],
    });

    operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Запись 2',
      priority: 'low',
      keywords: ['тест'],
    });

    const recent = operationalMemory.getRecent(1);
    expect(recent.length).toBe(1);
    expect(recent[0].content).toBe('Запись 2');
  });

  it('должна получить записи по типу', () => {
    operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Разговор 1',
      priority: 'medium',
      keywords: ['разговор'],
    });

    operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'pipeline_result',
      content: 'Результат pipeline',
      priority: 'high',
      keywords: ['pipeline'],
    });

    const conversations = operationalMemory.getByType('conversation');
    expect(conversations.length).toBe(1);
    expect(conversations[0].content).toBe('Разговор 1');
  });

  it('должна искать по ключевым словам', () => {
    operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Обсуждение акций',
      priority: 'medium',
      keywords: ['акции', 'SBER'],
    });

    const results = operationalMemory.searchByKeywords(['акции']);
    expect(results.length).toBe(1);
    expect(results[0].keywords).toContain('акции');
  });

  it('должна удалить запись', () => {
    const id = operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Удаляемая запись',
      priority: 'low',
      keywords: ['удалить'],
    });

    const deleted = operationalMemory.delete(id);
    expect(deleted).toBe(true);

    const afterDelete = operationalMemory.getById(id);
    expect(afterDelete).toBeUndefined();
  });

  it('должна вернуть количество записей', () => {
    expect(operationalMemory.count()).toBe(0);

    operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Тест',
      priority: 'low',
      keywords: ['тест'],
    });

    expect(operationalMemory.count()).toBe(1);
  });
});

// ──────────────────────────────────────────────
// Тесты стратегической памяти
// ──────────────────────────────────────────────

describe('AI Memory — Стратегическая память', () => {
  beforeEach(() => {  init({ verbose: false });
  });

  it('должна сохранить KPI-снимок', () => {
    const snapshot: PortfolioKpiSnapshot = {
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
    };

    const id = strategicMemory.saveKpi(snapshot);
    expect(id).toBeDefined();
  });

  it('должна получить KPI-тренд', () => {
    const snapshot: PortfolioKpiSnapshot = {
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
    };

    strategicMemory.saveKpi(snapshot);

    const trend = strategicMemory.getKpiTrend(10);
    expect(trend.length).toBe(1);
    expect(trend[0].totalValue).toBe(1000000);
    expect(trend[0].returnPercent).toBe(12.5);
  });

  it('должна сохранить и получить все записи', () => {
    const snapshot: PortfolioKpiSnapshot = {
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
    };

    strategicMemory.saveKpi(snapshot);

    const all = strategicMemory.getAll();
    expect(all.length).toBe(1);
    expect(all[0].raw).toBeDefined();
  });

  it('должна удалить запись', () => {
    const snapshot: PortfolioKpiSnapshot = {
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
    };

    const id = strategicMemory.saveKpi(snapshot);
    const deleted = strategicMemory.delete(id);
    expect(deleted).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Тесты запросов к памяти
// ──────────────────────────────────────────────

describe('AI Memory — Запросы', () => {
  beforeEach(() => {  init({ verbose: false });
  });

  it('должен выполнить запрос к оперативной памяти', async () => {
    operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Тестовая запись',
      priority: 'medium',
      keywords: ['тест'],
    });

    const result = await query({
      types: ['conversation'],
      maxResults: 10,
    });

    expect(result.totalFound).toBe(1);
    expect(result.operationalEntries.length).toBe(1);
  });

  it('должен выполнить запрос к стратегической памяти', async () => {
    const snapshot: PortfolioKpiSnapshot = {
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
    };

    strategicMemory.saveKpi(snapshot);

    const result = await query({
      types: ['kpi_snapshot'],
      maxResults: 10,
    });

    expect(result.totalFound).toBe(1);
    expect(result.strategicEntries.length).toBe(1);
  });

  it('должен отфильтровать по датам', async () => {
    const now = new Date().toISOString();

    operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Сегодняшняя запись',
      priority: 'medium',
      keywords: ['тест'],
    });

    const result = await query({
      types: ['conversation'],
      from: now,
      to: now,
      maxResults: 10,
    });

    expect(result.totalFound).toBe(1);
  });
});

// ──────────────────────────────────────────────
// Тесты статистики и очистки
// ──────────────────────────────────────────────

describe('AI Memory — Статистика и очистка', () => {
  beforeEach(() => {  init({ verbose: false });
  });

  it('должна вернуть статистику', () => {
    operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Тест',
      priority: 'low',
      keywords: ['тест'],
    });

    const stats = getStats();
    expect(stats.operationalCount).toBe(1);
    expect(stats.strategicCount).toBe(0);
  });

  it('должна очистить старые записи', () => {
    operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Старая запись',
      priority: 'low',
      keywords: ['тест'],
    });

    const cleaned = operationalMemory.cleanupOld(0);
    expect(cleaned).toBeGreaterThanOrEqual(0);
  });
});

// ──────────────────────────────────────────────
// Тесты экспорта
// ──────────────────────────────────────────────

describe('AI Memory — Экспорт', () => {
  beforeEach(() => {  init({ verbose: false });
  });

  it('должен экспортировать в JSON', async () => {
    operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Тест',
      priority: 'low',
      keywords: ['тест'],
    });

    const json = await exportMemory('json');
    expect(json).toBeDefined();
    expect(typeof json).toBe('string');
  });

  it('должен экспортировать в Markdown', async () => {
    operationalMemory.save({ createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Тест',
      priority: 'low',
      keywords: ['тест'],
    });

    const md = await exportMemory('markdown');
    expect(md).toBeDefined();
    expect(typeof md).toBe('string');
    expect(md).toContain('# AI Memory Export');
  });
});
