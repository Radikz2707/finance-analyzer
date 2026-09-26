import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {
  PortfolioPosition,
  Trade,
  QuikOrder,
  InvestorGoal,
  AccountSetting,
  PriceSnapshot,
  NewsRecord,
  MacroRecord,
  LogLevel,
  OrderStatus,
} from './types';

// ──────────────────────────────────────────────
// 1. Singleton-инстанс БД
// ──────────────────────────────────────────────

const dbPath = path.join(process.cwd(), 'data', 'finance.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Оптимизация для скорости записи
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -64000'); // 64 МБ кэш
db.pragma('temp_store = MEMORY');

let initialized = false;

// ──────────────────────────────────────────────
// 2. Миграции — создание всех таблиц
// ──────────────────────────────────────────────

function initializeDatabase(): void {
  if (initialized) return;

  const now = new Date().toISOString();

  // Аккаунты
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('BROKER', 'IIS')),
      account_number TEXT NOT NULL UNIQUE,
      quik_path TEXT,
      excel_file_path TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT '${now}'
    );
  `);

  // Активы и позиции портфеля
  db.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      name TEXT NOT NULL,
      asset_type TEXT NOT NULL CHECK(asset_type IN ('STOCK', 'BOND', 'ETF', 'CASH', 'OTHER')),
      issuer TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'RUB',
      market TEXT NOT NULL DEFAULT 'MOEX',
      quantity REAL NOT NULL DEFAULT 0,
      avg_price REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      current_price REAL,
      current_market_value REAL,
      target_percent REAL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'RECOVERY_ONLY', 'CLOSED')),
      account_id INTEGER,
      created_at TEXT NOT NULL DEFAULT '${now}',
      updated_at TEXT NOT NULL DEFAULT '${now}',
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );
  `);

  // Индекс для быстрого поиска по тикеру
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_positions_ticker ON positions(ticker);
    CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
    CREATE INDEX IF NOT EXISTS idx_positions_account ON positions(account_id);
  `);

  // Сделки
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      ticker TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('BUY', 'SELL')),
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      total_amount REAL NOT NULL,
      commission REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'EXECUTED' CHECK(status IN ('EXECUTED', 'PENDING', 'CANCELLED')),
      account_id TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT '${now}'
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trades_ticker ON trades(ticker);
    CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(date);
    CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id);
  `);

  // Заявки QUIK
  db.exec(`
    CREATE TABLE IF NOT EXISTS quik_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      ticker TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
      type TEXT NOT NULL CHECK(type IN ('MARKET', 'LIMIT')),
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      filled_quantity REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW', 'PARTIAL', 'FILLED', 'CANCELLED', 'REJECTED')),
      account_id TEXT NOT NULL,
      quik_order_num INTEGER,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT '${now}'
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_quik_orders_ticker ON quik_orders(ticker);
    CREATE INDEX IF NOT EXISTS idx_quik_orders_status ON quik_orders(status);
  `);

  // Цели инвестора
  db.exec(`
    CREATE TABLE IF NOT EXISTS investor_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      target_amount REAL NOT NULL,
      current_amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'RUB',
      deadline TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 1 AND 10),
      created_at TEXT NOT NULL DEFAULT '${now}'
    );
  `);

  // Котировки — история цен
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      date TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'QUIK',
      created_at TEXT NOT NULL DEFAULT '${now}',
      UNIQUE(ticker, date, source)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_price_snapshots_ticker ON price_snapshots(ticker);
    CREATE INDEX IF NOT EXISTS idx_price_snapshots_date ON price_snapshots(date);
  `);

  // Новости
  db.exec(`
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      source TEXT NOT NULL,
      url TEXT,
      importance TEXT NOT NULL DEFAULT 'MEDIUM' CHECK(importance IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      sentiment TEXT NOT NULL DEFAULT 'NEUTRAL' CHECK(sentiment IN ('NEGATIVE', 'NEUTRAL', 'POSITIVE', 'UNKNOWN')),
      summary TEXT,
      relevance_to_ticker TEXT,
      is_processed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '${now}'
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_news_ticker ON news(relevance_to_ticker);
    CREATE INDEX IF NOT EXISTS idx_news_processed ON news(is_processed);
    CREATE INDEX IF NOT EXISTS idx_news_date ON news(date);
  `);

  // Макроэкономика
  db.exec(`
    CREATE TABLE IF NOT EXISTS macro (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      key_rate REAL,
      inflation REAL,
      fx_rate REAL,
      oil_price REAL,
      source TEXT NOT NULL DEFAULT 'CBR',
      created_at TEXT NOT NULL DEFAULT '${now}',
      UNIQUE(date, source)
    );
  `);

  // Кэш research-снимков
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      snapshot_data TEXT NOT NULL,
      research_timestamp TEXT NOT NULL,
      ttl_seconds INTEGER NOT NULL DEFAULT 300,
      created_at TEXT NOT NULL DEFAULT '${now}',
      expires_at TEXT NOT NULL,
      UNIQUE(ticker, research_timestamp)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_research_snapshots_ticker ON research_snapshots(ticker);
    CREATE INDEX IF NOT EXISTS idx_research_snapshots_timestamp ON research_snapshots(research_timestamp);
    CREATE INDEX IF NOT EXISTS idx_research_snapshots_expires ON research_snapshots(expires_at);
  `);

  // Очистка старых research-снимков (старше TTL) — авто-триггер
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS clean_expired_research AFTER INSERT ON research_snapshots
    BEGIN
      DELETE FROM research_snapshots
      WHERE expires_at < datetime('now');
    END;
  `);

  // Системные логи
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL CHECK(level IN ('INFO', 'WARN', 'ERROR', 'DEBUG')),
      module TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT '${now}'
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_logs_level ON system_logs(level);
    CREATE INDEX IF NOT EXISTS idx_logs_module ON system_logs(module);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON system_logs(timestamp);
  `);

  // Очистка старых логов (старше 30 дней) — авто-триггер
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS clean_old_logs AFTER INSERT ON system_logs
    BEGIN
      DELETE FROM system_logs
      WHERE timestamp < datetime('now', '-30 days');
    END;
  `);

  initialized = true;
  log('INFO', 'db-manager', 'База данных инициализирована', JSON.stringify({ path: dbPath, tables: 9 }));
}

// ──────────────────────────────────────────────
// 3. Утилиты логирования в БД
// ──────────────────────────────────────────────

function log(level: LogLevel, module: string, message: string, metadata?: string): void {
  try {
    const stmt = db.prepare(
      'INSERT INTO system_logs (timestamp, level, module, message, metadata) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(new Date().toISOString(), level, module, message, metadata || null);
  } catch (err) {
    console.error('[db-manager] Ошибка записи лога:', err);
  }
}

// ──────────────────────────────────────────────
// 4. Репозиторий: Позиции портфеля
// ──────────────────────────────────────────────

const positionsRepo = {
  /** Получить все активные позиции */
  getAllActive(): PortfolioPosition[] {
    initializeDatabase();
    const stmt = db.prepare(
      'SELECT * FROM positions WHERE status = ? ORDER BY ticker'
    );
    return stmt.all('ACTIVE') as PortfolioPosition[];
  },

  /** Получить позицию по тикеру */
  getByTicker(ticker: string): PortfolioPosition | undefined {
    initializeDatabase();
    const stmt = db.prepare('SELECT * FROM positions WHERE ticker = ?');
    return stmt.get(ticker) as PortfolioPosition | undefined;
  },

  /** Получить все позиции (включая закрытые) */
  getAll(): PortfolioPosition[] {
    initializeDatabase();
    const stmt = db.prepare('SELECT * FROM positions ORDER BY ticker');
    return stmt.all() as PortfolioPosition[];
  },

  /** Получить все позиции в режиме RECOVERY_ONLY */
  getRecoveryOnly(): PortfolioPosition[] {
    initializeDatabase();
    const stmt = db.prepare(
      'SELECT * FROM positions WHERE status = ? ORDER BY ticker'
    );
    return stmt.all('RECOVERY_ONLY') as PortfolioPosition[];
  },

  /** Создать или обновить позицию (upsert) */
  upsert(position: Omit<PortfolioPosition, 'id' | 'createdAt' | 'updatedAt'>): PortfolioPosition {
    initializeDatabase();
    const now = new Date().toISOString();

    const existing = this.getByTicker(position.ticker);

    if (existing) {
      const stmt = db.prepare(`
        UPDATE positions SET
          name = ?,
          asset_type = ?,
          issuer = ?,
          currency = ?,
          market = ?,
          quantity = ?,
          avg_price = ?,
          total_cost = ?,
          current_price = ?,
          current_market_value = ?,
          target_percent = ?,
          status = ?,
          updated_at = ?
        WHERE ticker = ?
      `);
      stmt.run(
        position.name, position.assetType, position.issuer, position.currency,
        position.market, position.quantity, position.avgPrice, position.totalCost,
        position.currentPrice, position.currentMarketValue, position.targetPercent,
        position.status, now, position.ticker
      );
      log('INFO', 'db-manager', `Позиция обновлена: ${position.ticker}`);
    } else {
      const stmt = db.prepare(`
        INSERT INTO positions (
          ticker, name, asset_type, issuer, currency, market,
          quantity, avg_price, total_cost, current_price, current_market_value,
          target_percent, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        position.ticker, position.name, position.assetType, position.issuer,
        position.currency, position.market, position.quantity, position.avgPrice,
        position.totalCost, position.currentPrice, position.currentMarketValue,
        position.targetPercent, position.status, now, now
      );
      log('INFO', 'db-manager', `Позиция создана: ${position.ticker}`);
    }

    return this.getByTicker(position.ticker)!;
  },

  /** Обновить текущую цену */
  updatePrice(ticker: string, price: number, marketValue?: number): void {
    initializeDatabase();
    const stmt = db.prepare(`
      UPDATE positions SET current_price = ?, current_market_value = ?, updated_at = ?
      WHERE ticker = ?
    `);
    const now = new Date().toISOString();
    stmt.run(price, marketValue || null, now, ticker);
  },

  /** Установить статус RECOVERY_ONLY */
  setRecoveryOnly(ticker: string): void {
    initializeDatabase();
    const stmt = db.prepare(`
      UPDATE positions SET status = ?, updated_at = ? WHERE ticker = ?
    `);
    const now = new Date().toISOString();
    stmt.run('RECOVERY_ONLY', now, ticker);
    log('WARN', 'db-manager', `Статус RECOVERY_ONLY: ${ticker}`);
  },

  /** Закрыть позицию */
  closePosition(ticker: string): void {
    initializeDatabase();
    const stmt = db.prepare(`
      UPDATE positions SET status = ?, updated_at = ? WHERE ticker = ?
    `);
    const now = new Date().toISOString();
    stmt.run('CLOSED', now, ticker);
    log('INFO', 'db-manager', `Позиция закрыта: ${ticker}`);
  },

  /** Удалить позицию */
  delete(ticker: string): number {
    initializeDatabase();
    const stmt = db.prepare('DELETE FROM positions WHERE ticker = ?');
    const info = stmt.run(ticker);
    log('INFO', 'db-manager', `Позиция удалена: ${ticker}`);
    return info.changes;
  },

  /** Получить суммарную статистику портфеля */
  getPortfolioSummary(): {
    totalCost: number;
    totalMarketValue: number;
    totalGain: number;
    totalGainPercent: number;
    activeCount: number;
    recoveryOnlyCount: number;
  } {
    initializeDatabase();
    const stmt = db.prepare(`
      SELECT
        COALESCE(SUM(total_cost), 0) as total_cost,
        COALESCE(SUM(current_market_value), 0) as total_market_value,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_count,
        COUNT(CASE WHEN status = 'RECOVERY_ONLY' THEN 1 END) as recovery_count
      FROM positions
    `);
    const row = stmt.get() as {
      total_cost: number;
      total_market_value: number;
      active_count: number;
      recovery_count: number;
    };
    const totalGain = row.total_market_value - row.total_cost;
    const totalGainPercent = row.total_cost > 0
      ? (totalGain / row.total_cost) * 100
      : 0;

    return {
      totalCost: row.total_cost,
      totalMarketValue: row.total_market_value,
      totalGain,
      totalGainPercent,
      activeCount: row.active_count,
      recoveryOnlyCount: row.recovery_count,
    };
  },
};

