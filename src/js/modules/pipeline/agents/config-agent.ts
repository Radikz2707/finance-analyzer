/**
 * ConfigAgent — агент управления конфигурацией.
 *
 * Даёт Director'у безопасный доступ к JSON-конфигам проекта и файловой
 * части настроек VS Code:
 * - read / write — чтение и запись JSON-файлов (атомарно: temp-файл + rename);
 * - write c merge: true — глубокое слияние с существующим содержимым
 *   (2 уровня достаточно: ключи 1-го и 2-го уровней объединяются,
 *   более глубокие вложенности заменяются целиком; приоритет у новых ключей);
 * - export — копия нескольких конфигов в один файл (глубокое слияние
 *   источников в порядке перечисления, последний источник приоритетнее);
 * - import — применение JSON-данных из файла-источника в целевой конфиг
 *   с созданием резервной копии `.bak` ДО изменения (при ошибке применения
 *   бэкап восстанавливается);
 * - add-extension / remove-extension — рекомендации расширений VS Code
 *   в `.vscode/extensions.json` (`recommendations[]`);
 * - dryRun — вернуть план изменений без записи на диск.
 *
 * Настройка VS Code (файловая часть):
 * - `.vscode/settings.json` — те же read/write/merge общими функциями
 *   (специфики нет: это обычный JSON-конфиг в корне проекта; отсутствующий
 *   файл создаётся при записи);
 * - `.vscode/extensions.json` — рекомендации расширений (`recommendations[]`);
 * - ⚠️ ПРОФИЛИ VS Code НЕ реализуемы честно через файлы проекта: профили
 *   хранятся в пользовательском хранилище приложения (~/.vscode, state.vscdb),
 *   а не в `.vscode/` рабочей области. Ограничение зафиксировано — через
 *   файлы управляются только settings.json и extensions.json.
 *
 * Безопасность:
 * - все пути резолвятся ТОЛЬКО внутри разрешённых корней (переиспользуется
 *   `isInside` из [`file-agent.ts`](file-agent.ts) — общего хелпера изоляции);
 * - запись запрещена в системные пути (вне корней — блокируется резолвом),
 *   в `.git` и `node_modules` (deny-список по сегментам пути) и в сам корень;
 * - значения валидируются как JSON (примитивы/массивы/объекты; функции,
 *   undefined, bigint, NaN/Infinity и циклические ссылки → ошибка).
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import type { AgentActionInput } from '../agent/agent-contract.js';
import { isInside } from './file-agent.js';

// ──────────────────────────────────────────────
// 1. Типы ConfigAgent
// ──────────────────────────────────────────────

/** Действие, выполняемое агентом */
export type ConfigAgentAction =
  | 'read' // чтение JSON-конфига
  | 'write' // запись/создание JSON-конфига (с опциональным merge)
  | 'export' // копия нескольких конфигов в один файл
  | 'import' // применение JSON-данных в целевой конфиг (с .bak перед изменением)
  | 'add-extension' // добавить расширение в .vscode/extensions.json
  | 'remove-extension'; // удалить расширение из .vscode/extensions.json

/**
 * Входные данные ConfigAgent.
 * Расширяет единый стандарт входа action-агента `AgentActionInput`.
 */
export interface ConfigAgentInput extends AgentActionInput<ConfigAgentAction> {
  /**
   * Основной путь операции:
   * - read/write/add-extension/remove-extension — целевой файл;
   * - export — файл назначения (куда пишется объединённый конфиг);
   * - import — файл-источник (откуда читаются данные).
   */
  path?: string;
  /** Вторичный путь (для import — целевой конфиг, куда применяются данные) */
  toPath?: string;
  /**
   * Данные:
   * - write — JSON-значение для записи;
   * - export — путь (string) или массив путей (string[]) исходных конфигов;
   * - для read/import/add-extension/remove-extension не используется.
   */
  data?: unknown;
  /** Идентификатор расширения (publisher.name) для add/remove-extension */
  extensionId?: string;
  /** Глубокое слияние с существующим содержимым (2 уровня) при write/import */
  merge?: boolean;
  /** Сухой прогон: вернуть план изменений без записи на диск */
  dryRun?: boolean;
}

