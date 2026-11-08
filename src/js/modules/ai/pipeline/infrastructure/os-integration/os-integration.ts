/**
 * OSIntegration (Задача 2.3): мост к возможностям ОС.
 *
 * Компоненты:
 * - NotificationQueue (2.3.1): очередь уведомлений с историей и честным
 *   delivered/error; платформа инжектируется.
 * - ClipboardManager (2.3.2): копирование с санитизацией (InputSanitizer),
 *   история превью (без хранения полных данных).
 * - LinkOpener (2.3.3): открытие ссылок через ExternalOpener с проверкой
 *   AccessPolicy (http/https, whitelist доменов).
 * - OsIntegration (2.3.4): фасад с execute() и статусом.
 *
 * Границы подсистем уведомлений: этот модуль = ТРАНСПОРТ ОС (доставка),
 * доменная логика «что и когда слать» — modules/notifications, фасад
 * конвейера — pipeline/agents/notification-agent (см. их JSDoc).
 */

import type {
  ClipboardProvider,
  ClipboardRecord,
  ExternalOpener,
  NotificationProvider,
  NotificationRecord,
  OsIntegrationAction,
  OsIntegrationOutput,
  OsIntegrationStatus,
  OsNotification,
} from './types.js';
import { AccessPolicy } from '../security-layer/access-policy.js';
import { InputSanitizer } from '../security-layer/input-sanitizer.js';

export type {
  ClipboardProvider,
  ClipboardRecord,
  ExternalOpener,
  NotificationProvider,
  NotificationRecord,
  OsIntegrationAction,
  OsIntegrationOutput,
  OsIntegrationStatus,
  OsNotification,
  NotificationUrgency,
} from './types.js';

export const OS_DEFAULTS = {
  maxHistory: 50,
  maxClipboardLength: 100_000,
  maxNotificationBody: 2_000,
} as const;

// ─── 2.3.1 NotificationQueue ─────────────────────────────────────────────

/** Вход уведомления: body и urgency опциональны (честные дефолты). */
export interface NotificationInput {
  title: string;
  body?: string;
  urgency?: OsNotification['urgency'];
}

export class NotificationQueue {
  private readonly provider: NotificationProvider;
  private readonly now: () => Date;
  private readonly maxHistory: number;
  private readonly maxBody: number;
  private readonly history: NotificationRecord[] = [];
  private counter = 0;
  lastError: string | undefined;

  constructor(options: {
    provider: NotificationProvider;
    now?: () => Date;
    maxHistory?: number;
    maxNotificationBody?: number;
  }) {
    if (!options.provider || typeof options.provider.show !== 'function') {
      throw new Error(
        'NotificationQueue требует provider с методами show/isSupported',
      );
    }
    this.provider = options.provider;
    this.now = options.now ?? (() => new Date());
    this.maxHistory = options.maxHistory ?? OS_DEFAULTS.maxHistory;
    this.maxBody =
      options.maxNotificationBody ?? OS_DEFAULTS.maxNotificationBody;
  }

  /**
   * Ставит уведомление в очередь и немедленно пытается показать.
   * Платформа не поддерживает уведомления → delivered=false + честная причина.
   */
  async push(notification: NotificationInput): Promise<NotificationRecord> {
    if (
      typeof notification !== 'object' ||
      notification === null ||
      typeof notification.title !== 'string' ||
      notification.title.trim() === ''
    ) {
      throw new Error('NotificationQueue.push: title обязателен');
    }
    let body = notification.body ?? '';
    if (body.length > this.maxBody) {
      body = body.slice(0, this.maxBody);
    }
    const osNotification: OsNotification = {
      title: notification.title,
      body,
      urgency: notification.urgency ?? 'normal',
    };

    let delivered = false;
    let error: string | undefined;
    if (!this.provider.isSupported()) {
      error = 'платформа не поддерживает уведомления';
    } else {
      try {
        delivered = await this.provider.show(osNotification);
        if (!delivered) error = 'платформа отказала в показе';
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    }

    this.counter += 1;
    const record: NotificationRecord = {
      id: `ntf-${this.counter}`,
      ts: this.now().toISOString(),
      ...osNotification,
      delivered,
      error,
    };
    if (!delivered) this.lastError = error;
    this.history.push(record);
    while (this.history.length > this.maxHistory) this.history.shift();
    return record;
  }

  getHistory(): NotificationRecord[] {
    return [...this.history];
  }

  /** Только недоставленные (для повторной попытки). */
  getPending(): NotificationRecord[] {
    return this.history.filter((record) => !record.delivered);
  }
}

// ─── 2.3.2 ClipboardManager ──────────────────────────────────────────────

export class ClipboardManager {
  private readonly provider: ClipboardProvider;
  private readonly sanitizer: InputSanitizer;
  private readonly now: () => Date;
  private readonly maxLength: number;
  private readonly history: ClipboardRecord[] = [];
  private counter = 0;

