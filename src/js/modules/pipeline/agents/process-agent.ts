/**
 * ProcessAgent — агент управления процессами.
 *
 * Высокоуровневый менеджер процессов поверх child_process.spawn:
 * - запуск долгоживущих процессов (node, python, gulp и др.) по имени
 *   команды или абсолютному пути — только через whitelist терминала;
 * - остановка: SIGTERM → по таймауту (по умолчанию 5 с) → SIGKILL;
 * - статус всех процессов, запущенных агентом;
 * - авто-перезапуск при ненулевом exitCode с экспоненциальным backoff
 *   (1с, 2с, 4с…) и лимитом попыток (по умолчанию 3) → статус crashed.
 *
 * Безопасность:
 * - команды выполняются через child_process.spawn БЕЗ shell (инъекции
 *   ; | & ` $() %0a не интерпретируются оболочкой);
 * - whitelist переиспользует TERMINAL_ALLOWED_COMMANDS из TerminalAgent
 *   (+ расширения для долгих процессов: python, python3, gulp);
 * - чёрный список опасных паттернов и символы инъекций — те же, что у
 *   TerminalAgent (TERMINAL_DENY_PATTERNS / TERMINAL_INJECTION_CHARS);
 * - cwd и путь бинаря строго внутри разрешённых корней (isInside,
 *   как в FileAgent).
 *
 * Ограничение мониторинга на Windows: RSS/CPU внешнего процесса
 * недоступны через стандартный API Node (process.memoryUsage работает
 * только для текущего процесса, /proc отсутствует; модуль resource-monitor
 * измеряет нагрузку СИСТЕМЫ os.cpus()/os.totalmem(), а не per-process).
 * Поэтому для запущенных процессов собираются: uptime, статус, exitCode
 * и хвост вывода (outputTail) — без memoryMb/cpu.
 */

import * as childProcess from 'child_process';
import * as path from 'path';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import type { AgentActionInput } from '../agent/agent-contract.js';
import { isInside } from './file-agent.js';
import {
  TERMINAL_ALLOWED_COMMANDS,
  TERMINAL_DENY_PATTERNS,
  TERMINAL_INJECTION_CHARS,
} from './terminal-agent.js';

// ──────────────────────────────────────────────
// 1. Типы ProcessAgent
// ──────────────────────────────────────────────

/** Действие агента управления процессами */
export type ProcessAgentAction = 'start' | 'stop' | 'status' | 'restart';

/** Статус управляемого процесса */
export type ManagedProcessStatus =
  'running' | 'stopped' | 'exited' | 'crashed' | 'restarting';

/**
 * Входные данные ProcessAgent.
 * Расширяет единый стандарт входа action-агента `AgentActionInput`.
 */
export interface ProcessAgentInput extends AgentActionInput<ProcessAgentAction> {
  /** Команда (имя из whitelist или абсолютный путь внутри корней) */
  command?: string;
  /** Аргументы команды (каждый элемент — один аргумент) */
  args?: string[];
  /** Рабочая директория (по умолчанию — первый корень) */
  cwd?: string;
  /** Дополнительные переменные окружения */
  env?: Record<string, string>;
  /**
   * Имя процесса (для stop/restart/status) или PID (число).
   * Для start — желаемое имя; если не указано, генерируется автоматически.
   */
  name?: string | number;
  /** Авто-перезапуск при ненулевом exitCode */
  restartOnExit?: boolean;
  /** Лимит автоматических перезапусков (по умолчанию 3) */
  maxRestarts?: number;
  /** Начальная backoff-задержка в мс (по умолчанию 1000) */
  restartBackoffMs?: number;
}

/** Публичная информация об управляемом процессе */
export interface ManagedProcessInfo {
  /** Имя процесса (для управления) */
  name: string;
  /** PID текущего запуска (null, если не запущен) */
  pid: number | null;
  /** Команда */
  command: string;
  /** Аргументы */
  args: string[];
  /** Статус */
  status: ManagedProcessStatus;
  /** Время старта текущего запуска (ISO 8601) */
  startedAt: string | null;
  /** Код возврата последнего завершения */
  exitCode: number | null;
  /** Сколько раз выполнялся автоматический перезапуск */
  restarts: number;
  /** Время жизни текущего запуска в мс (0, если не running) */
  uptimeMs: number;
  /** Последние N строк вывода (stdout+stderr) */
  outputTail: string;
}