// ──────────────────────────────────────────────
// 5. Репозиторий: Сделки
// ──────────────────────────────────────────────

const tradesRepo = {
  /** Добавить сделку */
  add(trade: Omit<Trade, 'id' | 'createdAt'>): Trade {
    initializeDatabase();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO trades (date, ticker, type, quantity, price, total_amount, commission, status, account_id, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      trade.date,
      trade.ticker,
      trade.type,
      trade.quantity,
      trade.price,
      trade.totalAmount,
      trade.commission,
      trade.status,
      trade.accountId,
      trade.note || null,
      now,
    );
    log(
      'INFO',
      'db-manager',
      `Сделка ${trade.type}: ${trade.quantity}x ${trade.ticker} @ ${trade.price}`,
    );
    return this.getByTicker(trade.ticker, 1).pop()!;
  },

  /** Получить сделки по тикеру */
  getByTicker(ticker: string, limit = 100): Trade[] {
    initializeDatabase();
    const stmt = db.prepare(
      'SELECT * FROM trades WHERE ticker = ? ORDER BY date DESC LIMIT ?',
    );
    return stmt.all(ticker, limit) as Trade[];
  },

  /** Получить сделки по тикеру за период */
  getByTickerAndDateRange(ticker: string, from: string, to: string): Trade[] {
    initializeDatabase();
    const stmt = db.prepare(
      'SELECT * FROM trades WHERE ticker = ? AND date >= ? AND date <= ? ORDER BY date DESC',
    );
    return stmt.all(ticker, from, to) as Trade[];
  },

  /** Получить все сделки (последние N) */
  getAll(limit = 500): Trade[] {
    initializeDatabase();
    const stmt = db.prepare('SELECT * FROM trades ORDER BY date DESC LIMIT ?');
    return stmt.all(limit) as Trade[];
  },

  /** Получить итог по тикеру */
  getTickerSummary(ticker: string): {
    totalBought: number;
    totalSold: number;
    avgBuyPrice: number;
    avgSellPrice: number;
    totalBoughtAmount: number;
    totalSoldAmount: number;
  } {
    initializeDatabase();
    const stmt = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'BUY' THEN quantity ELSE 0 END), 0) as total_bought,
        COALESCE(SUM(CASE WHEN type = 'SELL' THEN quantity ELSE 0 END), 0) as total_sold,
        COALESCE(SUM(CASE WHEN type = 'BUY' THEN total_amount ELSE 0 END), 0) as total_bought_amount,
        COALESCE(SUM(CASE WHEN type = 'SELL' THEN total_amount ELSE 0 END), 0) as total_sold_amount,
        CASE WHEN SUM(CASE WHEN type = 'BUY' THEN quantity ELSE 0 END) > 0
          THEN SUM(CASE WHEN type = 'BUY' THEN total_amount ELSE 0 END) / SUM(CASE WHEN type = 'BUY' THEN quantity ELSE 0 END)
          ELSE 0 END as avg_buy_price,
        CASE WHEN SUM(CASE WHEN type = 'SELL' THEN quantity ELSE 0 END) > 0
          THEN SUM(CASE WHEN type = 'SELL' THEN total_amount ELSE 0 END) / SUM(CASE WHEN type = 'SELL' THEN quantity ELSE 0 END)
          ELSE 0 END as avg_sell_price
      FROM trades
      WHERE ticker = ?
    `);
    const row = stmt.get(ticker) as Record<string, number>;
    return {
      totalBought: row.total_bought,
      totalSold: row.total_sold,
      avgBuyPrice: row.avg_buy_price,
      avgSellPrice: row.avg_sell_price,
      totalBoughtAmount: row.total_bought_amount,
      totalSoldAmount: row.total_sold_amount,
    };
  },
};

// ──────────────────────────────────────────────
// 6. Репозиторий: Заявки QUIK
// ──────────────────────────────────────────────

const quikOrdersRepo = {
  /** Добавить заявку */
  add(order: Omit<QuikOrder, 'id' | 'createdAt'>): QuikOrder {
    initializeDatabase();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO quik_orders (date, ticker, side, type, quantity, price, filled_quantity, status, account_id, quik_order_num, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      order.date,
      order.ticker,
      order.side,
      order.type,
      order.quantity,
      order.price,
      order.filledQuantity,
      order.status,
      order.accountId,
      order.quikOrderNum || null,
      order.note || null,
      now,
    );
    log(
      'INFO',
      'db-manager',
      `Заявка QUIK: ${order.side} ${order.quantity}x ${order.ticker} @ ${order.price}`,
    );
    return this.getByTicker(order.ticker, 1).pop()!;
  },

  /** Получить активные заявки */
  getActive(): QuikOrder[] {
    initializeDatabase();
    const stmt = db.prepare(
      "SELECT * FROM quik_orders WHERE status IN ('NEW', 'PARTIAL') ORDER BY date DESC",
    );
    return stmt.all() as QuikOrder[];
  },

  /** Получить заявки по тикеру */
  getByTicker(ticker: string, limit = 50): QuikOrder[] {
    initializeDatabase();
    const stmt = db.prepare(
      'SELECT * FROM quik_orders WHERE ticker = ? ORDER BY date DESC LIMIT ?',
    );
    return stmt.all(ticker, limit) as QuikOrder[];
  },

  /** Обновить статус заявки */
  updateStatus(id: number, status: OrderStatus, filledQuantity?: number): void {
    initializeDatabase();
    const stmt = db.prepare(`
      UPDATE quik_orders SET status = ?, filled_quantity = COALESCE(?, filled_quantity) WHERE id = ?
    `);
    stmt.run(status, filledQuantity || null, id);
    log('INFO', 'db-manager', `Заявка #${id} обновлена: ${status}`);
  },

  /** Удалить заявку */
  delete(id: number): void {
    initializeDatabase();
    const stmt = db.prepare('DELETE FROM quik_orders WHERE id = ?');
    stmt.run(id);
  },
};

