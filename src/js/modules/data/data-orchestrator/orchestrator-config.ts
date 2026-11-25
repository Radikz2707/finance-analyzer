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
 * - mode: поведение при недостаточном качестве данных.
 *   'stop' — прерывание с отчётом; 'degrade' — продолжение с метками.
 * - minQualityScore: порог для DataQualityValidator (0-100).
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
  /** Порог qualityScore DataQualityValidator (0-100). */
  minQualityScore: number;
}

/** Значения по умолчанию. */
export const defaultOrchestratorConfig: OrchestratorConfig = {
  enabled: false,
  defaultTimeoutMs: 15_000,
  cacheTtlMs: 60_000,
  mode: 'stop',
  minQualityScore: 50,
};