/** Выходные данные ConfigAgent */
export interface ConfigAgentOutput {
  action: ConfigAgentAction;
  /** Файл, с которым работал агент */
  path?: string;
  /**
   * Данные:
   * - read — прочитанный конфиг;
   * - write/export/import — итоговое значение (после merge, если он был).
   */
  data?: unknown;
  /** Были ли внесены изменения на диск */
  changed: boolean;
  /** Человекочитаемое описание результата */
  message: string;
  /** Путь к созданной резервной копии (.bak), если она создавалась */
  backupPath?: string;
}

/** Опции конфигурации ConfigAgent */
export interface ConfigAgentOptions {
  /** Разрешённые корни (по умолчанию — process.cwd()) */
  roots?: string[];
}

// ──────────────────────────────────────────────
// 2. Константы
// ──────────────────────────────────────────────

/** Путь настроек рабочей области VS Code (относительно корня) */
export const VSCodeSettingsPath = '.vscode/settings.json';

/** Путь рекомендаций расширений VS Code (относительно корня) */
export const VSCodeExtensionsPath = '.vscode/extensions.json';

/** Сегменты пути, запрещённые для записи */
const DEFAULT_DENY_LIST: readonly string[] = ['.git', 'node_modules'];

/** Глубина слияния: объединяются ключи 1-го и 2-го уровней */
const MERGE_MAX_DEPTH = 2;

/** Формат идентификатора расширения: publisher.name (с точкой) */
const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9._-]*$/i;

// ──────────────────────────────────────────────
// 3. ConfigAgent
// ──────────────────────────────────────────────

/**
 * ConfigAgent — безопасное управление JSON-конфигами и файловой частью
 * настроек VS Code (settings.json, extensions.json).
 */
export class ConfigAgent extends AgentBase {
  private readonly roots: string[];
  private readonly denyList: string[];

  constructor(config?: AgentConfig, options?: ConfigAgentOptions) {
    super(config ?? { name: 'ConfigAgent' });
    const roots = options?.roots?.length ? options.roots : [process.cwd()];
    this.roots = roots.map((root) => path.resolve(root));
    this.denyList = [...DEFAULT_DENY_LIST];
  }

  protected async executeInternal(input: unknown): Promise<ConfigAgentOutput> {
    if (!input || typeof input !== 'object') {
      throw new Error('ConfigAgent: входные данные отсутствуют');
    }
    const parsed = input as Partial<ConfigAgentInput>;
    const action = parsed.action;
    if (!action) {
      throw new Error('ConfigAgent: не указано действие (action)');
    }
    const merge = parsed.merge ?? false;
    const dryRun = parsed.dryRun ?? false;

    switch (action) {
      case 'read':
        return this.readJson(this.requirePath(parsed.path, 'read'));
      case 'write':
        return this.writeJson(
          this.requirePath(parsed.path, 'write'),
          parsed.data,
          merge,
          dryRun,
        );
      case 'export':
        return this.exportJson(
          this.requirePath(parsed.path, 'export'),
          parsed.data,
          dryRun,
        );
      case 'import': {
        const source = this.requirePath(parsed.path, 'import');
        if (!parsed.toPath || parsed.toPath.trim() === '') {
          throw new Error(
            'ConfigAgent: для import требуется toPath (целевой конфиг)',
          );
        }
        const target = this.resolveSafe(parsed.toPath);
        return this.importJson(source, target, merge, dryRun);
      }
      case 'add-extension':
        return this.addExtension(parsed.extensionId, parsed.path, dryRun);
      case 'remove-extension':
        return this.removeExtension(parsed.extensionId, parsed.path, dryRun);
      default: {
        const exhaustive: never = action;
        throw new Error(
          `ConfigAgent: неизвестное действие ${String(exhaustive)}`,
        );
      }
    }
  }

  // ── Резолв путей и защита (как в FileAgent, через общий isInside) ──

  /**
   * Преобразует входной путь в абсолютный путь внутри разрешённого корня.
   * Относительные пути резолвятся от первого корня; выход за корень
   * и абсолютные пути вне корней блокируются.
   */
  private resolveSafe(rawPath: string): string {
    const root = this.roots[0];
    if (!root) {
      throw new Error('ConfigAgent: не настроен корень операций');
    }
    const trimmed = rawPath.trim();
    if (trimmed === '') {
      throw new Error('ConfigAgent: путь не указан');
    }
    if (path.isAbsolute(trimmed)) {
      const resolved = path.normalize(trimmed);
      const inside = this.roots.some((entry) => isInside(entry, resolved));
      if (!inside) {
        throw new Error(
          `ConfigAgent: путь вне разрешённых корней: ${resolved}`,
        );
      }
      return resolved;
    }
    const resolved = path.resolve(root, trimmed);
    if (!isInside(root, resolved)) {
      throw new Error(`ConfigAgent: выход за пределы корня: ${trimmed}`);
    }
    return resolved;
  }