// ──────────────────────────────────────────────
// 7. Репозиторий: Новости
// ──────────────────────────────────────────────

const newsRepo = {
  /** Добавить новость */
  add(news: Omit<NewsRecord, 'id' | 'createdAt' | 'isProcessed'>): NewsRecord {
    initializeDatabase();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO news (title, date, source, url, importance, sentiment, summary, relevance_to_ticker, is_processed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);
    stmt.run(
      news.title,
      news.date,
      news.source,
      news.url,
      news.importance,
      news.sentiment,
      news.summary,
      news.relevanceToTicker,
      now,
    );
    return this.getByTicker(news.relevanceToTicker).pop()!;
  },

  /** Получить неотфильтрованные новости для Gatekeeper */
  getUnprocessed(limit = 50): NewsRecord[] {
    initializeDatabase();
    const stmt = db.prepare(
      'SELECT * FROM news WHERE is_processed = 0 ORDER BY date DESC LIMIT ?',
    );
    return stmt.all(limit) as NewsRecord[];
  },

  /** Отметить новость как обработанную */
  markProcessed(id: number): void {
    initializeDatabase();
    const stmt = db.prepare('UPDATE news SET is_processed = 1 WHERE id = ?');
    stmt.run(id);
  },

  /** Получить новости по тикеру */
  getByTicker(ticker: string, limit = 20): NewsRecord[] {
    initializeDatabase();
    const stmt = db.prepare(
      'SELECT * FROM news WHERE relevance_to_ticker = ? AND is_processed = 1 ORDER BY date DESC LIMIT ?',
    );
    return stmt.all(ticker, limit) as NewsRecord[];
  },

  /** Удалить старые новости (старше 14 дней) */
  cleanupOld(): number {
    initializeDatabase();
    const stmt = db.prepare(
      "DELETE FROM news WHERE date < datetime('now', '-14 days')",
    );
    const info = stmt.run();
    return info.changes;
  },
};

