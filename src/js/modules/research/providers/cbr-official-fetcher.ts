/**
 * CbrOfficialFetcher — извлечение данных из ОФИЦИАЛЬНЫХ страниц Банка России.
 *
 * Источники:
 *   - KeyRate:  https://www.cbr.ru/hd_base/KeyRate/
 *   - Inflation: https://www.cbr.ru/statistics/ddkp/infl/
 *
 * Это ОФИЦИАЛЬНЫЕ страницы Банка России, а не зеркала.
 *
 * Способ запроса: GET
 * Формат ответа: HTML (таблицы)
 * Парсинг: извлечение значений из HTML-таблиц
 *
 * Если источник недоступен → ошибка с diagnostic.
 * Никаких выдуманных данных.
 */

// ──────────────────────────────────────────────
// Официальный ответ от CBR (HTML-парсинг)
// ──────────────────────────────────────────────

/** Результат запроса к официальным страницам ЦБ */
export interface CbrOfficialResult {
  /** Ключевая ставка (null если недоступно) */
  keyRate: number | null;
  /** Дата ключевой ставки */
  keyRateDate: string | null;
  /** Инфляция г/г (null если недоступно) */
  inflation: number | null;
  /** Дата инфляции */
  inflationDate: string | null;
  /** URL источника keyRate */
  keyRateUrl: string;
  /** URL источника inflation */
  inflationUrl: string;
  /** Флаг успешности */
  success: boolean;
  /** Диагностическая информация при ошибке */
  diagnostic?: string;
}

// ──────────────────────────────────────────────
// Конфигурация
// ──────────────────────────────────────────────

/** Официальная страница ключевой ставки ЦБ РФ */
const KEYRATE_URL = 'https://www.cbr.ru/hd_base/KeyRate/';

/** Официальная страница инфляции ЦБ РФ */
const INFLATION_URL = 'https://www.cbr.ru/statistics/ddkp/infl/';

/** Максимальный таймаут запроса в миллисекундах */
const FETCH_TIMEOUT_MS = 10000;

// ──────────────────────────────────────────────
// Ошибки
// ──────────────────────────────────────────────

/** Ошибка при извлечении официальных макро-данных */
export class CbrOfficialFetchError extends Error {
  constructor(
    message: string,
    public readonly diagnostic?: string,
  ) {
    super(message);
    this.name = 'CbrOfficialFetchError';
  }
}

// ──────────────────────────────────────────────
// Парсеры HTML
// ──────────────────────────────────────────────

/**
 * Извлечь ключевую ставку из HTML-таблицы.
 *
 * Ожидаемая структура:
 *   <table>...</table>
 *     <tr><th>Дата</th><th>Ставка</th></tr>
 *     <tr><td>14.09.2026</td><td>14,00</td></tr>
 *     ...
 */
function parseKeyRate(html: string): { rate: number | null; date: string | null } {
  // Ищем таблицу с данными ключевой ставки
  // Находим строки таблицы: <tr>...</tr>
  const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
  const rows: string[] = [];
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    rows.push(match[1]);
  }

  // Ищем строку с данными (не заголовки)
  // Обычно данные идут после заголовков с "Дата" и "Ставка"
  for (const row of rows) {
    // Пропускаем строки с заголовками
    if (row.toLowerCase().includes('<th') || row.toLowerCase().includes('дата') || row.toLowerCase().includes('ставка')) {
      continue;
    }

    // Ищем ячейки с данными
    const cellRegex = /<td[^>]*>(.*?)<\/td>/gis;
    const cells: string[] = [];
    let cellMatch;

    while ((cellMatch = cellRegex.exec(row)) !== null) {
      // Убираем HTML-теги из ячейки
      const cellText = cellMatch[1].replace(/<[^>]+>/g, '').trim();
      if (cellText) {
        cells.push(cellText);
      }
    }

    // Если нашли дату и ставку
    if (cells.length >= 2) {
      const dateStr = cells[0];
      const rateStr = cells[1].replace(',', '.');
      const rate = parseFloat(rateStr);

      if (!isNaN(rate) && rate > 0) {
        return { rate, date: dateStr };
      }
    }
  }

  return { rate: null, date: null };
}

/**
 * Извлечь инфляцию из HTML-таблицы.
 *
 * Ожидаемая структура:
 *   <table>...</table>
 *     <tr><th>Дата</th><th>Ключевая ставка</th><th>Инфляция</th><th>Цель</th></tr>
 *     <tr><td>08.2026</td><td>14,00</td><td>6,33</td><td>4,00</td></tr>
 *     ...
 */
