/**
 * MacroFetcher — извлечение сырых макроэкономических данных из CBR XML-Daily mirror.
 *
 * Источник: CBR XML-Daily (неофициальное зеркало)
 * Base URL: https://www.cbr-xml-daily.ru/daily_json.js
 * Способ запроса: GET
 * Формат ответа: JSON с курсами валют ЦБ
 *
 * ВАЖНО: cbr-xml-daily.ru НЕ является официальным сайтом Банка России.
 * Это неофициальное зеркало, предоставляющее данные из открытых источников ЦБ.
 *
 * Доступные поля:
 *   - USD курс
 *   - EUR курс
 *   - CNY курс
 *   - Date (дата публикации)
 *
 * НЕ доступны через API:
 *   - keyRate
 *   - inflation
 *   - oil
 *
 * Если источник недоступен → ошибка с diagnostic.
 * Никаких выдуманных данных.
 */

// ──────────────────────────────────────────────
// Сырой ответ от CBR XML-Daily
// ──────────────────────────────────────────────

/** Сырая валютная запись из ответа CBR */
export interface RawCurrency {
  ID: string;
  NumCode: string;
  CharCode: string;
  Nominal: number;
  Name: string;
  Value: number;
  Previous: number;
}

/** Сырой ответ от CBR XML-Daily */
export interface RawMacroResponse {
  Date: string;
  PreviousDate: string;
  PreviousURL: string;
  Timestamp: string;
  Valute: Record<string, RawCurrency>;
}

/** Результат запроса к источнику */
export interface MacroFetchResult {
  /** USD курс */
  usdRate?: number;
  /** EUR курс */
  eurRate?: number;
  /** CNY курс */
  cnyRate?: number;
  /** Дата публикации */
  date: string;
  /** Timestamp ЦБ */
  timestamp: string;
  /** URL источника */
  sourceUrl: string;
  /** Флаг успешности */
  success: boolean;
  /** Диагностическая информация при ошибке */
  diagnostic?: string;
}

// ──────────────────────────────────────────────
// Конфигурация
// ──────────────────────────────────────────────

/** Базовый URL CBR XML-Daily (зеркало официальных курсов ЦБ) */
const CBR_XML_DAILY_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';

/** Максимальный таймаут запроса в миллисекундах */
const FETCH_TIMEOUT_MS = 10000;

// ──────────────────────────────────────────────
// Ошибки
// ──────────────────────────────────────────────

/** Ошибка при извлечении макро-данных */
export class MacroFetchError extends Error {
  constructor(
    message: string,
    public readonly diagnostic?: string,
  ) {
    super(message);
    this.name = 'MacroFetchError';
  }
}

// ──────────────────────────────────────────────
// Fetcher
// ──────────────────────────────────────────────

export class MacroFetcher {
  /**
   * Запросить макро-данные из CBR XML-Daily.
   *
   * @returns MacroFetchResult с курсами USD/EUR/CNY
   * @throws MacroFetchError при ошибке сети/парсинга
   */
  async fetch(): Promise<MacroFetchResult> {
    const fetchedAt = new Date().toISOString();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(CBR_XML_DAILY_URL, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeoutId);

      // Обработка HTTP ошибок
      if (!response.ok) {
        const diagnostic = `HTTP ${response.status}: ${response.statusText}`;

        if (response.status === 429) {
          throw new MacroFetchError(
            'Rate limit exceeded',
            diagnostic,
          );
        }

        throw new MacroFetchError(
          `HTTP error: ${response.status}`,
          diagnostic,
        );
      }

      // Парсинг JSON
      const rawText = await response.text();

      if (!rawText || rawText.trim().length === 0) {
        return {
          date: fetchedAt,
          timestamp: fetchedAt,
          sourceUrl: CBR_XML_DAILY_URL,
          success: true,
          diagnostic: 'Empty response body from CBR XML-Daily',
        };
      }

      let parsed: RawMacroResponse;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        throw new MacroFetchError(
          'Failed to parse CBR response',
          'Malformed JSON from CBR XML-Daily',
        );
      }

      // Валидация структуры
      if (!parsed.Valute || typeof parsed.Valute !== 'object') {
        throw new MacroFetchError(
          'Invalid CBR response structure',
          'Missing Valute field in response',
        );
      }

      // Извлечение USD
      const usd = parsed.Valute.USD;
      const usdRate = usd?.Value != null ? usd.Value / usd.Nominal : undefined;

      // Извлечение EUR
      const eur = parsed.Valute.EUR;
      const eurRate = eur?.Value != null ? eur.Value / eur.Nominal : undefined;

      // Извлечение CNY
      const cny = parsed.Valute.CNY;
      const cnyRate = cny?.Value != null ? cny.Value / cny.Nominal : undefined;

      return {
        usdRate,
        eurRate,
        cnyRate,
        date: parsed.Date || fetchedAt,
        timestamp: parsed.Timestamp || fetchedAt,
        sourceUrl: CBR_XML_DAILY_URL,
        success: true,
      };
    } catch (error) {
      // Уже MacroFetchError
      if (error instanceof MacroFetchError) {
        throw error;
      }

      // Сетевые ошибки
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new MacroFetchError(
          'Network error: unable to reach CBR XML-Daily',
          'Check internet connection or DNS resolution',
        );
      }

      // Timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new MacroFetchError(
          'Request timeout',
          `Timeout after ${FETCH_TIMEOUT_MS}ms`,
        );
      }

      // Неизвестная ошибка
      throw new MacroFetchError(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        String(error),
      );
    }
  }
}
