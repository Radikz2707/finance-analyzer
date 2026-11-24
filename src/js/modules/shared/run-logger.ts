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
  /**
   * Тихий режим: оставляет только важные сообщения (портфель, результаты,
   * ошибки). Все технические детали (URL, статусы HTTP, детальные запросы
   * к API, AI DEBUG и т.п.) фильтруются.
   */
  quiet?: boolean;
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
 * Тихий режим: фильтрует технический шум, оставляя только важное.
 * Пропускает сообщения о портфеле, результатах pipeline, ошибках и ключевых
 * этапах (DataAgent, AnalysisAgent, AiAgent, результаты анализа).
 */
function shouldLogInQuietMode(line: string): boolean {
  // ✅ Оставляем: запуск/результаты pipeline
  if (
    line.includes('[PIPELINE]') ||
    line.includes('[Pipeline]') ||
    line.includes('[PIPELINE] Результаты') ||
    line.includes('[PIPELINE] run started')
  )
    return true;

  // ✅ Оставляем: запуск и завершение агентов
  if (
    line.includes('[AGENT:') ||
    line.includes('Успех за') ||
    line.includes('Stage .* completed in')
  )
    return true;

  // ✅ Оставляем: анализ портфеля (блок с ═══)
  if (
    line.includes('АНАЛИЗ ПОРТФЕЛЯ') ||
    line.includes('Активов:') ||
    line.includes('Структура:') ||
    line.includes('Топ-5') ||
    line.includes('Приоритеты покупки') ||
    line.includes('дефицит') ||
    line.includes('НКД') ||
    line.includes('Дивиденды') ||
    line.includes('Доходы:')
  )
    return true;

  // ✅ Оставляем: ключевые результаты агентов
  if (
    line.includes('✅ Парсинг завершён') ||
    line.includes('✅ Анализ завершён') ||
    line.includes('✅ BondMarketData') ||
    line.includes('✅ Проанализировано') ||
    line.includes('Ключевая ставка ЦБ') ||
    line.includes('Ликвидность: статус=') ||
    line.includes('Smart-Lab: загружен оборот') ||
    line.includes('Gatekeeper:') ||
    line.includes('Python Engine:')
  )
    return true;

  // ✅ Оставляем: дивиденды (итоговые)
  if (
    line.includes('[DIVIDENDS_LTM_APPLIED]') ||
    line.includes('[DIVIDENDS_TILE]')
  )
    return true;

  // ✅ Оставляем: ошибки и предупреждения (но не BondAnalysis/SmartLabApi)
  if (
    line.includes('[ERROR]') &&
    !line.includes('[BondAnalysis]') &&
    !line.includes('[SmartLabApi]')
  )
    return true;
  if (
    line.includes('[WARN]') &&
    !line.includes('[BondAnalysis]') &&
    !line.includes('[SmartLabApi]') &&
    !line.includes('Smart-Lab не вернул')
  )
    return true;

  // ✅ Оставляем: AI-анализ (ключевые решения)
  if (
    line.includes('[AI] Глубокое падение') ||
    line.includes('[AI] Фундаментальные метрики') ||
    line.includes('[AI] Поведенческие факторы')
  )
    return true;

  // ✅ Оставляем: bond analysis (итоговые рекомендации)
  if (
    line.includes('[BondAnalysis]') &&
    (line.includes('✅ Проанализировано'))
  )
    return true;

  // ❌ Отбрасываем: URL-адреса
  if (line.includes('URL:') || line.includes('https://')) return false;
  // ❌ Отбрасываем: HTTP статусы 200 OK
  if (line.includes('Status: 200 OK')) return false;
  // ❌ Отбрасываем: детальные запросы к MOEX по каждому ISIN
  if (line.includes('[BondApi] URL:') || line.includes('iss.moex.com'))
    return false;
  // ❌ Отбрасываем: Smart-Lab запросы (request=#, bytes=)
  if (
    line.includes('request=#') ||
    line.includes('HTTP 200 bytes=') ||
    line.includes('Volume для') ||
    line.includes('Rating для')
  )
    return false;
  // ❌ Отбрасываем: BOND_CARD not_in_excel (спам по каждой бумаге)
  if (
    line.includes('[BOND_CARD]') &&
    line.includes('nextCouponDate=not_in_excel')
  )
    return false;
  // ❌ Отбрасываем: TechFacts пустая история
  if (line.includes('[TECH_FACTS]') && line.includes('пустая история'))
    return false;
  // ❌ Отбрасываем: AI DEBUG
  if (line.includes('[AI DEBUG]') || line.includes('[Ollama]')) return false;
  // ❌ Отбрасываем: Нет research snapshot
  if (line.includes('Нет research snapshot')) return false;
  // ❌ Отбрасываем: DIVIDEND_YIELDS (детальные)
  if (line.includes('[DIVIDEND_YIELDS]')) return false;
  // ❌ Отбрасываем: FUNDING (детальные)
  if (line.includes('[FUNDING]')) return false;
  // ❌ Отбрасываем: MOEX ISS dividends unavailable
  if (line.includes('dividends/') && line.includes('отсутствует'))
    return false;
  // ❌ Отбрасываем: Smart-Lab не вернул rating
  if (line.includes('Smart-Lab не вернул rating')) return false;
  // ❌ Отбрасываем: BondApi endpoints
  if (line.includes('[BondApi] Пробую endpoint') || line.includes('[BondApi] ✅ Endpoint'))
    return false;
  // ❌ Отбрасываем: BondApi загружено N облигаций
  if (line.includes('[BondApi] ✅ Загружено')) return false;
  // ❌ Отбрасиваем: BondEnrich совпадений
  if (line.includes('[BondEnrich] ✅ Совпадений')) return false;
  // ❌ Отбрасиваем: тип купона подтверждён
  if (line.includes('тип купона подтверждён')) return false;
  // ❌ Отбрасиваем: справочник из кэша
  if (line.includes('справочник из кэша')) return false;
  // ❌ Отбрасиваем: XLSX-PARSER
  if (line.includes('[XLSX-PARSER]')) return false;
  // ❌ Отбрасиваем: MemoryCleaner
  if (line.includes('[MemoryCleaner]')) return false;
  // ❌ Отбрасиваем: DataAgent >>> Начало
  if (line.includes('>>> Начало')) return false;
  // ❌ Отбрасиваем: Контекст из памяти
  if (line.includes('Контекст из памяти')) return false;
  // ❌ Отбрасиваем: buildNewsContext
  if (line.includes('buildNewsContext')) return false;
  // ❌ Отбрасиваем: POLICY_TEXT
  if (line.includes('[POLICY_TEXT]')) return false;
  // ❌ Отбрасиваем: thesis=0 из 14
  if (line.includes('thesis=0 из') && line.includes('reason=')) return false;
  // ❌ Отбрасиваем: DEBUG: thesis готово
  if (line.includes('DEBUG: thesis готово')) return false;
  // ❌ Отбрасиваем: Sheet schema warnings (повторяющиеся)
  if (line.includes('[SHEET_SCHEMA]')) return false;
  // ❌ Отбрасиваем: MOEX_QUOTES applied
  if (line.includes('[MOEX_QUOTES]') && line.includes('applied='))
    return false;
  // ❌ Отбрасиваем: Smart-Lab запрашиваем оборот
  if (line.includes('запрашиваем оборот')) return false;
  // ❌ Отбрасиваем: Smart-Lab тикер детали
  if (
    line.includes('SmartLabApi] ✅ isin=') &&
    (line.includes('rating=') || line.includes('volume=') || line.includes('yield='))
  )
    return false;
  // ❌ Отбрасиваем: BondAnalysis детальные (найти ISIN, yield загружен)
  if (
    line.includes('[BondAnalysis] isin=') &&
    (line.includes('bondData=FOUND') || line.includes('Yield загружен'))
  )
    return false;
  // ❌ Отбрасиваем: BOND_CARD id=...
  if (line.includes('[BOND_CARD] id=') || line.includes('[BOND_CARD] isin=') && line.includes('source='))
    return false;
  // ❌ Отбрасиваем: BondAnalysis 📊 (детальные по каждой бумаге)
  if (line.includes('[BondAnalysis] 📊')) return false;
  // ❌ Отбрасиваем: BondAnalysis детальные yield/rating/volume
  if (line.includes('[BondAnalysis] ✅ Рейтинг загружен')) return false;
  if (line.includes('[BondAnalysis] ✅ Yield загружен')) return false;
  if (line.includes('[BondAnalysis] ✅ Volume загружен')) return false;
  if (line.includes('[BondAnalysis] 📊')) return false;
  if (line.includes('[BondAnalysis] ✅ SU29027RMFS8:')) return false;
  if (line.includes('[BondAnalysis] ✅ RU000A10')) return false;
  // ❌ Отбрасиваем: AI_CLIENT buildPortfolioContext
  if (line.includes('[AI_CLIENT] buildPortfolioContext')) return false;
  // ❌ Отбрасиваем: AI_CLIENT Фундаментальные данные
  if (line.includes('[AI_CLIENT] Фундаментальные данные')) return false;
  // ❌ Отбрасиваем: AI_CLIENT FUNDING
  if (line.includes('[FUNDING]')) return false;
  // ❌ Отбрасиваем: AI Доступные модели
  if (line.includes('[AI] Доступные модели')) return false;
  // ❌ Отбрасиваем: AI Попытка запроса
  if (line.includes('[AI] Попытка запроса')) return false;
  // ❌ Отбрасиваем: SmartLabApi ⚠️
  if (line.includes('[SmartLabApi] ⚠️')) return false;
  // ❌ Отбрасиваем: BondAnalysis ⚠️
  if (line.includes('[BondAnalysis] ⚠️') || line.includes('Smart-Lab не вернул')) return false;
  // ❌ Отбрасиваем: Ollama Проверка подключения
  if (line.includes('[Ollama] Проверка подключения')) return false;
  // ❌ Отбрасиваем: Ollama isOllamaRunning
  if (line.includes('[Ollama] isOllamaRunning')) return false;
  // ❌ Отбрасиваем: Ollama calling
  if (line.includes('[Ollama] calling')) return false;
  // ❌ Отбрасиваем: STREAM calling
  if (line.includes('[STREAM] calling')) return false;
  // ❌ Отбрасиваем: buildPortfolioContext
  if (line.includes('buildPortfolioContext')) return false;
  // ❌ Отбрасиваем: AI_CACHE
  if (line.includes('[AI_CACHE]')) return false;
  // ❌ Отбрасиваем: XlsxParser кэш очищен
  if (line.includes('[XlsxParser]')) return false;
  // ❌ Отбрасиваем: DEPRECATED
  if (line.includes('[ResearchAgentV2] DEPRECATED')) return false;
  // ❌ Отбрасиваем: DIAGNOSTIC
  if (line.includes('[DIAGNOSTIC]')) return false;
  // ❌ Отбрасиваем: VALIDATION
  if (line.includes('[VALIDATION]')) return false;
  // ❌ Отбрасиваем: QUIK_DIVIDENDS
  if (line.includes('[QUIK_DIVIDENDS]')) return false;
  // ❌ Отбрасиваем: ЦБ-СТАВКА fallback
  if (line.includes('[ЦБ-СТАВКА]')) return false;
  // ❌ Отбрасиваем: DIVIDENDS_LTM_FETCH (детальные)
  if (line.includes('[DIVIDENDS_LTM_FETCH]')) return false;
  // ❌ Отбрасиваем: JSON request body (AI запросы)
  if (line.includes('"type":') && line.includes('"properties":')) return false;
  if (line.includes('"required":') && line.includes('"ticker"')) return false;
  if (line.includes('"stream": true')) return false;
  if (line.includes('"format": {')) return false;
  // ❌ Отбрасиваем: AI запрос JSON (большой блок с role/content)
  if (line.includes('"role": "system"') || line.includes('"role": "user"')) return false;
  if (line.includes('"content": "=== РОЛЬ ==="') || line.includes('"content": "ДАННЫЕ ПОРТФЕЛЯ:"')) return false;
  if (line.includes('"model": "qwen')) return false;
  // ❌ Отбрасиваем: STREAM Request body
  if (line.includes('[STREAM] Request body')) return false;

  // По умолчанию — пропускать (безопасно: только явные whitelist-сообщения)
  return false;
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

  let inJsonBlock = false;

  const write = (level: string, args: unknown[], quiet: boolean): void => {
    if (!activeLogPath) return;
    try {
      const line = args.map(formatArg).join(' ');

      // В тихом режиме фильтруем шум
      if (quiet) {
        // Блокируем JSON-блоки (AI запросы)
        if (inJsonBlock) {
          if (line.trim() === '}') {
            inJsonBlock = false;
          }
          return;
        }
        if (!shouldLogInQuietMode(line)) return;
        // Начинаем JSON-блок — блокируем
        if (line.includes('[STREAM] Request body:') || line.includes('"model": "qwen')) {
          inJsonBlock = true;
          return;
        }
      }

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
    write('LOG', args, options.quiet ?? false);
  };
  console.warn = (...args: unknown[]) => {
    originalConsole?.warn(...args);
    write('WARN', args, options.quiet ?? false);
  };
  console.error = (...args: unknown[]) => {
    originalConsole?.error(...args);
    write('ERROR', args, options.quiet ?? false);
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
