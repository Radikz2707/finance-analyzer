/**
 * TelegramNotifier — форматирование и отправка уведомлений через
 * ВНЕШНИЙ отправитель {@link TelegramSender}.
 *
 * Модуль НЕ импортирует telegram-bot напрямую: фактический отправитель
 * (бота с токеном из .env) регистрируется методом attach(sender).
 *
 * Безопасность: если sender не зарегистрирован, методы отправки
 * возвращают false и НЕ кидают ошибок (no-op).
 */

import { getLogger } from '../logger/logger.js';
import type {
  AnomalyBrief,
  SchedulerStatusInfo,
  TelegramSender,
} from './types.js';

/** Логгер модуля (browser-safe) */
const log = getLogger('telegram-notifier');

/** Эмодзи уровня риска */
const RISK_EMOJI: Record<AnomalyBrief['riskLevel'], string> = {
  low: '🟢',
  medium: '🟡',
  high: '🔴',
};

/** Эмодзи и подпись режима диспетчера */
const MODE_META: Record<
  SchedulerStatusInfo['mode'],
  { emoji: string; label: string }
> = {
  active: { emoji: '🟢', label: 'активен' },
  sleeping: { emoji: '😴', label: 'спит' },
  manual: { emoji: '✋', label: 'ручной' },
};

/** Сколько аномалий попадает в текстовый отчёт (компактность) */
export const MAX_ANOMALIES_IN_REPORT = 5;

/**
 * Адаптер уведомлений: форматирует компактные тексты с эмодзи и тикерами
 * и отправляет их через зарегистрированного отправителя.
 */
export class TelegramNotifier {
  private sender: TelegramSender | null = null;

  /**
   * Зарегистрировать внешнего отправителя (например, бота).
   * Повторный вызов заменяет текущего отправителя.
   */
  attach(sender: TelegramSender): void {
    this.sender = sender;
  }

  /** Зарегистрирован ли отправитель */
  hasSender(): boolean {
    return this.sender !== null;
  }

  // ──────────────────────────────────────────────
  // Форматирование
  // ──────────────────────────────────────────────

  /**
   * Компактный отчёт об аномалиях: тикер, z-score, риск, волатильность.
   * Маркер ⚠️ у последней точки, если она является аномалией.
   */
  formatAnomalyReport(anomalies: AnomalyBrief[]): string {
    if (anomalies.length === 0) {
      return '📊 Аномалий не обнаружено ✅';
    }

    const lines = anomalies.slice(0, MAX_ANOMALIES_IN_REPORT).map((a) => {
      const riskEmoji = RISK_EMOJI[a.riskLevel];
      const lastFlag = a.isLastAnomaly ? ' ⚠️' : '';
      return (
        `${riskEmoji} ${a.ticker}${lastFlag} | ` +
        `z=${a.zScoreLast.toFixed(2)} | риск: ${a.riskLevel} | ` +
        `вол: ${a.volatilityAnnual.toFixed(1)}%`
      );
    });

    return ['📊 Отчёт об аномалиях', ...lines].join('\n');
  }

  /**
   * Компактный алерт о статусе диспетчера: режим, последний запуск,
   * пропущенные циклы, нагрузка CPU/RAM.
   */
  formatSchedulerAlert(status: SchedulerStatusInfo): string {
    const meta = MODE_META[status.mode];
    const lastRun = status.lastRunAt ?? '—';

    return [
      '🛰 Диспетчер анализа',
      `Режим: ${meta.emoji} ${meta.label}`,
      `Последний запуск: ${lastRun}`,
      `Пропущено циклов: ${status.skippedCycles}`,
      `CPU: ${status.cpuUsagePct}% | RAM: ${status.memoryUsagePct}%`,
    ].join('\n');
  }

  // ──────────────────────────────────────────────
  // Отправка (no-op без отправителя)
  // ──────────────────────────────────────────────

  /** Отправить отчёт об аномалиях. false — без sender или при ошибке. */
  async sendAnomalyReport(anomalies: AnomalyBrief[]): Promise<boolean> {
    if (!this.sender) {
      return false;
    }

    try {
      return await this.sender.sendMessage(this.formatAnomalyReport(anomalies));
    } catch (err) {
      log.warn('Ошибка отправки отчёта об аномалиях:', err);
      return false;
    }
  }

  /** Отправить алерт о статусе диспетчера. false — без sender или при ошибке. */
  async sendSchedulerAlert(status: SchedulerStatusInfo): Promise<boolean> {
    if (!this.sender) {
      return false;
    }

    try {
      return await this.sender.sendMessage(this.formatSchedulerAlert(status));
    } catch (err) {
      log.warn('Ошибка отправки алерта диспетчера:', err);
      return false;
    }
  }

  /**
   * Отправить произвольный текст сообщения.
   * Используется адаптерами с собственным форматированием
   * (например, PriceAlertNotifier). false — без sender или при ошибке.
   */
  async sendMessage(text: string): Promise<boolean> {
    if (!this.sender) {
      return false;
    }

    try {
      return await this.sender.sendMessage(text);
    } catch (err) {
      log.warn('Ошибка отправки сообщения:', err);
      return false;
    }
  }
}
