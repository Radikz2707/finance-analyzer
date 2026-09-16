/**
 * NewsFetcher — извлечение сырых новостей из внешних источников.
 *
 * Источник: Google News RSS (публичный endpoint, без API key)
 * Base URL: https://news.google.com/rss
 * Способ запроса: GET с query параметрами
 * Формат ответа: XML (RSS 2.0) или JSON (при Accept: application/json)
 * Ограничения: rate limiting Google, требуется User-Agent
 *
 * Если источник недоступен → ошибка с diagnostic.
 * Никаких выдуманных новостей.
 */

// ──────────────────────────────────────────────
// Сырой ответ от источника
// ──────────────────────────────────────────────

/** Сырой элемент RSS-ленты */
export interface RawNewsItem {
  title: string;
  link: string;
  date: string;
  source: string;
  description: string;
}

/** Результат запроса к источнику */
export interface FetchResult {
  /** Список сырых новостей */
  items: RawNewsItem[];
  /** Метаданные источника */
  sourceName: string;
  /** Флаг успешности */
  success: boolean;
  /** Диагностическая информация при ошибке */
  diagnostic?: string;
  /** HTTP status code (если применимо) */
  httpStatus?: number;
}

// ──────────────────────────────────────────────
// Конфигурация
// ──────────────────────────────────────────────

/** Базовый URL Google News RSS */
const GOOGLE_NEWS_BASE_URL = 'https://news.google.com/rss';

/** Пользовательский User-Agent для запросов */
const USER_AGENT = 'FinanceAnalyzer/1.0';

/** Максимальное количество новостей за запрос */
const MAX_ITEMS = 50;

/** Таймаут запроса в миллисекундах */
const FETCH_TIMEOUT_MS = 10000;

// ──────────────────────────────────────────────
// Ошибки
// ──────────────────────────────────────────────

/** Ошибка при извлечении новостей */
export class NewsFetchError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
    public readonly diagnostic?: string,
  ) {
    super(message);
    this.name = 'NewsFetchError';
  }
}

// ──────────────────────────────────────────────
// Парсер RSS XML → RawNewsItem[]
// ──────────────────────────────────────────────

/**
 * Парсит RSS XML ответ в массив RawNewsItem.
 * Использует DOMParser из jsdom (Node.js 24).
 */
function parseRssXml(xml: string): RawNewsItem[] {
  const items: RawNewsItem[] = [];

  // Извлекаем <item> блоки
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const itemXml = itemMatch[1];
    const item: RawNewsItem = {
      title: extractTag(itemXml, 'title')?.trim() ?? '',
      link: extractTag(itemXml, 'link')?.trim() ?? '',
      date: extractTag(itemXml, 'pubDate')?.trim() ?? '',
      source: extractTag(itemXml, 'source')?.trim() ?? 'Google News',
      description: extractTag(itemXml, 'description')?.trim() ?? '',
    };

    // Пропускаем пустые элементы
    if (item.title && item.link) {
      items.push(item);
    }
  }

  return items;
}

/** Извлекает содержимое XML тега */
function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  if (match && match[1]) {
    // Убираем HTML-сущности
    return match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, '') // Убираем HTML-теги
      .trim();
  }
  return null;
}

// ──────────────────────────────────────────────
// Fetcher
// ──────────────────────────────────────────────

export class NewsFetcher {
  /**
   * Запросить новости по ключевому слову (тикер, имя эмитента).
   *
   * @param query — поисковый запрос (например, "SBER OR Сбербанк")
   * @returns FetchResult с сырыми данными
   * @throws NewsFetchError при ошибке сети/парсинга
   */
  async fetch(query: string): Promise<FetchResult> {
    const encodedQuery = encodeURIComponent(query);
    const url = `${GOOGLE_NEWS_BASE_URL}?q=${encodedQuery}&hl=ru&gl=RU&max=${MAX_ITEMS}&output=rss`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/xml, text/xml, */*',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Обработка HTTP ошибок
      if (!response.ok) {
        const diagnostic = `HTTP ${response.status}: ${response.statusText}`;

        // Rate limit — специфичная обработка
        if (response.status === 429) {
          throw new NewsFetchError(
            'Rate limit exceeded',
            response.status,
            diagnostic,
          );
        }

        // Другие клиентские/серверные ошибки
        throw new NewsFetchError(
          `HTTP error: ${response.status}`,
          response.status,
          diagnostic,
        );
      }

      // Парсинг ответа
      const text = await response.text();

      if (!text || text.trim().length === 0) {
        return {
          items: [],
          sourceName: 'Google News RSS',
          success: true,
          diagnostic: 'Empty response body',
        };
      }

      // Пробуем парсить как RSS XML
      const items = parseRssXml(text);

      if (items.length === 0) {
        // Проверяем, это не JSON с ошибкой
        if (text.trim().startsWith('{')) {
          throw new NewsFetchError(
            'Invalid JSON response from Google News',
            undefined,
            'Expected RSS XML but received JSON',
          );
        }

        return {
          items: [],
          sourceName: 'Google News RSS',
          success: true,
          diagnostic: 'No <item> elements found in RSS feed',
        };
      }

      return {
        items,
        sourceName: 'Google News RSS',
        success: true,
      };
    } catch (error) {
      // Сетевые ошибки / таймауты
      if (error instanceof NewsFetchError) {
        throw error;
      }

      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new NewsFetchError(
          'Network error: unable to reach Google News',
          undefined,
          'Check internet connection or DNS resolution',
        );
      }

      // Ошибки парсинга
      if (error instanceof Error && error.name === 'SyntaxError') {
        throw new NewsFetchError(
          'Failed to parse RSS response',
          undefined,
          'Malformed XML in RSS feed',
        );
      }

      // Timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NewsFetchError(
          'Request timeout',
          undefined,
          `Timeout after ${FETCH_TIMEOUT_MS}ms`,
        );
      }

      // Неизвестная ошибка
      throw new NewsFetchError(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        String(error),
      );
    }
  }
}
