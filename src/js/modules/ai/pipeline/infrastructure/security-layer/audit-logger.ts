/**
 * AuditLogger (Задача 2.2.4): журнал событий безопасности.
 *
 * - Запись идёт через DI-источник AuditSink (персистентность инжектируется).
 * - detail маскируется SecretMasker перед записью — секреты не попадают в журнал.
 * - Чтение с фильтрами (kind, since/until, limit).
 */

import type {
  AuditEvent,
  AuditEventKind,
  AuditQuery,
  AuditSink,
} from './types.js';
import { SecretMasker } from './secret-masker.js';

export type { AuditQuery };

export class AuditLoggerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuditLoggerError';
  }
}

export interface AuditLoggerOptions {
  sink: AuditSink;
  now?: () => Date;
  masker?: SecretMasker;
}

export class AuditLogger {
  private readonly sink: AuditSink;
  private readonly now: () => Date;
  private readonly masker: SecretMasker;

  constructor(options: AuditLoggerOptions) {
    if (!options.sink || typeof options.sink.append !== 'function') {
      throw new AuditLoggerError(
        'AuditLogger требует sink с методами append/getAll/clear',
      );
    }
    this.sink = options.sink;
    this.now = options.now ?? (() => new Date());
    this.masker = options.masker ?? new SecretMasker();
  }

  /** Записывает событие (detail маскируется). Падение sink → честная ошибка. */
  async record(
    kind: AuditEventKind,
    detail: string,
    resource?: string,
  ): Promise<AuditEvent> {
    const event: AuditEvent = {
      ts: this.now().toISOString(),
      kind,
      detail: this.masker.mask(detail),
      resource: resource === undefined ? undefined : this.masker.mask(resource),
    };
    try {
      await this.sink.append(event);
    } catch (cause) {
      throw new AuditLoggerError(
        `record: не удалось записать событие аудита (причина: ${
          cause instanceof Error ? cause.message : String(cause)
        })`,
        { cause: cause instanceof Error ? cause : new Error(String(cause)) },
      );
    }
    return event;
  }

  /** Чтение журнала с фильтрами. Ошибка sink → честная ошибка. */
  async query(filter: AuditQuery = {}): Promise<AuditEvent[]> {
    let events: AuditEvent[];
    try {
      events = await this.sink.getAll();
    } catch (cause) {
      throw new AuditLoggerError(
        `query: не удалось прочитать журнал (причина: ${
          cause instanceof Error ? cause.message : String(cause)
        })`,
        { cause: cause instanceof Error ? cause : new Error(String(cause)) },
      );
    }
    let result = events;
    if (filter.kind !== undefined) {
      result = result.filter((event) => event.kind === filter.kind);
    }
    if (filter.since !== undefined) {
      const since = Date.parse(filter.since);
      result = result.filter((event) => Date.parse(event.ts) >= since);
    }
    if (filter.until !== undefined) {
      const until = Date.parse(filter.until);
      result = result.filter((event) => Date.parse(event.ts) <= until);
    }
    if (filter.limit !== undefined && filter.limit >= 0) {
      result = result.slice(-filter.limit);
    }
    return result;
  }

  /** Очистка журнала (для reset). */
  async clear(): Promise<void> {
    try {
      await this.sink.clear();
    } catch (cause) {
      throw new AuditLoggerError(
        `clear: не удалось очистить журнал (причина: ${
          cause instanceof Error ? cause.message : String(cause)
        })`,
        { cause: cause instanceof Error ? cause : new Error(String(cause)) },
      );
    }
  }
}
