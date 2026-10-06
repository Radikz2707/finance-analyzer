/**
 * BrowserAgent — агент веб-мониторинга (этап 4.2 мастер-плана).
 *
 * Действия:
 * - search      — «поиск в интернете» по новостным источникам через API
 *                 (Google News RSS + RSS-ленты gatekeeper). Прямого поискового
 *                 API в проекте нет — это зафиксированный дизайн-решение:
 *                 поиск = поиск по новостным источникам.
 * - fetch-page  — парсинг страницы через браузерный шлюз (DI `browserGateway`):
 *                 только https + белый список доменов, лимит контента, таймаут.
 * - prices      — мониторинг цен: API-провайдер (по умолчанию MOEX ISS через
 *                 `fetchHistoricalData`) с fallback на браузер через
 *                 `withFallback` (circuit-breaker); браузер — ТОЛЬКО fallback.
 * - news        — сбор новостей: провайдер (API) → браузерный RSS fallback →
 *                 кэш → честный «нет данных».
 * - refresh     — последовательный опрос источников с интервалами,
 *                 дедупликация и кэширование результата по fingerprint
 *                 (повторный вызов не дублирует, TTL задаётся опцией).
 *
 * Безопасность:
 * - whitelist доменов для fetch-page (свой список — в SecurityAgent
 *   `DEFAULT_HTTP_HOSTS` не экспортирован, поэтому список продублирован
 *   и расширен лентами RSS; см. `DEFAULT_ALLOWED_DOMAINS`);
 * - только https;
 * - лимит контента (по умолчанию 200 КБ) и таймауты всех внешних вызовов.
 *
 * DI для тестов: `browserGateway`, `newsProvider`, `priceProvider`,
 * `newsCache` — тесты не ходят в сеть.
 *
 * Ограничение (зафиксировано): реальный `BrowserGateway` пока не имеет метода
 * `navigate()`. Агент определяет минимальный контракт `BrowserGatewayLike` и
 * работает с ним; продакшен-адаптер поверх Playwright-сессии BrowserGateway —
 * отдельная задача (вне scope этапа 4.2). Без инжектированного шлюза
 * fetch-page честно возвращает «нет данных», а не выдумывает контент.
 */

import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import type { AgentActionInput } from '../agent/agent-contract.js';
import { withFallback } from '../infrastructure/circuit-breaker.js';
import { RssNewsSource } from '../gatekeeper/rss-source.js';
import { NewsFetcher } from '../../research/providers/news-fetcher.js';
import { fetchHistoricalData } from '../../moex-api/history-provider.js';

// ──────────────────────────────────────────────
// 1. Типы BrowserAgent
// ──────────────────────────────────────────────

/** Действие, выполняемое агентом */
export type BrowserAgentAction =
  'search' | 'fetch-page' | 'prices' | 'news' | 'refresh';

/** Элемент результата веб-мониторинга */
export interface WebResult {
  /** Заголовок страницы/новости */
  title?: string;
  /** URL источника */
  url?: string;
  /** Фрагмент/сниппет контента */
  snippet?: string;
  /** Дата публикации (ISO 8601) */
  publishedAt?: string;
  /** Цена (для prices) */
  price?: number;
  /** Тикер (для prices) */
  ticker?: string;
}

/**
 * Входные данные BrowserAgent.
 * Расширяет единый стандарт входа action-агента `AgentActionInput`.
 */
export interface BrowserAgentInput extends AgentActionInput<BrowserAgentAction> {
  /** Поисковый запрос (search/news) */
  query?: string;
  /** URL для парсинга (fetch-page) */
  url?: string;
  /** Тикеры (prices) */
  tickers?: string[];
  /**
   * Источники: для refresh — список действий ('search'|'news'|'prices'|
   * 'fetch-page'); для news/search — фильтр источников провайдера.
   */
  sources?: string[];
  /** Максимум элементов в результате (по умолчанию 20) */
  limit?: number;
}

/**
 * Выходные данные BrowserAgent.
 *
 * Стандартное поле `message` добавлено для совместимости с единой формой
 * результата `AgentActionResult`; специфичные поля `source`/`warning`
 * сохранены (легаси-контракт тестов).
 */
