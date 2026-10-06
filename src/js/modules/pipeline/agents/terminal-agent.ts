/**
 * TerminalAgent — агент безопасного выполнения команд.
 *
 * Даёт Director'у «руку» для работы с терминалом проекта:
 * - безопасные read-команды: ls, cat, grep и др. (с ограничением вывода);
 * - npm-команды: install, update, uninstall, run, build (whitelist по подстрокам);
 * - git-команды: commit, push, branch, status, log;
 * - таймауты для долгих операций (по умолчанию 60s, настраивается);
 * - логирование всех выполненных команд и их результатов;
 * - запрет работы вне корня агента (cwd всегда внутри разрешённых корней).
 *
 * Безопасность:
 * - команды выполняются через child_process.spawn БЕЗ shell (инъекции
 *   ; | & ` $() %0a не могут быть интерпретированы оболочкой и блокируются);
 * - whitelist команд + blacklist опасных паттернов (rm -rf, sudo, del,
 *   format, mkfs, редиректы в системные пути и т.д.);
 * - аргументы-пути не должны выходить за пределы рабочей директории;
 * - вывод ограничивается по размеру (truncated: true при превышении).
 */

import * as childProcess from 'child_process';
import * as path from 'path';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';

// ──────────────────────────────────────────────
// 1. Типы TerminalAgent
// ──────────────────────────────────────────────

/** Входные данные TerminalAgent */
export interface TerminalAgentInput {
  /** Команда (без shell-обёртки) */
  command: string;
  /** Аргументы команды (каждый элемент — один аргумент) */
  args?: string[];
  /** Таймаут выполнения в мс (переопределяет значение по умолчанию) */
  timeoutMs?: number;
}

/** Выходные данные TerminalAgent */
export interface TerminalAgentOutput {
  /** Полная командная строка (для логов) */
  command: string;
  /** Стандартный вывод */
  stdout: string;
  /** Вывод ошибок */
  stderr: string;
  /** Код возврата процесса */
  exitCode: number;
  /** Время выполнения в мс */
  durationMs: number;
  /** Обрезан ли вывод (превышение maxOutputBytes) */
  truncated: boolean;
}

/** Запись журнала выполненных команд */
export interface TerminalLogEntry {
  /** Метка времени */
  timestamp: string;
  /** Полная командная строка */
  command: string;
  /** Код возврата (null — процесс убит сигналом) */
  exitCode: number | null;
  /** Время выполнения в мс */
  durationMs: number;
  /** Успех */
  success: boolean;
  /** Обрезан ли вывод */
  truncated: boolean;
  /** Первые N символов stdout (для аудита) */
  stdoutPreview: string;
  /** Первые N символов stderr (для аудита) */
  stderrPreview: string;
}

/** Опции конфигурации TerminalAgent */
export interface TerminalAgentOptions {
  /** Разрешённые корни (по умолчанию — process.cwd()) */
  roots?: string[];
  /** Рабочая директория команд (по умолчанию — первый корень) */
  cwd?: string;
  /** Таймаут по умолчанию в мс (по умолчанию 60000) */
  defaultTimeoutMs?: number;
  /** Максимальный размер вывода в байтах (по умолчанию 256 КБ) */
  maxOutputBytes?: number;
  /** Дополнительные разрешённые команды (расширяют whitelist) */
  allowedCommands?: string[];
  /** Дополнительные чёрные regex-паттерны (регистронезависимые) */
  denyPatterns?: string[];
  /** Функция запуска процесса (для тестов и DI) */
  spawn?: typeof childProcess.spawn;
}

/** Ошибка выполнения команды (exitCode !== 0) */
export class TerminalCommandError extends Error {
  public readonly stdout: string;
  public readonly stderr: string;
  public readonly exitCode: number;

  constructor(output: TerminalAgentOutput) {
    super(`Команда завершилась с кодом ${output.exitCode}: ${output.command}`);
    this.name = 'TerminalCommandError';
    this.stdout = output.stdout;
    this.stderr = output.stderr;
    this.exitCode = output.exitCode;
  }
}

// ──────────────────────────────────────────────
// 2. Константы безопасности
// ──────────────────────────────────────────────

/** Таймаут по умолчанию — 60 секунд */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Максимальный размер вывода (stdout+stderr суммарно по потоку) */
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

/** Сколько символов вывода хранить в журнале */
const LOG_PREVIEW_LIMIT = 500;

/** Максимум записей в журнале */
const MAX_HISTORY = 100;

/** Whitelist команд по умолчанию */
const DEFAULT_ALLOWED_COMMANDS: readonly string[] = [
  // read-команды
  'ls',
  'dir',
  'cat',
  'type',
  'grep',
  'findstr',
  'find',
  'head',
  'tail',
  'wc',
  'pwd',
  'echo',
  // npm / node
  'npm',
  'npx',
  'node',
  // git
  'git',
];