/** Выходные данные ProcessAgent */
export interface ProcessAgentOutput {
  /** Выполненное действие */
  action: ProcessAgentAction;
  /** Все зарегистрированные процессы (или один, если запрошен по name/pid) */
  processes: ManagedProcessInfo[];
  /** Человекочитаемое описание результата */
  message: string;
}

/** Опции конфигурации ProcessAgent */
export interface ProcessAgentOptions {
  /** Разрешённые корни (по умолчанию — process.cwd()) */
  roots?: string[];
  /** Дополнительные разрешённые команды (расширяют whitelist) */
  allowedCommands?: string[];
  /** Функция запуска процесса (для тестов и DI) */
  spawn?: typeof childProcess.spawn;
  /** Таймаут ожидания после SIGTERM до SIGKILL в мс (по умолчанию 5000) */
  killTimeoutMs?: number;
  /** Лимит автоматических перезапусков (по умолчанию 3) */
  maxRestarts?: number;
  /** Начальная backoff-задержка в мс (по умолчанию 1000) */
  restartBackoffMs?: number;
  /** Максимум строк в outputTail (по умолчанию 50) */
  maxOutputTailLines?: number;
  /** Инжектируемые часы (для тестов) */
  setNow?: () => number;
}

// ──────────────────────────────────────────────
// 2. Константы
// ──────────────────────────────────────────────

/** Таймаут SIGTERM → SIGKILL по умолчанию — 5 секунд */
const DEFAULT_KILL_TIMEOUT_MS = 5_000;

/** Лимит автоматических перезапусков по умолчанию */
const DEFAULT_MAX_RESTARTS = 3;

/** Начальная backoff-задержка по умолчанию — 1 секунда */
const DEFAULT_RESTART_BACKOFF_MS = 1_000;

/** Максимум строк в outputTail по умолчанию */
const DEFAULT_OUTPUT_TAIL_LINES = 50;

/** Защита от бесконечного накопления незакрытой строки (разрыв чанка) */
const MAX_PENDING_LINE_LENGTH = 8_192;

/** Расширения whitelist терминала для долгоживущих процессов */
const DEFAULT_PROCESS_ALLOWED: readonly string[] = [
  'python',
  'python3',
  'gulp',
];

const ACTIONS: ReadonlySet<string> = new Set([
  'start',
  'stop',
  'status',
  'restart',
]);

// ──────────────────────────────────────────────
// 3. ManagedProcess (внутренний)
// ──────────────────────────────────────────────

/** Нормализованный вход (после парсинга) */
interface ParsedInput {
  action: ProcessAgentAction;
  command?: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  name?: string | number;
  restartOnExit?: boolean;
  maxRestarts?: number;
  restartBackoffMs?: number;
}

/** Параметры запуска ManagedProcess */
interface ManagedProcessParams {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  restartOnExit: boolean;
  maxRestarts: number;
  restartBackoffMs: number;
  outputLimit: number;
}

/**
 * Управляемый процесс: дочерний child_process + метаданные жизненного цикла.
 * Не экспортируется — деталь реализации ProcessAgent.
 */
class ManagedProcess {
  public readonly name: string;
  public command: string;
  public args: string[];
  public cwd: string;
  public env?: Record<string, string>;
  public restartOnExit: boolean;
  public maxRestarts: number;
  public restartBackoffMs: number;
  public readonly outputLimit: number;

  public proc: childProcess.ChildProcess | null = null;
  public pid: number | null = null;
  public status: ManagedProcessStatus = 'running';
  public startedAt: number | null = null;
  public exitCode: number | null = null;
  public restarts = 0;
  public stopRequested = false;
  public restartTimer: ReturnType<typeof setTimeout> | null = null;
  public spawnError: string | undefined;

  private readonly outputLines: string[] = [];
  private pendingLine = '';

