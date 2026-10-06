/**
 * FileAgent — агент безопасных файловых операций.
 *
 * Даёт Director'у «руку» для работы с файлами проекта:
 * - чтение (текст / JSON / YAML-подмножество);
 * - запись и создание файлов с автосозданием директорий;
 * - удаление файлов и директорий (рекурсивно, с защитой);
 * - переименование и перемещение;
 * - листинг директорий;
 * - поиск по подстроке или glob-паттерну (*, ?, **).
 *
 * Безопасность:
 * - Агент работает ТОЛЬКО внутри разрешённых корней (по умолчанию process.cwd());
 * - выход за пределы корня через "../" или абсолютные пути вне корня блокируется;
 * - удаление самого корня или служебных путей (".git", "node_modules") запрещено.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import type {
  AgentActionInput,
  AgentActionResult,
} from '../agent/agent-contract.js';

// ──────────────────────────────────────────────
// 1. Типы FileAgent
// ──────────────────────────────────────────────

/** Действие, выполняемое агентом */
export type FileAgentAction =
  | 'read' // чтение файла как текста
  | 'readJson' // чтение и парсинг JSON
  | 'readYaml' // чтение и парсинг YAML-подмножества
  | 'write' // запись/создание файла
  | 'delete' // удаление файла или директории
  | 'rename' // переименование/перемещение
  | 'list' // листинг директории
  | 'search'; // поиск файлов по паттерну

/**
 * Входные данные FileAgent.
 * Расширяет единый стандарт входа action-агента `AgentActionInput`.
 */
export interface FileAgentInput extends AgentActionInput<FileAgentAction> {
  /** Путь к файлу/директории (относительно корня или абсолютный) */
  path?: string;
  /** Новый путь для rename/move */
  toPath?: string;
  /** Содержимое для write */
  content?: string;
  /** Паттерн для search: подстрока или glob (*, ?, **) */
  pattern?: string;
  /** Рекурсивный обход для list/search */
  recursive?: boolean;
}

/** Запись директории при листинге */
export interface FileEntryInfo {
  /** Абсолютный путь */
  path: string;
  /** Путь относительно корня операции */
  relativePath: string;
  isDirectory: boolean;
  /** Размер в байтах (для директорий — размер записи FS) */
  size: number;
}

/**
 * Выходные данные FileAgent.
 * Структурно соответствует единой форме результата `AgentActionResult`
 * (action + success + message; специфика — в собственных полях).
 */
export interface FileAgentOutput extends AgentActionResult<FileAgentAction> {
  action: FileAgentAction;
  /** Фактический путь операции */
  path: string;
  success: boolean;
  /** Человекочитаемое описание результата */
  message: string;
  /** Текст файла (read) */
  content?: string;
  /** Распарсенное значение (readJson / readYaml) */
  parsed?: unknown;
  /** Записи директории (list) */
  entries?: FileEntryInfo[];
  /** Найденные пути (search) */
  files?: string[];
}

/** Опции конфигурации FileAgent */
export interface FileAgentOptions {
  /** Разрешённые корни (по умолчанию — process.cwd()) */
  roots?: string[];
  /** Подстроки, запрещённые для удаления (по умолчанию: .git, node_modules) */
  deleteDenyList?: string[];
}

/** Запреты на удаление по умолчанию */
const DEFAULT_DELETE_DENY: readonly string[] = ['.git', 'node_modules'];

// ──────────────────────────────────────────────
// 2. FileAgent
// ──────────────────────────────────────────────

/**
 * FileAgent — безопасные операции с файлами проекта.
 */
export class FileAgent extends AgentBase {
  private readonly roots: string[];
  private readonly deleteDenyList: string[];

  constructor(config?: AgentConfig, options?: FileAgentOptions) {
    super(config ?? { name: 'FileAgent' });
    const roots = options?.roots?.length ? options.roots : [process.cwd()];
    this.roots = roots.map((root) => path.resolve(root));
    this.deleteDenyList = options?.deleteDenyList?.length
      ? options.deleteDenyList
      : [...DEFAULT_DELETE_DENY];
  }

