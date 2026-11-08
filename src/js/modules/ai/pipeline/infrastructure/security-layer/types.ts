/**
 * Типы SecurityLayer (Задача 2.2): санитизация входа, маскирование
 * секретов, политика доступа, аудит-журнал.
 *
 * Принципы: DI-источники, честные ошибки, без «тихих» пропусков.
 */

// ─── Санитизация входа ────────────────────────────────────────────────────

export interface SanitizeOptions {
  /** Максимальная длина результата (по умолчанию 10_000). */
  maxLength?: number;
  /** Удалять управляющие символы (кроме \n, \t). */
  stripControlChars?: boolean;
  /** Экранировать HTML-сущности (& < > " '). */
  escapeHtml?: boolean;
}

export interface SanitizeResult {
  /** Очищенная строка. */
  value: string;
  /** Что было изменено (прозрачность). */
  changes: string[];
  /** true, если вход был полностью пустым после очистки. */
  empty: boolean;
}

// ─── Маскирование секретов ────────────────────────────────────────────────

export interface MaskedSecret {
  /** Замаскированное значение. */
  masked: string;
  /** true, если значение распознано как секрет и замаскировано. */
  wasSecret: boolean;
}

// ─── Политика доступа ─────────────────────────────────────────────────────

export type AccessResourceKind = 'url' | 'path' | 'command';

export interface AccessDecision {
  allowed: boolean;
  resource: string;
  kind: AccessResourceKind;
  /** Причина решения (прозрачность, без секретов). */
  reason: string;
}

// ─── Аудит ────────────────────────────────────────────────────────────────

export type AuditEventKind =
  | 'access_granted'
  | 'access_denied'
  | 'secret_detected'
  | 'input_sanitized'
  | 'policy_updated';

export interface AuditEvent {
  ts: string;
  kind: AuditEventKind;
  /** Короткое описание (уже без секретов — маскируется при записи). */
  detail: string;
  resource?: string;
}

/** Фильтр чтения журнала аудита. */
export interface AuditQuery {
  kind?: AuditEventKind;
  since?: string;
  until?: string;
  limit?: number;
}

/** DI-источник хранения событий аудита. */
export interface AuditSink {
  append(event: AuditEvent): Promise<void>;
  getAll(): Promise<AuditEvent[]>;
  clear(): Promise<void>;
}
