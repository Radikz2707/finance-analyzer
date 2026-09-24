/**
 * AI Memory — двухслойная система памяти для ИИ-агентов.
 *
 * Оперативная память:
 * - Детальные логи, переписка, решения за 7-14 дней
 * - Быстрый поиск по ключевым словам и типам
 * - Автосжатие старых записей
 *
 * Стратегическая память:
 * - Сжатые KPI портфеля за 3-6 месяцев
 * - Трендовый анализ и обнаружение аномалий
 * - Архивация снимков по расписанию
 */

import Database from 'better-sqlite3';
import type {
  MemoryState,
  MemoryEntryType,
  MemoryPriority,
  OperationalMemoryEntry,
  PortfolioKpiSnapshot,
  StrategicMemoryEntry,
  MemoryQuery,
  MemoryQueryResult,
  AIMemoryConfig,
  AIMemoryStats,
  IAIMemory,
} from './types';

import {
  DEFAULT_OPERATIONAL_TTL_DAYS,
  DEFAULT_MAX_OPERATIONAL_ENTRIES,
  DEFAULT_MAX_STRATEGIC_ENTRIES,
  DEFAULT_KPI_ARCHIVE_INTERVAL_DAYS,
} from './types';

// ──────────────────────────────────────────────
// 0. Инстанс базы данных (in-memory для тестов)
// ──────────────────────────────────────────────

/**
 * Создаёт инстанс SQLite базы данных.
 * В тестовом режиме (NODE_ENV=test) использует in-memory базу для полной изоляции данных.
 * В production — сохраняет данные в ./data/ai-memory.db с WAL-режимом для конкурентного доступа.
 * @returns инстанс SQLite базы данных с настроенными pragma
 */
function createDatabase(): Database.Database {
  const isTest = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  const dbPath = isTest ? ':memory:' : './data/ai-memory.db';

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  return db;
}

let db = createDatabase();

/**
 * Пересоздаёт базу данных — закрывает текущую, создаёт новую in-memory и инициализирует таблицы.
 * Используется в тестах для обеспечения чистой среды между тестами.
 * НЕ вызывается в production — данные будут потеряны.
 */
function resetDatabase(): void {
  db.close();
  db = createDatabase();
  initializeMemoryTables();
}

// ──────────────────────────────────────────────
// 1. Конфигурация по умолчанию
// ──────────────────────────────────────────────

const DEFAULT_CONFIG: AIMemoryConfig = {
  maxOperationalEntries: DEFAULT_MAX_OPERATIONAL_ENTRIES,
  operationalTtlDays: DEFAULT_OPERATIONAL_TTL_DAYS,
  maxStrategicEntries: DEFAULT_MAX_STRATEGIC_ENTRIES,
  kpiArchiveIntervalDays: DEFAULT_KPI_ARCHIVE_INTERVAL_DAYS,
  verbose: false,
};

// ──────────────────────────────────────────────
// 2. Состояние модуля
// ──────────────────────────────────────────────

let currentState: MemoryState = 'idle';
let config: AIMemoryConfig = { ...DEFAULT_CONFIG };

function setState(state: MemoryState): void {
  currentState = state;
  if (config.verbose) {
    console.log(`[AI-Memory] Состояние: ${state}`);
  }
}

// ──────────────────────────────────────────────
// 3. Инициализация таблиц памяти
// ──────────────────────────────────────────────

