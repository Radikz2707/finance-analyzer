/**
 * AutoRepairAgent — агент диагностики и авто-ремонта проекта.
 *
 * Диагностирует типовые проблемы проекта БЕЗ сети (только файловая система):
 * - deps: `node_modules` отсутствует/пуст; package-lock.json отсутствует
 *   или невалиден (актуальность lock-файла без сети не проверить —
 *   ограничение зафиксировано, проверяется наличие и валидный JSON);
 * - configs: package.json невалиден (авто-пересоздание ЗАПРЕЩЕНО — только
 *   диагностика с fixable:false); .env отсутствует при наличии .env.template;
 *   JSON-файлы модулей (data/*.json) невалидны;
 * - integrity: обязательные пути проекта (src/js/app.ts, src/index.html,
 *   gulpfile.js) существуют; отчётные файлы report.html/report.md —
 *   необязательны (инфо);
 * - history: старые/большие *.log файлы (по размеру) — инфо-чекер.
 *
 * Авто-ремонт (только при `autoFix: true`):
 * - `.env` восстанавливается из `.env.template` (копия, с бэкапом `.bak`
 *   существующей цели — стиль ConfigAgent);
 * - невалидные data/*.json пересоздаются как `{}` (бэкап `.bak` ДО записи);
 * - удалённые файлы восстанавливаются из git (`git checkout -- <path>`
 *   через DI-терминал, ТОЛЬКО для путей под контролем git, см. `gitAvailable`);
 * - `npm install` формируется для отсутствующего node_modules/lock-файла
 *   и выполняется через DI-терминал (не напрямую child_process).
 *
 * Безопасность:
 * - все пути резолвятся ТОЛЬКО внутри разрешённых корней (переиспользуется
 *   `isInside` из [`file-agent.ts`](file-agent.ts));
 * - авто-обновление зависимостей (`npm update`) НЕ выполняется автоматически
 *   (рискованно): чекер лишь предлагает команду — ограничение зафиксировано;
 * - npm/git-команды только формируются, выполняются исключительно через
 *   инжектируемый терминал (`terminal`), по умолчанию — внутренний
 *   TerminalAgent (whitelist npm/git; подкоманда git `checkout` в дефолтный
 *   whitelist TerminalAgent не входит — для git-восстановления в проде нужен
 *   терминал, разрешающий checkout, либо DI-мок в тестах);
 * - каждый чекер изолирован try/catch: падение одного не роняет остальные.
 *
 * Экспорт из [`agents/index.ts`](index.ts). Тесты:
 * [`auto-repair-agent.test.ts`](auto-repair-agent.test.ts) — temp-директории,
 * DI-моки терминала, без реального npm/git.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import type { AgentActionInput } from '../agent/agent-contract.js';
import { isInside } from './file-agent.js';
import type { TerminalLike } from './package-agent.js';
import { TerminalAgent } from './terminal-agent.js';

// ──────────────────────────────────────────────
// 1. Типы AutoRepairAgent
// ──────────────────────────────────────────────

/** Действие, выполняемое агентом */
export type AutoRepairAction = 'diagnose' | 'repair' | 'health';

/** Область диагностики (project = все области) */
export type AutoRepairScope = 'project' | 'deps' | 'configs' | 'integrity';

/** Серьёзность проверки */
export type RepairSeverity = 'info' | 'warning' | 'error';

/** Агрегированный статус health-отчёта */
export type HealthStatus = 'ok' | 'warnings' | 'critical';

/** Тип исправления */
export type RepairFixKind =
  | 'terminal' // выполнить команду через DI-терминал
  | 'git-checkout' // восстановить файл из git
  | 'file-copy' // скопировать source → target (с бэкапом цели)
  | 'file-recreate'; // пересоздать target с содержимым content (с бэкапом)

/** План исправления (применяется только при autoFix: true) */
export interface RepairFix {
  /** Тип исправления */
  kind: RepairFixKind;
  /** Человекочитаемое описание (для отчётов и логов) */
  description: string;
  /** Команда для terminal/git-checkout (по умолчанию npm/git) */
  command?: string;
  /** Аргументы команды */
  args?: string[];
  /** Источник для file-copy (относительный путь внутри корня) */
  source?: string;
  /** Цель: относительный путь внутри корня (file-copy/file-recreate/git-checkout) */
  target?: string;
  /** Содержимое для file-recreate (по умолчанию '{}') */
  content?: string;
}

