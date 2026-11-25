/**
 * Типы результатов источников данных DataOrchestrator.
 *
 * Каждый источник возвращает либо данные, либо честный статус недоступности.
 * Никаких выдуманных данных при сбое — honest-output.
 */

// ──────────────────────────────────────────────
// 1. Статус источника
// ──────────────────────────────────────────────

/** Статус одного источника данных. */
export type SourceStatus = 'ok' | 'unavailable';

// ──────────────────────────────────────────────
// 2. Результат одного источника
// ──────────────────────────────────────────────

/**
 * Результат одного источника данных.
 *
 * При status='ok' — поле data содержит реальные данные.
 * При status='unavailable' — data отсутствует, reason содержит причину.
 */
export interface SourceResult<T = unknown> {
  /** Уникальный идентификатор источника (например 'moex-iss-fundamentals'). */
  id: string;
  /** Статус: ok или unavailable. */
  status: SourceStatus;
  /** Реальные данные при ok; отсутствует при unavailable. */
  data?: T;
  /** Причина недоступности: 'timeout', 'HTTP 500', 'endpoint deleted', 'python unavailable' и т.д. */
  reason?: string;
  /** Время выполнения в миллисекундах. */
  durationMs?: number;
}

// ──────────────────────────────────────────────
// 3. Снапшот пайплайна
// ──────────────────────────────────────────────

/**
 * Снапшот всех источников после одного прогона оркестратора.
 *
 * buildSnapshot — собирает только ok-данные.
 * buildFallbackSnapshot — для каждого несостоявшегося источника ставит метку unavailable.
 */
export interface PipelineSnapshot {
  /** Дата/время снапшота (ISO). */
  asOf: string;
  /** Результаты всех источников. */
  sources: SourceResult[];
  /** Только ok-данные (для передачи в DataQualityValidator). */
  okData: Map<string, unknown>;
  /** Только unavailable-источники. */
  unavailableSources: Array<{ id: string; reason?: string; durationMs?: number }>;
}

// ──────────────────────────────────────────────
// 4. Результат прогона оркестратора
// ──────────────────────────────────────────────

/** Результат одного прогона DataOrchestrator. */
export interface OrchestratorRunResult {
  /** Снапшот всех источников. */
  snapshot: PipelineSnapshot;
  /** Пропущен ли оркестратор (enabled=false). */
  skipped: boolean;
  /** Общее время прогона в мс. */
  totalDurationMs?: number;
}
