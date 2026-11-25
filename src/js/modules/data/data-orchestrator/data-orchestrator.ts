/**
 * DataOrchestrator — ядро оркестрации источников данных.
 *
 * Запускает все источники через Promise.allSettled, у каждого —
 * конфигурируемый таймаут. Результат: { status: ok | unavailable, data | причина }.
 * Никаких выдуманных данных при сбое — honest-output.
 *
 * Phase 2: маппинг okData → AssetResearchSnapshot → DataQualityValidator.
 * Гейты: sourcesOk (до маппинга) → маппинг → quality (после маппинга).
 */

import { defaultOrchestratorConfig, type OrchestratorConfig } from './orchestrator-config.js';
import { SourceRegistry } from './source-registry.js';
import type { GateDecision, OrchestratorRunResult } from './source-result.js';
import { buildPipelineSnapshot } from './build-snapshot.js';
import { DataQualityValidator } from '../data-quality/validation.js';
import type { DataQualityReport } from '../data-quality/validation.js';
import type { AssetResearchSnapshot } from '../../research/types.js';

// ──────────────────────────────────────────────
// 1. Типы для маппинга
// ──────────────────────────────────────────────

/** Актив для валидации: тикер + тип актива + опциональный ISIN. */
export interface AssetInput {
  ticker: string;
  assetType: string;
  isin?: string;
}

/** Маппинг okData → AssetResearchSnapshot.
 * Реализуется в wiring.ts как часть регистрации источников. */
export type OkDataMapper = (okData: Map<string, unknown>, assets: AssetInput[]) => Map<string, AssetResearchSnapshot | null>;

// ──────────────────────────────────────────────
// 2. DataOrchestrator
// ──────────────────────────────────────────────

/**
 * DataOrchestrator — запускает все источники параллельно,
 * собирает результаты, маппит на активы, валидирует качество.
 */
export class DataOrchestrator {
  private config: OrchestratorConfig;
  private registry: SourceRegistry;
  private mapper?: OkDataMapper;

  constructor(
    config?: OrchestratorConfig,
    registry?: SourceRegistry,
  ) {
    this.config = { ...defaultOrchestratorConfig, ...config };
    this.registry = registry ?? new SourceRegistry({
      cacheTtlMs: this.config.cacheTtlMs,
    });
  }