/** Результат одной проверки */
export interface HealthCheckResult {
  /** Уникальный id проверки (например, deps.node-modules) */
  id: string;
  severity: RepairSeverity;
  /** Краткий заголовок */
  title: string;
  /** Детали (путь, размер, причина) */
  detail?: string;
  /** Можно ли исправить автоматически */
  fixable: boolean;
  /** План исправления (если fixable) */
  fix?: RepairFix;
}

/**
 * Входные данные AutoRepairAgent.
 * Расширяет единый стандарт входа action-агента `AgentActionInput`.
 */
export interface AutoRepairInput extends AgentActionInput<AutoRepairAction> {
  /** Область диагностики (по умолчанию project — все области) */
  scope?: AutoRepairScope;
  /** Применять ли исправления при repair (по умолчанию false) */
  autoFix?: boolean;
}

/** Выходные данные AutoRepairAgent */
export interface AutoRepairOutput {
  action: AutoRepairAction;
  /** Фактическая область (после нормализации входа) */
  scope: AutoRepairScope;
  /** Результаты всех выполненных проверок */
  checks: HealthCheckResult[];
  /** Агрегированный статус (error → critical, warning → warnings, иначе ok) */
  overall: HealthStatus;
  /** Применённые исправления (описания) — только repair + autoFix */
  appliedFixes: string[];
  /** Заблокированные исправления: не применены (нет autoFix / ошибка выполнения) */
  blockedFixes: string[];
  /** Человекочитаемое описание результата */
  message: string;
}

/** Минимальный контракт файловых операций для DI и тестов */
export interface FileOpsLike {
  /** Существует ли путь (файл или директория) */
  exists(target: string): boolean;
  /** Является ли путь файлом */
  isFile(target: string): boolean;
  /** Является ли путь директорией */
  isDirectory(target: string): boolean;
  /** Чтение текстового файла (UTF-8) */
  readText(target: string): string;
  /** Запись текстового файла (UTF-8, создаёт родительские директории) */
  writeText(target: string, content: string): void;
  /** Копирование файла */
  copy(source: string, target: string): void;
  /** Создание директории (рекурсивно) */
  mkdir(target: string): void;
  /** Непосредственные записи директории (абсолютные пути) */
  listEntries(target: string): string[];
  /** Все файлы под корнем рекурсивно (абсолютные пути, служебные каталоги пропускаются) */
  walkFiles(root: string): string[];
  /** Размер файла в байтах (null, если недоступен) */
  statSize(target: string): number | null;
}

/** Контекст, передаваемый чекерам */
export interface AutoRepairContext {
  /** Первый корень агента (абсолютный путь) */
  root: string;
  /** Доступен ли git (для git-checkout фиксов) */
  gitAvailable: boolean;
  /** Файловые операции (DI) */
  fileOps: FileOpsLike;
  /** Порог размера лога для истории (байт) */
  logSizeThresholdBytes: number;
}

/** Чекер диагностики (встроенный или пользовательский) */
export interface HealthChecker {
  /** Уникальный id чекера */
  id: string;
  /** Выполнить проверку; результат — массив проверок (может быть пустым) */
  run(ctx: AutoRepairContext): HealthCheckResult[];
}

/** Опции конфигурации AutoRepairAgent */
export interface AutoRepairAgentOptions {
  /** Разрешённые корни (по умолчанию — process.cwd()) */
  roots?: string[];
  /** Файловые операции (для тестов/DI); по умолчанию — реализация на fs */
  fileOps?: FileOpsLike;
  /** Терминал для выполнения команд (для тестов/DI); по умолчанию — внутренний TerminalAgent */
  terminal?: TerminalLike;
  /**
   * Доступен ли git. По умолчанию определяется по наличию `.git` в корне.
   * Явное значение нужно для тестов на temp-директориях без реального git.
   */
  gitAvailable?: boolean;
  /** Порог размера логов для history-чекера (байт, по умолчанию 10 МБ) */
  logSizeThresholdBytes?: number;
  /** Дополнительные пользовательские чекеры (выполняются после встроенных) */
  checkers?: HealthChecker[];
}

