/**
 * CommunicationAgent — уведомления через Telegram, Email, Desktop.
 */

import { randomUUID } from 'crypto';
import { AgentBase } from '../../agent/agent-base.js';
import type { AgentConfig } from '../../agent/types.js';
import type {
  CommunicationAgentInput,
  CommunicationAgentOutput,
  SendParams,
  SendAllParams,
  HistoryParams,
  ConfigureChannelParams,
  TestChannelParams,
  Notification,
  SendResult,
  ChannelConfig,
  ChannelType,
  NotificationPriority,
  SendStatus,
} from './types.js';

export class CommunicationAgent extends AgentBase {
  private notifications: Map<string, Notification>;
  private channels: Map<ChannelType, ChannelConfig>;

  constructor(config: AgentConfig) {
    super({ ...config, timeoutMs: config.timeoutMs ?? 15000 });
    this.notifications = new Map();
    this.channels = new Map();
    this.initDefaultChannels();
  }

  protected async executeInternal(input: unknown): Promise<unknown> {
    const p = input as CommunicationAgentInput;
    switch (p.action) {
      case 'send':
        return this.sendNotification(p.params as SendParams);
      case 'send-all':
        return this.sendAll(p.params as SendAllParams);
      case 'get-history':
        return this.getHistory(p.params as HistoryParams | undefined);
      case 'get-stats':
        return this.getStats();
      case 'configure-channel':
        return this.configureChannel(p.params as ConfigureChannelParams);
      case 'test-channel':
        return this.testChannel(p.params as TestChannelParams);
      case 'clear-history':
        return this.clearHistory();
      default:
        throw new Error('Unknown action: ' + (p as { action: string }).action);
    }
  }

  private now(): string {
    return new Date().toISOString();
  }

  private initDefaultChannels(): void {
    this.channels.set('telegram', {
      type: 'telegram',
      enabled: false,
      name: 'Telegram',
      settings: { botToken: '', chatId: '' },
    });
    this.channels.set('email', {
      type: 'email',
      enabled: false,
      name: 'Email',
      settings: { smtpHost: '', smtpPort: 587, user: '', password: '' },
    });
    this.channels.set('desktop', {
      type: 'desktop',
      enabled: true,
      name: 'Desktop',
      settings: {},
    });
  }

  // ── Send Notification ──

  private async sendNotification(
    params: SendParams,
  ): Promise<CommunicationAgentOutput> {
    const notification: Notification = {
      id: randomUUID(),
      title: params.title,
      body: params.body,
      priority: params.priority ?? 'normal',
      channels: params.channels ?? ['desktop'],
      createdAt: this.now(),
      status: 'pending',
    };

    const results: SendResult[] = [];

    for (const channel of notification.channels) {
      const result = await this.sendToChannel(notification, channel);
      results.push(result);
    }

    const allSent = results.every((r) => r.status === 'sent');
    const allFailed = results.every((r) => r.status === 'failed');
    notification.status = allSent ? 'sent' : allFailed ? 'failed' : 'retrying';
    notification.sentAt = this.now();
    if (allFailed) {
      notification.error = results.find((r) => r.error)?.message;
    }

    this.notifications.set(notification.id, notification);

    return {
      success: true,
      message: allSent
        ? 'Уведомление отправлено'
        : allFailed
          ? 'Не удалось отправить уведомление'
          : 'Частичная отправка',
      notification,
      sendResults: results,
    };
  }

  private async sendToChannel(
    notification: Notification,
    channel: ChannelType,
  ): Promise<SendResult> {
    const config = this.channels.get(channel);
    if (!config || !config.enabled) {
      return {
        notificationId: notification.id,
        channel,
        status: 'failed',
        message: 'Канал отключён',
      };
    }

    // Симуляция отправки
    const success = Math.random() > 0.1; // 90% success rate

    if (success) {
      return {
        notificationId: notification.id,
        channel,
        status: 'sent',
        message: 'Отправлено через ' + config.name,
      };
    }

    return {
      notificationId: notification.id,
      channel,
      status: 'failed',
      message: 'Ошибка отправки',
      error: 'Network timeout',
    };
  }

