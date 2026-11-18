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
    const filteredExamples: Record<string, Array<{
      title: string;
      description: string;
      url: string;
      source: string;
      relevantTickers: string[];
    }>> = {};
    const maxExamplesPerReason = 3;

    for (const raw of allRawNews) {
      if (!this._running) break;

      this.stats.totalProcessed++;

      // Нормализация
      const normalized = this.normalizeRaw(raw);

      // Извлекаем тикеры сразу (нужен для всех фильтров)
      const relevantTickers = extractTickersFromText(
        `${normalized.title} ${normalized.summary}`,
        this.config.monitoredTickers,
      );

      // Дедупликация
      if (this.processedHashes.has(normalized.contentHash)) {
        this.stats.duplicates++;
        filteredByReason['duplicate'] = (filteredByReason['duplicate'] ?? 0) + 1;
        if (!filteredExamples['duplicate']) filteredExamples['duplicate'] = [];
        if (filteredExamples['duplicate'].length < maxExamplesPerReason) {
          filteredExamples['duplicate'].push({
            title: normalized.title,
            description: normalized.summary,
            url: normalized.url,
            source: normalized.source,
            relevantTickers,
          });
        }
        continue;
      }
      this.processedHashes.add(normalized.contentHash);

      // Проверка TTL
      if (this.isExpired(normalized.publishedAt)) {
        this.stats.filtered++;
        filteredByReason['expired'] = (filteredByReason['expired'] ?? 0) + 1;
        if (!filteredExamples['expired']) filteredExamples['expired'] = [];
        if (filteredExamples['expired'].length < maxExamplesPerReason) {
          filteredExamples['expired'].push({
            title: normalized.title,
            description: normalized.summary,
            url: normalized.url,
            source: normalized.source,
            relevantTickers,
          });
        }
        continue;
      }

      // Определение приоритета (нужен для проверки шума)
      const priority = this.calculatePriority(normalized, relevantTickers);

      // Отсечение шума (до проверки тикеров — шум не пропускается)
      if (priority === 'noise') {
        this.stats.noise++;
        filteredByReason['noise'] = (filteredByReason['noise'] ?? 0) + 1;
        if (!filteredExamples['noise']) filteredExamples['noise'] = [];
        if (filteredExamples['noise'].length < maxExamplesPerReason) {
          filteredExamples['noise'].push({
            title: normalized.title,
            description: normalized.summary,
            url: normalized.url,
            source: normalized.source,
            relevantTickers,
          });
        }
        continue;
      }

      // Фильтрация по тикерам
      if (relevantTickers.length === 0) {
        this.stats.filtered++;
        filteredByReason['not_relevant'] = (filteredByReason['not_relevant'] ?? 0) + 1;
        if (!filteredExamples['not_relevant']) filteredExamples['not_relevant'] = [];
        if (filteredExamples['not_relevant'].length < maxExamplesPerReason) {
          filteredExamples['not_relevant'].push({
            title: normalized.title,
            description: normalized.summary,
            url: normalized.url,
            source: normalized.source,
            relevantTickers,
          });
        }
        continue;
      }

      // Одобрение
      const temporalWeight = this.calculateTemporalDecay(normalized.publishedAt);
      const approvedItem: GatekeeperNewsItem = {
        ...normalized,
        relevantTickers,
        priority,
        filterStatus: 'approved',
        temporalWeight,
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
        examples: filteredExamples,
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

  /**
   * Расчёт временного затухания новости.
   * Свежие новости имеют больший вес.
   */
  private calculateTemporalDecay(publishedAt: string): number {
    const pubDate = new Date(publishedAt);
    if (isNaN(pubDate.getTime())) return 0.1;

    const now = new Date();
    const ageHours = (now.getTime() - pubDate.getTime()) / (1000 * 60 * 60);

    // Экспоненциальное затухание
    if (ageHours <= 1) return 1.0;       // 0-1 час: полный вес
    if (ageHours <= 6) return 0.8;       // 1-6 часов: 80%
    if (ageHours <= 24) return 0.5;      // 6-24 часа: 50%
    if (ageHours <= 72) return 0.3;      // 24-72 часа: 30%
    return 0.1;                          // 72+ часов: 10%
  }

  /** Вычисляет приоритет новости с взвешиванием и учётом отрицания */
  private calculatePriority(
    news: NormalizedNewsItem,
    _relevantTickers: string[],
  ): NewsPriority {
    const text = `${news.title} ${news.summary}`.toLowerCase();

    // Взвешенные ключевые слова: [слова, вес]
    const criticalKeywords = [
      'банкрот', 'дефолт', 'санкц', 'запрет', 'экспорти',
      'embargo', 'fine', 'penalt', 'raid', 'suspension',
      'dividend_cut', 'debt_default', 'bankruptcy',
    ];
    const criticalWeight = 10;

    const highKeywords = [
      'дивиденд', 'прибыл', 'покупк', 'продаж', 'слиян',
      'акц', 'эмисси', 'growth', 'earnings', 'buyback',
      'rating_upgrade', 'rating_downgrade',
    ];
    const highWeight = 5;

    const mediumKeywords = [
      'отчёт', 'план', 'стратег', 'инвестиц', 'расшир',
      'contract', 'deal', 'agreement', 'revenue',
    ];
    const mediumWeight = 2;

    // Шум — только явно нерелевантные слова
    const noiseKeywords = [
      'анонс', 'скоро', 'ожидается', 'анализ_рынка', 'обзор',
      // 'prognosis', 'forecast', 'general_market' — удалены:
      // это важные финансовые слова, а не шум
    ];

    // Подсчёт общего веса с учётом отрицания
    let totalWeight = 0;
    let hasCritical = false;
    let hasHigh = false;
    let hasNoise = false;

    // Проверка критических слов (с учётом отрицания)
    for (const kw of criticalKeywords) {
      if (text.includes(kw)) {
        // Проверяем, не стоит ли перед словом отрицание
        const negationPattern = new RegExp(`(не|no|не[а-яё]*)\\s{1,3}${kw}`, 'i');
        if (!negationPattern.test(text)) {
          totalWeight += criticalWeight;
          hasCritical = true;
        }
      }
    }

    // Проверка высоких слов
    for (const kw of highKeywords) {
      if (text.includes(kw)) {
        const negationPattern = new RegExp(`(не|no|не[а-яё]*)\\s{1,3}${kw}`, 'i');
        if (!negationPattern.test(text)) {
          totalWeight += highWeight;
          hasHigh = true;
        }
      }
    }

    // Проверка средних слов
    for (const kw of mediumKeywords) {
      if (text.includes(kw)) {
        const negationPattern = new RegExp(`(не|no|не[а-яё]*)\\s{1,3}${kw}`, 'i');
        if (!negationPattern.test(text)) {
          totalWeight += mediumWeight;
        }
      }
    }

    // Проверка на шум
    for (const kw of noiseKeywords) {
      if (text.includes(kw)) {
        hasNoise = true;
      }
    }

    // Критический: есть хотя бы одно критическое слово
    if (hasCritical) {
      return 'critical';
    }

    // Высокий: сумма весов >= 5 или есть хотя бы одно высокое слово
    if (hasHigh || totalWeight >= 5) {
      return 'high';
    }

    // Шум: только если нет других приоритетов и есть шумовые слова
    if (hasNoise && totalWeight < 2) {
      return 'noise';
    }

    // Средний: есть средние слова или вес >= 2
    if (totalWeight >= 2) {
      return 'medium';
    }

    // По умолчанию — низкий
    return 'low';
  }
}
