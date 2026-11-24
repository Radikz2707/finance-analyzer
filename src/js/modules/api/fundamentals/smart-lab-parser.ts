/**
 * Чистые парсеры HTML smart-lab.ru.
 *
 * Вынесены отдельно от сетевого клиента, чтобы их можно было тестировать
 * на фикстурах без сети. Если структура страницы изменилась — парсер
 * возвращает parseOk=false и НЕ подставляет нули/прочерки вместо чисел.
 */

import type {
  SmartLabDividendRecord,
  SmartLabDividends,
  SmartLabFinancials,
} from './types.js';

/** Поля, которые не являются числовыми показателями. */
const SKIP_FIELDS = new Set([
  'date',
  'currency',
  'report_url',
  'year_report_url',
  'presentation_url',
]);

/** Поля, которые обязательны для полноценного фундаментала. */
const REQUIRED_FIELDS = [
  'revenue',
  'net_income',
  'p_e',
  'roe',
  'div_yield',
  'debt',
  'book_value',
];

/** Убрать HTML-теги и нормализовать пробелы. */
function stripTags(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Разобрать число из ячейки smart-lab. Возвращает null, если числа нет. */
export function parseSmartLabNumber(input: string): number | null {
  const text = stripTags(input)
    .replace(/₽/g, '')
    .replace(/%/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s/g, '')
    .replace(/,/g, '.');
  if (!text || ['—', '–', '-', 'n/a', 'na'].includes(text.toLowerCase())) {
    return null;
  }

  const negative = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/[()]/g, '');
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Найти таблицу по фрагменту класса. */
function extractTable(html: string, className: string): string | null {
  const openTag = new RegExp(
    `<table[^>]*class="[^"]*${className}[^"]*"[^>]*>`,
    'i',
  );
  const match = openTag.exec(html);
  if (!match || match.index === undefined) return null;

  const start = match.index;
  const end = html.indexOf('</table>', start);
  if (end < 0) return null;
  return html.slice(start, end + '</table>'.length);
}

/** Разобрать заголовок таблицы: годы + LTM. */
function parseHeaderYears(tableHtml: string): {
  years: string[];
  hasLtm: boolean;
} {
  const headerMatch = tableHtml.match(
    /<tr[^>]*class="[^"]*header_row[^"]*"[^>]*>([\s\S]*?)<\/tr>/i,
  );
  if (!headerMatch?.[1]) return { years: [], hasLtm: false };

  const years: string[] = [];
  let hasLtm = false;
  const cellRegex = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
  let cell: RegExpExecArray | null;
  while ((cell = cellRegex.exec(headerMatch[1])) !== null) {
    const text = stripTags(cell[2] ?? '');
    if (/^\d{4}$/.test(text)) years.push(text);
    if (/^LTM$/i.test(text)) hasLtm = true;
  }
  return { years, hasLtm };
}

/** Медиана значений (null, если меньше 3 чисел). */
export function median(values: Array<number | null>): number | null {
  const numbers = values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
  if (numbers.length < 3) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left === undefined || right === undefined) return null;
  return (left + right) / 2;
}

/**
 * Извлечь числовые ячейки строки (без служебных колонок).
 *
 * Важно: пустая ячейка сохраняется как null, иначе колонки «съезжают»
 * и значение одного года приписывается другому.
 */
function extractRowValues(rowHtml: string): Array<number | null> {
  const values: Array<number | null> = [];
  const cellRegex = /<td([^>]*)>([\s\S]*?)<\/td>/gi;
  let cell: RegExpExecArray | null;
  while ((cell = cellRegex.exec(rowHtml)) !== null) {
    const attrs = cell[1] ?? '';
    if (/chartrow/i.test(attrs)) continue;
    if (/ltm_spc/i.test(attrs)) continue;
    if (/colspan/i.test(attrs)) continue;
    values.push(parseSmartLabNumber(cell[2] ?? ''));
  }
  return values;
}

/**
 * Распарсить годовую финансовую страницу smart-lab.ru
 * (`https://smart-lab.ru/q/{TICKER}/f/y/`).
 */