// ──────────────────────────────────────────────
// 2. Константы
// ──────────────────────────────────────────────

/** Обязательные пути проекта (integrity) */
const REQUIRED_PATHS: readonly string[] = [
  'src/js/app.ts',
  'src/index.html',
  'gulpfile.js',
];

/** Отчётные файлы (необязательны, инфо) */
const REPORT_PATHS: readonly string[] = ['report.html', 'report.md'];

/** Порог размера лога по умолчанию — 10 МБ */
const DEFAULT_LOG_THRESHOLD_BYTES = 10 * 1024 * 1024;

/** Служебные каталоги, исключаемые из рекурсивного обхода */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'archives',
  'coverage',
  '.audit',
]);

/** Какие чекеры относятся к какой области */
const SCOPE_CHECKERS: Readonly<Record<AutoRepairScope, readonly string[]>> = {
  project: [
    'deps.node-modules',
    'deps.lock-file',
    'configs.package-json',
    'configs.env-file',
    'configs.data-json',
    'integrity.required-path',
    'integrity.report-files',
    'history.logs',
  ],
  deps: ['deps.node-modules', 'deps.lock-file'],
  configs: ['configs.package-json', 'configs.env-file', 'configs.data-json'],
  integrity: ['integrity.required-path', 'integrity.report-files'],
};

/** Таймаут npm-команд — дольше стандартных 60 с TerminalAgent */
const FIX_TIMEOUT_MS = 120_000;

// ──────────────────────────────────────────────
// 3. AutoRepairAgent
// ──────────────────────────────────────────────

/**
 * AutoRepairAgent — диагностика типовых проблем и безопасный авто-ремонт.
 */
export class AutoRepairAgent extends AgentBase {
  private readonly roots: string[];
  private readonly fileOps: FileOpsLike;
  private readonly terminal: TerminalLike;
  private readonly gitAvailable: boolean;
  private readonly logSizeThresholdBytes: number;
  private readonly customCheckers: HealthChecker[];

  private readonly builtInCheckers: readonly HealthChecker[] = [
    { id: 'deps.node-modules', run: (ctx) => this.checkNodeModules(ctx) },
    { id: 'deps.lock-file', run: (ctx) => this.checkLockFile(ctx) },
    { id: 'configs.package-json', run: (ctx) => this.checkPackageJson(ctx) },
    { id: 'configs.env-file', run: (ctx) => this.checkEnvFile(ctx) },
    { id: 'configs.data-json', run: (ctx) => this.checkDataJson(ctx) },
    {
      id: 'integrity.required-path',
      run: (ctx) => this.checkRequiredPaths(ctx),
    },
    { id: 'integrity.report-files', run: (ctx) => this.checkReportFiles(ctx) },
    { id: 'history.logs', run: (ctx) => this.checkLogs(ctx) },
  ];

  constructor(config?: AgentConfig, options?: AutoRepairAgentOptions) {
    super(config ?? { name: 'AutoRepairAgent' });
    const roots = options?.roots?.length ? options.roots : [process.cwd()];
    this.roots = roots.map((root) => path.resolve(root));
    this.fileOps = options?.fileOps ?? createFsFileOps();
    this.logSizeThresholdBytes =
      options?.logSizeThresholdBytes && options.logSizeThresholdBytes > 0
        ? options.logSizeThresholdBytes
        : DEFAULT_LOG_THRESHOLD_BYTES;

    const firstRoot = this.roots[0] ?? process.cwd();
    this.gitAvailable =
      options?.gitAvailable ??
      this.fileOps.exists(path.join(firstRoot, '.git'));
    this.customCheckers = options?.checkers ?? [];

    this.terminal =
      options?.terminal ??
      new TerminalAgent(
        { name: 'TerminalAgent' },
        {
          roots: this.roots,
          cwd: firstRoot,
          allowedCommands: ['npm', 'git'],
          defaultTimeoutMs: FIX_TIMEOUT_MS,
        },
      );
  }

