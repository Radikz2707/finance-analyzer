/**
 * Strategic Memory — модуль стратегической памяти.
 *
 * Хранит сжатые KPI-снимки, трендовые данные и информацию об аномалиях
 * за период до 3-6 месяцев.
 * Поддерживает:
 * - Сохранение KPI-снимков, трендов, аномалий
 * - Получение по типам и истории
 * - TTL-очистку старых записей
 */

import Database from 'better-sqlite3';
import type {
  PortfolioKpiSnapshot,
  StrategicMemoryEntry,
} from './types';
import {
  generateId,
  compressContent,
  parseStrategicRow,
} from './database';

// ──────────────────────────────────────────────
// 1. Сохранение записей
// ──────────────────────────────────────────────

/**
 * Сохраняет снимок KPI портфеля в стратегическую память.
 * Сохраняет полный raw_data (все поля) и сжатую версию (ключевые метрики).
 * Триггер БД автоматически удалит самые старые записи при превышении лимита.
 * @param db — инстанс SQLite базы данных
 * @param snapshot — полный снимок метрик портфеля
 * @returns ID сохранённой записи
 */
export function saveStrategicKpi(
  db: Database.Database,
  snapshot: PortfolioKpiSnapshot,
): string {
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

  return id;
}

/**
 * Сохраняет результат трендового анализа в стратегическую память.
 * @param db — инстанс SQLite базы данных
 * @param data — направление, сила и период тренда с описанием
 * @returns ID сохранённой записи
 */
export function saveStrategicTrend(
  db: Database.Database,
  data: {
    direction: 'up' | 'down' | 'stable';
    strength: number;
    periodDays: number;
    description: string;
  },
): string {
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

  return id;
}

/**
 * Сохраняет запись об обнаруженной аномалии в стратегическую память.
 * @param db — инстанс SQLite базы данных
 * @param data — тип, серьёзность и описание аномалии
 * @returns ID сохранённой записи
 */
export function saveStrategicAnomaly(
  db: Database.Database,
  data: {
    type: string;
    severity: number;
    description: string;
    relatedKpiId?: string;
  },
): string {
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

  return id;
}

// ──────────────────────────────────────────────
// 2. Получение записей
// ──────────────────────────────────────────────

/**
 * Получает все стратегические записи с разбором JSON-колонок.
 * @param db — инстанс SQLite базы данных
 * @param limit — максимальное количество записей (по умолчанию 500)
 * @returns массив стратегических записей, отсортированных по дате (новые первые)
 */
export function getAllStrategic(
  db: Database.Database,
  limit = 500,
): StrategicMemoryEntry[] {
  const stmt = db.prepare(`
    SELECT * FROM ai_strategic_memory
    ORDER BY date DESC
    LIMIT ?
  `);

  const rows = stmt.all(limit) as Record<string, unknown>[];
  return rows.map(parseStrategicRow);
}

/**
 * Получает стратегические записи заданного типа.
 * @param db — инстанс SQLite базы данных
 * @param type — тип записи: 'kpi_snapshot', 'trend_data' или 'anomaly'
 * @param limit — максимальное количество записей (по умолчанию 100)
 * @returns массив записей указанного типа
 */
export function getStrategicByType(
  db: Database.Database,
  type: 'kpi_snapshot' | 'trend_data' | 'anomaly',
  limit = 100,
): StrategicMemoryEntry[] {
  const stmt = db.prepare(`
    SELECT * FROM ai_strategic_memory
    WHERE entry_type = ?
    ORDER BY date DESC
    LIMIT ?
  `);

  const rows = stmt.all(type, limit) as Record<string, unknown>[];
  return rows.map(parseStrategicRow);
}

/**
 * Получает историю KPI-снимков для построения графиков трендов.
 * Возвращает только ключевые метрики из raw_data.
 * @param db — инстанс SQLite базы данных
 * @param count — количество последних снимков (по умолчанию 12)
 * @returns массив снимков с основными метриками
 */
export function getStrategicKpiTrend(
  db: Database.Database,
  count = 12,
): Array<{
  date: string;
  totalValue: number;
  returnPercent: number;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
}> {
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
}

/**
 * Удаляет стратегическую запись по ID.
 * @param db — инстанс SQLite базы данных
 * @param id — уникальный идентификатор записи
 * @returns true если запись найдена и удалена, false иначе
 */
export function deleteStrategic(db: Database.Database, id: string): boolean {
  const stmt = db.prepare('DELETE FROM ai_strategic_memory WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Получает общее количество записей в стратегической памяти.
 * @param db — инстанс SQLite базы данных
 * @returns количество записей
 */
export function countStrategic(db: Database.Database): number {
  const stmt = db.prepare(
    'SELECT COUNT(*) as total FROM ai_strategic_memory',
  );
  const result = stmt.get() as { total: number };
  return result.total;
}

/**
 * Удаляет старые стратегические записи старше указанного порога.
 * @param db — инстанс SQLite базы данных
 * @param daysThreshold — порог в днях (по умолчанию 28)
 * @returns количество удалённых записей
 */
export function cleanupStrategicOld(
  db: Database.Database,
  daysThreshold: number,
): number {
  const stmt = db.prepare(`
    DELETE FROM ai_strategic_memory
    WHERE date < date('now', ?)
  `);

  const result = stmt.run(`-${daysThreshold} days`);
  return result.changes;
}
