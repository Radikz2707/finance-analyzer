/**
 * Memory Layer Tests — двухслойная память (оперативная + стратегическая + сессии).
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect/vi),
 * а не импорт из 'vitest' (ограничение окружения: vitest 5.x + vite 8.x).
 *
 * Покрытие:
 * 1. Инициализация таблиц (идемпотентность)
 * 2. Оперативная память: add/getRecent/getByType/getByTicker, дефолтный severity
 * 3. getUnread / markRead / markAllRead
 * 4. getSummarySince — сводка за период (свежие и просроченные записи)
 * 5. TTL: триггер вычищает записи старше 14 дней
 * 6. Стратегическая память: aggregatePeriod и расчёты KPI, getReturnTrend
 * 7. Сессии: getOrCreate, история сообщений с лимитом, контекст, cleanupOld
 * 8. record-функции интеграции (trade, ai-analysis, risk, decision, recommendation)
 *
 * БД заменяется на in-memory SQLite, поэтому тесты не трогают data/finance.db.
 */

/**
 * Минимальный интерфейс БД, используемый memory-layer (prepare/exec).
 * Структурно совместим с экземпляром better-sqlite3 (in-memory в тесте).
 */
interface DbLike {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): {
      changes: number;
      lastInsertRowid: number | bigint;
    };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

/**
 * Хранилище для in-memory БД, создаваемой в фабрике vi.mock.
 * (Фабрика async — единственный способ получить реальный экземпляр снаружи.)
 */
const dbHolder = vi.hoisted(() => ({ db: null as unknown as DbLike }));

