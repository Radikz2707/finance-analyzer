/**
 * BuildSnapshot — сборка снапшота из результатов источников.
 *
 * buildPipelineSnapshot — собирает ok-данные и unavailable-метки.
 * buildFallbackSnapshot — для несостоявшихся источников ставит явные метки unavailable.
 */

import type {
  PipelineSnapshot,
  SourceResult,
} from './source-result.js';

// ──────────────────────────────────────────────
// 1. buildPipelineSnapshot
// ──────────────────────────────────────────────

/**
 * Построить снапшот из результатов источников.
 *
 * okData — Map<id, data> для ok-источников.
 * unavailableSources — список недоступных с причинами.
 */
export function buildPipelineSnapshot(
  sources: SourceResult[],
): PipelineSnapshot {
  const okData = new Map<string, unknown>();
  const unavailableSources: PipelineSnapshot['unavailableSources'] = [];

  for (const source of sources) {
    if (source.status === 'ok' && source.data !== undefined) {
      okData.set(source.id, source.data);
    } else {
      unavailableSources.push({
        id: source.id,
        reason: source.reason,
        durationMs: source.durationMs,
      });
    }
  }

  return {
    asOf: new Date().toISOString(),
    sources,
    okData,
    unavailableSources,
  };
}

// ──────────────────────────────────────────────
// 2. buildFallbackSnapshot
// ──────────────────────────────────────────────

/**
 * Построить fallback-снапшот: из ok-источников + явные метки unavailable.
 *
 * Используется для передачи в DataQualityValidator:
 * - ok-источники передаются как данные.
 * - unavailable-источники помечаются явными метками,
 *   чтобы валидатор мог оценить полноту.
 */
export function buildFallbackSnapshot(
  snapshot: PipelineSnapshot,
): Record<string, unknown> {
  const fallback: Record<string, unknown> = {};

  // ok-источники — реальные данные
  for (const [id, data] of snapshot.okData) {
    fallback[id] = data;
  }

  // unavailable — явные метки
  for (const unavailable of snapshot.unavailableSources) {
    fallback[unavailable.id] = {
      _status: 'unavailable' as const,
      _reason: unavailable.reason ?? 'unknown',
      _durationMs: unavailable.durationMs,
    };
  }

  return fallback;
}