  /** Установить маппер okData → AssetResearchSnapshot (вызывается из wiring). */
  setMapper(mapper: OkDataMapper): void {
    this.mapper = mapper;
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
   * При enabled=false — возвращает { skipped: true, skipReason: 'flag-off' },
   * DataAgent идёт по старому пути.
   *
   * При пустом реестре — возвращает { skipped: true, skipReason: 'empty-registry' },
   * DataAgent идёт по legacy-пути с error-логом.
   *
   * При пустых тикерах — возвращает { gateDecision: 'stop' } с корректным
   * DataQualityReport — оркестратор запустился, но валидировать нечего.
   *
   * empty-registry → skipped: true — оркестратор не запускался (нет источников).
   * DataAgent идёт по legacy-пути с предупреждением (skipReason='empty-registry').
   *
   * empty-tickers → skipped: false, gateDecision: 'stop' — оркестратор запустился,
   * источники опросились, но валидировать нечего. Это результат прогона с ошибкой,
   * а не отказ от запуска. DataAgent бросает ошибку → pipeline прерывается.
   *
   * Разное поведение: "не запустился" vs "запустился, но данные невалидны".
   */
  async execute(assets: AssetInput[]): Promise<OrchestratorRunResult> {
    // 1. Если отключён — пропускаем
    if (!this.config.enabled) {
      return {
        snapshot: {
          asOf: new Date().toISOString(),
          sources: [],
          okData: new Map(),
          unavailableSources: [],
        },
        skipped: true,
        skipReason: 'flag-off',
      };
    }

    const start = Date.now();

    // 2. Пустые тикеры → stop с корректным DataQualityReport
    if (!assets || assets.length === 0) {
      const emptyReport: DataQualityReport = {
        reportDate: new Date().toISOString(),
        totalAssets: 0,
        averageQualityScore: 0,
        assetReports: [],
        globalWarnings: ['Нет тикеров для валидации'],
        summary: '0 активов проверено',
      };
      return {
        snapshot: {
          asOf: new Date().toISOString(),
          sources: [],
          okData: new Map(),
          unavailableSources: [],
        },
        skipped: false,
        gateDecision: 'stop',
        qualityReport: emptyReport,
        totalDurationMs: Date.now() - start,
      };
    }

    // 3. Пустой реестр → skipped
    const activeIds = this.registry.getActiveSourceIds();
    if (activeIds.length === 0) {
      console.error(
        '[ORCHESTRATOR] ❌ EMPTY_REGISTRY: no sources registered — ' +
        'registration wiring not implemented. ' +
        'Pipeline falls back to legacy path without quality validation.',
      );
      return {
        snapshot: {
          asOf: new Date().toISOString(),
          sources: [],
          okData: new Map(),
          unavailableSources: [{
            id: '_empty_registry',
            reason: 'no sources registered — registration wiring not implemented',
          }],
        },
        skipped: true,
        skipReason: 'empty-registry',
      };
    }

    // 4. Запускаем все источники параллельно через Promise.allSettled
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

    // ── Гейт 1: sourcesOk ──────────────────────────────────────────
    const okCount = snapshot.okData.size;
    const totalCount = sources.length;
    const sourcesOkRatio = totalCount > 0 ? okCount / totalCount : 0;
    const degradeThreshold = this.config.degradeSourcesOkRatio
      ?? this.config.minSourcesOkRatio;

    if (sourcesOkRatio < this.config.minSourcesOkRatio) {
      console.error(
        `[ORCHESTRATOR] ❌ STOP: sourcesOk=${okCount}/${totalCount} ` +
        `(${(sourcesOkRatio * 100).toFixed(0)}%) < threshold ${this.config.minSourcesOkRatio * 100}%`,
      );
      return {
        snapshot,
        skipped: false,
        gateDecision: 'stop',
        totalDurationMs: totalDuration,
      };
    }

    // Degrade: sourcesOk выше stop-порога, но ниже degrade-порога
    if (sourcesOkRatio < degradeThreshold) {
      console.warn(
        `[ORCHESTRATOR] ⚠️ DEGRADE: sourcesOk=${okCount}/${totalCount} ` +
        `(${(sourcesOkRatio * 100).toFixed(0)}%) < degrade threshold ${degradeThreshold * 100}%`,
      );
      // Продолжаем, но помечаем degrade
      // Маппинг и валидация всё равно выполняются
    }

    // 5. Маппинг okData → snapshots
    const mappedSnapshots = this.mapper
      ? this.mapper(snapshot.okData, assets)
      : new Map<string, AssetResearchSnapshot | null>();

    // 6. Валидация
    const validator = new DataQualityValidator({
      maxAgeHours: 24,
      evidenceMode: 'warning',
      noDataMode: 'penalize',
    });
    const assetsForValidation: Array<{
      ticker: string;
      snapshot: AssetResearchSnapshot | null;
      lastFetchedAt: string | null;
      assetType?: string;
    }> = assets.map((a) => ({
      ticker: a.ticker,
      snapshot: mappedSnapshots.get(a.ticker) ?? null,
      lastFetchedAt: snapshot.asOf,
      assetType: a.assetType,
    }));
    const qualityReport = validator.validateMultiple(assetsForValidation);

    // NaN-guard
    const avgScore = Number.isFinite(qualityReport.averageQualityScore)
      ? qualityReport.averageQualityScore
      : 0;

    // 7. Гейт 2: quality (ТОЛЬКО poorRatio — stop-триггер)
    const poorAssets = qualityReport.assetReports.filter(
      (r) => r.qualityScore < this.config.minQualityScore,
    ).length;
    const poorRatio = assets.length > 0 ? poorAssets / assets.length : 1;

    let gateDecision: GateDecision;

    // Degrade-флаг: sourcesOk был в degrade-зоне
    const wasDegrade = sourcesOkRatio >= this.config.minSourcesOkRatio
      && sourcesOkRatio < degradeThreshold;

    if (avgScore >= this.config.minQualityScore && poorRatio < this.config.poorAssetsRatio) {
      // Качество OK, но sourcesOk в degrade-зоне → degrade, не pass
      gateDecision = wasDegrade ? 'degrade' : 'pass';
    } else {
      gateDecision = this.config.mode === 'stop' ? 'stop' : 'degrade';
    }

    // 8. Лог с обоими порогами
    console.log(
      `[ORCHESTRATOR] sourcesOk=${okCount}/${totalCount} ` +
      `qualityScore=${avgScore}% poorAssets=${poorAssets}/${assets.length} ` +
      `gateDecision=${gateDecision}`,
    );

    return {
      snapshot,
      skipped: false,
      gateDecision,
      qualityReport,
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
