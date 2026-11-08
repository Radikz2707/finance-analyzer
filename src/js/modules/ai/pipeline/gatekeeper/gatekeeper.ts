/**
 * Gatekeeper — входной ИИ-фильтр новостей.
 *
 * Архитектура:
 *   [QUIK OnNews] ─┐
 *   [Moex API]  ───┤
 *   [RSS-ленты] ──┤→ Gatekeeper → [Approved News] → Pipeline
 *   [Google]    ─┤
 *
 * Функции:
 * 1. Сбор новостей из всех источников параллельно
 * 2. Нормализация в единый формат
 * 3. Фильтрация по тикерам из БД
 * 4. Дедупликация по content hash
 * 5. Приоритизация (critical/high/medium/low/noise)
 * 6. Отсечение шума
 */

import crypto from 'crypto';
import type {
  GatekeeperConfig,
  GatekeeperResult,
  GatekeeperStats,
  GatekeeperNewsItem,
  NormalizedNewsItem,
  NewsPriority,
  NewsSource,
  RawNewsItem,
  INewsSource,
} from './types.js';

// ──────────────────────────────────────────────
// Утилиты
// ──────────────────────────────────────────────

/** Генерация content hash для дедупликации */
function generateContentHash(title: string, description: string): string {
  const text = `${title.toLowerCase().trim()} ${description.toLowerCase().trim()}`;
  return crypto.createHash('md5').update(text).digest('hex').slice(0, 16);
}

/** Генерация уникального ID */
function generateId(source: NewsSource, contentHash: string): string {
  return `gate-${source}-${contentHash}`;
}

/** Проверка, содержит ли текст хотя бы одно ключевое слово */
function containsKeywords(
  text: string,
  keywords: string[],
): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some((kw) => lowerText.includes(kw));
}

/** Извлечение тикеров из текста */
function extractTickersFromText(
  text: string,
  monitoredTickers: string[],
): string[] {
  const found: string[] = [];

  for (const ticker of monitoredTickers) {
    const tickerLower = ticker.toLowerCase();
    // Точное совпадение слова (word boundary)
    const regex = new RegExp(`\\b${tickerLower}\\b`, 'i');
    if (regex.test(text)) {
      found.push(ticker);
    }
  }

  return found;
}

// ──────────────────────────────────────────────
// Gatekeeper
// ──────────────────────────────────────────────

/**
 * Gatekeeper — входной фильтр новостей.
 */
export class Gatekeeper {
  private readonly config: GatekeeperConfig;
  private readonly sources: INewsSource[];
  private processedHashes: Set<string> = new Set();
  private stats: GatekeeperStats = {
    totalProcessed: 0,
    approved: 0,
    filtered: 0,
    duplicates: 0,
    noise: 0,
    activeSources: 0,
  };
  private _running = false;

  constructor(config: GatekeeperConfig, sources: INewsSource[]) {
    this.config = {
      ...config,
      maxNewsPerSession: config.maxNewsPerSession ?? 100,
      newsTtlMinutes: config.newsTtlMinutes ?? 60,
      relevanceThreshold: config.relevanceThreshold ?? 0.3,
      verbose: config.verbose ?? false,
    };
    this.sources = sources.filter((s) => s.enabled);

    if (this.config.verbose) {
      console.log(
        `[Gatekeeper] Инициализация: ${this.sources.length} источников, ` +
        `${config.monitoredTickers.length} тикеров`,
      );
    }
  }

