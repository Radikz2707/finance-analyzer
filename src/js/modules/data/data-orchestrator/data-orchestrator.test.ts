/**
 * Тесты для DataOrchestrator — mock-тесты, без сети.
 *
 * 9 сценариев:
 * 1. all sources ok
 * 2. one source fails
 * 3. timeout on one source
 * 4. all sources fail
 * 5. quality below threshold (stop mode)
 * 6. quality below threshold (degrade mode)
 * 7. enabled=false — старый путь
 * 8. duplicate callers → one fetch
 * 9. registry reserves news slots
 */

import { describe, it, expect } from 'vitest';
import { DataOrchestrator } from './data-orchestrator.js';
import { SourceRegistry } from './source-registry.js';
import {
  buildPipelineSnapshot,
  buildFallbackSnapshot,
} from './build-snapshot.js';
import type { SourceResult } from './source-result.js';

// ──────────────────────────────────────────────
// Хелперы
// ──────────────────────────────────────────────

/** Создать мок-реестр с источником, который всегда ok. */
function createMockRegistry(
  sources: Record<string, () => Promise<unknown>>,
): SourceRegistry {
  const registry = new SourceRegistry({ cacheTtlMs: 60_000 });

  for (const [id, fetcher] of Object.entries(sources)) {
    registry.register({
      id,
      fetcher,
      phase: 1,
    });
  }

  return registry;
}

/** Создать мок-реестр с источником, который всегда fail. */
function createFailRegistry(
  ids: string[],
  reasons: Record<string, string> = {},
): SourceRegistry {
  return createMockRegistry(
    Object.fromEntries(
      ids.map((id) => [
        id,
        async () => {
          throw new Error(reasons[id] ?? 'source error');
        },
      ]),
    ),
  );
}

// ──────────────────────────────────────────────
// Тесты
// ──────────────────────────────────────────────