function parseInflation(html: string): { rate: number | null; date: string | null } {
  // Ищем строки таблицы
  const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
  const rows: string[] = [];
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    rows.push(match[1]);
  }

  // Ищем строку с данными (не заголовки)
  for (const row of rows) {
    // Пропускаем строки с заголовками
    if (row.toLowerCase().includes('<th') || row.toLowerCase().includes('инфляция') || row.toLowerCase().includes('ключевая ставка')) {
      continue;
    }

    // Ищем ячейки с данными
    const cellRegex = /<td[^>]*>(.*?)<\/td>/gis;
    const cells: string[] = [];
    let cellMatch;

    while ((cellMatch = cellRegex.exec(row)) !== null) {
      const cellText = cellMatch[1].replace(/<[^>]+>/g, '').trim();
      if (cellText) {
        cells.push(cellText);
      }
    }

    // Инфляция — обычно 3-я колонка (индекс 2)
    // Структура: Дата | Ключевая ставка | Инфляция | Цель
    if (cells.length >= 3) {
      const dateStr = cells[0];
      // Инфляция — 3-я колонка
      const inflationStr = cells[2].replace(',', '.');
      const rate = parseFloat(inflationStr);

      if (!isNaN(rate) && rate >= 0) {
        return { rate, date: dateStr };
      }
    }
  }

  return { rate: null, date: null };
}

// ──────────────────────────────────────────────
// Fetcher
// ──────────────────────────────────────────────

export type CbrOfficialMockResult =
  | { type: 'success'; result: Omit<CbrOfficialResult, 'success'> }
  | { type: 'error'; error: Error };

export class CbrOfficialFetcher {
  /** Mock-результат для тестов (если задан, реальный fetch не выполняется) */
  private readonly _mockResult?: CbrOfficialMockResult;

  constructor(mockResult?: CbrOfficialMockResult) {
    this._mockResult = mockResult;
  }

  /**
   * Запросить данные из официальных страниц Банка России.
   *
   * @returns CbrOfficialResult с keyRate и inflation
   * @throws CbrOfficialFetchError при ошибке сети/парсинга
   */
  async fetch(): Promise<CbrOfficialResult> {
    // Mock-режим для тестов
    if (this._mockResult) {
      if (this._mockResult.type === 'error') {
        throw this._mockResult.error;
      }
      return {
        ...this._mockResult.result,
        success: true,
      };
    }
    // fetchedAt не используется — данные кэшируются на уровне API

    try {
      // Параллельный запрос к обоим официальным источникам
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const [keyRateHtml, inflationHtml] = await Promise.all([
        fetch(KEYRATE_URL, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'Accept': 'text/html' },
        }).then((r) => r.text()),
        fetch(INFLATION_URL, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'Accept': 'text/html' },
        }).then((r) => r.text()),
      ]);

      clearTimeout(timeoutId);

      // Парсин keyRate
      const keyRateParsed = parseKeyRate(keyRateHtml);

      // Парсинг inflation
      const inflationParsed = parseInflation(inflationHtml);

      // Если оба поля null → ошибка
      if (keyRateParsed.rate === null && inflationParsed.rate === null) {
        throw new CbrOfficialFetchError(
          'Failed to parse any data from official CBR pages',
          'Both keyRate and inflation parsing returned null',
        );
      }

      return {
        keyRate: keyRateParsed.rate,
        keyRateDate: keyRateParsed.date,
        inflation: inflationParsed.rate,
        inflationDate: inflationParsed.date,
        keyRateUrl: KEYRATE_URL,
        inflationUrl: INFLATION_URL,
        success: true,
      };
    } catch (error) {
      // Уже CbrOfficialFetchError
      if (error instanceof CbrOfficialFetchError) {
        throw error;
      }

      // Сетевые ошибки
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new CbrOfficialFetchError(
          'Network error: unable to reach official CBR pages',
          'Check internet connection or DNS resolution',
        );
      }

      // Timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CbrOfficialFetchError(
          'Request timeout',
          `Timeout after ${FETCH_TIMEOUT_MS}ms`,
        );
      }

      // Неизвестная ошибка
      throw new CbrOfficialFetchError(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        String(error),
      );
    }
  }
}