function initializeMemoryTables(): void {
  const now = new Date().toISOString();

  // Оперативная память ИИ
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_operational_memory (
      id TEXT PRIMARY KEY,
      entry_type TEXT NOT NULL CHECK(entry_type IN (
        'conversation', 'pipeline_result', 'decision',
        'kpi_snapshot', 'trend_data', 'anomaly', 'recommendation'
      )),
      created_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('critical', 'high', 'medium', 'low')),
      keywords TEXT NOT NULL, -- JSON-массив
      content TEXT NOT NULL,
      metadata TEXT, -- JSON-объект
      size_bytes INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ai_operational_type ON ai_operational_memory(entry_type);
    CREATE INDEX IF NOT EXISTS idx_ai_operational_created ON ai_operational_memory(created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_operational_priority ON ai_operational_memory(priority);
    CREATE INDEX IF NOT EXISTS idx_ai_operational_keywords ON ai_operational_memory(keywords);
  `);

  // Стратегическая память
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_strategic_memory (
      id TEXT PRIMARY KEY,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('kpi_snapshot', 'trend_data', 'anomaly')),
      date TEXT NOT NULL,
      compressed_data TEXT NOT NULL,
      raw_data TEXT, -- JSON-снимок KPI (опционально)
      trend_direction TEXT CHECK(trend_direction IN ('up', 'down', 'stable')),
      trend_strength REAL,
      trend_period_days INTEGER,
      anomalies TEXT, -- JSON-массив аномалий
      created_at TEXT NOT NULL DEFAULT '${now}'
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ai_strategic_date ON ai_strategic_memory(date);
    CREATE INDEX IF NOT EXISTS idx_ai_strategic_type ON ai_strategic_memory(entry_type);
  `);

  // Триггер для ограничения оперативной памяти
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS ai_clean_operational_overflow
    AFTER INSERT ON ai_operational_memory
    BEGIN
      DELETE FROM ai_operational_memory
      WHERE id NOT IN (
        SELECT id FROM ai_operational_memory
        ORDER BY created_at DESC
        LIMIT ${DEFAULT_CONFIG.maxOperationalEntries}
      );
    END;
  `);

  // Триггер для ограничения стратегической памяти
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS ai_clean_strategic_overflow
    AFTER INSERT ON ai_strategic_memory
    BEGIN
      DELETE FROM ai_strategic_memory
      WHERE id NOT IN (
        SELECT id FROM ai_strategic_memory
        ORDER BY date DESC
        LIMIT ${DEFAULT_CONFIG.maxStrategicEntries}
      );
    END;
  `);

  if (config.verbose) {
    console.log('[AI-Memory] Таблицы инициализированы');
  }
}

// ──────────────────────────────────────────────
// 4. Утилиты
// ──────────────────────────────────────────────

/**
 * Генерирует уникальный идентификатор (UUID v4).
 * Используется для всех записей оперативной и стратегической памяти.
 * @returns строка UUID v4
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Подсчитывает размер строки в байтах при кодировании в UTF-8.
 * Используется для оценки размера записей и контроля лимитов хранилища.
 * @param str — входная строка
 * @returns размер в байтах
 */