  protected async executeInternal(input: unknown): Promise<AutoRepairOutput> {
    const parsed = parseInput(input);
    const autoFix = parsed.autoFix ?? false;
    const context: AutoRepairContext = {
      root: this.roots[0] ?? process.cwd(),
      gitAvailable: this.gitAvailable,
      fileOps: this.fileOps,
      logSizeThresholdBytes: this.logSizeThresholdBytes,
    };

    // 1. Диагностика: каждый чекер изолирован try/catch.
    const checks: HealthCheckResult[] = [];
    for (const checker of this.selectCheckers(parsed.scope)) {
      try {
        checks.push(...checker.run(context));
      } catch (err) {
        checks.push({
          id: `${checker.id}.failed`,
          severity: 'error',
          title: `Ошибка выполнения проверки «${checker.id}»`,
          detail: errorMessage(err),
          fixable: false,
        });
      }
    }

    // 2. Ремонт (только action=repair).
    const appliedFixes: string[] = [];
    const blockedFixes: string[] = [];
    if (parsed.action === 'repair') {
      for (const check of checks) {
        if (!check.fixable || !check.fix) {
          continue;
        }
        const label = fixLabel(check);
        if (!autoFix) {
          blockedFixes.push(`${label} (требует autoFix: true)`);
          continue;
        }
        const applied = await this.tryApplyFix(check, context);
        if (applied) {
          appliedFixes.push(label);
        } else {
          blockedFixes.push(`${label} (ошибка выполнения)`);
        }
      }
    }

    const overall = computeOverall(checks);
    return {
      action: parsed.action,
      scope: parsed.scope,
      checks,
      overall,
      appliedFixes,
      blockedFixes,
      message: formatMessage(
        parsed.action,
        parsed.scope,
        checks,
        overall,
        autoFix,
      ),
    };
  }

  // ── Отбор чекеров по области ──

  private selectCheckers(scope: AutoRepairScope): HealthChecker[] {
    const ids = new Set(SCOPE_CHECKERS[scope]);
    const selected = this.builtInCheckers.filter((checker) =>
      ids.has(checker.id),
    );
    // Пользовательские чекеры выполняются всегда (после встроенных).
    return [...selected, ...this.customCheckers];
  }

  // ── Чекер: зависимости ──

  private checkNodeModules(ctx: AutoRepairContext): HealthCheckResult[] {
    const dir = path.join(ctx.root, 'node_modules');
    const missing =
      !ctx.fileOps.exists(dir) ||
      (ctx.fileOps.isDirectory(dir) &&
        ctx.fileOps.listEntries(dir).length === 0);
    if (missing) {
      return [
        {
          id: 'deps.node-modules',
          severity: 'warning',
          title: 'node_modules отсутствует или пуст',
          detail: `Зависимости не установлены: ${dir}`,
          fixable: true,
          fix: {
            kind: 'terminal',
            command: 'npm',
            args: ['install'],
            description: 'npm install (установка зависимостей)',
          },
        },
      ];
    }
    return [
      {
        id: 'deps.node-modules',
        severity: 'info',
        title: 'node_modules присутствует',
        detail: dir,
        fixable: false,
      },
    ];
  }

  private checkLockFile(ctx: AutoRepairContext): HealthCheckResult[] {
    const pkg = path.join(ctx.root, 'package.json');
    const lock = path.join(ctx.root, 'package-lock.json');
    if (!ctx.fileOps.exists(pkg)) {
      // package.json отсутствует — диагностируется чекером configs.package-json.
      return [];
    }
    const fix: RepairFix = {
      kind: 'terminal',
      command: 'npm',
      args: ['install'],
      description: 'npm install (синхронизация package-lock.json)',
    };
    if (!ctx.fileOps.exists(lock)) {
      return [
        {
          id: 'deps.lock-file',
          severity: 'warning',
          title: 'package-lock.json отсутствует',
          detail:
            'Актуальность lock-файла без сети не проверить — достаточно наличия и валидного JSON',
          fixable: true,
          fix,
        },
      ];
    }
    try {
      JSON.parse(ctx.fileOps.readText(lock));
    } catch (err) {
      return [
        {
          id: 'deps.lock-file',
          severity: 'warning',
          title: 'package-lock.json невалиден',
          detail: errorMessage(err),
          fixable: true,
          fix,
        },
      ];
    }
    return [
      {
        id: 'deps.lock-file',
        severity: 'info',
        title: 'package-lock.json присутствует и валиден',
        fixable: false,
      },
    ];
  }

  // ── Чекер: конфиги ──

