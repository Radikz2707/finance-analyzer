/**
 * DataOrchestrator — ядро оркестрации источников данных.
 *
 * Запускает все источники через Promise.allSettled, у каждого —
 * конфигурируемый таймаут. Результат: { status: ok | unavailable, data | причина }.
 * Никаких выдуманных данных при сбое — honest-output.
 */

import { defaultOrchestratorConfig, type OrchestratorConfig } from './orchestrator-config.js';
import { SourceRegistry } from './source-registry.js';
import type { OrchestratorRunResult } from './source-result.js';
import { buildPipelineSnapshot } from './build-snapshot.js';

// ──────────────────────────────────────────────
// 1. DataOrchestrator
// ──────────────────────────────────────────────

/**
 * DataOrchestrator — запускает все источники параллельно,
 * собирает результаты и снапшот.
 */
export class DataOrchestrator {
  private config: OrchestratorConfig;
  private registry: SourceRegistry;

  constructor(
    config?: OrchestratorConfig,
    registry?: SourceRegistry,
  ) {
    this.config = { ...defaultOrchestratorConfig, ...config };
    this.registry = registry ?? new SourceRegistry({
      cacheTtlMs: this.config.cacheTtlMs,
    });
  }

  /** Получить реестр (для регистрации источников). */
  get sourceRegistry(): SourceRegistry {
    return this.registry;
  }

  /** Конфигурация. */
  get configValue(): OrchestratorConfig {
    return this.config;
  }

  /**
   * Запустить оркестрацию всех активных источников.
   *
   * При enabled=false — возвращает { skipped: true }, DataAgent
   * идёт по старому пути.
   */
  async execute(): Promise<OrchestratorRunResult> {
    // Если отключён — пропускаем
    if (!this.config.enabled) {
      return {
        snapshot: {
          asOf: new Date().toISOString(),
          sources: [],
          okData: new Map(),
          unavailableSources: [],
        },
        skipped: true,
      };
    }

    const start = Date.now();

    // Получаем список активных источников
    const activeIds = this.registry.getActiveSourceIds();

    if (activeIds.length === 0) {
      return {
        snapshot: {
          asOf: new Date().toISOString(),
          sources: [],
          okData: new Map(),
          unavailableSources: [],
        },
        skipped: true,
      };
    }

    // Запускаем все источники параллельно через Promise.allSettled
    const promises = activeIds.map(async (id) => {
      return this.registry.fetch(id);
    });

    const results = await Promise.allSettled<OrchestratorRunResult['snapshot']['sources'][number]>(
      promises,
    );

    // Собираем результаты
    const sources: OrchestratorRunResult['snapshot']['sources'] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const id = activeIds[i]!;

      if (result.status === 'fulfilled') {
        sources.push(result.value);
      } else {
        // Promise rejected — крайне редкий случай (например, fetcher бросил sync)
        sources.push({
          id,
          status: 'unavailable',
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
          durationMs: Date.now() - start,
        });
      }
    }

    // Строим снапшот
    const snapshot = buildPipelineSnapshot(sources);
    const totalDuration = Date.now() - start;

    // ── Гейт доступности источников (прокси-метрика) ────────────────
    // Это НЕ реальный qualityScore из DataQualityValidator.
    // sourcesOk = ok-источники / total-источники — грубая метрика
    // доступности. Реальный qualityScore подключается в Phase 2 через
    // слой маппинга: источники → активы → validator.validateMultiple()
    // (см. README.md, раздел Техдолг).
    // ────────────────────────────────────────────────────────────────
    const unavailableCount = sources.filter((s) => s.status === 'unavailable').length;
    console.log(
      `[ORCHESTRATOR] sourcesOk=${snapshot.okData.size}/${sources.length} ` +
      `unavailable=${unavailableCount} ` +
      `stopMode=${this.config.mode === 'stop'}`,
    );

    return {
      snapshot,
      skipped: false,
      totalDurationMs: totalDuration,
    };
  }

  /**
   * Очистить кэш реестра (для нового прогона).
   */
  clearCache(): void {
    this.registry.clearCache();
  }
}
