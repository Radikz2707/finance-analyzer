/**
 * Загрузка/сохранение пользовательских настроек десктоп-приложения.
 *
 * Упакованный exe не содержит `.env` (секреты не упаковываются в app.asar),
 * а `cwd` = каталог установки (Program Files). Поэтому пользовательские
 * настройки хранятся в `%APPDATA%\finance-analyzer\settings.json`, а при
 * старте применяются ДО инициализации остальных модулей: ряд модулей
 * (например, xlsx-parser-config) читают `process.env` на уровне модуля.
 *
 * Импортируется первым в main.ts (side-effect import), сразу после
 * `import 'dotenv/config'`, чтобы:
 * - в dev-режиме корневой `.env` (через dotenv/config) имел приоритет;
 * - отсутствующие переменные дозаполнялись из settings.json / `.env`;
 * - упакованное приложение получало путь к Excel без ручного редактирования.
 */

import { app } from 'electron';
import { config as loadEnv } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SETTINGS_DIR = path.join(app.getPath('userData'), 'finance-analyzer');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

/** Пользовательские настройки приложения */
export interface DesktopSettings {
  /** Путь к Excel-файлу портфеля QUIK */
  excelFilePath?: string;
  /** Модель Ollama для общения с директором (по умолчанию qwen3:14b) */
  ollamaModel?: string;
}

/** Прочитать настройки (пустые при отсутствии/повреждении файла) */
export function loadDesktopSettings(): DesktopSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as DesktopSettings;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Сохранить настройки (создаёт каталог при необходимости) */
export function saveDesktopSettings(settings: DesktopSettings): void {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

// ── Применение настроек при старте (до загрузки остальных модулей) ──

// Обратная совместимость: .env в каталоге настроек (override: false).
const LEGACY_ENV_FILE = path.join(SETTINGS_DIR, '.env');
if (app.isPackaged && fs.existsSync(LEGACY_ENV_FILE)) {
  loadEnv({ path: LEGACY_ENV_FILE });
}

// Основной источник: settings.json.
const savedSettings = loadDesktopSettings();
if (savedSettings.excelFilePath && !process.env.EXCEL_FILE_PATH) {
  process.env.EXCEL_FILE_PATH = savedSettings.excelFilePath;
}
if (savedSettings.ollamaModel && !process.env.OLLAMA_MODEL) {
  process.env.OLLAMA_MODEL = savedSettings.ollamaModel;
}