/** Разрешённые подкоманды git */
const GIT_ALLOWED_SUBCOMMANDS: readonly string[] = [
  'commit',
  'push',
  'branch',
  'status',
  'log',
];

/** Whitelist-подстроки для npm (проверка по подстрокам) */
const NPM_ALLOWED_SUBSTRINGS: readonly string[] = [
  'install',
  'update',
  'run',
  'build',
];

/** Редиректы в системные пути: `>` + системный путь (Windows/Unix) */
const SYSTEM_PATH_REDIRECT =
  />\s*(?:[a-zA-Z]:[\\/]|\/?(?:etc|usr|windows|system32|dev|proc|sys|boot|Program\s*Files)[\\/]?)/i;

/** Чёрный список опасных команд/паттернов */
const DEFAULT_DENY_PATTERNS: readonly RegExp[] = [
  /\brm\s+-\S*[rf]\S*\b/i, // rm -rf, rm -fr, rm -r -f
  /\bsudo\b/i,
  /\bdel\b/i, // Windows del
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bmkswap\b|\bfdisk\b/i,
  /\bdd\s+of=/i,
  /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/i,
  /\brmdir\s+\/|\brm\s+[\\/]/i, // удаление корня
  /\breg\s+(?:delete|add)\b/i,
  /\btaskkill\b|\bkill\s+-9\b|\bpkill\s+-9\b/i,
  SYSTEM_PATH_REDIRECT,
];