vi.mock('../db-manager/db-manager', async () => {
  const { default: DatabaseCtor } = await import('better-sqlite3');
  const db = new DatabaseCtor(':memory:');

  // memory-layer использует таблицы trades/positions только в aggregatePeriod,
  // но сам их не создаёт (это зона ответственности db-manager) — создаём здесь.
  db.exec(`
    CREATE TABLE trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      ticker TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      total_amount REAL NOT NULL,
      commission REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'EXECUTED',
      account_id TEXT NOT NULL,
      note TEXT,
      created_at TEXT
    );
    CREATE TABLE positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      name TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      quantity REAL NOT NULL DEFAULT 0,
      avg_price REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      current_price REAL,
      current_market_value REAL,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  dbHolder.db = db;
  return { db };
});

import {
  memoryLayer,
  operationalMemory,
  strategicMemory,
  sessionManager,
  recordAiAnalysis,
  recordTrade,
  recordRiskAlert,
  recordUserDecision,
  recordAiRecommendation,
} from './index.js';
import type {
  MemoryEventType,
  MemorySeverity,
  OperationalMemoryEntry,
} from './types.js';

const db = dbHolder.db;

/** Прямая вставка оперативной записи с произвольным timestamp (для TTL-тестов) */
function insertOperationalRaw(
  timestamp: string,
  summary: string,
  severity: MemorySeverity = 'LOW',
): void {
  db.prepare(
    `INSERT INTO operational_memory (timestamp, event_type, ticker, severity, summary, details, created_at)
     VALUES (?, ?, NULL, ?, ?, NULL, ?)`,
  ).run(timestamp, 'SYSTEM_EVENT', severity, summary, timestamp);
}

beforeEach(() => {
  // Таблицы памяти создаются лениво при первом обращении к модулю —
  // инициализируем заранее, чтобы DELETE был безопасен.
  memoryLayer();

  db.exec(`
    DELETE FROM operational_memory;
    DELETE FROM strategic_memory;
    DELETE FROM sessions;
    DELETE FROM trades;
    DELETE FROM positions;
  `);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Memory Layer', () => {
  it('memoryLayer() инициализирует таблицы без ошибок и идемпотентен', () => {
    expect(() => memoryLayer()).not.toThrow();
    expect(() => memoryLayer()).not.toThrow();
  });

  describe('Оперативная память', () => {
    it('add() сохраняет запись, getRecent() читает её обратно с дефолтным severity MEDIUM', () => {
      operationalMemory.add({
        eventType: 'SYSTEM_EVENT',
        summary: 's1',
        ticker: 'SBER',
        details: '{"ok":true}',
      });

      const rows = operationalMemory.getRecent(50);
      expect(rows).toHaveLength(1);
      const entry = rows[0]!;
      expect(entry.eventType).toBe('SYSTEM_EVENT');
      expect(entry.severity).toBe('MEDIUM');
      expect(entry.summary).toBe('s1');
      expect(entry.ticker).toBe('SBER');
      expect(entry.details).toBe('{"ok":true}');
      expect(entry.isRead).toBe(false);
      expect(entry.timestamp).toBeTruthy();
      expect(entry.createdAt).toBeTruthy();
      expect(entry.id).toBeGreaterThan(0);
    });

    it('add() сохраняет явный severity и необязательные поля могут отсутствовать', () => {
      operationalMemory.add({
        eventType: 'RISK_ALERT',
        severity: 'CRITICAL',
        summary: 'critical-risk',
      });

      const entry = operationalMemory.getRecent(1)[0]!;
      expect(entry.severity).toBe('CRITICAL');
      // Пустые ticker/details нормализуются к undefined/пустой строке
      expect(entry.ticker).toBeUndefined();
      expect(entry.details).toBe('');
    });

    it('getRecent() сортирует по timestamp DESC и уважает limit', () => {
      // Timestamp'ы обязаны быть «свежими»: TTL-триггер чистит записи
      // старше 14 дней по системному времени (fake timers его не трогают).
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);
      operationalMemory.add({ eventType: 'SYSTEM_EVENT', summary: 'first' });
      vi.setSystemTime(now + 60_000);
      operationalMemory.add({ eventType: 'SYSTEM_EVENT', summary: 'second' });
      vi.setSystemTime(now + 120_000);
      operationalMemory.add({ eventType: 'SYSTEM_EVENT', summary: 'third' });

      expect(operationalMemory.getRecent(50).map((e) => e.summary)).toEqual([
        'third',
        'second',
        'first',
      ]);
      expect(operationalMemory.getRecent(2).map((e) => e.summary)).toEqual([
        'third',
        'second',
      ]);
    });

    it('getByType() и getByTicker() фильтруют записи', () => {
      operationalMemory.add({
        eventType: 'RISK_ALERT',
        ticker: 'SBER',
        summary: 'r1',
      });
      operationalMemory.add({
        eventType: 'TRADE_EXECUTED',
        ticker: 'GAZP',
        summary: 't1',
      });
      operationalMemory.add({
        eventType: 'RISK_ALERT',
        ticker: 'GAZP',
        summary: 'r2',
      });

      const risks = operationalMemory.getByType('RISK_ALERT', 10);
      expect(risks.map((e) => e.summary).sort()).toEqual(['r1', 'r2']);

      const trades = operationalMemory.getByType('TRADE_EXECUTED', 10);
      expect(trades.map((e) => e.summary)).toEqual(['t1']);

      const gazp = operationalMemory.getByTicker('GAZP', 10);
      expect(gazp.map((e) => e.summary).sort()).toEqual(['r2', 't1']);

      const empty = operationalMemory.getByTicker('NOPE', 10);
      expect(empty).toHaveLength(0);
    });

    it('поддерживает все типы событий и уровни серьёзности', () => {
      const allTypes: MemoryEventType[] = [
        'AI_ANALYSIS',
        'TRADE_EXECUTED',
        'ORDER_PLACED',
        'NEWS_FILTERED',
        'RISK_ALERT',
        'PORTFOLIO_UPDATE',
        'AI_RECOMMENDATION',
        'SYSTEM_EVENT',
        'USER_DECISION',
      ];
      for (const type of allTypes) {
        operationalMemory.add({ eventType: type, summary: type });
      }
      for (const type of allTypes) {
        expect(operationalMemory.getByType(type, 10)).toHaveLength(1);
      }

      const severities: MemorySeverity[] = [
        'LOW',
        'MEDIUM',
        'HIGH',
        'CRITICAL',
      ];
      for (const severity of severities) {
        operationalMemory.add({
          eventType: 'SYSTEM_EVENT',
          severity,
          summary: `sev-${severity}`,
        });
      }
      const found = new Set(
        operationalMemory.getRecent(50).map((e) => e.severity),
      );
      for (const severity of severities) {
        expect(found.has(severity)).toBe(true);
      }
    });

    it('getUnread() возвращает только непрочитанные, markRead/markAllRead помечают', () => {
      operationalMemory.add({ eventType: 'SYSTEM_EVENT', summary: 'a' });
      operationalMemory.add({ eventType: 'SYSTEM_EVENT', summary: 'b' });
      operationalMemory.add({ eventType: 'SYSTEM_EVENT', summary: 'c' });

      expect(operationalMemory.getUnread(50)).toHaveLength(3);

      const firstId = operationalMemory.getRecent(50)[0]!.id!;
      operationalMemory.markRead(firstId);
      expect(operationalMemory.getUnread(50)).toHaveLength(2);

      operationalMemory.markAllRead();
      expect(operationalMemory.getUnread(50)).toHaveLength(0);
    });

    it('markRead() на несуществующем id не бросает ошибку', () => {
      expect(() => operationalMemory.markRead(999_999)).not.toThrow();
    });

    it('getSummarySince() считает свежие записи и группирует по типу и серьёзности', () => {
      operationalMemory.add({
        eventType: 'RISK_ALERT',
        severity: 'CRITICAL',
        summary: 'risk-1',
      });
      operationalMemory.add({
        eventType: 'AI_RECOMMENDATION',
        severity: 'HIGH',
        summary: 'rec-1',
      });
      // Устаревшая запись выпадает из окна сводки
      insertOperationalRaw('2000-01-01T00:00:00.000Z', 'ancient');

      const summary = operationalMemory.getSummarySince(7);
      expect(summary.totalEntries).toBe(2);
      expect(summary.byType).toEqual({
        RISK_ALERT: 1,
        AI_RECOMMENDATION: 1,
      });
      expect(summary.bySeverity).toEqual({ CRITICAL: 1, HIGH: 1 });
      expect(summary.lastEvent).toBeTruthy();
    });

    it('getSummarySince() на пустой памяти возвращает нули и null', () => {
      const summary = operationalMemory.getSummarySince(7);
      expect(summary.totalEntries).toBe(0);
      expect(summary.byType).toEqual({});
      expect(summary.bySeverity).toEqual({});
      expect(summary.lastEvent).toBeNull();
    });

    it('TTL: триггер clean_old_operational вычищает записи старше 14 дней', () => {
      // «Свежая» запись со временем устаревает (эмуляция: смещаем timestamp)
      operationalMemory.add({ eventType: 'SYSTEM_EVENT', summary: 'stale' });
      db.prepare(
        'UPDATE operational_memory SET timestamp = ? WHERE summary = ?',
      ).run('2000-01-01T00:00:00.000Z', 'stale');
      expect(operationalMemory.getRecent(50)).toHaveLength(1);

      // AFTER INSERT-триггер удаляет просроченные записи
      operationalMemory.add({ eventType: 'SYSTEM_EVENT', summary: 'fresh' });

      const rows = operationalMemory.getRecent(50);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.summary).toBe('fresh');
      expect(rows[0]!.timestamp).not.toBe('2000-01-01T00:00:00.000Z');
    });
  });

  describe('Стратегическая память', () => {
    it('aggregatePeriod() считает KPI из сделок, позиций и оперативной памяти', () => {
      const today = new Date().toISOString().split('T')[0]!;

      db.prepare(
        `INSERT INTO trades (date, ticker, type, quantity, price, total_amount, commission, account_id)
         VALUES (?, 'SBER', 'BUY', 10, 100, 1000, 10, 'BROKER'),
                (?, 'SBER', 'SELL', 5, 120, 600, 5, 'BROKER')`,
      ).run(today, today);

      db.prepare(
        `INSERT INTO positions (ticker, name, asset_type, status, quantity, avg_price, total_cost, current_price, current_market_value)
         VALUES ('SBER', 'Сбер', 'STOCK', 'ACTIVE', 10, 100, 1000, 150, 1500),
                ('GAZP', 'Газпром', 'STOCK', 'CLOSED', 5, 140, 700, 100, 500)`,
      ).run();

      operationalMemory.add({
        eventType: 'USER_DECISION',
        ticker: 'SBER',
        summary: 'Решение: купить SBER',
      });
      operationalMemory.add({
        eventType: 'RISK_ALERT',
        ticker: 'SBER',
        severity: 'CRITICAL',
        summary: 'Риск: просадка',
      });
      operationalMemory.add({
        eventType: 'AI_RECOMMENDATION',
        ticker: 'SBER',
        severity: 'HIGH',
        summary: 'Рекомендация: нарастить',
      });

      const entry = strategicMemory.aggregatePeriod('WEEKLY');

      expect(entry.periodType).toBe('WEEKLY');
      expect(entry.periodStart).toBeTruthy();
      expect(entry.periodEnd).toBe(today);
      // totalReturnRub = суммарный P&L позиций = 300, база 10000 → 3%
      expect(entry.totalReturnRub).toBe(300);
      expect(entry.totalReturn).toBe(3);
      expect(entry.totalDividends).toBe(600);
      expect(entry.totalCommissions).toBe(15);
      expect(entry.activePositions).toBe(1);
      expect(entry.closedPositions).toBe(1);
      expect(entry.totalTrades).toBe(2);
      expect(entry.buyTrades).toBe(1);
      expect(entry.sellTrades).toBe(1);
      expect(entry.avgWinRate).toBe(50);
      expect(entry.maxDrawdown).toBe(200);
      expect(entry.riskEvents).toBe(1);
      expect(entry.aiRecommendations).toBe(1);
      // AI_RECOMMENDATION и USER_DECISION попадают в keyDecisions
      const decisions = JSON.parse(entry.keyDecisions) as string[];
      expect(decisions).toHaveLength(2);
      expect(decisions).toContain('Решение: купить SBER');
      expect(decisions).toContain('Рекомендация: нарастить');
    });

    it('aggregatePeriod() с пустыми таблицами не падает и даёт нулевые метрики', () => {
      const entry = strategicMemory.aggregatePeriod('MONTHLY');

      expect(entry.periodType).toBe('MONTHLY');
      expect(entry.totalTrades).toBe(0);
      expect(entry.avgWinRate).toBe(0);
      expect(entry.totalReturnRub).toBe(0);
      expect(entry.totalReturn).toBe(0);
      expect(entry.totalDividends).toBe(0);
      expect(entry.maxDrawdown).toBe(0);
      expect(entry.activePositions).toBe(0);
      expect(entry.closedPositions).toBe(0);
      expect(entry.keyDecisions).toBe('[]');
    });

    it('getAll()/getLatest()/getReturnTrend() читают сохранённые периоды', () => {
      strategicMemory.aggregatePeriod('WEEKLY');
      strategicMemory.aggregatePeriod('MONTHLY');

      const all = strategicMemory.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((e) => e.periodType).sort()).toEqual([
        'MONTHLY',
        'WEEKLY',
      ]);

      const latest = strategicMemory.getLatest();
      expect(latest?.periodType).toBeDefined();

      const trend = strategicMemory.getReturnTrend(2);
      expect(trend).toHaveLength(2);
      expect(typeof trend[0]!.return).toBe('number');
      expect(trend[0]!.period).toBeTruthy();
    });
  });

  describe('Сессии', () => {
    it('getOrCreate() создаёт сессию и не дублирует её при повторном вызове', () => {
      const session = sessionManager.getOrCreate(42, 'sess-1');
      expect(session.sessionId).toBe('sess-1');
      expect(session.userId).toBe(42);
      expect(session.lastActivity).toBeTruthy();

      // Повторный вызов с другим userId не перезаписывает владельца сессии
      const again = sessionManager.getOrCreate(99, 'sess-1');
      expect(again.sessionId).toBe('sess-1');
      expect(again.userId).toBe(42);

      expect(sessionManager.getById('sess-1')).toBeDefined();
      expect(sessionManager.getById('missing-session')).toBeUndefined();
    });

    it('addMessage()/getHistory() сохраняют историю сообщений', () => {
      sessionManager.getOrCreate(42, 'sess-chat');

      sessionManager.addMessage('sess-chat', 'user', 'привет');
      sessionManager.addMessage('sess-chat', 'assistant', 'здравствуйте');

      const history = sessionManager.getHistory('sess-chat');
      expect(history).toHaveLength(2);
      expect(history[0]!.role).toBe('user');
      expect(history[0]!.content).toBe('привет');
      expect(history[1]!.role).toBe('assistant');
      expect(history[1]!.content).toBe('здравствуйте');
    });

    it('addMessage() обрезает историю до лимита maxSessionHistory (50)', () => {
      sessionManager.getOrCreate(42, 'sess-lim');

      for (let i = 0; i < 55; i++) {
        sessionManager.addMessage('sess-lim', 'user', `msg-${i}`);
      }

      const history = sessionManager.getHistory('sess-lim');
      expect(history).toHaveLength(50);
      expect(history[0]!.content).toBe('msg-5');
      expect(history[49]!.content).toBe('msg-54');
    });

    it('getHistory() для новой сессии возвращает []', () => {
      sessionManager.getOrCreate(42, 'sess-empty');
      expect(sessionManager.getHistory('sess-empty')).toHaveLength(0);
      expect(sessionManager.getHistory('unknown')).toHaveLength(0);
    });

    it('setContext()/getContext() сохраняют и возвращают контекст', () => {
      sessionManager.getOrCreate(42, 'sess-ctx');

      sessionManager.setContext('sess-ctx', {
        ticker: 'SBER',
        mode: 'watch',
      });

      const context = sessionManager.getContext('sess-ctx');
      expect(context).toEqual({ ticker: 'SBER', mode: 'watch' });

      expect(sessionManager.getContext('unknown-session')).toEqual({});
    });

    it('cleanupOld() удаляет только сессии, неактивные дольше 30 дней', () => {
      sessionManager.getOrCreate(42, 'sess-active');
      sessionManager.getOrCreate(42, 'sess-stale');

      db.prepare(
        'UPDATE sessions SET last_activity = ? WHERE session_id = ?',
      ).run('2000-01-01T00:00:00.000Z', 'sess-stale');

      const deleted = sessionManager.cleanupOld();
      expect(deleted).toBe(1);
      expect(sessionManager.getById('sess-stale')).toBeUndefined();
      expect(sessionManager.getById('sess-active')).toBeDefined();
    });
  });

  describe('Интеграционные record-функции', () => {
    it('записывают события с корректными типами, серьёзностью и summary', () => {
      recordTrade('SBER', 'BUY', 10, 100);
      recordAiAnalysis('SBER', 'Покупать');
      recordRiskAlert('SBER', 'просадка > 10%');
      recordUserDecision('SBER', 'Держать');
      recordAiRecommendation('SBER', 'Нарастить');

      const bySummary = (summary: string): OperationalMemoryEntry | undefined =>
        operationalMemory.getRecent(50).find((e) => e.summary === summary);

      const trade = bySummary('BUY 10x SBER @ 100')!;
      expect(trade.eventType).toBe('TRADE_EXECUTED');
      expect(trade.severity).toBe('HIGH');
      const tradeDetails = JSON.parse(trade.details) as {
        quantity: number;
        price: number;
      };
      expect(tradeDetails.quantity).toBe(10);
      expect(tradeDetails.price).toBe(100);

      const aiAnalysis = bySummary('AI-анализ: Покупать')!;
      expect(aiAnalysis.eventType).toBe('AI_ANALYSIS');
      expect(aiAnalysis.severity).toBe('HIGH');

      const risk = bySummary('Риск: просадка > 10%')!;
      expect(risk.eventType).toBe('RISK_ALERT');
      expect(risk.severity).toBe('CRITICAL');

      const decision = bySummary('Решение: Держать')!;
      expect(decision.eventType).toBe('USER_DECISION');
      expect(decision.severity).toBe('MEDIUM');

      const recommendation = bySummary('Рекомендация: Нарастить')!;
      expect(recommendation.eventType).toBe('AI_RECOMMENDATION');
      expect(recommendation.severity).toBe('HIGH');
    });
  });
});