export function parseSmartLabFinancials(
  html: string,
  ticker: string,
  asOf: string = new Date().toISOString(),
): SmartLabFinancials {
  const result: SmartLabFinancials = {
    ticker: ticker.trim().toUpperCase(),
    asOf,
    years: [],
    series: {},
    ltm: {},
    current: {},
    medians: {},
    parseOk: false,
    missingFields: [...REQUIRED_FIELDS],
  };

  const table = extractTable(html, 'financials');
  if (!table) {
    result.parseError = 'таблица финансов не найдена';
    return result;
  }

  const { years, hasLtm } = parseHeaderYears(table);
  result.years = years;
  if (years.length < 3) {
    result.parseError = 'не удалось распознать годы в заголовке таблицы';
    return result;
  }

  const rowRegex = /<tr[^>]*field="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRegex.exec(table)) !== null) {
    const field = row[1];
    const rowHtml = row[2] ?? '';
    if (!field || SKIP_FIELDS.has(field)) continue;

    const values = extractRowValues(rowHtml);
    if (values.length === 0) continue;

    const expected = years.length + (hasLtm ? 1 : 0);
    let aligned: Array<number | null> = values;
    if (aligned.length > expected) {
      aligned = aligned.slice(aligned.length - expected);
    } else if (aligned.length < expected) {
      aligned = [
        ...new Array<number | null>(expected - aligned.length).fill(null),
        ...aligned,
      ];
    }

    const yearValues = hasLtm ? aligned.slice(0, years.length) : aligned;
    const ltmValue = hasLtm ? (aligned[aligned.length - 1] ?? null) : null;

    result.series[field] = yearValues.map((value) =>
      Number.isFinite(value) ? value : null,
    );
    result.ltm[field] = ltmValue;

    const lastYearValue = [...yearValues]
      .reverse()
      .find((value) => Number.isFinite(value));
    result.current[field] =
      ltmValue !== null && Number.isFinite(ltmValue)
        ? ltmValue
        : lastYearValue !== undefined
          ? lastYearValue
          : null;

    result.medians[field] = median(result.series[field].slice(-5));
  }

  result.missingFields = REQUIRED_FIELDS.filter((field) => {
    const current = result.current[field];
    return current === null || current === undefined;
  });

  const hasKeyMultiples =
    result.current['p_e'] != null ||
    result.current['roe'] != null ||
    result.current['div_yield'] != null;
  const parsedFields = Object.keys(result.series).length;

  result.parseOk = hasKeyMultiples && parsedFields >= 3;
  if (!result.parseOk) {
    result.parseError =
      parsedFields < 3
        ? 'не удалось распознать числовые строки таблицы'
        : 'не найдены ключевые мультипликаторы (P/E, ROE, дивдоходность)';
  }

  return result;
}

/** Разобрать дату DD.MM.YYYY → YYYY-MM-DD. */
function parseRuDate(input: string): string | null {
  const match = stripTags(input).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/**
 * Распарсить дивидендную страницу smart-lab.ru
 * (`https://smart-lab.ru/q/{TICKER}/dividend/`).
 */
export function parseSmartLabDividends(
  html: string,
  ticker: string,
  asOf: string = new Date().toISOString(),
): SmartLabDividends {
  const normalizedTicker = ticker.trim().toUpperCase();
  const result: SmartLabDividends = {
    ticker: normalizedTicker,
    asOf,
    records: [],
    annualDividend: null,
    currentYield: null,
    nextRegistryDate: null,
    parseOk: false,
  };

  const table = extractTable(html, 'dividends');
  if (table) {
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let row: RegExpExecArray | null;
    while ((row = rowRegex.exec(table)) !== null) {
      const rowHtml = row[1] ?? '';
      if (/<th/i.test(rowHtml)) continue;

      const cells: string[] = [];
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cell: RegExpExecArray | null;
      while ((cell = cellRegex.exec(rowHtml)) !== null) {
        cells.push(stripTags(cell[1] ?? ''));
      }
      if (cells.length < 6) continue;

      const rowTicker = (cells[0] ?? '').toUpperCase();
      // Для префов (TATNP, SBERP) страница обыкновенной содержит строки
      // с тикером обыкновенной — разрешаем оба варианта.
      const tickerBase = normalizedTicker.replace(/P$/, '');
      const isMatch =
        rowTicker === normalizedTicker ||
        rowTicker === tickerBase;
      if (!isMatch) continue;

      const record: SmartLabDividendRecord = {
        ticker: rowTicker,
        registryDate: parseRuDate(cells[2] ?? ''),
        period: cells[3] || null,
        dividend: parseSmartLabNumber(cells[4] ?? ''),
        price: parseSmartLabNumber(cells[5] ?? ''),
        yieldPct: parseSmartLabNumber(cells[6] ?? ''),
      };
      result.records.push(record);
    }
  }

  // Сводка: «... выплатила дивиденды в размере 34.09 рублей ...
  // дивидендная доходность обыкновенной акции ... составляет 9.0%»
  const summaryMatch = html.match(
    /выплатила\s+дивиденды\s+в\s+размере\s+([\d.,]+)\s*рубл[^\s]*\s+на\s+обыкновенную\s+акцию[\s\S]*?дивидендная\s+доходность\s+обыкновенной\s+акции[\s\S]*?составляет\s+([\d.,]+)\s*%/i,
  );
  if (summaryMatch) {
    result.annualDividend = parseSmartLabNumber(summaryMatch[1] ?? '');
    result.currentYield = parseSmartLabNumber(summaryMatch[2] ?? '');
  }

  const today = new Date().toISOString().slice(0, 10);
  const futureDates = result.records
    .map((record) => record.registryDate)
    .filter((date): date is string => typeof date === 'string' && date >= today)
    .sort();
  result.nextRegistryDate = futureDates[0] ?? null;

  result.parseOk =
    result.records.length > 0 ||
    result.annualDividend !== null ||
    result.currentYield !== null;
  if (!result.parseOk) {
    result.parseError = 'дивидендная таблица не найдена или не распознана';
  }

  return result;
}
