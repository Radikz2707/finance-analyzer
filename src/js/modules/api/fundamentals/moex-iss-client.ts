/**
 * Клиент MOEX ISS (https://iss.moex.com/iss).
 *
 * Официальный бесплатный API без ключа. Используется как основной источник:
 * - котировки и история цен;
 * - дивидендный календарь;
 * - отчётность (если ISS отдаёт её для бумаги).
 *
 * Все методы отказоустойчивы: при недоступности/изменении формата
 * возвращается null, а не выдуманные нули.
 */

import type {
  MoexDividendRecord,
  MoexQuoteSnapshot,
  MoexReportRecord,
  MoexSecurityInfo,
  MoexCouponRecord,
} from './types.js';
import type { OHLCVBar } from '../../data/data-fetcher/contracts.js';
import { getFundamentalsConfig } from './config.js';

const MOEX_BASE = 'https://iss.moex.com/iss';

interface IssTable {
  columns: string[];
  data: unknown[][];
}

/** Извлечь таблицу по имени из ответа MOEX ISS. */
export function getIssTable(
  payload: unknown,
  tableName: string,
): IssTable | null {
  if (!payload || typeof payload !== 'object') return null;
  const table = (payload as Record<string, unknown>)[tableName];
  if (!table || typeof table !== 'object') return null;

  const columns = (table as Record<string, unknown>).columns;
  const data = (table as Record<string, unknown>).data;
  if (!Array.isArray(columns) || !Array.isArray(data)) return null;

  return {
    columns: columns.map((column) => String(column)),
    data: data as unknown[][],
  };
}

/** Преобразовать таблицу ISS в массив объектов. */
export function issRows(
  table: IssTable | null,
): Array<Record<string, unknown>> {
  if (!table) return [];
  return table.data.map((row) => {
    const record: Record<string, unknown> = {};
    table.columns.forEach((column, index) => {
      record[column] = row[index] ?? null;
    });
    return record;
  });
}

