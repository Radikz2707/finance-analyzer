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
  getDesktopSettings,
  loadDesktopSettings,
  resolveOllamaModel,
  saveDesktopSettings,
} from './load-settings.js';

import {
  buildDashboardHtml,
  buildDirectorState,
  buildHarnessState,
  handleAsk,
  handleAutonomousChatCommand,
  handleAutonomousRunOnce,
  handleAutonomousStart,
  handleAutonomousStatus,
  handleAutonomousStop,
  handleProactiveIdeas,
  handleLastPipelineReport,
  loadLastPipelineReport,
  resolveAnalysisStatus,
  runPipelineReport,
  buildAnalysisHtml,
  handleGoalsAdd,
  handleGoalsList,
  handleLastAnalysis,
  handleHarnessExport,
  handleHarnessPayload,
  handleHarnessRun,
  handleLog,
  handlePanel,
  handleStatus,
  reloadPortfolio,
  reconnectOllama,
  shutdownAppState,
  subscribeActivity,
  subscribeEvents,
  type AppState,
} from './ipc-core.js';
import { createAutonomousBridge } from './autonomous-bridge.js';
import { OllamaClient } from '../src/js/modules/pipeline/director/ollama-client.js';

// Пути к собранным артефактам (esbuild: desktop/dist/*)
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');
const RENDERER_INDEX = path.join(__dirname, 'renderer', 'index.html');

let mainWindow: BrowserWindow | null = null;
let appState: AppState | null = null;
let unsubscribeDirector: (() => void) | null = null;
let excelFileWatcher: fs.FSWatcher | null = null;
let lastExcelMtime: number | null = null;
let excelWatchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const EXCEL_WATCH_DEBOUNCE_MS = 3000; // 3 секунды debounce для Windows

/** Логгер main-процесса */
function log(level: 'info' | 'warn', message: string): void {
  const prefix = level === 'warn' ? '⚠️' : 'ℹ️';
  console[level](`[desktop] ${prefix} ${message}`);
}

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
  appState = {
    director,
    harness,
    autonomous: null,
    lastPipelineReport: null,
    pipelineRunning: false,
  };

  // Автономный цикл: цели + фоновый watch (один организм с чатом и диспетчером)
  appState.autonomous = createAutonomousBridge({
    director: appState.director.director,
    // Живые уведомления о выполненных целях в renderer
    onCycle: (events) => {
      for (const event of events) {
        sendToRenderer('autonomous:update', event);
      }
    },
  });
  await appState.autonomous.start();

  // Реплики-задачи из свободного текста («давай добавим…») → цель цикла:
  // Director получает goalIntake-хук, замыкающийся на AutonomousBridge.
  const autonomousBridge = appState.autonomous;
  const directorAsRecord = appState.director.director as unknown as Record<
    string,
    unknown
  >;
  directorAsRecord.config = {
    goalIntake: {
      addGoal: async (text: string) => {
        const goal = await autonomousBridge.addGoal(text);
        return { id: goal.id, name: goal.name };
      },
    },
  };

  // Живой стриминг всех событий аудита в renderer
  unsubscribeDirector = subscribeEvents(
    appState.director.director.agent,
    (event) => {
      sendToRenderer('director:event', event);
    },
  );

  // Живой стриминг шагов агентов (started/step/completed/failed) в renderer
  subscribeActivity(appState.director.director.agent, (event) => {
    sendToRenderer('director:activity', event);
  });

  // Запускаем файловый воркер на Excel-файл
  const excelPath = process.env.EXCEL_FILE_PATH;
  if (excelPath) {
    startExcelWatcher(excelPath);
  }

  // Сбрасываем кэш анализа — Director должен работать со свежими данными
  // из Excel, а не использовать кэшированные результаты предыдущих сессий
  appState.director.director.agent.resetAnalysisCache();

  // Загружаем последний отчёт report.html с диска (если был запущен npm run pipeline)
  // Отчёт сохраняется в памяти (state.lastPipelineReport) и доступен даже при удалении файла
  loadLastPipelineReport(appState);
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
    };
    return await win.webContents.printToPDF(options);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/**
 * Запустить файловый воркер на Excel-файл: при изменении файла —
 * перезагрузить портфель и уведомить рендерер.
 *
 * ⚠️ Windows: fs.watch срабатывает 5-10 раз при одном сохранении файла.
 * Добавлен debounce (3 сек), чтобы не перезагружать портфель постоянно.
 */
