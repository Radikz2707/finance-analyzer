/**
 * NewsProvider — поставщик новостных данных для research.
 *
 * Архитектура:
 *   NewsFetcher → сырые новости → normalizeNews() → NewsItem[] → NewsResearch → ResearchEvidence
 *
 * Источник: Google News RSS (публичный, без API key)
 *
 * НЕ генерирует AI-рекомендации.
 * НЕ создаёт InvestmentThesis.
 * НЕ придумывает sentiment при отсутствии данных.
 * Если данных нет → NO_DATA + diagnostic.
 */

import type {
  ResearchProvider,
  ResearchAsset,
  ResearchContext,
} from './types.js';
import type { AssetResearchSnapshot, ResearchEvidence, NewsItem, NewsImportance, NewsSentiment } from '../types.js';
import { NewsFetcher, type RawNewsItem } from './news-fetcher.js';

// ──────────────────────────────────────────────
// 1. Кэш на один запуск
// ──────────────────────────────────────────────

/** Запись кэша */
interface NewsCacheEntry {
  items: RawNewsItem[];
  fetchedAt: string;
}

class NewsCache {
  private store = new Map<string, NewsCacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) { // 5 минут
    this.ttlMs = ttlMs;
  }

  get(ticker: string): RawNewsItem[] | null {
    const entry = this.store.get(ticker);
    if (!entry) return null;

    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (age > this.ttlMs) {
      this.store.delete(ticker);
      return null;
    }

    return entry.items;
  }

  set(ticker: string, items: RawNewsItem[]): void {
    this.store.set(ticker, {
      items,
      fetchedAt: new Date().toISOString(),
    });
  }

  clear(): void {
    this.store.clear();
  }
}

// ──────────────────────────────────────────────
// 2. Provider
// ──────────────────────────────────────────────

export class NewsResearchProvider implements ResearchProvider {
  private readonly fetcher: NewsFetcher;
  private readonly cache: NewsCache;

  constructor(
    fetcher?: NewsFetcher,
    cacheTtlMs?: number,
  ) {
    this.fetcher = fetcher ?? new NewsFetcher();
    this.cache = new NewsCache(cacheTtlMs);
  }

  /** Поддерживает только STOCK */
  supports(asset: ResearchAsset): boolean {
    return asset.assetType === 'STOCK';
  }

  async research(
    asset: ResearchAsset,
    _context: ResearchContext,
  ): Promise<AssetResearchSnapshot> {
    const evidence: Record<string, ResearchEvidence> = {};
    const fetchedAt = new Date().toISOString();

    // Этап 1: fetchRaw (с кэшем)
    const rawItems = await this.fetchRaw(asset.ticker, asset.name, asset.issuer);

    // Если нет данных — возвращаем NO_DATA snapshot
    if (rawItems.length === 0) {
      return {
        identity: this.buildIdentity(asset),
        evidence,
      };
    }

    // Этап 2: normalize + filter relevance
    const normalizedItems = this.normalizeNews(rawItems, asset, fetchedAt);

    // Если после фильтрации ничего не осталось — NO_DATA
    if (normalizedItems.length === 0) {
      return {
        identity: this.buildIdentity(asset),
        evidence,
      };
    }

    // Этап 3: build evidence для каждой новости
    const evidenceIds: string[] = [];
    for (const item of normalizedItems) {
      const ev = this.createNewsEvidence(item, fetchedAt);
      evidence[ev.id] = ev;
      evidenceIds.push(ev.id);
    }

    // Этап 4: NewsResearch
    const newsResearch = { items: normalizedItems };

    return {
      identity: this.buildIdentity(asset),
      newsResearch,
      evidence,
    };
  }

  // ───────────────────────────────────────────
  // Этап 1: fetchRaw
  // ───────────────────────────────────────────

  private async fetchRaw(
    ticker: string,
    name: string,
    issuer: string,
  ): Promise<RawNewsItem[]> {
    // Проверка кэша
    const cached = this.cache.get(ticker);
    if (cached) return cached;

    // Формируем поисковый запрос
    const query = this.buildQuery(ticker, name, issuer);

    // Запрос к источнику
    let result: import('./news-fetcher.js').FetchResult;
    try {
      result = await this.fetcher.fetch(query);
    } catch {
      // Ошибка сети/парсинга → пустой результат
      return [];
    }

    // Обработка ошибок источника
    if (!result.success) {
      return [];
    }

    // Сохранение в кэш
    this.cache.set(ticker, result.items);

    return result.items;
  }

