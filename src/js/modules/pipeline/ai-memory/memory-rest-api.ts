/**
 * Memory REST API — REST-подобный интерфейс для работы с памятью ИИ.
 *
 * Предоставляет функции, имитирующие REST API endpoints:
 * - GET /api/memory/stats — статистика памяти
 * - GET /api/memory/operational — оперативная память (с пагинацией и фильтрацией)
 * - GET /api/memory/strategic — стратегическая память
 * - GET /api/memory/query — поиск по памяти (объединённый запрос)
 * - POST /api/memory/save — сохранение записи (оперативная или стратегическая)
 * - DELETE /api/memory/cleanup — очистка старых записей
 *
 * Все функции возвращают Promise<ApiResponse<T>> с полями:
 * - success — успешность запроса
 * - data — данные (при success=true)
 * - error — сообщение об ошибке (при success=false)
 * - statusCode — HTTP-статус для совместимости
 * - durationMs — время выполнения в миллисекундах
 *
 * @module memory-rest-api
 */

import {
  getStats,
  operationalMemory,
  strategicMemory,
  query as memoryQuery,
  cleanup,
} from './core.js';
import {
  saveOperational,
  saveKpiSnapshot,
  saveAnomaly,
} from './memory-api.js';
import type {
  MemoryEntryType,
  MemoryPriority,
  OperationalMemoryEntry,
  PortfolioKpiSnapshot,
  MemoryQuery,
  MemoryQueryResult,
  AIMemoryStats,
  StrategicMemoryEntry,
} from './types.js';

// ──────────────────────────────────────────────
// 1. Типы ответов API
// ──────────────────────────────────────────────

/**
 * Базовый ответ REST API.
 * Унифицированный формат для всех endpoints.
 */
export interface ApiResponse<T = unknown> {
  /** Флаг успешности запроса */
  success: boolean;
  /** Данные ответа (доступны только при success=true) */
  data?: T;
  /** Сообщение об ошибке (доступно только при success=false) */
  error?: string;
  /** HTTP-статус код для совместимости с веб-API */
  statusCode: number;
  /** Время выполнения запроса в миллисекундах (для мониторинга производительности) */
  durationMs: number;
}

/**
 * Ответ со списком записей (с пагинацией).
 * Используется для endpoints с ограничением количества записей.
 */
export interface ListResponse<T> {
  /** Массив записей для текущей страницы */
  items: T[];
  /** Общее количество записей во всей коллекции (без учёта пагинации) */
  total: number;
  /** Номер текущей страницы (начинается с 1) */
  page: number;
  /** Размер страницы (максимальное количество записей на странице) */
  pageSize: number;
}

// ──────────────────────────────────────────────
// 2. Утилиты
// ──────────────────────────────────────────────

/**
 * Создаёт успешный объект ответа API.
 * @param data — данные ответа
 * @param durationMs — время выполнения в мс
 * @returns ApiResponse с success=true, statusCode=200
 */
function success<T>(data: T, durationMs: number): ApiResponse<T> {
  return { success: true, data, statusCode: 200, durationMs };
}

/**
 * Создаёт объект ответа с ошибкой.
 * @param message — сообщение об ошибке
 * @param statusCode — HTTP-статус ошибки (по умолчанию 500)
 * @param durationMs — время выполнения в мс
 * @returns ApiResponse с success=false
 */
function error(message: string, statusCode: number, durationMs: number): ApiResponse<never> {
  return { success: false, error: message, statusCode, durationMs };
}

/**
 * Оборачивает функцию в Promise<ApiResponse> с измерением времени выполнения.
 * Автоматически перехватывает ошибки и преобразует в ApiResponse с success=false.
 * @param fn — асинхронная или синхронная функция
 * @returns Promise<ApiResponse<T>> с измеренным временем выполнения
 */
function timed<T>(fn: () => T | Promise<T>): Promise<ApiResponse<T>> {
  const start = Date.now();
  return Promise.resolve(fn()).then(
    (result) => success(result, Date.now() - start),
    (err) => error(err instanceof Error ? err.message : String(err), 500, Date.now() - start),
  );
}

// ──────────────────────────────────────────────
// 3. GET /api/memory/stats — Статистика памяти
// ──────────────────────────────────────────────

