/**
 * NewsStrategyAdapter — корректировка инвестиционной стратегии по новостям.
 *
 * Правила (детерминированные, без LLM):
 * - критический негатив по тикеру → пересмотреть позицию
 *   (HOLD/null → REDUCE, BUY/AVERAGE → HOLD, SELL/EXIT/REDUCE остаются);
 * - высокий негатив → не усиливать позицию (BUY/AVERAGE → HOLD, null → HOLD);
 * - критический/высокий позитив → усилить тезис
 *   (HOLD/null → BUY, BUY → выше уверенность);
 * - обоснование дополняется ссылкой на новостной фон.
 */

import type { AiAction } from '../../research/types.js';
import type { NewsImpact, RecommendationLike } from './types.js';

/** Результат корректировки рекомендации */
export interface AdjustedRecommendation extends RecommendationLike {
  /** Была ли рекомендация изменена новостным фоном */
  adjustedByNews: boolean;
  /** Причины корректировки (человекочитаемые) */
  newsReasons: string[];
}

/**
 * Найти impact'ы, релевантные рекомендации.
 * Сначала — по тикерам, упомянутым в reasoning; если их нет —
 * учитывается весь портфельный новостной фон.
 */
export function relevantImpacts(
  rec: RecommendationLike,
  impacts: readonly NewsImpact[],
): NewsImpact[] {
  if (impacts.length === 0) return [];
  const mentioned = new Set<string>();
  const upperReasoning = rec.reasoning.toUpperCase();
  for (const impact of impacts) {
    if (upperReasoning.includes(impact.ticker.toUpperCase())) {
      mentioned.add(impact.ticker.toUpperCase());
    }
  }
  if (mentioned.size > 0) {
    return impacts.filter((i) => mentioned.has(i.ticker.toUpperCase()));
  }
  return [...impacts];
}

/** Корректировка рекомендации по новостному фону */
export function adjustRecommendation(
  rec: RecommendationLike,
  impacts: readonly NewsImpact[],
): AdjustedRecommendation {
  const relevant = relevantImpacts(rec, impacts);
  if (relevant.length === 0) {
    return { ...rec, adjustedByNews: false, newsReasons: [] };
  }

  const criticalNegative = relevant.filter(
    (i) => i.impactDirection === 'negative' && i.importance === 'critical',
  );
  const highNegative = relevant.filter(
    (i) => i.impactDirection === 'negative' && i.importance === 'high',
  );
  const strongPositive = relevant.filter(
    (i) =>
      i.impactDirection === 'positive' &&
      (i.importance === 'critical' || i.importance === 'high'),
  );

  let action: AiAction | null = rec.action;
  let confidence = rec.confidence;
  const newsReasons: string[] = [];

  if (criticalNegative.length > 0) {
    const impact = criticalNegative[0]!;
    if (action === 'BUY' || action === 'AVERAGE') {
      action = 'HOLD';
      newsReasons.push(
        `Критический негатив по ${impact.ticker} (${impact.reasoning}) — покупка/усреднение приостановлены.`,
      );
    } else if (action === 'HOLD' || action === null) {
      action = 'REDUCE';
      newsReasons.push(
        `Критический негатив по ${impact.ticker} (${impact.reasoning}) — позицию стоит пересмотреть.`,
      );
    } else {
      newsReasons.push(
        `Критический негатив по ${impact.ticker} подтверждает решение «${action}».`,
      );
    }
    confidence = Math.min(confidence, 0.7);
  } else if (highNegative.length > 0) {
    const impact = highNegative[0]!;
    if (action === 'BUY' || action === 'AVERAGE') {
      action = 'HOLD';
      newsReasons.push(
        `Негативный новостной фон по ${impact.ticker} — усиление позиции не рекомендуется.`,
      );
    } else if (action === null) {
      action = 'HOLD';
      newsReasons.push(
        `Негативный новостной фон по ${impact.ticker} — осторожная позиция.`,
      );
    } else {
      newsReasons.push(
        `Негативный новостной фон по ${impact.ticker} учтён в решении «${action}».`,
      );
    }
  }

  if (strongPositive.length > 0) {
    const impact = strongPositive[0]!;
    if (action === 'HOLD' || action === null) {
      action = 'BUY';
      newsReasons.push(
        `Позитивный новостной фон по ${impact.ticker} (${impact.reasoning}) — тезис усилен.`,
      );
    } else if (action === 'BUY') {
      confidence = Math.min(confidence + 0.05, 0.95);
      newsReasons.push(
        `Позитивный новостной фон по ${impact.ticker} повышает уверенность в покупке.`,
      );
    } else {
      newsReasons.push(
        `Позитивный новостной фон по ${impact.ticker} учтён в решении «${action}».`,
      );
    }
  }

  if (newsReasons.length === 0) {
    return { ...rec, adjustedByNews: false, newsReasons: [] };
  }

  const reasoning =
    rec.reasoning + '\n\n📰 Новостной фон: ' + newsReasons.join(' ');
  return {
    action,
    confidence: Math.round(confidence * 100) / 100,
    reasoning,
    adjustedByNews: true,
    newsReasons,
  };
}