  constructor(params: ManagedProcessParams) {
    this.name = params.name;
    this.command = params.command;
    this.args = params.args;
    this.cwd = params.cwd;
    this.env = params.env;
    this.restartOnExit = params.restartOnExit;
    this.maxRestarts = params.maxRestarts;
    this.restartBackoffMs = params.restartBackoffMs;
    this.outputLimit = params.outputLimit;
  }

  /** Добавить чанк вывода в кольцевой буфер строк */
  appendOutput(chunk: Buffer | string): void {
    const text = chunk.toString('utf-8');
    const parts = text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (i === parts.length - 1) {
        this.pendingLine += part;
      } else {
        this.pushLine(this.pendingLine + part);
        this.pendingLine = '';
      }
    }
    if (this.pendingLine.length > MAX_PENDING_LINE_LENGTH) {
      this.pushLine(this.pendingLine);
      this.pendingLine = '';
    }
  }

  /** Публичный снимок состояния */
  toInfo(nowMs: number): ManagedProcessInfo {
    const isRunning = this.status === 'running' && this.startedAt !== null;
    return {
      name: this.name,
      pid: this.pid,
      command: this.command,
      args: [...this.args],
      status: this.status,
      startedAt:
        this.startedAt !== null ? new Date(this.startedAt).toISOString() : null,
      exitCode: this.exitCode,
      restarts: this.restarts,
      uptimeMs: isRunning ? Math.max(0, nowMs - (this.startedAt ?? 0)) : 0,
      outputTail: this.outputLines.join('\n'),
    };
  }

  private pushLine(line: string): void {
    if (line === '') return;
    this.outputLines.push(line);
    if (this.outputLines.length > this.outputLimit) {
      this.outputLines.shift();
    }
  }
}

// ──────────────────────────────────────────────
// 4. ProcessAgent
// ──────────────────────────────────────────────

/**
 * ProcessAgent — управление процессами проекта (запуск/остановка/статус).
 */
export class ProcessAgent extends AgentBase {
  private readonly roots: string[];
  private readonly allowedCommands: ReadonlySet<string>;
  private readonly denyPatterns: RegExp[];
  private readonly spawnFn: typeof childProcess.spawn;
  private readonly killTimeoutMs: number;
  private readonly defaultMaxRestarts: number;
  private readonly defaultRestartBackoffMs: number;
  private readonly outputTailLines: number;
  private readonly now: () => number;

  private readonly processes = new Map<string, ManagedProcess>();
  private nameCounter = 0;

  constructor(config?: AgentConfig, options?: ProcessAgentOptions) {
    super(config ?? { name: 'ProcessAgent' });
    const roots = options?.roots?.length ? options.roots : [process.cwd()];
    this.roots = roots.map((root) => path.resolve(root));

    this.allowedCommands = new Set([
      ...TERMINAL_ALLOWED_COMMANDS,
      ...DEFAULT_PROCESS_ALLOWED,
      ...(options?.allowedCommands ?? []),
    ]);
    this.denyPatterns = [...TERMINAL_DENY_PATTERNS];
    this.spawnFn = options?.spawn ?? childProcess.spawn;
    this.killTimeoutMs =
      options?.killTimeoutMs && options.killTimeoutMs > 0
        ? options.killTimeoutMs
        : DEFAULT_KILL_TIMEOUT_MS;
    this.defaultMaxRestarts = options?.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    this.defaultRestartBackoffMs =
      options?.restartBackoffMs ?? DEFAULT_RESTART_BACKOFF_MS;
    this.outputTailLines =
      options?.maxOutputTailLines ?? DEFAULT_OUTPUT_TAIL_LINES;
    this.now = options?.setNow ?? Date.now;
  }

  protected async executeInternal(input: unknown): Promise<ProcessAgentOutput> {
    const parsed = parseInput(input);

    switch (parsed.action) {
      case 'start':
        return this.start(parsed);
      case 'stop':
        return this.stopManaged(parsed);
      case 'status':
        return this.status(parsed);
      case 'restart':
        return this.restart(parsed);
      default: {
        const exhaustive: never = parsed.action;
        throw new Error(
          `ProcessAgent: неизвестное действие ${String(exhaustive)}`,
        );
      }
    }
  }

