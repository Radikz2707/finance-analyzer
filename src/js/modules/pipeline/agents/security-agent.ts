/**
 * SecurityAgent — агент валидации и защиты действий ИИ.
 *
 * Роль: вспомогательный агент-контролёр (НЕ участник консилиума). Проверяет
 * «заявку на действие» (file / terminal / http / process) ДО её выполнения
 * FileAgent'ом / TerminalAgent'ом / сетевым клиентом и возвращает вердикт:
 * `allow` | `deny` | `require-confirmation` (human-in-the-loop).
 *
 * Слои защиты (SecurityAgent — надстройка, не дублирует существующие модули):
 * - guardrails — защита инвестиционных рекомендаций (RECOVERY_ONLY/SELL_LIMIT),
 *   работает выше, на уровне решений директора;
 * - gatekeeper — входной фильтр новостей; доверенные источники данных
 *   (MOEX / CBR / Finam) задают белый список HTTP-хостов агента;
 * - FileAgent — валидация путей переиспользуется напрямую через `isInside`;
 * - TerminalAgent — whitelist команд и blacklist опасных паттернов/инъекций
 *   переиспользуются напрямую (единый источник истины).
 *
 * Правила:
 * 1. Пути — только внутри разрешённых корней (выход за корень → deny).
 * 2. Команды — whitelist + чёрный список паттернов (rm -rf, sudo, del, format,
 *    редиректы в системные пути) + запрет символов инъекций ; | & ` $().
 * 3. Опасные действия (удаление, системные пути, .env, .git, node_modules)
 *    → require-confirmation с уровнем опасности и описанием.
 * 4. HTTP — только https и только разрешённые хосты (moex.com, cbr.ru,
 *    finam.ru и т.п.).
 * 5. Процессы — после проверки blacklist/инъекций всегда require-confirmation
 *    (высокий уровень опасности).
 *
 * Все вердикты пишутся в собственную историю (`getDecisions()`) и, при наличии
 * аудит-лога, в `AuditLog` как события `security.decision`.
 */

import * as path from 'path';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import type { AuditLog } from '../audit/audit-log.js';
import { isInside } from './file-agent.js';
import {
  TERMINAL_ALLOWED_COMMANDS,
  TERMINAL_DENY_PATTERNS,
  TERMINAL_INJECTION_CHARS,
} from './terminal-agent.js';

// ──────────────────────────────────────────────
// 1. Типы SecurityAgent
// ──────────────────────────────────────────────

/** Тип операции, которую требуется проверить */
export type SecurityActionKind = 'file' | 'terminal' | 'http' | 'process';

/** Заявка на действие (то, что агент собирается выполнить) */
export interface SecurityActionRequest {
  /** Тип операции */
  kind: SecurityActionKind;
  /** Команда (для terminal / process) */
  command?: string;
  /** Аргументы команды (каждый элемент — один аргумент) */
  args?: string[];
  /** Путь (для file) */
  path?: string;
  /** URL (для http) */
  url?: string;
  /** Тип файловой операции (для kind='file'): read/write/delete/rename/list/search */
  action?: string;
  /** Человекочитаемое описание действия (для аудита) */
  description?: string;
}

/** Вердикт по заявке */
export type SecurityVerdict = 'allow' | 'deny' | 'require-confirmation';

/** Уровень опасности для require-confirmation */
export type DangerLevel = 'low' | 'medium' | 'high';

/** Решение SecurityAgent по заявке */
export interface SecurityDecision {
  /** Уникальный ID решения */
  id: string;
  /** Метка времени */
  timestamp: string;
  /** Исходная заявка */
  request: SecurityActionRequest;
  /** Вердикт */
  verdict: SecurityVerdict;
  /** Причина (для deny) */
  reason?: string;
  /** Уровень опасности (для require-confirmation) */
  dangerLevel?: DangerLevel;
  /** Описание риска (для require-confirmation) */
  description?: string;
  /** Сработавшие правила (для аудита и отладки) */
  matchedRules: string[];
}

