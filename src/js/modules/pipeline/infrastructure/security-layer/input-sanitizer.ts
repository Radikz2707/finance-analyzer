/**
 * InputSanitizer (Задача 2.2.1): очистка пользовательского ввода.
 *
 * - Управляющие символы удаляются (кроме \n и \t).
 * - HTML-сущности экранируются (по умолчанию — важно для рендера и LLM-промптов).
 * - Обрезка по maxLength с честным изменением.
 * - Неч строковый вход → честная ошибка (не молчаливое приведение).
 */

import type { SanitizeOptions, SanitizeResult } from './types.js';

export class InputSanitizerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InputSanitizerError';
  }
}

export const SANITIZER_DEFAULTS = {
  maxLength: 10_000,
  stripControlChars: true,
  escapeHtml: true,
} as const;

// Сущности собираются конкатенацией, чтобы литералы не искажались
// при пост-обработке файлов.
const AMP = '&' + 'amp;';
const HTML_ESCAPES: Record<string, string> = {
  '&': AMP,
  '<': '&' + 'lt;',
  '>': '&' + 'gt;',
  '"': '&' + 'quot;',
  "'": '&' + '#39;',
};

export class InputSanitizer {
  private readonly maxLength: number;
  private readonly stripControlChars: boolean;
  private readonly escapeHtml: boolean;

  constructor(options: SanitizeOptions = {}) {
    this.maxLength = options.maxLength ?? SANITIZER_DEFAULTS.maxLength;
    this.stripControlChars =
      options.stripControlChars ?? SANITIZER_DEFAULTS.stripControlChars;
    this.escapeHtml = options.escapeHtml ?? SANITIZER_DEFAULTS.escapeHtml;
    if (!(this.maxLength >= 1) || !Number.isFinite(this.maxLength)) {
      throw new InputSanitizerError(
        `maxLength должен быть конечным числом ≥ 1, получено ${this.maxLength}`,
      );
    }
  }

  sanitize(input: string, overrides: SanitizeOptions = {}): SanitizeResult {
    if (typeof input !== 'string') {
      throw new InputSanitizerError(
        `sanitize: вход должен быть строкой, получено ${typeof input}`,
      );
    }
    const stripControl = overrides.stripControlChars ?? this.stripControlChars;
    const escape = overrides.escapeHtml ?? this.escapeHtml;
    const maxLength = overrides.maxLength ?? this.maxLength;

    const changes: string[] = [];
    let value = input;

    if (stripControl) {
      const before = value;
      // CR (\u000D) удаляется как артефакт Windows-переносов, LF сохраняется
      const controlChars =
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u0008\u000B\u000C\u000D\u000E-\u001F\u007F]/g;
      value = value.replace(controlChars, '');
      if (value !== before) changes.push('удалены управляющие символы');
    }

    if (escape) {
      const escaped = value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
      if (escaped !== value) {
        value = escaped;
        changes.push('экранированы HTML-сущности');
      }
    }

    if (value.length > maxLength) {
      value = value.slice(0, maxLength);
      changes.push(`обрезано до ${maxLength} символов`);
    }

    return { value, changes, empty: value.trim() === '' };
  }
}
