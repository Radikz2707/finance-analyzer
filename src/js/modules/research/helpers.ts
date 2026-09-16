/**
 * Research Data Layer — вспомогательные функции-фабрики.
 *
 * Все значения ResearchData проходят через эти функции,
 * что гарантирует корректную структуру ResearchValue
 * и отсутствие undefined / 0 / "-" как смысловых статусов.
 */

import type { ResearchValue } from './types.js';

// ──────────────────────────────────────────────
// 1. Базовые фабрики ResearchValue
// ──────────────────────────────────────────────

/** Создать ResearchValue с измеренным значением */
export function value<T>(
  val: T,
  opts?: { unit?: string; evidenceIds?: string[] },
): ResearchValue<T> {
  return {
    status: 'VALUE',
    value: val,
    unit: opts?.unit,
    evidenceIds: opts?.evidenceIds ?? [],
  };
}

/** Создать ResearchValue со статусом NO_DATA */
export function noData(): ResearchValue<never> {
  return { status: 'NO_DATA' };
}

/** Создать ResearchValue со статусом NOT_APPLICABLE */
export function notApplicable(): ResearchValue<never> {
  return { status: 'NOT_APPLICABLE' };
}

// ──────────────────────────────────────────────
// 2. Утилиты для проверки статуса
// ──────────────────────────────────────────────

/** true если ResearchValue содержит реальное значение */
export function hasValue<T>(rv: ResearchValue<T>): rv is ResearchValue<T> & { value: T } {
  return rv.status === 'VALUE';
}

/** Извлечь значение или вернуть defaultValue если NO_DATA / NOT_APPLICABLE */
export function getOr<T>(rv: ResearchValue<T>, defaultValue: T): T {
  if (rv.status === 'VALUE') {
    return rv.value;
  }
  return defaultValue;
}

/** Извлечь значение или undefined (только для совместимости с существующим кодом) */
export function getUnsafe<T>(rv: ResearchValue<T>): T | undefined {
  if (rv.status === 'VALUE') {
    return rv.value;
  }
  return undefined;
}

// ──────────────────────────────────────────────
// 3. Фабрики для числовых показателей
// ──────────────────────────────────────────────

/** Числовой показатель с процентом */
export function pct(inputValue: number | null, opts?: { evidenceIds?: string[] }): ResearchValue<number> {
  if (inputValue === null) return noData();
  return value(inputValue, { unit: '%', ...opts });
}

/** Числовой показатель в рублях */
export function rub(inputValue: number | null, opts?: { evidenceIds?: string[] }): ResearchValue<number> {
  if (inputValue === null) return noData();
  return value(inputValue, { unit: 'RUB', ...opts });
}

/** Числовой показатель без единицы */
export function raw(inputValue: number | null, opts?: { evidenceIds?: string[] }): ResearchValue<number> {
  if (inputValue === null) return noData();
  return value(inputValue, { ...opts });
}

/** Числовой показатель с произвольной единицей */
export function measure(
  inputValue: number | null,
  unit: string,
  opts?: { evidenceIds?: string[] },
): ResearchValue<number> {
  if (inputValue === null) return noData();
  return value(inputValue, { unit, ...opts });
}

// ──────────────────────────────────────────────
// 4. Фабрики для строковых показателей
// ──────────────────────────────────────────────

/** Строковой показатель */
export function str(
  text: string | null,
  opts?: { evidenceIds?: string[] },
): ResearchValue<string> {
  if (text === null || text.trim() === '') return noData();
  return value(text.trim(), { ...opts });
}

// ──────────────────────────────────────────────
// 5. Фабрики для булевых показателей
// ──────────────────────────────────────────────

/** Булев показатель */
export function bool(
  flag: boolean | null,
  opts?: { evidenceIds?: string[] },
): ResearchValue<boolean> {
  if (flag === null) return noData();
  return value(flag, { ...opts });
}

// ──────────────────────────────────────────────
// 6. Фабрики для массивов
// ──────────────────────────────────────────────

/** Массивовой показатель (строки, числа и т.д.) */
export function arr<T>(
  items: T[] | null,
  opts?: { evidenceIds?: string[] },
): ResearchValue<T[]> {
  if (items === null || items.length === 0) return noData();
  return value([...items], { ...opts });
}

// ──────────────────────────────────────────────
// 7. Фабрики для записей (Record)
// ──────────────────────────────────────────────

/** Показатель-запись (например, sectorExposure) */
export function rec<T extends Record<string, number>>(
  data: T | null,
  opts?: { evidenceIds?: string[] },
): ResearchValue<T> {
  if (data === null || Object.keys(data).length === 0) return noData();
  return value({ ...data }, { ...opts });
}