export interface BrowserAgentOutput {
  /** Действие */
  action: BrowserAgentAction;
  /** Результаты */
  items: WebResult[];
  /** Метка фактического источника данных (api:moex / browser:gateway / news:api / deny / no-data / ...) */
  source: string;
  /** Честное предупреждение (deny, таймаут, «нет данных» и т.п.) */
  warning?: string;
  /** Стандартное описание результата (совместимость с AgentActionResult) */
  message?: string;
  /** Метка времени формирования результата */
  timestamp: string;
}

// ──────────────────────────────────────────────
// 2. DI-контракты
// ──────────────────────────────────────────────

/** Опции навигации браузерного шлюза */
export interface NavigateOptions {
  /** Таймаут навигации, мс */
  timeoutMs?: number;
  /** Лимит забираемого контента (символов/приблизительных байт) */
  maxContentBytes?: number;
}

/** Результат навигации */
export interface NavigateResult {
  /** Финальный URL (после редиректов) */
  url: string;
  /** Заголовок страницы */
  title?: string;
  /** Текстовый контент страницы */
  text: string;
}

/**
 * Минимальный контракт браузерного шлюза (DI).
 * Продакшен-реализация — адаптер поверх BrowserGateway/Playwright;
 * `BrowserGateway.navigate()` пока отсутствует (см. ограничение в шапке файла).
 */
export interface BrowserGatewayLike {
  navigate(url: string, options?: NavigateOptions): Promise<NavigateResult>;
}

/** Провайдер новостей/поиска по новостям (API-слой) */
export interface NewsProviderLike {
  fetchNews(
    query?: string,
    options?: { limit?: number; sources?: string[] },
  ): Promise<WebResult[]>;
}

/** Провайдер цен (API-слой; браузер — только fallback) */
export interface PriceProviderLike {
  getPrices(
    tickers: string[],
    options?: { timeoutMs?: number },
  ): Promise<WebResult[]>;
}

/** Минимальный контракт кэша новостей (опциональная интеграция с gatekeeper/news-cache) */
export interface NewsCacheLike {
  add(
    item: { title?: string; description?: string; url?: string; date?: string },
    tickers?: string[],
  ): unknown;
  getLatest(limit?: number): Array<{
    title?: string;
    url?: string;
    description?: string;
    date?: string;
  }>;
}

// ──────────────────────────────────────────────
// 3. Константы безопасности и лимиты
// ──────────────────────────────────────────────

/**
 * Белый список доменов для fetch-page.
 * SecurityAgent хранит свой список приватно (`DEFAULT_HTTP_HOSTS` не
 * экспортирован), поэтому здесь он продублирован и расширен RSS-лентами
 * gatekeeper — это зафиксированное дизайн-решение.
 */
export const DEFAULT_ALLOWED_DOMAINS: readonly string[] = [
  'moex.com',
  'iss.moex.com',
  'cbr.ru',
  'finam.ru',
  'investing.com',
  'rbc.ru',
  'interfax.ru',
  'kommersant.ru',
  'vedomosti.ru',
  'news.google.com',
];

/** RSS-ленты для браузерного fallback новостей (подмножество gatekeeper/rss-source) */
const DEFAULT_RSS_FEEDS: ReadonlyArray<{ name: string; url: string }> = [
  { name: 'Финам', url: 'https://www.finam.ru/infoblock/newsfeed/rss.aspx' },
  { name: 'РБК Финансы', url: 'https://www.rbc.ru/rss/rbc_news_main.xml' },
  { name: 'Интерфакс', url: 'https://www.interfax.ru/rss/rss.rdf' },
  { name: 'Investing.com', url: 'https://ru.investing.com/rss/news.rss' },
];

/** Лимит контента страницы (приблизительно байт/символов), по умолчанию 200 КБ */
const MAX_CONTENT_BYTES = 200 * 1024;

/** Лимит сниппета в результатах fetch-page (символов) */
const MAX_PAGE_SNIPPET_CHARS = 1000;