/** Опции конфигурации SecurityAgent */
export interface SecurityAgentOptions {
  /** Разрешённые корни файловых операций (по умолчанию — process.cwd()) */
  roots?: string[];
  /** Белый список доменов для http (по умолчанию: moex.com, cbr.ru, finam.ru, investing.com) */
  allowedHttpHosts?: string[];
  /** Только https для http-операций (по умолчанию true) */
  httpsOnly?: boolean;
  /** Принудительный whitelist команд для terminal (по умолчанию true) */
  enforceCommandWhitelist?: boolean;
  /** Расширение whitelist команд terminal */
  allowedCommands?: string[];
  /** Дополнительные чёрные regex-паттерны (регистронезависимые) */
  denyPatterns?: string[];
  /** Аудит-лог для записи всех вердиктов */
  auditLog?: AuditLog;
  /** Максимум записей в собственной истории (по умолчанию 200) */
  maxHistory?: number;
}

// ──────────────────────────────────────────────
// 2. Константы безопасности
// ──────────────────────────────────────────────

/** Максимум записей в истории решений */
const DEFAULT_MAX_HISTORY = 200;

/** Whitelist HTTP-хостов по умолчанию (финансовые источники данных) */
const DEFAULT_HTTP_HOSTS: readonly string[] = [
  'moex.com',
  'cbr.ru',
  'finam.ru',
  'investing.com',
];

/** Сегменты путей, доступ к которым требует подтверждения (высокий риск) */
const SENSITIVE_SEGMENTS_HIGH: ReadonlySet<string> = new Set(['.env', '.git']);

/** Сегменты путей, доступ к которым требует подтверждения (средний риск) */
const SENSITIVE_SEGMENTS_MEDIUM: ReadonlySet<string> = new Set([
  'node_modules',
]);

// ──────────────────────────────────────────────
// 3. SecurityAgent
// ──────────────────────────────────────────────

/**
 * SecurityAgent — валидация операций ИИ перед выполнением.
 */
export class SecurityAgent extends AgentBase {
  private readonly roots: string[];
  private readonly systemRoots: string[];
  private readonly allowedHttpHosts: string[];
  private readonly httpsOnly: boolean;
  private readonly enforceCommandWhitelist: boolean;
  private readonly allowedCommands: ReadonlySet<string>;
  private readonly denyPatterns: RegExp[];
  private readonly auditLog?: AuditLog;
  private readonly maxHistory: number;
  private readonly history: SecurityDecision[] = [];

  constructor(config?: AgentConfig, options?: SecurityAgentOptions) {
    super(config ?? { name: 'SecurityAgent' });
    const roots = options?.roots?.length ? options.roots : [process.cwd()];
    this.roots = roots.map((root) => path.resolve(root));
    this.systemRoots = buildSystemRoots();
    this.allowedHttpHosts = options?.allowedHttpHosts?.length
      ? options.allowedHttpHosts
      : [...DEFAULT_HTTP_HOSTS];
    this.httpsOnly = options?.httpsOnly ?? true;
    this.enforceCommandWhitelist = options?.enforceCommandWhitelist ?? true;
    this.allowedCommands = new Set([
      ...TERMINAL_ALLOWED_COMMANDS,
      ...(options?.allowedCommands ?? []),
    ]);
    this.denyPatterns = [
      ...TERMINAL_DENY_PATTERNS,
      ...(options?.denyPatterns ?? []).map(
        (pattern) => new RegExp(pattern, 'i'),
      ),
    ];
    this.auditLog = options?.auditLog;
    this.maxHistory =
      options?.maxHistory && options.maxHistory > 0
        ? options.maxHistory
        : DEFAULT_MAX_HISTORY;
  }

  protected async executeInternal(input: unknown): Promise<SecurityDecision> {
    return this.validate(input as SecurityActionRequest);
  }

  /**
   * Проверить заявку на действие и получить вердикт.
   * Каждое решение записывается в историю и (при наличии) в AuditLog.
   */
  validate(request: SecurityActionRequest): SecurityDecision {
    if (!request || typeof request !== 'object') {
      throw new Error('SecurityAgent: заявка на действие отсутствует');
    }
    const kind = request.kind;
    if (
      kind !== 'file' &&
      kind !== 'terminal' &&
      kind !== 'http' &&
      kind !== 'process'
    ) {
      throw new Error(
        `SecurityAgent: неизвестный тип операции: ${String(kind)}`,
      );
    }
    const decision = this.evaluate(request);
    this.record(decision);
    return decision;
  }

  /** История решений (последние maxHistory записей) */
  getDecisions(): readonly SecurityDecision[] {
    return [...this.history];
  }