function countBytes(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Безопасно парсит JSON-строку из колонки базы данных.
 * Возвращает null при ошибке парсинга или пустом значении.
 * @param raw — сырая JSON-строка из БД (или null)
 * @returns распарсенный объект или null
 */
function parseJsonColumn<T = unknown>(
  raw: string | null | undefined,
): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Сжимает текстовый контент — удаляет множественные пробелы и пустые строки.
 * Используется для уменьшения объёма оперативной памяти при архивации старых записей.
 * @param content — исходный текст
 * @returns сжатая строка
 */
function compressContent(content: string): string {
  return content.replace(/\s+/g, ' ').replace(/\n+/g, '\n').trim();
}

// ──────────────────────────────────────────────
// 5. Оперативная память
// ──────────────────────────────────────────────

const operationalMemory = {
  /**
   * Сохраняет запись в оперативную память.
   * Генерирует ID, устанавливает время создания и доступа, подсчитывает размер.
   * Триггер БД автоматически удалит самые старые записи при превышении лимита.
   * @param params — данные записи (без id, sizeBytes, lastAccessedAt)
   * @returns ID сохранённой записи
   */
  save(
    params: Omit<OperationalMemoryEntry, 'id' | 'sizeBytes' | 'lastAccessedAt'>,
  ): string {
    initializeMemoryTables();

    const id = generateId();
    const now = new Date().toISOString();
    const content = params.content || '';
    const sizeBytes = countBytes(content);
    const keywordsJson = JSON.stringify(params.keywords || []);
    const metadataJson = params.metadata
      ? JSON.stringify(params.metadata)
      : null;

    const stmt = db.prepare(`
      INSERT INTO ai_operational_memory (
        id, entry_type, created_at, last_accessed_at,
        priority, keywords, content, metadata, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.type,
      now,
      now,
      params.priority,
      keywordsJson,
      content,
      metadataJson,
      sizeBytes,
    );

    if (config.verbose) {
      console.log(
        `[AI-Memory] Оперативная запись сохранена: ${id} (${params.type})`,
      );
    }

    return id;
  },

  /**
   * Получает запись оперативной памяти по ID.
   * Обновляет lastAccessedAt при каждом чтении (для определения «горячих» записей).
   * @param id — уникальный идентификатор записи
   * @returns запись или undefined если не найдена
   */
  getById(id: string): OperationalMemoryEntry | undefined {
    initializeMemoryTables();

    const stmt = db.prepare('SELECT * FROM ai_operational_memory WHERE id = ?');
    const raw = stmt.get(id) as Record<string, unknown> | undefined;

    if (!raw) return undefined;

    // Обновляем lastAccessedAt
    const updateStmt = db.prepare(`
      UPDATE ai_operational_memory SET last_accessed_at = ? WHERE id = ?
    `);
    updateStmt.run(new Date().toISOString(), id);

    return {
      id: raw.id as string,
      type: raw.entry_type as MemoryEntryType,
      createdAt: raw.created_at as string,
      lastAccessedAt: raw.last_accessed_at as string,
      priority: raw.priority as MemoryPriority,
      keywords: parseJsonColumn<string[]>(raw.keywords as string) || [],
      content: raw.content as string,
      metadata: parseJsonColumn(raw.metadata as string) || undefined,
      sizeBytes: raw.size_bytes as number,
    };
  },

  /**
   * Получает последние N записей оперативной памяти, отсортированные по дате создания.
   * @param limit — максимальное количество записей (по умолчанию 50)
   * @returns массив записей от новых к старым
   */
  getRecent(limit = 50): OperationalMemoryEntry[] {
    initializeMemoryTables();

    const stmt = db.prepare(`
      SELECT * FROM ai_operational_memory
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      type: row.entry_type as MemoryEntryType,
      createdAt: row.created_at as string,
      lastAccessedAt: row.last_accessed_at as string,
      priority: row.priority as MemoryPriority,
      keywords: parseJsonColumn<string[]>(row.keywords as string) || [],
      content: row.content as string,
      metadata: parseJsonColumn(row.metadata as string) || undefined,
      sizeBytes: row.size_bytes as number,
    }));
  },

  /**
   * Получает записи оперативной памяти заданного типа.
   * @param type — тип записи для фильтрации
   * @param limit — максимальное количество записей (по умолчанию 50)
   * @returns массив записей указанного типа
   */
  getByType(type: MemoryEntryType, limit = 50): OperationalMemoryEntry[] {
    initializeMemoryTables();

    const stmt = db.prepare(`
      SELECT * FROM ai_operational_memory
      WHERE entry_type = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(type, limit) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      type: row.entry_type as MemoryEntryType,
      createdAt: row.created_at as string,
      lastAccessedAt: row.last_accessed_at as string,
      priority: row.priority as MemoryPriority,
      keywords: parseJsonColumn<string[]>(row.keywords as string) || [],
      content: row.content as string,
      metadata: parseJsonColumn(row.metadata as string) || undefined,
      sizeBytes: row.size_bytes as number,
    }));
  },

  /**
   * Ищет записи оперативной памяти по ключевым словам в JSON-колонке keywords.
   * Использует SQL LIKE для каждого ключевого слова (OR-соединение).
   * @param keywords — массив ключевых слов для поиска
   * @param limit — максимальное количество результатов (по умолчанию 50)
   * @returns массив найденных записей
   */
  searchByKeywords(keywords: string[], limit = 50): OperationalMemoryEntry[] {
    initializeMemoryTables();

    // Используем LIKE для каждого ключевого слова
    const conditions = keywords.map(() => 'keywords LIKE ?').join(' OR ');
    const stmt = db.prepare(`
      SELECT * FROM ai_operational_memory
      WHERE ${conditions}
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const params = [...keywords.map((k) => `%${k}%`), limit];
    const rows = stmt.all(...params) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      type: row.entry_type as MemoryEntryType,
      createdAt: row.created_at as string,
      lastAccessedAt: row.last_accessed_at as string,
      priority: row.priority as MemoryPriority,
      keywords: parseJsonColumn<string[]>(row.keywords as string) || [],
      content: row.content as string,
      metadata: parseJsonColumn(row.metadata as string) || undefined,
      sizeBytes: row.size_bytes as number,
    }));
  },

  /**
   * Получает записи оперативной памяти заданного уровня важности.
   * Полезно для получения критических записей перед очисткой.
   * @param priority — уровень важности для фильтрации
   * @param limit — максимальное количество записей (по умолчанию 50)
   * @returns массив записей с указанным приоритетом
   */
  getByPriority(
    priority: MemoryPriority,
    limit = 50,
  ): OperationalMemoryEntry[] {
    initializeMemoryTables();

    const stmt = db.prepare(`
      SELECT * FROM ai_operational_memory
      WHERE priority = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(priority, limit) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      type: row.entry_type as MemoryEntryType,
      createdAt: row.created_at as string,
      lastAccessedAt: row.last_accessed_at as string,
      priority: row.priority as MemoryPriority,
      keywords: parseJsonColumn<string[]>(row.keywords as string) || [],
      content: row.content as string,
      metadata: parseJsonColumn(row.metadata as string) || undefined,
      sizeBytes: row.size_bytes as number,
    }));
  },

  /**
   * Удаляет запись оперативной памяти по ID.
   * @param id — уникальный идентификатор записи
   * @returns true если запись найдена и удалена, false иначе
   */
  delete(id: string): boolean {
    initializeMemoryTables();

    const stmt = db.prepare('DELETE FROM ai_operational_memory WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  },

  /**
   * Получает все записи оперативной памяти (без лимита).
   * Осторожно: при большом количестве записей может быть ресурсоёмким.
   * @returns массив всех записей, отсортированных по дате (новые первые)
   */
  getAll(): OperationalMemoryEntry[] {
    initializeMemoryTables();

    const stmt = db.prepare(`
      SELECT * FROM ai_operational_memory
      ORDER BY created_at DESC
    `);

    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      type: row.entry_type as MemoryEntryType,
      createdAt: row.created_at as string,
      lastAccessedAt: row.last_accessed_at as string,
      priority: row.priority as MemoryPriority,
      keywords: parseJsonColumn<string[]>(row.keywords as string) || [],
      content: row.content as string,
      metadata: parseJsonColumn(row.metadata as string) || undefined,
      sizeBytes: row.size_bytes as number,
    }));
  },

  /**
   * Получает общее количество записей в оперативной памяти.
   * @returns количество записей
   */
  count(): number {
    initializeMemoryTables();

    const stmt = db.prepare(
      'SELECT COUNT(*) as total FROM ai_operational_memory',
    );
    const result = stmt.get() as { total: number };
    return result.total;
  },

  /**
   * Удаляет записи оперативной памяти старше указанного количества дней.
   * По умолчанию использует operationalTtlDays из конфигурации (14 дней).
   * @param ttlDays — порог в днях (по умолчанию из конфигурации)
   * @returns количество удалённых записей
   */
  cleanupOld(ttlDays?: number): number {
    initializeMemoryTables();

    const days = ttlDays ?? config.operationalTtlDays;
    const stmt = db.prepare(`
      DELETE FROM ai_operational_memory
      WHERE created_at < datetime('now', ?)
    `);

    const result = stmt.run(`-${days} days`);
    if (config.verbose && result.changes > 0) {
      console.log(
        `[AI-Memory] Оперативная память: удалено ${result.changes} старых записей`,
      );
    }

    return result.changes;
  },

  /**
   * Сжимает контент записей старше указанного порога дней.
   * Применяет compressContent к каждой старой записи для экономии места.
   * НЕ удаляет записи — только сжимает их содержимое.
   * @param daysThreshold — порог в днях (по умолчанию 7)
   * @returns количество сжатых записей
   */
  archiveOld(daysThreshold = 7): number {
    initializeMemoryTables();

    // Находим записи старше порога
    const stmt = db.prepare(`
      SELECT id, content FROM ai_operational_memory
      WHERE created_at < datetime('now', ?)
    `);

    const rows = stmt.all(`-${daysThreshold} days`) as {
      id: string;
      content: string;
    }[];

    for (const row of rows) {
      const compressed = compressContent(row.content);
      const updateStmt = db.prepare(`
        UPDATE ai_operational_memory SET content = ?, size_bytes = ?
        WHERE id = ?
      `);
      updateStmt.run(compressed, countBytes(compressed), row.id);
    }

    if (config.verbose && rows.length > 0) {
      console.log(
        `[AI-Memory] Оперативная память: сжато ${rows.length} записей`,
      );
    }

    return rows.length;
  },
};

// ──────────────────────────────────────────────
// 6. Стратегическая память
// ──────────────────────────────────────────────

const strategicMemory = {
  /**
   * Сохраняет снимок KPI портфеля в стратегическую память.
   * Сохраняет полный raw_data (все поля) и сжатую версию (ключевые метрики).
   * Триггер БД автоматически удалит самые старые записи при превышении лимита.
   * @param snapshot — полный снимок метрик портфеля
   * @returns ID сохранённой записи
   */
  saveKpi(snapshot: PortfolioKpiSnapshot): string {
    initializeMemoryTables();

    const id = generateId();
    const now = new Date().toISOString();
    const rawDataJson = JSON.stringify(snapshot);
    const compressedData = compressContent(
      JSON.stringify({
        date: snapshot.date,
        totalValue: snapshot.totalValue,
        returnPercent: snapshot.returnPercent,
        volatility: snapshot.volatility,
        sharpeRatio: snapshot.sharpeRatio,
        maxDrawdown: snapshot.maxDrawdown,
      }),
    );

    const stmt = db.prepare(`
      INSERT INTO ai_strategic_memory (
        id, entry_type, date, compressed_data, raw_data,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      'kpi_snapshot',
      snapshot.date,
      compressedData,
      rawDataJson,
      now,
    );

    if (config.verbose) {
      console.log(`[AI-Memory] KPI-снимок сохранён: ${id}`);
    }

    return id;
  },

  /**
   * Сохраняет результат трендового анализа в стратегическую память.
   * @param data — направление, сила и период тренда с описанием
   * @returns ID сохранённой записи
   */
  saveTrend(data: {
    direction: 'up' | 'down' | 'stable';
    strength: number;
    periodDays: number;
    description: string;
  }): string {
    initializeMemoryTables();

    const id = generateId();
    const now = new Date().toISOString();
    const trendData = JSON.stringify({
      direction: data.direction,
      strength: data.strength,
      periodDays: data.periodDays,
      description: data.description,
    });
    const compressedData = compressContent(trendData);

    const stmt = db.prepare(`
        INSERT INTO ai_strategic_memory (
          id, entry_type, date, compressed_data,
          trend_direction, trend_strength, trend_period_days,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

    stmt.run(
      id,
      'trend_data',
      now,
      compressedData,
      data.direction,
      data.strength,
      data.periodDays,
      now,
    );

    if (config.verbose) {
      console.log(`[AI-Memory] Трендовая запись сохранена: ${id}`);
    }

    return id;
  },

  /**
   * Сохраняет запись об обнаруженной аномалии в стратегическую память.
   * @param data — тип, серьёзность и описание аномалии
   * @returns ID сохранённой записи
   */
  saveAnomaly(data: {
    type: string;
    severity: number;
    description: string;
    relatedKpiId?: string;
  }): string {
    initializeMemoryTables();

    const id = generateId();
    const now = new Date().toISOString();
    const anomalyJson = JSON.stringify({
      type: data.type,
      severity: data.severity,
      description: data.description,
      relatedKpiId: data.relatedKpiId,
    });
    const compressedData = compressContent(anomalyJson);

    const stmt = db.prepare(`
        INSERT INTO ai_strategic_memory (
          id, entry_type, date, compressed_data,
          anomalies, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

    stmt.run(
      id,
      'anomaly',
      now,
      compressedData,
      JSON.stringify([
        {
          type: data.type,
          severity: data.severity,
          description: data.description,
        },
      ]),
      now,
    );

    if (config.verbose) {
      console.log(`[AI-Memory] Аномалия сохранена: ${id}`);
    }

    return id;
  },

  /**
   * Получает все стратегические записи с разбором JSON-колонок.
   * @param limit — максимальное количество записей (по умолчанию 500)
   * @returns массив стратегических записей, отсортированных по дате (новые первые)
   */
  getAll(limit = 500): StrategicMemoryEntry[] {
    initializeMemoryTables();

    const stmt = db.prepare(`
        SELECT * FROM ai_strategic_memory
        ORDER BY date DESC
        LIMIT ?
      `);

    const rows = stmt.all(limit) as Record<string, unknown>[];

    return rows.map((row) => {
      const anomalies = parseJsonColumn<
        Array<{
          type: string;
          severity: number;
          description: string;
        }>
      >(row.anomalies as string);

      return {
        id: row.id as string,
        type: row.entry_type as 'kpi_snapshot' | 'trend_data' | 'anomaly',
        date: row.date as string,
        compressedData: row.compressed_data as string,
        raw: row.raw_data
          ? parseJsonColumn<PortfolioKpiSnapshot>(row.raw_data as string) ||
            undefined
          : undefined,
        trend: row.trend_direction
          ? {
              direction: row.trend_direction as 'up' | 'down' | 'stable',
              strength: (row.trend_strength as number) || 0,
              periodDays: (row.trend_period_days as number) || 0,
            }
          : undefined,
        anomalies: anomalies || undefined,
      };
    });
  },

  /**
   * Получает стратегические записи заданного типа.
   * @param type — тип записи: 'kpi_snapshot', 'trend_data' или 'anomaly'
   * @param limit — максимальное количество записей (по умолчанию 100)
   * @returns массив записей указанного типа
   */
  getByType(
    type: 'kpi_snapshot' | 'trend_data' | 'anomaly',
    limit = 100,
  ): StrategicMemoryEntry[] {
    initializeMemoryTables();

    const stmt = db.prepare(`
        SELECT * FROM ai_strategic_memory
        WHERE entry_type = ?
        ORDER BY date DESC
        LIMIT ?
      `);

    const rows = stmt.all(type, limit) as Record<string, unknown>[];

    return rows.map((row) => {
      const anomalies = parseJsonColumn<
        Array<{
          type: string;
          severity: number;
          description: string;
        }>
      >(row.anomalies as string);

      return {
        id: row.id as string,
        type: row.entry_type as 'kpi_snapshot' | 'trend_data' | 'anomaly',
        date: row.date as string,
        compressedData: row.compressed_data as string,
        raw: row.raw_data
          ? parseJsonColumn<PortfolioKpiSnapshot>(row.raw_data as string) ||
            undefined
          : undefined,
        trend: row.trend_direction
          ? {
              direction: row.trend_direction as 'up' | 'down' | 'stable',
              strength: (row.trend_strength as number) || 0,
              periodDays: (row.trend_period_days as number) || 0,
            }
          : undefined,
        anomalies: anomalies || undefined,
      };
    });
  },

  /**
   * Получает историю KPI-снимков для построения графиков трендов.
   * Возвращает только ключевые метрики из raw_data.
   * @param count — количество последних снимков (по умолчанию 12)
   * @returns массив снимков с основными метриками
   */
  getKpiTrend(count = 12): Array<{
    date: string;
    totalValue: number;
    returnPercent: number;
    volatility: number;
    sharpeRatio: number;
    maxDrawdown: number;
  }> {
    initializeMemoryTables();

    const stmt = db.prepare(`
        SELECT raw_data FROM ai_strategic_memory
        WHERE entry_type = 'kpi_snapshot'
        ORDER BY date DESC
        LIMIT ?
      `);

    const rows = stmt.all(count) as { raw_data: string }[];

    return rows
      .map((row) => {
        try {
          const data = JSON.parse(row.raw_data) as PortfolioKpiSnapshot;
          return {
            date: data.date,
            totalValue: data.totalValue,
            returnPercent: data.returnPercent,
            volatility: data.volatility,
            sharpeRatio: data.sharpeRatio,
            maxDrawdown: data.maxDrawdown,
          };
        } catch {
          return null;
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  },

  /**
   * Удаляет стратегическую запись по ID.
   * @param id — уникальный идентификатор записи
   * @returns true если запись найдена и удалена, false иначе
   */
  delete(id: string): boolean {
    initializeMemoryTables();

    const stmt = db.prepare('DELETE FROM ai_strategic_memory WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  },

  /**
   * Получает общее количество записей в стратегической памяти.
   * @returns количество записей
   */
  count(): number {
    initializeMemoryTables();

    const stmt = db.prepare(
      'SELECT COUNT(*) as total FROM ai_strategic_memory',
    );
    const result = stmt.get() as { total: number };
    return result.total;
  },

  /**
   * Удаляет старые стратегические записи старше указанного порога.
   * По умолчанию использует 2x operationalTtlDays (28 дней), т.к. стратегическая память хранится дольше.
   * @param daysThreshold — порог в днях (по умолчанию 28)
   * @returns количество удалённых записей
   */
  cleanupOld(daysThreshold?: number): number {
    initializeMemoryTables();

    const days = daysThreshold ?? (config.operationalTtlDays || 14) * 2; // стратегическая хранится дольше
    const stmt = db.prepare(`
        DELETE FROM ai_strategic_memory
        WHERE date < date('now', ?)
      `);

    const result = stmt.run(`-${days} days`);
    if (config.verbose && result.changes > 0) {
      console.log(
        `[AI-Memory] Стратегическая память: удалено ${result.changes} старых записей`,
      );
    }

    return result.changes;
  },
};

// ──────────────────────────────────────────────
// 7. Запросы к памяти (объединённые)
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
async function query(params: MemoryQuery): Promise<MemoryQueryResult> {
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
          const results = operationalMemory.searchByKeywords(
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
            const results = operationalMemory.getByType(
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
          const results = strategicMemory.getByType(
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
// 8. Статистика
// ──────────────────────────────────────────────

/**
 * Получает полную статистику модуля памяти.
 * Запрашивает метрики напрямую из SQLite: количество записей, размеры, средний возраст, аномалии.
 * Используется Dashboard для отображения KPI-карточек памяти.
 * @returns объект AIMemoryStats со всеми метриками
 */
function getStats(): AIMemoryStats {
  initializeMemoryTables();

  const operationalCount = operationalMemory.count();
  const strategicCount = strategicMemory.count();

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
// 9. Очистка просроченных записей
// ──────────────────────────────────────────────

/**
 * Выполняет полную очистку просроченных записей.
 * 1. Удаляет оперативные записи старше operationalTtlDays
 * 2. Удаляет стратегические записи старше 2x operationalTtlDays
 * 3. Архивирует (сжимает) оперативные записи старше 7 дней
 * @returns Promise, завершающийся при завершении очистки
 */
async function cleanup(): Promise<void> {
  setState('saving');

  try {
    const opCleaned = operationalMemory.cleanupOld();
    const stCleaned = strategicMemory.cleanupOld();
    const archived = operationalMemory.archiveOld();

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
// 10. Экспорт памяти
// ──────────────────────────────────────────────

/**
 * Экспортирует все данные памяти в формат JSON.
 * Включает статистику, все оперативные и стратегические записи, метку времени экспорта.
 * Используется для бэкапа или передачи данных внешним системам.
 * @returns строка JSON с полными данными памяти
 */
async function exportJson(): Promise<string> {
  setState('loading');

  try {
    const stats = getStats();
    const operationalEntries = operationalMemory.getAll();
    const strategicEntries = strategicMemory.getAll();

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
async function exportMarkdown(): Promise<string> {
  setState('loading');

  try {
    const stats = getStats();
    const operationalEntries = operationalMemory.getAll();
    const strategicEntries = strategicMemory.getAll();

    let md = '# AI Memory Export\n\n';
    md += `**Дата экспорта:** ${new Date().toISOString()}\n\n`;
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
 * Экспортировать память в указанном формате.
 * @param format — формат экспорта: 'json' или 'markdown'
 * @returns экспортированные данные
 */
async function exportMemory(format: 'json' | 'markdown'): Promise<string> {
  if (format === 'json') {
    return exportJson();
  } else {
    return exportMarkdown();
  }
}

// ──────────────────────────────────────────────
// 11. Конфигурация
// ──────────────────────────────────────────────

/**
 * Применяет новую конфигурацию к модулю памяти.
 * Обновляет параметры без перезапуска и потери данных.
 * Применяет shallow merge: указанные поля перезаписываются, остальные сохраняются.
 * @param newConfig — частичная конфигурация для обновления (любое подмножество полей AIMemoryConfig)
 */
function configure(newConfig: Partial<AIMemoryConfig>): void {
  config = { ...config, ...newConfig };
  if (config.verbose) {
    console.log('[AI-Memory] Конфигурация обновлена:', config);
  }
}

/**
 * Получает текущую конфигурацию модуля.
 * Возвращает копию объекта, чтобы внешние изменения не влияли на внутреннее состояние.
 * @returns копия текущей конфигурации AIMemoryConfig
 */
function getConfig(): AIMemoryConfig {
  return { ...config };
}

// ──────────────────────────────────────────────
// 12. Главный экспорт модуля
// ──────────────────────────────────────────────

/**
 * Инициализирует модуль памяти: создаёт таблицы и настраивает параметры.
 * Вызывается автоматически при импорте модуля (автоматическая инициализация внизу файла).
 * В тестовом режиме (NODE_ENV=test) пересоздаёт базу с нуля.
 * @param cfg — опциональная конфигурация (любое подмножество полей AIMemoryConfig)
 */
function init(cfg?: Partial<AIMemoryConfig>): void {
  // В тестовом режиме пересоздаём базу данных
  const isTest = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  if (isTest) {
    db.close();
    db = createDatabase();
  }

  if (cfg) {
    configure(cfg);
  }
  initializeMemoryTables();
  console.log('🧠 AI-Memory: двухслойная память инициализирована');
  console.log(
    `   Оперативная: ${config.operationalTtlDays} дней, до ${config.maxOperationalEntries} записей`,
  );
  console.log(`   Стратегическая: до ${config.maxStrategicEntries} записей`);
}

/**
 * Получить состояние памяти.
 * @returns текущее состояние ('idle' | 'loading' | 'saving' | 'error')
 */
  /**
   * Получает текущее состояние модуля памяти.
   * @returns текущее состояние ('idle' | 'loading' | 'saving' | 'error')
   */
  function getState(): MemoryState {
    return currentState;
  }

  /**
   * Очищает все записи из обеих таблиц памяти.
   * ТОЛЬКО для тестов — данные не восстанавливаются!
   * НЕ вызывается в production.
   */
  function clearAll(): void {
    initializeMemoryTables();
    db.exec('DELETE FROM ai_operational_memory');
    db.exec('DELETE FROM ai_strategic_memory');
  }

// Экспорт всех функций и объектов
export {
  init,
  resetDatabase,
  getState,
  configure,
  getConfig,
  query,
  cleanup,
  exportMemory,
  getStats,
  clearAll,
  operationalMemory,
  strategicMemory,
};

// Привязка методов к интерфейсу IAIMemory
const aiMemoryImpl: IAIMemory = {
  saveOperational: (
    entry: Omit<OperationalMemoryEntry, 'id' | 'sizeBytes' | 'lastAccessedAt'>,
  ) => {
    const id = operationalMemory.save(entry);
    return Promise.resolve(id);
  },
  saveStrategicKpi: (snapshot: PortfolioKpiSnapshot) => {
    strategicMemory.saveKpi(snapshot);
    return Promise.resolve();
  },
  query: (queryParams: MemoryQuery) => query(queryParams),
  getStats: () => getStats(),
  getState: () => getState(),
  cleanup: () => cleanup(),
  exportMemory: (format: 'json' | 'markdown') => exportMemory(format),
};

// Экспорт реализации
export { aiMemoryImpl };

// Автоматическая инициализация при импорте
init();