  /** Запустить фильтрацию */
  async run(): Promise<GatekeeperResult> {
    this._running = true;
    this.processedHashes.clear();

    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const processedAt = new Date().toISOString();

    if (this.config.verbose) {
      console.log(`[Gatekeeper] Запуск сессии ${sessionId}`);
    }

    // Шаг 1: Сбор новостей из всех источников параллельно
    const allRawNews: RawNewsItem[] = [];
    const sourceStats: GatekeeperResult['sourceStats'] = {
      quik: { total: 0, approved: 0 },
      moex: { total: 0, approved: 0 },
      google_news: { total: 0, approved: 0 },
      rbc: { total: 0, approved: 0 },
      interfax: { total: 0, approved: 0 },
      investing_com: { total: 0, approved: 0 },
      custom_rss: { total: 0, approved: 0 },
    };

    const fetchPromises = this.sources.map(async (source) => {
      try {
        const rawItems = await source.fetch();
        allRawNews.push(...rawItems);
        sourceStats[source.name].total = rawItems.length;

        if (this.config.verbose) {
          console.log(
            `[Gatekeeper] Источник ${source.name}: ${rawItems.length} новостей`,
          );
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Gatekeeper] Ошибка источника ${source.name}: ${errorMsg}`);
      }
    });

    await Promise.allSettled(fetchPromises);

    // Шаг 2: Нормализация и фильтрация
    const approvedNews: GatekeeperNewsItem[] = [];
    const filteredByReason: Record<string, number> = {};

    for (const raw of allRawNews) {
      if (!this._running) break;

      this.stats.totalProcessed++;

      // Нормализация
      const normalized = this.normalizeRaw(raw);

      // Дедупликация
      if (this.processedHashes.has(normalized.contentHash)) {
        this.stats.duplicates++;
        filteredByReason['duplicate'] = (filteredByReason['duplicate'] ?? 0) + 1;
        continue;
      }
      this.processedHashes.add(normalized.contentHash);

      // Проверка TTL
      if (this.isExpired(normalized.publishedAt)) {
        this.stats.filtered++;
        filteredByReason['expired'] = (filteredByReason['expired'] ?? 0) + 1;
        continue;
      }

      // Определение приоритета (нужен для проверки шума)
      const priority = this.calculatePriority(normalized, []);

      // Отсечение шума (до проверки тикеров — шум не пропускается)
      if (priority === 'noise') {
        this.stats.noise++;
        filteredByReason['noise'] = (filteredByReason['noise'] ?? 0) + 1;
        continue;
      }

      // Фильтрация по тикерам
      const relevantTickers = extractTickersFromText(
        `${normalized.title} ${normalized.summary}`,
        this.config.monitoredTickers,
      );

      if (relevantTickers.length === 0) {
        this.stats.filtered++;
        filteredByReason['not_relevant'] = (filteredByReason['not_relevant'] ?? 0) + 1;
        continue;
      }

      // Одобрение
      const approvedItem: GatekeeperNewsItem = {
        ...normalized,
        relevantTickers,
        priority,
        filterStatus: 'approved',
      };

      approvedNews.push(approvedItem);
      this.stats.approved++;
      const sourceStat = sourceStats[normalized.source];
      if (sourceStat) {
        sourceStat.approved++;
      }

      // Лимит на сессию
      const maxNews = this.config.maxNewsPerSession ?? 100;
      if (approvedNews.length >= maxNews) {
        break;
      }
    }

    const result: GatekeeperResult = {
      sessionId,
      processedAt,
      approvedNews,
      filteredOut: {
        total: this.stats.totalProcessed - approvedNews.length,
        byReason: filteredByReason,
      },
      sourceStats,
      processedTickers: this.config.monitoredTickers,
    };

    if (this.config.verbose) {
      console.log(
        `[Gatekeeper] Сессия ${sessionId} завершена: ` +
        `${approvedNews.length} одобрено, ` +
        `${result.filteredOut.total} отфильтровано`,
      );
    }

    return result;
  }

  /** Остановить Gatekeeper */
  async stop(): Promise<void> {
    this._running = false;
    if (this.config.verbose) {
      console.log('[Gatekeeper] Остановлен');
    }
  }

  /** Получить статистику */
  getStats(): GatekeeperStats {
    return { ...this.stats };
  }

  /** Обновить список тикеров */
  updateTickers(tickers: string[]): void {
    this.config.monitoredTickers = tickers;
    if (this.config.verbose) {
      console.log(`[Gatekeeper] Тикеры обновлены: ${tickers.length} шт.`);
    }
  }

  // ── Helpers ──

  /** Нормализует сырую новость */
  private normalizeRaw(raw: RawNewsItem): NormalizedNewsItem {
    const contentHash = generateContentHash(raw.title, raw.description);

    return {
      id: generateId('custom_rss', contentHash),
      title: raw.title,
      summary: raw.description?.slice(0, 500) || raw.title,
      url: raw.url,
      publishedAt: raw.date || new Date().toISOString(),
      source: 'custom_rss',
      contentHash,
      rawData: raw.metadata,
    };
  }

  /** Проверяет, просрочена ли новость */
  private isExpired(publishedAt: string): boolean {
    const pubDate = new Date(publishedAt);
    if (isNaN(pubDate.getTime())) return true;

    const now = new Date();
    const ageMinutes = (now.getTime() - pubDate.getTime()) / (1000 * 60);
    const ttl = this.config.newsTtlMinutes;
    return ageMinutes > (ttl ?? 60);
  }

  /** Вычисляет приоритет новости */
  private calculatePriority(
    news: NormalizedNewsItem,
    _relevantTickers: string[],
  ): NewsPriority {
    const text = `${news.title} ${news.summary}`.toLowerCase();

    // Критические слова
    const criticalKeywords = [
      'банкрот', 'дефолт', 'санкц', 'запрет', 'экспорти',
      'embargo', 'fine', 'penalt', 'raid', 'suspension',
      'dividend_cut', 'debt_default', 'bankruptcy',
    ];

    // Высокий приоритет
    const highKeywords = [
      'дивиденд', 'прибыл', 'покупк', 'продаж', 'слиян',
      'акци', 'эмисси', 'growth', 'earnings', 'buyback',
      'rating_upgrade', 'rating_downgrade',
    ];

    // Средний приоритет
    const mediumKeywords = [
      'отчёт', 'план', 'стратег', 'инвестиц', 'расшир',
      'contract', 'deal', 'agreement', 'revenue',
    ];

    // Шум
    const noiseKeywords = [
      'анонс', 'скоро', 'ожидается', 'анализ_рынка', 'обзор',
      'prognosis', 'forecast', 'general_market',
    ];

    // Проверка на критический
    if (containsKeywords(text, criticalKeywords)) {
      return 'critical';
    }

    // Проверка на высокий
    if (containsKeywords(text, highKeywords)) {
      return 'high';
    }

    // Проверка на шум (только если нет других приоритетов)
    if (containsKeywords(text, noiseKeywords)) {
      return 'noise';
    }

    // Проверка на средний
    if (containsKeywords(text, mediumKeywords)) {
      return 'medium';
    }

    // По умолчанию — низкий
    return 'low';
  }
}
