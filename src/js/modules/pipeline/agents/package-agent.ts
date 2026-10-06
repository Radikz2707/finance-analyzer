/**
 * PackageAgent — агент управления зависимостями.
 *
 * Высокоуровневая обёртка над npm/pip поверх TerminalAgent:
 * - install / update / uninstall — команды формируются здесь, а ВЫПОЛНЯЮТСЯ
 *   только через TerminalAgent (danger-правила whitelist/blacklist применяются
 *   автоматически; child_process напрямую не вызывается);
 * - check-conflicts — статический (БЕЗ сети) анализ манифестов:
 *   * package.json: пакет в dependencies и devDependencies с разными
 *     диапазонами → error; с одинаковыми → warning (дублирование);
 *     несоответствие peerDependencies → warning (полный semver-интерсект
 *     невозможен без резолвера/сети — ограничение зафиксировано в коде);
 *   * requirements.txt: дублирующиеся записи пакета (разные спецификаторы →
 *     error, одинаковые → warning);
 * - resolve-conflicts — детерминированное «простое слияние»: пакет остаётся
 *   в одной секции с новейшим диапазоном (сравнение максимальных версий —
 *   эвристика, не полный semver-резолвер). npm в фоне НЕ запускается:
 *   предлагается команда `npm install` для синхронизации lock-файла;
 * - dryRun = true по умолчанию: без явного `dryRun: false` агент ничего
 *   не изменяет и не выполняет, возвращая план команд.
 *
 * Безопасность:
 * - все команды идут через TerminalAgent (whitelist npm/pip + blacklist);
 * - чтение/запись манифестов — только файлы package.json/requirements.txt
 *   в корне разрешённых директорий (валидация путей как в FileAgent);
 * - при error-конфликтах мутации манифеста (npm install/update) блокируются
 *   до resolve-conflicts (dryRun при этом разрешён и возвращает план).
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig, AgentResult } from '../agent/types.js';
import type { AgentActionInput } from '../agent/agent-contract.js';
import { isInside } from './file-agent.js';
import { TerminalAgent } from './terminal-agent.js';

// ──────────────────────────────────────────────
// 1. Типы PackageAgent
// ──────────────────────────────────────────────

/** Действие, выполняемое агентом */
export type PackageAction =
  'install' | 'update' | 'uninstall' | 'check-conflicts' | 'resolve-conflicts';

/** Менеджер зависимостей */
export type PackageManager = 'npm' | 'pip';

/**
 * Входные данные PackageAgent.
 * Расширяет единый стандарт входа action-агента `AgentActionInput`.
 */
export interface PackageAgentInput extends AgentActionInput<PackageAction> {
  /** Имена пакетов (для install/update/uninstall) */
  packages?: string[];
  /** Менеджер зависимостей (по умолчанию 'npm') */
  manager?: PackageManager;
  /** Сохранить как devDependency (npm install/uninstall --save-dev) */
  dev?: boolean;
  /**
   * Сухой прогон. По умолчанию true: ничего не меняется и не выполняется,
   * возвращается план команд. Для реального применения — dryRun: false.
   */
  dryRun?: boolean;
  /** Рабочая директория (относительно корня или абсолютная, внутри корней) */
  cwd?: string;
}

/** Конфликт версий между секциями манифеста */
export interface PackageConflict {
  /** Имя пакета */
  name: string;
  /** Первая секция (dependencies / devDependencies / peerDependencies / requirements.txt) */
  sectionA: string;
  /** Вторая секция */
  sectionB: string;
  /** Диапазон в первой секции */
  rangeA: string;
  /** Диапазон во второй секции */
  rangeB: string;
  /** Серьёзность: error — требует решения, warning — замечание/ограничение статики */
  severity: 'warning' | 'error';
  /** Как разрешён конфликт (заполняется resolve-conflicts) */
  resolution?: string;
}

