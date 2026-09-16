/**
 * Finam Fetcher — получение сырых финансовых данных из Finam API.
 *
 * Источник: https://www.finam.ru/
 * Документация: /api/DocumentHistoryDesc
 *
 * НЕ используется в тестах (тесты мокают через IssuerFetcherAdapter).
 */

const FINAM_BASE_URL = 'https://api.finam.co';

/** Сырой ответ от Finam API */
export interface FinamRawResponse {
  /** Массив строк с данными */
  data: string[][];
  /** Заголовки колонок */
  columns: string[];
  /** Код ошибки, если есть */
  error?: string;
  /** Сообщение об ошибке */
  message?: string;
}

/** Параметры запроса к Finam API */
export interface FinamFetchOptions {
  /** Тикер инструмента (например, 'SBER') */
  instrument: string;
  /** Идентификатор колонки данных (fin_data) */
  dataColumn: string;
  /** Количество периодов */
  periods: number;
}

/**
 * Получить сырые финансовые данные из Finam API.
 *
 * @throws Error при HTTP-ошибке или невалидном ответе
 */
export async function fetchFinamRaw(
  options: FinamFetchOptions,
  signal?: AbortSignal,
): Promise<FinamRawResponse> {
  const url = new URL('/api/DocumentHistoryDesc', FINAM_BASE_URL);
  url.searchParams.set('instrument', options.instrument);
  url.searchParams.set('field', options.dataColumn);
  url.searchParams.set('history_periods', String(options.periods));

  const response = await fetch(url.toString(), {
    method: 'GET',
    signal,
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Finam API error: ${response.status} ${response.statusText}`,
    );
  }

  const raw = await response.text();
  let json: FinamRawResponse;

  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Finam API returned malformed response: ${raw.slice(0, 200)}`);
  }

  if (json.error || json.message) {
    throw new Error(
      `Finam API error: ${json.message || json.error}`,
    );
  }

  if (!Array.isArray(json.data) || json.data.length === 0) {
    throw new Error('Finam API returned empty data');
  }

  return json;
}
