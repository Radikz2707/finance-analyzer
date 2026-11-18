/**
 * Единый tee-логгер прогона: дублирует console.log/warn/error в
 * `reports/last-run.log`.
 *
 * Инвариант наблюдаемости: **любой** путь запуска конвейера
 * (`npm run pipeline`, `scripts/pipeline-report.ts`, Electron/desktop IPC,
 * планировщик, прямой вызов `PipelineCoordinator.run()`) создаёт файл
 * отчёта до первой диагностической строки. Раньше tee жил только в
 * `scripts/pipeline.ts`, поэтому прогон из Electron не оставлял лога
 * `[DIVIDENDS_LTM_FETCH]` / `[AI_VOTE]`.
 *
 * Ограничения:
 * - браузер/Electron-renderer — файловая система недоступна, логгер тихо
 *   отключается (никаких падений страницы);
 * - первый вызов в процессе перезаписывает файл (новый прогон = новый лог),
 *   повторные вызовы дописывают в тот же файл, не затирая уже собранные строки.
 *
 * Путь: `options.logDir` → `REPORTS_DIR` → `<cwd>/reports`.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface RunLoggerOptions {
  /** Каталог для лога (по умолчанию `<cwd>/reports`). */
  logDir?: string;
  /** Имя файла (по умолчанию `last-run.log`). */
  fileName?: string;
}

const DEFAULT_FILE_NAME = 'last-run.log';

let installed = false;
let activeLogPath: string | null = null;
let originalConsole: {
  log: typeof console.log;
  warn: typeof console.warn;
  error: typeof console.error;
} | null = null;

/** Есть ли доступ к файловой системе (Node/Electron-main, не renderer). */
function canUseFileSystem(): boolean {
  if (typeof window !== 'undefined') return false;
  if (typeof process === 'undefined') return false;
  return typeof process.cwd === 'function';
}

/** Вычислить путь лога, не создавая файл. */
export function resolveRunLogPath(
  options: RunLoggerOptions = {},
): string | null {
  if (!canUseFileSystem()) return null;
  const logDir =
    options.logDir ?? process.env?.REPORTS_DIR ?? path.resolve('reports');
  return path.join(logDir, options.fileName ?? DEFAULT_FILE_NAME);
}

/** Текущий активный путь лога (null — логгер отключён). */
export function getActiveRunLogPath(): string | null {
  return activeLogPath;
}

export function isRunLoggerInstalled(): boolean {
  return installed;
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

/**
 * Подключить tee-логгер. Идемпотентно: повторный вызов с тем же путём
 * ничего не перезаписывает.
 *
 * @returns путь к файлу лога или null, если ФС недоступна.
 */
export function installRunLogger(
  options: RunLoggerOptions = {},
): string | null {
  const logPath = resolveRunLogPath(options);
  if (!logPath) return null;

  if (installed && activeLogPath === logPath) return activeLogPath;

  // Первый вызов (или смена пути) — начинаем новый лог прогона.
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(
      logPath,
      `[${new Date().toISOString()}] [PIPELINE] run started pid=${process.pid}\n`,
      'utf8',
    );
  } catch {
    return null;
  }

  activeLogPath = logPath;

  // Хуки уже стоят — они пишут в activeLogPath, поэтому достаточно вернуть путь.
  if (installed) return activeLogPath;

  installed = true;
  originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const write = (level: string, args: unknown[]): void => {
    if (!activeLogPath) return;
    try {
      const line = args.map(formatArg).join(' ');
      fs.appendFileSync(
        activeLogPath,
        `[${new Date().toISOString()}] [${level}] ${line}\n`,
        'utf8',
      );
    } catch {
      // Лог не должен ломать прогон.
    }
  };

  console.log = (...args: unknown[]) => {
    originalConsole?.log(...args);
    write('LOG', args);
  };
  console.warn = (...args: unknown[]) => {
    originalConsole?.warn(...args);
    write('WARN', args);
  };
  console.error = (...args: unknown[]) => {
    originalConsole?.error(...args);
    write('ERROR', args);
  };

  return activeLogPath;
}

/** Снять хуки и сбросить состояние (только для тестов). */
export function resetRunLoggerForTests(): void {
  if (originalConsole) {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
  originalConsole = null;
  installed = false;
  activeLogPath = null;
}
