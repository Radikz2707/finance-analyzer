/**
 * Общие пути приложения (Node / Electron).
 *
 * Помогает отличать упакованное Electron-приложение (рядом с exe лежит
 * resources/app.asar) от dev-режима и выдавать гарантированно записываемый
 * каталог данных:
 * - упакованное приложение (Program Files и т.п.): %APPDATA%/finance-analyzer;
 * - dev/CLI (обычный Node): <cwd>/data — поведение не меняется.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface AppPathContext {
  /** Исполняемый файл приложения (по умолчанию process.execPath). */
  execPath?: string;
  /** Версия Electron (по умолчанию process.versions.electron). */
  electronVersion?: string;
}

/**
 * Определяет, запущено ли приложение в упакованном Electron
 * (в resources лежит app.asar): тогда cwd защищён системой
 * (Program Files) и писать рядом нельзя.
 */
export function isPackagedApp(
  execPath: string = process.execPath,
  electronVersion: string | undefined = process.versions?.electron,
): boolean {
  if (typeof electronVersion !== 'string') return false;
  // Упакованное приложение: рядом с исполняемым файлом лежит resources/app.asar.
  // В dev-режиме (electron.exe из node_modules) app.asar отсутствует,
  // в обычном Node process.versions.electron не определён.
  const resourcesDir = path.join(path.dirname(execPath), 'resources');
  return fs.existsSync(path.join(resourcesDir, 'app.asar'));
}

/**
 * Гарантированно записываемый каталог данных приложения.
 * - Упакованное Electron-приложение: %APPDATA%/finance-analyzer
 *   (совпадает с app.getPath('userData') при name=finance-analyzer).
 * - Dev/CLI: <cwd>/data (эквивалент прежнего поведения).
 */
export function resolveAppDataDir(context: AppPathContext = {}): string {
  if (!isPackagedApp(context.execPath, context.electronVersion)) {
    return path.join(process.cwd(), 'data');
  }
  const base =
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, 'finance-analyzer');
}

/**
 * Каталог для файловых отчётов (report.html/report.md, экспорт дашбордов).
 * - Упакованное приложение: %APPDATA%/finance-analyzer/reports;
 * - Dev/CLI: <cwd> (прежнее поведение — отчёт рядом с проектом).
 */
export function resolveReportsDir(
  isPackaged: boolean = isPackagedApp(),
  cwd: string = process.cwd(),
): string {
  if (!isPackaged) return cwd;
  const base =
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, 'finance-analyzer', 'reports');
}
