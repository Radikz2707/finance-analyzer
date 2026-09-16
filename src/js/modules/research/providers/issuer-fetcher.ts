/**
 * Issuer Fetcher Adapter — абстракция для получения сырых данных
 * об эмитенте.
 *
 * Production: Finam API
 * Tests: mock adapter
 */

/** Сырые финансовые данные эмитента */
export interface RawIssuerData {
  /** Тикер */
  ticker: string;
  /** Название эмитента */
  name: string;
  /** Сырые финансовые показатели (из источника) */
  raw: Record<string, unknown>;
  /** URL источника */
  sourceUrl: string;
  /** Дата получения данных */
  fetchedAt: string;
  /** Дата последнего обновления в источнике */
  sourceDate?: string;
  /** Ошибка, если данные не получены */
  error?: string;
}

/** Адаптер получения сырых данных */
export interface IssuerFetcherAdapter {
  /**
   * Получить сырые данные об эмитенте.
   * @throws Error если источник недоступен или данные некорректны
   */
  fetch(ticker: string, name: string): Promise<RawIssuerData>;
}

/**
 * Реализация адаптера для Finam API.
 *
 * Finam API endpoint:
 *   GET https://api.finam.co/api/DocumentHistoryDesc
 *   Parameters:
 *     - instrument: тикер (SBER, GMKN, etc.)
 *     - field: колонка с фин. данными
 *     - history_periods: количество периодов
 *
 * Возвращает JSON с массивом данных и заголовками.
 */
export class FinamIssuerFetcher implements IssuerFetcherAdapter {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? 'https://api.finam.co';
  }

  async fetch(ticker: string, name: string): Promise<RawIssuerData> {
    const fetchedAt = new Date().toISOString();

    try {
      const url = new URL('/api/DocumentHistoryDesc', this.baseUrl);
      url.searchParams.set('instrument', ticker);
      url.searchParams.set('field', 'fin_data');
      url.searchParams.set('history_periods', '8');

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(15000),
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        return {
          ticker,
          name,
          raw: {},
          sourceUrl: url.toString(),
          fetchedAt,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const rawText = await response.text();
      let parsed: { data: unknown[][]; columns: string[] };

      try {
        parsed = JSON.parse(rawText);
      } catch {
        return {
          ticker,
          name,
          raw: {},
          sourceUrl: url.toString(),
          fetchedAt,
          error: 'Malformed JSON from Finam API',
        };
      }

      if (!Array.isArray(parsed.data) || parsed.data.length === 0) {
        return {
          ticker,
          name,
          raw: {},
          sourceUrl: url.toString(),
          fetchedAt,
          error: 'Empty data from Finam API',
        };
      }

      return {
        ticker,
        name,
        raw: parsed,
        sourceUrl: url.toString(),
        fetchedAt,
        sourceDate: fetchedAt,
      };
    } catch (err) {
      return {
        ticker,
        name,
        raw: {},
        sourceUrl: '',
        fetchedAt,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}