  // ── Действия ──

  private start(input: ParsedInput): ProcessAgentOutput {
    const command = input.command ?? '';
    const args = input.args;
    const cwd = this.resolveCwd(input.cwd);
    this.validateCommand(command, args, cwd);

    const name =
      typeof input.name === 'string' && input.name.trim() !== ''
        ? input.name.trim()
        : this.generateName(command);
    if (this.processes.has(name)) {
      throw new Error(
        `ProcessAgent: процесс с именем «${name}» уже существует (используйте restart или другое имя)`,
      );
    }

    const mp = new ManagedProcess({
      name,
      command,
      args,
      cwd,
      env: input.env,
      restartOnExit: input.restartOnExit ?? false,
      maxRestarts: input.maxRestarts ?? this.defaultMaxRestarts,
      restartBackoffMs: input.restartBackoffMs ?? this.defaultRestartBackoffMs,
      outputLimit: this.outputTailLines,
    });
    this.processes.set(name, mp);
    this.launch(mp);

    return {
      action: 'start',
      processes: this.snapshot(),
      message: `Запущен процесс «${name}» (pid=${mp.pid ?? '—'})`,
    };
  }

  private async stopManaged(input: ParsedInput): Promise<ProcessAgentOutput> {
    const target = this.findTarget(input.name);
    if (!target) {
      throw new Error(
        `ProcessAgent: процесс не найден: ${String(input.name ?? '')}`,
      );
    }
    await this.stopProcess(target);
    return {
      action: 'stop',
      processes: this.snapshot(),
      message: `Процесс «${target.name}» остановлен`,
    };
  }

  private status(input: ParsedInput): ProcessAgentOutput {
    const target = this.findTarget(input.name);
    if (input.name !== undefined && !target) {
      throw new Error(`ProcessAgent: процесс не найден: ${String(input.name)}`);
    }
    const list = target ? [target] : Array.from(this.processes.values());
    return {
      action: 'status',
      processes: list.map((mp) => mp.toInfo(this.now())),
      message: target
        ? `Статус процесса «${target.name}»: ${target.status}`
        : `Процессов под управлением: ${list.length}`,
    };
  }

  private async restart(input: ParsedInput): Promise<ProcessAgentOutput> {
    const target = this.findTarget(input.name);
    if (!target) {
      throw new Error(
        `ProcessAgent: процесс не найден: ${String(input.name ?? '')}`,
      );
    }
    await this.stopProcess(target);
    // Ручной перезапуск — новое «поколение»: сбрасываем счётчик авто-рестартов
    target.stopRequested = false;
    target.restarts = 0;
    target.exitCode = null;

    // Если указаны новые параметры запуска — применяем их (иначе — сохранённые)
    if (input.command !== undefined) {
      const args = input.args.length > 0 ? input.args : target.args;
      const cwd = this.resolveCwd(input.cwd ?? target.cwd);
      this.validateCommand(input.command, args, cwd);
      target.command = input.command;
      target.args = args;
      target.cwd = cwd;
    }
    if (input.restartOnExit !== undefined) {
      target.restartOnExit = input.restartOnExit;
    }
    if (input.maxRestarts !== undefined) {
      target.maxRestarts = input.maxRestarts;
    }
    if (input.restartBackoffMs !== undefined) {
      target.restartBackoffMs = input.restartBackoffMs;
    }
    this.launch(target);
    return {
      action: 'restart',
      processes: this.snapshot(),
      message: `Процесс «${target.name}» перезапущен (pid=${target.pid ?? '—'})`,
    };
  }