/** Символы инъекций, запрещённые в команде и аргументах */
const INJECTION_CHARS = /[;|&`]|\$\s*\(|\$\{|%0a|%0d|\r|\n/i;

/**
 * Публичные версии правил безопасности — единый источник истины
 * для SecurityAgent (не дублируем blacklist/whitelist в двух местах).
 */

/** Whitelist команд по умолчанию (публичный для SecurityAgent) */
export const TERMINAL_ALLOWED_COMMANDS: readonly string[] =
  DEFAULT_ALLOWED_COMMANDS;

/** Чёрный список опасных паттернов (публичный для SecurityAgent) */
export const TERMINAL_DENY_PATTERNS: readonly RegExp[] = DEFAULT_DENY_PATTERNS;

/** Запрещённые символы инъекций (публичный для SecurityAgent) */
export const TERMINAL_INJECTION_CHARS: RegExp = INJECTION_CHARS;

// ──────────────────────────────────────────────
// 3. TerminalAgent
// ──────────────────────────────────────────────

/**
 * TerminalAgent — безопасное выполнение команд в пределах корня проекта.
 */
export class TerminalAgent extends AgentBase {
  private readonly roots: string[];
  private readonly cwd: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly allowedCommands: ReadonlySet<string>;
  private readonly denyPatterns: RegExp[];
  private readonly spawnFn: typeof childProcess.spawn;
  private readonly history: TerminalLogEntry[] = [];

  constructor(config?: AgentConfig, options?: TerminalAgentOptions) {
    super(config ?? { name: 'TerminalAgent' });
    const roots = options?.roots?.length ? options.roots : [process.cwd()];
    this.roots = roots.map((root) => path.resolve(root));

    this.defaultTimeoutMs =
      options?.defaultTimeoutMs && options.defaultTimeoutMs > 0
        ? options.defaultTimeoutMs
        : DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes =
      options?.maxOutputBytes && options.maxOutputBytes > 0
        ? options.maxOutputBytes
        : DEFAULT_MAX_OUTPUT_BYTES;
    this.allowedCommands = new Set([
      ...DEFAULT_ALLOWED_COMMANDS,
      ...(options?.allowedCommands ?? []),
    ]);
    this.denyPatterns = [
      ...DEFAULT_DENY_PATTERNS,
      ...(options?.denyPatterns ?? []).map(
        (pattern) => new RegExp(pattern, 'i'),
      ),
    ];
    this.spawnFn = options?.spawn ?? childProcess.spawn;

    const requestedCwd = options?.cwd
      ? path.resolve(options.cwd)
      : (this.roots[0] ?? process.cwd());
    if (!this.roots.some((root) => isInside(root, requestedCwd))) {
      throw new Error(
        `TerminalAgent: рабочая директория вне разрешённых корней: ${requestedCwd}`,
      );
    }
    this.cwd = requestedCwd;
  }

  protected async executeInternal(
    input: unknown,
  ): Promise<TerminalAgentOutput> {
    const parsed = parseInput(input, this.defaultTimeoutMs);
    this.validateCommand(parsed);

    const startedAt = Date.now();
    const raw = await this.runProcess(parsed);
    const durationMs = Date.now() - startedAt;
    const output: TerminalAgentOutput = {
      ...raw,
      command: formatCommandLine(parsed.command, parsed.args),
      durationMs,
    };

    this.appendLog({
      timestamp: new Date().toISOString(),
      command: output.command,
      exitCode: output.exitCode,
      durationMs: output.durationMs,
      success: output.exitCode === 0,
      truncated: output.truncated,
      stdoutPreview: preview(output.stdout),
      stderrPreview: preview(output.stderr),
    });

    if (output.exitCode !== 0) {
      throw new TerminalCommandError(output);
    }
    return output;
  }

  /** Журнал выполненных команд (последние MAX_HISTORY записей) */
  getHistory(): readonly TerminalLogEntry[] {
    return [...this.history];
  }

  /** Рабочая директория агента */
  getWorkingDirectory(): string {
    return this.cwd;
  }

  // ── Безопасность ──

  private validateCommand(parsed: ParsedInput): void {
    const { command, args } = parsed;
    const bin = path.basename(command).toLowerCase();

    // 1. Команда должна входить в whitelist
    if (!this.allowedCommands.has(bin)) {
      throw new Error(
        `TerminalAgent: команда не входит в whitelist: ${command}`,
      );
    }

    // 2. Путь к бинарю (если указан) не должен выходить за пределы cwd
    if (containsSeparator(command)) {
      const resolved = resolveArgPath(this.cwd, command);
      if (!resolved || !this.roots.some((root) => isInside(root, resolved))) {
        throw new Error(
          `TerminalAgent: путь команды вне разрешённых корней: ${command}`,
        );
      }
    }

    const commandLine = formatCommandLine(command, args);

    // 3. Черный список опасных паттернов
    for (const pattern of this.denyPatterns) {
      if (pattern.test(commandLine)) {
        throw new Error(
          `TerminalAgent: команда заблокирована чёрным списком (${pattern}): ${commandLine}`,
        );
      }
    }

    // 4. Символы инъекций в команде и аргументах
    for (const part of [command, ...args]) {
      if (part.includes('\0') || INJECTION_CHARS.test(part)) {
        throw new Error(
          `TerminalAgent: запрещённые символы инъекции в команде: ${commandLine}`,
        );
      }
    }

    // 5. Подкоманды npm/git — своя валидация
    this.validateSubcommand(bin, args, commandLine);

    // 6. Аргументы-пути не должны выходить за пределы cwd
    for (const arg of args) {
      if (!looksLikePath(arg)) continue;
      const resolved = resolveArgPath(this.cwd, arg);
      if (!resolved || !this.roots.some((root) => isInside(root, resolved))) {
        throw new Error(
          `TerminalAgent: аргумент-путь вне разрешённых корней: ${arg}`,
        );
      }
    }
  }

  private validateSubcommand(
    bin: string,
    args: string[],
    commandLine: string,
  ): void {
    if (bin === 'git') {
      const sub = firstNonFlag(args);
      if (!sub || !GIT_ALLOWED_SUBCOMMANDS.includes(sub)) {
        throw new Error(
          `TerminalAgent: подкоманда git не входит в whitelist: ${commandLine}`,
        );
      }
      return;
    }
    if (bin === 'npm') {
      const sub = firstNonFlag(args);
      if (!sub || !NPM_ALLOWED_SUBSTRINGS.some((s) => sub.includes(s))) {
        throw new Error(
          `TerminalAgent: подкоманда npm не входит в whitelist (install/update/uninstall/run/build): ${commandLine}`,
        );
      }
    }
  }

  // ── Выполнение ──

  private runProcess(
    parsed: ParsedInput,
  ): Promise<Omit<TerminalAgentOutput, 'command' | 'durationMs'>> {
    return new Promise((resolve, reject) => {
      let child: childProcess.ChildProcessWithoutNullStreams;
      try {
        child = this.spawnFn(parsed.command, parsed.args, {
          cwd: this.cwd,
          shell: false,
          windowsHide: true,
        }) as childProcess.ChildProcessWithoutNullStreams;
      } catch (err) {
        reject(err);
        return;
      }

      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let settled = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // На случай зависшего kill — жёсткое завершение
        setTimeout(() => {
          if (!settled && child.exitCode === null) {
            child.kill('SIGKILL');
          }
        }, 1000).unref();
      }, parsed.timeoutMs);
      timer.unref();

      const finish = (
        outcome:
          | {
              ok: true;
              data: Omit<TerminalAgentOutput, 'command' | 'durationMs'>;
            }
          | { ok: false; error: Error },
      ): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (outcome.ok) resolve(outcome.data);
        else reject(outcome.error);
      };

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdoutTruncated) return;
        const text = chunk.toString('utf-8');
        if (Buffer.byteLength(stdout + text, 'utf-8') > this.maxOutputBytes) {
          const remaining =
            this.maxOutputBytes - Buffer.byteLength(stdout, 'utf-8');
          stdout += remaining > 0 ? text.slice(0, remaining) : '';
          stdoutTruncated = true;
        } else {
          stdout += text;
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrTruncated) return;
        const text = chunk.toString('utf-8');
        if (Buffer.byteLength(stderr + text, 'utf-8') > this.maxOutputBytes) {
          const remaining =
            this.maxOutputBytes - Buffer.byteLength(stderr, 'utf-8');
          stderr += remaining > 0 ? text.slice(0, remaining) : '';
          stderrTruncated = true;
        } else {
          stderr += text;
        }
      });

      child.on('error', (err) => {
        finish({
          ok: false,
          error: new Error(
            `TerminalAgent: не удалось запустить команду: ${parsed.command}: ${err.message}`,
            { cause: err },
          ),
        });
      });

      child.on('close', (code, signal) => {
        if (timedOut) {
          finish({
            ok: false,
            error: new Error(
              `TerminalAgent: таймаут выполнения команды (${parsed.timeoutMs} мс): ${formatCommandLine(parsed.command, parsed.args)}`,
            ),
          });
          return;
        }
        finish({
          ok: true,
          data: {
            stdout,
            stderr,
            exitCode: code ?? (signal ? -1 : 0),
            truncated: stdoutTruncated || stderrTruncated,
          },
        });
      });
    });
  }

  // ── Журнал ──

  private appendLog(entry: TerminalLogEntry): void {
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
    if (this.verbose) {
      console.log(
        `[AGENT:TerminalAgent] ${entry.success ? 'OK' : 'FAIL'} ` +
          `${entry.command} (exit=${entry.exitCode}, ${entry.durationMs}ms)`,
      );
    }
  }
}

// ──────────────────────────────────────────────
// 4. Внутренние типы и утилиты
// ──────────────────────────────────────────────

/** Нормализованный вход (после парсинга строки/объекта) */
interface ParsedInput {
  command: string;
  args: string[];
  timeoutMs: number;
}

/** Разобрать вход: строка команды или объект {command, args?, timeoutMs?} */
function parseInput(input: unknown, defaultTimeoutMs: number): ParsedInput {
  if (typeof input === 'string') {
    const tokens = tokenize(input.trim());
    if (tokens.length === 0) {
      throw new Error('TerminalAgent: команда не указана');
    }
    return {
      command: tokens[0]!,
      args: tokens.slice(1),
      timeoutMs: defaultTimeoutMs,
    };
  }
  if (!input || typeof input !== 'object') {
    throw new Error('TerminalAgent: входные данные отсутствуют');
  }
  const record = input as Record<string, unknown>;
  const command = record['command'];
  if (typeof command !== 'string' || command.trim() === '') {
    throw new Error('TerminalAgent: не указана команда (command)');
  }
  const rawArgs = record['args'];
  const args = Array.isArray(rawArgs)
    ? rawArgs.map((value) => String(value))
    : [];
  const rawTimeout = record['timeoutMs'];
  const timeoutMs =
    typeof rawTimeout === 'number' && rawTimeout > 0
      ? rawTimeout
      : defaultTimeoutMs;
  return { command: command.trim(), args, timeoutMs };
}

/** Простой токенизатор с поддержкой одинарных/двойных кавычек (без shell) */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const char of line) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

/** Полная командная строка для логов */
function formatCommandLine(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

/** Содержит ли строка разделитель пути */
function containsSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

/** Похож ли аргумент на путь (а не на флаг/значение) */
function looksLikePath(value: string): boolean {
  if (value === '' || value.startsWith('-')) return false;
  // Глоб-паттерны не резолвим
  if (/[*?[\]]/.test(value)) return false;
  if (containsSeparator(value)) return true;
  if (value.startsWith('.')) return true;
  return false;
}

/**
 * Резолвит аргумент как путь относительно cwd.
 * Возвращает null, если это не путь (опция, глоб, URL и т.п.).
 */
function resolveArgPath(cwd: string, value: string): string | null {
  if (value === '' || value.startsWith('-')) return null;
  if (/[*?[\]]/.test(value)) return null;
  // Не считаем путями значения вида key=value / proto://...
  if (/^[a-z]+:\/\//i.test(value)) return null;
  const candidate = path.isAbsolute(value) ? value : path.resolve(cwd, value);
  return path.normalize(candidate);
}

/** Первый аргумент, не начинающийся с '-' (подкоманда) */
function firstNonFlag(args: string[]): string | undefined {
  return args.find((arg) => !arg.startsWith('-'));
}

/** Лежит ли target внутри root (включая сам root) */
function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Префикс вывода для журнала */
function preview(value: string): string {
  return value.length > LOG_PREVIEW_LIMIT
    ? `${value.slice(0, LOG_PREVIEW_LIMIT)}…`
    : value;
}
