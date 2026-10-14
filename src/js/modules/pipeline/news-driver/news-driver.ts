/**
 * NewsDriver — фасад: новости как активный драйвер прогноза/оценки/корректировки.
 *
 * - analyzePortfolio(facts, newsCache) → NewsImpact[] — оценка влияния новостей
 *   на активы портфеля;
 * - buildNewsContext(impacts) → string — LLM-контекст;
 * - buildContext(impacts) → NewsDriverContext — структурированный контекст
 *   (для UI/аудита);
 * - adjustRecommendation(rec, impacts) → rec — корректировка рекомендации.
 *
 * DI-чистый: все зависимости (скорер) инжектируются; кэш новостей передаётся
 * в analyzePortfolio (структурный контракт NewsCacheLike).
 */

import { NewsImpactScorer } from './news-impact-scorer.js';
import { adjustRecommendation } from './news-strategy-adapter.js';
import type {
  NewsCacheLike,
  NewsDriverContext,
  NewsImpact,
  PortfolioFactsLike,
  RecommendationLike,
} from './types.js';

/** Лимит новостей на тикер при анализе */
export const DEFAULT_NEWS_PER_TICKER = 10;

/** Порог impact-скоринга для включения в контекст */
export const MIN_IMPACT_SCORE = 0.1;

/** Опции NewsDriver (DI) */
export interface NewsDriverOptions {
  scorer?: NewsImpactScorer;
  newsPerTicker?: number;
}

export class NewsDriver {
  private readonly scorer: NewsImpactScorer;
  private readonly newsPerTicker: number;

  constructor(options: NewsDriverOptions = {}) {
    this.scorer = options.scorer ?? new NewsImpactScorer();
    this.newsPerTicker = Math.max(
      1,
      options.newsPerTicker ?? DEFAULT_NEWS_PER_TICKER,
    );
  }

  /** Оценить влияние новостного фона на активы портфеля. */
  analyzePortfolio(
    facts: PortfolioFactsLike,
    newsCache: NewsCacheLike,
  ): NewsImpact[] {
    if (!facts || !Array.isArray(facts.assetsAnalysis)) return [];
    const impacts: NewsImpact[] = [];
    for (const asset of facts.assetsAnalysis) {
      if (
        !asset ||
        typeof asset.ticker !== 'string' ||
        asset.ticker.length === 0
      ) {
        continue;
      }
      const news = newsCache.getByTicker(asset.ticker, this.newsPerTicker);
      if (news.length === 0) continue;
      const impact = this.scorer.scoreTicker(asset.ticker, news);
      if (impact && impact.impactScore >= MIN_IMPACT_SCORE) {
        impacts.push(impact);
      }
    }
    return impacts;
  }

  /** Построить LLM-контекст из impact'ов (пустая строка, если фон нейтрален). */
  buildNewsContext(impacts: readonly NewsImpact[]): string {
    if (impacts.length === 0) return '';
    const lines: string[] = ['📰 Новостной фон по портфелю:'];
    for (const impact of impacts) {
      const directionIcon =
        impact.impactDirection === 'positive'
          ? '📈'
          : impact.impactDirection === 'negative'
            ? '📉'
            : '➡️';
      lines.push(
        `${directionIcon} ${impact.ticker}: ${impact.impactDirection} ` +
          `(сентимент ${impact.sentimentScore.toFixed(2)}, важность «${impact.importance}», ` +
          `score ${impact.impactScore.toFixed(2)}).`,
      );
      if (impact.affectedMetrics.length > 0) {
        lines.push(`   Затронуто: ${impact.affectedMetrics.join(', ')}.`);
      }
      if (impact.suggestedAction) {
        lines.push(`   Предлагаемое действие: ${impact.suggestedAction}.`);
      }
      if (impact.headlines.length > 0) {
        lines.push(`   Источники: ${impact.headlines.slice(0, 2).join(' | ')}`);
      }
    }
    return lines.join('\n');
  }

  /** Построить структурированный контекст (для UI/аудита). */
  buildContext(impacts: readonly NewsImpact[]): NewsDriverContext {
    const criticalSignals = impacts
      .filter((i) => i.importance === 'critical' || i.importance === 'high')
      .map(
        (i) =>
          `${i.ticker}: ${i.impactDirection} (${i.sentimentScore.toFixed(2)}), важность «${i.importance}»`,
      );
    return {
      impacts: [...impacts],
      summary: this.buildNewsContext(impacts),
      criticalSignals,
    };
  }

  /** Скорректировать рекомендацию по новостному фону. */
  adjustRecommendation(
    rec: RecommendationLike,
    impacts: readonly NewsImpact[],
  ): RecommendationLike {
    return adjustRecommendation(rec, impacts);
  }
}