  // ── Жизненный цикл ──
  /** Запустить дочерний процесс (первичный старт или авто-рестарт) */
  private launch(mp: ManagedProcess): void {
    if (mp.stopRequested) return;

    let child: childProcess.ChildProcess;
    try {
      child = this.spawnFn(mp.command, mp.args, {
        cwd: mp.cwd,
        env: mp.env ? { ...process.env, ...mp.env } : undefined,
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      mp.status = 'crashed';
      mp.spawnError = errorMessage(err);
      mp.proc = null;
      mp.pid = null;
      return;
    }

    mp.proc = child;
    mp.pid = child.pid ?? null;
    mp.startedAt = this.now();
    mp.status = 'running';
    mp.exitCode = null;

    child.stdout?.on('data', (chunk: Buffer) => mp.appendOutput(chunk));
    child.stderr?.on('data', (chunk: Buffer) => mp.appendOutput(chunk));

    child.on('error', (err: Error) => {
      mp.spawnError = err.message;
    });

    child.on('close', (code, signal) => {
      this.onClose(mp, code, signal);
    });
  }

  /** Обработка завершения процесса */
  private onClose(
    mp: ManagedProcess,
    code: number | null,
    _signal: NodeJS.Signals | null,
  ): void {
    mp.proc = null;
    mp.pid = null;
    mp.exitCode = code;

    if (mp.stopRequested) {
      mp.status = 'stopped';
      return;
    }
    if (code === 0) {
      mp.status = 'exited';
      return;
    }

    // Ненулевой код / убит сигналом / ошибка запуска — падение
    if (mp.restartOnExit && mp.restarts < mp.maxRestarts) {
      const delay = mp.restartBackoffMs * 2 ** mp.restarts;
      mp.restarts += 1;
      mp.status = 'restarting';
      mp.restartTimer = setTimeout(() => {
        mp.restartTimer = null;
        this.launch(mp);
      }, delay);
      return;
    }
    mp.status = 'crashed';
  }

  /** Graceful stop: SIGTERM → по таймауту SIGKILL */
  private async stopProcess(mp: ManagedProcess): Promise<void> {
    mp.stopRequested = true;
    if (mp.restartTimer !== null) {
      clearTimeout(mp.restartTimer);
      mp.restartTimer = null;
    }

    const child = mp.proc;
    if (!child) {
      mp.status = 'stopped';
      return;
    }
    if (child.exitCode !== null) {
      mp.proc = null;
      mp.pid = null;
      mp.status = 'stopped';
      return;
    }

    const termSent = child.kill('SIGTERM');
    if (!termSent) {
      mp.proc = null;
      mp.pid = null;
      mp.status = 'stopped';
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const killTimer = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, this.killTimeoutMs);
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        resolve();
      };
      child.once('close', finish);
    });

    mp.proc = null;
    mp.pid = null;
    mp.status = 'stopped';
  }
  // ── Безопасность ──

  /** Проверить команду против whitelist/blacklist терминала */
  private validateCommand(command: string, args: string[], cwd: string): void {
    if (command.trim() === '') {
      throw new Error('ProcessAgent: не указана команда (command)');
    }
    const bin = path.basename(command).toLowerCase();

    // 1. Команда должна входить в whitelist
    if (!this.allowedCommands.has(bin)) {
      throw new Error(
        `ProcessAgent: команда не входит в whitelist: ${command}`,
      );
    }

    // 2. Путь к бинарю (если указан) не должен выходить за пределы корней
    if (containsSeparator(command)) {
      const resolved = resolveBinPath(cwd, command);
      if (!resolved || !this.roots.some((root) => isInside(root, resolved))) {
        throw new Error(
          `ProcessAgent: путь команды вне разрешённых корней: ${command}`,
        );
      }
    }

    const commandLine = [command, ...args].join(' ');

    // 3. Чёрный список опасных паттернов
    for (const pattern of this.denyPatterns) {
      if (pattern.test(commandLine)) {
        throw new Error(
          `ProcessAgent: команда заблокирована чёрным списком (${pattern}): ${commandLine}`,
        );
      }
    }

    // 4. Символы инъекций в команде и аргументах
    for (const part of [command, ...args]) {
      if (part.includes('\0') || TERMINAL_INJECTION_CHARS.test(part)) {
        throw new Error(
          `ProcessAgent: запрещённые символы инъекции в команде: ${commandLine}`,
        );
      }
    }
  }

  /** Рабочая директория строго внутри корней */
  private resolveCwd(rawCwd?: string): string {
    const root = this.roots[0];
    if (!root) {
      throw new Error('ProcessAgent: не настроен корень рабочих директорий');
    }
    const target = rawCwd ? path.resolve(rawCwd) : root;
    if (!this.roots.some((entry) => isInside(entry, target))) {
      throw new Error(
        `ProcessAgent: рабочая директория вне разрешённых корней: ${target}`,
      );
    }
    return target;
  }

  // ── Хелперы ──

  /** Найти процесс по имени или PID */
  private findTarget(name: string | number | undefined): ManagedProcess | null {
    if (name === undefined) return null;
    if (typeof name === 'number') {
      for (const mp of this.processes.values()) {
        if (mp.pid === name) return mp;
      }
      return null;
    }
    return this.processes.get(name) ?? null;
  }

  /** Автоимя: proc-<бинарь>-<n> */
  private generateName(command: string): string {
    this.nameCounter += 1;
    return `proc-${path.basename(command)}-${this.nameCounter}`;
  }

  /** Снимок всех процессов */
  private snapshot(): ManagedProcessInfo[] {
    return Array.from(this.processes.values()).map((mp) =>
      mp.toInfo(this.now()),
    );
  }
}

