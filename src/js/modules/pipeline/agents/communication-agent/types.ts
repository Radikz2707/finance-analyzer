/**
 * CommunicationAgent — уведомления через Telegram, Email, Desktop.
 */

// ──────────────────────────────────────────────
// 1. Типы каналов и уведомлений
// ──────────────────────────────────────────────

/** Канал доставки */
export type ChannelType = 'telegram' | 'email' | 'desktop';

/** Уровень важности уведомления */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';

/** Статус отправки */
export type SendStatus = 'pending' | 'sent' | 'failed' | 'retrying';

// ──────────────────────────────────────────────
// 2. Интерфейсы
// ──────────────────────────────────────────────

/** Настройка канала */
export interface ChannelConfig {
  type: ChannelType;
  enabled: boolean;
  name: string;
  settings: Record<string, unknown>;
}

/** Уведомление */
export interface Notification {
  id: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  channels: ChannelType[];
  createdAt: string;
  sentAt?: string;
  status: SendStatus;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** Результат отправки */
export interface SendResult {
  notificationId: string;
  channel: ChannelType;
  status: SendStatus;
  message: string;
  error?: string;
}

/** Статистика уведомлений */
export interface NotificationStats {
  total: number;
  byPriority: Record<NotificationPriority, number>;
  byStatus: Record<SendStatus, number>;
  byChannel: Record<ChannelType, number>;
}

// ──────────────────────────────────────────────
// 3. Входы и выходы
// ──────────────────────────────────────────────

/** Действия CommunicationAgent */
export type CommunicationAgentAction =
  | 'send'
  | 'send-all'
  | 'get-history'
  | 'get-stats'
  | 'configure-channel'
  | 'test-channel'
  | 'clear-history';

/** Вход для send */
export interface SendParams {
  title: string;
  body: string;
  priority?: NotificationPriority;
  channels?: ChannelType[];
  metadata?: Record<string, unknown>;
}

/** Вход для send-all */
export interface SendAllParams {
  notifications: SendParams[];
}

/** Вход для get-history */
export interface HistoryParams {
  limit?: number;
  status?: SendStatus;
  channel?: ChannelType;
}

/** Вход для configure-channel */
export interface ConfigureChannelParams {
  type: ChannelType;
  enabled: boolean;
  settings: Record<string, unknown>;
}

/** Вход для test-channel */
export interface TestChannelParams {
  type: ChannelType;
}

/** Вход CommunicationAgent */
export type CommunicationAgentInput =
  | { action: 'send'; params: SendParams }
  | { action: 'send-all'; params: SendAllParams }
  | { action: 'get-history'; params?: HistoryParams }
  | { action: 'get-stats'; params?: Record<string, never> }
  | { action: 'configure-channel'; params: ConfigureChannelParams }
  | { action: 'test-channel'; params: TestChannelParams }
  | { action: 'clear-history'; params?: Record<string, never> };

/** Результат операции */
export interface CommunicationOperationResult {
  success: boolean;
  message: string;
  notification?: Notification;
  notifications?: Notification[];
  sendResults?: SendResult[];
  stats?: NotificationStats;
  channels?: ChannelConfig[];
  testResult?: TestResult;
}

/** Результат теста канала */
export interface TestResult {
  channel: ChannelType;
  connected: boolean;
  message: string;
}

/** Выход CommunicationAgent */
export type CommunicationAgentOutput = CommunicationOperationResult;