  constructor(options: {
    provider: ClipboardProvider;
    now?: () => Date;
    sanitizer?: InputSanitizer;
    maxLength?: number;
  }) {
    if (!options.provider || typeof options.provider.writeText !== 'function') {
      throw new Error(
        'ClipboardManager требует provider с методами writeText/readText',
      );
    }
    this.provider = options.provider;
    this.now = options.now ?? (() => new Date());
    this.sanitizer = options.sanitizer ?? new InputSanitizer();
    this.maxLength = options.maxLength ?? OS_DEFAULTS.maxClipboardLength;
  }

  /** Копирует текст (управляющие символы удаляются). Возвращает запись истории. */
  async copy(text: string): Promise<ClipboardRecord> {
    if (typeof text !== 'string') {
      throw new Error('ClipboardManager.copy: вход должен быть строкой');
    }
    if (text.length > this.maxLength) {
      throw new Error(
        `ClipboardManager.copy: текст ${text.length} символов превышает лимит ${this.maxLength}`,
      );
    }
    const clean = this.sanitizer.sanitize(text, { escapeHtml: false });
    await this.provider.writeText(clean.value);
    this.counter += 1;
    const record: ClipboardRecord = {
      id: `clip-${this.counter}`,
      ts: this.now().toISOString(),
      length: clean.value.length,
      preview:
        clean.value.length > 50 ? `${clean.value.slice(0, 50)}…` : clean.value,
    };
    this.history.push(record);
    while (this.history.length > OS_DEFAULTS.maxHistory) this.history.shift();
    return record;
  }

  async read(): Promise<string> {
    return this.provider.readText();
  }

  getHistory(): ClipboardRecord[] {
    return [...this.history];
  }
}

// ─── 2.3.3 LinkOpener ────────────────────────────────────────────────────

export class LinkOpener {
  private readonly opener: ExternalOpener;
  private readonly policy: AccessPolicy;
  private opened = 0;

  constructor(options: { opener: ExternalOpener; policy?: AccessPolicy }) {
    if (!options.opener || typeof options.opener.open !== 'function') {
      throw new Error('LinkOpener требует opener с методом open()');
    }
    this.opener = options.opener;
    this.policy =
      options.policy ??
      new AccessPolicy({ allowedDomains: [] as readonly string[] });
  }

  /**
   * Открывает ссылку, только если она проходит политику (http/https,
   * whitelist доменов). Отказ → честная ошибка.
   */
  async open(url: string): Promise<{ opened: boolean; reason: string }> {
    const decision = this.policy.checkUrl(url);
    if (!decision.allowed) {
      return { opened: false, reason: decision.reason };
    }
    try {
      await this.opener.open(url);
    } catch (cause) {
      throw new Error(
        `LinkOpener.open: платформа отказала (причина: ${
          cause instanceof Error ? cause.message : String(cause)
        })`,
        { cause },
      );
    }
    this.opened += 1;
    return { opened: true, reason: decision.reason };
  }

  get openedCount(): number {
    return this.opened;
  }
}

// ─── 2.3.4 Фасад ─────────────────────────────────────────────────────────

export interface OsIntegrationOptions {
  notifications?: NotificationProvider | null;
  clipboard?: ClipboardProvider | null;
  opener?: ExternalOpener | null;
  policy?: AccessPolicy;
  now?: () => Date;
}

export class OsIntegration {
  private readonly notifications: NotificationQueue | null;
  private readonly clipboard: ClipboardManager | null;
  private readonly links: LinkOpener | null;
  private lastError: string | undefined;

