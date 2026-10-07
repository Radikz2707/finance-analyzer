/**
 * Desktop Main Process — окно, IPC, жизненный цикл.
 *
 * Один DirectorAgent на весь lifecycle приложения (state в ipc-core),
 * плюс «Гибридный диспетчер» (createHarness): фоновый конвейер, QUIK,
 * аномалии, Telegram-уведомления.
 *
 * Стриминг: каждое событие аудита (подписка onEvent) немедленно уходит
 * в renderer по каналу `director:event`; завершение ответа — `director:reply`.
 *
 * Собирается esbuild в CJS (main.cjs): импорт `electron` через require
 * гарантированно работает; `import.meta.url` подменяется сборщиком
 * (см. desktop/build.mjs — define для createRequire в xlsx-парсере).
 * preload тоже CJS (требование sandboxed preload).
 */

import 'dotenv/config';

import * as fs from 'node:fs';

// Должен идти ДО импортов ipc-core: модули уровня бандла (xlsx-parser-config
// и др.) читают process.env при загрузке, а .env упакованного приложения
// лежит в %APPDATA%\finance-analyzer\.env (в Program Files его нет).
import './load-settings.js';

import path from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type {
  OpenDialogOptions,
  PrintToPDFOptions,
  SaveDialogOptions,
} from 'electron';
import { resolveReportsDir } from '../src/js/modules/app-paths.js';
import {
  loadDesktopSettings,
  resolveOllamaModel,
  saveDesktopSettings,
} from './load-settings.js';

import {
  buildDashboardHtml,
  buildDirectorState,
  buildHarnessState,
  handleAsk,
  handleHarnessExport,
  handleHarnessPayload,
  handleHarnessRun,
  handleLog,
  handlePanel,
  handleStatus,
  reloadPortfolio,
  reconnectOllama,
  shutdownAppState,
  subscribeEvents,
  type AppState,
} from './ipc-core.js';
import { OllamaClient } from '../src/js/modules/pipeline/director/ollama-client.js';

// Пути к собранным артефактам (esbuild: desktop/dist/*)
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');
const RENDERER_INDEX = path.join(__dirname, 'renderer', 'index.html');

let mainWindow: BrowserWindow | null = null;
let appState: AppState | null = null;
let unsubscribeDirector: (() => void) | null = null;

/** Отправить сообщение в renderer, если окно живо */
function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/** Инициализация подсистем: Директор + Гибридный диспетчер + стриминг */
async function initAppState(): Promise<void> {
  // Путь БД памяти ИИ резолвится внутри createDatabase() (database.ts):
  // в упакованном Electron — %APPDATA%/finance-analyzer/ai-memory.db
  // (см. isPackagedApp/resolveDefaultDbPath). Здесь env задавать нельзя:
  // module-level инициализация core.ts выполняется при загрузке бандла
  // раньше тела main.ts, а static imports hoist-ятся в начало модуля.
  // getOllamaModel — живой источник модели: выбор в настройках приложения
  // подхватывается директором БЕЗ перезапуска (модель читается на запрос).
  const director = await buildDirectorState({
    getOllamaModel: resolveOllamaModel,
  });
  // Диспетчер опционален: сбой сборки не мешает чату с Директором.
  const harness = await buildHarnessState({});
  appState = { director, harness };

  // Живой стриминг всех событий аудита в renderer
  unsubscribeDirector = subscribeEvents(director, (event) => {
    sendToRenderer('director:event', event);
  });
}

/** Отформатировать метку времени для имён файлов (YYYY-MM-DDTHH-MM-SS) */
function timestampLabel(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Сформировать PDF из HTML-строки: скрытое окно + webContents.printToPDF.
 * Возвращает Buffer для записи в выбранный пользователем файл.
 */
async function renderDashboardPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  try {
    await win.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(html),
    );
    const options: PrintToPDFOptions = {
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'default' },
    };
    return await win.webContents.printToPDF(options);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Регистрация IPC-хендлеров (вызывается после готовности состояния) */
