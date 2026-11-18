/**
 * LTM-дивиденды: MOEX ISS + fallback smart-lab.ru.
 *
 * Назначение: автоматически заполнять дивидендную часть дохода, когда лист
 * «Дивиденды» в Excel пуст.
 *
 * ВАЖНО (диагностика 2026-11-18):
 * публичный endpoint MOEX ISS `securities/{SECID}/dividends.json` больше не
 * отдаёт таблицу `dividends` — ISS возвращает HTTP 200 с таблицами
 * `description` и `boards` (подресурс удалён из публичного контура).
 * Поэтому после неудачи ISS используется smart-lab.ru
 * (`/q/{TICKER}/dividend/`), который содержит историю отсечек и суммы.
 *
 * Контракт метрики:
 * - значение = сумма выплат на акцию за окно ~13 месяцев;
 * - source = MOEX_ISS | SMARTLAB;
 * - status = OK | EMPTY | UNAVAILABLE:
 *   OK         — подтверждённая сумма > 0;
 *   EMPTY      — источник(и) ответили, но выплат в окне нет;
 *   UNAVAILABLE — ни один источник не дал пригодного ответа (сеть/формат);
 * - asOf = дата последней учтённой отсечки;
 * - пустая история → ltmPerShare = null («нет подтверждённых данных»), не 0.
 *
 * Excel при заполненности остаётся приоритетным override (source=BROKER).
 */

import { PortfolioConfig } from '../../../config/portfolio-config.js';
import { isSmartLabEnabled } from '../../api/fundamentals/config.js';
import { fetchMoexDividends } from '../../api/fundamentals/moex-iss-client.js';
import { fetchSmartLabDividends } from '../../api/fundamentals/smart-lab-client.js';
import { parseCalendarDate } from '../../shared/date-utils.js';
import type {
  MoexDividendRecord,
  SmartLabDividendRecord,
} from '../../api/fundamentals/types.js';

/** Окно LTM: 13 месяцев, чтобы захватить годовую выплату с запасом. */
export const DIVIDEND_LTM_WINDOW_MONTHS = 13;

/** Итоговый статус подтверждения дивидендных данных. */
export type DividendLtmStatus = 'OK' | 'EMPTY' | 'UNAVAILABLE';

/** Источник, по которому получена подтверждённая сумма. */
export type DividendLtmSource = 'MOEX_ISS' | 'SMARTLAB' | 'UNAVAILABLE';

/** Что ответил конкретный источник. */
export type DividendSourceProbe = 'OK' | 'EMPTY' | 'UNAVAILABLE' | 'SKIPPED';

export interface DividendLtmResult {
  /** Тикер портфеля (как в QUIK). */
  ticker: string;
  /** SECID, по которому запрашивался ISS (может отличаться для префов). */
  secid: string;
  /** Сумма LTM на одну акцию, ₽. null — нет подтверждённых выплат. */
  ltmPerShare: number | null;
  /** Сколько выплат попало в окно. */
  count: number;
  /** Дата последней учтённой отсечки (YYYY-MM-DD) или null. */
  asOf: string | null;
  /** Источник подтверждённой суммы (или UNAVAILABLE). */
  source: DividendLtmSource;
  /** Явный статус: OK / EMPTY (источник ответил, выплат нет) / UNAVAILABLE. */
  status: DividendLtmStatus;
  /** Диагностика по каждому источнику — для сквозного аудита. */
  diagnostics: {
    iss: DividendSourceProbe;
    smartLab: DividendSourceProbe;
    /** Тикер, по которому опрашивался smart-lab (для префов отличается). */
    smartLabSecid: string | null;
  };
}

/**
 * Явные SECID для привилегированных бумаг.
 * QUIK может отдавать тикер с суффиксом `-п`/`_AP`, а ISS ждёт отдельный SECID.
 */
const PREFERRED_SECID_MAP: Record<string, string> = {
  SBERP: 'SBERP',
  'SBER-P': 'SBERP',
  SBER_AP: 'SBERP',
  TATNP: 'TATNP',
  'TATN-P': 'TATNP',
  TATN_AP: 'TATNP',
  SNGSP: 'SNGSP',
  'SNGS-P': 'SNGSP',
  SNGSP_AP: 'SNGSP',
  TRNFP: 'TRNFP',
  'TRNF-P': 'TRNFP',
};

