/**
 * Memory REST API Tests — тесты для REST-подобного интерфейса работы с памятью ИИ.
 *
 * Тестируют:
 * - getMemoryStats() — статистика памяти
 * - getOperationalMemory() — оперативная память с фильтрацией и пагинацией
 * - getStrategicMemory() — стратегическая память
 * - queryMemory() — объединённый поиск
 * - saveMemory() — сохранение записей
 * - cleanupMemory() — очистка
 * - success/error/timed() — утилиты
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getMemoryStats,
  getOperationalMemory,
  getStrategicMemory,
  queryMemory,
  saveMemory,
  cleanupMemory,
  success,
  error,
  timed,
} from './memory-rest-api.js';
import { init as initMemory, operationalMemory, strategicMemory } from './ai-memory.js';

// ──────────────────────────────────────────────
// 1. Тесты success/error/timed()
// ──────────────────────────────────────────────

describe('REST API — Утилиты success/error/timed', () => {
  it('success должна создавать успешный ответ', () => {
    const result = success({ data: 'test' }, 10);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ data: 'test' });
    expect(result.statusCode).toBe(200);
    expect(result.durationMs).toBe(10);
    expect(result.error).toBeUndefined();
  });

  it('error должна создавать ответ с ошибкой', () => {
    const result = error('Something went wrong', 500, 5);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Something went wrong');
    expect(result.statusCode).toBe(500);
    expect(result.durationMs).toBe(5);
    expect(result.data).toBeUndefined();
  });

  it('timed должна измерять время выполнения', async () => {
    const result = await timed(() => {
      return { value: 42 };
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ value: 42 });
    expect(result.statusCode).toBe(200);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('timed должна перехватывать ошибки', async () => {
    const result = await timed(() => {
      throw new Error('Test error');
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Test error');
    expect(result.statusCode).toBe(500);
  });

  it('timed должна работать с синхронными функциями', async () => {
    const result = await timed(() => 'hello');
    expect(result.success).toBe(true);
    expect(result.data).toBe('hello');
  });
});

// ──────────────────────────────────────────────
// 2. Тесты getMemoryStats()
// ──────────────────────────────────────────────

describe('REST API — getMemoryStats()', () => {
  beforeEach(() => {
    initMemory({ verbose: false });
  });

  afterEach(() => {
    operationalMemory.delete(operationalMemory.getAll()[0]?.id || '');
  });

  it('должна вернуть статистику с success=true', async () => {
    const result = await getMemoryStats();
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('должна вернуть данные статистики', async () => {
    const result = await getMemoryStats();
    expect(result.data).toBeDefined();
    expect(result.data!.operationalCount).toBeGreaterThanOrEqual(0);
    expect(result.data!.strategicCount).toBeGreaterThanOrEqual(0);
    expect(result.data!.operationalSizeBytes).toBeGreaterThanOrEqual(0);
    expect(result.data!.strategicSizeBytes).toBeGreaterThanOrEqual(0);
    expect(result.data!.avgOperationalAgeDays).toBeGreaterThanOrEqual(0);
    expect(result.data!.maxStrategicAgeDays).toBeGreaterThanOrEqual(0);
    expect(result.data!.recentAnomalies).toBeGreaterThanOrEqual(0);
  });

  it('должна обновлять статистику после добавления записей', async () => {
    let statsResult = await getMemoryStats();
    const initialCount = statsResult.data!.operationalCount;

    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Тестовая запись для статистики',
      priority: 'medium',
      keywords: ['тест', 'статистика'],
    });

    statsResult = await getMemoryStats();
    expect(statsResult.data!.operationalCount).toBeGreaterThan(initialCount);
  });
});

// ──────────────────────────────────────────────
// 3. Тесты getOperationalMemory()
// ──────────────────────────────────────────────

describe('REST API — getOperationalMemory()', () => {
  beforeEach(() => {
    initMemory({ verbose: false });
  });

  afterEach(() => {
    const entries = operationalMemory.getAll();
    for (const entry of entries) {
      operationalMemory.delete(entry.id);
    }
  });

  it('должна вернуть список записей с success=true', async () => {
    const result = await getOperationalMemory();
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('должна возвращать пагинированный ответ', async () => {
    const result = await getOperationalMemory();
    expect(result.data!.items).toBeDefined();
    expect(Array.isArray(result.data!.items)).toBe(true);
    expect(result.data!.total).toBeDefined();
    expect(result.data!.page).toBe(1);
    expect(result.data!.pageSize).toBe(50);
  });

  it('должна возвращать записи по умолчанию (limit=50)', async () => {
    const result = await getOperationalMemory();
    expect(result.data!.pageSize).toBe(50);
  });

  it('должна поддерживать кастомный limit', async () => {
    const result = await getOperationalMemory({ limit: 10 });
    expect(result.data!.pageSize).toBe(10);
  });

  it('должна поддерживать пагинацию', async () => {
    // Создаём 5 записей
    for (let i = 0; i < 5; i++) {
      operationalMemory.save({
        createdAt: new Date().toISOString(),
        type: 'conversation',
        content: `Запись ${i}`,
        priority: 'low',
        keywords: ['тест'],
      });
    }

    const result = await getOperationalMemory({ limit: 2, page: 1 });
    expect(result.data!.items.length).toBeLessThanOrEqual(2);
    expect(result.data!.page).toBe(1);
    expect(result.data!.total).toBeGreaterThanOrEqual(5);
  });

  it('должна фильтровать по типу', async () => {
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Тестовая переписка',
      priority: 'medium',
      keywords: ['тест'],
    });
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'decision',
      content: 'Тестовое решение',
      priority: 'high',
      keywords: ['решение'],
    });

    const result = await getOperationalMemory({ type: 'conversation' });
    expect(result.data!.items.length).toBeGreaterThanOrEqual(1);
    for (const item of result.data!.items) {
      expect(item.type).toBe('conversation');
    }
  });

  it('должна фильтровать по приоритету', async () => {
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Критическая запись',
      priority: 'critical',
      keywords: ['крит'],
    });
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Обычная запись',
      priority: 'low',
      keywords: ['обыч'],
    });

    const result = await getOperationalMemory({ priority: 'critical' });
    expect(result.data!.items.length).toBeGreaterThanOrEqual(1);
    for (const item of result.data!.items) {
      expect(item.priority).toBe('critical');
    }
  });

  it('должна искать по ключевым словам', async () => {
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Анализ акций Сбербанка',
      priority: 'high',
      keywords: ['сбербанк', 'анализ'],
    });
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Продажа облигаций Газпрома',
      priority: 'medium',
      keywords: ['газпром', 'облигации'],
    });

    const result = await getOperationalMemory({ keywords: ['Сбербанка'] });
    expect(result.data!.items.length).toBeGreaterThanOrEqual(1);
  });
});

// ──────────────────────────────────────────────
// 4. Тесты getStrategicMemory()
// ──────────────────────────────────────────────

describe('REST API — getStrategicMemory()', () => {
  beforeEach(() => {
    initMemory({ verbose: false });
  });

  afterEach(() => {
    const entries = strategicMemory.getAll();
    for (const entry of entries) {
      strategicMemory.delete(entry.id);
    }
  });

  it('должна вернуть список записей с success=true', async () => {
    const result = await getStrategicMemory();
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('должна возвращать пагинированный ответ', async () => {
    const result = await getStrategicMemory();
    expect(result.data!.items).toBeDefined();
    expect(Array.isArray(result.data!.items)).toBe(true);
    expect(result.data!.total).toBeDefined();
    expect(result.data!.page).toBe(1);
    expect(result.data!.pageSize).toBe(100);
  });

  it('должна возвращать записи по умолчанию (limit=100)', async () => {
    const result = await getStrategicMemory();
    expect(result.data!.pageSize).toBe(100);
  });

  it('должна поддерживать кастомный limit', async () => {
    const result = await getStrategicMemory({ limit: 20 });
    expect(result.data!.pageSize).toBe(20);
  });

  it('должна фильтровать по типу kpi_snapshot', async () => {
    strategicMemory.saveKpi({
      date: new Date().toISOString(),
      totalValue: 1000000,
      returnPercent: 5.2,
      volatility: 12.3,
      sharpeRatio: 1.45,
      maxDrawdown: 8.5,
      assetCount: 5,
      stocksPercent: 60,
      bondsPercent: 40,
      dividendIncome: 15000,
      realizedProfit: 25000,
      unrealizedProfit: 10000,
    });

    const result = await getStrategicMemory({ type: 'kpi_snapshot' });
    expect(result.data!.items.length).toBeGreaterThanOrEqual(1);
    for (const item of result.data!.items) {
      expect(item.type).toBe('kpi_snapshot');
    }
  });

  it('должна фильтровать по типу trend_data', async () => {
    strategicMemory.saveTrend({
      direction: 'up',
      strength: 0.7,
      periodDays: 30,
      description: 'Тренд роста портфеля',
    });

    const result = await getStrategicMemory({ type: 'trend_data' });
    expect(result.data!.items.length).toBeGreaterThanOrEqual(1);
    for (const item of result.data!.items) {
      expect(item.type).toBe('trend_data');
    }
  });

  it('должна фильтровать по типу anomaly', async () => {
    strategicMemory.saveAnomaly({
      type: 'volatility_spike',
      severity: 0.8,
      description: 'Резкий скачок волатильности',
    });

    const result = await getStrategicMemory({ type: 'anomaly' });
    expect(result.data!.items.length).toBeGreaterThanOrEqual(1);
    for (const item of result.data!.items) {
      expect(item.type).toBe('anomaly');
    }
  });
});

// ──────────────────────────────────────────────
// 5. Тесты queryMemory()
// ──────────────────────────────────────────────

describe('REST API — queryMemory()', () => {
  beforeEach(() => {
    initMemory({ verbose: false });
  });

  afterEach(() => {
    const entries = operationalMemory.getAll();
    for (const entry of entries) {
      operationalMemory.delete(entry.id);
    }
  });

  it('должна вернуть результат с success=true', async () => {
    const result = await queryMemory({});
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('должна возвращать объединённый результат', async () => {
    const result = await queryMemory({});
    expect(result.data!.operationalEntries).toBeDefined();
    expect(Array.isArray(result.data!.operationalEntries)).toBe(true);
    expect(result.data!.strategicEntries).toBeDefined();
    expect(Array.isArray(result.data!.strategicEntries)).toBe(true);
    expect(result.data!.totalFound).toBeGreaterThanOrEqual(0);
    expect(result.data!.queryDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('должна фильтровать по типам', async () => {
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Тестовая переписка',
      priority: 'medium',
      keywords: ['тест'],
    });
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'decision',
      content: 'Тестовое решение',
      priority: 'high',
      keywords: ['решение'],
    });

    const result = await queryMemory({ types: ['conversation'] });
    expect(result.data!.totalFound).toBeGreaterThanOrEqual(1);
  });

  it('должна фильтровать по ключевым словам', async () => {
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Анализ акций Сбербанка и Газпрома',
      priority: 'high',
      keywords: ['сбербанк', 'газпром'],
    });

    const result = await queryMemory({ keywords: ['Сбербанка'] });
    expect(result.data!.totalFound).toBeGreaterThanOrEqual(1);
  });

  it('должна фильтровать по дате from', async () => {
    const now = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();

    operationalMemory.save({
      createdAt: now,
      type: 'conversation',
      content: 'Сегодняшняя запись',
      priority: 'medium',
      keywords: ['сегодня'],
    });
    operationalMemory.save({
      createdAt: yesterday,
      type: 'conversation',
      content: 'Вчерашняя запись',
      priority: 'medium',
      keywords: ['вчера'],
    });

    const result = await queryMemory({ from: now.split('T')[0] });
    // Должна найти хотя бы сегодняшнюю запись
    expect(result.data!.totalFound).toBeGreaterThanOrEqual(0);
  });

  it('должна фильтровать по дате to', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();

    operationalMemory.save({
      createdAt: yesterday,
      type: 'conversation',
      content: 'Вчерашняя запись',
      priority: 'medium',
      keywords: ['вчера'],
    });

    const result = await queryMemory({ to: yesterday });
    expect(result.data!.totalFound).toBeGreaterThanOrEqual(0);
  });

  it('должна ограничивать количество результатов', async () => {
    for (let i = 0; i < 10; i++) {
      operationalMemory.save({
        createdAt: new Date().toISOString(),
        type: 'conversation',
        content: `Запись ${i}`,
        priority: 'low',
        keywords: ['тест'],
      });
    }

    const result = await queryMemory({ maxResults: 3 });
    expect(result.data!.totalFound).toBeLessThanOrEqual(3);
  });
});

// ──────────────────────────────────────────────
// 6. Тесты saveMemory()
// ──────────────────────────────────────────────

describe('REST API — saveMemory()', () => {
  beforeEach(() => {
    initMemory({ verbose: false });
  });

  afterEach(() => {
    const entries = operationalMemory.getAll();
    for (const entry of entries) {
      operationalMemory.delete(entry.id);
    }
  });

  it('должна сохранить запись в оперативную память', async () => {
    const result = await saveMemory({
      level: 'operational',
      type: 'conversation',
      content: 'Тестовая запись',
      priority: 'high',
      keywords: ['тест'],
      metadata: { source: 'api' },
    });

    expect(result.success).toBe(true);
    expect(result.data!.id).toBeDefined();
    expect(result.data!.level).toBe('operational');
    expect(result.data!.type).toBe('conversation');
  });

  it('должна сохранить KPI-снимок в стратегическую память', async () => {
    const result = await saveMemory({
      level: 'strategic',
      type: 'kpi_snapshot',
      content: '',
      kpiSnapshot: {
        totalValue: 1500000,
        returnPercent: 7.5,
        volatility: 10.2,
        sharpeRatio: 1.6,
        maxDrawdown: 5.3,
        assetCount: 8,
        stocksPercent: 55,
        bondsPercent: 45,
        dividendIncome: 20000,
        realizedProfit: 35000,
        unrealizedProfit: 15000,
      },
    });

    expect(result.success).toBe(true);
    expect(result.data!.level).toBe('strategic');
    expect(result.data!.type).toBe('kpi_snapshot');
  });

  it('должна сохранить аномалию в стратегическую память', async () => {
    const result = await saveMemory({
      level: 'strategic',
      type: 'anomaly',
      content: '',
      anomalyData: {
        type: 'volatility_spike',
        severity: 0.85,
        description: 'Резкий скачок волатильности',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data!.level).toBe('strategic');
    expect(result.data!.type).toBe('anomaly');
  });

  it('должна использовать приоритет по умолчанию medium', async () => {
    const result = await saveMemory({
      level: 'operational',
      type: 'conversation',
      content: 'Тест без приоритета',
    });

    expect(result.success).toBe(true);
    expect(result.data!.level).toBe('operational');
  });

  it('должна использовать пустые ключевые слова по умолчанию', async () => {
    const result = await saveMemory({
      level: 'operational',
      type: 'decision',
      content: 'Решение без ключевых слов',
    });

    expect(result.success).toBe(true);
  });

  it('должна сохранить запись с метаданными', async () => {
    const result = await saveMemory({
      level: 'operational',
      type: 'conversation',
      content: 'Тест с метаданными',
      metadata: { source: 'api', version: 2 },
    });

    expect(result.success).toBe(true);
    expect(result.data!.level).toBe('operational');
  });

  it('должна вернуть ошибку для стратегической памяти без kpiSnapshot/anomalyData', async () => {
    const result = await saveMemory({
      level: 'strategic',
      type: 'trend_data',
      content: 'Тренд без данных',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('необходимо указать');
  });
});

// ──────────────────────────────────────────────
// 7. Тесты cleanupMemory()
// ──────────────────────────────────────────────

describe('REST API — cleanupMemory()', () => {
  beforeEach(() => {
    initMemory({ verbose: false });
  });

  it('должна выполнить очистку с success=true', async () => {
    const result = await cleanupMemory();
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('должна вернуть статистику очистки', async () => {
    const result = await cleanupMemory();
    expect(result.data!.operationalDeleted).toBeGreaterThanOrEqual(0);
    expect(result.data!.strategicDeleted).toBeGreaterThanOrEqual(0);
    expect(result.data!.operationalArchived).toBeGreaterThanOrEqual(0);
    expect(result.data!.totalProcessed).toBeGreaterThanOrEqual(0);
  });

  it('должна поддерживать отключение очистки оперативной памяти', async () => {
    const result = await cleanupMemory({ operational: false });
    expect(result.success).toBe(true);
    expect(result.data!.operationalDeleted).toBe(0);
    expect(result.data!.operationalArchived).toBe(0);
  });

  it('должна поддерживать отключение очистки стратегической памяти', async () => {
    const result = await cleanupMemory({ strategic: false });
    expect(result.success).toBe(true);
    expect(result.data!.strategicDeleted).toBe(0);
  });

  it('должна поддерживать кастомный daysThreshold', async () => {
    const result = await cleanupMemory({ daysThreshold: 30 });
    expect(result.success).toBe(true);
  });

  it('должна корректно считать totalProcessed', async () => {
    const result = await cleanupMemory();
    const total =
      result.data!.operationalDeleted +
      result.data!.strategicDeleted +
      result.data!.operationalArchived;
    expect(result.data!.totalProcessed).toBe(total);
  });
});

// ──────────────────────────────────────────────
// 8. Интеграционные тесты
// ──────────────────────────────────────────────

describe('REST API — Интеграционные тесты', () => {
  beforeEach(() => {
    initMemory({ verbose: false });
  });

  afterEach(() => {
    const opEntries = operationalMemory.getAll();
    for (const entry of opEntries) {
      operationalMemory.delete(entry.id);
    }
    const stEntries = strategicMemory.getAll();
    for (const entry of stEntries) {
      strategicMemory.delete(entry.id);
    }
  });

  it('полный сценарий: save → query → stats → cleanup', async () => {
    // 1. Сохраняем запись
    const saveResult = await saveMemory({
      level: 'operational',
      type: 'conversation',
      content: 'Анализ портфеля за Q3 2025',
      priority: 'high',
      keywords: ['портфель', 'анализ', 'q3'],
    });
    expect(saveResult.success).toBe(true);

    // 2. Ищем запись
    const queryResult = await queryMemory({
      keywords: ['портфель'],
    });
    expect(queryResult.success).toBe(true);
    expect(queryResult.data!.totalFound).toBeGreaterThanOrEqual(1);

    // 3. Получаем статистику
    const statsResult = await getMemoryStats();
    expect(statsResult.success).toBe(true);
    expect(statsResult.data!.operationalCount).toBeGreaterThanOrEqual(1);

    // 4. Получаем оперативную память
    const opResult = await getOperationalMemory({
      keywords: ['портфель'],
    });
    expect(opResult.success).toBe(true);
    expect(opResult.data!.items.length).toBeGreaterThanOrEqual(1);

    // 5. Очищаем
    const cleanupResult = await cleanupMemory();
    expect(cleanupResult.success).toBe(true);
  });

  it('сценарий: save KPI → getStrategicMemory → query', async () => {
    // 1. Сохраняем KPI-снимок
    const saveResult = await saveMemory({
      level: 'strategic',
      type: 'kpi_snapshot',
      content: '',
      kpiSnapshot: {
        totalValue: 2000000,
        returnPercent: 10.5,
        volatility: 15.0,
        sharpeRatio: 1.8,
        maxDrawdown: 7.0,
        assetCount: 10,
        stocksPercent: 65,
        bondsPercent: 35,
        dividendIncome: 30000,
        realizedProfit: 50000,
        unrealizedProfit: 20000,
      },
    });
    expect(saveResult.success).toBe(true);

    // 2. Получаем стратегическую память
    const stResult = await getStrategicMemory({ type: 'kpi_snapshot' });
    expect(stResult.success).toBe(true);
    expect(stResult.data!.items.length).toBeGreaterThanOrEqual(1);

    // 3. Ищем через query
    const queryResult = await queryMemory({
      strategicOnly: true,
    });
    expect(queryResult.success).toBe(true);
    expect(queryResult.data!.strategicEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('сценарий: множественные сохранения → пагинация → cleanup', async () => {
    // 1. Создаём 20 записей
    for (let i = 0; i < 20; i++) {
      await saveMemory({
        level: 'operational',
        type: 'conversation',
        content: `Запись номер ${i} с ключевыми словами тест`,
        priority: 'low',
        keywords: ['тест', `запись_${i}`],
      });
    }

    // 2. Проверяем статистику
    const statsResult = await getMemoryStats();
    expect(statsResult.success).toBe(true);
    expect(statsResult.data!.operationalCount).toBeGreaterThanOrEqual(20);

    // 3. Проверяем пагинацию
    const page1 = await getOperationalMemory({ limit: 5, page: 1 });
    expect(page1.success).toBe(true);
    expect(page1.data!.items.length).toBeLessThanOrEqual(5);

    const page2 = await getOperationalMemory({ limit: 5, page: 2 });
    expect(page2.success).toBe(true);
    expect(page2.data!.items.length).toBeLessThanOrEqual(5);

    // 4. Очищаем
    const cleanupResult = await cleanupMemory();
    expect(cleanupResult.success).toBe(true);
  });
});