function registerIpc(): void {
  ipcMain.handle('director:ask', async (_event, question: string) => {
    if (!appState) {
      throw new Error('Состояние приложения не инициализировано');
    }
    const result = await handleAsk(
      appState.director,
      typeof question === 'string' ? question : String(question ?? ''),
    );
    // Дублируем ответ потоком (в дополнение к возврату invoke)
    sendToRenderer('director:reply', result);
    return result;
  });

  ipcMain.handle('director:status', () =>
    appState ? handleStatus(appState.director) : null,
  );

  ipcMain.handle('director:log', (_event, count?: number) =>
    appState ? handleLog(appState.director, count) : { entries: [], total: 0 },
  );

  ipcMain.handle('director:panel', () =>
    appState ? handlePanel(appState.director) : null,
  );

  // Переподключение Ollama из UI
  ipcMain.handle('director:reconnect-ollama', async () => {
    if (!appState) {
      return { success: false, label: '', message: 'Приложение не инициализировано' };
    }
    const result = await reconnectOllama(appState.director, {
      getOllamaModel: resolveOllamaModel,
    });
    return result;
  });

  // Перезагрузка портфеля из Excel
  ipcMain.handle('portfolio:reload', async (_event, excelPath: string) => {
    if (!appState) {
      return { success: false, sourceLabel: '', assetsCount: 0, message: 'Приложение не инициализировано' };
    }
    return await reloadPortfolio(appState.director, excelPath);
  });

  ipcMain.handle('portfolio:status', () => ({
    excelPath: process.env.EXCEL_FILE_PATH ?? '',
    sourceLabel: appState?.director.sourceLabel ?? '—',
  }));

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('settings:get', () => ({
    excelFilePath: process.env.EXCEL_FILE_PATH ?? '',
    // Актуальная модель: приоритет у выбора пользователя в settings.json
    ollamaModel: resolveOllamaModel() ?? '',
  }));

  ipcMain.handle('settings:pick-excel', async () => {
    const options: OpenDialogOptions = {
      title: 'Выберите Excel-файл портфеля QUIK',
      properties: ['openFile'],
      filters: [
        { name: 'Excel-файлы', extensions: ['xlsx', 'xlsm', 'xls'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return {
        canceled: true,
        excelFilePath: process.env.EXCEL_FILE_PATH ?? '',
      };
    }
    const filePath = result.filePaths[0];
    process.env.EXCEL_FILE_PATH = filePath;
    saveDesktopSettings({
      ...loadDesktopSettings(),
      excelFilePath: filePath,
    });
    return { canceled: false, excelFilePath: filePath };
  });

  // Список моделей, загруженных в локальную Ollama ([] — сервер недоступен)
  ipcMain.handle('settings:get-models', async () => {
    try {
      const client = new OllamaClient({
        model: process.env.OLLAMA_MODEL || undefined,
      });
      return await client.getModels();
    } catch {
      return [] as string[];
    }
  });

  // Сохранить выбранную модель Ollama. Модель читается на каждый запрос
  // (getOllamaModel → resolveOllamaModel), поэтому применяется сразу,
  // без перезапуска приложения.
  ipcMain.handle('settings:set-ollama-model', (_event, model: string) => {
    const next = typeof model === 'string' ? model.trim() : '';
    if (!next) return false;
    saveDesktopSettings({
      ...loadDesktopSettings(),
      ollamaModel: next,
    });
    process.env.OLLAMA_MODEL = next;
    return true;
  });

  ipcMain.handle('settings:restart', () => {
    app.relaunch();
    app.exit(0);
    return true;
  });

  ipcMain.handle('harness:payload', () =>
    handleHarnessPayload(appState?.harness ?? null),
  );

  ipcMain.handle('harness:run', () =>
    handleHarnessRun(appState?.harness ?? null),
  );

  // Экспорт HTML-дашборда диспетчера в файл (+ открытие в браузере)
  ipcMain.handle('harness:export-report', async () => {
    const result = await handleHarnessExport(appState?.harness ?? null);
    if (result.ok && result.filePath) {
      void shell.openPath(result.filePath);
    }
    return result;
  });

  // Экспорт дашборда в PDF: диалог выбора места сохранения
  ipcMain.handle('harness:export-pdf', async () => {
    if (!appState) {
      return {
        ok: false,
        message: 'Состояние приложения не инициализировано',
      };
    }
    try {
      const payload =
        appState.harness === null
          ? null
          : await appState.harness.bridge.getDashboardPayload();
      if (!payload) {
        return { ok: false, message: 'Данные диспетчера ещё не сформированы' };
      }
      const now = new Date();
      const html = buildDashboardHtml(payload, now);
      const saveOptions: SaveDialogOptions = {
        title: 'Сохранить дашборд диспетчера в PDF',
        defaultPath: path.join(
          resolveReportsDir(),
          `dashboard_${timestampLabel(now)}.pdf`,
        ),
        filters: [{ name: 'PDF-файлы', extensions: ['pdf'] }],
      };
      const picked =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showSaveDialog(mainWindow, saveOptions)
          : await dialog.showSaveDialog(saveOptions);
      if (picked.canceled || !picked.filePath) {
        return { ok: false, message: 'Сохранение отменено' };
      }
      const pdf = await renderDashboardPdf(html);
      fs.writeFileSync(picked.filePath, pdf);
      void shell.openPath(picked.filePath);
      return {
        ok: true,
        message: `Дашборд сохранён в PDF: ${picked.filePath}`,
        filePath: picked.filePath,
      };
    } catch (err) {
      return {
        ok: false,
        message: `Ошибка экспорта PDF: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  });
}

/** Создать главное окно */
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: `Finance Analyzer v${app.getVersion()} — Директор и агенты`,
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void win.loadFile(RENDERER_INDEX);
  win.once('ready-to-show', () => {
    win.show();
  });
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
  return win;
}

// ──────────────────────────────────────────────
// Жизненный цикл
// ──────────────────────────────────────────────

// Одиночный экземпляр: второй запуск фокусирует существующее окно
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let shuttingDown = false;

/** Graceful shutdown: stop() подсистем → выход */
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  void (async () => {
    try {
      if (appState) {
        await shutdownAppState(appState);
      }
    } catch {
      // Остановка — best effort
    }
    try {
      unsubscribeDirector?.();
    } catch {
      // no-op
    }
  })();
}

app.on('before-quit', shutdown);

app.on('window-all-closed', () => {
  // На Windows/Linux закрытие всех окон завершает приложение
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // macOS: пересоздание окна по клику на доке
  if (BrowserWindow.getAllWindows().length === 0 && appState) {
    mainWindow = createWindow();
  }
});

void app.whenReady().then(async () => {
  await initAppState();
  registerIpc();
  mainWindow = createWindow();
});
