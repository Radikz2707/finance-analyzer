/**
 * Типы данных для SQLite-хранилища
 * Все таблицы спроектированы без хардкода — данные приходят динамически
 */

// ──────────────────────────────────────────────
// 1. Активы и портфель
// ──────────────────────────────────────────────

export type AssetType = 'STOCK' | 'BOND' | 'ETF' | 'CASH' | 'OTHER';
export type PositionStatus = 'ACTIVE' | 'RECOVERY_ONLY' | 'CLOSED';

export interface PortfolioPosition {
  id?: number;
  ticker: string;
  name: string;
  assetType: AssetType;
  issuer: string;
  currency: string;
  market: string;
  quantity: number;
  avgPrice: number;
  totalCost: number;
  currentPrice?: number;
  currentMarketValue?: number;
  targetPercent?: number;
  status: PositionStatus;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// ──────────────────────────────────────────────
// 2. Сделки
// ──────────────────────────────────────────────

export type TradeType = 'BUY' | 'SELL';
export type TradeStatus = 'EXECUTED' | 'PENDING' | 'CANCELLED';

export interface Trade {
  id?: number;
  date: string; // ISO 8601
  ticker: string;
  type: TradeType;
  quantity: number;
  price: number;
  totalAmount: number;
  commission: number;
  status: TradeStatus;
  accountId: string; // ИИС или брокерский счёт
  note?: string;
}

// ──────────────────────────────────────────────
// 3. Заявки QUIK
// ──────────────────────────────────────────────

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type OrderStatus =
  'NEW' | 'PARTIAL' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export interface QuikOrder {
  id?: number;
  date: string;
  ticker: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price: number;
  filledQuantity: number;
  status: OrderStatus;
  accountId: string;
  quikOrderNum?: number;
  note?: string;
}

// ──────────────────────────────────────────────
// 4. Цели инвестора
// ──────────────────────────────────────────────

export interface InvestorGoal {
  id?: number;
  name: string;
  description: string;
  targetAmount: number;
  currentAmount: number;
  currency: string;
  deadline: string; // ISO 8601
  priority: number; // 1-10
  createdAt: string;
}

// ──────────────────────────────────────────────
// 5. Настройки аккаунтов
// ──────────────────────────────────────────────

export interface AccountSetting {
  id?: number;
  name: string;
  type: 'BROKER' | 'IIS';
  accountNumber: string;
  quikPath?: string;
  excelFilePath?: string;
  isActive: boolean;
  createdAt: string;
}

// ──────────────────────────────────────────────
// 6. Котировки (история цен)
// ──────────────────────────────────────────────

export interface PriceSnapshot {
  id?: number;
  ticker: string;
  date: string; // ISO 8601
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string; // 'QUIK' | 'MOEX' | 'FINAM'
}

// ──────────────────────────────────────────────
// 7. Новости
// ──────────────────────────────────────────────

export type NewsImportance = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type NewsSentiment = 'NEGATIVE' | 'NEUTRAL' | 'POSITIVE' | 'UNKNOWN';

export interface NewsRecord {
  id?: number;
  title: string;
  date: string;
  source: string;
  url: string;
  importance: NewsImportance;
  sentiment: NewsSentiment;
  summary: string;
  relevanceToTicker: string; // тикер или пустая строка
  isProcessed: boolean;
  createdAt: string;
}

// ──────────────────────────────────────────────
// 8. Макроэкономические данные
// ──────────────────────────────────────────────

export interface MacroRecord {
  id?: number;
  date: string;
  keyRate: number;
  inflation: number;
  fxRate: number; // USD/RUB
  oilPrice: number; // Brent
  source: string;
}

// ──────────────────────────────────────────────
// 9. Логи системы
// ──────────────────────────────────────────────

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface SystemLog {
  id?: number;
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  metadata?: string; // JSON-строка
}