  private checkPackageJson(ctx: AutoRepairContext): HealthCheckResult[] {
    const pkg = path.join(ctx.root, 'package.json');
    if (!ctx.fileOps.exists(pkg)) {
      return [
        {
          id: 'configs.package-json',
          severity: 'error',
          title: 'package.json отсутствует',
          detail: 'Восстановите файл из git или создайте вручную',
          fixable: false,
        },
      ];
    }
    try {
      JSON.parse(ctx.fileOps.readText(pkg));
    } catch (err) {
      return [
        {
          id: 'configs.package-json',
          severity: 'error',
          title: 'package.json невалидный JSON',
          detail:
            `${errorMessage(err)}. Авто-пересоздание package.json опасно — ` +
            'восстановите из git (git checkout -- package.json) или исправьте вручную',
          fixable: false,
        },
      ];
    }
    return [
      {
        id: 'configs.package-json',
        severity: 'info',
        title: 'package.json валиден',
        fixable: false,
      },
    ];
  }

  private checkEnvFile(ctx: AutoRepairContext): HealthCheckResult[] {
    const template = path.join(ctx.root, '.env.template');
    const env = path.join(ctx.root, '.env');
    if (!ctx.fileOps.exists(template)) {
      // Шаблона нет — проверка неприменима.
      return [];
    }
    if (!ctx.fileOps.exists(env)) {
      return [
        {
          id: 'configs.env-file',
          severity: 'warning',
          title: '.env отсутствует при наличии .env.template',
          detail: `${env} — создайте из шаблона`,
          fixable: true,
          fix: {
            kind: 'file-copy',
            source: '.env.template',
            target: '.env',
            description: 'Создать .env из .env.template',
          },
        },
      ];
    }
    return [
      {
        id: 'configs.env-file',
        severity: 'info',
        title: '.env присутствует',
        fixable: false,
      },
    ];
  }

  private checkDataJson(ctx: AutoRepairContext): HealthCheckResult[] {
    const dataDir = path.join(ctx.root, 'data');
    if (!ctx.fileOps.isDirectory(dataDir)) {
      return [];
    }
    const files = ctx.fileOps
      .walkFiles(dataDir)
      .filter((file) => file.toLowerCase().endsWith('.json'));
    if (files.length === 0) {
      return [];
    }
    const results: HealthCheckResult[] = [];
    for (const file of files) {
      const rel = toPosix(path.relative(ctx.root, file));
      try {
        JSON.parse(ctx.fileOps.readText(file));
      } catch (err) {
        results.push({
          id: 'configs.data-json',
          severity: 'error',
          title: `Невалидный JSON: ${rel}`,
          detail: errorMessage(err),
          fixable: true,
          fix: {
            kind: 'file-recreate',
            target: rel,
            content: '{}',
            description: `Пересоздать ${rel} (бэкап .bak + пустой объект {})`,
          },
        });
      }
    }
    if (results.length > 0) {
      return results;
    }
    return [
      {
        id: 'configs.data-json',
        severity: 'info',
        title: `JSON-файлы data валидны (${files.length})`,
        fixable: false,
      },
    ];
  }

  // ── Чекер: целостность проекта ──

  private checkRequiredPaths(ctx: AutoRepairContext): HealthCheckResult[] {
    const results: HealthCheckResult[] = [];
    for (const rel of REQUIRED_PATHS) {
      const abs = path.join(ctx.root, rel);
      if (ctx.fileOps.exists(abs)) {
        results.push({
          id: 'integrity.required-path',
          severity: 'info',
          title: `Обязательный путь присутствует: ${rel}`,
          fixable: false,
        });
        continue;
      }
      const fix: RepairFix | undefined = ctx.gitAvailable
        ? {
            kind: 'git-checkout',
            command: 'git',
            args: ['checkout', '--', rel],
            target: rel,
            description: `git checkout -- ${rel}`,
          }
        : undefined;
      results.push({
        id: 'integrity.required-path',
        severity: 'error',
        title: `Обязательный файл удалён: ${rel}`,
        detail: ctx.gitAvailable
          ? `Файл под контролем git — можно восстановить: git checkout -- ${rel}`
          : 'Файл не под контролем git — восстановите вручную',
        fixable: ctx.gitAvailable,
        fix,
      });
    }
    return results;
  }

