/**
 * BondApi — получение справочных данных по облигациям с MOEX ISS API.
 *
 * Бесплатный API без регистрации и ключей:
 * https://iss.moex.com/iss/
 *
 * Поддерживает:
 * - Загрузку справочника всех облигаций (TQOB)
 * - Получение эмитента, купона, типа облигации
 * - Маппинг ISIN → полные данные выпуска
 * - Кэширование данных
 */

import {
  formatCalendarDate,
  parseCalendarDate,
} from '../../shared/date-utils.js';

// ──────────────────────────────────────────────
// 1. Types
// ──────────────────────────────────────────────

/** Тип купона облигации (включая серии ОФЗ и неподтверждённый). */
export type CouponType =
  | 'FIXED'
  | 'FLOATER'
  | 'FIXED_AMORTIZING'
  | 'INFLATION_LINKED'
  | 'MICROFIX'
  | 'ZERO_COUPON'
  | 'UNKNOWN';

/** Структурированные данные по облигации из MOEX */
export interface BondInfo {
  /** ISIN облигации */
  isin: string;
  /** Наименование выпуска */
  issueName: string;
  /** Наименование эмитента */
  issuerName: string;
  /** Номинал (RUB) */
  nominal: number;
  /** Купонная ставка в % годовых */
  couponRatePct: number;
  /** Тип купона */
  couponType: CouponType;
  /** Источник типа купона: description ISS или не подтверждён. */
  couponTypeSource: 'MOEX_DESCRIPTION' | 'UNKNOWN';
  /** Сырое значение типа из ISS (например, «ОФЗ-ПК»). */
  couponTypeRaw: string | null;
  /** Частота купонов в год (2 = полугодие, 4 = квартал) */
  couponFrequency: number;
  /** Дата погашения (YYYY-MM-DD) */
  maturityDate: string;
  /** Ближайшая дата выплаты купона (YYYY-MM-DD) */
  nextCouponDate: string;
  /** Спред к ключевой ставке в % (для флоатеров) */
  floatSpreadPct: number;
  /** Базовый индекс для флоатера (RU SR, Key Rate, etc.) */
  floatIndex: string;
  /** Есть опцион досрочного погашения */
  hasOption: boolean;
  /** Дата исполнения опциона (если есть) */
  callDate: string;
  /** Амортизационный график */
  hasAmortization: boolean;
  /** ИCBRR рейтинг (внутренний рейтинг МОEX) */
  icbrrRating: string;
  /** Сектор экономики */
  sector: string;
}

/** Тип купона по данным MOEX ISS (включая серии ОФЗ). */
export type IssCouponType =
  'FIXED' | 'FLOATER' | 'FIXED_AMORTIZING' | 'INFLATION_LINKED' | 'UNKNOWN';

/** Разобранный тип купона из description MOEX ISS. */
export interface IssCouponTypeInfo {
  type: IssCouponType;
  /** Сырое значение поля (например, «ОФЗ-ПК», «С плавающим купоном»). */
  raw: string | null;
  source: 'ISS_DESCRIPTION';
}

/** Текущая рыночная котировка облигации из MOEX ISS. */
export interface MoexBondQuote {
  isin: string;
  /** Номинал из MOEX (RUB) */
  nominal: number | null;
  /** Цена в % от номинала */
  pricePct: number | null;
  /** Доходность к погашению, % годовых */
  yieldPct: number | null;
  /** Купон на одну облигацию, RUB (если MOEX отдал значение) */
  couponAmount: number | null;
  /** Длительность купонного периода, дней */
  couponPeriodDays: number | null;
  /** Основная доска, с которой взята котировка */
  board: string | null;
  /** Тип купона из description ISS — данные, а не эвристика. */
  couponTypeInfo: IssCouponTypeInfo;
  asOf: string;
}

/** Кэш котировок в рамках процесса (повторные вызовы не долбят ISS). */
const bondQuoteCache = new Map<string, MoexBondQuote | null>();