// ──────────────────────────────────────────────
// 8. Репозиторий: Котировки
// ──────────────────────────────────────────────

const pricesRepo = {
  /** Добавить снимок цены */
  add(snapshot: Omit<PriceSnapshot, 'id' | 'createdAt'>): void {
    initializeDatabase();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO price_snapshots (ticker, date, open, high, low, close, volume, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      snapshot.ticker,
      snapshot.date,
      snapshot.open,
      snapshot.high,
      snapshot.low,
      snapshot.close,
      snapshot.volume,
      snapshot.source,
      new Date().toISOString(),
    );
  },

  /** Получить последние N снимков по тикеру */
  getLast(ticker: string, count = 30): PriceSnapshot[] {
    initializeDatabase();
    const stmt = db.prepare(
      'SELECT * FROM price_snapshots WHERE ticker = ? ORDER BY date DESC LIMIT ?',
    );
    return stmt.all(ticker, count) as PriceSnapshot[];
  },

  /** Получить последнюю цену по тикеру */
  getLatest(ticker: string): PriceSnapshot | undefined {
    initializeDatabase();
    const stmt = db.prepare(
      'SELECT * FROM price_snapshots WHERE ticker = ? ORDER BY date DESC LIMIT 1',
    );
    return stmt.get(ticker) as PriceSnapshot | undefined;
  },

  /** Получить диапазон цен */
  getRange(ticker: string, from: string, to: string): PriceSnapshot[] {
    initializeDatabase();
    const stmt = db.prepare(
      'SELECT * FROM price_snapshots WHERE ticker = ? AND date >= ? AND date <= ? ORDER BY date ASC',
    );
    return stmt.all(ticker, from, to) as PriceSnapshot[];
  },
};