  private checkReportFiles(ctx: AutoRepairContext): HealthCheckResult[] {
    const results: HealthCheckResult[] = [];
    for (const rel of REPORT_PATHS) {
      const abs = path.join(ctx.root, rel);
      if (ctx.fileOps.exists(abs)) {
        results.push({
          id: 'integrity.report-files',
          severity: 'info',
          title: `Отчётный файл присутствует: ${rel}`,
          fixable: false,
        });
        continue;
      }
      results.push({
        id: 'integrity.report-files',
        severity: 'info',
        title: `Отчётный файл отсутствует: ${rel}`,
        detail: 'Файл необязателен — генерируется при запуске',
        fixable: false,
      });
    }
    return results;
  }

  // ── Чекер: история/логи ──

  private checkLogs(ctx: AutoRepairContext): HealthCheckResult[] {
    const logs = ctx.fileOps
      .walkFiles(ctx.root)
      .filter((file) => file.toLowerCase().endsWith('.log'));
    const big: Array<{ file: string; size: number }> = [];
    for (const file of logs) {
      const size = ctx.fileOps.statSize(file);
      if (size !== null && size > ctx.logSizeThresholdBytes) {
        big.push({ file, size });
      }
    }
    if (big.length === 0) {
      return [
        {
          id: 'history.logs',
          severity: 'info',
          title: 'Больших логов нет',
          fixable: false,
        },
      ];
    }
    return big.map(({ file, size }) => ({
      id: 'history.logs',
      severity: 'info',
      title: `Большой лог: ${toPosix(path.relative(ctx.root, file))}`,
      detail: `${formatMb(size)} — проверьте и очистите вручную`,
      fixable: false,
    }));
  }

  // ── Применение исправлений ──

  private async tryApplyFix(
    check: HealthCheckResult,
    ctx: AutoRepairContext,
  ): Promise<boolean> {
    const fix = check.fix;
    if (!fix) {
      return false;
    }
    try {
      switch (fix.kind) {
        case 'file-copy': {
          const source = this.resolveSafe(fix.source ?? '');
          const target = this.resolveSafe(fix.target ?? '');
          this.backupIfExists(ctx, target);
          ctx.fileOps.mkdir(path.dirname(target));
          ctx.fileOps.copy(source, target);
          return true;
        }
        case 'file-recreate': {
          const target = this.resolveSafe(fix.target ?? '');
          this.backupIfExists(ctx, target);
          ctx.fileOps.mkdir(path.dirname(target));
          ctx.fileOps.writeText(target, fix.content ?? '{}');
          return true;
        }
        case 'terminal':
        case 'git-checkout': {
          const result = await this.terminal.execute({
            command:
              fix.command ?? (fix.kind === 'git-checkout' ? 'git' : 'npm'),
            args: fix.args ?? [],
          });
          return result.success === true;
        }
        default: {
          const exhaustive: never = fix.kind;
          throw new Error(`Неизвестный тип исправления: ${String(exhaustive)}`);
        }
      }
    } catch {
      return false;
    }
  }

  /** Бэкап существующей цели в `<target>.bak` (стиль ConfigAgent) */
  private backupIfExists(ctx: AutoRepairContext, target: string): void {
    if (!ctx.fileOps.exists(target)) {
      return;
    }
    const backup = `${target}.bak`;
    try {
      ctx.fileOps.copy(target, backup);
    } catch {
      // Не удалось создать бэкап — не блокируем исправление.
    }
  }

  // ── Резолв путей (безопасность, как в FileAgent) ──

  private resolveSafe(rawPath: string): string {
    const root = this.roots[0];
    if (!root) {
      throw new Error('AutoRepairAgent: не настроен корень операций');
    }
    const trimmed = rawPath.trim();
    if (trimmed === '') {
      throw new Error('AutoRepairAgent: путь не указан');
    }
    if (path.isAbsolute(trimmed)) {
      const resolved = path.normalize(trimmed);
      const inside = this.roots.some((entry) => isInside(entry, resolved));
      if (!inside) {
        throw new Error(
          `AutoRepairAgent: путь вне разрешённых корней: ${resolved}`,
        );
      }
      return resolved;
    }
    const resolved = path.resolve(root, trimmed);
    if (!isInside(root, resolved)) {
      throw new Error(`AutoRepairAgent: выход за пределы корня: ${trimmed}`);
    }
    return resolved;
  }
}

