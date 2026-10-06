/**
 * NewsCache — кэширование и хранение истории новостей.
 *
 * Позволяет:
 * - Сохранять новости с метаданными (тикер, сентимент, важность)
 * - Хранить историю для обучения агентов
 * - Анализировать тренды по тикерам
 * - Прогнозировать влияние новостей на рынок
 */

import type { RawNewsItem } from './types.js';

/** Тип сентимента новости */
export type NewsSentiment = 'positive' | 'negative' | 'neutral' | 'unknown';

/** Важность новости */
export type NewsImportance = 'critical' | 'high' | 'medium' | 'low' | 'noise';

/** Кэшированная новость с метаданными */
export interface CachedNewsItem {
  /** Уникальный ID (MD5 от URL + title) */
  id: string;
  /** Заголовок */
  title: string;
  /** Описание */
  description: string;
  /** URL */
  url: string;
  /** Дата публикации */
  date: string;
  /** Источник */
  source: string;
  /** Тикеры, упомянутые в новости */
  tickers: string[];
  /** Категория (из RSS) */
  category: string;
  /** Сентимент */
  sentiment: NewsSentiment;
  /** Важность */
  importance: NewsImportance;
  /** Флаг: новость по Московской бирже */
  isMoscowExchange: boolean;
  /** Время добавления в кэш */
  cachedAt: string;
  /** Последнее обновление */
  updatedAt: string;
  /** Количество упоминаний в ленте */
  mentionCount: number;
}

/** Результат анализа трендов */
export interface NewsTrend {
  /** Тикер */
  ticker: string;
  /** Количество новостей за период */
  newsCount: number;
  /** Средний сентимент */
  averageSentiment: number; // -1 (negative) до 1 (positive)
  /** Ключевые темы */
  topKeywords: string[];
  /** Динамика (рост/падение упоминаний) */
  trend: 'up' | 'down' | 'stable';
}

/** Конфигурация кэша */
export interface NewsCacheConfig {
  /** Максимальное количество записей */
  maxItems?: number;
  /** TTL в часах (по умолчанию 720 = 30 дней) */
  ttlHours?: number;
  /** Включить автоматический анализ сентимента */
  autoAnalyzeSentiment?: boolean;
}

/** Дефолтная конфигурация */
const DEFAULT_CONFIG: NewsCacheConfig = {
  maxItems: 10000,
  ttlHours: 720, // 30 дней
  autoAnalyzeSentiment: true,
};

/** Ключевые слова для анализа сентимента */
const SENTIMENT_KEYWORDS = {
  positive: [
    'рост',
    'прогресс',
    'прибыль',
    'доход',
    'успех',
    'развитие',
    'инвестиц',
    'покупк',
    'увелич',
    'оптимист',
    'бум',
    'рекорд',
    'дивиденд',
    'выкуп',
    'одобр',
    'контракт',
    'сделк',
    'расширен',
    'открыт',
    'запущен',
  ],
  negative: [
    'паден',
    'кризис',
    'убыток',
    'долг',
    'санкц',
    'дефолт',
    'банкрот',
    'сокращ',
    'закрыт',
    'проблем',
    'риск',
    'штраф',
    'расслед',
    'рассмотр',
    'суд',
    'арест',
    'блокировк',
    'ограничен',
    'пониж',
    'негатив',
    'тревог',
    'стресс',
  ],
};

/**
 * Вычислить MD5 хеш (упрощённая версия для браузера).
 */
function computeHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Проанализировать сентимент новости.
 */
function analyzeSentiment(text: string): NewsSentiment {
  const lower = text.toLowerCase();
  
  let positiveCount = 0;
  let negativeCount = 0;
  
  for (const keyword of SENTIMENT_KEYWORDS.positive) {
    if (lower.includes(keyword)) {
      positiveCount++;
    }
  }
  
  for (const keyword of SENTIMENT_KEYWORDS.negative) {
    if (lower.includes(keyword)) {
      negativeCount++;
    }
  }
  
  if (positiveCount > negativeCount + 1) return 'positive';
  if (negativeCount > positiveCount + 1) return 'negative';
  if (positiveCount > 0 && negativeCount > 0) return 'neutral';
  if (positiveCount > 0) return 'positive';
  if (negativeCount > 0) return 'negative';
  
  return 'unknown';
}

