/**
 * Типы для двухслойной системы памяти
 * Оперативная — краткосрочная (7-14 дней), стратегическая — долгосрочная (3-6 месяцев)
 */

export type MemoryEventType =
  | 'AI_ANALYSIS'
  | 'TRADE_EXECUTED'
  | 'ORDER_PLACED'
  | 'NEWS_FILTERED'
  | 'RISK_ALERT'
  | 'PORTFOLIO_UPDATE'
  | 'AI_RECOMMENDATION'
  | 'SYSTEM_EVENT'
  | 'USER_DECISION';

export type MemorySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Оперативная память — сырые логи и события */
export interface OperationalMemoryEntry {
  id?: number;
  timestamp: string; // ISO 8601
  eventType: MemoryEventType;
  ticker?: string;
  severity: MemorySeverity;
  summary: string;
  details: string; // JSON-строка с полными данными
  isRead: boolean;
  createdAt: string;
}

/** Стратегическая память — агрегированные KPI и тренды */
export interface StrategicMemoryEntry {
  id?: number;
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601
  periodType: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
  totalReturn: number; // %
  totalReturnRub: number; // RUB
  totalDividends: number;
  totalCoupons: number;
  totalCommissions: number;
  activePositions: number;
  closedPositions: number;
  totalTrades: number;
  buyTrades: number;
  sellTrades: number;
  avgWinRate: number; // %
  avgHoldingPeriod: number; // дней
  maxDrawdown: number; // %
  sharpeRatio?: number;
  keyDecisions: string; // JSON-массив решений
  riskEvents: number;
  aiRecommendations: number;
  createdAt: string;
}

/** Состояние сессии — контекст текущего взаимодействия */
export interface SessionState {
  id?: number;
  sessionId: string;
  userId: number; // Telegram chat_id
  lastActivity: string;
  context: string; // JSON — текущий контекст (выбранный тикер, открытые модалки и т.д.)
  conversationHistory: string; // JSON — последние N сообщений
  createdAt: string;
  updatedAt: string;
}

/** Глобальные настройки памяти */
export interface MemoryConfig {
  operationalRetentionDays: number; // по умолчанию 14
  strategicAggregationInterval: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
  maxOperationalEntries: number; // по умолчанию 5000
  maxSessionHistory: number; // по умолчанию 50 сообщений
}
