/**
 * AI Memory Core — ядро модуля памяти.
 *
 * Объединяет:
 * - Запросы к памяти (query)
 * - Статистику (getStats)
 * - Очистку (cleanup)
 * - Экспорт (exportMemory)
 * - Конфигурацию (configure, getConfig)
 * - Инициализацию (init, getState, clearAll)
 */

import Database from 'better-sqlite3';
import type {
  MemoryState,
  MemoryEntryType,
  MemoryQuery,
  MemoryQueryResult,
  AIMemoryConfig,
  AIMemoryStats,
  OperationalMemoryEntry,
  PortfolioKpiSnapshot,
  StrategicMemoryEntry,
  IAIMemory,
} from './types';
import {
  DEFAULT_OPERATIONAL_TTL_DAYS,
  DEFAULT_MAX_OPERATIONAL_ENTRIES,
  DEFAULT_MAX_STRATEGIC_ENTRIES,
  DEFAULT_KPI_ARCHIVE_INTERVAL_DAYS,
} from './types';
import { createDatabase, initializeMemoryTables, parseOperationalRow } from './database';
import {
  saveOperational,
  getOperationalRecent,
  getOperationalByType,
  searchOperationalByKeywords,
  getOperationalByPriority,
  deleteOperational,
  getAllOperational,
  countOperational,
  cleanupOperationalOld,
  archiveOperationalOld,
} from './operational-memory';
import {
  saveStrategicKpi,
  saveStrategicTrend,
  saveStrategicAnomaly,
  getAllStrategic,
  getStrategicByType,
  getStrategicKpiTrend,
  deleteStrategic,
  countStrategic,
  cleanupStrategicOld,
} from './strategic-memory';

// ──────────────────────────────────────────────
// 1. Состояние и конфигурация
// ──────────────────────────────────────────────

const DEFAULT_CONFIG: AIMemoryConfig = {
  maxOperationalEntries: DEFAULT_MAX_OPERATIONAL_ENTRIES,
  operationalTtlDays: DEFAULT_OPERATIONAL_TTL_DAYS,
  maxStrategicEntries: DEFAULT_MAX_STRATEGIC_ENTRIES,
  kpiArchiveIntervalDays: DEFAULT_KPI_ARCHIVE_INTERVAL_DAYS,
  verbose: false,
};

let currentState: MemoryState = 'idle';
let config: AIMemoryConfig = { ...DEFAULT_CONFIG };
let db: Database.Database = createDatabase();

function setState(state: MemoryState): void {
  currentState = state;
  if (config.verbose) {
    console.log(`[AI-Memory] Состояние: ${state}`);
  }
}

// ──────────────────────────────────────────────
// 2. CRUD обёртки
// ──────────────────────────────────────────────

/** Сохранить запись в оперативную память */
export function saveOperationalEntry(
  params: Omit<OperationalMemoryEntry, 'id' | 'sizeBytes' | 'lastAccessedAt'>,
): string {
  return saveOperational(db, params);
}

/** Получить запись оперативной памяти по ID */
export function getOperationalById(id: string): OperationalMemoryEntry | undefined {
  const stmt = db.prepare('SELECT * FROM ai_operational_memory WHERE id = ?');
  const raw = stmt.get(id) as Record<string, unknown> | undefined;
  if (!raw) return undefined;
  return parseOperationalRow(raw);
}

/** Получить последние N записей оперативной памяти */
export function getOperationalRecentList(limit = 50) {
  return getOperationalRecent(db, limit);
}

/** Получить записи оперативной памяти по типу */
export function getOperationalByTypeList(type: MemoryEntryType, limit = 50) {
  return getOperationalByType(db, type, limit);
}

/** Искать записи оперативной памяти по ключевым словам */
export function searchOperationalByKeywordsList(keywords: string[], limit = 50) {
  return searchOperationalByKeywords(db, keywords, limit);
}

/** Получить записи оперативной памяти по приоритету */
export function getOperationalByPriorityList(priority: 'critical' | 'high' | 'medium' | 'low', limit = 50) {
  return getOperationalByPriority(db, priority, limit);
}

/** Удалить запись оперативной памяти */
export function deleteOperationalEntry(id: string): boolean {
  return deleteOperational(db, id);
}

/** Получить все записи оперативной памяти */
export function getAllOperationalList() {
  return getAllOperational(db);
}

