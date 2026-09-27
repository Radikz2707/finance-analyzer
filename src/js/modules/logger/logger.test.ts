/**
 * Logger Tests — единый логгер.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect/vi),
 * а не импорт из 'vitest' (ограничение окружения: vitest 5.x + vite 8.x).
 *
 * Покрытие:
 * 1. env LOG_LEVEL задаёт уровень по умолчанию (info по умолчанию, error при env)
 * 2. Уровни фильтруются (mock backend): ниже уровня не пишутся
 * 3. Явный options.level приоритетнее env
 * 4. getLogger кэширует экземпляры по метке модуля
 * 5. Дефолтный бэкенд — console (браузер-режим не падает, spy перехватывает)
 * 6. ConsoleLogBackend повторяет сигнатуру console.* (метка модуля первым аргументом)
 * 7. setLogLevel переопределяет уровень
 * 8. Файловый режим пишет и ротирует (os.tmpdir, после — удаление)
 * 9. parseLogLevel / formatLogLine
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ConsoleLogBackend,
  FileLogBackend,
  formatLogLine,
  getDefaultBackend,
  getLogger,
  parseLogLevel,
  resetLoggers,
  setLogLevel,
} from './index.js';
import type { LogBackend, LogRecord } from './types.js';

/** Записывающий mock-бэкенд */
function makeMockBackend(): { backend: LogBackend; writes: LogRecord[] } {
  const writes: LogRecord[] = [];
  return {
    backend: { write: (record) => writes.push(record) },
    writes,
  };
}

describe('logger', () => {
  const originalEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ['LOG_LEVEL', 'LOG_TO_FILE', 'LOG_FILE'];

  beforeAll(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    // Восстановить окружение и глобальный уровень между тестами
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    setLogLevel(null);
    resetLoggers();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    resetLoggers();
  });

  it('env LOG_LEVEL задаёт уровень по умолчанию (по умолчанию info)', () => {
    delete process.env.LOG_LEVEL;
    const first = makeMockBackend();
    const log = getLogger('env-default', { backend: first.backend });
    log.debug('hidden');
    log.info('shown');
    expect(first.writes.map((r) => r.level)).toEqual(['info']);

    process.env.LOG_LEVEL = 'error';
    const second = makeMockBackend();
    const strict = getLogger('env-error', { backend: second.backend });
    strict.warn('hidden');
    strict.error('shown');
    expect(second.writes.map((r) => r.level)).toEqual(['error']);
  });

  it('уровни фильтруются: ниже установленного не записываются', () => {
    const { backend, writes } = makeMockBackend();
    const log = getLogger('levels', { level: 'warn', backend });

    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(writes.map((r) => r.level)).toEqual(['warn', 'error']);
    expect(writes[0]!.module).toBe('levels');
    expect(writes[0]!.args).toEqual(['w']);
  });

  it('setLevel переключает уровень на лету', () => {
    const { backend, writes } = makeMockBackend();
    const log = getLogger('switch-level', { level: 'warn', backend });

    log.info('hidden');
    log.setLevel('debug');
    log.info('visible');

    expect(writes.map((r) => r.level)).toEqual(['info']);
  });

  it('getLogger кэширует экземпляры по метке модуля', () => {
    resetLoggers();
    expect(getLogger('cached-a')).toBe(getLogger('cached-a'));
    expect(getLogger('cached-a')).not.toBe(getLogger('cached-b'));
  });

  it('дефолтный бэкенд — console (браузер-режим не падает)', () => {
    delete process.env.LOG_TO_FILE;
    resetLoggers();

    expect(getDefaultBackend()).toBeInstanceOf(ConsoleLogBackend);

    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => getLogger('browser-safe').info('hello')).not.toThrow();
    expect(infoSpy).toHaveBeenCalledWith('[browser-safe]', 'hello');
  });

  it('ConsoleLogBackend повторяет сигнатуру console.*', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const backend = new ConsoleLogBackend();
    const log = getLogger('console-signature', { backend });

    log.warn('Ошибка провайдера:', { code: 1 });

    expect(warnSpy).toHaveBeenCalledWith(
      '[console-signature]',
      'Ошибка провайдера:',
      { code: 1 },
    );
  });

  it('setLogLevel переопределяет уровень для новых логгеров', () => {
    setLogLevel('error');
    const { backend, writes } = makeMockBackend();
    const log = getLogger('override-level', { backend });

    log.info('hidden');
    log.error('shown');

    expect(writes.map((r) => r.level)).toEqual(['error']);
  });

  it('файловый режим пишет и ротирует по размеру', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fa-logger-'));
    const filePath = join(dir, 'app.log');
    const backend = new FileLogBackend(filePath, { maxSizeBytes: 128 });
    const log = getLogger('file-test', { backend, level: 'debug' });

    try {
      for (let i = 0; i < 20; i++) {
        log.info(`line ${i}`);
      }

      // Файл создан и содержит записи с меткой модуля
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf8');
      expect(content).toContain('[file-test]');
      expect(content).toContain('[INFO]');

      // Ротация сработала: старый файл унесён в .old
      expect(existsSync(`${filePath}.old`)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parseLogLevel разбирает значения env', () => {
    expect(parseLogLevel('debug')).toBe('debug');
    expect(parseLogLevel('INFO')).toBe('info');
    expect(parseLogLevel('warn')).toBe('warn');
    expect(parseLogLevel('error')).toBe('error');
    expect(parseLogLevel('verbose')).toBe('info');
    expect(parseLogLevel(undefined)).toBe('info');
  });

  it('formatLogLine сериализует аргументы в строку', () => {
    const record: LogRecord = {
      level: 'warn',
      module: 'm',
      timestamp: '2026-09-26T00:00:00.000Z',
      args: ['ошибка', { code: 7 }],
    };
    const line = formatLogLine(record);
    expect(line).toContain('[WARN]');
    expect(line).toContain('[m]');
    expect(line).toContain('ошибка');
    expect(line).toContain('{"code":7}');
  });

  it('файловый бэкенд молча игнорирует ошибки fs (не роняет логгер)', () => {
    // «Родительский» путь — обычный файл: mkdir/append невозможны, но логгер жив
    const dir = mkdtempSync(join(tmpdir(), 'fa-logger-bad-'));
    try {
      const blocker = join(dir, 'blocker');
      writeFileSync(blocker, 'x', 'utf8');

      const backend = new FileLogBackend(join(blocker, 'app.log'), {
        maxSizeBytes: 64,
      });
      const log = getLogger('fs-errors', { backend });

      expect(() => log.error('boom')).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});