/**
 * Вычислить важность новости.
 */
function computeImportance(text: string, tickers: string[]): NewsImportance {
  const lower = text.toLowerCase();
  
  // Критические события
  const criticalKeywords = [
    'дефолт',
    'банкрот',
    'санкц',
    'кризис',
    'ключевая ставка',
    'цб',
    'рестрикц',
    'блокировк',
  ];
  
  for (const keyword of criticalKeywords) {
    if (lower.includes(keyword)) {
      return 'critical';
    }
  }
  
  // Высокая важность
  const highKeywords = [
    'дивиденд',
    'отчёт',
    'крупн',
    'блокпакет',
    'поглощ',
    'слиян',
    'IPO',
    'SPO',
    'рейтинг',
    'прогноз',
  ];
  
  for (const keyword of highKeywords) {
    if (lower.includes(keyword)) {
      return 'high';
    }
  }
  
  // Средняя важность
  if (tickers.length > 0) {
    return 'medium';
  }
  
  return 'low';
}

/**
 * NewsCache — кэширование и анализ новостей.
 */
export class NewsCache {
  private cache: Map<string, CachedNewsItem> = new Map();
  private config: NewsCacheConfig;
  private trends: Map<string, NewsTrend> = new Map();

  constructor(config?: NewsCacheConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadFromStorage();
  }

  /** Добавить новость в кэш */
  add(item: RawNewsItem, tickers: string[] = [], isMoscowExchange = false): CachedNewsItem {
    const id = computeHash(item.url + item.title);
    
    // Проверяем существование
    const existing = this.cache.get(id);
    if (existing) {
      existing.mentionCount++;
      existing.updatedAt = new Date().toISOString();
      
      // Обновляем тикеры
      for (const ticker of tickers) {
        if (!existing.tickers.includes(ticker)) {
          existing.tickers.push(ticker);
        }
      }
      
      this.cache.set(id, existing);
      this.saveToStorage();
      return existing;
    }
    
    // Создаём новую запись
    const now = new Date().toISOString();
    const cachedItem: CachedNewsItem = {
      id,
      title: item.title,
      description: item.description,
      url: item.url,
      date: item.date,
      source: (item.metadata?.sourceName as string) || '',
      tickers,
      category: (item.metadata?.category as string) || '',
      sentiment: this.config.autoAnalyzeSentiment
        ? analyzeSentiment(item.title + ' ' + item.description)
        : 'unknown',
      importance: computeImportance(item.title + ' ' + item.description, tickers),
      isMoscowExchange,
      cachedAt: now,
      updatedAt: now,
      mentionCount: 1,
    };
    
    this.cache.set(id, cachedItem);
    
    // Ограничиваем размер кэша
    if (this.cache.size > this.config.maxItems!) {
      this.pruneOldItems();
    }
    
    this.saveToStorage();
    this.updateTrends();
    
    return cachedItem;
  }

  /** Получить новость по ID */
  get(id: string): CachedNewsItem | undefined {
    return this.cache.get(id);
  }

  /** Получить новости по тикеру */
  getByTicker(ticker: string, limit = 50): CachedNewsItem[] {
    const items: CachedNewsItem[] = [];
    
    for (const item of this.cache.values()) {
      if (item.tickers.includes(ticker)) {
        items.push(item);
        if (items.length >= limit) break;
      }
    }
    
    // Сортируем по дате (новые первые)
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    return items;
  }

  /** Получить последние N новостей */
  getLatest(limit = 100): CachedNewsItem[] {
    const items = Array.from(this.cache.values());
    items.sort((a, b) => new Date(b.cachedAt).getTime() - new Date(a.cachedAt).getTime());
    return items.slice(0, limit);
  }

  /** Получить новости по важности */
  getByImportance(importance: NewsImportance, limit = 50): CachedNewsItem[] {
    const items: CachedNewsItem[] = [];
    
    for (const item of this.cache.values()) {
      if (item.importance === importance) {
        items.push(item);
        if (items.length >= limit) break;
      }
    }
    
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  }

