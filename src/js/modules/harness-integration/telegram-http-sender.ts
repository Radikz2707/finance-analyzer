/**
 * TelegramHttpSender — реальный отправитель Telegram через Bot API.
 *
 * Реализует {@link TelegramSender} из types.ts и регистрируется через
 * TelegramNotifier.attach(). Никаких секретов в коде: токен/chatId берутся
 * из конфига или process.env (.env скрыт):
 *   - TELEGRAM_BOT_TOKEN  — токен бота
 *   - TELEGRAM_CHAT_ID    — ID чата (или первый ID из TELEGRAM_ADMIN_IDS)
 *   - TELEGRAM_ADMIN_IDS  — список admin-чатов через запятую (fallback)
 *
 * Безопасность: в логах НИКОГДА не выводится токен. При ошибке или
 * отсутствии конфигурации возвращается false (no-op).
 */

import type { TelegramSender } from './types.js';

/** Конфигурация TelegramHttpSender */
export interface TelegramHttpSenderConfig {
  /** Токен бота (приоритет над process.env.TELEGRAM_BOT_TOKEN) */
  token?: string;
  /** ID чата (приоритет над env) */
  chatId?: string;
  /** Инъекция fetch для тестов (по умолчанию глобальный fetch) */
  fetchImpl?: typeof fetch;
  /** Таймаут запроса, мс (по умолчанию 10 000) */
  timeoutMs?: number;
}

/** Таймаут по умолчанию */
export const DEFAULT_TELEGRAM_TIMEOUT_MS = 10000;

/** Базовый URL Bot API */
export const TELEGRAM_API_URL = 'https://api.telegram.org';

/** Разобрать TELEGRAM_ADMIN_IDS через запятую */
function parseAdminIds(): string[] {
  return (process.env.TELEGRAM_ADMIN_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Реальный отправитель Telegram-сообщений через Bot API.
 */
export class TelegramHttpSender implements TelegramSender {
  private readonly token: string | undefined;
  private readonly chatId: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: TelegramHttpSenderConfig = {}) {
    const adminIds = parseAdminIds();
    this.token = config.token ?? process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = config.chatId ?? process.env.TELEGRAM_CHAT_ID ?? adminIds[0];
    this.fetchImpl = config.fetchImpl ?? ((...args) => fetch(...args));
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TELEGRAM_TIMEOUT_MS;
  }

  /** Сконфигурирован ли отправитель (токен + chatId) */
  isConfigured(): boolean {
    return Boolean(this.token && this.chatId);
  }

  /**
   * Отправить сообщение.
   * @returns true при успешной отправке, false — не сконфигурирован/ошибка.
   */
  async sendMessage(text: string): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn(
        '[TelegramHttpSender] Не сконфигурирован — сообщение не отправлено',
      );
      return false;
    }

    // НЕ логируем токен: только начало для диагностики
    const url = `${TELEGRAM_API_URL}/bot${this.token}/sendMessage`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          disable_notification: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        console.warn(
          `[TelegramHttpSender] HTTP ${response.status} — сообщение не отправлено`,
        );
        return false;
      }

      const data = (await response.json()) as { ok?: boolean };
      if (data && data.ok === true) {
        return true;
      }

      console.warn('[TelegramHttpSender] API вернул ok=false');
      return false;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // Токен/URL не логируем — только текст ошибки
      console.warn(`[TelegramHttpSender] Ошибка отправки: ${errorMsg}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