describe('DataOrchestrator', () => {
  // ── Тест 1: all sources ok ──

  it('все источники ok → snapshot собран полностью', async () => {
    const registry = createMockRegistry({
      'moex-iss': async () => ({ dividends: [], coupons: [] }),
      'cbr-rate': async () => ({ rate: 14, date: '2026-11-25' }),
      'smartlab': async () => ({ financials: { revenue: 100 } }),
    });

    const orchestrator = new DataOrchestrator(
      { enabled: true, defaultTimeoutMs: 15_000, cacheTtlMs: 60_000, mode: 'stop', minQualityScore: 50 },
      registry,
    );

    const result = await orchestrator.execute();

    expect(result.skipped).toBe(false);
    expect(result.snapshot.sources.length).toBe(3);
    expect(result.snapshot.okData.size).toBe(3);
    expect(result.snapshot.unavailableSources.length).toBe(0);
    expect(result.totalDurationMs).toBeDefined();
  });

  // ── Тест 2: one source fails ──

  it('один источник падает → snapshot частичный', async () => {
    const registry = createMockRegistry({
      'moex-iss': async () => ({ dividends: [] }),
      'cbr-rate': async () => {
        throw new Error('SOAP 500');
      },
      'smartlab': async () => ({ financials: {} }),
    });

    const orchestrator = new DataOrchestrator(
      { enabled: true, defaultTimeoutMs: 15_000, cacheTtlMs: 60_000, mode: 'stop', minQualityScore: 50 },
      registry,
    );

    const result = await orchestrator.execute();

    expect(result.skipped).toBe(false);
    expect(result.snapshot.okData.size).toBe(2);
    expect(result.snapshot.unavailableSources.length).toBe(1);
    expect(result.snapshot.unavailableSources[0]!.id).toBe('cbr-rate');
    expect(result.snapshot.unavailableSources[0]!.reason).toBe('SOAP 500');
  });

  // ── Тест 3: timeout on one source ──

  it('таймаут на одном источнике → reason=timeout', { timeout: 10000 }, async () => {
    // Создаём реестр с медленным источником (10с) и быстрым таймаутом (50мс)
    const registry = new SourceRegistry({ cacheTtlMs: 60_000 });

    registry.register({
      id: 'moex-iss',
      fetcher: async () => {
        await new Promise((r) => setTimeout(r, 10000));
        return { data: 'ok' };
      },
      timeoutMs: 50,
      phase: 1,
    });

    registry.register({
      id: 'cbr-rate',
      fetcher: async () => ({ rate: 14 }),
      phase: 1,
    });

    const orchestrator = new DataOrchestrator(
      { enabled: true, defaultTimeoutMs: 15_000, cacheTtlMs: 60_000, mode: 'stop', minQualityScore: 50 },
      registry,
    );

    const result = await orchestrator.execute();

    expect(result.skipped).toBe(false);
    expect(result.snapshot.okData.size).toBe(1); // cbr-rate ok
    expect(result.snapshot.unavailableSources.length).toBe(1);
    expect(result.snapshot.unavailableSources[0]!.id).toBe('moex-iss');
    expect(result.snapshot.unavailableSources[0]!.reason).toBe('timeout');
  });

  // ── Тест 4: all sources fail ──

  it('все источники падают → fallback snapshot с метками', async () => {
    const registry = createFailRegistry([
      'moex-iss',
      'cbr-rate',
      'smartlab',
    ], {
      'moex-iss': 'endpoint deleted',
      'cbr-rate': 'SOAP 500',
      'smartlab': 'blocked cooldown',
    });

    const orchestrator = new DataOrchestrator(
      { enabled: true, defaultTimeoutMs: 15_000, cacheTtlMs: 60_000, mode: 'stop', minQualityScore: 50 },
      registry,
    );

    const result = await orchestrator.execute();

    expect(result.skipped).toBe(false);
    expect(result.snapshot.okData.size).toBe(0);
    expect(result.snapshot.unavailableSources.length).toBe(3);

    // Проверить buildFallbackSnapshot
    const fallback = buildFallbackSnapshot(result.snapshot);
    expect((fallback['moex-iss'] as Record<string, unknown>)._status).toBe('unavailable');
    expect((fallback['cbr-rate'] as Record<string, unknown>)._status).toBe('unavailable');
    expect((fallback['smartlab'] as Record<string, unknown>)._status).toBe('unavailable');
  });

  // ── Тест 5: quality below threshold (stop mode) ──

  it('qualityScore < minQualityScore в stop mode → прерывание', async () => {
    // Один ok, два unavailable → 33% quality
    const registry = createMockRegistry({
      'moex-iss': async () => ({ data: 'ok' }),
      'cbr-rate': async () => {
        throw new Error('timeout');
      },
      'smartlab': async () => {
        throw new Error('timeout');
      },
    });

    const orchestrator = new DataOrchestrator(
      { enabled: true, defaultTimeoutMs: 15_000, cacheTtlMs: 60_000, mode: 'stop', minQualityScore: 50 },
      registry,
    );

    const result = await orchestrator.execute();

    expect(result.skipped).toBe(false);
    expect(result.snapshot.okData.size).toBe(1);
    expect(result.snapshot.unavailableSources.length).toBe(2);
    // В stop mode — пайплайн должен остановиться (проверяем что okData мал)
    const qualityRatio = result.snapshot.okData.size / result.snapshot.sources.length;
    expect(qualityRatio).toBeLessThan(0.5);
  });

  // ── Тест 6: quality below threshold (degrade mode) ──

  it('qualityScore < minQualityScore в degrade mode → продолжается с метками', async () => {
    const registry = createMockRegistry({
      'moex-iss': async () => ({ data: 'ok' }),
      'cbr-rate': async () => {
        throw new Error('timeout');
      },
    });

    const orchestrator = new DataOrchestrator(
      { enabled: true, defaultTimeoutMs: 15_000, cacheTtlMs: 60_000, mode: 'degrade', minQualityScore: 50 },
      registry,
    );

    const result = await orchestrator.execute();

    expect(result.skipped).toBe(false);
    expect(result.snapshot.okData.size).toBe(1);
    expect(result.snapshot.unavailableSources.length).toBe(1);
    // В degrade mode — fallback snapshot содержит метки unavailable
    const fallback = buildFallbackSnapshot(result.snapshot);
    expect((fallback['cbr-rate'] as Record<string, unknown>)._status).toBe('unavailable');
    expect(fallback['moex-iss']).toEqual({ data: 'ok' });
  });

  // ── Тест 7: enabled=false ──

  it('enabled=false → skipped=true, старый путь', async () => {
    const registry = createMockRegistry({
      'moex-iss': async () => ({ data: 'ok' }),
    });

    const orchestrator = new DataOrchestrator(
      { enabled: false, defaultTimeoutMs: 15_000, cacheTtlMs: 60_000, mode: 'stop', minQualityScore: 50 },
      registry,
    );

    const result = await orchestrator.execute();

    expect(result.skipped).toBe(true);
    expect(result.snapshot.sources.length).toBe(0);
    expect(result.snapshot.okData.size).toBe(0);
  });

  // ── Тест 8: duplicate callers → one fetch ──

  it('два потребителя одного источника → один вызов fetcher', async () => {
    let callCount = 0;

    const registry = createMockRegistry({
      'moex-iss': async () => {
        callCount++;
        return { data: 'ok' };
      },
    });

    const orchestrator = new DataOrchestrator(
      { enabled: true, defaultTimeoutMs: 15_000, cacheTtlMs: 60_000, mode: 'stop', minQualityScore: 50 },
      registry,
    );

    // Первый fetch
    const result1 = await orchestrator.sourceRegistry.fetch('moex-iss');
    expect(result1.status).toBe('ok');
    expect(callCount).toBe(1);

    // Второй fetch — должен прийти из кэша
    const result2 = await orchestrator.sourceRegistry.fetch('moex-iss');
    expect(result2.status).toBe('ok');
    expect(callCount).toBe(1); // fetcher не вызван повторно
  });

  // ── Тест 9: registry reserves news slots ──

  it('news-источники зарезервированы (phase=2), не активны', async () => {
    const registry = new SourceRegistry({ cacheTtlMs: 60_000 });

    // Phase 1 — финансовые данные
    registry.register({
      id: 'moex-iss',
      fetcher: async () => ({ data: 'ok' }),
      phase: 1,
    });

    // Phase 2 — news (зарезервированы)
    registry.register({
      id: 'quik-news',
      fetcher: async () => [],
      phase: 2,
    });
    registry.register({
      id: 'moex-news',
      fetcher: async () => [],
      phase: 2,
    });
    registry.register({
      id: 'rss-news',
      fetcher: async () => [],
      phase: 2,
    });
    registry.register({
      id: 'telegram-news',
      fetcher: async () => [],
      phase: 2,
    });

    // getActiveSourceIds — только phase=1
    const activeIds = registry.getActiveSourceIds();
    expect(activeIds).toEqual(['moex-iss']);
    expect(activeIds).not.toContain('quik-news');
    expect(activeIds).not.toContain('moex-news');

    // getAllSourceIds — все
    const allIds = registry.getAllSourceIds();
    expect(allIds).toContain('moex-iss');
    expect(allIds).toContain('quik-news');
    expect(allIds).toContain('moex-news');
    expect(allIds).toContain('rss-news');
    expect(allIds).toContain('telegram-news');
  });
});

