/**
 * Cron-утилиты конвейера (лёгкий модуль без зависимостей).
 *
 * Вынесены из pipeline-scheduler.ts, чтобы SchedulerAgent мог переиспользовать
 * парсер/расчёт следующего запуска БЕЗ импорта тяжёлого графа
 * PipelineCoordinator (агенты + ai-memory/SQLite) — тесты остаются
 * без сети и БД.
 *
 * Поддерживается:
 *   - Фиксированные значения: 0, 15, 30
 *   - Звёздочка: * (любое значение)
 *   - Списки: 0,15,30,45
 *   - Диапазоны: 1-5
 *
 * Формат: "минута час день_месяца месяц день_недели"
 * Пример: "0 9 * * 1-5" — каждый будний день в 9:00
 *
 * Честные ограничения:
 *   - Ровно 5 полей (секунды/шаги/имена месяцев НЕ поддерживаются);
 *   - день_недели: 0 (воскресенье) … 6 (суббота), без «7»;
 *   - нет комбинаторики «день месяца ИЛИ день недели» (OR-семантика
 *     стандартного cron) — совпадение требуется по ВСЕМ полям (AND);
 *   - поиск nextCronRun ограничен горизонтом 1 год (~525600 минут).
 */

export interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

/** Разобрать cron-выражение из 5 полей в наборы допустимых значений. */
export function parseCron(cron: string): CronFields {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: "${cron}". Expected 5 fields.`);
  }

  return {
    minute: parseField(parts[0]!, 0, 59),
    hour: parseField(parts[1]!, 0, 23),
    dayOfMonth: parseField(parts[2]!, 1, 31),
    month: parseField(parts[3]!, 1, 12),
    dayOfWeek: parseField(parts[4]!, 0, 6),
  };
}

function parseField(field: string, min: number, max: number): number[] {
  if (field === '*') {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  const values = new Set<number>();

  for (const part of field.split(',')) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr ?? '', 10);
      const end = parseInt(endStr ?? '', 10);
      if (isNaN(start) || isNaN(end) || start > end) {
        throw new Error(`Invalid range: ${part}`);
      }
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    } else {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < min || num > max) {
        throw new Error(`Invalid value: ${part} (expected ${min}-${max})`);
      }
      values.add(num);
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

/** Проверить, совпадает ли момент времени с cron-выражением. */
export function matchesCron(cron: string, date: Date = new Date()): boolean {
  const fields = parseCron(cron);
  return (
    fields.minute.includes(date.getMinutes()) &&
    fields.hour.includes(date.getHours()) &&
    fields.dayOfMonth.includes(date.getDate()) &&
    fields.month.includes(date.getMonth() + 1) &&
    fields.dayOfWeek.includes(date.getDay())
  );
}

/** Вычислить следующий момент запуска по cron-выражению (после `from`). */
export function nextCronRun(cron: string, from: Date = new Date()): Date {
  const fields = parseCron(cron);

  // Начинаем со следующей минуты
  const next = new Date(from);
  next.setMinutes(next.getMinutes() + 1, 0, 0);

  // Ищем ближайшее совпадение (максимум ~525600 минут = 1 год)
  for (let i = 0; i < 525600; i++) {
    if (
      fields.minute.includes(next.getMinutes()) &&
      fields.hour.includes(next.getHours()) &&
      fields.dayOfMonth.includes(next.getDate()) &&
      fields.month.includes(next.getMonth() + 1) &&
      fields.dayOfWeek.includes(next.getDay())
    ) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  throw new Error(`Cannot find next run for cron: ${cron}`);
}