/**
 * Кэш справочника облигаций в рамках процесса.
 *
 * Справочник TQOB — это ~3 400 выпусков; `parseBondsSheet()` вызывается за
 * прогон несколько раз (`parseCurrentPortfolio`, `parseAggregatedPortfolio`).
 * Без кэша каждая загрузка — отдельная волна запросов к ISS.
 */
let bondCatalogCache: BondInfo[] | null = null;

/**
 * Сбросить кэши MOEX-облигаций (для тестов и повторных прогонов в процессе).
 */
export function resetBondApiCaches(): void {
  bondCatalogCache = null;
  bondQuoteCache.clear();
}

// ──────────────────────────────────────────────
// 2. MOEX ISS API Client
// ──────────────────────────────────────────────

/** Базовый URL MOEX ISS API */
const MOEX_ISS_BASE = 'https://iss.moex.com/iss';

/** Таймаут запросов к MOEX (мс) */
const REQUEST_TIMEOUT = 15000;

/**
 * Выполнить запрос к MOEX ISS API.
 * MOEX ISS API возвращает объект { <entity>: { metadata: ..., data: ... } },
 * а не массив.
 */
async function fetchMoex(
  path: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`${MOEX_ISS_BASE}${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }

  console.log(`[BondApi] URL: ${url.toString()}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FinanceAnalyzer/1.0',
      },
    });

    console.log(`[BondApi] Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const text = await response.text();
      console.error(`[BondApi] Response body: ${text.substring(0, 500)}`);
      throw new Error(
        `MOEX API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data as Record<string, unknown>;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Преобразовать данные из MOEX в BondInfo.
 * MOEX ISS API возвращает плоские имена столбцов (без префикса securities.).
 */
function parseBondFromMoex(columns: string[], row: unknown[]): BondInfo | null {
  const get = (col: string): unknown => {
    const idx = columns.indexOf(col);
    return idx >= 0 ? row[idx] : null;
  };

  // Плоские имена столбцов из MOEX
  const isin = String(get('SECID') || '').trim();
  if (!isin || !isin.startsWith('RU00')) return null;

  // Каталог /securities.json не содержит описания выпуска, а COUPONPERIOD —
  // это число дней, а не тип. Выводить FIXED по умолчанию нельзя: именно
  // это давало ложный «Excel FIXED» для ОФЗ-ПК. Подтверждение типа —
  // только через /iss/securities/{SECID}.json (description), см.
  // parseIssCouponType / fetchMoexBondQuote.
  const couponType: CouponType = 'UNKNOWN';

  // Парсим числовые значения
  const parseNum = (val: unknown): number => {
    const n = Number(val);
    return isNaN(n) ? 0 : n;
  };

  // Парсим дату единым парсером: ISS отдаёт YYYY-MM-DD, но контракт
  // не должен зависеть от формата источника (ДД.ММ.ГГГГ тоже поддержан).
  const parseDate = (val: unknown): string => {
    return formatCalendarDate(parseCalendarDate(val)) ?? '';
  };

  return {
    isin,
    issueName: (String(get('SECNAME') || '') || '').trim(),
    issuerName: (String(get('BOARDNAME') || '') || '').trim(),
    nominal: parseNum(get('FACEVALUE')),
    couponRatePct: parseNum(get('YIELDATPREVWAPRICE')),
    couponType,
    couponTypeSource: 'UNKNOWN',
    couponTypeRaw: null,
    couponFrequency: parseNum(get('DECIMALS')) || 2,
    maturityDate: parseDate(get('MATDATE')) || '',
    nextCouponDate: parseDate(get('NEXTCOUPON')) || '',
    floatSpreadPct: parseNum(get('COUPONVALUE')),
    floatIndex: String(get('BOARDID') || '').trim(),
    hasOption: false,
    callDate: '',
    hasAmortization: false,
    icbrrRating: String(get('ICBRR') || '').trim(),
    sector: String(get('SECTOR') || '').trim(),
  };
}

// ──────────────────────────────────────────────
// 3. Main API Functions
// ──────────────────────────────────────────────

/**
 * Загрузить справочник всех облигаций с TQOB.
 *
 * Использует endpoint:
 * /engines/stock/markets/bonds/securities.json
 */
export async function fetchBondCatalog(): Promise<BondInfo[]> {
  if (bondCatalogCache) {
    console.log(
      `[BondApi] справочник из кэша процесса: ${bondCatalogCache.length} облигаций`,
    );
    return bondCatalogCache;
  }

  try {
    console.log('[BondApi] Загрузка справочника облигаций с MOEX ISS...');

    // Пробуем несколько endpoint'ов по порядку
    const endpoints = [
      '/engines/stock/markets/bonds/securities.json',
      '/securities.json',
    ];

    let data: Record<string, unknown> | null = null;
    let lastError: Error | null = null;

    for (const endpoint of endpoints) {
      try {
        console.log(`[BondApi] Пробую endpoint: ${endpoint}`);
        data = await fetchMoex(endpoint, {
          qboard: 'TQOB',
          columns:
            'SECID,SECNAME,BOARDNAME,FACEVALUE,YIELDATPREVWAPRICE,MATDATE,NEXTCOUPON,COUPONVALUE,COUPONPERIOD,ICBRR,SECTOR,DECIMALS',
        });
        if (data) {
          console.log(`[BondApi] ✅ Endpoint ${endpoint} сработал`);
          break;
        }
      } catch (err) {
        lastError = err as Error;
        console.warn(`[BondApi] Endpoint ${endpoint} не сработал: ${err}`);
      }
    }

    if (!data) {
      console.warn(
        `[BondApi] Ошибка: все endpoint'ы не сработали. Последний: ${lastError?.message}`,
      );
      return [];
    }

    const bonds: BondInfo[] = [];

    // MOEX ISS API возвращает объект: { securities: { metadata: ..., data: [[...], [...]] } }
    const sec = data['securities'] as Record<string, unknown> | undefined;
    if (!sec) {
      console.warn('[BondApi] Ошибка: нет поля securities в ответе');
      console.log('[BondApi] Ключи ответа:', Object.keys(data));
      return [];
    }

    const columns = (sec['columns'] as string[] | undefined) ?? [];
    const rowsData = (sec['data'] as unknown[][] | undefined) ?? [];

    if (
      !columns ||
      columns.length === 0 ||
      !rowsData ||
      rowsData.length === 0
    ) {
      console.warn('[BondApi] Ошибка: нет данных в ответе MOEX');
      console.log(
        '[BondApi] columns:',
        columns?.length,
        'rows:',
        rowsData?.length,
      );
      return [];
    }

    for (const row of rowsData) {
      const bond = parseBondFromMoex(columns, row as unknown[]);
      if (bond) {
        bonds.push(bond);
      }
    }

    if (bonds.length === 0 && rowsData.length > 0) {
      console.warn('[BondApi] Parse вернул 0 облигаций, отладка:');
      console.log('[BondApi] columns:', columns);
      console.log('[BondApi] first row:', rowsData[0]);
    }

    console.log(`[BondApi] ✅ Загружено ${bonds.length} облигаций`);
    if (bonds.length > 0) {
      bondCatalogCache = bonds;
    }
    return bonds;
  } catch (error) {
    console.error('[BondApi] ❌ Ошибка загрузки справочника:', error);
    return [];
  }
}

/**
 * Загрузить данные по конкретной облигации по ISIN.
 */
export async function fetchBondByIsin(isin: string): Promise<BondInfo | null> {
  try {
    const data = await fetchMoex('/securities.json', {
      'securities.id': isin,
    });

    if (!data || data.length === 0) return null;

    const item = data[0] as Record<
      string,
      { columns: string[]; data: unknown[][] }
    >;
    const columns = item?.securities?.columns;
    const rows = item?.securities?.data;

    if (!columns || !rows || rows.length === 0) return null;

    return parseBondFromMoex(columns, rows[0] as unknown[]);
  } catch (error) {
    console.error(`[BondApi] Ошибка загрузки ${isin}:`, error);
    return null;
  }
}

/**
 * Загрузить данные по списку ISIN.
 *
 * @param isins — список ISIN-кодов
 * @returns Map<ISIN, BondInfo>
 */
export async function fetchBondsByIsins(
  isins: string[],
): Promise<Map<string, BondInfo>> {
  const result = new Map<string, BondInfo>();

  // Сначала пробуем загрузить весь справочник (быстрее)
  const catalog = await fetchBondCatalog();

  if (catalog.length > 0) {
    for (const bond of catalog) {
      if (isins.includes(bond.isin)) {
        result.set(bond.isin, bond);
      }
    }

    console.log(
      `[BondApi] ✅ Найдено ${result.size} из ${isins.length} запрошенных облигаций`,
    );
    return result;
  }

  // Fallback: запрашиваем по одной
  console.log('[BondApi] ⚠️ Справочник пуст, запрашиваем по одной...');

  for (const isin of isins) {
    const bond = await fetchBondByIsin(isin);
    if (bond) {
      result.set(isin, bond);
    }
  }

  return result;
}

/**
 * Создать маппинг ISIN → эмитент для всех облигаций.
 * Используется для обогащения данных из Excel.
 */
export async function buildIssuerMap(): Promise<Map<string, string>> {
  const catalog = await fetchBondCatalog();
  const map = new Map<string, string>();

  for (const bond of catalog) {
    if (bond.issuerName) {
      map.set(bond.isin, bond.issuerName);
    }
  }

  console.log(`[BondApi] 📋 Создан маппинг эмитентов: ${map.size} облигаций`);
  return map;
}

/**
 * Обогащение данных из Excel данными с MOEX.
 *
 * @param excelBonds — Map<ISIN, BondReferenceData> из Excel
 * @returns обогащённый Map с дополнительными полями
 */
export async function enrichBondsFromMoex(
  excelBonds: Map<
    string,
    import('../../data/xlsx-parser/xlsx-parser.js').BondReferenceData
  >,
): Promise<
  Map<
    string,
    import('../../data/xlsx-parser/xlsx-parser.js').BondReferenceData & {
      moex: BondInfo | null;
    }
  >
> {
  const isins = Array.from(excelBonds.keys());
  const moexData = await fetchBondsByIsins(isins);

  const enriched = new Map<
    string,
    import('../../data/xlsx-parser/xlsx-parser.js').BondReferenceData & {
      moex: BondInfo | null;
    }
  >();

  for (const [isin, bond] of excelBonds) {
    enriched.set(isin, {
      ...bond,
      moex: moexData.get(isin) || null,
    });
  }

  console.log(`[BondApi] 🔄 Обогащено ${enriched.size} позиций`);
  return enriched;
}

interface IssTable {
  columns: string[];
  rows: unknown[][];
}

function getIssTable(
  payload: Record<string, unknown>,
  name: string,
): IssTable | null {
  const table = payload[name] as
    { columns?: string[]; data?: unknown[][] } | undefined;
  if (!table?.columns || !table.data) return null;
  return { columns: table.columns, rows: table.data };
}

/**
 * Разобрать тип купона из description MOEX ISS.
 *
 * Основной путь классификации: описание выпуска — это данные, а не эвристика
 * по размеру купона. Поле COUPONPERCENT здесь намеренно не используется:
 * процент купона не различает фиксированный и плавающий тип.
 */
export function parseIssCouponType(
  description: IssTable | null,
): IssCouponTypeInfo {
  if (!description) {
    return { type: 'UNKNOWN', raw: null, source: 'ISS_DESCRIPTION' };
  }

  const nameIndex = description.columns.indexOf('name');
  const valueIndex = description.columns.indexOf('value');
  if (nameIndex < 0 || valueIndex < 0) {
    return { type: 'UNKNOWN', raw: null, source: 'ISS_DESCRIPTION' };
  }

  const fields = new Set([
    'COUPONTYPE',
    'BONDTYPE',
    'BOND_TYPE',
    'TYPE',
    'COUPONKIND',
  ]);
  let raw: string | null = null;

  for (const row of description.rows) {
    const name = String(row[nameIndex] ?? '').toUpperCase();
    if (!fields.has(name)) continue;

    const value = String(row[valueIndex] ?? '').trim();
    if (!value) continue;
    raw ??= value;

    const normalized = value.toLowerCase();
    if (/офз-пк|плавающ|переменн|floating|float/.test(normalized)) {
      return { type: 'FLOATER', raw, source: 'ISS_DESCRIPTION' };
    }
    if (/офз-ад|амортиз|amorti/.test(normalized)) {
      return { type: 'FIXED_AMORTIZING', raw, source: 'ISS_DESCRIPTION' };
    }
    if (/офз-ин|индексир|инфляц|index/.test(normalized)) {
      return { type: 'INFLATION_LINKED', raw, source: 'ISS_DESCRIPTION' };
    }
    if (/офз-пд|фиксир|постоянн|fixed/.test(normalized)) {
      return { type: 'FIXED', raw, source: 'ISS_DESCRIPTION' };
    }
  }

  return { type: 'UNKNOWN', raw, source: 'ISS_DESCRIPTION' };
}

function tableNumber(
  table: IssTable | null,
  row: unknown[],
  column: string,
): number | null {
  if (!table) return null;
  const index = table.columns.indexOf(column);
  if (index < 0) return null;
  const value = Number(row[index]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Котировка конкретной облигации по ISIN: номинал + цена в % от номинала.
 *
 * Используется как арбитр масштаба цены и как фолбэк для нулевых цен.
 * Для бумаг вне TQOB (например, TQCB) доска берётся из `boards.is_primary`.
 */
export async function fetchMoexBondQuote(
  isin: string,
): Promise<MoexBondQuote | null> {
  const normalized = isin.trim().toUpperCase();
  if (!normalized) return null;
  if (bondQuoteCache.has(normalized)) {
    return bondQuoteCache.get(normalized) ?? null;
  }

  try {
    const info = await fetchMoex(
      `/securities/${encodeURIComponent(normalized)}.json`,
      { 'iss.meta': 'off' },
    );

    const description = getIssTable(info, 'description');
    let nominal: number | null = null;
    if (description) {
      const nameIndex = description.columns.indexOf('name');
      const valueIndex = description.columns.indexOf('value');
      for (const row of description.rows) {
        const name = String(row[nameIndex] ?? '').toUpperCase();
        if (name !== 'FACEVALUE' && name !== 'INITIALFACEVALUE') continue;
        const value = Number(row[valueIndex]);
        if (Number.isFinite(value) && value > 0) {
          nominal = value;
          if (name === 'FACEVALUE') break;
        }
      }
    }

    const boards = getIssTable(info, 'boards');
    let board: string | null = null;
    if (boards) {
      const boardIndex = boards.columns.indexOf('boardid');
      const marketIndex = boards.columns.indexOf('market');
      const primaryIndex = boards.columns.indexOf('is_primary');
      const bondBoards = boards.rows.filter(
        (row) => String(row[marketIndex] ?? '') === 'bonds',
      );
      const primary = bondBoards.find((row) => Number(row[primaryIndex]) === 1);
      const fallback = bondBoards.find((row) =>
        ['TQOB', 'TQCB'].includes(String(row[boardIndex] ?? '')),
      );
      const selected = primary ?? fallback ?? bondBoards[0];
      board = selected ? String(selected[boardIndex] ?? '') : null;
    }
    if (!board) {
      board = 'TQOB';
    }

    const quotePayload = await fetchMoex(
      `/engines/stock/markets/bonds/boards/${encodeURIComponent(board)}/securities/${encodeURIComponent(normalized)}.json`,
      { 'iss.meta': 'off' },
    );
    const securities = getIssTable(quotePayload, 'securities');
    const marketData = getIssTable(quotePayload, 'marketdata');
    const securityRow = securities?.rows[0] ?? [];
    const marketRow = marketData?.rows[0] ?? [];

    const pricePct =
      tableNumber(marketData, marketRow, 'LAST') ??
      tableNumber(marketData, marketRow, 'MARKETPRICE') ??
      tableNumber(securities, securityRow, 'PREVPRICE') ??
      tableNumber(securities, securityRow, 'PREVWAPRICE');
    const yieldPct =
      tableNumber(marketData, marketRow, 'YIELD') ??
      tableNumber(securities, securityRow, 'YIELDATPREVWAPRICE');
    const faceValue = tableNumber(securities, securityRow, 'FACEVALUE');
    const couponAmount = tableNumber(securities, securityRow, 'COUPONVALUE');
    const couponPeriodDays = tableNumber(
      securities,
      securityRow,
      'COUPONPERIOD',
    );

    const result: MoexBondQuote = {
      isin: normalized,
      nominal: faceValue ?? nominal,
      pricePct: pricePct !== null && pricePct > 0 ? pricePct : null,
      yieldPct,
      couponAmount:
        couponAmount !== null && couponAmount > 0 ? couponAmount : null,
      couponPeriodDays:
        couponPeriodDays !== null && couponPeriodDays > 0
          ? couponPeriodDays
          : null,
      board,
      // Тип купона — из description того же ответа ISS (без доп. запроса).
      couponTypeInfo: parseIssCouponType(description),
      asOf: new Date().toISOString(),
    };
    bondQuoteCache.set(normalized, result);
    return result;
  } catch (error) {
    console.warn(
      `[BondApi] MOEX quote для ${normalized} недоступен: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    bondQuoteCache.set(normalized, null);
    return null;
  }
}

/**
 * Найти котировку по произвольному идентификатору (ISIN, SECID, госрегномер
 * или название) через поиск MOEX ISS.
 *
 * Нужен как фолбэк для бумаг, которые не открываются напрямую по
 * `/securities/{id}.json`: например, ОФЗ 29027 (SU29027RMFS8) и
 * ВИС Ф БП17 (RU000A10GC20). Если прямой запрос не дал номинала,
 * поиск `q=` находит SECID/ISIN, после чего котировка запрашивается
 * по каноническому идентификатору.
 */
export async function fetchMoexBondQuoteByQuery(
  query: string,
): Promise<MoexBondQuote | null> {
  const normalized = query.trim();
  if (!normalized) return null;

  try {
    const search = await fetchMoex('/securities.json', {
      q: normalized,
      'iss.meta': 'off',
    });
    const table = getIssTable(search, 'securities');
    if (!table) return null;

    const isinIndex = table.columns.indexOf('isin');
    const secidIndex = table.columns.indexOf('secid');
    const typeIndex = table.columns.indexOf('type');
    const primaryIndex = table.columns.indexOf('is_primary');

    const bondRows = table.rows.filter((row) => {
      const type = String(row[typeIndex] ?? '').toLowerCase();
      return !type || type.includes('bond') || type.includes('облиг');
    });
    const primary = bondRows.find((row) => Number(row[primaryIndex]) === 1);
    const selected = primary ?? bondRows[0];
    if (!selected) return null;

    const isin = String(selected[isinIndex] ?? '').trim();
    const secid = String(selected[secidIndex] ?? '').trim();
    const identifier = isin || secid;
    if (!identifier) return null;

    const quote = await fetchMoexBondQuote(identifier);
    if (quote) {
      console.log(
        `[BOND_NOMINAL_FALLBACK] ${normalized} → ${identifier}: ` +
          `nominal=${quote.nominal ?? 'null'}, ` +
          `pricePct=${quote.pricePct ?? 'null'}, ` +
          `coupon=${quote.couponAmount ?? 'null'}`,
      );
    }
    return quote;
  } catch (error) {
    console.warn(
      `[BondApi] поиск ${normalized} недоступен: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

// ──────────────────────────────────────────────
// 4. Экспорт
// ──────────────────────────────────────────────

export default {
  fetchBondCatalog,
  fetchBondByIsin,
  fetchBondsByIsins,
  buildIssuerMap,
  enrichBondsFromMoex,
  fetchMoexBondQuote,
  fetchMoexBondQuoteByQuery,
};
