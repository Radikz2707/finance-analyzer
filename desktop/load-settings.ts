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

/** Кэш настроек: единый источник для живого чтения в рантайме */
let cachedSettings: DesktopSettings | null = null;

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

/** Актуальные настройки (с кэшем; обновляется через refreshDesktopSettings) */
export function getDesktopSettings(): DesktopSettings {
  if (cachedSettings === null) {
    cachedSettings = loadDesktopSettings();
  }
  return cachedSettings;
}

/** Перечитать settings.json и обновить кэш (после сохранения из UI) */
export function refreshDesktopSettings(): DesktopSettings {
  cachedSettings = loadDesktopSettings();
  return cachedSettings;
}

/** Сохранить настройки (создаёт каталог при необходимости) */
export function saveDesktopSettings(settings: DesktopSettings): void {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  // Немедленно актуализируем кэш — выбор Ollama-модели применяется без перезапуска
  cachedSettings = settings;
}

/**
 * Актуальная модель Ollama для общения с Director.
 * Приоритет у выбора пользователя в приложении (settings.json);
 * env (dotenv/системный OLLAMA_MODEL) — только как значение по умолчанию.
 */
export function resolveOllamaModel(): string | undefined {
  const saved = getDesktopSettings().ollamaModel;
  if (saved && saved.trim() !== '') return saved.trim();
  const env = process.env.OLLAMA_MODEL;
  return env && env.trim() !== '' ? env.trim() : undefined;
}

// ── Применение настроек при старте (до загрузки остальных модулей) ──

// Обратная совместимость: .env в каталоге настроек (override: false).
const LEGACY_ENV_FILE = path.join(SETTINGS_DIR, '.env');
if (app.isPackaged && fs.existsSync(LEGACY_ENV_FILE)) {
  loadEnv({ path: LEGACY_ENV_FILE });
}

// Основной источник: settings.json. Модель Ollama применяется ВСЕГДА,
// если выбрана в приложении (выбор пользователя важнее env по умолчанию),
// и подхватывается «живо» через resolveOllamaModel() — без перезапуска.
const savedSettings = loadDesktopSettings();
if (savedSettings.excelFilePath && !process.env.EXCEL_FILE_PATH) {
  process.env.EXCEL_FILE_PATH = savedSettings.excelFilePath;
}
if (savedSettings.ollamaModel && savedSettings.ollamaModel.trim() !== '') {
  process.env.OLLAMA_MODEL = savedSettings.ollamaModel.trim();
}
cachedSettings = savedSettings;