  /** Запрет записи: корень агента и deny-список (.git, node_modules) */
  private assertWritableTarget(target: string): void {
    if (this.roots.some((root) => path.resolve(root) === target)) {
      throw new Error('ConfigAgent: нельзя перезаписывать корень агента');
    }
    const segments = target.split(path.sep);
    for (const denied of this.denyList) {
      if (segments.includes(denied)) {
        throw new Error(
          `ConfigAgent: запись запрещена (путь содержит «${denied}»): ${target}`,
        );
      }
    }
  }

  private requirePath(raw: string | undefined, action: string): string {
    if (!raw || raw.trim() === '') {
      throw new Error(`ConfigAgent: для действия ${action} требуется path`);
    }
    return this.resolveSafe(raw);
  }

  // ── Операции ──

  private readJson(target: string): ConfigAgentOutput {
    if (!isFile(target)) {
      throw new Error(`ConfigAgent: файл не найден: ${target}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
    } catch (err) {
      throw new Error(
        `ConfigAgent: ошибка JSON в ${target}: ${errorMessage(err)}`,
        { cause: err },
      );
    }
    return {
      action: 'read',
      path: target,
      data: parsed,
      changed: false,
      message: `Конфиг прочитан: ${target}`,
    };
  }

  private writeJson(
    target: string,
    data: unknown,
    merge: boolean,
    dryRun: boolean,
  ): ConfigAgentOutput {
    assertJsonValue(data);
    this.assertWritableTarget(target);
    const existing = this.readExisting(target);
    const merged =
      merge && existing !== null
        ? deepMergeConfig(existing, data, MERGE_MAX_DEPTH)
        : data;
    assertJsonValue(merged);
    const identical = existing !== null && jsonEquals(existing, merged);

    if (dryRun) {
      return {
        action: 'write',
        path: target,
        data: merged,
        changed: false,
        message:
          `План записи ${target} (${merge ? 'merge-обновление' : 'запись'})` +
          ' — файл не изменён (dry-run).',
      };
    }
    if (identical) {
      return {
        action: 'write',
        path: target,
        data: merged,
        changed: false,
        message: `Конфиг без изменений: ${target}`,
      };
    }
    this.atomicWriteJson(target, merged);
    return {
      action: 'write',
      path: target,
      data: merged,
      changed: true,
      message: `Конфиг записан: ${target}`,
    };
  }

  private exportJson(
    target: string,
    data: unknown,
    dryRun: boolean,
  ): ConfigAgentOutput {
    this.assertWritableTarget(target);
    const sources = normalizeSourcePaths(data);
    const merged: Record<string, unknown> = {};
    for (const rawSource of sources) {
      const source = this.resolveSafe(rawSource);
      if (!isFile(source)) {
        throw new Error(`ConfigAgent: исходный конфиг не найден: ${source}`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(source, 'utf-8'));
      } catch (err) {
        throw new Error(
          `ConfigAgent: ошибка JSON в ${source}: ${errorMessage(err)}`,
          { cause: err },
        );
      }
      if (!isPlainObject(parsed)) {
        throw new Error(
          `ConfigAgent: корень исходного конфига должен быть объектом: ${source}`,
        );
      }
      Object.assign(merged, deepMergeConfig(merged, parsed, MERGE_MAX_DEPTH));
    }

    if (dryRun) {
      return {
        action: 'export',
        path: target,
        data: merged,
        changed: false,
        message:
          `План экспорта ${sources.length} конфигов в ${target}` +
          ' — файл не изменён (dry-run).',
      };
    }
    this.atomicWriteJson(target, merged);
    return {
      action: 'export',
      path: target,
      data: merged,
      changed: true,
      message: `Экспортировано конфигов: ${sources.length} → ${target}`,
    };
  }

  private importJson(
    source: string,
    target: string,
    merge: boolean,
    dryRun: boolean,
  ): ConfigAgentOutput {
    this.assertWritableTarget(target);
    if (!isFile(source)) {
      throw new Error(`ConfigAgent: файл-источник не найден: ${source}`);
    }
    let imported: unknown;
    try {
      imported = JSON.parse(fs.readFileSync(source, 'utf-8'));
    } catch (err) {
      throw new Error(
        `ConfigAgent: ошибка JSON в источнике ${source}: ${errorMessage(err)}`,
        { cause: err },
      );
    }
    assertJsonValue(imported);

    const existing = this.readExisting(target);
    const merged =
      merge && existing !== null
        ? deepMergeConfig(existing, imported, MERGE_MAX_DEPTH)
        : imported;
    const backupPath = existing !== null ? `${target}.bak` : undefined;

    if (dryRun) {
      return {
        action: 'import',
        path: target,
        data: merged,
        changed: false,
        message:
          `План импорта: ${source} → ${target}` +
          (backupPath ? ` (бэкап: ${backupPath})` : '') +
          ' — файл не изменён (dry-run).',
        backupPath,
      };
    }

    const identical = existing !== null && jsonEquals(existing, merged);
    if (identical) {
      return {
        action: 'import',
        path: target,
        data: merged,
        changed: false,
        message: `Импорт не изменил конфиг: ${target}`,
        backupPath,
      };
    }

    if (backupPath) {
      try {
        fs.copyFileSync(target, backupPath);
      } catch (err) {
        throw new Error(
          `ConfigAgent: не удалось создать бэкап ${backupPath}: ${errorMessage(err)}`,
          { cause: err },
        );
      }
    }
    try {
      this.atomicWriteJson(target, merged);
    } catch (err) {
      // Восстановление из бэкапа при ошибке применения
      if (backupPath && fs.existsSync(backupPath)) {
        try {
          fs.copyFileSync(backupPath, target);
        } catch {
          // не удалось восстановить — бэкап остаётся на диске
        }
      }
      throw err;
    }
    return {
      action: 'import',
      path: target,
      data: merged,
      changed: true,
      message: `Импорт применён: ${source} → ${target}`,
      backupPath,
    };
  }

  private addExtension(
    extensionId: string | undefined,
    rawPath: string | undefined,
    dryRun: boolean,
  ): ConfigAgentOutput {
    assertExtensionId(extensionId);
    const target = rawPath
      ? this.resolveSafe(rawPath)
      : this.resolveSafe(VSCodeExtensionsPath);
    this.assertWritableTarget(target);

    const existing = this.readExisting(target);
    let base: Record<string, unknown>;
    if (existing === null) {
      base = {};
    } else if (isPlainObject(existing)) {
      base = existing;
    } else {
      throw new Error(
        `ConfigAgent: extensions.json должен быть объектом: ${target}`,
      );
    }
    const recommendations = Array.isArray(base.recommendations)
      ? (base.recommendations as unknown[])
      : [];
    if (recommendations.includes(extensionId)) {
      return {
        action: 'add-extension',
        path: target,
        changed: false,
        message: `Расширение уже в рекомендациях: ${extensionId}`,
      };
    }
    const next = {
      ...base,
      recommendations: [...recommendations, extensionId],
    };

    if (dryRun) {
      return {
        action: 'add-extension',
        path: target,
        changed: false,
        message: `План: добавить ${extensionId} в ${target} (dry-run).`,
      };
    }
    this.atomicWriteJson(target, next);
    return {
      action: 'add-extension',
      path: target,
      changed: true,
      message: `Расширение добавлено: ${extensionId}`,
    };
  }

  private removeExtension(
    extensionId: string | undefined,
    rawPath: string | undefined,
    dryRun: boolean,
  ): ConfigAgentOutput {
    assertExtensionId(extensionId);
    const target = rawPath
      ? this.resolveSafe(rawPath)
      : this.resolveSafe(VSCodeExtensionsPath);
    this.assertWritableTarget(target);

    const existing = this.readExisting(target);
    if (existing === null) {
      return {
        action: 'remove-extension',
        path: target,
        changed: false,
        message: `extensions.json не найден: ${target}`,
      };
    }
    if (!isPlainObject(existing)) {
      throw new Error(
        `ConfigAgent: extensions.json должен быть объектом: ${target}`,
      );
    }
    const recommendations = Array.isArray(existing.recommendations)
      ? (existing.recommendations as unknown[])
      : [];
    if (!recommendations.includes(extensionId)) {
      return {
        action: 'remove-extension',
        path: target,
        changed: false,
        message: `Расширение не в рекомендациях: ${extensionId}`,
      };
    }
    const next = {
      ...existing,
      recommendations: recommendations.filter((item) => item !== extensionId),
    };

    if (dryRun) {
      return {
        action: 'remove-extension',
        path: target,
        changed: false,
        message: `План: удалить ${extensionId} из ${target} (dry-run).`,
      };
    }
    this.atomicWriteJson(target, next);
    return {
      action: 'remove-extension',
      path: target,
      changed: true,
      message: `Расширение удалено: ${extensionId}`,
    };
  }

  // ── Низкоуровневые операции с файлами ──

  /** Читает и парсит существующий JSON; null — если файла нет */
  private readExisting(target: string): unknown | null {
    if (!isFile(target)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(target, 'utf-8'));
    } catch (err) {
      throw new Error(
        `ConfigAgent: существующий файл не является валидным JSON: ${target} — ${errorMessage(err)}`,
        { cause: err },
      );
    }
  }

  /**
   * Атомарная запись JSON: во временный файл в той же директории + rename.
   * При ошибке временный файл удаляется, целевой остаётся нетронутым.
   */
  private atomicWriteJson(target: string, value: unknown): void {
    assertJsonValue(value);
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(
      dir,
      `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`,
    );
    const content = `${JSON.stringify(value, null, 2)}\n`;
    try {
      fs.writeFileSync(tmp, content, 'utf-8');
      fs.renameSync(tmp, target);
    } catch (err) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // временный файл уже удалён или не создан
      }
      throw new Error(
        `ConfigAgent: ошибка записи ${target}: ${errorMessage(err)}`,
        { cause: err },
      );
    }
  }
}

// ──────────────────────────────────────────────
// 4. Утилиты (экспортируются для переиспользования и тестов)
// ──────────────────────────────────────────────

/**
 * Глубокое слияние JSON-значений.
 *
 * Объекты на глубине < maxDepth объединяются (приоритет у overlay/новых
 * ключей), начиная с maxDepth вложенность заменяется целиком. По умолчанию
 * maxDepth = 2: объединяются ключи 1-го и 2-го уровней.
 */
export function deepMergeConfig(
  base: unknown,
  overlay: unknown,
  maxDepth = MERGE_MAX_DEPTH,
  depth = 0,
): unknown {
  if (depth >= maxDepth) {
    return overlay;
  }
  if (isPlainObject(base) && isPlainObject(overlay)) {
    const out: Record<string, unknown> = { ...base };
    for (const key of Object.keys(overlay)) {
      out[key] = deepMergeConfig(base[key], overlay[key], maxDepth, depth + 1);
    }
    return out;
  }
  return overlay;
}

/**
 * Проверяет, что значение является JSON-сериализуемым
 * (примитивы/массивы/объекты без функций, undefined, bigint, NaN/Infinity
 * и циклических ссылок). Бросает ошибку иначе.
 */
export function assertJsonValue(value: unknown): void {
  if (value === null) return;
  const type = typeof value;
  switch (type) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value as number)) {
        throw new Error(
          'ConfigAgent: число NaN/Infinity не является JSON-значением',
        );
      }
      return;
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new Error(
        `ConfigAgent: значение типа ${type} не является JSON-значением`,
      );
    case 'object': {
      try {
        JSON.stringify(value); // ловит циклические ссылки
      } catch (err) {
        throw new Error(
          'ConfigAgent: циклическая ссылка не является JSON-значением',
          { cause: err },
        );
      }
      if (Array.isArray(value)) {
        for (const item of value) assertJsonValue(item);
      } else {
        const record = value as Record<string, unknown>;
        for (const key of Object.keys(record)) assertJsonValue(record[key]);
      }
      return;
    }
    default:
      throw new Error(`ConfigAgent: неподдерживаемый тип ${type}`);
  }
}

/** Является ли значение «плоским» объектом (не массивом, не null) */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Нормализует data экспорта в массив путей исходных конфигов */
function normalizeSourcePaths(data: unknown): string[] {
  if (typeof data === 'string') {
    return [data];
  }
  if (Array.isArray(data) && data.every((item) => typeof item === 'string')) {
    return data as string[];
  }
  throw new Error(
    'ConfigAgent: для export data должна быть путём (string) ' +
      'или массивом путей (string[]) исходных конфигов',
  );
}

function assertExtensionId(
  extensionId: string | undefined,
): asserts extensionId is string {
  if (!extensionId || !EXTENSION_ID_PATTERN.test(extensionId)) {
    throw new Error(
      'ConfigAgent: некорректный идентификатор расширения (ожидается publisher.name)',
    );
  }
}

function jsonEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Существует ли файл (не директория) */
function isFile(target: string): boolean {
  try {
    return fs.existsSync(target) && fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