/** Получить количество записей оперативной памяти */
export function countOperationalList(): number {
  return countOperational(db);
}

/** Удалить старые записи оперативной памяти */
export function cleanupOperationalOldList(ttlDays?: number): number {
  return cleanupOperationalOld(db, ttlDays ?? config.operationalTtlDays!);
}

/** Сжать старые записи оперативной памяти */
export function archiveOperationalOldList(daysThreshold = 7): number {
  return archiveOperationalOld(db, daysThreshold);
}

/** Сохранить KPI-снимок в стратегическую память */
export function saveStrategicKpiEntry(snapshot: PortfolioKpiSnapshot): string {
  return saveStrategicKpi(db, snapshot);
}

/** Сохранить тренд в стратегическую память */
export function saveStrategicTrendEntry(data: {
  direction: 'up' | 'down' | 'stable';
  strength: number;
  periodDays: number;
  description: string;
}): string {
  return saveStrategicTrend(db, data);
}

/** Сохранить аномалию в стратегическую память */
export function saveStrategicAnomalyEntry(data: {
  type: string;
  severity: number;
  description: string;
  relatedKpiId?: string;
}): string {
  return saveStrategicAnomaly(db, data);
}

/** Получить все стратегические записи */
export function getAllStrategicList(limit = 500) {
  return getAllStrategic(db, limit);
}

/** Получить стратегические записи по типу */
export function getStrategicByTypeList(
  type: 'kpi_snapshot' | 'trend_data' | 'anomaly',
  limit = 100,
) {
  return getStrategicByType(db, type, limit);
}

/** Получить KPI-тренд */
export function getStrategicKpiTrendList(count = 12) {
  return getStrategicKpiTrend(db, count);
}

/** Удалить стратегическую запись */
export function deleteStrategicEntry(id: string): boolean {
  return deleteStrategic(db, id);
}

/** Получить количество стратегических записей */
export function countStrategicList(): number {
  return countStrategic(db);
}

/** Удалить старые стратегические записи */
export function cleanupStrategicOldList(daysThreshold?: number): number {
  return cleanupStrategicOld(db, daysThreshold ?? (config.operationalTtlDays || 14) * 2);
}

// ──────────────────────────────────────────────
// 3. Запросы к памяти
// ──────────────────────────────────────────────

/**
 * Выполняет объединённый запрос к оперативной и стратегической памяти.
 *
 * Алгоритм:
 * 1. Если запрошены оперативные типы — ищет по типам и/или ключевым словам
 * 2. Если запрошены стратегические типы — получает записи по типу
 * 3. Применяет фильтрацию по датам (from/to) к обоим результатам
 * 4. Возвращает объединённый результат с метаданными запроса
 *
 * @param params — параметры запроса (типы, ключевые слова, даты, лимиты)
 * @returns результат запроса с найденными записями и временем выполнения
 */
export async function query(params: MemoryQuery): Promise<MemoryQueryResult> {
  const startTime = Date.now();
  setState('loading');

  try {
    const operationalEntries: OperationalMemoryEntry[] = [];
    const strategicEntries: StrategicMemoryEntry[] = [];

    // Запрос к оперативной памяти
    if (!params.strategicOnly) {
      if (
        params.types?.includes('conversation') ||
        params.types?.includes('pipeline_result') ||
        params.types?.includes('decision') ||
        params.types?.includes('recommendation')
      ) {
        if (params.keywords && params.keywords.length > 0) {
          const results = searchOperationalByKeywordsList(
            params.keywords,
            params.maxResults || 50,
          );
          operationalEntries.push(...results);
        } else {
          const types = params.types || [
            'conversation',
            'pipeline_result',
            'decision',
            'recommendation',
          ];
          for (const type of types) {
            const results = getOperationalByTypeList(
              type,
              params.maxResults || 50,
            );
            operationalEntries.push(...results);
          }
        }
      }
    }

    // Запрос к стратегической памяти
    if (!params.operationalOnly) {
      if (
        params.types?.includes('kpi_snapshot') ||
        params.types?.includes('trend_data') ||
        params.types?.includes('anomaly')
      ) {
        const types = params.types.filter(
          (t) => t === 'kpi_snapshot' || t === 'trend_data' || t === 'anomaly',
        ) as Array<'kpi_snapshot' | 'trend_data' | 'anomaly'>;

        for (const type of types) {
          const results = getStrategicByTypeList(
            type,
            params.maxResults || 100,
          );
          strategicEntries.push(...results);
        }
      }
    }

    // Фильтрация по дате
    const filteredOperational =
      params.from || params.to
        ? operationalEntries.filter((entry) => {
            const date = new Date(entry.createdAt);
            const from = params.from ? new Date(params.from) : new Date(0);
            const to = params.to ? new Date(params.to) : new Date('9999-12-31');
            return date >= from && date <= to;
          })
        : operationalEntries;

    const filteredStrategic =
      params.from || params.to
        ? strategicEntries.filter((entry) => {
            const date = new Date(entry.date);
            const from = params.from ? new Date(params.from) : new Date(0);
            const to = params.to ? new Date(params.to) : new Date('9999-12-31');
            return date >= from && date <= to;
          })
        : strategicEntries;

    const totalFound = filteredOperational.length + filteredStrategic.length;
    const queryDurationMs = Date.now() - startTime;

    setState('idle');

    return {
      operationalEntries: filteredOperational,
      strategicEntries: filteredStrategic,
      totalFound,
      queryDurationMs,
    };
  } catch (error) {
    setState('error');
    console.error('[AI-Memory] Ошибка выполнения запроса:', error);
    throw error;
  }
}