  // ───────────────────────────────────────────
  // Этап 2: normalize + relevance filter
  // ───────────────────────────────────────────

  /**
   * Нормализует сырые новости в NewsItem[].
   * Фильтрует по релевантности эмитенту.
   * Удаляет дубликаты по URL.
   */
  private normalizeNews(
    rawItems: RawNewsItem[],
    asset: ResearchAsset,
    _fetchedAt: string,
  ): NewsItem[] {
    // Удаляем дубликаты по URL
    const seenUrls = new Set<string>();
    const uniqueItems = rawItems.filter((item) => {
      if (seenUrls.has(item.link)) return false;
      seenUrls.add(item.link);
      return true;
    });

    // Фильтруем по релевантности
    const relevantItems = uniqueItems.filter((item) => {
      const { score } = this.computeRelevance(item, asset);
      return score > 0;
    });

    // Нормализуем в NewsItem[]
    return relevantItems.map((item) => {
      const { score } = this.computeRelevance(item, asset);
      const importance = this.computeImportance(item, score);
      const sentiment = this.computeSentiment(item);

      return {
        title: item.title,
        date: this.normalizeDate(item.date),
        source: item.source || 'Google News',
        url: item.link,
        importance,
        sentiment,
        summary: item.description || item.title,
        relevanceToIssuer: Math.min(score, 1),
      };
    });
  }

  // ───────────────────────────────────────────
  // Релевантность
  // ───────────────────────────────────────────

  /**
   * Вычисляет релевантность новости эмитенту.
   *
   * Критерии (score 0..1):
   * - Точное совпадение ticker в заголовке: +0.5
   * - Точное совпадение ticker в описании: +0.3
   * - Совпадение имени эмитента в заголовке: +0.3
   * - Совпадение имени эмитента в описании: +0.15
   * - Имя источника содержит название биржи/финансы: +0.1
   *
   * Минимальный порог: score > 0
   */
  private computeRelevance(
    item: RawNewsItem,
    asset: ResearchAsset,
  ): { score: number; reason: string } {
    const title = item.title.toLowerCase();
    const description = item.description.toLowerCase();
    // source не используется — только title и description
    const ticker = asset.ticker.toLowerCase();
    const name = (asset.name || '').toLowerCase();
    const issuer = (asset.issuer || '').toLowerCase();

    let score = 0;
    const reasons: string[] = [];

    // Точное совпадение ticker в заголовке (слово целиком)
    if (new RegExp(`\\b${ticker}\\b`, 'i').test(title)) {
      score += 0.5;
      reasons.push(`ticker "${asset.ticker}" in title`);
    }

    // Ticker в описании
    if (new RegExp(`\\b${ticker}\\b`, 'i').test(description)) {
      score += 0.3;
      reasons.push(`ticker "${asset.ticker}" in description`);
    }

    // Имя эмитента в заголовке
    if (name && title.includes(name)) {
      score += 0.3;
      reasons.push('issuer name in title');
    }

    // Имя эмитента в описании
    if (issuer && description.includes(issuer)) {
      score += 0.15;
      reasons.push('issuer name in description');
    }

    return { score: Math.min(score, 1), reason: reasons.join('; ') || 'no match' };
  }

  // ───────────────────────────────────────────
  // Importance
  // ───────────────────────────────────────────