/** Выходные данные PackageAgent */
export interface PackageAgentOutput {
  action: PackageAction;
  manager: PackageManager;
  /** Сформированные командные строки (для dryRun — план, иначе — выполненные) */
  commands: string[];
  /** Конфликты, найденные статическим анализом манифеста */
  conflicts: PackageConflict[];
  /** Конфликты, разрешённые merge-стратегией (только resolve-conflicts) */
  resolved?: PackageConflict[];
  /** Менялись ли файлы/выполнялись ли команды */
  changed: boolean;
  /** Человекочитаемое описание результата */
  message: string;
}

/** Минимальный контракт терминала для DI и тестов */
export interface TerminalLike {
  execute(input: unknown): Promise<AgentResult>;
}

/** Опции конфигурации PackageAgent */
export interface PackageAgentOptions {
  /** Разрешённые корни (по умолчанию — process.cwd()) */
  roots?: string[];
  /** Готовый терминал (для тестов/DI); по умолчанию создаётся внутренний TerminalAgent */
  terminal?: TerminalLike;
}

/** Действия, меняющие зависимости (манифест/окружение) */
type PackageMutationAction = 'install' | 'update' | 'uninstall';

/** Внутренний нормализованный вход */
interface NormalizedInput {
  action: PackageAction;
  manager: PackageManager;
  packages: string[];
  dev: boolean;
  dryRun: boolean;
  cwd: string | undefined;
}

// ──────────────────────────────────────────────
// 2. Константы
// ──────────────────────────────────────────────

const PACKAGE_MANIFEST = 'package.json';
const PIP_MANIFEST = 'requirements.txt';
const MANIFEST_NAMES: ReadonlySet<string> = new Set([
  PACKAGE_MANIFEST,
  PIP_MANIFEST,
]);

const PACKAGE_ACTIONS: readonly PackageAction[] = [
  'install',
  'update',
  'uninstall',
  'check-conflicts',
  'resolve-conflicts',
];

const PACKAGE_MANAGERS: readonly string[] = ['npm', 'pip'];

/** Секции package.json, участвующие в статическом анализе */
const NPM_SECTIONS: readonly string[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
];

