import { db } from '../db-manager/db-manager';
import type {
  OperationalMemoryEntry,
  StrategicMemoryEntry,
  SessionState,
  MemoryConfig,
  MemoryEventType,
  MemorySeverity,
} from './types';

// ──────────────────────────────────────────────
// 1. Конфигурация по умолчанию
// ──────────────────────────────────────────────

const DEFAULT_CONFIG: MemoryConfig = {
  operationalRetentionDays: 14,
  strategicAggregationInterval: 'MONTHLY',
  maxOperationalEntries: 5000,
  maxSessionHistory: 50,
};

// ──────────────────────────────────────────────
// 2. Таблицы памяти (создаются при инициализации)
// ──────────────────────────────────────────────

function initializeMemoryTables(): void {
  const now = new Date().toISOString();

  // Оперативная память
  db.exec(`
    CREATE TABLE IF NOT EXISTS operational_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ticker TEXT,
      severity TEXT NOT NULL DEFAULT 'MEDIUM' CHECK(severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      summary TEXT NOT NULL,
      details TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '${now}'
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_operational_timestamp ON operational_memory(timestamp);
    CREATE INDEX IF NOT EXISTS idx_operational_event ON operational_memory(event_type);
    CREATE INDEX IF NOT EXISTS idx_operational_ticker ON operational_memory(ticker);
    CREATE INDEX IF NOT EXISTS idx_operational_read ON operational_memory(is_read);
  `);

  // Стратегическая память
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategic_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      period_type TEXT NOT NULL CHECK(period_type IN ('WEEKLY', 'MONTHLY', 'QUARTERLY')),
      total_return REAL NOT NULL DEFAULT 0,
      total_return_rub REAL NOT NULL DEFAULT 0,
      total_dividends REAL NOT NULL DEFAULT 0,
      total_coupons REAL NOT NULL DEFAULT 0,
      total_commissions REAL NOT NULL DEFAULT 0,
      active_positions INTEGER NOT NULL DEFAULT 0,
      closed_positions INTEGER NOT NULL DEFAULT 0,
      total_trades INTEGER NOT NULL DEFAULT 0,
      buy_trades INTEGER NOT NULL DEFAULT 0,
      sell_trades INTEGER NOT NULL DEFAULT 0,
      avg_win_rate REAL NOT NULL DEFAULT 0,
      avg_holding_period REAL NOT NULL DEFAULT 0,
      max_drawdown REAL NOT NULL DEFAULT 0,
      sharpe_ratio REAL,
      key_decisions TEXT,
      risk_events INTEGER NOT NULL DEFAULT 0,
      ai_recommendations INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '${now}'
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_strategic_period ON strategic_memory(period_start, period_type);
  `);

  // Сессии
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      last_activity TEXT NOT NULL,
      context TEXT,
      conversation_history TEXT,
      created_at TEXT NOT NULL DEFAULT '${now}',
      updated_at TEXT NOT NULL DEFAULT '${now}'
    );
  `);

  // Очистка оперативной памяти старше N дней — триггер
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS clean_old_operational
    AFTER INSERT ON operational_memory
    BEGIN
      DELETE FROM operational_memory
      WHERE timestamp < datetime('now', '-14 days');
    END;
  `);

  console.log('[Memory-Layer] Таблицы инициализированы');
}

// ──────────────────────────────────────────────
// 3. Оперативная память — запись и чтение
// ──────────────────────────────────────────────

/** Сырая строка таблицы operational_memory (snake_case колонки БД) */
interface OperationalMemoryRow {
  id: number;
  timestamp: string;
  event_type: MemoryEventType;
  ticker: string | null;
  severity: MemorySeverity;
  summary: string;
  details: string | null;
  is_read: number;
  created_at: string;
}

/**
 * Привести строку БД к публичному API (camelCase).
 * Без маппинга потребители получали сырые snake_case-колонки,
 * и поля eventType/isRead/createdAt были undefined.
 */
function mapOperationalRow(raw: OperationalMemoryRow): OperationalMemoryEntry {
  return {
    id: raw.id,
    timestamp: raw.timestamp,
    eventType: raw.event_type,
    ticker: raw.ticker ?? undefined,
    severity: raw.severity,
    summary: raw.summary,
    details: raw.details ?? '',
    isRead: raw.is_read === 1,
    createdAt: raw.created_at,
  };
}

const operationalMemory = {
  /** Добавить запись в оперативную память */
  add(params: {
    eventType: MemoryEventType;
    summary: string;
    details?: string;
    ticker?: string;
    severity?: MemorySeverity;
  }): void {
    initializeMemoryTables();

    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO operational_memory (timestamp, event_type, ticker, severity, summary, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      now,
      params.eventType,
      params.ticker || null,
      params.severity || 'MEDIUM',
      params.summary,
      params.details || null,
      now,
    );
  },

  /** Получить последние N записей */
  getRecent(limit = 50): OperationalMemoryEntry[] {
    initializeMemoryTables();
    const stmt = db.prepare(`
      SELECT * FROM operational_memory
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return (stmt.all(limit) as OperationalMemoryRow[]).map(mapOperationalRow);
  },

  /** Получить записи по типу события */
  getByType(eventType: MemoryEventType, limit = 30): OperationalMemoryEntry[] {
    initializeMemoryTables();
    const stmt = db.prepare(`
      SELECT * FROM operational_memory
      WHERE event_type = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return (stmt.all(eventType, limit) as OperationalMemoryRow[]).map(
      mapOperationalRow,
    );
  },

  /** Получить записи по тикеру */
  getByTicker(ticker: string, limit = 50): OperationalMemoryEntry[] {
    initializeMemoryTables();
    const stmt = db.prepare(`
      SELECT * FROM operational_memory
      WHERE ticker = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return (stmt.all(ticker, limit) as OperationalMemoryRow[]).map(
      mapOperationalRow,
    );
  },

  /** Получить непрочитанные записи */
  getUnread(limit = 20): OperationalMemoryEntry[] {
    initializeMemoryTables();
    const stmt = db.prepare(`
      SELECT * FROM operational_memory
      WHERE is_read = 0
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return (stmt.all(limit) as OperationalMemoryRow[]).map(mapOperationalRow);
  },

  /** Отметить как прочитанную */
  markRead(id: number): void {
    initializeMemoryTables();
    const stmt = db.prepare(
      'UPDATE operational_memory SET is_read = 1 WHERE id = ?',
    );
    stmt.run(id);
  },

  /** Отметить все как прочитанные */
  markAllRead(): void {
    initializeMemoryTables();
    const stmt = db.prepare(
      'UPDATE operational_memory SET is_read = 1 WHERE is_read = 0',
    );
    stmt.run();
  },

  /** Получить сводку за период */
  getSummarySince(daysAgo = 7): {
    totalEntries: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    lastEvent: string | null;
  } {
    initializeMemoryTables();

    // SQLite-модификатор даты обязан быть строкой ('-7 days'); числовой
    // параметр даёт нераспознанный модификатор → NULL и пустой результат.
    const periodModifier = `-${daysAgo} days`;

    const totalStmt = db.prepare(`
      SELECT COUNT(*) as total FROM operational_memory
      WHERE timestamp >= datetime('now', ?)
    `);
    const total = totalStmt.get(periodModifier) as { total: number };

    const typeStmt = db.prepare(`
      SELECT event_type, COUNT(*) as count FROM operational_memory
      WHERE timestamp >= datetime('now', ?)
      GROUP BY event_type
    `);
    const types = typeStmt.all(periodModifier) as {
      event_type: string;
      count: number;
    }[];

    const severityStmt = db.prepare(`
      SELECT severity, COUNT(*) as count FROM operational_memory
      WHERE timestamp >= datetime('now', ?)
      GROUP BY severity
    `);
    const severities = severityStmt.all(periodModifier) as {
      severity: string;
      count: number;
    }[];

    const lastStmt = db.prepare(`
      SELECT timestamp FROM operational_memory
      WHERE timestamp >= datetime('now', ?)
      ORDER BY timestamp DESC LIMIT 1
    `);
    const last = lastStmt.get(periodModifier) as
      { timestamp: string } | undefined;

    return {
      totalEntries: total.total,
      byType: Object.fromEntries(types.map((t) => [t.event_type, t.count])),
      bySeverity: Object.fromEntries(
        severities.map((s) => [s.severity, s.count]),
      ),
      lastEvent: last?.timestamp || null,
    };
  },
};

// ──────────────────────────────────────────────
// 4. Стратегическая память — агрегация
// ──────────────────────────────────────────────

/** Сырая строка таблицы strategic_memory (snake_case колонки БД) */
interface StrategicMemoryRow {
  id: number;
  period_start: string;
  period_end: string;
  period_type: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
  total_return: number;
  total_return_rub: number;
  total_dividends: number;
  total_coupons: number;
  total_commissions: number;
  active_positions: number;
  closed_positions: number;
  total_trades: number;
  buy_trades: number;
  sell_trades: number;
  avg_win_rate: number;
  avg_holding_period: number;
  max_drawdown: number;
  sharpe_ratio: number | null;
  key_decisions: string;
  risk_events: number;
  ai_recommendations: number;
  created_at: string;
}

/** Привести строку БД к публичному API (camelCase) */
function mapStrategicRow(raw: StrategicMemoryRow): StrategicMemoryEntry {
  return {
    id: raw.id,
    periodStart: raw.period_start,
    periodEnd: raw.period_end,
    periodType: raw.period_type,
    totalReturn: raw.total_return,
    totalReturnRub: raw.total_return_rub,
    totalDividends: raw.total_dividends,
    totalCoupons: raw.total_coupons,
    totalCommissions: raw.total_commissions,
    activePositions: raw.active_positions,
    closedPositions: raw.closed_positions,
    totalTrades: raw.total_trades,
    buyTrades: raw.buy_trades,
    sellTrades: raw.sell_trades,
    avgWinRate: raw.avg_win_rate,
    avgHoldingPeriod: raw.avg_holding_period,
    maxDrawdown: raw.max_drawdown,
    sharpeRatio: raw.sharpe_ratio ?? undefined,
    keyDecisions: raw.key_decisions,
    riskEvents: raw.risk_events,
    aiRecommendations: raw.ai_recommendations,
    createdAt: raw.created_at,
  };
}

const strategicMemory = {
  /** Агрегировать данные за период и записать в БД */
  aggregatePeriod(
    periodType: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY',
  ): StrategicMemoryEntry {
    initializeMemoryTables();
    const now = new Date();
    let periodStart: string;
    const periodEnd = now.toISOString().split('T')[0] ?? '';

    if (periodType === 'WEEKLY') {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      periodStart = start.toISOString().split('T')[0] ?? '';
    } else if (periodType === 'MONTHLY') {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      periodStart = start.toISOString().split('T')[0] ?? '';
    } else {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 3);
      periodStart = start.toISOString().split('T')[0] ?? '';
    }

    // Сделки за период
    const tradesStmt = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN type = 'BUY' THEN 1 ELSE 0 END) as buys,
        SUM(CASE WHEN type = 'SELL' THEN 1 ELSE 0 END) as sells,
        SUM(commission) as total_commission
      FROM trades
      WHERE date >= ? AND date <= ?
    `);
    const tradesSummary = tradesStmt.get(periodStart, periodEnd) as {
      total: number;
      buys: number;
      sells: number;
      total_commission: number;
    };

    // Позиции
    const positionsStmt = db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'CLOSED' THEN 1 END) as closed,
        COALESCE(SUM(current_market_value - total_cost), 0) as total_pnl
      FROM positions
      WHERE status IN ('ACTIVE', 'CLOSED')
    `);
    const positionsSummary = positionsStmt.get() as {
      active: number;
      closed: number;
      total_pnl: number;
    };

    // Дивиденды и купоны (из истории сделок SELL и специальных записей)
    const dividendsStmt = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as total FROM trades
      WHERE type = 'SELL' AND date >= ? AND date <= ?
    `);
    const dividends = dividendsStmt.get(periodStart, periodEnd) as {
      total: number;
    };

    // Максимальная просадка (упрощённо — по P&L)
    const maxDrawdownStmt = db.prepare(`
      SELECT COALESCE(MIN(total_cost - current_market_value), 0) as max_dd FROM positions
      WHERE current_market_value < total_cost
    `);
    const maxDrawdown = maxDrawdownStmt.get() as { max_dd: number };

    // Ключевые решения (из оперативной памяти — HIGH/CRITICAL события)
    const decisionsStmt = db.prepare(`
      SELECT summary FROM operational_memory
      WHERE event_type IN ('TRADE_EXECUTED', 'USER_DECISION', 'AI_RECOMMENDATION')
      AND timestamp >= ?
      ORDER BY timestamp DESC
      LIMIT 10
    `);
    const decisions = decisionsStmt.all(periodStart) as { summary: string }[];

    // Риски
    const riskStmt = db.prepare(`
      SELECT COUNT(*) as count FROM operational_memory
      WHERE event_type = 'RISK_ALERT' AND timestamp >= ?
    `);
    const riskEvents = riskStmt.get(periodStart) as { count: number };

    // AI рекомендации
    const aiStmt = db.prepare(`
      SELECT COUNT(*) as count FROM operational_memory
      WHERE event_type = 'AI_RECOMMENDATION' AND timestamp >= ?
    `);
    const aiRecommendations = aiStmt.get(periodStart) as { count: number };

    // Рассчёт доходности
    const totalReturnRub = positionsSummary.total_pnl;
    const totalCost =
      positionsSummary.active > 0
        ? positionsSummary.active * 10000 // упрощённо
        : 1;
    const totalReturn = (totalReturnRub / totalCost) * 100;

    // Win rate
    const totalTrades = tradesSummary.total;
    const winRate =
      totalTrades > 0 ? (tradesSummary.sells / totalTrades) * 100 : 0;

    const entry: StrategicMemoryEntry = {
      periodStart,
      periodEnd,
      periodType,
      totalReturn,
      totalReturnRub,
      totalDividends: dividends.total,
      totalCoupons: 0,
      totalCommissions: tradesSummary.total_commission || 0,
      activePositions: positionsSummary.active,
      closedPositions: positionsSummary.closed,
      totalTrades,
      // SUM() по пустой таблице возвращает NULL — приводим к 0,
      // иначе INSERT в NOT NULL-колонки buy_trades/sell_trades падает.
      buyTrades: tradesSummary.buys || 0,
      sellTrades: tradesSummary.sells || 0,
      avgWinRate: winRate,
      avgHoldingPeriod: 0,
      maxDrawdown: maxDrawdown.max_dd,
      sharpeRatio: undefined,
      keyDecisions: JSON.stringify(decisions.map((d) => d.summary)),
      riskEvents: riskEvents.count,
      aiRecommendations: aiRecommendations.count,
      createdAt: new Date().toISOString(),
    };

    // Сохраняем в БД
    const insertStmt = db.prepare(`
      INSERT INTO strategic_memory (
        period_start, period_end, period_type, total_return, total_return_rub,
        total_dividends, total_coupons, total_commissions,
        active_positions, closed_positions, total_trades, buy_trades, sell_trades,
        avg_win_rate, avg_holding_period, max_drawdown,
        key_decisions, risk_events, ai_recommendations, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      entry.periodStart,
      entry.periodEnd,
      entry.periodType,
      entry.totalReturn,
      entry.totalReturnRub,
      entry.totalDividends,
      entry.totalCoupons,
      entry.totalCommissions,
      entry.activePositions,
      entry.closedPositions,
      entry.totalTrades,
      entry.buyTrades,
      entry.sellTrades,
      entry.avgWinRate,
      entry.avgHoldingPeriod,
      entry.maxDrawdown,
      entry.keyDecisions,
      entry.riskEvents,
      entry.aiRecommendations,
      entry.createdAt,
    );

    console.log(
      `[Memory-Layer] Стратегическая память: ${periodType} агрегирована`,
    );
    return entry;
  },

  /** Получить все записи стратегической памяти */
  getAll(): StrategicMemoryEntry[] {
    initializeMemoryTables();
    const stmt = db.prepare(`
      SELECT * FROM strategic_memory
      ORDER BY period_start DESC
    `);
    return (stmt.all() as StrategicMemoryRow[]).map(mapStrategicRow);
  },

  /** Получить последнюю запись */
  getLatest(): StrategicMemoryEntry | undefined {
    initializeMemoryTables();
    const stmt = db.prepare(`
      SELECT * FROM strategic_memory
      ORDER BY period_start DESC
      LIMIT 1
    `);
    const raw = stmt.get() as StrategicMemoryRow | undefined;
    return raw ? mapStrategicRow(raw) : undefined;
  },

  /** Получить тренд доходности за N периодов */
  getReturnTrend(count = 12): Array<{ period: string; return: number }> {
    initializeMemoryTables();
    const stmt = db.prepare(`
      SELECT period_start as period, total_return as return
      FROM strategic_memory
      ORDER BY period_start DESC
      LIMIT ?
    `);
    return stmt.all(count) as Array<{ period: string; return: number }>;
  },
};

// ──────────────────────────────────────────────
// 5. Управление сессиями
// ──────────────────────────────────────────────

const sessionManager = {
  /** Получить или создать сессию */
  getOrCreate(userId: number, sessionId: string): SessionState {
    initializeMemoryTables();

    const stmt = db.prepare('SELECT * FROM sessions WHERE session_id = ?');
    const raw = stmt.get(sessionId) as
      | {
          session_id: string;
          user_id: number;
          last_activity: string;
          context: string | null;
          conversation_history: string | null;
        }
      | undefined;

    if (raw) {
      const updateStmt = db.prepare(`
        UPDATE sessions SET last_activity = ?, updated_at = ?
        WHERE session_id = ?
      `);
      updateStmt.run(
        new Date().toISOString(),
        new Date().toISOString(),
        sessionId,
      );
      return sessionManager.getById(sessionId)!;
    }

    const insertStmt = db.prepare(`
      INSERT INTO sessions (session_id, user_id, last_activity, context, conversation_history, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(
      sessionId,
      userId,
      new Date().toISOString(),
      null,
      null,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    return sessionManager.getById(sessionId)!;
  },

  /** Получить сессию по ID */
  getById(sessionId: string): SessionState | undefined {
    initializeMemoryTables();
    const stmt = db.prepare('SELECT * FROM sessions WHERE session_id = ?');
    const raw = stmt.get(sessionId) as
      | {
          id?: number;
          session_id: string;
          user_id: number;
          last_activity: string;
          context: string | null;
          conversation_history: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!raw) return undefined;

    return {
      id: raw.id,
      sessionId: raw.session_id,
      userId: raw.user_id,
      lastActivity: raw.last_activity,
      context: raw.context ? JSON.parse(raw.context) : undefined,
      conversationHistory: raw.conversation_history
        ? JSON.parse(raw.conversation_history)
        : undefined,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  },

  /** Добавить сообщение в историю сессии */
  addMessage(sessionId: string, role: string, content: string): void {
    initializeMemoryTables();
    const session = sessionManager.getById(sessionId);
    if (!session) return;

    const history = sessionManager.getHistory(sessionId);
    history.push({ role, content, timestamp: new Date().toISOString() });

    // Ограничиваем историю
    const maxHistory = DEFAULT_CONFIG.maxSessionHistory;
    const trimmed = history.slice(-maxHistory);

    const updateStmt = db.prepare(`
      UPDATE sessions
      SET conversation_history = ?, last_activity = ?, updated_at = ?
      WHERE session_id = ?
    `);
    updateStmt.run(
      JSON.stringify(trimmed),
      new Date().toISOString(),
      new Date().toISOString(),
      sessionId,
    );
  },

  /** Получить историю сообщений */
  getHistory(
    sessionId: string,
  ): Array<{ role: string; content: string; timestamp: string }> {
    initializeMemoryTables();
    const session = sessionManager.getById(sessionId);
    if (!session?.conversationHistory) return [];

    // getById() уже парсит conversation_history в объект — двойной
    // JSON.parse() бросал SyntaxError, и история терялась при чтении.
    if (Array.isArray(session.conversationHistory)) {
      return session.conversationHistory as Array<{
        role: string;
        content: string;
        timestamp: string;
      }>;
    }

    try {
      return JSON.parse(session.conversationHistory);
    } catch {
      return [];
    }
  },

  /** Обновить контекст сессии */
  setContext(sessionId: string, context: Record<string, unknown>): void {
    initializeMemoryTables();
    const updateStmt = db.prepare(`
      UPDATE sessions SET context = ?, last_activity = ?, updated_at = ?
      WHERE session_id = ?
    `);
    updateStmt.run(
      JSON.stringify(context),
      new Date().toISOString(),
      new Date().toISOString(),
      sessionId,
    );
  },

  /** Получить контекст сессии */
  getContext(sessionId: string): Record<string, unknown> {
    initializeMemoryTables();
    const session = this.getById(sessionId);
    if (!session?.context) return {};

    // getById() уже парсит context в объект — повторный JSON.parse()
    // бросал SyntaxError, и контекст терялся при чтении.
    if (typeof session.context === 'object') {
      return session.context as Record<string, unknown>;
    }

    try {
      return JSON.parse(session.context);
    } catch {
      return {};
    }
  },

  /** Удалить старую сессию (неактивную > 30 дней) */
  cleanupOld(): number {
    initializeMemoryTables();
    const stmt = db.prepare(`
      DELETE FROM sessions
      WHERE last_activity < datetime('now', '-30 days')
    `);
    const info = stmt.run();
    return info.changes;
  },
};

// ──────────────────────────────────────────────
// 6. Интеграция: автоматическая запись событий
// ──────────────────────────────────────────────

/** Записать событие анализа AI */
function recordAiAnalysis(ticker: string, recommendation: string): void {
  operationalMemory.add({
    eventType: 'AI_ANALYSIS',
    ticker,
    severity: 'HIGH',
    summary: `AI-анализ: ${recommendation}`,
    details: JSON.stringify({
      ticker,
      recommendation,
      timestamp: new Date().toISOString(),
    }),
  });
}

/** Записать событие сделки */
function recordTrade(
  ticker: string,
  type: string,
  quantity: number,
  price: number,
): void {
  operationalMemory.add({
    eventType: 'TRADE_EXECUTED',
    ticker,
    severity: 'HIGH',
    summary: `${type} ${quantity}x ${ticker} @ ${price}`,
    details: JSON.stringify({
      ticker,
      type,
      quantity,
      price,
      timestamp: new Date().toISOString(),
    }),
  });
}

/** Записать событие риска */
function recordRiskAlert(ticker: string, message: string): void {
  operationalMemory.add({
    eventType: 'RISK_ALERT',
    ticker,
    severity: 'CRITICAL',
    summary: `Риск: ${message}`,
    details: JSON.stringify({
      ticker,
      message,
      timestamp: new Date().toISOString(),
    }),
  });
}

/** Записать событие решения пользователя */
function recordUserDecision(ticker: string, decision: string): void {
  operationalMemory.add({
    eventType: 'USER_DECISION',
    ticker,
    severity: 'MEDIUM',
    summary: `Решение: ${decision}`,
    details: JSON.stringify({
      ticker,
      decision,
      timestamp: new Date().toISOString(),
    }),
  });
}

/** Записать событие рекомендации AI */
function recordAiRecommendation(ticker: string, action: string): void {
  operationalMemory.add({
    eventType: 'AI_RECOMMENDATION',
    ticker,
    severity: 'HIGH',
    summary: `Рекомендация: ${action}`,
    details: JSON.stringify({
      ticker,
      action,
      timestamp: new Date().toISOString(),
    }),
  });
}

// ──────────────────────────────────────────────
// 7. Экспорт: главный конвейер
// ──────────────────────────────────────────────

export const memoryLayer = (): void => {
  initializeMemoryTables();
  console.log('🧠 Memory-Layer: двухслойная память инициализирована');
  console.log('   Оперативная: 14 дней, до 5000 записей');
  console.log('   Стратегическая: еженедельная агрегация');
};

// Экспорт для использования в других модулях
export {
  operationalMemory,
  strategicMemory,
  sessionManager,
  recordAiAnalysis,
  recordTrade,
  recordRiskAlert,
  recordUserDecision,
  recordAiRecommendation,
};