/**
 * GET /api/memory/stats — Получить статистику памяти ИИ.
 *
 * Возвращает количество записей в обоих слоях, размеры в байтах,
 * средний возраст записей и количество аномалий за последние 7 дней.
 *
 * @returns ApiResponse с объектом AIMemoryStats
 */
export async function getMemoryStats(): Promise<ApiResponse<AIMemoryStats>> {
  return timed(() => getStats());
}

// ──────────────────────────────────────────────
// 4. GET /api/memory/operational — Оперативная память
// ──────────────────────────────────────────────

/**
 * GET /api/memory/operational — Получить записи оперативной памяти.
 *
 * Поддерживает фильтрацию по типу, приоритету и ключевым словам,
 * а также пагинацию через параметры page и limit.
 *
 * @param options — параметры запроса (limit, type, priority, keywords, page)
 * @returns ApiResponse со списком записей оперативной памяти
 */
export async function getOperationalMemory(options?: {
  /** Максимум записей на странице (по умолчанию 50) */
  limit?: number;
  /** Тип записи для фильтрации (conversation, pipeline_result и т.д.) */
  type?: MemoryEntryType;
  /** Уровень важности для фильтрации */
  priority?: MemoryPriority;
  /** Ключевые слова для полнотекстового поиска */
  keywords?: string[];
  /** Номер страницы для пагинации (по умолчанию 1) */
  page?: number;
}): Promise<ApiResponse<ListResponse<OperationalMemoryEntry>>> {
  return timed(() => {
    const opts = { limit: 50, page: 1, ...options };
    let entries: OperationalMemoryEntry[];

    if (opts.type) {
      entries = operationalMemory.getByType(opts.type, opts.limit);
    } else if (opts.priority) {
      entries = operationalMemory.getByPriority(opts.priority, opts.limit);
    } else if (opts.keywords && opts.keywords.length > 0) {
      entries = operationalMemory.searchByKeywords(opts.keywords, opts.limit);
    } else {
      entries = operationalMemory.getRecent(opts.limit);
    }

    const total = operationalMemory.count();
    const pageSize = opts.limit;
    const page = opts.page || 1;
    const start = (page - 1) * pageSize;
    const paginated = entries.slice(start, start + pageSize);

    return {
      items: paginated,
      total,
      page,
      pageSize,
    };
  });
}

// ──────────────────────────────────────────────
// 5. GET /api/memory/strategic — Стратегическая память
// ──────────────────────────────────────────────

/**
 * GET /api/memory/strategic — Получить записи стратегической памяти.
 *
 * Поддерживает фильтрацию по типу: снимок KPI, трендовые данные или аномалия.
 *
 * @param options — параметры запроса (limit, type)
 * @returns ApiResponse со списком стратегических записей
 */
export async function getStrategicMemory(options?: {
  /** Максимум записей (по умолчанию 100) */
  limit?: number;
  /** Тип записи для фильтрации */
  type?: 'kpi_snapshot' | 'trend_data' | 'anomaly';
}): Promise<ApiResponse<ListResponse<StrategicMemoryEntry>>> {
  return timed(() => {
    const opts = { limit: 100, ...options };
    let entries: StrategicMemoryEntry[];

    if (opts.type) {
      entries = strategicMemory.getByType(opts.type, opts.limit);
    } else {
      entries = strategicMemory.getAll(opts.limit);
    }

    const total = strategicMemory.count();

    return {
      items: entries,
      total,
      page: 1,
      pageSize: opts.limit,
    };
  });
}

// ──────────────────────────────────────────────
// 6. GET /api/memory/query — Поиск по памяти
// ──────────────────────────────────────────────

/**
 * GET /api/memory/query — Выполнить поисковый запрос к памяти.
 *
 * Объединённый поиск по оперативной и стратегической памяти.
 * Поддерживает фильтрацию по типам, ключевым словам и датам.
 *
 * @param params — параметры запроса (типы, ключевые слова, даты, лимиты)
 * @returns ApiResponse с найденными записями из обоих слоёв
 */
export async function queryMemory(params: MemoryQuery): Promise<ApiResponse<MemoryQueryResult>> {
  return timed(() => memoryQuery(params));
}

// ──────────────────────────────────────────────
// 7. POST /api/memory/save — Сохранение записи
// ──────────────────────────────────────────────

