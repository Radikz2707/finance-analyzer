/**
 * SecurityLayer (Задача 2.2): санитизация входа, маскирование секретов,
 * политика доступа, аудит-журнал.
 */

export {
  SecurityLayer,
  MemoryAuditSink,
  type SecurityAction,
  type SecurityInput,
  type SecurityOutput,
  type SecurityReport,
} from './security-layer.js';
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