  /** Получить тренды по тикерам */
  getTrends(): NewsTrend[] {
    return Array.from(this.trends.values());
  }

  /** Получить тренд по конкретному тикеру */
  getTickerTrend(ticker: string): NewsTrend | undefined {
    return this.trends.get(ticker);
  }

  /** Обновить тренды */
  private updateTrends(): void {
    const tickerStats: Map<string, {
      count: number;
      sentimentSum: number;
      keywords: Map<string, number>;
    }> = new Map();
    
    for (const item of this.cache.values()) {
      for (const ticker of item.tickers) {
        if (!tickerStats.has(ticker)) {
          tickerStats.set(ticker, {
            count: 0,
            sentimentSum: 0,
            keywords: new Map(),
          });
        }
        
        const stats = tickerStats.get(ticker)!;
        stats.count++;
        
        // Сентимент: positive=1, neutral=0, negative=-1, unknown=0
        const sentimentValue = item.sentiment === 'positive' ? 1 :
                              item.sentiment === 'negative' ? -1 : 0;
        stats.sentimentSum += sentimentValue;
        
        // Собираем ключевые слова
        const words = item.title.toLowerCase().split(/\s+/);
        for (const word of words) {
          if (word.length > 4) {
            stats.keywords.set(word, (stats.keywords.get(word) || 0) + 1);
          }
        }
      }
    }
    
    // Обновляем тренды
    for (const [ticker, stats] of tickerStats) {
      const averageSentiment = stats.count > 0
        ? stats.sentimentSum / stats.count
        : 0;
      
      // Топ ключевые слова
      const topKeywords = Array.from(stats.keywords.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word]) => word);
      
      // Определяем тренд (упрощённо)
      const trend: 'up' | 'down' | 'stable' = averageSentiment > 0.2 ? 'up' :
                                                averageSentiment < -0.2 ? 'down' : 'stable';
      
      this.trends.set(ticker, {
        ticker,
        newsCount: stats.count,
        averageSentiment,
        topKeywords,
        trend,
      });
    }
  }

  /** Удалить старые записи */
  private pruneOldItems(): void {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - (this.config.ttlHours || 720));
    
    const itemsToDelete: string[] = [];
    
    for (const [id, item] of this.cache.entries()) {
      if (new Date(item.cachedAt) < cutoff) {
        itemsToDelete.push(id);
      }
    }
    
    for (const id of itemsToDelete) {
      this.cache.delete(id);
    }
  }

  /** Очистить кэш */
  clear(): void {
    this.cache.clear();
    this.trends.clear();
    this.saveToStorage();
  }

  /** Получить статистику */
  getStats(): {
    totalItems: number;
    moscowExchangeItems: number;
    byImportance: Record<NewsImportance, number>;
    bySentiment: Record<NewsSentiment, number>;
    uniqueTickers: number;
  } {
    const stats = {
      totalItems: this.cache.size,
      moscowExchangeItems: 0,
      byImportance: { critical: 0, high: 0, medium: 0, low: 0, noise: 0 },
      bySentiment: { positive: 0, negative: 0, neutral: 0, unknown: 0 },
      uniqueTickers: new Set<string>().size,
    };
    
    const tickers = new Set<string>();
    
    for (const item of this.cache.values()) {
      if (item.isMoscowExchange) {
        stats.moscowExchangeItems++;
      }
      
      stats.byImportance[item.importance]++;
      stats.bySentiment[item.sentiment]++;
      
      for (const ticker of item.tickers) {
        tickers.add(ticker);
      }
    }
    
    stats.uniqueTickers = tickers.size;
    
    return stats;
  }

  /** Сохранить в localStorage */
  private saveToStorage(): void {
    try {
      const data = {
        cache: Array.from(this.cache.entries()),
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem('finance_analyzer_news_cache', JSON.stringify(data));
    } catch (error) {
      console.warn('[NewsCache] Ошибка сохранения:', error);
    }
  }

  /** Загрузить из localStorage */
  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem('finance_analyzer_news_cache');
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.cache) {
          this.cache = new Map(parsed.cache);
        }
      }
    } catch (error) {
      console.warn('[NewsCache] Ошибка загрузки:', error);
    }
  }
}
