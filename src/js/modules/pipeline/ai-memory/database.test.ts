/**
 * Database Tests — проверка создания инстанса SQLite-базы.
 *
 * Ключевой сценарий: file-based ветка должна сама создавать недостающий
 * каталог (better-sqlite3 не делает этого) и уважать переопределение пути
 * через AI_MEMORY_DB_PATH. Это чинит краш упакованного Electron-приложения,
 * где cwd ≠ корню проекта и папки ./data нет.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveAppDataDir } from '../../app-paths.js';
import {
  createDatabase,
  isPackagedApp,
  resolveDefaultDbPath,
} from './database.js';

// ──────────────────────────────────────────────
// File-based ветка (production)
// ──────────────────────────────────────────────

describe('createDatabase — file-based ветка', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-memory-db-test-'));
    // Vitest принудительно ставит NODE_ENV=test → для проверки file-based
    // ветки временно переключаем окружение и задаём путь в свежей папке.
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(
      'AI_MEMORY_DB_PATH',
      path.join(tmpDir, 'nested', 'ai-memory.db'),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('создаёт недостающую директорию перед открытием базы', () => {
    const dbPath = process.env.AI_MEMORY_DB_PATH as string;
    expect(fs.existsSync(path.dirname(dbPath))).toBe(false);

    const db = createDatabase();
    db.close();

    // Директория и файл базы гарантированно созданы
    expect(fs.existsSync(path.dirname(dbPath))).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('уважает переопределение пути через AI_MEMORY_DB_PATH', () => {
    const dbPath = process.env.AI_MEMORY_DB_PATH as string;

    const db = createDatabase();
    db.close();

    // База лежит именно в указанном месте, а не в ./data
    expect(dbPath).not.toContain('/data/');
    expect(fs.existsSync(dbPath)).toBe(true);
  });
});

// ──────────────────────────────────────────────
// In-memory ветка (тесты)
// ──────────────────────────────────────────────

describe('createDatabase — in-memory ветка', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('использует :memory: при NODE_ENV=test и не трогает файловую систему', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const neverCreated = path.join(os.tmpdir(), 'ai-memory-never-created');
    vi.stubEnv('AI_MEMORY_DB_PATH', path.join(neverCreated, 'x.db'));

    const db = createDatabase();
    db.close();

    // Даже если env задан, в тестовом режиме файл не создаётся
    expect(fs.existsSync(neverCreated)).toBe(false);
  });
});

// ──────────────────────────────────────────────
// Упакованное Electron-приложение (Program Files)
// ──────────────────────────────────────────────

describe('createDatabase — упакованное Electron-приложение', () => {
  let tmpDir: string;
  let fakeExe: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-install-test-'));

    // Структура установленного приложения: .../Finance Analyzer.exe
    // + resources/app.asar (как в Program Files).
    const installDir = path.join(tmpDir, 'Finance Analyzer');
    const resourcesDir = path.join(installDir, 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.writeFileSync(path.join(resourcesDir, 'app.asar'), '');
    fakeExe = path.join(installDir, 'Finance Analyzer.exe');

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APPDATA', path.join(tmpDir, 'roaming'));
    // AI_MEMORY_DB_PATH сознательно не задаём — проверяем дефолтную логику
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('распознаёт упакованное приложение по resources/app.asar', () => {
    expect(isPackagedApp(fakeExe, '38.8.6')).toBe(true);

    // electron.exe из node_modules (dev-режим): app.asar рядом отсутствует
    const devElectron = path.join(
      tmpDir,
      'node_modules',
      'electron',
      'dist',
      'electron.exe',
    );
    fs.mkdirSync(path.dirname(devElectron), { recursive: true });
    expect(isPackagedApp(devElectron, '38.8.6')).toBe(false);
  });

  it('не пишет в каталог установки (Program Files), а использует %APPDATA%\\finance-analyzer', () => {
    const db = createDatabase({
      execPath: fakeExe,
      electronVersion: '38.8.6',
    });
    db.close();

    const expectedDir = path.join(tmpDir, 'roaming', 'finance-analyzer');
    expect(fs.existsSync(expectedDir)).toBe(true);
    expect(fs.existsSync(path.join(expectedDir, 'ai-memory.db'))).toBe(true);
    // Рядом с exe (в «Program Files») data/ не создаётся
    expect(fs.existsSync(path.join(path.dirname(fakeExe), 'data'))).toBe(false);
  });

  it('resolveAppDataDir указывает в %APPDATA%\\finance-analyzer', () => {
    expect(
      resolveAppDataDir({ execPath: fakeExe, electronVersion: '38.8.6' }),
    ).toBe(path.join(tmpDir, 'roaming', 'finance-analyzer'));
  });
});

// ──────────────────────────────────────────────
// Дефолтный путь
// ──────────────────────────────────────────────

describe('resolveDefaultDbPath', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('в обычном Node (не packaged) возвращает ./data/ai-memory.db', () => {
    expect(resolveDefaultDbPath()).toBe('./data/ai-memory.db');
  });

  it('в обычном Node resolveAppDataDir возвращает <cwd>/data', () => {
    expect(resolveAppDataDir()).toBe(path.join(process.cwd(), 'data'));
  });
});
