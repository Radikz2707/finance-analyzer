/**
 * News Collector — главный класс сбора и обработки новостей.
 *
 * Объединяет все источники, применяет фильтрацию, NLP-анализ и приоритизацию.
 * Работает в pipeline и desktop без изменений.
 */

import { TickerMonitor } from '../news-data-loader.js';
import { MoexNewsSource, RssNewsSource, type RawNewsItem } from '../sources/index.js';
import { SentimentAnalyzer } from '../nlp/sentiment-analyzer.js';
import { config as newsConfig } from '../news-config.js';
import type { SentimentResult } from '../nlp/sentiment-analyzer.js';

/** Обработанная новость */
export interface ProcessedNewsItem {
  /** Сырая новость */
  raw: RawNewsItem;
  /** Результат анализа сентимента */
  sentiment: SentimentResult;
  /** Релевантность тикеру (0.0 — 1.0) */
  relevance: number;
  /** Приоритет (1-10) */
  priority: number;
}

/** Результат сбора новостей */
export interface NewsCollectionResult {
  /** Список обработанных новостей */
  items: ProcessedNewsItem[];
  /** Статистика сбора */
  stats: {
    totalFetched: number;
    totalProcessed: number;
    sourcesUsed: number;
    sourcesFailed: number;
    averageSentiment: number;
  };
}

/** News Collector */
export class NewsCollector {
  private tickerMonitor = new TickerMonitor();
  private sentimentAnalyzer = new SentimentAnalyzer();
  private sources: Array<MoexNewsSource | RssNewsSource> = [];

  constructor() {
    this.initSources();
  }

  /**
   * Инициализация источников.
   */
  private initSources(): void {
    this.sources = [
      new MoexNewsSource(),
      new RssNewsSource(),
    ];
  }

  /**
   * Сбор новостей.
   * Graceful degradation: если тикеры портфеля недоступны,
   * собирает общие рыночные новости без фильтрации по тикерам.
   */
  async collect(): Promise<NewsCollectionResult> {
    // 1. Получение тикеров из портфеля
    const tickerList = this.tickerMonitor.getMonitoredTickers();
    const hasTickers = tickerList.length > 0;

    // 2. Параллельный сбор из всех источников
    const results = await Promise.allSettled(
      this.sources.map((source) => source.fetch(tickerList)),
    );

    // 3. Агрегация результатов
    const allItems: RawNewsItem[] = [];
    let sourcesUsed = 0;
    let sourcesFailed = 0;
    let totalFetched = 0;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const res = result.value;
        if (res.count > 0) {
          allItems.push(...res.items);
          totalFetched += res.count;
          sourcesUsed++;
        } else {
          sourcesFailed++;
        }
      } else {
        sourcesFailed++;
      }
    }

    // 4. Дедупликация
    const deduped = this.deduplicate(allItems);

    // 5. NLP-анализ
    const analyzed = await this.analyzeSentiment(deduped);

    // 6. Расчёт релевантности и фильтрация
    // Если тикеры есть — фильтруем по релевантности.
    // Если тикеров нет — показываем все новости (общий рыночный фон).
    const filtered = hasTickers
      ? this.filterByRelevance(analyzed, tickerList)
      : analyzed.map((item) => ({
          ...item,
          relevance: this.calculateRelevance(item, tickerList),
        }));

    // 7. Приоритизация
    const tickerObjects = tickerList.map((t) => ({ ticker: t, weight: 1 }));
    const prioritized = this.prioritize(filtered, tickerObjects);

    // 8. Ограничение по лимиту
    const limited = prioritized.slice(0, newsConfig.NEWS_MAX_ITEMS_PER_COLLECTION);

    // 9. Вычисление статистики
    const averageSentiment = limited.length > 0
      ? limited.reduce((sum, item) => sum + item.sentiment.score, 0) / limited.length
      : 0;

    return {
      items: limited.map((item) => ({
        raw: item,
        sentiment: item.sentiment,
        relevance: item.relevance,
        priority: item.priority,
      })),
      stats: {
        totalFetched,
        totalProcessed: limited.length,
        sourcesUsed,
        sourcesFailed,
        averageSentiment,
      },
    };
  }

  /**
   * Дедупликация новостей по URL.
   */
  private deduplicate(items: RawNewsItem[]): RawNewsItem[] {
    const seenUrls = new Set<string>();
    return items.filter((item) => {
      if (seenUrls.has(item.url)) return false;
      seenUrls.add(item.url);
      return true;
    });
  }

  /**
   * NLP-анализ сентимента.
   */
  private async analyzeSentiment(
    items: RawNewsItem[],
  ): Promise<Array<RawNewsItem & { sentiment: SentimentResult }>> {
    const promises = items.map(async (item) => {
      const sentiment = await this.sentimentAnalyzer.analyze(
        item.title,
        item.summary,
      );
      return {
        ...item,
        sentiment,
      };
    });

    return Promise.all(promises);
  }

  /**
   * Фильтрация по релевантности.
   */
  private filterByRelevance(
    items: Array<RawNewsItem & { sentiment: SentimentResult }>,
    tickers: string[],
  ): Array<RawNewsItem & { sentiment: SentimentResult; relevance: number }> {
    return items
      .map((item) => {
        const relevance = this.calculateRelevance(item, tickers);
        return {
          ...item,
          relevance,
        };
      })
      .filter((item) => item.relevance >= newsConfig.NEWS_RELEVANCE_THRESHOLD);
  }

  /**
   * Расчёт релевантности новости.
   * Использует точное совпадение ticker как отдельного слова (word boundary).
   */
  private calculateRelevance(
    item: RawNewsItem,
    tickers: string[],
  ): number {
    if (tickers.length === 0) return 0;

    const text = `${item.title} ${item.summary}`.toLowerCase();
    let score = 0;

    for (const ticker of tickers) {
      // Точное совпадение ticker как отдельного слова
      const pattern = new RegExp(`\\b${ticker.toLowerCase()}\\b`);
      if (pattern.test(text)) {
        score += 0.5;
      }
    }

    return Math.min(1, score);
  }

  /**
   * Приоритизация новостей.
   */
  private prioritize(
    items: Array<RawNewsItem & { sentiment: SentimentResult; relevance: number }>,
    _tickers: Array<{ ticker: string; weight: number }>,
  ): Array<RawNewsItem & { sentiment: SentimentResult; relevance: number; priority: number }> {
    return items.map((item) => {
      // Базовый приоритет на основе сентимента
      let priority = 5;
      if (item.sentiment.score > 0.5) priority += 2;
      if (item.sentiment.score < -0.5) priority += 3;

      // Увеличение приоритета для высоко-релевантных новостей
      priority += Math.floor(item.relevance * 3);

      return {
        ...item,
        priority: Math.min(10, priority),
      };
    });
  }
}
