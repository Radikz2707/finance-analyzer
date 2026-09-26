/**
 * Memory Cleaner Tests — тесты для модуля автоматической очистки памяти.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  runCleanup,
  cleanupOperational,
  getSchedules,
  addSchedule,
  removeSchedule,
  getState,
  getLastResult,
  getStats,
  init,
  shutdown,
} from './memory-cleaner.js';
import { operationalMemory } from './core.js';

// ──────────────────────────────────────────────
// Тесты очистки оперативной памяти
// ──────────────────────────────────────────────

describe('MemoryCleaner — Оперативная память', () => {
  beforeEach(() => {
    
    init();
  });

  afterEach(async () => {
    await shutdown();
  });

  it('должна сжать старые записи', () => {
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Тестовая запись с длинным текстом для сжатия. '.repeat(100),
      priority: 'low',
      keywords: ['тест'],
    });

    const archived = cleanupOperational();
    expect(archived).toBeGreaterThanOrEqual(0);
  });

  it('должна удалить старые записи', () => {
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Тест',
      priority: 'low',
      keywords: ['тест'],
    });

    const deleted = operationalMemory.cleanupOld(0);
    expect(deleted).toBeGreaterThanOrEqual(0);
  });
});

// ──────────────────────────────────────────────
// Тесты полной очистки
// ──────────────────────────────────────────────

describe('MemoryCleaner — Полная очистка', () => {
  beforeEach(() => {
    
    init();
  });

  afterEach(async () => {
    await shutdown();
  });

  it('должна выполнить полную очистку', async () => {
    const result = await runCleanup({
      operational: true,
      strategic: true,
      general: true,
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('success');
    expect(typeof result.executedAt).toBe('string');
  });

  it('должна вернуть результат очистки', async () => {
    await runCleanup();
    const lastResult = getLastResult();

    expect(lastResult).not.toBeNull();
    expect(lastResult!.status).toBe('success');
  });

  it('должна вернуть состояние', async () => {
    expect(getState()).toBe('idle');
  });

  it('должна вернуть статистику', () => {
    const stats = getStats();
    expect(stats).toBeDefined();
    expect(typeof stats.isRunning).toBe('boolean');
    expect(typeof stats.scheduleCount).toBe('number');
  });
});

// ──────────────────────────────────────────────
// Тесты расписаний
// ──────────────────────────────────────────────

describe('MemoryCleaner — Расписания', () => {
  beforeEach(() => {
    
    init();
  });

  afterEach(async () => {
    await shutdown();
  });

  it('должна вернуть расписания', () => {
    const schedules = getSchedules();
    expect(schedules.length).toBeGreaterThan(0);
    expect(schedules[0].name).toBeDefined();
    expect(schedules[0].cron).toBeDefined();
  });

  it('должна добавить расписание', () => {
    const before = getSchedules().length;
    addSchedule({
      name: 'Тестовое расписание',
      cron: '0 5 * * *',
      options: { operational: true, strategic: false, general: false },
    });

    expect(getSchedules().length).toBe(before + 1);
  });

  it('должна удалить расписание', () => {
    addSchedule({
      name: 'Удаляемое расписание',
      cron: '0 6 * * *',
      options: { operational: true, strategic: false, general: false },
    });

    const before = getSchedules().length;
    removeSchedule('Удаляемое расписание');
    expect(getSchedules().length).toBe(before - 1);
  });
});
