/**
 * Типы OSIntegration (Задача 2.3): мост к возможностям ОС
 * (уведомления, буфер обмена, внешние ссылки) через DI-провайдеры.
 *
 * Все платформенные зависимости инжектируются — модуль полностью
 * тестируем в чистом Node. Ошибки платформы — честные, без молчаливых фейков.
 */

// ─── Уведомления ──────────────────────────────────────────────────────────

export type NotificationUrgency = 'low' | 'normal' | 'critical';

export interface OsNotification {
  title: string;
  body: string;
  urgency: NotificationUrgency;
}

export interface NotificationRecord extends OsNotification {
  id: string;
  /** ISO-время создания. */
  ts: string;
  /** true — платформенный провайдер подтвердил показ. */
  delivered: boolean;
  /** Честная причина недоставки (если delivered=false). */
  error?: string;
}

/** Платформенный провайдер уведомлений (Electron Notification и т.п.). */
export interface NotificationProvider {
  /** Показывает уведомление; false — платформа отказала. */
  show(notification: OsNotification): Promise<boolean>;
  /** Поддерживает ли платформа уведомления (честная проверка). */
  isSupported(): boolean;
}

// ─── Буфер обмена ─────────────────────────────────────────────────────────

export interface ClipboardProvider {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

export interface ClipboardRecord {
  id: string;
  ts: string;
  /** Длина скопированного текста (сам текст не хранится в истории). */
  length: number;
  preview: string;
}

// ─── Внешние ссылки ──────────────────────────────────────────────────────

/** Платформенный открыватель ссылок (shell.openExternal и т.п.). */
export interface ExternalOpener {
  open(url: string): Promise<void>;
}

// ─── Фасад ────────────────────────────────────────────────────────────────

export type OsIntegrationAction =
  'notify' | 'clipboard-copy' | 'clipboard-read' | 'open-link' | 'status';

export interface OsIntegrationOutput {
  success: boolean;
  action: OsIntegrationAction;
  data?: unknown;
  error?: string;
  warnings?: string[];
}

/** Снимок состояния интеграции (для status). */
export interface OsIntegrationStatus {
  notificationsSupported: boolean;
  notificationsSent: number;
  clipboardOperations: number;
  linksOpened: number;
  lastError?: string;
}