/** Таймаут внешних вызовов по умолчанию, мс */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Лимит результатов по умолчанию */
const DEFAULT_LIMIT = 20;

/** Глубина истории цен MOEX (дней назад) */
const PRICE_HISTORY_DAYS = 45;

/** Интервал между источниками в refresh, мс */
const DEFAULT_REFRESH_INTERVAL_MS = 250;

/** TTL кэша refresh, мс (по умолчанию 60 секунд) */
const DEFAULT_REFRESH_CACHE_TTL_MS = 60_000;

/** Максимум записей в кэше refresh */
const MAX_REFRESH_CACHE_ENTRIES = 20;

/** Источники refresh по умолчанию (fetch-page требует явный url) */
const DEFAULT_REFRESH_SOURCES: readonly string[] = ['news', 'prices', 'search'];

/** Известные действия refresh */
const REFRESH_SOURCE_ACTIONS: ReadonlySet<string> = new Set([
  'search',
  'news',
  'prices',
  'fetch-page',
]);

// ──────────────────────────────────────────────
// 4. Хелперы (чистые функции, тестируемые)
// ──────────────────────────────────────────────

/** Результат проверки URL по whitelist */
export interface UrlCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Проверить URL: корректность, https (опционально) и белый список доменов.
 * Совпадение домена — по точному имени или суффиксу (sub.example.com → example.com).
 */
export function isUrlAllowed(
  url: string,
  allowedDomains: readonly string[],
  httpsOnly = true,
): UrlCheckResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'некорректный URL' };
  }

  if (httpsOnly && parsed.protocol !== 'https:') {
    return {
      allowed: false,
      reason: `только https (получен ${parsed.protocol})`,
    };
  }

  const host = parsed.hostname.toLowerCase();
  const ok = allowedDomains.some((entry) => {
    const domain = entry.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  });

  if (!ok) {
    return { allowed: false, reason: `${host} не в белом списке` };
  }

  return { allowed: true };
}

/** Дедупликация WebResult по url (fallback — title); применяет лимит */
function dedupeWebResults(items: WebResult[], limit?: number): WebResult[] {
  const seen = new Set<string>();
  const out: WebResult[] = [];
  for (const item of items) {
    const key = (item.url ?? item.title ?? '').toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (limit !== undefined && out.length >= limit) break;
  }
  return out;
}

/** Совпадает ли текст с запросом (регистронезависимо); пустой запрос — всё совпадает */
function matchesQuery(text: string | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (text ?? '').toLowerCase().includes(q);
}

