/// <reference types="vitest/globals" />
/**
 * Memory Backup — тесты копирования/восстановления памяти.
 *
 * Используют временные каталоги (без обращения к реальному data/).
 * Глобалы vitest (globals: true) — как остальные тесты проекта.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  backupMemoryData,
  listBackups,
  restoreMemoryData,
} from './memory-backup.js';

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('memory-backup: копирование и восстановление data/', () => {
  let dataDir: string;
  let backupsDir: string;

  beforeEach(() => {
    dataDir = makeTmpDir('mem-backup-data-');
    backupsDir = makeTmpDir('mem-backup-store-');
    fs.writeFileSync(path.join(dataDir, 'ai-memory.db'), 'db-bytes');
    fs.writeFileSync(path.join(dataDir, 'ai-memory.db-wal'), 'wal-bytes');
    fs.writeFileSync(path.join(dataDir, 'goals.json'), '{"goals":[]}');
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(backupsDir, { recursive: true, force: true });
  });

  it('backup копирует все файлы data/ в папку с timestamp', () => {
    const result = backupMemoryData({
      dataDir,
      backupsDir,
      now: new Date('2026-10-10T22:00:00Z'),
    });
    expect(result.files.sort()).toEqual([
      'ai-memory.db',
      'ai-memory.db-wal',
      'goals.json',
    ]);
    expect(fs.existsSync(result.backupPath)).toBe(true);
    expect(
      fs.readFileSync(path.join(result.backupPath, 'goals.json'), 'utf-8'),
    ).toBe('{"goals":[]}');
  });

  it('listBackups возвращает копии от свежей к старой', () => {
    backupMemoryData({
      dataDir,
      backupsDir,
      now: new Date('2026-10-09T10:00:00Z'),
    });
    backupMemoryData({
      dataDir,
      backupsDir,
      now: new Date('2026-10-10T10:00:00Z'),
    });
    const list = listBackups(backupsDir);
    expect(list).toHaveLength(2);
    expect(list[0]).toBe('2026-10-10-10-00-00');
  });

  it('restore по имени возвращает файлы в data/', () => {
    backupMemoryData({
      dataDir,
      backupsDir,
      now: new Date('2026-10-09T10:00:00Z'),
    });
    // Меняем текущий файл — restore должен вернуть старую версию
    fs.writeFileSync(path.join(dataDir, 'goals.json'), '{"changed":true}');
    const result = restoreMemoryData({
      dataDir,
      backupsDir,
      name: '2026-10-09-10-00-00',
    });
    expect(result.files).toContain('goals.json');
    expect(fs.readFileSync(path.join(dataDir, 'goals.json'), 'utf-8')).toBe(
      '{"goals":[]}',
    );
  });

  it('restore без имени берёт самую свежую копию', () => {
    backupMemoryData({
      dataDir,
      backupsDir,
      now: new Date('2026-10-08T10:00:00Z'),
    });
    fs.writeFileSync(path.join(dataDir, 'ai-memory.db'), 'new-bytes');
    backupMemoryData({
      dataDir,
      backupsDir,
      now: new Date('2026-10-10T10:00:00Z'),
    });
    fs.writeFileSync(path.join(dataDir, 'ai-memory.db'), 'broken-bytes');
    restoreMemoryData({ dataDir, backupsDir });
    expect(fs.readFileSync(path.join(dataDir, 'ai-memory.db'), 'utf-8')).toBe(
      'new-bytes',
    );
  });

  it('честные ошибки: пустой data/, нет копий, неизвестное имя', () => {
    const emptyDir = makeTmpDir('mem-backup-empty-');
    const noBackups = makeTmpDir('mem-backup-none-');
    try {
      expect(() => backupMemoryData({ dataDir: emptyDir, backupsDir })).toThrow(
        /пуст/,
      );
      expect(() =>
        restoreMemoryData({ dataDir, backupsDir: noBackups, name: 'no-such' }),
      ).toThrow(/Копий не найдено/);
      // Копия есть, но имя неверное
      backupMemoryData({ dataDir, backupsDir });
      expect(() =>
        restoreMemoryData({ dataDir, backupsDir, name: 'no-such' }),
      ).toThrow(/не найдена/);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
      fs.rmSync(noBackups, { recursive: true, force: true });
    }
  });
});
