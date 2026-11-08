/**
 * Единый логгер — ядро (browser-safe).
 *
 * Модуль НЕ импортирует Node-зависимости статически (fs/path), поэтому его
 * можно безопасно подключать из браузерных бандлов (например, harness-bridge
 * попадает в webpack-бандл из app.ts). Файловый бэкенд (Node-only) подключается
 * лениво через динамический импорт — только когда включён режим записи в файл.
 *
 * Поведение:
 * - getLogger(module) — фабрика с кэшем (один экземпляр на метку модуля);
 * - уровень по умолчанию — из env LOG_LEVEL (debug|info|warn|error, default info);
 * - методы debug/info/warn/error повторяют поведение console.* (тот же набор
 *   аргументов), поэтому замена console → getLogger не ломает контракты;
 * - бэкенд по умолчанию — console; в Node при LOG_TO_FILE=1 дополнительно
 *   подключается файловый бэкенд (см. initFileLogging).
 */

import type {
  LogBackend,
  LogLevel,
  LogRecord,
  Logger,
  LoggerOptions,
} from './types.js';

/** Уровень по умолчанию */
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/** Относительный путь файла лога по умолчанию (от корня проекта) */
export const DEFAULT_LOG_FILE_PATH = 'data/logs/app.log';

/** Ранги уровней для сравнения */
const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Работаем ли в Node-рантайме (в браузере process отсутствует) */
function isNodeRuntime(): boolean {
  return (
    typeof process !== 'undefined' &&
    typeof process.versions !== 'undefined' &&
    typeof process.versions.node === 'string'
  );
}

/** Прочитать env-переменную безопасно для браузера */
function readEnv(name: string): string | undefined {
  if (!isNodeRuntime()) {
    return undefined;
  }
  return process.env[name];
}

/** Разобрать уровень из строки (env LOG_LEVEL). Невалидное значение → info */
export function parseLogLevel(value: string | undefined): LogLevel {
  switch (value?.trim().toLowerCase()) {
    case 'debug':
      return 'debug';
    case 'info':
      return 'info';
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    default:
      return DEFAULT_LOG_LEVEL;
  }
}

/**
 * Форматирование записи в одну строку (для файлового бэкенда).
 * Объекты сериализуются через JSON.stringify (при неудаче — String()).
 */
export function formatLogLine(record: LogRecord): string {
  const args = record.args
    .map((arg) => {
      if (typeof arg === 'string') {
        return arg;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
  return (
    `[${record.timestamp}] [${record.level.toUpperCase()}] ` +
    `[${record.module}] ${args}`
  );
}

/**
 * Консольный бэкенд: вызывает console.* с тем же набором аргументов.
 *
 * ВАЖНО: методы console.* читаются ДИНАМИЧЕСКИ в момент записи, поэтому
 * vi.spyOn(console, 'warn'/'error') в тестах перехватывает вывод логгера.
 */
export class ConsoleLogBackend implements LogBackend {
  write(record: LogRecord): void {
    const method =
      record.level === 'error'
        ? 'error'
        : record.level === 'warn'
          ? 'warn'
          : record.level === 'debug'
            ? 'debug'
            : 'log';
    const fn = console[method];
    if (typeof fn === 'function') {
      fn(`[${record.module}]`, ...record.args);
    }
  }
}

/** Глобальный override уровня (приоритетнее env LOG_LEVEL) */
let globalLevel: LogLevel | null = null;

/** Текущий дефолтный бэкенд (может быть заменён initFileLogging) */
let defaultBackend: LogBackend = new ConsoleLogBackend();

/** Кэш логгеров по метке модуля */
const cache = new Map<string, Logger>();

/** Реализация логгера одного модуля */
class LoggerImpl implements Logger {
  readonly module: string;
  private level: LogLevel;
  private readonly backend: LogBackend;

  constructor(options: LoggerOptions) {
    this.module = options.module;
    this.level =
      options.level ?? globalLevel ?? parseLogLevel(readEnv('LOG_LEVEL'));
    this.backend = options.backend ?? defaultBackend;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  debug(...args: unknown[]): void {
    this.log('debug', args);
  }

  info(...args: unknown[]): void {
    this.log('info', args);
  }

  warn(...args: unknown[]): void {
    this.log('warn', args);
  }

  error(...args: unknown[]): void {
    this.log('error', args);
  }

  private log(level: LogLevel, args: unknown[]): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) {
      return;
    }
    const record: LogRecord = {
      level,
      module: this.module,
      timestamp: new Date().toISOString(),
      args,
    };
    try {
      this.backend.write(record);
    } catch {
      // Логирование никогда не должно ронять приложение
    }
  }
}

/**
 * Фабрика логгеров с кэшем.
 * @param module — метка модуля (например, 'harness-bridge')
 * @param options — необязательная тонкая настройка (используется в тестах);
 *                  при передаче options экземпляр НЕ кладётся в кэш.
 */
export function getLogger(
  module: string,
  options?: Omit<LoggerOptions, 'module'>,
): Logger {
  if (options) {
    return new LoggerImpl({ module, ...options });
  }

  const cached = cache.get(module);
  if (cached) {
    return cached;
  }
  const created = new LoggerImpl({ module });
  cache.set(module, created);
  return created;
}

/** Очистить кэш логгеров (для тестов и переконфигурации) */
export function resetLoggers(): void {
  cache.clear();
}

/**
 * Глобально задать уровень для новых и существующих логгеров.
 * Приоритет: setLogLevel > явный options.level > env LOG_LEVEL > info.
 *
 * Передача null сбрасывает глобальный оверрайд: новые логгеры снова берут
 * уровень из env LOG_LEVEL. Кэшированные экземпляры сохраняют свой уровень.
 */
export function setLogLevel(level: LogLevel | null): void {
  globalLevel = level;
  if (level === null) {
    return;
  }
  for (const logger of cache.values()) {
    logger.setLevel(level);
  }
}

/**
 * Подключить файловую запись (Node-only, ленивый импорт fs/path).
 *
 * Вызывается один раз из Node-контура (например, harness-bootstrap) при
 * LOG_TO_FILE=1 или напрямую из тестов. После вызова новые логгеры пишут
 * в файл (помимо console нет — файл ЗАМЕНЯЕТ бэкенд для новых экземпляров).
 *
 * @returns true, если файловый режим включён; false — вне Node.
 */
export async function initFileLogging(options?: {
  filePath?: string;
  maxSizeBytes?: number;
}): Promise<boolean> {
  if (!isNodeRuntime()) {
    return false;
  }
  const { FileLogBackend } = await import('./file-backend.js');
  const filePath = options?.filePath ?? readEnv('LOG_FILE') ?? DEFAULT_LOG_FILE_PATH;
  defaultBackend = new FileLogBackend(filePath, {
    maxSizeBytes: options?.maxSizeBytes,
  });
  return true;
}

/** Текущий дефолтный бэкенд (для диагностики/тестов) */
export function getDefaultBackend(): LogBackend {
  return defaultBackend;
}