/** Безопасно привести значение к числу. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function normalizePath(endpoint: string): string {
  const clean = endpoint.replace(/^\/+/, '');
  return clean.endsWith('.json') ? clean : `${clean}.json`;
}

/** Выполнить запрос к ISS. Возвращает JSON или null. */
async function fetchIssJson(
  endpoint: string,
  params: Record<string, string> = {},
): Promise<unknown | null> {
  const config = getFundamentalsConfig();
  const url = new URL(`${MOEX_BASE}/${normalizePath(endpoint)}`);
  url.searchParams.set('iss.meta', 'off');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      config.requestTimeoutMs,
    );
    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': config.userAgent,
        },
      });

      if (!response.ok) {
        if (response.status >= 500 && attempt < maxAttempts) continue;
        console.warn(
          `[MOEX ISS] ${endpoint}: HTTP ${response.status} ${response.statusText}`,
        );
        return null;
      }

      const contentType = response.headers?.get?.('content-type') ?? '';
      if (contentType && !contentType.toLowerCase().includes('json')) {
        console.warn(
          `[MOEX ISS] ${endpoint}: неожиданный Content-Type ${contentType}`,
        );
        return null;
      }

      return (await response.json()) as unknown;
    } catch (error) {
      if (attempt < maxAttempts) continue;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[MOEX ISS] ${endpoint}: ${message}`);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return null;
}

/** Описание бумаги: ISIN, объём выпуска, номинал, короткое имя. */
export async function fetchMoexSecurityInfo(
  secid: string,
): Promise<MoexSecurityInfo | null> {
  const ticker = secid.trim().toUpperCase();
  if (!ticker) return null;

  const payload = await fetchIssJson(
    `securities/${encodeURIComponent(ticker)}`,
  );
  if (!payload) return null;

  const description = issRows(getIssTable(payload, 'description'));
  if (description.length === 0) return null;

  const byName = new Map<string, unknown>();
  for (const row of description) {
    const name =
      typeof row['name'] === 'string' ? row['name'].toUpperCase() : '';
    if (name) byName.set(name, row['value']);
  }

  const boards = issRows(getIssTable(payload, 'boards'));
  const primaryBoard =
    boards.find((row) => row['is_primary'] === 1) ??
    boards.find((row) => row['boardid'] === 'TQBR') ??
    boards[0];

  return {
    secid: ticker,
    shortName:
      typeof byName.get('SHORTNAME') === 'string'
        ? String(byName.get('SHORTNAME'))
        : null,
    isin:
      typeof byName.get('ISIN') === 'string'
        ? String(byName.get('ISIN'))
        : null,
    issueSize: toNumber(byName.get('ISSUESIZE')),
    faceValue: toNumber(byName.get('FACEVALUE')),
    board:
      typeof primaryBoard?.['boardid'] === 'string'
        ? String(primaryBoard['boardid'])
        : null,
  };
}

/** Текущая котировка и капитализация. */
export async function fetchMoexQuote(
  secid: string,
): Promise<MoexQuoteSnapshot | null> {
  const ticker = secid.trim().toUpperCase();
  if (!ticker) return null;

  const payload = await fetchIssJson(
    `engines/stock/markets/shares/boards/TQBR/securities/${encodeURIComponent(ticker)}`,
  );
  if (!payload) return null;

  const securities = issRows(getIssTable(payload, 'securities'));
  const marketData = issRows(getIssTable(payload, 'marketdata'));
  if (securities.length === 0) return null;

  const security = securities[0] ?? {};
  const market = marketData[0] ?? {};

  const price =
    toNumber(market['LAST']) ??
    toNumber(market['MARKETPRICE']) ??
    toNumber(security['PREVPRICE']);
  if (price === null || price <= 0) return null;

  const issueSize = toNumber(security['ISSUESIZE']);
  const marketCap =
    toNumber(market['ISSUECAPITALIZATION']) ??
    toNumber(security['ISSUECAPITALIZATION']) ??
    (issueSize !== null && issueSize > 0 ? price * issueSize : null);

  return {
    secid: ticker,
    price,
    marketCap,
    volume: toNumber(market['VOLTODAY']) ?? toNumber(market['VOL']) ?? null,
    turnover:
      toNumber(market['VALTODAY']) ?? toNumber(market['TURNOVER']) ?? null,
    asOf: new Date().toISOString(),
  };
}

/** История дневных котировок. */
export async function fetchMoexHistory(
  secid: string,
  from: string,
  to: string,
): Promise<OHLCVBar[]> {
  const ticker = secid.trim().toUpperCase();
  if (!ticker) return [];

  const payload = await fetchIssJson(
    `history/engines/stock/markets/shares/boards/TQBR/securities/${encodeURIComponent(ticker)}`,
    { from, to, 'iss.only': 'history' },
  );
  if (!payload) return [];

  const rows = issRows(getIssTable(payload, 'history'));
  const bars: OHLCVBar[] = [];
  for (const row of rows) {
    const date = typeof row['TRADEDATE'] === 'string' ? row['TRADEDATE'] : '';
    const close = toNumber(row['CLOSE']) ?? toNumber(row['LEGALCLOSEPRICE']);
    if (!date || close === null || close <= 0) continue;
    bars.push({
      date,
      open: toNumber(row['OPEN']) ?? close,
      high: toNumber(row['HIGH']) ?? close,
      low: toNumber(row['LOW']) ?? close,
      close,
      volume: toNumber(row['VOLUME']) ?? 0,
    });
  }
  return bars;
}

/**
 * Дивиденды по бумаге.
 *
 * ВАЖНО (диагностика 2026-11-18): публичный ISS больше не отдаёт таблицу
 * `dividends` по пути `securities/{SECID}/dividends.json` — на запрос
 * приходит HTTP 200 с таблицами `description` и `boards` (карточка бумаги).
 * Это НЕ сетевая ошибка: подресурс удалён из публичного контура, данные
 * дивидендов остались только в закрытом `/iss/cci/corp-actions/dividends`
 * (отдаёт HTML, анонимно недоступен).
 *
 * Поэтому отсутствие таблицы `dividends` трактуется как UNAVAILABLE (null),
 * а вызывающий код обязан использовать резервный источник (smart-lab).
 *
 * Возвращает:
 * - массив записей, если ISS отдал таблицу `dividends`;
 * - [] — если таблица есть, но выплат нет;
 * - null — если endpoint недоступен/подресурс удалён/формат изменился.
 */
export async function fetchMoexDividends(
  secid: string,
): Promise<MoexDividendRecord[] | null> {
  const ticker = secid.trim().toUpperCase();
  if (!ticker) return null;

  const payload = await fetchIssJson(
    `securities/${encodeURIComponent(ticker)}/dividends`,
  );
  if (!payload) return null;

  const table = getIssTable(payload, 'dividends');
  if (!table) {
    // ISS вернул карточку бумаги вместо дивидендов — подресурс удалён.
    const hasSecurityCard =
      getIssTable(payload, 'description') !== null ||
      getIssTable(payload, 'boards') !== null;
    console.warn(
      `[MOEX ISS] dividends/${ticker}: таблица "dividends" отсутствует` +
        (hasSecurityCard
          ? ' (ISS вернул description/boards — подресурс удалён из публичного API)'
          : ' (неожиданный формат ответа)'),
    );
    return null;
  }

  const records: MoexDividendRecord[] = [];
  for (const row of issRows(table)) {
    const get = (name: string): unknown => {
      if (name in row) return row[name];
      const key = Object.keys(row).find((k) => k.toUpperCase() === name);
      return key ? row[key] : null;
    };

    const registryRaw =
      get('REGISTRYCLOSEDATE') ?? get('REGISTRYDATE') ?? get('DATE');
    const declaredRaw = get('DECLAREDDATE');
    const value = toNumber(get('VALUE') ?? get('DIVIDEND'));

    records.push({
      secid: ticker,
      isin: typeof get('ISIN') === 'string' ? String(get('ISIN')) : undefined,
      registryDate:
        typeof registryRaw === 'string' ? registryRaw.slice(0, 10) : null,
      declaredDate:
        typeof declaredRaw === 'string' ? declaredRaw.slice(0, 10) : null,
      value,
      dividendType:
        typeof get('DIVIDENDTYPE') === 'string'
          ? String(get('DIVIDENDTYPE'))
          : undefined,
      period:
        typeof get('PERIOD') === 'string' ? String(get('PERIOD')) : undefined,
      currency:
        typeof get('CURRENCYID') === 'string'
          ? String(get('CURRENCYID'))
          : undefined,
    });
  }

  return records;
}

function findNumeric(
  row: Record<string, unknown>,
  names: string[],
): number | null {
  for (const name of names) {
    const direct = toNumber(row[name]);
    if (direct !== null) return direct;
    const key = Object.keys(row).find((k) => k.toUpperCase() === name);
    if (key) {
      const value = toNumber(row[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

/**
 * Отчётность эмитента.
 *
 * Возвращает:
 * - массив записей, если ISS отдал таблицу `reports`;
 * - [] — если таблица есть, но отчётов нет;
 * - null — если endpoint недоступен/формат изменился.
 */
export async function fetchMoexReports(
  secid: string,
): Promise<MoexReportRecord[] | null> {
  const ticker = secid.trim().toUpperCase();
  if (!ticker) return null;

  const payload = await fetchIssJson(
    `securities/${encodeURIComponent(ticker)}/reports`,
  );
  if (!payload) return null;

  const table = getIssTable(payload, 'reports');
  if (!table) return null;

  const records: MoexReportRecord[] = [];
  for (const row of issRows(table)) {
    const reportIdRaw = row['ID'] ?? row['REPORT_ID'] ?? row['REPORTID'];
    records.push({
      secid: ticker,
      reportId:
        reportIdRaw !== null && reportIdRaw !== undefined
          ? String(reportIdRaw)
          : undefined,
      periodYear: findNumeric(row, ['PERIOD_YEAR', 'PERIODYEAR', 'YEAR']),
      periodQuarter: findNumeric(row, [
        'PERIOD_QUARTER',
        'PERIODQUARTER',
        'QUARTER',
      ]),
      beginDate:
        typeof row['BEGIN_DATE'] === 'string'
          ? row['BEGIN_DATE']
          : typeof row['BEGINDATE'] === 'string'
            ? row['BEGINDATE']
            : null,
      endDate:
        typeof row['END_DATE'] === 'string'
          ? row['END_DATE']
          : typeof row['ENDDATE'] === 'string'
            ? row['ENDDATE']
            : null,
      reportType:
        typeof row['TYPE'] === 'string'
          ? row['TYPE']
          : typeof row['REPORT_TYPE'] === 'string'
            ? row['REPORT_TYPE']
            : undefined,
      netIncome: findNumeric(row, ['NETINCOME', 'NET_INCOME', 'PROFIT']),
      revenue: findNumeric(row, ['REVENUE', 'SALES']),
      equity: findNumeric(row, ['EQUITY', 'CAPITAL']),
      debt: findNumeric(row, ['DEBT', 'LIABILITIES', 'TOTALDEBT']),
      assets: findNumeric(row, ['ASSETS', 'TOTALASSETS']),
    });
  }

  return records;
}

/**
 * Купонный график облигации.
 *
 * Основной endpoint: /iss/securities/{SECID}/bondization.json —
 * таблица `coupons` с историей и планом выплат.
 * Резерв: /iss/securities/{SECID}/coupons.json (на части бумаг
 * публичный подресурс отдаёт только description/boards).
 *
 * Возвращает:
 * - массив записей, если ISS отдал таблицу `coupons`;
 * - [] — если таблица есть, но выплат нет;
 * - null — если endpoint недоступен/формат изменился.
 */
export async function fetchMoexCoupons(
  secid: string,
): Promise<MoexCouponRecord[] | null> {
  const ticker = secid.trim().toUpperCase();
  if (!ticker) return null;

  // bondization — актуальный публичный источник купонного графика.
  const bondization = await fetchIssJson(
    `securities/${encodeURIComponent(ticker)}/bondization`,
  );
  let table = getIssTable(bondization, 'coupons');

  // Резервный endpoint (исторический формат).
  if (!table) {
    const legacy = await fetchIssJson(
      `securities/${encodeURIComponent(ticker)}/coupons`,
    );
    table = getIssTable(legacy, 'coupons');
  }

  if (!table) {
    // Endpoint не отдаёт таблицу coupons — бумага может быть акцией
    // или endpoint недоступен.
    return null;
  }

  const records: MoexCouponRecord[] = [];
  for (const row of issRows(table)) {
    const get = (name: string): unknown => {
      if (name in row) return row[name];
      const key = Object.keys(row).find((k) => k.toUpperCase() === name);
      return key ? row[key] : null;
    };

    // bondization: coupondate + value/value_rub (на одну бумагу).
    // coupons (legacy): eventdate + eventvalue/couponvalue.
    const eventDateRaw =
      get('COUPONDATE') ??
      get('COUPON_DATE') ??
      get('EVENTDATE') ??
      get('EVENT_DATE') ??
      get('DATE');
    const eventValue = toNumber(
      get('VALUE') ??
        get('VALUE_RUB') ??
        get('EVENTVALUE') ??
        get('EVENT_VALUE'),
    );
    const couponValue = toNumber(
      get('COUPONVALUE') ??
        get('COUPON_VALUE') ??
        get('VALUE') ??
        get('VALUE_RUB'),
    );
    const couponType =
      typeof get('COUPONTYPE') === 'string'
        ? String(get('COUPONTYPE'))
        : typeof get('COUPON_TYPE') === 'string'
          ? String(get('COUPON_TYPE'))
          : null;
    const couponDays = toNumber(get('COUPONDAYS') ?? get('COUPON_DAYS'));

    records.push({
      secid: ticker,
      eventDate:
        typeof eventDateRaw === 'string' ? eventDateRaw.slice(0, 10) : null,
      eventValue,
      couponValue,
      couponType,
      couponDays,
    });
  }

  return records;
}

/** Экспорт для тестов/диагностики. */
export const __moexInternals = {
  fetchIssJson,
  normalizePath,
};
