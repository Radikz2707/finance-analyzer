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

import path from 'node:path';

import { app, BrowserWindow, ipcMain } from 'electron';

import {
  buildDirectorState,
  buildHarnessState,
  handleAsk,
  handleHarnessPayload,
  handleHarnessRun,
  handleLog,
  handlePanel,
  handleStatus,
  shutdownAppState,
  subscribeEvents,
  type AppState,
} from './ipc-core.js';

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
  const director = await buildDirectorState({});
  // Диспетчер опционален: сбой сборки не мешает чату с Директором.
  const harness = await buildHarnessState({});
  appState = { director, harness };

  // Живой стриминг всех событий аудита в renderer
  unsubscribeDirector = subscribeEvents(director, (event) => {
    sendToRenderer('director:event', event);
  });
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

  ipcMain.handle('portfolio:status', () => ({
    excelPath: process.env.EXCEL_FILE_PATH ?? '',
    sourceLabel: appState?.director.sourceLabel ?? '—',
  }));

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('harness:payload', () =>
    handleHarnessPayload(appState?.harness ?? null),
  );

  ipcMain.handle('harness:run', () =>
    handleHarnessRun(appState?.harness ?? null),
  );
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
