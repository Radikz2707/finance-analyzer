/**
 * Dashboard Freshness Tests — индикатор свежести данных дашборда Harness.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect),
 * а не импорт из 'vitest' (ограничение окружения: vitest 5.x + vite 8.x).
 *
 * Покрытие:
 * 1. formatFreshness: метка и класс по возрасту payload (1 мин / 30 мин /
 *    граница 15 мин / невалидная дата / часы/дни)
 * 2. formatDashboardHtml: класс h-fresh для свежих данных, h-stale для
 *    устаревших (> 15 мин), текст «обновлено N мин назад»
 */

import {
  formatDashboardHtml,
  formatFreshness,
  STALE_AFTER_MS,
} from './format-dashboard-html.js';
import type { HarnessDashboardPayload } from './types.js';

/** Минута в миллисекундах */
const MINUTE_MS = 60 * 1000;

/** Полный payload для рендера блока */
function makePayload(generatedAt: string): HarnessDashboardPayload {
  return {
    scheduler: {
      mode: 'active',
      lastRunAt: new Date().toISOString(),
      skippedCycles: 0,
      cpuUsagePct: 10,
      memoryUsagePct: 40,
    },
    anomalies: [],
    quikNews: [],
    activeOrdersCount: 0,
    generatedAt,
  };
}

describe('formatFreshness', () => {
  it('данные возрастом 1 минута → «обновлено 1 мин назад», свежие', () => {
    const now = Date.parse('2026-09-26T12:00:00.000Z');
    const generatedAt = new Date(now - 1 * MINUTE_MS).toISOString();

    const freshness = formatFreshness(generatedAt, now);
    expect(freshness.label).toBe('обновлено 1 мин назад');
    expect(freshness.isStale).toBe(false);
  });

  it('данные возрастом 30 минут → «обновлено 30 мин назад», устаревшие', () => {
    const now = Date.parse('2026-09-26T12:00:00.000Z');
    const generatedAt = new Date(now - 30 * MINUTE_MS).toISOString();

    const freshness = formatFreshness(generatedAt, now);
    expect(freshness.label).toBe('обновлено 30 мин назад');
    expect(freshness.isStale).toBe(true);
  });

  it('возраст ровно 15 минут → ещё свежие (порог строго больше)', () => {
    const now = Date.parse('2026-09-26T12:00:00.000Z');
    const generatedAt = new Date(now - STALE_AFTER_MS).toISOString();

    const freshness = formatFreshness(generatedAt, now);
    expect(freshness.isStale).toBe(false);
  });

  it('возраст чуть больше 15 минут → устаревшие', () => {
    const now = Date.parse('2026-09-26T12:00:00.000Z');
    const generatedAt = new Date(now - STALE_AFTER_MS - 1000).toISOString();

    const freshness = formatFreshness(generatedAt, now);
    expect(freshness.isStale).toBe(true);
  });

  it('свежая запись (< 1 минуты) → «только что»', () => {
    const now = Date.parse('2026-09-26T12:00:00.000Z');
    const generatedAt = new Date(now - 10_000).toISOString();

    const freshness = formatFreshness(generatedAt, now);
    expect(freshness.label).toBe('только что');
    expect(freshness.isStale).toBe(false);
  });

  it('невалидная дата → «время недоступно», устаревшие', () => {
    const freshness = formatFreshness('not-a-date', Date.now());
    expect(freshness.label).toBe('время недоступно');
    expect(freshness.isStale).toBe(true);
  });

  it('возраст больше часа → часы и минуты', () => {
    const now = Date.parse('2026-09-26T12:00:00.000Z');
    const generatedAt = new Date(now - 61 * MINUTE_MS).toISOString();

    const freshness = formatFreshness(generatedAt, now);
    expect(freshness.label).toBe('обновлено 1 ч 1 мин назад');
    expect(freshness.isStale).toBe(true);
  });

  it('возраст больше суток → дни', () => {
    const now = Date.parse('2026-09-26T12:00:00.000Z');
    const generatedAt = new Date(now - 2 * 24 * 60 * MINUTE_MS).toISOString();

    const freshness = formatFreshness(generatedAt, now);
    expect(freshness.label).toBe('обновлено 2 д назад');
    expect(freshness.isStale).toBe(true);
  });
});

describe('formatDashboardHtml (свежесть в блоке)', () => {
  it('payload возрастом 1 минута → класс h-fresh и корректный текст', () => {
    const generatedAt = new Date(Date.now() - 1 * MINUTE_MS).toISOString();
    const html = formatDashboardHtml(makePayload(generatedAt));

    expect(html).toContain('class="harness-block h-fresh"');
    expect(html).toContain('обновлено 1 мин назад');
    expect(html).not.toContain('h-stale');
  });

  it('payload возрастом 30 минут → класс h-stale присутствует', () => {
    const generatedAt = new Date(Date.now() - 30 * MINUTE_MS).toISOString();
    const html = formatDashboardHtml(makePayload(generatedAt));

    expect(html).toContain('h-stale');
    expect(html).toContain('обновлено 30 мин назад');
    expect(html).not.toContain('class="harness-block h-fresh"');
  });

  it('битая метка времени → h-stale и «время недоступно»', () => {
    const html = formatDashboardHtml(makePayload('garbage-timestamp'));

    expect(html).toContain('h-stale');
    expect(html).toContain('время недоступно');
  });
});