function startExcelWatcher(excelPath: string): void {
  // Остановить старый воркер если есть
  stopExcelWatcher();

  if (!excelPath || !fs.existsSync(excelPath)) {
    log('info', 'Excel-файл не указан или не существует — воркер не запущен');
    return;
  }

  log('info', `Запущен файловый воркер на Excel: ${excelPath}`);

  try {
    // Читаем начальное время модификации
    const stats = fs.statSync(excelPath);
    lastExcelMtime = stats.mtimeMs;

    // Создаём воркер
    excelFileWatcher = fs.watch(
      excelPath,
      { persistent: true },
      (eventType) => {
        if (eventType !== 'change') return;

        // Debounce: игнорируем множественные срабатывания на Windows
        if (excelWatchDebounceTimer) {
          return;
        }

        excelWatchDebounceTimer = setTimeout(() => {
          excelWatchDebounceTimer = null;

          try {
            const stats = fs.statSync(excelPath);
            if (stats.mtimeMs === lastExcelMtime) return;

            lastExcelMtime = stats.mtimeMs;
            log(
              'info',
              `Excel-файл изменён: ${excelPath} — перезагрузка портфеля`,
            );

            // Перезагружаем портфель
            if (appState) {
              // Сбрасываем кэш анализа — нужно провести новый анализ
  appState.director.director.agent.resetAnalysisCache();
              log('info', 'Кэш анализа сброшен (Excel изменён)');

              reloadPortfolio(appState.director, excelPath).then((result) => {
                if (result.success) {
                  log(
                    'info',
                    `Портфель перезагружен: ${result.assetsCount} активов`,
                  );
                  // Уведомляем рендерер
                  sendToRenderer('portfolio:updated', {
                    assetsCount: result.assetsCount,
                    sourceLabel: result.sourceLabel,
                  });
                } else {
                  log('warn', `Ошибка перезагрузки портфеля: ${result.message}`);
                }
              });
            }
          } catch (err) {
            log('warn', `Ошибка при проверке Excel-файла: ${err}`);
          }
        }, EXCEL_WATCH_DEBOUNCE_MS);
      },
    );
  } catch (err) {
    log('warn', `Не удалось запустить воркер на Excel: ${err}`);
  }
}

/** Остановить файловый воркер на Excel-файл */
function stopExcelWatcher(): void {
  if (excelFileWatcher) {
    excelFileWatcher.close();
    excelFileWatcher = null;
  }
  if (excelWatchDebounceTimer) {
    clearTimeout(excelWatchDebounceTimer);
    excelWatchDebounceTimer = null;
  }
  lastExcelMtime = null;
  log('info', 'Файловый воркер Excel остановлен');
}