/** Выполнить promise с таймаутом */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}: таймаут ${ms}мс`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Ограничить текст лимитом */
function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

/** Дата в формате YYYY-MM-DD (для MOEX ISS) */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Извлечь цену из JSON-ответа MOEX ISS marketdata.
 * Формат: { "marketdata": { "columns": ["SECID", ..., "LAST", ...], "data": [[...]] } }
 */
function parseMoexMarketDataPrice(
  jsonText: string,
  ticker: string,
): number | null {
  try {
    const parsed = JSON.parse(jsonText) as {
      marketdata?: { columns?: string[]; data?: unknown[][] };
    };
    const marketData = parsed.marketdata;
    if (!marketData?.columns || !marketData.data) return null;
    const lastIndex = marketData.columns.indexOf('LAST');
    if (lastIndex < 0) return null;
    for (const row of marketData.data) {
      if (String(row[0]) !== ticker) continue;
      const raw = row[lastIndex];
      const price = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(price) ? price : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Минимальный RSS-парсер для браузерного fallback (формат тот же, что в gatekeeper/rss-source) */
function parseRssItemsFromText(
  xml: string,
  maxItems = 30,
): Array<{
  title: string;
  link: string;
  pubDate: string;
  description: string;
}> {
  const items: Array<{
    title: string;
    link: string;
    pubDate: string;
    description: string;
  }> = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
    const body = match[1];
    if (!body) continue;
    const title = extractTagText(body, 'title') ?? '';
    const link = extractTagText(body, 'link') ?? '';
    if (!title || !link) continue;
    items.push({
      title,
      link,
      pubDate: extractTagText(body, 'pubDate') ?? '',
      description: extractTagText(body, 'description') ?? '',
    });
  }
  return items;
}

/** Извлечь текст XML-тега с декодированием сущностей */
function extractTagText(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  if (!match?.[1]) return null;
  return match[1]
    .replace(/\x26amp;/g, '&')
    .replace(/\x26lt;/g, '<')
    .replace(/\x26gt;/g, '>')
    .replace(/\x26quot;/g, '"')
    .replace(/\x26#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .trim();
}

// ──────────────────────────────────────────────
// 5. Провайдеры по умолчанию (API-слой)
// ──────────────────────────────────────────────

/**
 * Новостной провайдер по умолчанию.
 * «Интернет-поиск» реализуется как поиск по новостным источникам:
 * 1) Google News RSS через research/NewsFetcher (поисковый запрос);
 * 2) RSS-ленты gatekeeper/RssNewsSource (всегда, с фильтром по запросу).
 * Никаких выдуманных результатов: источник упал — переходим к следующему.
 */
export class DefaultNewsProvider implements NewsProviderLike {
  private readonly rss: RssNewsSource;
  private readonly google: NewsFetcher;

  constructor() {
    this.rss = new RssNewsSource();
    this.google = new NewsFetcher();
  }

  async fetchNews(
    query?: string,
    options?: { limit?: number; sources?: string[] },
  ): Promise<WebResult[]> {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const wantGoogle =
      !options?.sources?.length ||
      options.sources.some((s) => /google|news/i.test(s));
    const results: WebResult[] = [];

    if (query?.trim() && wantGoogle) {
      try {
        const fetched = await this.google.fetch(query);
        if (fetched.success) {
          for (const item of fetched.items) {
            results.push({
              title: item.title,
              url: item.link,
              snippet: item.description,
              publishedAt: item.date || undefined,
            });
          }
        }
      } catch {
        // Google News недоступен — пробуем RSS-ленты
      }
    }

    try {
      const rssItems = await this.rss.fetch();
      const sourceFilter = options?.sources?.map((s) => s.toLowerCase());
      for (const item of rssItems) {
        const sourceName = String(
          item.metadata?.sourceName ?? '',
        ).toLowerCase();
        if (
          sourceFilter &&
          sourceFilter.length > 0 &&
          !sourceFilter.some((s) => sourceName.includes(s))
        ) {
          continue;
        }
        if (
          query?.trim() &&
          !matchesQuery(`${item.title} ${item.description}`, query)
        ) {
          continue;
        }
        results.push({
          title: item.title,
          url: item.url,
          snippet: item.description,
          publishedAt: item.date || undefined,
        });
      }
    } catch {
      // RSS недоступен — вернём то, что собрали
    }

    return dedupeWebResults(results, limit);
  }
}

/**
 * Ценовой провайдер по умолчанию — MOEX ISS через `fetchHistoricalData`
 * (последняя закрытая свеча). API надёжнее браузера, браузер — только fallback.
 * Если ни по одному тикеру данных нет — бросаем ошибку (не выдумываем цены).
 */
export class DefaultPriceProvider implements PriceProviderLike {
  async getPrices(
    tickers: string[],
    _options?: { timeoutMs?: number },
  ): Promise<WebResult[]> {
    const to = new Date();
    const from = new Date(to.getTime() - PRICE_HISTORY_DAYS * 86_400_000);
    const toStr = toIsoDate(to);
    const fromStr = toIsoDate(from);

    const settled = await Promise.allSettled(
      tickers.map((ticker) =>
        fetchHistoricalData({
          ticker,
          interval: 'D',
          from: fromStr,
          to: toStr,
        }),
      ),
    );

    const out: WebResult[] = [];
    for (const result of settled) {
      if (result.status === 'rejected') continue;
      const bars = result.value.bars;
      const last = bars[bars.length - 1];
      if (!last) continue;
      out.push({
        ticker: result.value.ticker,
        price: last.close,
        title: `${result.value.ticker}`,
        publishedAt: last.date,
      });
    }

    if (out.length === 0) {
      throw new Error('MOEX API: нет данных по тикерам');
    }
    return out;
  }
}

// ──────────────────────────────────────────────
// 6. BrowserAgent
// ──────────────────────────────────────────────

/** Опции конфигурации BrowserAgent */
export interface BrowserAgentOptions {
  /** Браузерный шлюз (DI). Без него fetch-page и браузерные fallback'и недоступны */
  browserGateway?: BrowserGatewayLike | null;
  /** Провайдер новостей (DI); по умолчанию — DefaultNewsProvider */
  newsProvider?: NewsProviderLike;
  /** Провайдер цен (DI); по умолчанию — DefaultPriceProvider (MOEX ISS) */
  priceProvider?: PriceProviderLike;
  /** Кэш новостей (DI, опционально); по умолчанию не используется */
  newsCache?: NewsCacheLike;
  /** Белый список доменов для fetch-page (по умолчанию DEFAULT_ALLOWED_DOMAINS) */
  allowedDomains?: string[];
  /** Только https для fetch-page (по умолчанию true) */
  httpsOnly?: boolean;
  /** Лимит контента страницы, символов (по умолчанию 200 КБ) */
  maxContentBytes?: number;
  /** Лимит сниппета страницы, символов (по умолчанию 1000) */
  maxPageSnippetChars?: number;
  /** Таймаут внешних вызовов, мс (по умолчанию 15000) */
  timeoutMs?: number;
  /** Интервал между источниками в refresh, мс (по умолчанию 250) */
  refreshIntervalMs?: number;
  /** TTL кэша refresh, мс (по умолчанию 60000) */
  refreshCacheTtlMs?: number;
}

/** Запись кэша refresh */
interface RefreshCacheEntry {
  output: BrowserAgentOutput;
  cachedAt: number;
}

/**
 * BrowserAgent — веб-мониторинг: поиск, парсинг страниц, цены, новости, refresh.
 */
export class BrowserAgent extends AgentBase {
  private readonly browserGateway: BrowserGatewayLike | null;
  private readonly newsProvider: NewsProviderLike;
  private readonly priceProvider: PriceProviderLike;
  private readonly newsCache?: NewsCacheLike;
  private readonly allowedDomains: string[];
  private readonly httpsOnly: boolean;
  private readonly maxContentBytes: number;
  private readonly maxPageSnippetChars: number;
  private readonly requestTimeoutMs: number;
  private readonly refreshIntervalMs: number;
  private readonly refreshCacheTtlMs: number;
  private readonly refreshCache = new Map<string, RefreshCacheEntry>();

  constructor(config: AgentConfig, options: BrowserAgentOptions = {}) {
    super(config);
    this.browserGateway = options.browserGateway ?? null;
    this.newsProvider = options.newsProvider ?? new DefaultNewsProvider();
    this.priceProvider = options.priceProvider ?? new DefaultPriceProvider();
    this.newsCache = options.newsCache;
    this.allowedDomains = options.allowedDomains?.length
      ? options.allowedDomains
      : [...DEFAULT_ALLOWED_DOMAINS];
    this.httpsOnly = options.httpsOnly ?? true;
    this.maxContentBytes = options.maxContentBytes ?? MAX_CONTENT_BYTES;
    this.maxPageSnippetChars =
      options.maxPageSnippetChars ?? MAX_PAGE_SNIPPET_CHARS;
    this.requestTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.refreshIntervalMs =
      options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.refreshCacheTtlMs =
      options.refreshCacheTtlMs ?? DEFAULT_REFRESH_CACHE_TTL_MS;
  }

  /** Размер кэша refresh (диагностика/тесты) */
  get refreshCacheSize(): number {
    return this.refreshCache.size;
  }

  protected async executeInternal(input: unknown): Promise<BrowserAgentOutput> {
    const request = input as BrowserAgentInput;
    if (!request || typeof request !== 'object') {
      throw new Error('BrowserAgent: входные данные отсутствуют');
    }
    switch (request.action) {
      case 'search':
        return this.search(request);
      case 'fetch-page':
        return this.fetchPage(request);
      case 'prices':
        return this.prices(request);
      case 'news':
        return this.news(request);
      case 'refresh':
        return this.refresh(request);
      default:
        throw new Error(
          `BrowserAgent: неизвестное действие: ${String(request.action)}`,
        );
    }
  }

  /**
   * Автоматическое обновление данных: последовательный опрос источников
   * с интервалами, дедупликация и кэширование по fingerprint входных данных.
   * Повторный вызов с теми же параметрами в пределах TTL не дублирует результаты.
   */
  async refresh(input: BrowserAgentInput): Promise<BrowserAgentOutput> {
    const sources = this.normalizeRefreshSources(input.sources);
    const limit = input.limit ?? DEFAULT_LIMIT;
    const key = this.refreshKey(input, sources);

    const cached = this.refreshCache.get(key);
    if (cached && Date.now() - cached.cachedAt < this.refreshCacheTtlMs) {
      return cached.output;
    }

    const seen = new Set<string>();
    const all: WebResult[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]!;
      const partial = await this.runRefreshSource(source, input);
      if (partial.warning) {
        warnings.push(`[${source}] ${partial.warning}`);
      }
      for (const item of partial.items) {
        const dedupeKey = (item.url ?? item.title ?? '').toLowerCase().trim();
        if (!dedupeKey || seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        all.push(item);
      }
      if (i < sources.length - 1 && this.refreshIntervalMs > 0) {
        await sleep(this.refreshIntervalMs);
      }
    }

    const output: BrowserAgentOutput = {
      action: 'refresh',
      items: all.slice(0, limit),
      source: `refresh:${sources.join('+')}`,
      warning: warnings.length > 0 ? warnings.join('; ') : undefined,
      message:
        warnings.length > 0
          ? 'refresh: частичные данные'
          : 'refresh: данные обновлены',
      timestamp: nowIso(),
    };

    this.refreshCache.set(key, { output, cachedAt: Date.now() });
    if (this.refreshCache.size > MAX_REFRESH_CACHE_ENTRIES) {
      const oldest = this.refreshCache.keys().next().value;
      if (oldest !== undefined) {
        this.refreshCache.delete(oldest);
      }
    }
    return output;
  }

  // ── Действия ──

  /** search: поиск по новостным источникам (API-провайдер) */
  private async search(input: BrowserAgentInput): Promise<BrowserAgentOutput> {
    const query = input.query?.trim() ?? '';
    if (!query) {
      return this.noData('search', 'search: не указан query');
    }
    const limit = input.limit ?? DEFAULT_LIMIT;
    let items: WebResult[] = [];
    let warning: string | undefined;
    try {
      items = await this.newsProvider.fetchNews(query, {
        limit,
        sources: input.sources,
      });
    } catch (error) {
      warning = `search: провайдер новостей недоступен (${errMessage(error)})`;
    }
    items = dedupeWebResults(items, limit);
    if (items.length === 0) {
      warning = warning ?? 'search: нет данных по запросу';
      return {
        action: 'search',
        items,
        source: 'no-data',
        warning,
        message: 'search: нет данных',
        timestamp: nowIso(),
      };
    }
    return {
      action: 'search',
      items,
      source: 'news:api',
      warning,
      message: `search: найдено результатов: ${items.length}`,
      timestamp: nowIso(),
    };
  }

  /** fetch-page: парсинг страницы через браузерный шлюз (whitelist + лимиты + таймаут) */
  private async fetchPage(
    input: BrowserAgentInput,
  ): Promise<BrowserAgentOutput> {
    const url = input.url?.trim();
    if (!url) {
      return this.noData('fetch-page', 'fetch-page: не указан url');
    }

    const check = isUrlAllowed(url, this.allowedDomains, this.httpsOnly);
    if (!check.allowed) {
      return {
        action: 'fetch-page',
        items: [],
        source: 'deny',
        warning: `fetch-page: домен не в белом списке: ${check.reason}`,
        message: 'fetch-page: доступ запрещён',
        timestamp: nowIso(),
      };
    }

    if (!this.browserGateway) {
      return this.noData(
        'fetch-page',
        'fetch-page: браузерный шлюз не настроен (DI: browserGateway)',
      );
    }

    try {
      const page = await withTimeout(
        this.browserGateway.navigate(url, {
          timeoutMs: this.requestTimeoutMs,
          maxContentBytes: this.maxContentBytes,
        }),
        this.requestTimeoutMs,
        'fetch-page',
      );
      const text = truncate(page.text, this.maxContentBytes);
      return {
        action: 'fetch-page',
        items: [
          {
            title: page.title,
            url: page.url,
            snippet: text.slice(0, this.maxPageSnippetChars),
          },
        ],
        source: 'browser:gateway',
        message: 'fetch-page: страница загружена',
        timestamp: nowIso(),
      };
    } catch (error) {
      return this.noData('fetch-page', `fetch-page: ${errMessage(error)}`);
    }
  }

  /** prices: API-провайдер → fallback браузер (withFallback из circuit-breaker) */
  private async prices(input: BrowserAgentInput): Promise<BrowserAgentOutput> {
    const tickers = (input.tickers ?? [])
      .map((ticker) => ticker.trim())
      .filter((ticker) => ticker.length > 0);
    if (tickers.length === 0) {
      return this.noData('prices', 'prices: не указаны tickers');
    }

    const fallbacks: Array<() => Promise<WebResult[]>> = [];
    if (this.browserGateway) {
      fallbacks.push(() => this.browserPrices(tickers));
    }

    try {
      const result = await withFallback(
        () =>
          this.priceProvider.getPrices(tickers, {
            timeoutMs: this.requestTimeoutMs,
          }),
        fallbacks,
        { labels: ['api:moex', 'browser:gateway'] },
      );
      return {
        action: 'prices',
        items: dedupeWebResults(result.value, input.limit),
        source: result.source,
        message: `prices: получено цен: ${result.value.length}`,
        timestamp: nowIso(),
      };
    } catch (error) {
      return this.noData('prices', `prices: нет данных (${errMessage(error)})`);
    }
  }

  /** news: провайдер (API) → браузерный RSS fallback → кэш → «нет данных» */
  private async news(input: BrowserAgentInput): Promise<BrowserAgentOutput> {
    const query = input.query?.trim() ?? '';
    const limit = input.limit ?? DEFAULT_LIMIT;
    let items: WebResult[] = [];
    let warning: string | undefined;

    try {
      items = await this.newsProvider.fetchNews(query, {
        limit,
        sources: input.sources,
      });
    } catch (error) {
      warning = `news: провайдер новостей недоступен (${errMessage(error)})`;
    }
    items = dedupeWebResults(items, limit);

    let sourceLabel = 'news:api';
    if (items.length === 0 && this.browserGateway) {
      try {
        const browserItems = await this.browserNews(query, limit);
        if (browserItems.length > 0) {
          items = browserItems;
          sourceLabel = 'news:browser';
        }
      } catch {
        // Браузерный RSS недоступен — идём к кэшу/«нет данных»
      }
    }

    if (items.length === 0 && this.newsCache) {
      const cached = this.newsCache.getLatest(limit);
      if (cached.length > 0) {
        items = cached
          .map((item) => ({
            title: item.title,
            url: item.url,
            snippet: item.description,
            publishedAt: item.date,
          }))
          .slice(0, limit);
        sourceLabel = 'news:cache';
        warning = 'новости из кэша (свежие недоступны)';
      }
    }

    if (items.length > 0 && this.newsCache) {
      for (const item of items) {
        this.newsCache.add(
          {
            title: item.title,
            description: item.snippet,
            url: item.url,
            date: item.publishedAt,
          },
          item.ticker ? [item.ticker] : [],
        );
      }
    }

    if (items.length === 0) {
      warning = warning ?? 'news: нет данных';
      sourceLabel = 'no-data';
    }

    return {
      action: 'news',
      items,
      source: sourceLabel,
      warning,
      message:
        sourceLabel === 'no-data'
          ? 'news: нет данных'
          : 'news: новости собраны',
      timestamp: nowIso(),
    };
  }

  // ── Вспомогательные методы ──

  /** Fallback цен: навигация по MOEX ISS JSON через браузерный шлюз */
  private async browserPrices(tickers: string[]): Promise<WebResult[]> {
    if (!this.browserGateway) {
      throw new Error('browser-gateway не настроен');
    }
    const out: WebResult[] = [];
    for (const ticker of tickers) {
      const url =
        'https://iss.moex.com/iss/engines/stock/markets/shares/' +
        `boards/TQBR/securities/${encodeURIComponent(ticker)}.json?iss.only=marketdata`;
      try {
        const page = await withTimeout(
          this.browserGateway.navigate(url, {
            timeoutMs: this.requestTimeoutMs,
            maxContentBytes: this.maxContentBytes,
          }),
          this.requestTimeoutMs,
          'navigate',
        );
        const price = parseMoexMarketDataPrice(page.text, ticker);
        if (price !== null) {
          out.push({ ticker, price, title: `${ticker}`, url });
        }
      } catch {
        // Тикер пропущен (браузер тоже не дал данные — не выдумываем)
      }
    }
    return out;
  }

  /** Fallback новостей: RSS-ленты через браузерный шлюз */
  private async browserNews(
    query: string,
    limit?: number,
  ): Promise<WebResult[]> {
    if (!this.browserGateway) return [];
    const out: WebResult[] = [];
    for (const feed of DEFAULT_RSS_FEEDS) {
      const check = isUrlAllowed(feed.url, this.allowedDomains, this.httpsOnly);
      if (!check.allowed) continue;
      try {
        const page = await withTimeout(
          this.browserGateway.navigate(feed.url, {
            timeoutMs: this.requestTimeoutMs,
            maxContentBytes: this.maxContentBytes,
          }),
          this.requestTimeoutMs,
          'navigate-rss',
        );
        const parsed = parseRssItemsFromText(page.text);
        for (const item of parsed) {
          if (
            query &&
            !matchesQuery(`${item.title} ${item.description}`, query)
          ) {
            continue;
          }
          out.push({
            title: item.title,
            url: item.link,
            snippet: item.description.slice(0, 300),
            publishedAt: item.pubDate || undefined,
          });
        }
      } catch {
        // Лента недоступна — следующая
      }
    }
    return dedupeWebResults(out, limit);
  }

  /** Честный результат «нет данных» */
  private noData(
    action: BrowserAgentAction,
    warning: string,
  ): BrowserAgentOutput {
    return {
      action,
      items: [],
      source: 'no-data',
      warning,
      message: warning,
      timestamp: nowIso(),
    };
  }

  /** Нормализовать список источников refresh (неизвестные отбрасываются) */
  private normalizeRefreshSources(sources?: string[]): string[] {
    const requested = (sources ?? []).filter((s) =>
      REFRESH_SOURCE_ACTIONS.has(s),
    );
    const result =
      requested.length > 0 ? requested : [...DEFAULT_REFRESH_SOURCES];
    return Array.from(new Set(result));
  }

  /** Fingerprint входных данных для кэша refresh */
  private refreshKey(input: BrowserAgentInput, sources: string[]): string {
    return JSON.stringify([
      input.query ?? '',
      (input.tickers ?? []).join(','),
      input.url ?? '',
      sources.join(','),
    ]);
  }

  /** Выполнить один источник refresh */
  private async runRefreshSource(
    source: string,
    input: BrowserAgentInput,
  ): Promise<BrowserAgentOutput> {
    switch (source) {
      case 'search':
        return this.search(input);
      case 'news':
        return this.news(input);
      case 'prices':
        return this.prices(input);
      case 'fetch-page':
        if (!input.url) {
          return this.noData(
            'fetch-page',
            'refresh: fetch-page без url пропущен',
          );
        }
        return this.fetchPage(input);
      default:
        return this.noData(
          'refresh',
          `refresh: неизвестный источник ${source}`,
        );
    }
  }
}

/** Фабрика-алиас: createBrowserAgent(config, options) === new BrowserAgent(config, options) */
export function createBrowserAgent(
  config: AgentConfig,
  options?: BrowserAgentOptions,
): BrowserAgent {
  return new BrowserAgent(config, options);
}
