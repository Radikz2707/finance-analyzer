/**
 * ProactiveSuggester — проактивные сообщения Director.
 *
 * Director работает не только реактивно: при появлении важного повода
 * система сама инициирует человеческое сообщение пользователю:
 * - существенное изменение рынка;
 * - важная новость по активу;
 * - изменение инвестиционного тезиса;
 * - сильное отклонение структуры портфеля;
 * - новый риск;
 * - необходимость проверить отложенный вопрос;
 * - обнаружение противоречия с прошлыми решениями.
 */

import type {
  DirectorStrategicMemory,
  ProactiveMessage,
  ProactiveMessageType,
} from './director-types.js';
import type { DirectorFactsContext } from './director-types.js';

/** Входные данные проактивного сканирования */
export interface ProactiveSuggestionInput {
  facts: DirectorFactsContext;
  strategicMemory: DirectorStrategicMemory[];
  userName?: string;
  /** Максимум сообщений за одно сканирование */
  limit?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const NEGATIVE_RISK_HINTS = [
  'санкци',
  'геополитик',
  'конфискаци',
  'блокировк',
  'дефолт',
  'кризис',
];

/**
 * Проактивный сканер: находит поводы для обращения Director к пользователю.
 */
export class ProactiveSuggester {
  /**
   * Сформировать список проактивных сообщений по текущим фактам и памяти.
   */
  suggest(input: ProactiveSuggestionInput): ProactiveMessage[] {
    const facts = input.facts;
    const userName = input.userName ?? 'Радик';
    const limit = input.limit ?? 5;
    const messages: ProactiveMessage[] = [];

    // 1. Структурное отклонение / концентрация
    for (const asset of facts.assetsAnalysis) {
      if ((asset.currentPercent ?? 0) > 25) {
        messages.push(
          this.message(
            'structure-deviation',
            `Концентрация по ${asset.name ?? asset.ticker}`,
            `${userName}, я заметил, что доля ${asset.name ?? asset.ticker} ` +
              `(${(asset.currentPercent ?? 0).toFixed(1)}%) заметно превышает разумный уровень. ` +
              'Предлагаю обсудить, стоит ли сокращать позицию.',
            asset.ticker,
            'high',
          ),
        );
      }
    }

    // 2. Ценовые алерты / рыночные изменения
    for (const alert of facts.priceAlerts ?? []) {
      messages.push(
        this.message(
          'market-change',
          `Изменение цены: ${alert.ticker}`,
          `${userName}, по ${alert.name ?? alert.ticker} сработал ценовой сигнал ` +
            `(${alert.alertLevel ?? 'alert'}). Возможно, тезис стоит пересмотреть.`,
          alert.ticker,
          'high',
        ),
      );
    }

    // 3. Новый риск в новостях
    const news = (facts.newsContext ?? '').toLowerCase();
    if (NEGATIVE_RISK_HINTS.some((h) => news.includes(h))) {
      messages.push(
        this.message(
          'new-risk',
          'Новые риски в новостном фоне',
          `${userName}, в новостях появились сигналы риска. ` +
            'Я считаю, что имеет смысл обсудить это на консилиуме.',
          undefined,
          'high',
        ),
      );
    }

    // 4. Отложенные вопросы из стратегической памяти
    const pending = input.strategicMemory.filter(
      (e) => e.status === 'active' && this.isPendingType(e.type),
    );
    for (const item of pending.slice(0, 2)) {
      const ageDays = this.ageDays(item.createdAt);
      if (ageDays >= 3) {
        messages.push(
          this.message(
            'pending-review',
            'Пора вернуться к отложенному вопросу',
            `${userName}, мы отложили вопрос ${ageDays} дн. назад: ` +
              `«${item.content.slice(0, 100)}». Предлагаю вернуться к нему.`,
            item.ticker,
            'normal',
          ),
        );
      }
    }

    // 5. Противоречие с прошлыми решениями
    const decisions = input.strategicMemory.filter(
      (e) => e.type === 'strategic-decision' && e.status === 'active',
    );
    for (const decision of decisions) {
      if (!decision.ticker) continue;
      const asset = facts.assetsAnalysis.find(
        (a) => a.ticker.toUpperCase() === decision.ticker!.toUpperCase(),
      );
      if (!asset) continue;
      const lostBig =
        asset.balancePrice &&
        asset.balancePrice > 0 &&
        asset.currentPrice &&
        asset.currentPrice < asset.balancePrice * 0.7;
      const saidHold = /удерживать|HOLD|не менять/i.test(decision.content);
      if (saidHold && lostBig) {
        messages.push(
          this.message(
            'contradiction',
            `Противоречие по ${decision.ticker}`,
            `${userName}, ранее мы решили удерживать ${decision.ticker}, ` +
              'но текущие факты существенно изменились. ' +
              'Предлагаю пересмотреть это решение.',
            decision.ticker,
            'normal',
          ),
        );
      }
    }

    // 6. Возможность выравнивания структуры (свободные средства)
    const mostDeficit = [...facts.assetsAnalysis].sort(
      (a, b) => (b.deficitRub ?? 0) - (a.deficitRub ?? 0),
    )[0];
    if (
      mostDeficit &&
      (mostDeficit.deficitRub ?? 0) > 5000 &&
      facts.freeCashRub > 5000
    ) {
      messages.push(
        this.message(
          'opportunity',
          `Возможность: ${mostDeficit.ticker}`,
          `${userName}, у нас есть свободные средства и дефицит по ` +
            `${mostDeficit.name ?? mostDeficit.ticker} (~${Math.round(
              mostDeficit.deficitRub ?? 0,
            )} ₽). Можно выровнять структуру.`,
          mostDeficit.ticker,
          'normal',
        ),
      );
    }

    // Дедупликация по (type, ticker)
    const seen = new Set<string>();
    const unique = messages.filter((m) => {
      const key = `${m.type}:${m.ticker ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique.slice(0, limit);
  }

  // ── Helpers ──

  private message(
    type: ProactiveMessageType,
    title: string,
    content: string,
    ticker: string | undefined,
    priority: ProactiveMessage['priority'],
  ): ProactiveMessage {
    return {
      id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      title,
      content,
      ticker,
      priority,
      createdAt: new Date().toISOString(),
      read: false,
    };
  }

  private isPendingType(type: DirectorStrategicMemory['type']): boolean {
    return (
      type === 'pending-decision' ||
      type === 'unresolved-question' ||
      type === 'future-task'
    );
  }

  private ageDays(iso: string): number {
    const created = new Date(iso).getTime();
    if (Number.isNaN(created)) return 0;
    return Math.floor((Date.now() - created) / DAY_MS);
  }
}