/** Регистрация IPC-хендлеров (вызывается после готовности состояния) */
function registerIpc(): void {
  ipcMain.handle('director:ask', async (_event, question: string) => {
    if (!appState) {
      throw new Error('Состояние приложения не инициализировано');
    }
    const q = typeof question === 'string' ? question : String(question ?? '');
    // Чат-команды автономного цикла (/goal, /goals, /autonomous) — без LLM
    const autonomousResult = await handleAutonomousChatCommand(appState, q);
    const result = autonomousResult ?? (await handleAsk(appState.director, q));
    // Дублируем ответ потоком (в дополнение к возврату invoke)
    sendToRenderer('director:reply', result);
    return result;
  });

  // ── Идеи Директора (портфельные + проектные) ──
  ipcMain.handle('director:proactive', () =>
    appState ? handleProactiveIdeas(appState) : [],
  );

  // ── Автономный цикл: цели и управление ──
  ipcMain.handle('goals:list', async (_event, status?: string) =>
    appState
      ? handleGoalsList(
          appState,
          status as
            | 'pending'
            | 'active'
            | 'paused'
            | 'completed'
            | 'cancelled'
            | undefined,
        )
      : [],
  );

  ipcMain.handle('goals:add', async (_event, text: string) => {
    if (!appState) {
      throw new Error('Состояние приложения не инициализировано');
    }
    return handleGoalsAdd(appState, String(text ?? ''));
  });

  ipcMain.handle('autonomous:status', async () =>
    appState ? handleAutonomousStatus(appState) : null,
  );

  ipcMain.handle('autonomous:start', async (_event, intervalSec?: number) =>
    appState ? handleAutonomousStart(appState, intervalSec) : null,
  );

  ipcMain.handle('autonomous:stop', async () =>
    appState ? handleAutonomousStop(appState) : null,
  );

  ipcMain.handle('autonomous:run-once', async () =>
    appState
      ? handleAutonomousRunOnce(appState)
      : { started: false, message: 'Приложение не инициализировано' },
  );

  // ── Анализ портфеля: результат и экспорт ──
  ipcMain.handle('analysis:last', () =>
    appState ? handleLastAnalysis(appState) : null,
  );

  // ── Полный конвейер (как npm run pipeline) внутри приложения ──
  ipcMain.handle('pipeline:run', async () => {
    if (!appState) {
      throw new Error('Состояние приложения не инициализировано');
    }
    const info = await runPipelineReport(appState);
    // Опционально: открыть отчёт в системном браузере (галочка в шапке).
    // По умолчанию отчёт остаётся во вкладке «Анализ» (iframe).
    if (
      info.success &&
      info.htmlPath &&
      getDesktopSettings().openReportInBrowser === true
    ) {
      void shell.openPath(info.htmlPath);
    }
    return info;
  });
  ipcMain.handle('pipeline:last', () =>
    appState ? handleLastPipelineReport(appState) : null,
  );

  // ── Обратная связь по AI-рекомендациям ──
  ipcMain.handle(
    'recommendation:feedback',
    (_event, input: { ticker: string; feedback: 'good' | 'bad' }) =>
      appState ? handleRecommendationFeedback(appState, input) : { ok: false, message: 'Приложение не инициализировано' },
  );

  ipcMain.handle('analysis:export-html', async () => {
    if (!appState) {
      return { ok: false, message: 'Приложение не инициализировано' };
    }
    const info = handleLastAnalysis(appState.director);
    const now = new Date();
    // Приоритет: полный отчёт конвейера (report.html) → иначе сводка Директора
    const html =
      handleLastPipelineReport(appState)?.htmlContent ||
      (info.text ? buildAnalysisHtml(info, now) : '');
    if (!html) {
      return { ok: false, message: 'Анализ ещё не запускался' };
    }
    const saveOptions: SaveDialogOptions = {
      title: 'Сохранить анализ портфеля (HTML)',
      defaultPath: `analysis_${timestampLabel(now)}.html`,
      filters: [{ name: 'HTML-файлы', extensions: ['html'] }],
    };
    const save =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showSaveDialog(mainWindow, saveOptions)
        : await dialog.showSaveDialog(saveOptions);
    if (save.canceled || !save.filePath) {
      return { ok: false, message: 'Сохранение отменено' };
    }
    try {
      fs.writeFileSync(save.filePath, html, 'utf-8');
      return {
        ok: true,
        message: `Анализ сохранён: ${save.filePath}`,
        filePath: save.filePath,
      };
    } catch (err) {
      return {
        ok: false,
        message: `Ошибка сохранения: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });

  ipcMain.handle('analysis:export-pdf', async () => {
    if (!appState) {
      return { ok: false, message: 'Приложение не инициализировано' };
    }
    const info = handleLastAnalysis(appState.director);
    const now = new Date();
    const html =
      handleLastPipelineReport(appState)?.htmlContent ||
      (info.text ? buildAnalysisHtml(info, now) : '');
    if (!html) {
      return { ok: false, message: 'Анализ ещё не запускался' };
    }
    const saveOptions: SaveDialogOptions = {
      title: 'Сохранить анализ портфеля (PDF)',
      defaultPath: `analysis_${timestampLabel(now)}.pdf`,
      filters: [{ name: 'PDF-файлы', extensions: ['pdf'] }],
    };
    const save =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showSaveDialog(mainWindow, saveOptions)
        : await dialog.showSaveDialog(saveOptions);
    if (save.canceled || !save.filePath) {
      return { ok: false, message: 'Сохранение отменено' };
    }
    try {
      const pdf = await renderDashboardPdf(html);
      fs.writeFileSync(save.filePath, pdf);
      return {
        ok: true,
        message: `PDF сохранён: ${save.filePath}`,
        filePath: save.filePath,
      };
    } catch (err) {
      return {
        ok: false,
        message: `Ошибка сохранения PDF: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
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
      return {
        success: false,
        label: '',
        message: 'Приложение не инициализировано',
      };
    }
    const result = await reconnectOllama(appState.director, {
      getOllamaModel: resolveOllamaModel,
    });
    return result;
  });

  // Перезагрузка портфеля из Excel
  ipcMain.handle('portfolio:reload', async (_event, excelPath: string) => {
    if (!appState) {
      return {
        success: false,
        sourceLabel: '',
        assetsCount: 0,
        message: 'Приложение не инициализировано',
      };
    }
    return await reloadPortfolio(appState.director, excelPath);
  });

  // Запуск ленивого анализа портфеля
  ipcMain.handle('director:run-analysis', async () => {
    if (!appState) {
      return { success: false, message: 'Приложение не инициализировано' };
    }
    try {
      const result = await appState.director.director.agent.runLazyAnalysis();
      return { success: true, message: result };
    } catch (err) {
      return {
        success: false,
        message: `Ошибка анализа: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });

  // Сброс кэша анализа
  ipcMain.handle('director:reset-analysis', () => {
    if (!appState) {
      return { success: false, message: 'Приложение не инициализировано' };
    }
  appState.director.director.agent.resetAnalysisCache();
    return { success: true };
  });

  // Статус анализа (сводный: полный конвейер + внутренний статус Директора)
  ipcMain.handle('director:analysis-status', () => {
    if (!appState) {
      return { status: 'none' as const };
    }
    return { status: resolveAnalysisStatus(appState) };
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
    openReportInBrowser: getDesktopSettings().openReportInBrowser === true,
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
    if (!filePath) {
      return {
        canceled: true,
        excelFilePath: process.env.EXCEL_FILE_PATH ?? '',
      };
    }
    process.env.EXCEL_FILE_PATH = filePath;
    saveDesktopSettings({
      ...loadDesktopSettings(),
      excelFilePath: filePath,
    });

    // Перезагружаем портфель без перезапуска
    if (appState) {
      try {
        const reloadResult = await reloadPortfolio(appState.director, filePath);
        if (reloadResult.success) {
          log(
            'info',
            `Портфель перезагружен: ${reloadResult.assetsCount} активов`,
          );
          sendToRenderer('portfolio:updated', {
            assetsCount: reloadResult.assetsCount,
            sourceLabel: reloadResult.sourceLabel,
          });
        } else {
          log('warn', `Ошибка перезагрузки портфеля: ${reloadResult.message}`);
        }
      } catch (err) {
        log('warn', `Ошибка при перезагрузке портфеля: ${err}`);
      }
    }

    // Перезапускаем файловый воркер на новый файл
    startExcelWatcher(filePath);

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

  // Настройка: открывать отчёт (report.html) в браузере после прогона конвейера
  ipcMain.handle('settings:set-open-report', (_event, value: boolean) => {
    saveDesktopSettings({
      ...loadDesktopSettings(),
      openReportInBrowser: value === true,
    });
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
    // Останавливаем файловый воркер Excel
    stopExcelWatcher();
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
