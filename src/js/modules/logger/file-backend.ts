/**
 * Файловый бэкенд логгера — Node-only.
 *
 * Этот модуль импортирует fs/path и НЕ должен попадать в браузерный бандл:
 * подключается из logger.ts лениво (динамический import) только при включённом
 * режиме записи в файл (LOG_TO_FILE=1).
 *
 * Ротация: перед каждой записью проверяется размер файла; если он превышает
 * maxSizeBytes (по умолчанию 5 МБ), текущий файл переименовывается в
 * «app.log.old» (старый .old удаляется), запись начинается в новый файл.
 * Все ошибки fs молча игнорируются: логгирование не роняет приложение.
 */

import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'fs';
import { dirname } from 'path';
import type { LogBackend, LogRecord } from './types.js';
import { formatLogLine } from './logger.js';

/** Максимальный размер файла лога по умолчанию: 5 МБ */
export const MAX_LOG_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Опции файлового бэкенда */
export interface FileLogBackendOptions {
  /** Порог ротации в байтах (для тестов можно уменьшить) */
  maxSizeBytes?: number;
}

/**
 * Бэкенд, дописывающий записи в файл (appendFileSync) с ротацией по размеру.
 */
export class FileLogBackend implements LogBackend {
  private readonly filePath: string;
  private readonly maxSizeBytes: number;

  constructor(filePath: string, options: FileLogBackendOptions = {}) {
    this.filePath = filePath;
    this.maxSizeBytes = options.maxSizeBytes ?? MAX_LOG_FILE_SIZE_BYTES;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
    } catch {
      // Директорию создать не удалось — write() тихо не сработает
    }
  }

  /** Путь к файлу лога */
  getFilePath(): string {
    return this.filePath;
  }

  write(record: LogRecord): void {
    const line = formatLogLine(record) + '\n';
    try {
      this.rotateIfNeeded(Buffer.byteLength(line, 'utf8'));
      appendFileSync(this.filePath, line, 'utf8');
    } catch {
      // fs-ошибка (диск полон, права) не должна ронять приложение
    }
  }

  /** Ротация: если файл превысит лимит после записи — унести в .old */
  private rotateIfNeeded(lineBytes: number): void {
    let size: number;
    try {
      size = statSync(this.filePath).size;
    } catch {
      return; // файла ещё нет — ротировать нечего
    }
    if (size + lineBytes <= this.maxSizeBytes) {
      return;
    }
    const oldPath = `${this.filePath}.old`;
    try {
      rmSync(oldPath, { force: true }); // Windows: rename не перезаписывает
    } catch {
      // ignore
    }
    try {
      renameSync(this.filePath, oldPath);
    } catch {
      // ignore
    }
  }
}