// ──────────────────────────────────────────────
// 9. Репозиторий: Макроэкономика
// ──────────────────────────────────────────────

const macroRepo = {
  /** Добавить запись */
  add(record: Omit<MacroRecord, 'id' | 'createdAt'>): void {
    initializeDatabase();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO macro (date, key_rate, inflation, fx_rate, oil_price, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.date,
      record.keyRate,
      record.inflation,
      record.fxRate,
      record.oilPrice,
      record.source,
      new Date().toISOString(),
    );
  },

  /** Получить последнюю запись */
  getLatest(): MacroRecord | undefined {
    initializeDatabase();
    const stmt = db.prepare('SELECT * FROM macro ORDER BY date DESC LIMIT 1');
    return stmt.get() as MacroRecord | undefined;
  },

  /** Получить все записи */
  getAll(): MacroRecord[] {
    initializeDatabase();
    const stmt = db.prepare('SELECT * FROM macro ORDER BY date DESC');
    return stmt.all() as MacroRecord[];
  },
};

// ──────────────────────────────────────────────
// 10. Репозиторий: Цели инвестора
// ──────────────────────────────────────────────

const goalsRepo = {
  /** Получить все цели */
  getAll(): InvestorGoal[] {
    initializeDatabase();
    const stmt = db.prepare(
      'SELECT * FROM investor_goals ORDER BY priority DESC',
    );
    return stmt.all() as InvestorGoal[];
  },

  /** Добавить цель */
  add(goal: Omit<InvestorGoal, 'id' | 'createdAt'>): InvestorGoal {
    initializeDatabase();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO investor_goals (name, description, target_amount, current_amount, currency, deadline, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      goal.name,
      goal.description,
      goal.targetAmount,
      goal.currentAmount,
      goal.currency,
      goal.deadline,
      goal.priority,
      now,
    );
    return this.getAll().find((g) => g.name === goal.name)!;
  },

  /** Обновить текущую сумму цели */
  updateProgress(id: number, currentAmount: number): void {
    initializeDatabase();
    const stmt = db.prepare(
      'UPDATE investor_goals SET current_amount = ? WHERE id = ?',
    );
    stmt.run(currentAmount, id);
  },
};