  // ── Валидация по типам операций ──

  private evaluate(request: SecurityActionRequest): SecurityDecision {
    switch (request.kind) {
      case 'file':
        return this.evaluateFile(request);
      case 'terminal':
        return this.evaluateTerminal(request);
      case 'http':
        return this.evaluateHttp(request);
      case 'process':
        return this.evaluateProcess(request);
      default: {
        const exhaustive: never = request.kind;
        throw new Error(
          `SecurityAgent: неизвестный тип операции: ${String(exhaustive)}`,
        );
      }
    }
  }

  private evaluateFile(request: SecurityActionRequest): SecurityDecision {
    const resolved = this.resolveTarget(request.path ?? '');
    if (!resolved.ok) {
      return this.decide(request, 'deny', ['path.outside-root'], {
        reason: resolved.error,
      });
    }
    const abs = resolved.abs;

    const action = request.action?.toLowerCase() ?? '';
    const commandHint = request.command ?? '';
    const isDelete =
      action === 'delete' ||
      action === 'remove' ||
      /\b(?:rm|del)\b/i.test(commandHint);

    // Удаление самого корня запрещено (зеркалит FileAgent)
    if (isDelete && this.roots.some((root) => path.resolve(root) === abs)) {
      return this.decide(request, 'deny', ['file.delete-root'], {
        reason: 'Запрещено удалять корень агента',
      });
    }

    const sensitivity = this.assessPath(abs);

    if (sensitivity.system) {
      return this.decide(request, 'require-confirmation', ['path.system'], {
        dangerLevel: 'high',
        description: `Изменение системного пути: ${abs}`,
      });
    }
    if (sensitivity.sensitiveHigh) {
      return this.decide(request, 'require-confirmation', ['path.sensitive'], {
        dangerLevel: 'high',
        description: `Доступ к чувствительному пути: ${abs}`,
      });
    }
    if (sensitivity.sensitiveMedium) {
      return this.decide(request, 'require-confirmation', ['path.sensitive'], {
        dangerLevel: 'medium',
        description: `Доступ к служебному пути: ${abs}`,
      });
    }
    if (isDelete) {
      return this.decide(request, 'require-confirmation', ['file.delete'], {
        dangerLevel: 'medium',
        description: `Удаление: ${abs}`,
      });
    }

    return this.decide(request, 'allow', ['path.allowed']);
  }

  private evaluateTerminal(request: SecurityActionRequest): SecurityDecision {
    const normalized = this.normalizeCommand(request);
    if (normalized.command === '') {
      return this.decide(request, 'deny', ['command.missing'], {
        reason: 'Команда не указана',
      });
    }
    const bin = path.basename(normalized.command).toLowerCase();

    // 1. Whitelist команд
    if (this.enforceCommandWhitelist && !this.allowedCommands.has(bin)) {
      return this.decide(request, 'deny', ['command.whitelist'], {
        reason: `Команда не входит в whitelist: ${normalized.command}`,
      });
    }

    const commandLine = [normalized.command, ...normalized.args].join(' ');

    // 2. Чёрный список опасных паттернов
    for (const pattern of this.denyPatterns) {
      if (pattern.test(commandLine)) {
        return this.decide(request, 'deny', ['command.deny-pattern'], {
          reason: `Команда заблокирована чёрным списком (${pattern}): ${commandLine}`,
        });
      }
    }

    // 3. Символы инъекций
    for (const part of [normalized.command, ...normalized.args]) {
      if (part.includes('\0') || TERMINAL_INJECTION_CHARS.test(part)) {
        return this.decide(request, 'deny', ['command.injection'], {
          reason: `Запрещённые символы инъекции: ${commandLine}`,
        });
      }
    }

    // 4. Путевые аргументы: корень, системные и чувствительные пути
    const cwd = this.roots[0] ?? process.cwd();
    for (const arg of normalized.args) {
      if (!looksLikePath(arg)) continue;
      const resolved = resolveArgPath(cwd, arg);
      if (!resolved) continue;
      if (!this.roots.some((root) => isInside(root, resolved))) {
        return this.decide(request, 'deny', ['path.outside-root'], {
          reason: `Аргумент-путь вне разрешённых корней: ${arg}`,
        });
      }
      const sensitivity = this.assessPath(resolved);
      if (sensitivity.system) {
        return this.decide(request, 'require-confirmation', ['path.system'], {
          dangerLevel: 'high',
          description: `Команда затрагивает системный путь: ${resolved}`,
        });
      }
      if (sensitivity.sensitiveHigh) {
        return this.decide(
          request,
          'require-confirmation',
          ['path.sensitive'],
          {
            dangerLevel: 'high',
            description: `Команда затрагивает чувствительный путь: ${resolved}`,
          },
        );
      }
      if (sensitivity.sensitiveMedium) {
        return this.decide(
          request,
          'require-confirmation',
          ['path.sensitive'],
          {
            dangerLevel: 'medium',
            description: `Команда затрагивает служебный путь: ${resolved}`,
          },
        );
      }
    }

    return this.decide(request, 'allow', ['command.allowed']);
  }

