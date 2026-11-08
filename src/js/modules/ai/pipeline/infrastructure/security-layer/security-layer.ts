/**
 * SecurityLayer (Задача 2.2.5): фасад модуля безопасности.
 *
 * Actions: sanitize-input, mask-secrets, check-access, audit-query,
 * security-report (агрегат; ошибки секций изолируются).
 */

import type {
  AccessDecision,
  AccessResourceKind,
  AuditEvent,
  AuditQuery,
  AuditSink,
  SanitizeOptions,
  SanitizeResult,
} from './types.js';
import { AccessPolicy } from './access-policy.js';
import { AuditLogger } from './audit-logger.js';
import { InputSanitizer } from './input-sanitizer.js';
import { SecretMasker } from './secret-masker.js';

export {
  AccessPolicy,
  ACCESS_POLICY_DEFAULTS,
  type AccessPolicyOptions,
} from './access-policy.js';
export {
  AuditLogger,
  AuditLoggerError,
  type AuditLoggerOptions,
} from './audit-logger.js';
export {
  InputSanitizer,
  InputSanitizerError,
  SANITIZER_DEFAULTS,
} from './input-sanitizer.js';
export {
  SECRET_PATTERNS,
  SENSITIVE_KEY_NAMES,
  SecretMasker,
  maskValue,
  type SecretPattern,
} from './secret-masker.js';
export type {
  AccessDecision,
  AccessResourceKind,
  AuditEvent,
  AuditEventKind,
  AuditQuery,
  AuditSink,
  MaskedSecret,
  SanitizeOptions,
  SanitizeResult,
} from './types.js';

export type SecurityAction =
  | 'sanitize-input'
  | 'mask-secrets'
  | 'check-access'
  | 'audit-query'
  | 'security-report';

export interface SecurityInput {
  action: SecurityAction;
  /** sanitize-input: входная строка. */
  input?: string;
  sanitizeOptions?: SanitizeOptions;
  /** mask-secrets: произвольное значение. */
  value?: unknown;
  /** check-access. */
  resource?: string;
  resourceKind?: AccessResourceKind;
  /** audit-query. */
  auditFilter?: AuditQuery;
}

export interface SecurityOutput {
  success: boolean;
  action: SecurityAction;
  data?: unknown;
  error?: string;
}

/** Агрегатный отчёт безопасности. */
export interface SecurityReport {
  sanitized?: SanitizeResult;
  accessDecisions?: AccessDecision[];
  audit?: AuditEvent[];
  warnings: string[];
}

export class SecurityLayer {
  private readonly sanitizer: InputSanitizer;
  private readonly masker: SecretMasker;
  private readonly policy: AccessPolicy;
  private readonly audit: AuditLogger | null;

  constructor(
    options: {
      sanitizer?: InputSanitizer;
      masker?: SecretMasker;
      policy?: AccessPolicy;
      auditLogger?: AuditLogger | null;
    } = {},
  ) {
    this.sanitizer = options.sanitizer ?? new InputSanitizer();
    this.masker = options.masker ?? new SecretMasker();
    this.policy = options.policy ?? new AccessPolicy();
    this.audit =
      options.auditLogger === undefined
        ? new AuditLogger({
            sink: new MemoryAuditSink(),
            now: () => new Date(),
          })
        : options.auditLogger;
  }

  sanitize(input: string, options?: SanitizeOptions): SanitizeResult {
    return this.sanitizer.sanitize(input, options);
  }

  maskSecrets(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.masker.mask(value);
    }
    return this.masker.maskObject(value);
  }

  /** Проверка доступа с записью в аудит (если аудит доступен). */
  async checkAccess(
    kind: AccessResourceKind,
    resource: string,
  ): Promise<AccessDecision> {
    const decision = this.policy.check(kind, resource);
    if (this.audit) {
      try {
        await this.audit.record(
          decision.allowed ? 'access_granted' : 'access_denied',
          decision.reason,
          decision.resource,
        );
      } catch {
        // Аудит не должен блокировать основную проверку; ошибка лога
        // проглатывается осознанно — политика важнее журнала.
      }
    }
    return decision;
  }

  async auditQuery(filter: AuditQuery = {}): Promise<AuditEvent[]> {
    if (!this.audit) {
      throw new Error('audit-query: аудит-журнал отключён (auditLogger=null)');
    }
    return this.audit.query(filter);
  }

  /** Диспетчер действий; никогда не бросает (honest output). */
  async execute(input: SecurityInput): Promise<SecurityOutput> {
    try {
      if (typeof input !== 'object' || input === null) {
        throw new Error('execute: input должен быть объектом');
      }
      switch (input.action) {
        case 'sanitize-input': {
          if (typeof input.input !== 'string') {
            throw new Error('sanitize-input требует input (строка)');
          }
          const data = this.sanitize(input.input, input.sanitizeOptions);
          if (this.audit && data.changes.length > 0) {
            try {
              await this.audit.record(
                'input_sanitized',
                data.changes.join('; '),
              );
            } catch {
              // см. checkAccess: аудит не блокирует
            }
          }
          return { success: true, action: input.action, data };
        }
        case 'mask-secrets': {
          if (input.value === undefined) {
            throw new Error('mask-secrets требует value');
          }
          const value = this.maskSecrets(input.value);
          const wasSecret =
            typeof input.value === 'string' &&
            this.masker.containsSecret(input.value);
          return {
            success: true,
            action: input.action,
            data: { value, wasSecret },
          };
        }
        case 'check-access': {
          if (
            typeof input.resource !== 'string' ||
            input.resourceKind === undefined
          ) {
            throw new Error('check-access требует resource и resourceKind');
          }
          const decision = await this.checkAccess(
            input.resourceKind,
            input.resource,
          );
          return { success: true, action: input.action, data: decision };
        }
        case 'audit-query': {
          const events = await this.auditQuery(input.auditFilter);
          return { success: true, action: input.action, data: events };
        }
        case 'security-report': {
          const report = await this.report(input.resource, input.resourceKind);
          return { success: true, action: input.action, data: report };
        }
        default: {
          return {
            success: false,
            action: (input as SecurityInput).action,
            error: `Неизвестный action: "${String((input as SecurityInput).action)}"`,
          };
        }
      }
    } catch (error) {
      return {
        success: false,
        action: input?.action ?? 'sanitize-input',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Агрегат: санитизация пробы, проверки стандартных ресурсов, хвост аудита. */
  private async report(
    resource?: string,
    resourceKind?: AccessResourceKind,
  ): Promise<SecurityReport> {
    const warnings: string[] = [];
    const report: SecurityReport = { warnings };

    const sample = resource ?? '';
    report.sanitized = this.sanitize(sample);

    report.accessDecisions = [];
    if (resource !== undefined && resourceKind !== undefined) {
      report.accessDecisions.push(
        await this.checkAccess(resourceKind, resource),
      );
    }

    if (this.audit) {
      try {
        report.audit = await this.audit.query({ limit: 20 });
      } catch (error) {
        warnings.push(
          `аудит недоступен: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      warnings.push('аудит отключён (auditLogger=null)');
    }

    return report;
  }
}

/** Простое in-memory Audit-хранилище (по умолчанию, для Node-среды). */
export class MemoryAuditSink implements AuditSink {
  private readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  async getAll(): Promise<AuditEvent[]> {
    return [...this.events];
  }

  async clear(): Promise<void> {
    this.events.length = 0;
  }
}
