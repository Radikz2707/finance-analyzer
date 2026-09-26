/**
 * Operational Memory — модуль оперативной памяти.
 *
 * Хранит детальные логи, переписку, решения за 7-14 дней.
 * Поддерживает:
 * - CRUD операции (save, getById, delete, getAll)
 * - Поиск по типам, приоритету, ключевым словам
 * - TTL-очистку и архивацию старых записей
 * - Пагинацию и фильтрацию
 */

import Database from 'better-sqlite3';
import type {
  MemoryEntryType,
  MemoryPriority,
  OperationalMemoryEntry,
} from './types';
import {
  generateId,
  countBytes,
  compressContent,
  parseOperationalRow,
} from './database';

// ──────────────────────────────────────────────
// 1. CRUD операции
// ──────────────────────────────────────────────

/**
 * Сохраняет запись в оперативную память.
 * Генерирует ID, устанавливает время создания и доступа, подсчитывает размер.
 * Триггер БД автоматически удалит самые старые записи при превышении лимита.
 * @param db — инстанс SQLite базы данных
 * @param params — данные записи (без id, sizeBytes, lastAccessedAt)
 * @returns ID сохранённой записи
 */
export function saveOperational(
  db: Database.Database,
  params: Omit<OperationalMemoryEntry, 'id' | 'sizeBytes' | 'lastAccessedAt'>,
): string {
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

  return id;
}

/**
 * Получает запись оперативной памяти по ID.
 * Обновляет lastAccessedAt при каждом чтении (для определения «горячих» записей).
 * @param db — инстанс SQLite базы данных
 * @param id — уникальный идентификатор записи
 * @returns запись или undefined если не найдена
 */
export function getOperationalById(
  db: Database.Database,
  id: string,
): OperationalMemoryEntry | undefined {
  const stmt = db.prepare('SELECT * FROM ai_operational_memory WHERE id = ?');
  const raw = stmt.get(id) as Record<string, unknown> | undefined;

  if (!raw) return undefined;

  // Обновляем lastAccessedAt
  const updateStmt = db.prepare(`
    UPDATE ai_operational_memory SET last_accessed_at = ? WHERE id = ?
  `);
  updateStmt.run(new Date().toISOString(), id);

  return parseOperationalRow(raw);
}

/**
 * Получает последние N записей оперативной памяти, отсортированные по дате создания.
 * @param db — инстанс SQLite базы данных
 * @param limit — максимальное количество записей (по умолчанию 50)
 * @returns массив записей от новых к старым
 */
export function getOperationalRecent(
  db: Database.Database,
  limit = 50,
): OperationalMemoryEntry[] {
  const stmt = db.prepare(`
    SELECT * FROM ai_operational_memory
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(limit) as Record<string, unknown>[];
  return rows.map(parseOperationalRow);
}

/**
 * Получает записи оперативной памяти заданного типа.
 * @param db — инстанс SQLite базы данных
 * @param type — тип записи для фильтрации
 * @param limit — максимальное количество записей (по умолчанию 50)
 * @returns массив записей указанного типа
 */
export function getOperationalByType(
  db: Database.Database,
  type: MemoryEntryType,
  limit = 50,
): OperationalMemoryEntry[] {
  const stmt = db.prepare(`
    SELECT * FROM ai_operational_memory
    WHERE entry_type = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(type, limit) as Record<string, unknown>[];
  return rows.map(parseOperationalRow);
}

/**
 * Ищет записи оперативной памяти по ключевым словам в JSON-колонке keywords.
 * Использует SQL LIKE для каждого ключевого слова (OR-соединение).
 * @param db — инстанс SQLite базы данных
 * @param keywords — массив ключевых слов для поиска
 * @param limit — максимальное количество результатов (по умолчанию 50)
 * @returns массив найденных записей
 */
export function searchOperationalByKeywords(
  db: Database.Database,
  keywords: string[],
  limit = 50,
): OperationalMemoryEntry[] {
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
  return rows.map(parseOperationalRow);
}

/**
 * Получает записи оперативной памяти заданного уровня важности.
 * Полезно для получения критических записей перед очисткой.
 * @param db — инстанс SQLite базы данных
 * @param priority — уровень важности для фильтрации
 * @param limit — максимальное количество записей (по умолчанию 50)
 * @returns массив записей с указанным приоритетом
 */
export function getOperationalByPriority(
  db: Database.Database,
  priority: MemoryPriority,
  limit = 50,
): OperationalMemoryEntry[] {
  const stmt = db.prepare(`
    SELECT * FROM ai_operational_memory
    WHERE priority = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(priority, limit) as Record<string, unknown>[];
  return rows.map(parseOperationalRow);
}

/**
 * Удаляет запись оперативной памяти по ID.
 * @param db — инстанс SQLite базы данных
 * @param id — уникальный идентификатор записи
 * @returns true если запись найдена и удалена, false иначе
 */
export function deleteOperational(db: Database.Database, id: string): boolean {
  const stmt = db.prepare('DELETE FROM ai_operational_memory WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Получает все записи оперативной памяти (без лимита).
 * Осторожно: при большом количестве записей может быть ресурсоёмким.
 * @param db — инстанс SQLite базы данных
 * @returns массив всех записей, отсортированных по дате (новые первые)
 */
export function getAllOperational(db: Database.Database): OperationalMemoryEntry[] {
  const stmt = db.prepare(`
    SELECT * FROM ai_operational_memory
    ORDER BY created_at DESC
  `);

  const rows = stmt.all() as Record<string, unknown>[];
  return rows.map(parseOperationalRow);
}

/**
 * Получает общее количество записей в оперативной памяти.
 * @param db — инстанс SQLite базы данных
 * @returns количество записей
 */
export function countOperational(db: Database.Database): number {
  const stmt = db.prepare(
    'SELECT COUNT(*) as total FROM ai_operational_memory',
  );
  const result = stmt.get() as { total: number };
  return result.total;
}

// ──────────────────────────────────────────────
// 2. Очистка и архивация
// ──────────────────────────────────────────────

/**
 * Удаляет записи оперативной памяти старше указанного количества дней.
 * @param db — инстанс SQLite базы данных
 * @param ttlDays — порог в днях
 * @returns количество удалённых записей
 */
export function cleanupOperationalOld(
  db: Database.Database,
  ttlDays: number,
): number {
  const stmt = db.prepare(`
    DELETE FROM ai_operational_memory
    WHERE created_at < datetime('now', ?)
  `);

  const result = stmt.run(`-${ttlDays} days`);
  return result.changes;
}

/**
 * Сжимает контент записей старше указанного порога дней.
 * Применяет compressContent к каждой старой записи для экономии места.
 * НЕ удаляет записи — только сжимает их содержимое.
 * @param db — инстанс SQLite базы данных
 * @param daysThreshold — порог в днях (по умолчанию 7)
 * @returns количество сжатых записей
 */
export function archiveOperationalOld(
  db: Database.Database,
  daysThreshold = 7,
): number {
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

  return rows.length;
}