/** Параметры для сохранения записи */
export interface SaveMemoryParams {
  /** Уровень памяти: 'operational' | 'strategic' */
  level: 'operational' | 'strategic';
  /** Тип записи */
  type: MemoryEntryType;
  /** Содержание записи */
  content: string;
  /** Приоритет (для оперативной памяти) */
  priority?: MemoryPriority;
  /** Ключевые слова */
  keywords?: string[];
  /** Метаданные */
  metadata?: Record<string, unknown>;
  /** Для стратегической памяти: данные KPI-снимка */
  kpiSnapshot?: Omit<PortfolioKpiSnapshot, 'date'> & { date?: string };
  /** Для стратегической памяти: данные аномалии */
  anomalyData?: {
    type: string;
    severity: number;
    description: string;
    relatedKpiId?: string;
  };
}

/** Результат сохранения */
export interface SaveResult {
  /** ID сохранённой записи */
  id: string;
  /** Уровень памяти */
  level: 'operational' | 'strategic';
  /** Тип записи */
  type: string;
}

/**
 * POST /api/memory/save — Сохранить запись в память.
 *
 * Поддерживает сохранение в оперативную и стратегическую память.
 * Для стратегической памяти необходимо указать kpiSnapshot или anomalyData.
 *
 * @param params — параметры записи (level, type, content, и дополнительные данные)
 * @returns ApiResponse с ID сохранённой записи
 */
export async function saveMemory(params: SaveMemoryParams): Promise<ApiResponse<SaveResult>> {
  return timed(() => {
    let id: string;

    if (params.level === 'operational') {
      id = saveOperational({
        type: params.type,
        content: params.content,
        priority: params.priority ?? 'medium',
        keywords: params.keywords ?? [],
        metadata: params.metadata,
      });
    } else if (params.level === 'strategic') {
      if (params.type === 'kpi_snapshot' && params.kpiSnapshot) {
        id = saveKpiSnapshot(params.kpiSnapshot);
      } else if (params.type === 'anomaly' && params.anomalyData) {
        id = saveAnomaly(params.anomalyData);
      } else {
        throw new Error('Для стратегической памяти необходимо указать kpiSnapshot или anomalyData');
      }
    } else {
      throw new Error(`Неизвестный уровень памяти: ${params.level}`);
    }

    return {
      id,
      level: params.level,
      type: params.type,
    };
  });
}

// ──────────────────────────────────────────────
// 8. DELETE /api/memory/cleanup — Очистка
// ──────────────────────────────────────────────

/** Параметры очистки */
export interface CleanupParams {
  /** Очистить оперативную память */
  operational?: boolean;
  /** Очистить стратегическую память */
  strategic?: boolean;
  /** Удалить записи старше N дней (по умолчанию 14) */
  daysThreshold?: number;
}

/** Результат очистки */
export interface CleanupResult {
  /** Удалено оперативных записей */
  operationalDeleted: number;
  /** Удалено стратегических записей */
  strategicDeleted: number;
  /** Сжато оперативных записей */
  operationalArchived: number;
  /** Всего обработано */
  totalProcessed: number;
}

/**
 * DELETE /api/memory/cleanup — Очистить старые записи из памяти.
 *
 * Удаляет записи старше указанного порога дней, архивирует старые оперативные записи.
 *
 * @param params — параметры очистки (operational, strategic, daysThreshold)
 * @returns ApiResponse с количеством удалённых и сжатых записей
 */
export async function cleanupMemory(params?: CleanupParams): Promise<ApiResponse<CleanupResult>> {
  return timed(async () => {
    const opts = { operational: true, strategic: true, daysThreshold: 14, ...params };

    let operationalDeleted = 0;
    let strategicDeleted = 0;
    let operationalArchived = 0;

    if (opts.operational) {
      operationalArchived = operationalMemory.archiveOld(7);
      operationalDeleted = operationalMemory.cleanupOld(opts.daysThreshold);
    }

    if (opts.strategic) {
      strategicDeleted = strategicMemory.cleanupOld(opts.daysThreshold * 2);
    }

    // Выполняем общую очистку
    await cleanup();

    return {
      operationalDeleted,
      strategicDeleted,
      operationalArchived,
      totalProcessed: operationalDeleted + strategicDeleted + operationalArchived,
    };
  });
}

// ──────────────────────────────────────────────
// 9. Экспорт всех функций
// ──────────────────────────────────────────────

export { success, error, timed };