  protected async executeInternal(
    input: FileAgentInput,
  ): Promise<FileAgentOutput> {
    if (!input || typeof input !== 'object') {
      throw new Error('FileAgent: входные данные отсутствуют');
    }
    const action = input.action;
    if (!action) {
      throw new Error('FileAgent: не указано действие (action)');
    }
    const target = this.resolveSafe(input.path ?? '');

    switch (action) {
      case 'read':
        return this.readFile(target);
      case 'readJson':
        return this.readJsonFile(target);
      case 'readYaml':
        return this.readYamlFile(target);
      case 'write':
        return this.writeFile(target, input.content ?? '');
      case 'delete':
        return this.deletePath(target);
      case 'rename': {
        if (!input.toPath) {
          throw new Error('FileAgent: для rename требуется toPath');
        }
        const destination = this.resolveSafe(input.toPath);
        return this.renamePath(target, destination);
      }
      case 'list':
        return this.listDir(target, input.recursive ?? false);
      case 'search': {
        if (!input.pattern) {
          throw new Error('FileAgent: для search требуется pattern');
        }
        return this.searchFiles(target, input.pattern, input.recursive ?? true);
      }
      default: {
        const exhaustive: never = action;
        throw new Error(
          `FileAgent: неизвестное действие ${String(exhaustive)}`,
        );
      }
    }
  }

  // ── Валидация путей (безопасность) ──

  /**
   * Преобразует входной путь в абсолютный путь внутри разрешённого корня.
   * Относительные пути резолвятся от первого корня; выход за корень блокируется.
   */
  private resolveSafe(rawPath: string): string {
    const root = this.roots[0];
    if (!root) {
      throw new Error('FileAgent: не настроен корень файловых операций');
    }
    const trimmed = rawPath.trim();
    // Пустой путь = корень агента (удобно для list/search по всему проекту)
    if (trimmed === '') {
      return root;
    }
    if (path.isAbsolute(trimmed)) {
      const resolved = path.normalize(trimmed);
      const inside = this.roots.some((entry) => isInside(entry, resolved));
      if (!inside) {
        throw new Error(`FileAgent: путь вне разрешённых корней: ${resolved}`);
      }
      return resolved;
    }
    const resolved = path.resolve(root, trimmed);
    if (!isInside(root, resolved)) {
      throw new Error(`FileAgent: выход за пределы корня: ${trimmed}`);
    }
    return resolved;
  }

  // ── Операции ──

  private readFile(target: string): FileAgentOutput {
    const base = this.base(target, 'read');
    if (!isFile(target)) {
      throw new Error(`Файл не найден: ${target}`);
    }
    const content = fs.readFileSync(target, 'utf-8');
    return {
      ...base,
      success: true,
      message: `Прочитано ${content.length} символов`,
      content,
    };
  }

