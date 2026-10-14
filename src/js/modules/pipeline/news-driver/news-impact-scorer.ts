/**
 * NewsImpactScorer — оценка влияния новостей на актив.
 *
 * Формула: impact = |сентимент| × важность × релевантность.
 * - сентимент: positive=+1, negative=-1, neutral/unknown=0 (взвешенно по важности);
 * - важность: critical=1.0, high=0.75, medium=0.5, low=0.25, noise=0.1;
 * - релевантность: тикер в списке новости = 1.0, упоминание в тексте = 0.5, иначе 0.
 *
 * Детерминированный, без LLM и без внешних зависимостей (DI-чистый).
 */

import type { AiAction } from '../../research/types.js';
import type {
  CachedNewsItem,
  NewsImportance,
  NewsSentiment,
} from '../gatekeeper/news-cache.js';
import type { ImpactDirection, NewsImpact } from './types.js';

/** Вес важности новости */
export const IMPORTANCE_WEIGHTS: Record<NewsImportance, number> = {
  critical: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
  noise: 0.1,
};

/** Ранг важности (для сравнения) */
export const IMPORTANCE_RANK: Record<NewsImportance, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  noise: 0,
};

/** Порог направления влияния (|сентимент| выше — направленный фон) */
export const DIRECTION_THRESHOLD = 0.15;

/** Числовое значение сентимента */
export function sentimentValue(sentiment: NewsSentiment): number {
  switch (sentiment) {
    case 'positive':
      return 1;
    case 'negative':
      return -1;
    default:
      return 0;
  }
}

/** Ключевые слова → затронутые метрики */
const METRIC_KEYWORDS: ReadonlyArray<{ keywords: string[]; metric: string }> = [
  { keywords: ['дивиденд', 'выкуп', 'buyback'], metric: 'дивиденды' },
  {
    keywords: ['санкц', 'рестрикц', 'блокировк', 'конфискаци'],
    metric: 'санкционные риски',
  },
  {
    keywords: ['отчёт', 'прибыль', 'выручк', 'ebitda', 'чистая прибыль'],
    metric: 'финансовые результаты',
  },
  { keywords: ['ставка', 'цб', 'ключевая'], metric: 'ключевая ставка' },
  { keywords: ['дефолт', 'банкрот', 'долг'], metric: 'кредитный риск' },
  {
    keywords: ['суд', 'арест', 'расслед', 'штраф'],
    metric: 'регуляторные риски',
  },
  {
    keywords: ['контракт', 'сделк', 'поглощ', 'слиян', 'ipo', 'spo'],
    metric: 'корпоративные события',
  },
  {
    keywords: ['цена', 'котировк', 'акци', 'рост', 'паден'],
    metric: 'цена акции',
  },
  {
    keywords: ['прогноз', 'рейтинг', 'аналитик'],
    metric: 'аналитические оценки',
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Нормализовать важность из данных кэша (защита от некорректных значений) */
function normalizeImportance(value: unknown): NewsImportance {
  if (
    value === 'critical' ||
    value === 'high' ||
    value === 'medium' ||
    value === 'low' ||
    value === 'noise'
  ) {
    return value;
  }
  return 'noise';
}

/** Собрать затронутые метрики из текста новостей */
export function collectAffectedMetrics(
  news: readonly CachedNewsItem[],
): string[] {
  const found = new Set<string>();
  const text = news
    .map((n) => `${n.title} ${n.description}`)
    .join(' ')
    .toLowerCase();
  for (const { keywords, metric } of METRIC_KEYWORDS) {
    if (keywords.some((k) => text.includes(k))) found.add(metric);
  }
  return [...found];
}

/** Эвристика предлагаемого действия по направлению и важности */
export function suggestAction(
  direction: ImpactDirection,
  importance: NewsImportance,
): AiAction | null {
  if (direction === 'negative') {
    if (importance === 'critical') return 'REDUCE';
    if (importance === 'high') return 'HOLD';
    return null;
  }
  if (direction === 'positive') {
    if (importance === 'critical' || importance === 'high') return 'BUY';
    return null;
  }
  return null;
}

/** Ошибка NewsImpactScorer */
export class NewsImpactScorerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NewsImpactScorerError';
  }
}

/**
 * Скорер влияния новостей на актив.
 */
export class NewsImpactScorer {
  /**
   * Оценить влияние новостного фона на один тикер.
   * Возвращает null, если новостей нет или релевантность нулевая.
   */
  scoreTicker(
    ticker: string,
    news: readonly CachedNewsItem[],
  ): NewsImpact | null {
    if (!Array.isArray(news) || news.length === 0) {
      throw new NewsImpactScorerError(
        'scoreTicker(): ожидается непустой массив новостей',
      );
    }
    if (typeof ticker !== 'string' || ticker.trim().length === 0) {
      throw new NewsImpactScorerError(
        'scoreTicker(): тикер не может быть пустым',
      );
    }

    let sentimentSum = 0;
    let weightSum = 0;
    let maxImportance: NewsImportance = 'noise';
    const headlines: string[] = [];

    for (const item of news) {
      const relevance = this.computeRelevance(ticker, item);
      if (relevance <= 0) continue;
      const importance = normalizeImportance(item.importance);
      const weight = IMPORTANCE_WEIGHTS[importance] * relevance;
      sentimentSum += sentimentValue(item.sentiment) * weight;
      weightSum += weight;
      if (IMPORTANCE_RANK[importance] > IMPORTANCE_RANK[maxImportance]) {
        maxImportance = importance;
      }
      headlines.push(item.title);
    }

    if (weightSum <= 0) return null;

    const sentimentScore = round(clamp(sentimentSum / weightSum, -1, 1));
    const impactScore = round(
      Math.abs(sentimentScore) * IMPORTANCE_WEIGHTS[maxImportance],
    );
    const impactDirection: ImpactDirection =
      sentimentScore > DIRECTION_THRESHOLD
        ? 'positive'
        : sentimentScore < -DIRECTION_THRESHOLD
          ? 'negative'
          : 'neutral';
    const affectedMetrics = collectAffectedMetrics(news);
    const suggestedAction = suggestAction(impactDirection, maxImportance);
    const reasoning = this.buildReasoning(
      ticker,
      sentimentScore,
      maxImportance,
      news.length,
    );

    return {
      ticker,
      sentimentScore,
      importance: maxImportance,
      impactDirection,
      affectedMetrics,
      suggestedAction,
      headlines: headlines.slice(0, 5),
      impactScore,
      reasoning,
    };
  }

  /** Релевантность новости тикеру: 1.0 — в списке, 0.5 — в тексте, 0 — нет */
  private computeRelevance(ticker: string, item: CachedNewsItem): number {
    const upper = ticker.toUpperCase();
    if (item.tickers.some((t) => t.toUpperCase() === upper)) return 1;
    const text = `${item.title} ${item.description}`.toUpperCase();
    return text.includes(upper) ? 0.5 : 0;
  }

  private buildReasoning(
    ticker: string,
    sentimentScore: number,
    importance: NewsImportance,
    newsCount: number,
  ): string {
    const directionLabel =
      sentimentScore > DIRECTION_THRESHOLD
        ? 'позитивный'
        : sentimentScore < -DIRECTION_THRESHOLD
          ? 'негативный'
          : 'нейтральный';
    return (
      `Новостной фон по ${ticker}: ${directionLabel} (сентимент ${sentimentScore.toFixed(2)}), ` +
      `максимальная важность «${importance}», учтено новостей: ${newsCount}.`
    );
  }
}