  private evaluateHttp(request: SecurityActionRequest): SecurityDecision {
    const urlRaw = (request.url ?? '').trim();
    if (urlRaw === '') {
      return this.decide(request, 'deny', ['http.missing-url'], {
        reason: 'URL не указан',
      });
    }

    let parsed: URL;
    try {
      parsed = new URL(urlRaw);
    } catch {
      return this.decide(request, 'deny', ['http.invalid-url'], {
        reason: `Некорректный URL: ${urlRaw}`,
      });
    }

    // URL с учётными данными — подозрителен
    if (parsed.username !== '' || parsed.password !== '') {
      return this.decide(request, 'deny', ['http.credentials'], {
        reason: 'URL содержит учётные данные (username/password)',
      });
    }

    // Только https
    if (this.httpsOnly && parsed.protocol.toLowerCase() !== 'https:') {
      return this.decide(request, 'require-confirmation', ['http.not-https'], {
        dangerLevel: 'medium',
        description: `HTTP без шифрования: ${urlRaw}`,
      });
    }

    // Белый список хостов (домен или поддомен)
    const hostname = parsed.hostname.toLowerCase();
    const hostAllowed = this.allowedHttpHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
    if (!hostAllowed) {
      return this.decide(request, 'deny', ['http.unknown-host'], {
        reason: `Хост не входит в белый список: ${hostname}`,
      });
    }

    return this.decide(request, 'allow', ['http.allowed']);
  }

  private evaluateProcess(request: SecurityActionRequest): SecurityDecision {
    const normalized = this.normalizeCommand(request);
    if (normalized.command === '') {
      return this.decide(request, 'deny', ['command.missing'], {
        reason: 'Команда не указана',
      });
    }

    const commandLine = [normalized.command, ...normalized.args].join(' ');

    for (const pattern of this.denyPatterns) {
      if (pattern.test(commandLine)) {
        return this.decide(request, 'deny', ['command.deny-pattern'], {
          reason: `Команда заблокирована чёрным списком (${pattern}): ${commandLine}`,
        });
      }
    }

    for (const part of [normalized.command, ...normalized.args]) {
      if (part.includes('\0') || TERMINAL_INJECTION_CHARS.test(part)) {
        return this.decide(request, 'deny', ['command.injection'], {
          reason: `Запрещённые символы инъекции: ${commandLine}`,
        });
      }
    }

    // Запуск процессов — высокорисковое действие, всегда подтверждение
    return this.decide(
      request,
      'require-confirmation',
      ['process.require-confirmation'],
      {
        dangerLevel: 'high',
        description: `Запуск процесса: ${commandLine}`,
      },
    );
  }

  // ── Хелперы ──

  /**
   * Преобразует входной путь в абсолютный внутри разрешённого корня.
   * Относительные пути резолвятся от первого корня.
   */
  private resolveTarget(
    rawPath: string,
  ): { ok: true; abs: string } | { ok: false; error: string } {
    const root = this.roots[0];
    if (!root) {
      return {
        ok: false,
        error: 'SecurityAgent: не настроен корень файловых операций',
      };
    }
    const trimmed = rawPath.trim();
    if (trimmed === '') {
      return { ok: true, abs: root };
    }
    if (path.isAbsolute(trimmed)) {
      const abs = path.normalize(trimmed);
      if (!this.roots.some((entry) => isInside(entry, abs))) {
        return { ok: false, error: `Путь вне разрешённых корней: ${abs}` };
      }
      return { ok: true, abs };
    }
    const abs = path.resolve(root, trimmed);
    if (!isInside(root, abs)) {
      return { ok: false, error: `Выход за пределы корня: ${trimmed}` };
    }
    return { ok: true, abs };
  }