// ──────────────────────────────────────────────
// 4. Статистика
// ──────────────────────────────────────────────

/**
 * Получает полную статистику модуля памяти.
 * Запрашивает метрики напрямую из SQLite: количество записей, размеры, средний возраст, аномалии.
 * Используется Dashboard для отображения KPI-карточек памяти.
 * @returns объект AIMemoryStats со всеми метриками
 */
export function getStats(): AIMemoryStats {
  const operationalCount = countOperationalList();
  const strategicCount = countStrategicList();

  // Общий размер оперативной памяти
  const opSizeStmt = db.prepare(
    'SELECT COALESCE(SUM(size_bytes), 0) as total FROM ai_operational_memory',
  );
  const opSize = opSizeStmt.get() as { total: number };

  // Общий размер стратегической памяти
  const stSizeStmt = db.prepare(
    'SELECT COALESCE(SUM(LENGTH(compressed_data)), 0) as total FROM ai_strategic_memory',
  );
  const stSize = stSizeStmt.get() as { total: number };

  // Средний возраст оперативной записи
  const opAgeStmt = db.prepare(`
    SELECT AVG(julianday('now') - julianday(created_at)) as avg_age
    FROM ai_operational_memory
  `);
  const opAge = opAgeStmt.get() as { avg_age: number | null };

  // Максимальный возраст стратегической записи
  const stMaxAgeStmt = db.prepare(`
    SELECT MAX(julianday('now') - julianday(date)) as max_age
    FROM ai_strategic_memory
  `);
  const stMaxAge = stMaxAgeStmt.get() as { max_age: number | null };

  // Количество аномалий за последние 7 дней
  const anomaliesStmt = db.prepare(`
    SELECT COUNT(*) as total FROM ai_strategic_memory
    WHERE entry_type = 'anomaly'
    AND date >= date('now', '-7 days')
  `);
  const anomalies = anomaliesStmt.get() as { total: number };

  return {
    operationalCount,
    strategicCount,
    operationalSizeBytes: opSize.total,
    strategicSizeBytes: stSize.total,
    avgOperationalAgeDays: opAge.avg_age || 0,
    maxStrategicAgeDays: stMaxAge.max_age || 0,
    recentAnomalies: anomalies.total,
  };
}

// ──────────────────────────────────────────────
// 5. Очистка
// ──────────────────────────────────────────────

/**
 * Выполняет полную очистку просроченных записей.
 * 1. Удаляет оперативные записи старше operationalTtlDays
 * 2. Удаляет стратегические записи старше 2x operationalTtlDays
 * 3. Архивирует (сжимает) оперативные записи старше 7 дней
 * @returns Promise, завершающийся при завершении очистки
 */
export async function cleanup(): Promise<void> {
  setState('saving');

  try {
    const opCleaned = cleanupOperationalOldList();
    const stCleaned = cleanupStrategicOldList();
    const archived = archiveOperationalOldList();

    if (config.verbose) {
      console.log(
        `[AI-Memory] Очистка завершена: удалено ${opCleaned + stCleaned}, сжато ${archived}`,
      );
    }

    setState('idle');
  } catch (error) {
    setState('error');
    console.error('[AI-Memory] Ошибка очистки:', error);
    throw error;
  }
}

