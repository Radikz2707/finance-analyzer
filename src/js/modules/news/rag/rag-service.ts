/**
 * RAGService — Retrieval Augmented Generation для Director.
 *
 * Перед ответом LLM ищет релевантные новости в векторном хранилище
 * и подставляет их в промпт как дополнительный контекст.
 *
 * Работает полностью на CPU, без внешних API.
 */

import { VectorStore } from './vector-store.js';
import type { NewsRecord } from '../../db-manager/types.js';

// ──────────────────────────────────────────────
// 1. Типы
// ──────────────────────────────────────────────

/** Результат RAG-поиска */
export interface RAGResult {
  /** Найденные новости */
  news: RAGNewsItem[];
  /** Сводка для промпта */
  context: string;
  /** Найдено ли что-то релевантное */
  hasRelevant: boolean;
}

/** Релевантная новость */
export interface RAGNewsItem {
  title: string;
  summary: string;
  date: string;
  source: string;
  ticker?: string;
  score: number;
}

// ──────────────────────────────────────────────
// 2. RAGService
// ──────────────────────────────────────────────

/** Опции RAGService */
export interface RAGServiceOptions {
  /** Векторное хранилище (DI для тестов) */
  vectorStore?: VectorStore;
  /** Максимальное количество найденных новостей */
  maxResults?: number;
}

export class RAGService {
  private readonly vectorStore: VectorStore;
  private readonly maxResults: number;

  constructor(options: RAGServiceOptions = {}) {
    this.vectorStore =
      options.vectorStore ?? new VectorStore();
    this.maxResults = options.maxResults ?? 5;
  }

  /**
   * Индексировать новость из БД.
   */
  indexNews(record: NewsRecord): void {
    const text = `${record.title} ${record.summary} ${record.relevanceToTicker ?? ''}`;
    this.vectorStore.add({
      id: String(record.id ?? `${record.date}-${record.title}`),
      text,
      metadata: {
        ticker: record.relevanceToTicker,
        source: record.source,
        date: record.date,
      },
    });
  }

  /**
   * Индексировать несколько новостей.
   */
  indexBatch(records: NewsRecord[]): void {
    for (const record of records) {
      this.indexNews(record);
    }
  }

  /**
   * Поиск релевантных новостей для вопроса.
   */
  search(question: string): RAGResult {
    const results = this.vectorStore.search(question, this.maxResults);

    if (results.length === 0) {
      return {
        news: [],
        context: '',
        hasRelevant: false,
      };
    }

    const news: RAGNewsItem[] = results.map((r) => ({
      title: r.entry.text.split(' ')[0] + '...', // Упрощённо
      summary: r.entry.text.slice(100),
      date: (r.entry.metadata.date as string) ?? '',
      source: (r.entry.metadata.source as string) ?? 'Unknown',
      ticker: r.entry.metadata.ticker as string | undefined,
      score: r.score,
    }));

    // Формируем контекст для промпта
    const context = this.buildContext(news);

    return {
      news,
      context,
      hasRelevant: true,
    };
  }

  /**
   * Построить контекст из найденных новостей для LLM-промпта.
   */
  private buildContext(news: RAGNewsItem[]): string {
    if (news.length === 0) return '';

    const lines = ['📰 Релевантные новости (из базы знаний):'];

    for (const item of news) {
      const tickerStr = item.ticker ? ` [${item.ticker}]` : '';
      lines.push(
        `- ${item.title}${tickerStr} (${item.source}, ${item.date})`,
      );
      if (item.summary) {
        lines.push(`  ${item.summary.slice(0, 200)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Получить дату последней индексированной новости.
   */
  getLatestIndexDate(): string | null {
    const latest = this.vectorStore.getLatest(1);
    if (latest.length === 0) return null;

    const entry = latest[0];
    if (!entry) return null;
    const date = entry.metadata.date as string | undefined;
    return date ?? null;
  }

  /**
   * Получить количество проиндексированных новостей.
   */
  indexedCount(): number {
    return this.vectorStore.count();
  }

  /**
   * Очистить индекс.
   */
  clear(): void {
    this.vectorStore.clear();
  }
}
