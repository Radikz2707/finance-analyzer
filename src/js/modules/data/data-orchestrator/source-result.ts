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
// 4. Решение гейта
// ──────────────────────────────────────────────

/** Решение гейта оркестратора: pass / degrade / stop. */
export type GateDecision = 'pass' | 'degrade' | 'stop';

// ──────────────────────────────────────────────
// 5. Причина пропуска оркестратора
// ──────────────────────────────────────────────

/** Причина пропуска оркестратора. */
export type OrchestratorSkipReason = 'flag-off' | 'empty-registry';

// ──────────────────────────────────────────────
// 6. Результат прогона оркестратора
// ──────────────────────────────────────────────

/**
 * Результат одного прогона DataOrchestrator.
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
export interface OrchestratorRunResult {
  /** Снапшот всех источников. */
  snapshot: PipelineSnapshot;
  /** Пропущен ли оркестратор (enabled=false или empty-registry). */
  skipped: boolean;
  /** Причина пропуска: 'flag-off' (enabled=false) | 'empty-registry' (нет источников). */
  skipReason?: OrchestratorSkipReason;
  /** Решение гейта: pass / degrade / stop. undefined только при skipped=true. */
  gateDecision?: GateDecision;
  /** Результат валидации качества (при skipped=false и успешном маппинге). */
  qualityReport?: import('../data-quality/validation.js').DataQualityReport;
  /** Общее время прогона в мс. */
  totalDurationMs?: number;
}