// ──────────────────────────────────────────────
// 4. Утилиты (экспортируются для тестов)
// ──────────────────────────────────────────────

/**
 * Реализация FileOpsLike на основе fs (по умолчанию).
 * Публичная фабрика — переиспользуется в тестах и DI-обёртках.
 */
export function createFsFileOps(): FileOpsLike {
  return {
    exists: (target) => fs.existsSync(target),
    isFile: (target) => {
      try {
        return fs.statSync(target).isFile();
      } catch {
        return false;
      }
    },
    isDirectory: (target) => {
      try {
        return fs.statSync(target).isDirectory();
      } catch {
        return false;
      }
    },
    readText: (target) => fs.readFileSync(target, 'utf-8'),
    writeText: (target, content) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf-8');
    },
    copy: (source, target) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    },
    mkdir: (target) => fs.mkdirSync(target, { recursive: true }),
    listEntries: (target) =>
      fs
        .readdirSync(target, { withFileTypes: true })
        .map((entry) => path.join(target, entry.name)),
    walkFiles: (root) => {
      const out: string[] = [];
      const visit = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) {
              continue;
            }
            visit(path.join(dir, entry.name));
          } else if (entry.isFile()) {
            out.push(path.join(dir, entry.name));
          }
        }
      };
      if (fs.existsSync(root)) {
        visit(root);
      }
      return out;
    },
    statSize: (target) => {
      try {
        return fs.statSync(target).size;
      } catch {
        return null;
      }
    },
  };
}

/** Нормализованный входной объект */
interface ParsedInput {
  action: AutoRepairAction;
  scope: AutoRepairScope;
  autoFix: boolean;
}

const ACTIONS: readonly AutoRepairAction[] = ['diagnose', 'repair', 'health'];

const SCOPES: readonly AutoRepairScope[] = [
  'project',
  'deps',
  'configs',
  'integrity',
];

function parseInput(input: unknown): ParsedInput {
  if (!input || typeof input !== 'object') {
    throw new Error('AutoRepairAgent: входные данные отсутствуют');
  }
  const raw = input as Partial<AutoRepairInput>;
  if (!raw.action || !ACTIONS.includes(raw.action)) {
    throw new Error(
      'AutoRepairAgent: не указано или неизвестно действие (action)',
    );
  }
  const scope = raw.scope ?? 'project';
  if (!SCOPES.includes(scope)) {
    throw new Error(
      `AutoRepairAgent: неизвестная область диагностики: ${scope}`,
    );
  }
  return {
    action: raw.action,
    scope,
    autoFix: raw.autoFix ?? false,
  };
}

/** Агрегированный статус: error → critical, warning → warnings, иначе ok */
function computeOverall(checks: readonly HealthCheckResult[]): HealthStatus {
  if (checks.some((check) => check.severity === 'error')) {
    return 'critical';
  }
  if (checks.some((check) => check.severity === 'warning')) {
    return 'warnings';
  }
  return 'ok';
}

/** Человекочитаемая подпись исправления */
function fixLabel(check: HealthCheckResult): string {
  return check.fix?.description ?? `${check.id}: ${check.title}`;
}

/** Итоговое сообщение */
function formatMessage(
  action: AutoRepairAction,
  scope: AutoRepairScope,
  checks: readonly HealthCheckResult[],
  overall: HealthStatus,
  autoFix: boolean,
): string {
  const errors = checks.filter((c) => c.severity === 'error').length;
  const warnings = checks.filter((c) => c.severity === 'warning').length;
  const base =
    `${action} (${scope}): ${checks.length} проверок, ` +
    `ошибок ${errors}, предупреждений ${warnings}, overall=${overall}`;
  if (action === 'repair' && !autoFix) {
    return `${base}. Исправления не применялись — включите autoFix: true`;
  }
  return base;
}

/** Нормализует разделители пути в "/" (для стабильных отчётов) */
function toPosix(target: string): string {
  return target.split(path.sep).join('/');
}

/** Текст ошибки (устойчиво к не-Error значениям) */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Размер в мегабайтах (1 знак после запятой) */
function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