/** Запрещённые символы инъекций в именах пакетов (см. TerminalAgent) */
const PACKAGE_INVALID_CHARS = /[;|&`]|\$\s*\(|\$\{|%0a|%0d|\r|\n/;

/** Таймаут для установки пакетов — дольше стандартных 60с TerminalAgent */
const INSTALL_TIMEOUT_MS = 120_000;

// ──────────────────────────────────────────────
// 3. PackageAgent
// ──────────────────────────────────────────────

/**
 * PackageAgent — управление зависимостями npm/pip с проверкой конфликтов.
 */
export class PackageAgent extends AgentBase {
  private readonly roots: string[];
  private readonly terminal: TerminalLike;

  constructor(config?: AgentConfig, options?: PackageAgentOptions) {
    super(config ?? { name: 'PackageAgent' });
    const roots = options?.roots?.length ? options.roots : [process.cwd()];
    this.roots = roots.map((root) => path.resolve(root));

    this.terminal =
      options?.terminal ??
      new TerminalAgent(
        { name: 'TerminalAgent' },
        {
          roots: this.roots,
          cwd: this.roots[0] ?? process.cwd(),
          allowedCommands: ['pip'],
          defaultTimeoutMs: INSTALL_TIMEOUT_MS,
        },
      );
  }

  protected async executeInternal(input: unknown): Promise<PackageAgentOutput> {
    const parsed = parseInput(input);
    const cwd = this.resolveCwd(parsed.cwd);

    switch (parsed.action) {
      case 'check-conflicts': {
        const conflicts = this.checkConflicts(parsed.manager, cwd);
        return {
          action: parsed.action,
          manager: parsed.manager,
          commands: [],
          conflicts,
          changed: false,
          message: formatConflictSummary(conflicts),
        };
      }
      case 'resolve-conflicts':
        return this.resolveConflicts(parsed.manager, cwd, parsed.dryRun);
      case 'install':
      case 'update':
      case 'uninstall':
        return this.runPackageCommand(parsed, cwd, parsed.dryRun);
      default: {
        const exhaustive: never = parsed.action;
        throw new Error(
          `PackageAgent: неизвестное действие ${String(exhaustive)}`,
        );
      }
    }
  }

  // ── Проверка конфликтов (статическая, без сети) ──

  private checkConflicts(
    manager: PackageManager,
    cwd: string,
  ): PackageConflict[] {
    if (manager === 'npm') {
      const manifest = this.readPackageJson(cwd);
      return collectNpmConflicts(manifest);
    }
    const content = this.readRequirementsTxt(cwd);
    return collectPipConflicts(content);
  }

  // ── Разрешение конфликтов (детерминированное слияние) ──

  private resolveConflicts(
    manager: PackageManager,
    cwd: string,
    dryRun: boolean,
  ): PackageAgentOutput {
    if (manager === 'pip') {
      // Ограничение: у requirements.txt нет «секций», авто-слияние неприменимо.
      const content = this.readRequirementsTxt(cwd);
      const conflicts = collectPipConflicts(content);
      return {
        action: 'resolve-conflicts',
        manager,
        commands: [],
        conflicts,
        changed: false,
        message:
          'Авто-решение конфликтов requirements.txt не поддерживается ' +
          '(нет секций манифеста): устраните дублирующиеся записи вручную.',
      };
    }

    const manifest = this.readPackageJson(cwd);
    const conflicts = collectNpmConflicts(manifest);
    const { merged, resolved, unresolved } = resolveNpmConflicts(
      manifest,
      conflicts,
    );
    const commands = resolved.length > 0 ? ['npm install'] : [];

    if (dryRun) {
      return {
        action: 'resolve-conflicts',
        manager: 'npm',
        commands,
        conflicts,
        resolved,
        changed: false,
        message:
          `Предложено разрешение конфликтов: ${resolved.length} из ${conflicts.length}` +
          `${unresolved.length > 0 ? ` (неразрешённых: ${unresolved.length})` : ''}. ` +
          'Манифест не изменён (dry-run); примените с dryRun: false.',
      };
    }

    if (resolved.length > 0) {
      this.writePackageJson(cwd, merged);
    }
    return {
      action: 'resolve-conflicts',
      manager: 'npm',
      commands,
      conflicts,
      resolved,
      changed: resolved.length > 0,
      message:
        `Разрешено конфликтов: ${resolved.length} из ${conflicts.length}` +
        `${unresolved.length > 0 ? ` (неразрешённых: ${unresolved.length})` : ''}. ` +
        'Манифест обновлён; выполните `npm install` для синхронизации lock-файла ' +
        '(команда только предложена, не выполнена).',
    };
  }

  // ── Установка/обновление/удаление через TerminalAgent ──

  private async runPackageCommand(
    parsed: NormalizedInput,
    cwd: string,
    dryRun: boolean,
  ): Promise<PackageAgentOutput> {
    const { action, manager, packages, dev } = parsed;
    if (action !== 'install' && action !== 'update' && action !== 'uninstall') {
      throw new Error(
        `PackageAgent: внутренняя ошибка: действие ${String(action)} не является мутацией`,
      );
    }
    if (action === 'uninstall' && packages.length === 0) {
      throw new Error(
        'PackageAgent: для удаления требуется указать хотя бы один пакет',
      );
    }
    assertPackageNames(packages);

    const commands = [buildCommand(action, manager, packages, dev)];

    // Статическая проверка конфликтов ДО любых изменений.
    let conflicts: PackageConflict[] = [];
    let conflictsNote = '';
    if (manager === 'npm') {
      try {
        conflicts = collectNpmConflicts(this.readPackageJson(cwd));
      } catch (err) {
        conflictsNote = `; конфликты не проверялись: ${errorMessage(err)}`;
      }
    } else {
      try {
        conflicts = collectPipConflicts(this.readRequirementsTxt(cwd));
      } catch {
        // requirements.txt не обязателен для pip-команд
      }
    }

    // Блокировка опасных мутаций манифеста при error-конфликтах
    if (
      !dryRun &&
      manager === 'npm' &&
      (action === 'install' || action === 'update') &&
      conflicts.some((conflict) => conflict.severity === 'error')
    ) {
      throw new Error(
        'PackageAgent: в package.json обнаружены конфликты версий (error). ' +
          'Запустите resolve-conflicts или передайте dryRun: true для просмотра плана.',
      );
    }

    if (dryRun) {
      return {
        action,
        manager,
        commands,
        conflicts,
        changed: false,
        message: `План команд (dry-run): ${commands.join(' ; ')}. Изменения не вносились.${conflictsNote}`,
      };
    }

    await this.executeCommands(commands);
    return {
      action,
      manager,
      commands,
      conflicts,
      changed: true,
      message: `Выполнено: ${commands.join(' ; ')}.${conflictsNote}`,
    };
  }

  private async executeCommands(commands: string[]): Promise<void> {
    for (const command of commands) {
      const result = await this.terminal.execute(command);
      if (!result.success) {
        throw new Error(
          `PackageAgent: команда не выполнена: ${command}` +
            `${result.error ? ` — ${result.error.message}` : ''}`,
        );
      }
    }
  }

  // ── Работа с манифестами (защита путей как в FileAgent) ──

  /** Путь к манифесту внутри разрешённых корней; только корень проекта */
  private manifestPath(cwd: string, name: string): string {
    if (!MANIFEST_NAMES.has(name)) {
      throw new Error(`PackageAgent: недопустимое имя манифеста: ${name}`);
    }
    const target = path.resolve(cwd, name);
    if (!this.roots.some((root) => isInside(root, target))) {
      throw new Error(
        `PackageAgent: путь манифеста вне разрешённых корней: ${target}`,
      );
    }
    return target;
  }

  private readPackageJson(cwd: string): Record<string, unknown> {
    const target = this.manifestPath(cwd, PACKAGE_MANIFEST);
    if (!fs.existsSync(target)) {
      throw new Error(`PackageAgent: файл package.json не найден: ${target}`);
    }
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(target, 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('корень манифеста — не объект');
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `PackageAgent: не удалось разобрать package.json (${target}): ${errorMessage(err)}`,
        { cause: err },
      );
    }
  }

  private readRequirementsTxt(cwd: string): string {
    const target = this.manifestPath(cwd, PIP_MANIFEST);
    if (!fs.existsSync(target)) {
      throw new Error(
        `PackageAgent: файл requirements.txt не найден: ${target}`,
      );
    }
    return fs.readFileSync(target, 'utf-8');
  }

  private writePackageJson(
    cwd: string,
    manifest: Record<string, unknown>,
  ): void {
    const target = this.manifestPath(cwd, PACKAGE_MANIFEST);
    try {
      fs.writeFileSync(
        target,
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf-8',
      );
    } catch (err) {
      throw new Error(
        `PackageAgent: не удалось записать package.json (${target}): ${errorMessage(err)}`,
        { cause: err },
      );
    }
  }

  // ── Рабочая директория ──

  private resolveCwd(raw: string | undefined): string {
    const root = this.roots[0] ?? process.cwd();
    const requested = raw ? path.resolve(root, raw) : root;
    if (!this.roots.some((entry) => isInside(entry, requested))) {
      throw new Error(
        `PackageAgent: рабочая директория вне разрешённых корней: ${requested}`,
      );
    }
    return requested;
  }
}

// ──────────────────────────────────────────────
// 4. Внутренние типы и утилиты
// ──────────────────────────────────────────────

function isPackageAction(value: unknown): value is PackageAction {
  return (
    typeof value === 'string' &&
    (PACKAGE_ACTIONS as readonly string[]).includes(value)
  );
}

function parseInput(input: unknown): NormalizedInput {
  if (!input || typeof input !== 'object') {
    throw new Error('PackageAgent: входные данные отсутствуют');
  }
  const record = input as Record<string, unknown>;
  const rawAction = record['action'];
  if (!isPackageAction(rawAction)) {
    throw new Error(`PackageAgent: неизвестное действие: ${String(rawAction)}`);
  }
  const manager = normalizeManager(record['manager']);
  const rawPackages = record['packages'];
  const packages = Array.isArray(rawPackages)
    ? rawPackages
        .map((item) => String(item))
        .filter((item) => item.trim() !== '')
    : [];
  const dev = record['dev'] === true;
  // Безопасный режим по умолчанию: dryRun = true, пока явно не false
  const dryRun = record['dryRun'] !== false;
  const cwdRaw = record['cwd'];
  const cwd =
    typeof cwdRaw === 'string' && cwdRaw.trim() !== '' ? cwdRaw : undefined;
  return { action: rawAction, manager, packages, dev, dryRun, cwd };
}

function normalizeManager(value: unknown): PackageManager {
  if (value === undefined || value === null) return 'npm';
  if (
    typeof value === 'string' &&
    (PACKAGE_MANAGERS as readonly string[]).includes(value)
  ) {
    return value === 'pip' ? 'pip' : 'npm';
  }
  throw new Error(
    `PackageAgent: неизвестный менеджер: ${String(value)} (ожидается npm|pip)`,
  );
}

function assertPackageNames(packages: string[]): void {
  for (const pkg of packages) {
    if (pkg.startsWith('-')) {
      throw new Error(
        `PackageAgent: некорректное имя пакета (похоже на флаг): ${pkg}`,
      );
    }
    if (pkg.includes('\0') || PACKAGE_INVALID_CHARS.test(pkg)) {
      throw new Error(
        `PackageAgent: запрещённые символы в имени пакета: ${pkg}`,
      );
    }
  }
}

/** Формирует одну командную строку для действия */
function buildCommand(
  action: PackageMutationAction,
  manager: PackageManager,
  packages: string[],
  dev: boolean,
): string {
  if (manager === 'npm') {
    switch (action) {
      case 'install': {
        const args = [...packages];
        if (packages.length > 0 && dev) args.push('--save-dev');
        return ['npm', 'install', ...args].join(' ');
      }
      case 'update':
        return ['npm', 'update', ...packages].join(' ');
      case 'uninstall': {
        const args = [...packages];
        if (dev) args.push('--save-dev');
        return ['npm', 'uninstall', ...args].join(' ');
      }
    }
  }
  switch (action) {
    case 'install':
      return packages.length > 0
        ? ['pip', 'install', ...packages].join(' ')
        : 'pip install -r requirements.txt';
    case 'update':
      return packages.length > 0
        ? ['pip', 'install', '--upgrade', ...packages].join(' ')
        : 'pip install --upgrade -r requirements.txt';
    case 'uninstall':
      return ['pip', 'uninstall', '-y', ...packages].join(' ');
  }
}

// ── Статический анализ package.json ──

/**
 * Конфликты секций package.json:
 * - dependencies vs devDependencies: разные диапазоны → error;
 *   одинаковые → warning (дублирование; npm учитывает devDependencies);
 * - peerDependencies vs production-секция: разные диапазоны → warning
 *   (ОГРАНИЧЕНИЕ: точный semver-интерсект требует резолвера/сети, поэтому
 *   статически фиксируется только факт несовпадения строк);
 *   одинаковые → конфликта нет.
 */
function collectNpmConflicts(
  manifest: Record<string, unknown>,
): PackageConflict[] {
  const byName = new Map<string, Array<{ section: string; range: string }>>();
  for (const section of NPM_SECTIONS) {
    const record = asRecord(manifest[section]);
    for (const [name, value] of Object.entries(record)) {
      if (typeof value !== 'string') continue; // workspace:/file:/link: — вне статики
      const list = byName.get(name) ?? [];
      list.push({ section, range: value });
      byName.set(name, list);
    }
  }

  const conflicts: PackageConflict[] = [];
  for (const [name, list] of byName) {
    const dep = list.find((entry) => entry.section === 'dependencies');
    const dev = list.find((entry) => entry.section === 'devDependencies');
    const peer = list.find((entry) => entry.section === 'peerDependencies');

    if (dep && dev) {
      if (dep.range !== dev.range) {
        conflicts.push({
          name,
          sectionA: 'dependencies',
          sectionB: 'devDependencies',
          rangeA: dep.range,
          rangeB: dev.range,
          severity: 'error',
        });
      } else {
        conflicts.push({
          name,
          sectionA: 'dependencies',
          sectionB: 'devDependencies',
          rangeA: dep.range,
          rangeB: dev.range,
          severity: 'warning',
          resolution:
            'Дублирование с одинаковым диапазоном: npm при установке ' +
            'учитывает devDependencies. Рекомендуется оставить пакет в одной секции.',
        });
      }
    }

    const production = dep ?? dev;
    if (peer && production && peer.range !== production.range) {
      conflicts.push({
        name,
        sectionA: 'peerDependencies',
        sectionB: production.section,
        rangeA: peer.range,
        rangeB: production.range,
        severity: 'warning',
        resolution:
          'Статическая проверка peer-совместимости ограничена: точный ' +
          'semver-интерсект требует резолвера/сети. Требуется ручная проверка.',
      });
    }
    // peer.range === production.range → совместимо, конфликта нет
  }
  return conflicts;
}

// ── Статический анализ requirements.txt ──

/**
 * Дубликаты пакета в requirements.txt:
 * - разные спецификаторы → error (например, `numpy>=2.2,<3.0` и `numpy>=1.26`);
 * - одинаковые → warning (дублирующаяся строка).
 * Строки `-r`, `-e`, `--index-url` и комментарии пропускаются (ограничение статики).
 */
function collectPipConflicts(content: string): PackageConflict[] {
  const byName = new Map<string, Array<{ spec: string; line: number }>>();
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? '';
    line = line.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('-')) continue; // -r/-e/--index-url — вне статики
    const commentIdx = line.indexOf('#');
    if (commentIdx !== -1) line = line.slice(0, commentIdx).trim();
    if (line === '') continue;
    const match = line.match(/^([A-Za-z0-9._-]+)\s*(.*)$/);
    if (!match) continue;
    const name = match[1] ?? '';
    const spec = (match[2] ?? '').trim();
    const list = byName.get(name) ?? [];
    list.push({ spec, line: i + 1 });
    byName.set(name, list);
  }

  const conflicts: PackageConflict[] = [];
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    const unique = new Set(list.map((entry) => entry.spec));
    const first = list[0];
    const second = list.find((entry) => entry.spec !== first?.spec);
    if (unique.size > 1) {
      conflicts.push({
        name,
        sectionA: 'requirements.txt',
        sectionB: 'requirements.txt',
        rangeA: first?.spec ?? '',
        rangeB: second?.spec ?? '',
        severity: 'error',
        resolution:
          'Дубликат с разными спецификаторами: объедините в одну строку ' +
          'с совместимым диапазоном.',
      });
    } else {
      conflicts.push({
        name,
        sectionA: 'requirements.txt',
        sectionB: 'requirements.txt',
        rangeA: first?.spec ?? '',
        rangeB: first?.spec ?? '',
        severity: 'warning',
        resolution:
          'Дублирующаяся строка requirements.txt: оставьте одну запись.',
      });
    }
  }
  return conflicts;
}

// ── Детерминированное слияние конфликтов ──

interface ResolveResult {
  merged: Record<string, unknown>;
  resolved: PackageConflict[];
  unresolved: PackageConflict[];
}

/**
 * «Простое слияние»: пакет остаётся в одной секции (dependencies ИЛИ
 * devDependencies) с новейшим диапазоном; вторая запись удаляется.
 * Детерминированность:
 *  1) идентичные диапазоны → остаются в dependencies;
 *  2) иначе — побеждает диапазон с большей максимальной версией;
 *  3) равные максимумы → более длинная строка (специфичнее);
 *  4) тай-брейк → лексикографическое сравнение.
 * peer-предупреждения не разрешаются (ограничение статики) — попадают в unresolved.
 */
function resolveNpmConflicts(
  manifest: Record<string, unknown>,
  conflicts: PackageConflict[],
): ResolveResult {
  const merged = JSON.parse(JSON.stringify(manifest)) as Record<
    string,
    unknown
  >;
  const resolved: PackageConflict[] = [];
  const unresolved: PackageConflict[] = [];

  for (const conflict of conflicts) {
    const isProductionPair =
      conflict.sectionA === 'dependencies' &&
      conflict.sectionB === 'devDependencies';
    if (!isProductionPair) {
      unresolved.push(conflict);
      continue;
    }
    const { name, rangeA, rangeB } = conflict;
    const aWins = pickRange(rangeA, rangeB);
    const winnerSection = aWins ? conflict.sectionA : conflict.sectionB;
    const winnerRange = aWins ? rangeA : rangeB;
    const loserSection = aWins ? conflict.sectionB : conflict.sectionA;

    setManifestSectionEntry(merged, winnerSection, name, winnerRange);
    removeManifestSectionEntry(merged, loserSection, name);

    resolved.push({
      ...conflict,
      resolution:
        `Объединено в секцию «${winnerSection}» с диапазоном «${winnerRange}» ` +
        `(новейший); запись из «${loserSection}» удалена.`,
    });
  }

  return { merged, resolved, unresolved };
}

function setManifestSectionEntry(
  manifest: Record<string, unknown>,
  section: string,
  name: string,
  range: string,
): void {
  const current = asRecord(manifest[section]);
  current[name] = range;
  manifest[section] = current;
}

function removeManifestSectionEntry(
  manifest: Record<string, unknown>,
  section: string,
  name: string,
): void {
  const current = asRecord(manifest[section]);
  if (!(name in current)) return;
  delete current[name];
  if (Object.keys(current).length === 0) {
    delete manifest[section]; // секция опустела — убираем целиком
  } else {
    manifest[section] = current;
  }
}

/**
 * Детерминированный выбор победителя диапазона (true — побеждает a).
 * Эвристика «новейшего» диапазона: максимальная встречающаяся версия
 * major.minor.patch; это НЕ полный semver-резолвер (ограничение).
 */
function pickRange(a: string, b: string): boolean {
  if (a === b) return true; // идентичные диапазоны → dependencies (детерминированно)
  const comparison = compareRangeVersions(a, b);
  if (comparison !== 0) return comparison > 0;
  if (a.length !== b.length) return a.length > b.length;
  return a > b;
}

interface VersionTriple {
  major: number;
  minor: number;
  patch: number;
}

function compareRangeVersions(a: string, b: string): number {
  return compareTriple(maxVersionTriple(a), maxVersionTriple(b));
}

function compareTriple(a: VersionTriple, b: VersionTriple): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function maxVersionTriple(range: string): VersionTriple {
  let best: VersionTriple = { major: -1, minor: -1, patch: -1 };
  const pattern = /(\d+)\.(\d+)(?:\.(\d+))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(range)) !== null) {
    const majorText = match[1];
    const minorText = match[2];
    const patchText = match[3];
    if (majorText === undefined || minorText === undefined) continue;
    const triple: VersionTriple = {
      major: Number(majorText),
      minor: Number(minorText),
      patch: patchText === undefined ? 0 : Number(patchText),
    };
    if (compareTriple(triple, best) > 0) best = triple;
  }
  return best;
}

// ── Прочие утилиты ──

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function formatConflictSummary(conflicts: PackageConflict[]): string {
  if (conflicts.length === 0) {
    return 'Конфликты версий не обнаружены.';
  }
  const errors = conflicts.filter(
    (conflict) => conflict.severity === 'error',
  ).length;
  const warnings = conflicts.length - errors;
  return (
    `Конфликтов: ${conflicts.length} (ошибок: ${errors}, предупреждений: ${warnings}). ` +
    conflicts
      .map(
        (conflict) =>
          `${conflict.name}: ${conflict.sectionA} «${conflict.rangeA}» ↔ ${conflict.sectionB} «${conflict.rangeB}»`,
      )
      .join('; ')
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
