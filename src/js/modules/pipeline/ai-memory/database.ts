/**
 * Database layer — создание и инициализация SQLite базы данных.
 *
 * Отвечает за:
 * - Создание инстанса БД (in-memory для тестов, file-based для production)
 * - Инициализацию таблиц и индексов
 * - Триггеры ограничения записей
 * - Утилиты (generateId, countBytes, parseJsonColumn, compressContent)
 */

import Database from 'better-sqlite3';
import type {
  MemoryEntryType,
  MemoryPriority,
  OperationalMemoryEntry,
  PortfolioKpiSnapshot,
  StrategicMemoryEntry,
} from './types';
import {
  DEFAULT_MAX_OPERATIONAL_ENTRIES,
  DEFAULT_MAX_STRATEGIC_ENTRIES,
} from './types';

// ──────────────────────────────────────────────
// 1. Создание базы данных
// ──────────────────────────────────────────────

/**
 * Создаёт инстанс SQLite базы данных.
 * В тестовом режиме (NODE_ENV=test) использует in-memory базу для полной изоляции данных.
 * В production — сохраняет данные в ./data/ai-memory.db с WAL-режимом для конкурентного доступа.
 * @returns инстанс SQLite базы данных с настроенными pragma
 */
export function createDatabase(): Database.Database {
  const isTest = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  const dbPath = isTest ? ':memory:' : './data/ai-memory.db';

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  return db;
}

// ──────────────────────────────────────────────
// 2. Инициализация таблиц
// ──────────────────────────────────────────────

/**
 * Создаёт все необходимые таблицы, индексы и триггеры.
 * Вызывается при инициализации модуля и при каждом первом запросе.
 */
export function initializeMemoryTables(db: Database.Database): void {
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
        LIMIT ${DEFAULT_MAX_OPERATIONAL_ENTRIES}
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
        LIMIT ${DEFAULT_MAX_STRATEGIC_ENTRIES}
      );
    END;
  `);
}

// ──────────────────────────────────────────────
// 3. Утилиты
// ──────────────────────────────────────────────

/**
 * Генерирует уникальный идентификатор (UUID v4).
 * @returns строка UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Подсчитывает размер строки в байтах при кодировании в UTF-8.
 * @param str — входная строка
 * @returns размер в байтах
 */
export function countBytes(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Безопасно парсит JSON-строку из колонки базы данных.
 * @param raw — сырая JSON-строка из БД (или null)
 * @returns распарсенный объект или null
 */
export function parseJsonColumn<T = unknown>(
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
 * @param content — исходный текст
 * @returns сжатая строка
 */
export function compressContent(content: string): string {
  return content.replace(/\s+/g, ' ').replace(/\n+/g, '\n').trim();
}

// ──────────────────────────────────────────────
// 4. Парсеры записей
// ──────────────────────────────────────────────

/**
 * Преобразует сырую строку из БД в OperationalMemoryEntry.
 * @param row — сырая строка из SQLite
 * @returns распарсенная запись оперативной памяти
 */
export function parseOperationalRow(row: Record<string, unknown>): OperationalMemoryEntry {
  return {
    id: row.id as string,
    type: row.entry_type as MemoryEntryType,
    createdAt: row.created_at as string,
    lastAccessedAt: row.last_accessed_at as string,
    priority: row.priority as MemoryPriority,
    keywords: parseJsonColumn<string[]>(row.keywords as string) || [],
    content: row.content as string,
    metadata: parseJsonColumn(row.metadata as string) || undefined,
    sizeBytes: row.size_bytes as number,
  };
}

/**
 * Преобразует сырую строку из БД в StrategicMemoryEntry.
 * @param row — сырая строка из SQLite
 * @returns распарсенная запись стратегической памяти
 */
export function parseStrategicRow(row: Record<string, unknown>): StrategicMemoryEntry {
  const anomalies = parseJsonColumn<
    Array<{ type: string; severity: number; description: string }>
  >(row.anomalies as string);

  return {
    id: row.id as string,
    type: row.entry_type as 'kpi_snapshot' | 'trend_data' | 'anomaly',
    date: row.date as string,
    compressedData: row.compressed_data as string,
    raw: row.raw_data
      ? parseJsonColumn<PortfolioKpiSnapshot>(row.raw_data as string) || undefined
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
}
