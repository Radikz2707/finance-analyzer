/**
 * SecretMasker (Задача 2.2.2): распознавание и маскирование секретов.
 *
 * - Паттерны: bearer-токены, API-ключи (sk-, ghp_, xoxb-, AIza...), JWT,
 *   Telegram-токены, «ключ=значение» для типовых секретных полей.
 * - Маска показывает только первые/последние 4 символа.
 * - maskObject рекурсивно маскирует значения по чувствительным именам ключей.
 */

import type { MaskedSecret } from './types.js';

export interface SecretPattern {
  name: string;
  regex: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  // Первая группа — префикс 'Bearer ' (сохраняется при маскировании)
  { name: 'bearer', regex: /(Bearer\s+)([A-Za-z0-9\-._~+/]+=*)/gi },
  { name: 'openai', regex: /\bsk-[A-Za-z0-9]{16,}\b/g },
  { name: 'github', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'slack', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'google', regex: /\bAIza[0-9A-Za-z\-_]{30,}\b/g },
  { name: 'telegram', regex: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g },
  {
    name: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
  },
] as const;

/** Имена ключей, значения которых считаются секретами. */
export const SENSITIVE_KEY_NAMES: readonly string[] = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'privatekey',
  'private_key',
  'accesskey',
  'access_key',
  'refreshtoken',
  'refresh_token',
  'sessionid',
  'session_id',
  'cookie',
] as const;

/** Замаскировать одиночное значение. */
export function maskValue(value: string, visible = 4): MaskedSecret {
  if (value.length <= visible * 2) {
    return { masked: '***', wasSecret: true };
  }
  return {
    masked: `${value.slice(0, visible)}…${value.slice(-visible)}`,
    wasSecret: true,
  };
}

export class SecretMasker {
  private readonly patterns: readonly SecretPattern[];

  constructor(patterns: readonly SecretPattern[] = SECRET_PATTERNS) {
    this.patterns = patterns;
  }

  /** Маскирует все найденные секреты в строке. */
  mask(text: string): string {
    let result = text;
    for (const pattern of this.patterns) {
      result = result.replace(
        pattern.regex,
        (match: string, ...groups: string[]) => {
          // Если первая capture-группа задана (например 'Bearer '), она —
          // префикс, который сохраняется открытым; маскируется только секрет.
          const prefix = groups[0];
          if (prefix !== undefined && match.startsWith(prefix)) {
            return prefix + maskValue(match.slice(prefix.length)).masked;
          }
          return maskValue(match).masked;
        },
      );
    }
    return result;
  }

  /** Проверяет, содержит ли строка секрет. */
  containsSecret(text: string): boolean {
    return this.patterns.some((pattern) => pattern.regex.test(text));
  }

  /**
   * Рекурсивно маскирует значения объектов по имени ключа (регистронезависимо)
   * и по паттернам в строках. Возвращает новую структуру (без мутаций).
   */
  maskObject<T>(input: T): T {
    return this.walk(input, '') as T;
  }

  private walk(value: unknown, key: string): unknown {
    if (typeof value === 'string') {
      const isSensitiveKey = SENSITIVE_KEY_NAMES.some((name) =>
        key.toLowerCase().includes(name),
      );
      if (isSensitiveKey) return maskValue(value).masked;
      return this.mask(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.walk(item, key));
    }
    if (typeof value === 'object' && value !== null) {
      const copy: Record<string, unknown> = {};
      for (const [entryKey, entryValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        copy[entryKey] = this.walk(entryValue, entryKey);
      }
      return copy;
    }
    return value;
  }
}
