/**
 * AccessPolicy (Задача 2.2.3): whitelist-политика доступа.
 *
 * - URL: только http/https + whitelist доменов (точное совпадение хоста
 *   или поддомен, если домен начинается с точки).
 * - Путь: защита от traversal (..), только внутри разрешённого корня,
 *   разрешённые расширения.
 * - Команды: whitelist исполняемых программ + запрет опасных паттернов.
 *
 * Все проверки — чистые функции, без побочных эффектов.
 */

import type { AccessDecision, AccessResourceKind } from './types.js';

export const ACCESS_POLICY_DEFAULTS = {
  allowedDomains: [] as readonly string[],
  allowedRoot: '',
  allowedExtensions: ['.json', '.csv', '.xlsx', '.txt', '.md', '.log'],
  allowedPrograms: ['node', 'npm', 'npx', 'git', 'python'],
  forbiddenPatterns: [
    'rm -rf',
    'del /f',
    'format ',
    'mkfs',
    'dd if=',
    'shutdown',
    'reg delete',
    'rmdir /s',
  ],
} as const;

export interface AccessPolicyOptions {
  /** Домены, разрешённые для HTTP-запросов (например ['api.moex.com']). */
  allowedDomains?: readonly string[];
  /** Корневой каталог, внутри которого разрешена работа с файлами. */
  allowedRoot?: string;
  /** Разрешённые расширения файлов. */
  allowedExtensions?: readonly string[];
  /** Разрешённые программы для команд. */
  allowedPrograms?: readonly string[];
  /** Запрещённые подстроки в командах. */
  forbiddenPatterns?: readonly string[];
  /** Часы (для решений/логов; детерминизм тестов). */
  now?: () => Date;
}

export class AccessPolicy {
  private readonly allowedDomains: readonly string[];
  private readonly allowedRoot: string;
  private readonly allowedExtensions: readonly string[];
  private readonly allowedPrograms: readonly string[];
  private readonly forbiddenPatterns: readonly string[];
  private readonly now: () => Date;

  constructor(options: AccessPolicyOptions = {}) {
    this.allowedDomains =
      options.allowedDomains ?? ACCESS_POLICY_DEFAULTS.allowedDomains;
    this.allowedRoot = (
      options.allowedRoot ?? ACCESS_POLICY_DEFAULTS.allowedRoot
    ).replace(/[\\/]+$/, '');
    this.allowedExtensions =
      options.allowedExtensions ?? ACCESS_POLICY_DEFAULTS.allowedExtensions;
    this.allowedPrograms =
      options.allowedPrograms ?? ACCESS_POLICY_DEFAULTS.allowedPrograms;
    this.forbiddenPatterns =
      options.forbiddenPatterns ?? ACCESS_POLICY_DEFAULTS.forbiddenPatterns;
    this.now = options.now ?? (() => new Date());
  }

  /** Проверка URL против whitelist доменов. */
  checkUrl(url: string): AccessDecision {
    const deny = (reason: string): AccessDecision => ({
      allowed: false,
      resource: url,
      kind: 'url',
      reason,
    });
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return deny('невалидный URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return deny(
        `протокол ${parsed.protocol} не разрешён (только http/https)`,
      );
    }
    if (this.allowedDomains.length === 0) {
      return deny('whitelist доменов пуст — внешние запросы запрещены');
    }
    const host = parsed.host.toLowerCase();
    const matched = this.allowedDomains.some((domain) => {
      const d = domain.toLowerCase();
      return host === d || host.endsWith(`.${d}`) || host.endsWith(d);
    });
    return matched
      ? {
          allowed: true,
          resource: url,
          kind: 'url',
          reason: `домен ${parsed.host} в whitelist`,
        }
      : deny(`домен ${parsed.host} не в whitelist`);
  }

  /** Проверка пути файла: только внутри allowedRoot, без traversal. */
  checkPath(path: string): AccessDecision {
    const deny = (reason: string): AccessDecision => ({
      allowed: false,
      resource: path,
      kind: 'path',
      reason,
    });
    if (typeof path !== 'string' || path.trim() === '') {
      return deny('путь пуст');
    }
    if (path.includes('..') || path.includes('\u0000')) {
      return deny('путь содержит traversal (..) или null-байт');
    }
    const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
    if (!this.allowedExtensions.includes(extension)) {
      return deny(`расширение ${extension} не в whitelist`);
    }
    if (this.allowedRoot !== '') {
      const normalized = path.replace(/[\\/]+/g, '/');
      const root = this.allowedRoot.replace(/[\\/]+/g, '/');
      if (!normalized.startsWith(`${root}/`) && normalized !== root) {
        return deny(`путь вне разрешённого корня ${this.allowedRoot}`);
      }
    }
    return {
      allowed: true,
      resource: path,
      kind: 'path',
      reason: 'путь в whitelist',
    };
  }

  /** Проверка команды: программа в whitelist, опасных паттернов нет. */
  checkCommand(command: string): AccessDecision {
    const deny = (reason: string): AccessDecision => ({
      allowed: false,
      resource: command,
      kind: 'command',
      reason,
    });
    const trimmed = command.trim();
    if (trimmed === '') return deny('команда пуста');
    for (const pattern of this.forbiddenPatterns) {
      if (trimmed.toLowerCase().includes(pattern.toLowerCase())) {
        return deny(`команда содержит запрещённый паттерн "${pattern}"`);
      }
    }
    const program = trimmed
      .split(/\s+/)[0]!
      .split(/[\\/]/)
      .pop()!
      .toLowerCase();
    if (!this.allowedPrograms.includes(program)) {
      return deny(`программа "${program}" не в whitelist`);
    }
    return {
      allowed: true,
      resource: command,
      kind: 'command',
      reason: `программа "${program}" в whitelist, опасных паттернов нет`,
    };
  }

  /** Универсальная проверка по типу ресурса. */
  check(kind: AccessResourceKind, resource: string): AccessDecision {
    switch (kind) {
      case 'url':
        return this.checkUrl(resource);
      case 'path':
        return this.checkPath(resource);
      case 'command':
        return this.checkCommand(resource);
      default: {
        return {
          allowed: false,
          resource,
          kind,
          reason: `неизвестный тип ресурса "${String(kind)}"`,
        };
      }
    }
  }

  /** Текущее время (для аудит-событий). */
  timestamp(): string {
    return this.now().toISOString();
  }
}
