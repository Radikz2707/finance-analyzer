/**
 * Конфигурация DataOrchestrator.
 *
 * Все параметры разделены по осям:
 * - enabled: включает/выключает оркестратор целиком.
 *   При false — DataAgent идёт по старому пути, ноль изменений.
 * - defaultTimeoutMs: сколько ждать ответ от одного источника.
 * - cacheTtlMs: как долго результат считается свежим для потребителей
 *   внутри одного прогона пайплайна. НЕ привязан к таймауту —
 *   таймаут = "сколько ждать", TTL = "сколько данные валидны".
 * - mode: поведение при недостаточном качестве: 'stop' | 'degrade'.
 * - minQualityScore: порог qualityScore для individual актива (0-100).
 * - minSourcesOkRatio: минимальная доля ok-источников (0-1).
 *   При sourcesOk < этого → immediate stop без маппинга/валидации.
 *   Дефолт: 0.5.
 * - degradeSourcesOkRatio: порог degrade (0-1).
 *   При minSourcesOkRatio <= sourcesOk < degradeSourcesOkRatio →
 *   degrade + warning, но не stop.
 *   Дефолт: 0.7 (5/9=55.6% попадает в окно degrade 50%-70%).
 *   Если = minSourcesOkRatio — degrade отключён.
 * - poorAssetsRatio: доля активов с qualityScore < minQualityScore,
 *   при которой срабатывает гейт (0-1). ТОЛЬКО poorRatio — stop-триггер.
 *   averageQualityScore — только в лог и отчёт, решений не принимает.
 */

export interface OrchestratorConfig {
  /** Включить оркестратор (по умолчанию false — бит-в-бит прежнее поведение). */
  enabled: boolean;
  /** Таймаут ответа одного источника (мс). */
  defaultTimeoutMs: number;
  /** TTL кэша результата источника в реестре (мс). */
  cacheTtlMs: number;
  /** Режим при недостаточном качестве: 'stop' | 'degrade'. */
  mode: 'stop' | 'degrade';
  /** Порог qualityScore DataQualityValidator для individual актива (0-100). */
  minQualityScore: number;
  /** Минимальная доля ok-источников (0-1). При sourcesOk < этого → immediate stop. */
  minSourcesOkRatio: number;
  /**
   * Порог degrade (0-1). При minSourcesOkRatio <= sourcesOk < degradeSourcesOkRatio
   * → degrade + warning, но не stop. По умолчанию = minSourcesOkRatio (degrade отключён).
   */
  degradeSourcesOkRatio?: number;
  /**
   * Доля активов с qualityScore < minQualityScore, при которой срабатывает гейт (0-1).
   * ТОЛЬКО poorRatio — stop-триггер. averageQualityScore — только в лог.
   */
  poorAssetsRatio: number;
}

/** Значения по умолчанию. */
export const defaultOrchestratorConfig: OrchestratorConfig = {
  enabled: false,
  defaultTimeoutMs: 15_000,
  cacheTtlMs: 60_000,
  mode: 'stop',
  minQualityScore: 50,
  minSourcesOkRatio: 0.5,
  degradeSourcesOkRatio: 0.7,
  poorAssetsRatio: 0.5,
};