  // ── Send All ──

  private async sendAll(
    params: SendAllParams,
  ): Promise<CommunicationAgentOutput> {
    const results: SendResult[] = [];
    const notifications: Notification[] = [];

    for (const sendParams of params.notifications) {
      const result = await this.sendNotification(sendParams);
      if (result.notification) {
        notifications.push(result.notification);
      }
      if (result.sendResults) {
        results.push(...result.sendResults);
      }
    }

    return {
      success: true,
      message: 'Отправлено ' + notifications.length + ' уведомлений',
      notifications,
      sendResults: results,
    };
  }

  // ── History ──

  private getHistory(params?: HistoryParams): CommunicationAgentOutput {
    let items = Array.from(this.notifications.values());

    if (params) {
      if (params.status) {
        items = items.filter((n) => n.status === params.status);
      }
      if (params.channel) {
        items = items.filter((n) => n.channels.includes(params.channel!));
      }
    }

    const limit = params?.limit ?? items.length;
    const sorted = items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return {
      success: true,
      message: 'Найдено ' + sorted.length + ' уведомлений',
      notifications: sorted.slice(0, limit),
    };
  }

  // ── Stats ──

  private getStats(): CommunicationAgentOutput {
    const items = Array.from(this.notifications.values());
    const byPriority: Record<NotificationPriority, number> = {
      low: 0,
      normal: 0,
      high: 0,
      critical: 0,
    };
    const byStatus: Record<SendStatus, number> = {
      pending: 0,
      sent: 0,
      failed: 0,
      retrying: 0,
    };
    const byChannel: Record<ChannelType, number> = {
      telegram: 0,
      email: 0,
      desktop: 0,
    };

    for (const n of items) {
      byPriority[n.priority]++;
      byStatus[n.status]++;
      for (const ch of n.channels) {
        byChannel[ch]++;
      }
    }

    return {
      success: true,
      message: 'Статистика уведомлений',
      stats: {
        total: items.length,
        byPriority,
        byStatus,
        byChannel,
      },
    };
  }

  // ── Channel Management ──

  private configureChannel(
    params: ConfigureChannelParams,
  ): CommunicationAgentOutput {
    const existing = this.channels.get(params.type);
    if (existing) {
      existing.enabled = params.enabled;
      existing.settings = params.settings;
    } else {
      this.channels.set(params.type, {
        type: params.type,
        enabled: params.enabled,
        name:
          params.type === 'telegram'
            ? 'Telegram'
            : params.type === 'email'
              ? 'Email'
              : 'Desktop',
        settings: params.settings,
      });
    }

    return {
      success: true,
      message: 'Канал ' + params.type + ' настроен',
      channels: Array.from(this.channels.values()),
    };
  }

  private testChannel(params: TestChannelParams): CommunicationAgentOutput {
    const config = this.channels.get(params.type);
    if (!config) {
      return {
        success: false,
        message: 'Канал ' + params.type + ' не найден',
        testResult: {
          channel: params.type,
          connected: false,
          message: 'Канал не найден',
        },
      };
    }

    if (!config.enabled) {
      return {
        success: false,
        message: 'Канал ' + params.type + ' отключён',
        testResult: {
          channel: params.type,
          connected: false,
          message: 'Канал отключён',
        },
      };
    }

    // Симуляция теста
    const connected = Math.random() > 0.2;

    return {
      success: true,
      message: connected
        ? 'Канал ' + params.type + ' подключён'
        : 'Канал ' + params.type + ' не подключён',
      testResult: {
        channel: params.type,
        connected,
        message: connected ? 'Подключение успешно' : 'Ошибка подключения',
      },
    };
  }

  private clearHistory(): CommunicationAgentOutput {
    const count = this.notifications.size;
    this.notifications.clear();
    return {
      success: true,
      message: 'История очищена (' + count + ' записей)',
    };
  }

  // ── Helpers ──

  getNotificationCount(): number {
    return this.notifications.size;
  }

  getAllNotifications(): Notification[] {
    return Array.from(this.notifications.values());
  }

  getChannels(): ChannelConfig[] {
    return Array.from(this.channels.values());
  }
}