  /**
   * Определяет важность новости.
   * НЕ основана на sentiment — только на релевантности и содержании.
   */
  private computeImportance(
    item: RawNewsItem,
    relevanceScore: number,
  ): NewsImportance {
    const title = item.title.toLowerCase();

    // Критические слова
    const criticalKeywords = ['банкрот', 'дефолт', 'санкц', 'запрет', 'экспорти', 'embargo', 'fine', 'penalt', 'raid'];
    const highKeywords = ['прибыл', 'дивиденд', 'покупк', 'продаж', 'слиян', 'акци', 'эмисси', 'growth', 'earnings'];
    const mediumKeywords = ['отчёт', 'план', 'стратег', 'инвестиц', 'расшир', 'contract', 'deal', 'agreement'];

    const hasCritical = criticalKeywords.some((kw) => title.includes(kw));
    const hasHigh = highKeywords.some((kw) => title.includes(kw));
    const hasMedium = mediumKeywords.some((kw) => title.includes(kw));

    if (hasCritical || relevanceScore > 0.7) {
      return 'HIGH';
    }

    if (hasHigh || relevanceScore > 0.4) {
      return 'MEDIUM';
    }

    if (hasMedium) {
      return 'MEDIUM';
    }

    // Низкая релевантность → LOW
    if (relevanceScore < 0.3) {
      return 'LOW';
    }

    return 'MEDIUM';
  }

  // ───────────────────────────────────────────
  // Sentiment
  // ───────────────────────────────────────────

  /**
   * Определяет тональность новости.
   *
   * ВАЖНО: НЕ придумываем sentiment при отсутствии данных.
   * Если не можем определить — UNKNOWN.
   */
  private computeSentiment(item: RawNewsItem): NewsSentiment {
    const title = item.title.toLowerCase();
    const description = item.description.toLowerCase();
    const text = `${title} ${description}`;

    const positiveKeywords = ['рост', 'прибыл', 'профицит', 'успех', 'upgrade', 'growth', 'profit', 'gain', 'optim'];
    const negativeKeywords = ['паде', 'убыток', 'убытк', 'кризис', 'банкрот', 'дефолт', 'санкц', 'fine', 'penalt', 'downgrad', 'loss', 'crisis', 'decline', 'risk'];

    let posCount = 0;
    let negCount = 0;

    for (const kw of positiveKeywords) {
      if (text.includes(kw)) posCount++;
    }

    for (const kw of negativeKeywords) {
      if (text.includes(kw)) negCount++;
    }

    if (posCount > negCount) return 'POSITIVE';
    if (negCount > posCount) return 'NEGATIVE';
    return 'UNKNOWN';
  }

  // ───────────────────────────────────────────
  // Дата
  // ───────────────────────────────────────────

  /**
   * Нормализует дату в ISO 8601.
   * Google News RSS возвращает дату в формате RFC 822.
   */
  private normalizeDate(rawDate: string): string {
    if (!rawDate || rawDate.trim().length === 0) {
      return '';
    }

    try {
      const date = new Date(rawDate);
      if (isNaN(date.getTime())) {
        return '';
      }
      return date.toISOString();
    } catch {
      return '';
    }
  }

  // ───────────────────────────────────────────
  // Evidence
  // ───────────────────────────────────────────

  /** Создаёт ResearchEvidence для новости */
  private createNewsEvidence(
    item: NewsItem,
    fetchedAt: string,
  ): ResearchEvidence {
    const id = `news-${item.url.slice(0, 32).replace(/[^a-zA-Z0-9]/g, '-')}-${fetchedAt.slice(0, 10).replace(/-/g, '')}`;

    return {
      id,
      type: 'NEWS' as const,
      source: item.source,
      url: item.url,
      publishedAt: item.date || fetchedAt,
      retrievedAt: fetchedAt,
      claim: `${item.title} (${item.source}, ${item.date || 'unknown date'})`,
      confidence: Math.max(0.3, item.relevanceToIssuer),
    };
  }

  // ───────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────

  /** Формирует поисковый запрос для Google News RSS */
  private buildQuery(ticker: string, name: string, issuer: string): string {
    const parts: string[] = [`"${ticker}"`];

    if (name && name !== ticker) {
      parts.push(`"${name}"`);
    }

    if (issuer && issuer !== ticker && issuer !== name) {
      parts.push(`"${issuer}"`);
    }

    return parts.join(' OR ');
  }

  /** Строит AssetIdentity */
  private buildIdentity(asset: ResearchAsset): AssetResearchSnapshot['identity'] {
    return {
      ticker: asset.ticker,
      name: asset.name,
      assetType: asset.assetType as 'STOCK' | 'BOND' | 'ETF' | 'CASH' | 'OTHER',
      issuer: asset.issuer ?? '',
      currency: asset.currency ?? 'RUB',
      market: asset.market ?? 'MOEX',
    };
  }
}