// ──────────────────────────────────────────────
// 6. Экспорт
// ──────────────────────────────────────────────

/**
 * Экспортирует все данные памяти в формат JSON.
 * Включает статистику, все оперативные и стратегические записи, метку времени экспорта.
 * Используется для бэкапа или передачи данных внешним системам.
 * @returns строка JSON с полными данными памяти
 */
export async function exportJson(): Promise<string> {
  setState('loading');

  try {
    const stats = getStats();
    const operationalEntries = getAllOperationalList();
    const strategicEntries = getAllStrategicList();

    const exportData = {
      exportedAt: new Date().toISOString(),
      stats,
      operationalEntries,
      strategicEntries,
    };

    const json = JSON.stringify(exportData, null, 2);
    setState('idle');

    return json;
  } catch (error) {
    setState('error');
    console.error('[AI-Memory] Ошибка экспорта JSON:', error);
    throw error;
  }
}

/**
 * Экспортирует все данные памяти в формат Markdown.
 * Форматирует записи в читаемый документ с секциями: статистика, оперативная память, стратегическая память.
 * Ограничение: до 100 оперативных и 50 стратегических записей.
 * Используется для отчётов и передачи данных человеку.
 * @returns строка Markdown с данными памяти
 */
export async function exportMarkdown(): Promise<string> {
  setState('loading');

  try {
    const stats = getStats();
    const operationalEntries = getAllOperationalList();
    const strategicEntries = getAllStrategicList();

    let md = '# AI Memory Export\n\n';
    md += `**Дата эксппорта:** ${new Date().toISOString()}\n\n`;
    md += '## Статистика\n\n';
    md += `- Оперативная память: ${stats.operationalCount} записей (${(stats.operationalSizeBytes / 1024).toFixed(2)} КБ)\n`;
    md += `- Стратегическая память: ${stats.strategicCount} записей (${(stats.strategicSizeBytes / 1024).toFixed(2)} КБ)\n`;
    md += `- Средний возраст оперативной записи: ${stats.avgOperationalAgeDays.toFixed(1)} дней\n`;
    md += `- Аномалий за 7 дней: ${stats.recentAnomalies}\n\n`;

    md += '## Оперативная память\n\n';
    for (const entry of operationalEntries.slice(0, 100)) {
      md += `### ${entry.type} — ${entry.createdAt}\n\n`;
      md += `- **Приоритет:** ${entry.priority}\n`;
      md += `- **Ключевые слова:** ${entry.keywords.join(', ')}\n`;
      md += `- **Содержание:** ${entry.content.substring(0, 500)}${entry.content.length > 500 ? '...' : ''}\n\n`;
    }

    md += '## Стратегическая память\n\n';
    for (const entry of strategicEntries.slice(0, 50)) {
      md += `### ${entry.type} — ${entry.date}\n\n`;
      if (entry.raw) {
        md += `- **Стоимость портфеля:** ${entry.raw.totalValue}\n`;
        md += `- **Доходность:** ${entry.raw.returnPercent}%\n`;
        md += `- **Sharpe ratio:** ${entry.raw.sharpeRatio}\n`;
        md += `- **Макс. просадка:** ${entry.raw.maxDrawdown}%\n`;
        md += `- **Волатильность:** ${entry.raw.volatility}%\n\n`;
      }
      if (entry.trend) {
        md += `- **Тренд:** ${entry.trend.direction} (${(entry.trend.strength * 100).toFixed(0)}%)\n`;
        md += `- **Период:** ${entry.trend.periodDays} дней\n\n`;
      }
      if (entry.anomalies) {
        md += '**Аномалии:**\n\n';
        for (const anomaly of entry.anomalies) {
          md += `- [${anomaly.type}] ${anomaly.description} (severity: ${anomaly.severity})\n`;
        }
        md += '\n';
      }
    }

    setState('idle');
    return md;
  } catch (error) {
    setState('error');
    console.error('[AI-Memory] Ошибка экспорта Markdown:', error);
    throw error;
  }
}

/**
 * Экспортирует память в указанном формате.
 * @param format — формат экспорта: 'json' или 'markdown'
 * @returns экспортированные данные
 */
