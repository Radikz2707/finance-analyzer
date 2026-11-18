/**
 * Резолв привилегированной акции в обыкновенную того же эмитента.
 *
 * Зачем: для префов часть фундаментальных мультипликаторов публикуется
 * по обыкновенной акции эмитента. Подставлять «SBER» вместо «SBERP»
 * наугад нельзя — это исказит метрики. Основной путь — поиск через
 * MOEX ISS; конфиг-карта `preferredFallback` — только аварийный фолбэк.
 *
 * Принципы:
 * - ISS-ответ разбирается по `securities` (secid, shortname, type);
 * - преф и обыкновенная сопоставляются по имени эмитента без суффикса
 *   «-п/ап/прив»;
 * - нет пары и нет фолбэка → null (fail-closed), а не догадка;
 * - функция возвращает источник решения для атрибуции.
 */

import { PortfolioConfig } from '../../../config/portfolio-config.js';

/** Результат резолва. */
export interface PreferredResolution {
  preferredTicker: string;
  commonTicker: string | null;
  source: 'MOEX ISS' | 'CONFIG' | 'NONE';
  reason: string;
}

/** Параметры резолва (fetch/таймаут/фолбэк инъектируются в тестах). */
export interface PreferredResolverOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  fallback?: Readonly<Record<string, string>>;
}

interface IssTable {
  columns: string[];
  data: unknown[][];
}

type IssPayload = Record<string, IssTable | undefined>;

const ISS_BASE = 'https://iss.moex.com/iss';

function tableRows(
  payload: IssPayload,
  name: string,
): Array<Record<string, unknown>> {
  const table = payload[name];
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.data)) {
    return [];
  }
  return table.data.map((row) => {
    const record: Record<string, unknown> = {};
    table.columns.forEach((column, index) => {
      record[column] = row[index];
    });
    return record;
  });
}

function normalizeTicker(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ticker = value.trim().toUpperCase();
  return /^[A-Z0-9._-]+$/.test(ticker) ? ticker : null;
}

/** Имя без регистра, ё и небуквенных символов. */
function normalizeName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/g, '');
}

/**
 * Убрать из имени суффикс привилегированной акции.
 * «Сбербанк-п» → «сбербанк», «Татнефть ап» → «татнефть».
 */
function commonBaseName(shortName: string): string {
  return normalizeName(shortName).replace(/(привилегированная|прив|ап|п)$/, '');
}

function looksPreferred(shortName: string): boolean {
  const normalized = normalizeName(shortName);
  return /(привилегированная|прив|ап|п)$/.test(normalized);
}

async function fetchIssJson(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<IssPayload | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as IssPayload;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Найти обыкновенную акцию того же эмитента через MOEX ISS.
 *
 * @returns тикер обыкновенной акции или null, если пара не найдена.
 */
export async function resolvePreferredTicker(
  preferredTicker: string,
  options: PreferredResolverOptions = {},
): Promise<PreferredResolution> {
  const ticker = normalizeTicker(preferredTicker);
  const fallback = options.fallback ?? PortfolioConfig.preferredFallback;

  if (!ticker) {
    return {
      preferredTicker: (preferredTicker ?? '').trim().toUpperCase(),
      commonTicker: null,
      source: 'NONE',
      reason: 'некорректный тикер',
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs =
    options.timeoutMs ?? PortfolioConfig.moexQuotes.requestTimeoutMs;
  const url =
    `${ISS_BASE}/securities.json?q=${encodeURIComponent(ticker)}` +
    '&iss.meta=off&iss.only=securities';

  const payload = await fetchIssJson(url, fetchImpl, timeoutMs);
  const rows = tableRows(payload ?? {}, 'securities');

  const preferredRow = rows.find(
    (row) => normalizeTicker(row['secid']) === ticker,
  );
  const baseName = commonBaseName(String(preferredRow?.['shortname'] ?? ''));

  if (baseName) {
    const common = rows.find((row) => {
      const secid = normalizeTicker(row['secid']);
      const shortName = String(row['shortname'] ?? '');
      if (!secid || secid === ticker) return false;
      if (looksPreferred(shortName)) return false;
      return normalizeName(shortName) === baseName;
    });

    const commonTicker = normalizeTicker(common?.['secid']);
    if (commonTicker) {
      console.log(
        `[PREFERRED] ticker=${ticker} common=${commonTicker} source=MOEX ISS`,
      );
      return {
        preferredTicker: ticker,
        commonTicker,
        source: 'MOEX ISS',
        reason: 'обыкновенная акция того же эмитента найдена через MOEX ISS',
      };
    }
  }

  const fallbackTicker = normalizeTicker(fallback[ticker]);
  if (fallbackTicker) {
    console.log(
      `[PREFERRED] ticker=${ticker} common=${fallbackTicker} source=CONFIG`,
    );
    return {
      preferredTicker: ticker,
      commonTicker: fallbackTicker,
      source: 'CONFIG',
      reason: 'пара не найдена через MOEX ISS, использован конфиг-фолбэк',
    };
  }

  console.log(`[PREFERRED] ticker=${ticker} common=null source=NONE`);
  return {
    preferredTicker: ticker,
    commonTicker: null,
    source: 'NONE',
    reason: 'пара «преф → обыкновенная» не подтверждена',
  };
}
