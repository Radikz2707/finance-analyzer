/**
 * Единый безопасный парсер и форматтер календарных дат.
 *
 * Зачем отдельный модуль:
 * 1. V8 трактует строку «11.02.2027» как 2 ноября (месяц и день меняются
 *    местами) — ошибка класса «месяц ↔ день», которая тихо сдвигает даты
 *    купонов, сделок и дивидендов.
 * 2. `new Date(year, month - 1, day)` создаёт локальную полночь, поэтому
 *    `toISOString().slice(0, 10)` в зонах восточнее UTC отдаёт предыдущий
 *    день (11.02 → 10.02). Календарные даты представляются как UTC-полночь,
 *    чтобы парсинг и вывод были стабильны в любой зоне.
 *
 * Все точки входа, где даты приходят из Excel, MOEX ISS или smart-lab,
 * обязаны использовать `parseCalendarDate`, а для вывода в YYYY-MM-DD —
 * `formatCalendarDate`.
 */

/** Строгий формат ДД.ММ.ГГГГ (день и месяц первыми). */
const RU_DATE_RE = /^(\d{1,2})[.](\d{1,2})[.](\d{4})$/;

/** Календарный формат YYYY-MM-DD. */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Excel serial date для 1970-01-01 (дни от 1899-12-30). */
const EXCEL_EPOCH_SERIAL = 25569;

/**
 * Собрать UTC-полночь и проверить, что дата реальна.
 *
 * `31.02.2027` не должна превращаться в 3 марта: при несовпадении
 * компонентов возвращаем null (fail-closed).
 */
function buildUtcDate(year: number, month: number, day: number): Date | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }
  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Разобрать строку строго в формате ДД.ММ.ГГГГ.
 *
 * Отдельная функция нужна там, где формат известен: она не делает
 * «умных» fallback-ов и возвращает null для ISO-строк.
 */
export function parseRuDate(value: string | null | undefined): Date | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(RU_DATE_RE);
  if (!match) return null;
  return buildUtcDate(Number(match[3]), Number(match[2]), Number(match[1]));
}

/**
 * Разобрать календарную дату из любого источника: Excel, ISS, smart-lab.
 *
 * Поддерживает:
 * - `Date` (возвращается как есть, если валиден);
 * - число — Excel serial date;
 * - строку ДД.ММ.ГГГГ — явный разбор без участия V8;
 * - строку YYYY-MM-DD — UTC-полночь;
 * - прочие строки — `new Date` с проверкой валидности.
 */
export function parseCalendarDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const ms = Math.round((value - EXCEL_EPOCH_SERIAL) * 86400 * 1000);
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const ru = trimmed.match(RU_DATE_RE);
  if (ru) {
    return buildUtcDate(Number(ru[3]), Number(ru[2]), Number(ru[1]));
  }

  const iso = trimmed.match(ISO_DATE_RE);
  if (iso) {
    return buildUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Отформатировать дату как YYYY-MM-DD без сдвига часового пояса.
 *
 * Для календарных дат (UTC-полночь после `parseCalendarDate`) результат
 * совпадает с исходным днём в любой зоне.
 */
export function formatCalendarDate(
  value: Date | null | undefined,
): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}