export async function exportMemory(format: 'json' | 'markdown'): Promise<string> {
  if (format === 'json') {
    return exportJson();
  } else {
    return exportMarkdown();
  }
}

// ──────────────────────────────────────────────
// 7. Конфигурация
// ──────────────────────────────────────────────

/**
 * Применяет новую конфигурацию к модулю памяти.
 * Обновляет параметры без перезапуска и потери данных.
 * @param newConfig — частичная конфигурация для обновления
 */
export function configure(newConfig: Partial<AIMemoryConfig>): void {
  config = { ...config, ...newConfig };
  if (config.verbose) {
    console.log('[AI-Memory] Конфигурация обновлена:', config);
  }
}

/**
 * Получает текущую конфигурацию модуля.
 * @returns копия текущей конфигурации AIMemoryConfig
 */
export function getConfig(): AIMemoryConfig {
  return { ...config };
}

// ──────────────────────────────────────────────
// 8. Инициализация
// ──────────────────────────────────────────────

/**
 * Инициализирует модуль памяти: создаёт таблицы и настраивает параметры.
 * @param cfg — опциональная конфигурация
 */
export function init(cfg?: Partial<AIMemoryConfig>): void {
  const isTest = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  if (isTest) {
    db.close();
    db = createDatabase();
  }

  if (cfg) {
    configure(cfg);
  }
  initializeMemoryTables(db);
  console.log('🧠 AI-Memory: двухслойная память инициализирована');
  console.log(
    `   Оперативная: ${config.operationalTtlDays} дней, до ${config.maxOperationalEntries} записей`,
  );
  console.log(`   Стратегическая: до ${config.maxStrategicEntries} записей`);
}

/**
 * Пересоздаёт базу данных (для тестов).
 */
export function resetDatabase(): void {
  db.close();
  db = createDatabase();
  initializeMemoryTables(db);
}

/**
 * Получает текущее состояние модуля памяти.
 * @returns текущее состояние ('idle' | 'loading' | 'saving' | 'error')
 */
export function getState(): MemoryState {
  return currentState;
}

/**
 * Очищает все записи из обеих таблиц памяти (ТОЛЬКО для тестов).
 */
export function clearAll(): void {
  db.exec('DELETE FROM ai_operational_memory');
  db.exec('DELETE FROM ai_strategic_memory');
}

// ──────────────────────────────────────────────
// 9. Экспорт объектов памяти
// ──────────────────────────────────────────────

/**
 * Объект оперативной памяти для прямого доступа.
 */
export const operationalMemory = {
  save: saveOperationalEntry,
  getById: getOperationalById,
  getRecent: getOperationalRecentList,
  getByType: getOperationalByTypeList,
  searchByKeywords: searchOperationalByKeywordsList,
  getByPriority: getOperationalByPriorityList,
  delete: deleteOperationalEntry,
  getAll: getAllOperationalList,
  count: countOperationalList,
  cleanupOld: cleanupOperationalOldList,
  archiveOld: archiveOperationalOldList,
};

/**
 * Объект стратегической памяти для прямого доступа.
 */
export const strategicMemory = {
  saveKpi: saveStrategicKpiEntry,
  saveTrend: saveStrategicTrendEntry,
  saveAnomaly: saveStrategicAnomalyEntry,
  getAll: getAllStrategicList,
  getByType: getStrategicByTypeList,
  getKpiTrend: getStrategicKpiTrendList,
  delete: deleteStrategicEntry,
  count: countStrategicList,
  cleanupOld: cleanupStrategicOldList,
};

// ──────────────────────────────────────────────
// 10. Привязка к интерфейсу IAIMemory
// ──────────────────────────────────────────────

/**
 * Реализация интерфейса IAIMemory.
 */
export const aiMemoryImpl: IAIMemory = {
  saveOperational: (entry) => {
    const id = saveOperationalEntry(entry);
    return Promise.resolve(id);
  },
  saveStrategicKpi: (snapshot) => {
    saveStrategicKpiEntry(snapshot);
    return Promise.resolve();
  },
  query,
  getStats,
  getState,
  cleanup,
  exportMemory,
};

// ──────────────────────────────────────────────
// 11. Автоматическая инициализация
// ──────────────────────────────────────────────

// Инициализация при импорте модуля
init();
