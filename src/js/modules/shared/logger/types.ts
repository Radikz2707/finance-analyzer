/**
 * Единый логгер — типы.
 *
 * Логгер абстрагирует вывод от консоли: модуль пишет через getLogger(module),
 * а фактический бэкенд (console или файл) выбирается окружением:
 * - в браузере всегда console;
 * - в Node дополнительно может писать в файл (LOG_TO_FILE / LOG_FILE).
 */

/** Уровни логирования (по возрастанию важности) */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Одна запись лога, передаваемая бэкенду */
export interface LogRecord {
  /** Уровень записи */
  level: LogLevel;
  /** Метка модуля (например, 'harness-bridge') */
  module: string;
  /** Время в ISO 8601 */
  timestamp: string;
  /** Аргументы записи (поведение как у console.log/warn/error) */
  args: unknown[];
}

/** Бэкенд вывода: получает готовую запись и записывает её куда угодно */
export interface LogBackend {
  write(record: LogRecord): void;
}

/** Опции создания логгера (используются в основном тестами) */
export interface LoggerOptions {
  /** Метка модуля */
  module: string;
  /** Явный уровень (приоритетнее env LOG_LEVEL) */
  level?: LogLevel;
  /** Явный бэкенд (по умолчанию — console, в Node + файл при LOG_TO_FILE) */
  backend?: LogBackend;
}

/** Публичный интерфейс логгера одного модуля */
export interface Logger {
  /** Метка модуля */
  readonly module: string;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** Сменить уровень (влияет только на этот экземпляр) */
  setLevel(level: LogLevel): void;
  /** Текущий уровень */
  getLevel(): LogLevel;
}