// ──────────────────────────────────────────────
// 11. Репозиторий: Аккаунты
// ──────────────────────────────────────────────

const accountsRepo = {
  /** Получить все аккаунты */
  getAll(): AccountSetting[] {
    initializeDatabase();
    const stmt = db.prepare('SELECT * FROM accounts ORDER BY name');
    return stmt.all() as AccountSetting[];
  },

  /** Получить активный аккаунт */
  getActive(): AccountSetting[] {
    initializeDatabase();
    const stmt = db.prepare('SELECT * FROM accounts WHERE is_active = 1');
    return stmt.all() as AccountSetting[];
  },

  /** Добавить аккаунт */
  add(account: Omit<AccountSetting, 'id' | 'createdAt'>): AccountSetting {
    initializeDatabase();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO accounts (name, type, account_number, quik_path, excel_file_path, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      account.name,
      account.type,
      account.accountNumber,
      account.quikPath || null,
      account.excelFilePath || null,
      account.isActive ? 1 : 0,
      now,
    );
    return this.getAll().find(
      (a) => a.accountNumber === account.accountNumber,
    )!;
  },
};

// ──────────────────────────────────────────────
// 12. Репозиторий: Research Cache
// ──────────────────────────────────────────────

interface ResearchSnapshotRow {
  id: number;
  ticker: string;
  snapshot_data: string;
  research_timestamp: string;
  ttl_seconds: number;
  created_at: string;
  expires_at: string;
}