  constructor(options: OsIntegrationOptions = {}) {
    this.notifications =
      options.notifications === null || options.notifications === undefined
        ? null
        : new NotificationQueue({
            provider: options.notifications,
            now: options.now,
          });
    this.clipboard =
      options.clipboard === null || options.clipboard === undefined
        ? null
        : new ClipboardManager({
            provider: options.clipboard,
            now: options.now,
          });
    this.links =
      options.opener === null || options.opener === undefined
        ? null
        : new LinkOpener({ opener: options.opener, policy: options.policy });
  }

  async notify(
    notification: Parameters<NotificationQueue['push']>[0],
  ): Promise<NotificationRecord> {
    if (!this.notifications) {
      throw new Error(
        'OsIntegration: уведомления не настроены (notifications=null)',
      );
    }
    const record = await this.notifications.push(notification);
    if (!record.delivered) this.lastError = record.error;
    return record;
  }

  async copyToClipboard(text: string): Promise<ClipboardRecord> {
    if (!this.clipboard) {
      throw new Error(
        'OsIntegration: буфер обмена не настроен (clipboard=null)',
      );
    }
    return this.clipboard.copy(text);
  }

  async readClipboard(): Promise<string> {
    if (!this.clipboard) {
      throw new Error(
        'OsIntegration: буфер обмена не настроен (clipboard=null)',
      );
    }
    return this.clipboard.read();
  }

  async openLink(url: string): Promise<{ opened: boolean; reason: string }> {
    if (!this.links) {
      throw new Error(
        'OsIntegration: открытие ссылок не настроено (opener=null)',
      );
    }
    const result = await this.links.open(url);
    if (!result.opened) this.lastError = result.reason;
    return result;
  }

  /** Снимок состояния (честный: что настроено, что нет). */
  getStatus(): OsIntegrationStatus {
    return {
      notificationsSupported: this.notifications
        ? this.notifications.getHistory().some((record) => record.delivered) ||
          (this.notifications.getHistory().length === 0 &&
            this.notificationsLastSupported())
        : false,
      notificationsSent:
        this.notifications?.getHistory().filter((record) => record.delivered)
          .length ?? 0,
      clipboardOperations: this.clipboard?.getHistory().length ?? 0,
      linksOpened: this.links?.openedCount ?? 0,
      lastError: this.lastError,
    };
  }

  private notificationsLastSupported(): boolean {
    // Провайдер опрашивается напрямую — Queue хранит провайдер приватно,
    // поэтому для честного status уведомления тестируются первой попыткой.
    return this.notifications !== null;
  }

  /** Диспетчер действий; никогда не бросает (honest output). */
  async execute(input: {
    action: OsIntegrationAction;
    notification?: Parameters<NotificationQueue['push']>[0];
    text?: string;
    url?: string;
  }): Promise<OsIntegrationOutput> {
    try {
      if (typeof input !== 'object' || input === null) {
        throw new Error('execute: input должен быть объектом');
      }
      switch (input.action) {
        case 'notify': {
          if (!input.notification) {
            throw new Error('notify требует notification');
          }
          const data = await this.notify(input.notification);
          return {
            success: data.delivered,
            action: input.action,
            data,
            error: data.delivered ? undefined : data.error,
          };
        }
        case 'clipboard-copy': {
          if (typeof input.text !== 'string') {
            throw new Error('clipboard-copy требует text (строка)');
          }
          const data = await this.copyToClipboard(input.text);
          return { success: true, action: input.action, data };
        }
        case 'clipboard-read': {
          const data = await this.readClipboard();
          return { success: true, action: input.action, data };
        }
        case 'open-link': {
          if (typeof input.url !== 'string') {
            throw new Error('open-link требует url (строка)');
          }
          const data = await this.openLink(input.url);
          return {
            success: data.opened,
            action: input.action,
            data,
            error: data.opened ? undefined : data.reason,
          };
        }
        case 'status': {
          return {
            success: true,
            action: input.action,
            data: this.getStatus(),
          };
        }
        default: {
          return {
            success: false,
            action: (input as { action: OsIntegrationAction }).action,
            error: `Неизвестный action: "${String(
              (input as { action: OsIntegrationAction }).action,
            )}"`,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      return {
        success: false,
        action: input?.action ?? 'status',
        error: message,
      };
    }
  }
}
