/**
 * PriceAlertNotifier — мониторинг ценовых алертов и рассылка в Telegram.
 *
 * Источник алертов: {@link PriceAlertsModule} (ai-advisor) или любой
 * внешний провайдер, инъектируемый через конструктор. Модуль:
 * - фильтрует ТОЛЬКО сработавшие (активные) алерты;
 * - исключает дубли: «уже отправлено» отслеживается в памяти по ключу
 *   тикер+направление+дата (в один день алерт шлётся один раз);
 * - вызывает TelegramNotifier.sendMessage (no-op, если sender не привязан);
 * - ошибки провайдера → 0 отправлений + warn (без проброса).
 */

import { getLogger } from '../logger/logger.js';
import type { PriceAlert } from '../ai-advisor/types.js';
import { TelegramNotifier } from './telegram-notifier.js';

/** Логгер модуля (browser-safe) */
const log = getLogger('price-alert-notifier');

/** Провайдер текущих ценовых алертов (инъекция для тестов и внешних движков) */
export type PriceAlertsProvider = () => PriceAlert[] | Promise<PriceAlert[]>;

/** Ключ дедупликации: тикер|направление|дата (YYYY-MM-DD) */
function alertKey(alert: PriceAlert, date: string): string {
  return `${alert.ticker}|${alert.direction ?? 'unknown'}|${date}`;
}

/**
 * Уведомитель ценовых алертов через Telegram.
 */
export class PriceAlertNotifier {
  private readonly notifier: TelegramNotifier;
  private alertsProvider?: PriceAlertsProvider;
  private readonly sentKeys = new Set<string>();

  constructor(
    notifier: TelegramNotifier,
    alertsProvider?: PriceAlertsProvider,
  ) {
    this.notifier = notifier;
    this.alertsProvider = alertsProvider;
  }

  /** Заменить/установить провайдера (например, после готовности данных) */
  setProvider(provider: PriceAlertsProvider): void {
    this.alertsProvider = provider;
  }

  /**
   * Сформировать текст уведомления по алерту.
   * Формат: тикер, направление, уровень, текущая цена.
   */
  formatAlertMessage(alert: PriceAlert): string {
    const directionLabel =
      alert.direction === 'upper'
        ? '📈 Рост выше уровня'
        : '📉 Падение ниже уровня';
    const level =
      alert.direction === 'upper' ? alert.upperLimit : alert.lowerLimit;

    const priceText = Number.isFinite(alert.currentPrice)
      ? alert.currentPrice.toLocaleString('ru-RU')
      : String(alert.currentPrice);
    const levelText = Number.isFinite(level)
      ? level.toLocaleString('ru-RU')
      : String(level);

    return [
      `⚡ Ценовой алерт: ${alert.name} (${alert.ticker})`,
      `${directionLabel}: ${levelText} ₽`,
      `Текущая цена: ${priceText} ₽`,
    ].join('\n');
  }

  /**
   * Проверить алерты и отправить уведомления по сработавшим.
   *
   * @returns количество ОТПРАВЛЕННЫХ сообщений (не включая дубли)
   */
  async checkAndNotify(): Promise<number> {
    let alerts: PriceAlert[];
    try {
      alerts = this.alertsProvider ? await this.alertsProvider() : [];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Ошибка провайдера алертов: ${message}`);
      return 0;
    }

    if (!Array.isArray(alerts) || alerts.length === 0) {
      return 0;
    }

    const today = new Date().toISOString().slice(0, 10);
    let sent = 0;

    for (const alert of alerts) {
      if (!alert || !alert.ticker) {
        continue;
      }
      const key = alertKey(alert, today);
      if (this.sentKeys.has(key)) {
        continue;
      }

      const ok = await this.notifier.sendMessage(
        this.formatAlertMessage(alert),
      );
      if (ok) {
        this.sentKeys.add(key);
        sent++;
      }
    }

    return sent;
  }
}
