/**
 * Memory Backup — резервное копирование и восстановление «памяти» проекта.
 *
 * Запуск:
 *   npm run backup            → копия data/ в backups/<timestamp>/
 *   npm run restore -- --latest
 *   npm run restore -- 2026-10-10-22-00-00
 *
 * Что копируется: все файлы в корне data/ (ai-memory.db + WAL/SHM,
 * goals.json, локальные кэши). Подкаталоги data/ (в т.ч. предыдущие
 * копии) не трогаются.
 *
 * Перенос на другой компьютер: скопируйте полученную папку backups/<ts>/
 * (или весь data/) — после восстановления ИИ помнит всё: решения,
 * KPI-историю, цели.
 *
 * ⚠️ Надёжнее делать backup при закрытом приложении: база SQLite живёт
 * в WAL-режиме, копия db+wal+shm снимается «как есть».
 */

import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Результат резервного копирования */
export interface BackupResult {
  /** Имя папки копии внутри backupsDir */
  name: string;
  /** Путь к папке копии */
  backupPath: string;
  /** Имена скопированных файлов */
  files: string[];
}

/** Файлы data/ для копии: всё в корне, без подкаталогов */
function listDataFiles(dataDir: string): string[] {
  if (!fs.existsSync(dataDir)) {
    throw new Error(`Каталог данных не найден: ${dataDir}`);
  }
  return fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

/** Сделать копию data/ в backupsDir/<timestamp> */
export function backupMemoryData(opts: {
  dataDir: string;
  backupsDir: string;
  now?: Date;
}): BackupResult {
  const files = listDataFiles(opts.dataDir);
  if (files.length === 0) {
    throw new Error(`Каталог данных пуст: ${opts.dataDir}`);
  }
  const stamp = (opts.now ?? new Date())
    .toISOString()
    .slice(0, 19)
    .replace('T', '-')
    .replaceAll(':', '-');
  const backupPath = path.join(opts.backupsDir, stamp);
  fs.mkdirSync(backupPath, { recursive: true });
  for (const file of files) {
    fs.copyFileSync(path.join(opts.dataDir, file), path.join(backupPath, file));
  }
  return { name: stamp, backupPath, files };
}

/** Список доступных копий (имена папок, по убыванию = от свежей) */
export function listBackups(backupsDir: string): string[] {
  if (!fs.existsSync(backupsDir)) {
    return [];
  }
  return fs
    .readdirSync(backupsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

/** Восстановить data/ из копии (по имени или самой свежей) */
export function restoreMemoryData(opts: {
  dataDir: string;
  backupsDir: string;
  /** Имя копии; undefined/пусто — самая свежая */
  name?: string;
}): BackupResult {
  const available = listBackups(opts.backupsDir);
  if (available.length === 0) {
    throw new Error(`Копий не найдено в ${opts.backupsDir}`);
  }
  const name = opts.name || available[0];
  if (!available.includes(name)) {
    throw new Error(
      `Копия «${name}» не найдена. Доступны: ${available.join(', ')}`,
    );
  }
  const backupPath = path.join(opts.backupsDir, name);
  const files = fs
    .readdirSync(backupPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  fs.mkdirSync(opts.dataDir, { recursive: true });
  for (const file of files) {
    fs.copyFileSync(path.join(backupPath, file), path.join(opts.dataDir, file));
  }
  return { name, backupPath, files };
}

function printBackupResult(result: BackupResult): void {
  console.log(`✅ Копия создана: ${result.backupPath}`);
  for (const file of result.files) {
    const size = fs.statSync(path.join(result.backupPath, file)).size;
    console.log(`   • ${file} (${(size / 1024).toFixed(1)} КБ)`);
  }
}

/** CLI-точка входа выполняется только при прямом запуске (не при импорте в тестах) */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const dataDir = path.resolve('data');
  const backupsDir = path.resolve('backups');
  const mode = process.argv[2] ?? 'backup';

  try {
    if (mode === 'backup') {
      printBackupResult(backupMemoryData({ dataDir, backupsDir }));
      console.log(
        '\n💡 Перенос на другой компьютер: скопируйте папку backups/ (или весь data/) и выполните restore.',
      );
      return;
    }
    if (mode === 'restore') {
      const nameArg = process.argv[3];
      const name = nameArg && !nameArg.startsWith('--') ? nameArg : undefined;
      const result = restoreMemoryData({ dataDir, backupsDir, name });
      console.log(`✅ Восстановлено из копии: ${result.name}`);
      for (const file of result.files) {
        console.log(`   • ${file}`);
      }
      return;
    }
    console.error(`Неизвестный режим: ${mode}. Доступно: backup | restore`);
    process.exitCode = 1;
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (isDirectRun()) {
  void main();
}