  private readJsonFile(target: string): FileAgentOutput {
    const base = this.base(target, 'readJson');
    if (!isFile(target)) {
      throw new Error(`Файл не найден: ${target}`);
    }
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(target, 'utf-8'));
      return { ...base, success: true, message: 'JSON распарсен', parsed };
    } catch (err) {
      throw new Error(`Ошибка JSON: ${errorMessage(err)}`, { cause: err });
    }
  }

  private readYamlFile(target: string): FileAgentOutput {
    const base = this.base(target, 'readYaml');
    if (!isFile(target)) {
      throw new Error(`Файл не найден: ${target}`);
    }
    try {
      const parsed = parseYaml(fs.readFileSync(target, 'utf-8'));
      return { ...base, success: true, message: 'YAML распарсен', parsed };
    } catch (err) {
      throw new Error(`Ошибка YAML: ${errorMessage(err)}`, { cause: err });
    }
  }

  private writeFile(target: string, content: string): FileAgentOutput {
    const base = this.base(target, 'write');
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf-8');
      const bytes = Buffer.byteLength(content, 'utf-8');
      return {
        ...base,
        success: true,
        message: `Файл записан: ${target} (${bytes} байт)`,
      };
    } catch (err) {
      throw new Error(`Ошибка записи: ${errorMessage(err)}`, { cause: err });
    }
  }

  private deletePath(target: string): FileAgentOutput {
    const base = this.base(target, 'delete');
    if (!fs.existsSync(target)) {
      throw new Error(`Файл не найден: ${target}`);
    }
    if (this.roots.some((root) => path.resolve(root) === target)) {
      throw new Error('Запрещено удалять корень агента');
    }
    const denied = this.deleteDenyList.find((entry) => target.includes(entry));
    if (denied) {
      throw new Error(`Запрещено удалять путь, содержащий: ${denied}`);
    }
    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        fs.rmSync(target, { recursive: true });
      } else {
        fs.unlinkSync(target);
      }
      return { ...base, success: true, message: `Удалено: ${target}` };
    } catch (err) {
      throw new Error(`Ошибка удаления: ${errorMessage(err)}`, { cause: err });
    }
  }

  private renamePath(source: string, destination: string): FileAgentOutput {
    const base = this.base(source, 'rename');
    if (!fs.existsSync(source)) {
      throw new Error(`Файл не найден: ${source}`);
    }
    try {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(source, destination);
      return {
        ...base,
        success: true,
        message: `Перемещено: ${source} → ${destination}`,
      };
    } catch (err) {
      throw new Error(`Ошибка перемещения: ${errorMessage(err)}`, {
        cause: err,
      });
    }
  }

  private listDir(target: string, recursive: boolean): FileAgentOutput {
    const base = this.base(target, 'list');
    if (!fs.existsSync(target)) {
      throw new Error(`Директория не найдена: ${target}`);
    }
    if (!fs.statSync(target).isDirectory()) {
      throw new Error(`Не директория: ${target}`);
    }
    const entries: FileEntryInfo[] = [];
    walkDir(target, target, entries, recursive);
    return {
      ...base,
      success: true,
      message: `Найдено записей: ${entries.length}`,
      entries,
    };
  }

  private searchFiles(
    target: string,
    pattern: string,
    recursive: boolean,
  ): FileAgentOutput {
    const base = this.base(target, 'search');
    if (!fs.existsSync(target)) {
      throw new Error(`Путь не найден: ${target}`);
    }
    const matcher = buildGlobMatcher(pattern);
    const files: string[] = [];

    if (fs.statSync(target).isDirectory()) {
      const collect = (dir: string): void => {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, item.name);
          const rel = path.relative(target, full);
          if (matcher(rel) || matcher(item.name)) {
            files.push(full);
          }
          if (recursive && item.isDirectory()) {
            collect(full);
          }
        }
      };
      collect(target);
    } else if (matcher(path.basename(target))) {
      files.push(target);
    }

    return {
      ...base,
      success: true,
      message: `Найдено файлов: ${files.length}`,
      files,
    };
  }

  private base(
    target: string,
    action: FileAgentAction,
  ): Omit<FileAgentOutput, 'success' | 'message'> {
    return { action, path: target };
  }
}

// ──────────────────────────────────────────────
// 3. Утилиты (экспортируются для тестов)
// ──────────────────────────────────────────────