const researchCacheRepo = {
  /** Сохранить research-снимок */
  set(ticker: string, snapshotData: string, researchTimestamp: string, ttlSeconds: number = 300): void {
    initializeDatabase();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO research_snapshots (ticker, snapshot_data, research_timestamp, ttl_seconds, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(ticker, snapshotData, researchTimestamp, ttlSeconds, expiresAt);
  },

  /** Получить research-снимок */
  get(ticker: string, researchTimestamp: string): string | null {
    initializeDatabase();
    const stmt = db.prepare(
      "SELECT snapshot_data FROM research_snapshots WHERE ticker = ? AND research_timestamp = ? AND expires_at > datetime('now')",
    );
    const row = stmt.get(ticker, researchTimestamp) as ResearchSnapshotRow | undefined;
    return row?.snapshot_data ?? null;
  },

  /** Удалить research-снимок */
  delete(ticker: string, researchTimestamp: string): void {
    initializeDatabase();
    const stmt = db.prepare(
      'DELETE FROM research_snapshots WHERE ticker = ? AND research_timestamp = ?',
    );
    stmt.run(ticker, researchTimestamp);
  },

  /** Очистить все просроченные снимки */
  clearExpired(): number {
    initializeDatabase();
    const stmt = db.prepare(
      "DELETE FROM research_snapshots WHERE expires_at <= datetime('now')",
    );
    const result = stmt.run();
    return result.changes;
  },

  /** Получить все снимки для тикера */
  getAllForTicker(ticker: string): string[] {
    initializeDatabase();
    const stmt = db.prepare(
      "SELECT snapshot_data FROM research_snapshots WHERE ticker = ? AND expires_at > datetime('now') ORDER BY research_timestamp DESC",
    );
    const rows = stmt.all(ticker) as ResearchSnapshotRow[];
    return rows.map((row) => row.snapshot_data);
  },

  /** Очистить все снимки */
  clearAll(): void {
    initializeDatabase();
    db.prepare('DELETE FROM research_snapshots').run();
  },
};

// ──────────────────────────────────────────────
// 13. Экспорт: главный конвейер
// ──────────────────────────────────────────────

export const dbManager = (): void => {
  initializeDatabase();
  console.log('📦 DB-Manager: SQLite-слой инициализирован');
  console.log(`   Путь к БД: ${dbPath}`);
};

// Экспорт всех репозиториев для использования в других модулях
export {
  db,
  positionsRepo,
  tradesRepo,
  quikOrdersRepo,
  newsRepo,
  pricesRepo,
  macroRepo,
  goalsRepo,
  accountsRepo,
  researchCacheRepo,
};