/**
 * Префы на smart-lab публикуются на странице обыкновенной акции:
 * `/q/SBER/dividend/` содержит строки и SBER, и SBERP.
 * Отдельных страниц `/q/SBERP/` нет (HTTP 404).
 */
const SMARTLAB_TICKER_MAP: Record<string, string> = {
  SBERP: 'SBER',
  TATNP: 'TATN',
  SNGSP: 'SNGS',
};

// JS `\b` не работает для кириллицы — границы заданы явными проверками.
const PREFERRED_NAME_PATTERN =
  /привилег|преф|(?:^|[^А-Яа-яЁё])ап(?:$|[^А-Яа-яЁё])|[-_\s]п(?:$|[^А-Яа-яЁё])/i;

/**
 * Определить SECID для запроса дивидендов.
 *
 * - явная карта для известных префов;
 * - если в имени есть маркер привилегированной бумаги, а тикер не оканчивается
 *   на P — добавляем P (Сбербанк-п → SBERP);
 * - иначе тикер используется как есть.
 */
export function resolveDividendSecid(ticker: string, name?: string): string {
  const normalized = (ticker ?? '').trim().toUpperCase();
  if (!normalized) return '';

  const mapped = PREFERRED_SECID_MAP[normalized];
  if (mapped) return mapped;

  const isPreferred = PREFERRED_NAME_PATTERN.test(name ?? '');
  if (isPreferred && !normalized.endsWith('P')) {
    return `${normalized}P`;
  }

  return normalized;
}

/**
 * SECID → тикер smart-lab.ru.
 * Для префов smart-lab использует страницу обыкновенной акции.
 */
export function resolveSmartLabTicker(secid: string): string {
  const normalized = (secid ?? '').trim().toUpperCase();
  if (!normalized) return '';
  return SMARTLAB_TICKER_MAP[normalized] ?? normalized;
}

/** Вычесть месяцы в UTC без «переполнения» дня (31 марта − 1 мес = 28/29 фев). */
function minusMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const daysInMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, daysInMonth));
  return result;
}

/** Нижняя граница окна LTM (UTC). Экспортируется для тестов и логов. */
export function dividendLtmCutoff(now: Date = new Date()): Date {
  return minusMonthsUtc(now, DIVIDEND_LTM_WINDOW_MONTHS);
}

/**
 * Сумма LTM на акцию по записям источника.
 *
 * Учитываются только рублёвые выплаты с корректной датой отсечки внутри
 * окна [now − 13 мес; now]. Дубли (одна и та же отсечка и сумма) не
 * суммируются дважды. Пустая/битая история → null, а не 0.
 */
export function computeLtmDividends(
  records: MoexDividendRecord[] | null | undefined,
  now: Date = new Date(),
): { ltmPerShare: number | null; count: number; asOf: string | null } {
  if (!records || records.length === 0) {
    return { ltmPerShare: null, count: 0, asOf: null };
  }

  const cutoffMs = dividendLtmCutoff(now).getTime();
  const nowMs = now.getTime();

  let sum = 0;
  let count = 0;
  let asOf: string | null = null;
  const seen = new Set<string>();

  for (const record of records) {
    if (record.currency && record.currency.trim().toUpperCase() !== 'RUB') {
      continue;
    }
    const value = record.value;
    if (value === null || !Number.isFinite(value) || value <= 0) {
      continue;
    }
    if (!record.registryDate) continue;

    // Единый парсер: ISO-дата отсечки → UTC-полночь без сдвига дня.
    const date = parseCalendarDate(record.registryDate);
    if (!date) continue;
    const dateMs = date.getTime();
    if (dateMs < cutoffMs || dateMs > nowMs) continue;

    const key = `${record.registryDate}|${value}`;
    if (seen.has(key)) continue;
    seen.add(key);

    sum += value;
    count += 1;
    if (!asOf || record.registryDate > asOf) {
      asOf = record.registryDate;
    }
  }

  if (count === 0) {
    return { ltmPerShare: null, count: 0, asOf: null };
  }

  return { ltmPerShare: Math.round(sum * 100) / 100, count, asOf };
}

/** Привести записи smart-lab к общему контракту MoexDividendRecord. */
function toMoexRecords(
  records: SmartLabDividendRecord[],
  secid: string,
): MoexDividendRecord[] {
  return records
    .filter(
      (record) =>
        typeof record.registryDate === 'string' && record.registryDate !== '',
    )
    .map((record) => ({
      secid,
      registryDate: record.registryDate,
      declaredDate: null,
      value: record.dividend,
      // smart-lab публикует выплаты в рублях.
      currency: 'RUB',
      period: record.period ?? undefined,
    }));
}