  /** Классификация абсолютного пути: системный / чувствительный / служебный */
  private assessPath(abs: string): {
    system: boolean;
    sensitiveHigh: boolean;
    sensitiveMedium: boolean;
  } {
    const normalized = path.normalize(abs);
    const system = this.systemRoots.some((root) => isInside(root, normalized));
    const segments = normalized
      .split(/[\\/]+/)
      .map((segment) => segment.toLowerCase());

    const sensitiveHigh = segments.some(
      (segment) =>
        SENSITIVE_SEGMENTS_HIGH.has(segment) ||
        (segment.startsWith('.env') &&
          (segment === '.env' || segment.startsWith('.env.'))),
    );
    const sensitiveMedium = segments.some((segment) =>
      SENSITIVE_SEGMENTS_MEDIUM.has(segment),
    );
    return { system, sensitiveHigh, sensitiveMedium };
  }

  /**
   * Нормализует команду: если command — полная строка («rm -rf /»),
   * разделяет на бинарь и аргументы; дополняет их переданными args.
   */
  private normalizeCommand(request: SecurityActionRequest): {
    command: string;
    args: string[];
  } {
    const raw = (request.command ?? '').trim();
    if (raw === '') {
      return { command: '', args: request.args ?? [] };
    }
    const tokens = raw.split(/\s+/).filter((token) => token !== '');
    return {
      command: tokens[0] ?? '',
      args: [...tokens.slice(1), ...(request.args ?? [])],
    };
  }

  /** Собрать решение и записать его в историю/аудит */
  private decide(
    request: SecurityActionRequest,
    verdict: SecurityVerdict,
    matchedRules: string[],
    extras: {
      reason?: string;
      dangerLevel?: DangerLevel;
      description?: string;
    } = {},
  ): SecurityDecision {
    return {
      id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      request,
      verdict,
      ...extras,
      matchedRules,
    };
  }

  private record(decision: SecurityDecision): void {
    this.history.push(decision);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.auditLog?.log(
      'security.decision',
      this.name,
      `Вердикт ${decision.verdict} для операции ${decision.request.kind}`,
      {
        verdict: decision.verdict,
        kind: decision.request.kind,
        reason: decision.reason,
        dangerLevel: decision.dangerLevel,
        matchedRules: decision.matchedRules,
      },
    );
  }
}

// ──────────────────────────────────────────────
// 4. Утилиты
// ──────────────────────────────────────────────

/** Системные корни, доступ к которым требует подтверждения (по ОС) */
function buildSystemRoots(): string[] {
  const unixRoots: readonly string[] = [
    '/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/dev',
    '/proc',
    '/sys',
    '/boot',
    '/var',
    '/opt',
    '/System',
    '/Library',
    '/Applications',
  ];
  if (process.platform !== 'win32') {
    return [...unixRoots];
  }
  const drive = (process.env.SystemDrive ?? 'C:').toUpperCase();
  return [
    `${drive}\\Windows`,
    `${drive}\\Program Files`,
    `${drive}\\Program Files (x86)`,
    `${drive}\\ProgramData`,
    `${drive}\\PerfLogs`,
    `${drive}\\System Volume Information`,
    `${drive}\\$Recycle.Bin`,
  ];
}

/** Похож ли аргумент на путь (зеркалит логику TerminalAgent) */
function looksLikePath(value: string): boolean {
  if (value === '' || value.startsWith('-')) return false;
  // Глоб-паттерны не резолвим
  if (/[*?[\]]/.test(value)) return false;
  if (value.includes('/') || value.includes('\\')) return true;
  if (value.startsWith('.')) return true;
  return false;
}

/** Резолвит аргумент как путь относительно cwd (зеркалит TerminalAgent) */
function resolveArgPath(cwd: string, value: string): string | null {
  if (value === '' || value.startsWith('-')) return null;
  if (/[*?[\]]/.test(value)) return null;
  // Не считаем путями значения вида key=value / proto://...
  if (/^[a-z]+:\/\//i.test(value)) return null;
  const candidate = path.isAbsolute(value) ? value : path.resolve(cwd, value);
  return path.normalize(candidate);
}