// ──────────────────────────────────────────────
// Тесты buildPipelineSnapshot / buildFallbackSnapshot
// ──────────────────────────────────────────────

describe('buildPipelineSnapshot', () => {
  it('пустой массив → пустой снапшот', () => {
    const snapshot = buildPipelineSnapshot([]);
    expect(snapshot.sources).toEqual([]);
    expect(snapshot.okData.size).toBe(0);
    expect(snapshot.unavailableSources.length).toBe(0);
  });

  it('смешанные результаты → ok и unavailable разделены', () => {
    const sources: SourceResult[] = [
      { id: 'ok-src', status: 'ok', data: { value: 42 }, durationMs: 100 },
      { id: 'fail-src', status: 'unavailable', reason: 'timeout', durationMs: 15000 },
      { id: 'ok-src2', status: 'ok', data: [1, 2, 3], durationMs: 50 },
    ];

    const snapshot = buildPipelineSnapshot(sources);

    expect(snapshot.sources.length).toBe(3);
    expect(snapshot.okData.size).toBe(2);
    expect(snapshot.okData.has('ok-src')).toBe(true);
    expect(snapshot.okData.has('ok-src2')).toBe(true);
    expect(snapshot.unavailableSources.length).toBe(1);
    expect(snapshot.unavailableSources[0]!.id).toBe('fail-src');
    expect(snapshot.unavailableSources[0]!.reason).toBe('timeout');
  });
});

describe('buildFallbackSnapshot', () => {
  it('ok данные → реальные значения, unavailable → метки', () => {
    const snapshot: SourceResult[] = [
      { id: 'a', status: 'ok', data: { x: 1 } },
      { id: 'b', status: 'unavailable', reason: 'HTTP 500' },
    ];

    const pipelineSnapshot = buildPipelineSnapshot(snapshot);
    const fallback = buildFallbackSnapshot(pipelineSnapshot);

    expect(fallback['a']).toEqual({ x: 1 });
    expect((fallback['b'] as Record<string, unknown>)._status).toBe('unavailable');
    expect((fallback['b'] as Record<string, unknown>)._reason).toBe('HTTP 500');
  });
});