/**
 * Загрузить LTM-дивиденды по тикеру портфеля.
 *
 * Порядок источников:
 * 1. MOEX ISS `securities/{SECID}/dividends` (если таблица ещё отдаётся);
 * 2. smart-lab.ru `/q/{TICKER}/dividend/` — рабочий резерв.
 *
 * Логирует `[DIVIDENDS_LTM_FETCH] ticker secid status source ltmPerShare
 * count asOf iss smartlab` для сквозного аудита. Ошибки сети не
 * пробрасываются: результат UNAVAILABLE, чтобы расчёт дохода не падал.
 */
export async function fetchDividendLtm(
  ticker: string,
  name?: string,
  now: Date = new Date(),
): Promise<DividendLtmResult> {
  const normalized = (ticker ?? '').trim().toUpperCase();
  const secid = resolveDividendSecid(normalized, name);
  const smartLabSecid = secid ? resolveSmartLabTicker(secid) : null;

  // ── 1. MOEX ISS ────────────────────────────────────────────────────────
  let issRecords: MoexDividendRecord[] | null = null;
  let issProbe: DividendSourceProbe;
  if (!secid) {
    issProbe = 'UNAVAILABLE';
  } else {
    try {
      issRecords = await fetchMoexDividends(secid);
    } catch {
      issRecords = null;
    }
    issProbe =
      issRecords === null
        ? 'UNAVAILABLE'
        : issRecords.length > 0
          ? 'OK'
          : 'EMPTY';
  }

  let computed = computeLtmDividends(issRecords, now);
  let source: DividendLtmSource =
    computed.ltmPerShare !== null ? 'MOEX_ISS' : 'UNAVAILABLE';

  // ── 2. smart-lab.ru — только если ISS не дал подтверждённой суммы ──────
  let smartLabProbe: DividendSourceProbe = 'SKIPPED';
  if (source === 'UNAVAILABLE' && smartLabSecid) {
    if (!isSmartLabEnabled()) {
      smartLabProbe = 'SKIPPED';
    } else {
      try {
        const parsed = await fetchSmartLabDividends(smartLabSecid);
        if (!parsed) {
          smartLabProbe = 'UNAVAILABLE';
        } else {
          const records = toMoexRecords(parsed.records, smartLabSecid);
          smartLabProbe = records.length > 0 ? 'OK' : 'EMPTY';
          const smartLabComputed = computeLtmDividends(records, now);
          if (smartLabComputed.ltmPerShare !== null) {
            computed = smartLabComputed;
            source = 'SMARTLAB';
          }
        }
      } catch {
        smartLabProbe = 'UNAVAILABLE';
      }
    }
  }

  // ── 3. Явный статус: OK / EMPTY / UNAVAILABLE ─────────────────────────
  const answered =
    issProbe === 'OK' ||
    issProbe === 'EMPTY' ||
    smartLabProbe === 'OK' ||
    smartLabProbe === 'EMPTY';
  const status: DividendLtmStatus =
    source !== 'UNAVAILABLE' ? 'OK' : answered ? 'EMPTY' : 'UNAVAILABLE';

  console.log(
    `[DIVIDENDS_LTM_FETCH] ticker=${normalized || 'n/a'} ` +
      `secid=${secid || 'n/a'} status=${status} source=${source} ` +
      `ltmPerShare=${computed.ltmPerShare ?? 'null'} ` +
      `count=${computed.count} asOf=${computed.asOf ?? 'n/a'} ` +
      `iss=${issProbe} smartlab=${smartLabProbe} ` +
      `slSecid=${smartLabSecid ?? 'n/a'} ` +
      `windowMonths=${DIVIDEND_LTM_WINDOW_MONTHS}`,
  );

  return {
    ticker: normalized,
    secid,
    ltmPerShare: computed.ltmPerShare,
    count: computed.count,
    asOf: computed.asOf,
    source,
    status,
    diagnostics: { iss: issProbe, smartLab: smartLabProbe, smartLabSecid },
  };
}

/** НДФЛ с дивидендов из единого конфига (не inline 0.87). */
export function dividendNdflRate(): number {
  return PortfolioConfig.tax.dividendNdflRate;
}