// ──────────────────────────────────────────────
// 5. Утилиты
// ──────────────────────────────────────────────

/** Разобрать входные данные */
function parseInput(input: unknown): ParsedInput {
  if (!input || typeof input !== 'object') {
    throw new Error('ProcessAgent: входные данные отсутствуют');
  }
  const record = input as Record<string, unknown>;

  const action = record['action'];
  if (typeof action !== 'string' || !ACTIONS.has(action)) {
    throw new Error(`ProcessAgent: неизвестное действие: ${String(action)}`);
  }
  const parsedAction = action as ProcessAgentAction;

  const rawCommand = record['command'];
  const command =
    typeof rawCommand === 'string' && rawCommand.trim() !== ''
      ? rawCommand.trim()
      : undefined;

  const rawArgs = record['args'];
  const args = Array.isArray(rawArgs)
    ? rawArgs.map((value) => String(value))
    : [];

  const rawCwd = record['cwd'];
  const cwd =
    typeof rawCwd === 'string' && rawCwd.trim() !== '' ? rawCwd : undefined;

  const rawEnv = record['env'];
  const env = isPlainRecord(rawEnv)
    ? Object.fromEntries(
        Object.entries(rawEnv).map(([key, value]) => [key, String(value)]),
      )
    : undefined;

  const rawName = record['name'];
  const name =
    typeof rawName === 'string' && rawName.trim() !== ''
      ? rawName.trim()
      : typeof rawName === 'number'
        ? rawName
        : undefined;

  const rawRestartOnExit = record['restartOnExit'];
  const restartOnExit =
    typeof rawRestartOnExit === 'boolean' ? rawRestartOnExit : undefined;

  const rawMaxRestarts = record['maxRestarts'];
  const maxRestarts =
    typeof rawMaxRestarts === 'number' && rawMaxRestarts > 0
      ? Math.floor(rawMaxRestarts)
      : undefined;

  const rawBackoff = record['restartBackoffMs'];
  const restartBackoffMs =
    typeof rawBackoff === 'number' && rawBackoff > 0
      ? Math.floor(rawBackoff)
      : undefined;

  // start требует команду; restart может использовать сохранённые параметры
  if (parsedAction === 'start' && command === undefined) {
    throw new Error('ProcessAgent: не указана команда (command)');
  }
  // command для stop/status игнорируется (не ошибка — мягкая обратная совместимость)

  return {
    action: parsedAction,
    command,
    args,
    cwd,
    env,
    name,
    restartOnExit,
    maxRestarts,
    restartBackoffMs,
  };
}

/** Является ли значение простым объектом (не null, не массив) */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Содержит ли строка разделитель пути */
function containsSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

/**
 * Резолвит путь к бинарю относительно cwd.
 * Возвращает null, если это не путь (простое имя команды).
 */
function resolveBinPath(cwd: string, value: string): string | null {
  const candidate = path.isAbsolute(value) ? value : path.resolve(cwd, value);
  return path.normalize(candidate);
}

/** Человекочитаемое сообщение об ошибке */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