/** Лежит ли target внутри root (включая сам root) */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Существует ли файл (не директория) */
function isFile(target: string): boolean {
  try {
    return fs.existsSync(target) && fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/** Рекурсивный обход директории */
function walkDir(
  root: string,
  dir: string,
  out: FileEntryInfo[],
  recursive: boolean,
): void {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    const stat = fs.statSync(full);
    out.push({
      path: full,
      relativePath: toPosix(path.relative(root, full)),
      isDirectory: stat.isDirectory(),
      size: stat.size,
    });
    if (recursive && stat.isDirectory()) {
      walkDir(root, full, out, true);
    }
  }
}

/** Нормализует разделители пути в "/" (для стабильных relativePath) */
function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * Строит функцию-матчер для паттерна поиска.
 * Без glob-символов — проверка подстроки; иначе — regex из glob (*, ?, **).
 */
export function buildGlobMatcher(pattern: string): (value: string) => boolean {
  const normalized = pattern.replace(/\\/g, '/');
  const hasGlob = /[*?[\]]/.test(normalized);
  if (!hasGlob) {
    return (value: string) =>
      value.includes(normalized) || path.basename(value).includes(normalized);
  }
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const source = escaped
    .replace(/\*\*/g, '__GLOB_DOUBLE_STAR__')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/\?/g, '[^/\\\\]')
    .replace(/__GLOB_DOUBLE_STAR__/g, '.*');
  const regex = new RegExp(`^${source}$`);
  return (value: string) => regex.test(value.replace(/\\/g, '/'));
}

/**
 * Парсер YAML-подмножества для конфигурационных файлов.
 *
 * Поддерживает:
 * - комментарии (#) и пустые строки;
 * - плоские и вложенные отображения `key: value`;
 * - списки `- item` (скаляры и inline-объекты `- key: value`);
 * - скаляры: строки (в т.ч. в кавычках), числа, boolean, null.
 *
 * Не поддерживает: якоря, мультистроки (|, >), сложные типы.
 */
export function parseYaml(text: string): unknown {
  const lines: Array<{ indent: number; text: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    lines.push({ indent: raw.length - raw.trimStart().length, text: trimmed });
  }

  let index = 0;

  const parseNode = (minIndent: number): { value: unknown; next: number } => {
    if (index >= lines.length) return { value: {}, next: index };
    const current = lines[index];
    if (!current) return { value: {}, next: index };
    if (current.indent < minIndent) return { value: {}, next: index };

    // Список
    if (current.text.startsWith('- ')) {
      const arr: unknown[] = [];
      while (index < lines.length) {
        const itemLine = lines[index];
        if (
          !itemLine ||
          itemLine.indent !== current.indent ||
          !itemLine.text.startsWith('- ')
        ) {
          break;
        }
        const rest = itemLine.text.slice(2).trim();
        if (rest.includes(':')) {
          const itemObj: Record<string, unknown> = {};
          const sep = rest.indexOf(':');
          const key = rest.slice(0, sep).trim();
          const valueRest = rest.slice(sep + 1).trim();
          itemObj[key] = valueRest === '' ? null : parseScalar(valueRest);
          index++;
          const deeper = lines[index];
          if (deeper && deeper.indent > current.indent) {
            const nested = parseNode(current.indent + 1);
            Object.assign(itemObj, nested.value as Record<string, unknown>);
            index = nested.next;
          }
          arr.push(itemObj);
        } else {
          arr.push(parseScalar(rest));
          index++;
        }
      }
      return { value: arr, next: index };
    }

    // Отображение
    const obj: Record<string, unknown> = {};
    while (index < lines.length) {
      const line = lines[index];
      if (
        !line ||
        line.indent !== current.indent ||
        line.text.startsWith('- ')
      ) {
        break;
      }
      const sep = line.text.indexOf(':');
      if (sep === -1) {
        index++;
        continue;
      }
      const key = line.text.slice(0, sep).trim();
      const rest = line.text.slice(sep + 1).trim();
      if (rest === '') {
        index++;
        const deeper = lines[index];
        if (deeper && deeper.indent > line.indent) {
          const nested = parseNode(line.indent + 1);
          obj[key] = nested.value;
          index = nested.next;
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseScalar(rest);
        index++;
      }
    }
    return { value: obj, next: index };
  };

  return parseNode(0).value;
}

/** Приведение строки YAML к скалярному значению */
function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === '' || value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d*\.\d+$/.test(value)) return parseFloat(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  const hashIndex = value.indexOf(' #');
  return hashIndex === -1 ? value : value.slice(0, hashIndex).trim();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
