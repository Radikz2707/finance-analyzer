/**
 * Единый логгер — публичное API модуля.
 *
 * Использование:
 *   import { getLogger } from './modules/logger/index.js';
 *   const log = getLogger('harness-bridge');
 *   log.warn('Ошибка чтения:', err);
 *
 * Уровень: env LOG_LEVEL (debug|info|warn|error, default info).
 * Файловая запись: Node + LOG_TO_FILE=1 → initFileLogging() → data/logs/app.log.
 */

export * from './types.js';
export {
  DEFAULT_LOG_LEVEL,
  DEFAULT_LOG_FILE_PATH,
  ConsoleLogBackend,
  formatLogLine,
  getLogger,
  getDefaultBackend,
  initFileLogging,
  parseLogLevel,
  resetLoggers,
  setLogLevel,
} from './logger.js';
export {
  FileLogBackend,
  MAX_LOG_FILE_SIZE_BYTES,
} from './file-backend.js';
export type { FileLogBackendOptions } from './file-backend.js';