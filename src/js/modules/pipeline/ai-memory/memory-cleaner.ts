/**
 * Memory Cleaner — автоматическая очистка и архивация памяти ИИ.
 *
 * Система управления жизненным циклом записей памяти:
 * - Ежедневная очистка в 3:00 — удаление оперативных записей старше 14 дней
 * - Еженедельная архивация в воскресенье в 4:00 — полная очистка обоих слоёв
 * - Простой cron-парсер без внешних зависимостей
 * - Отслеживание состояния и последнего результата
 *
 * @module memory-cleaner
 */

import { operationalMemory, strategicMemory, cleanup } from './ai-memory.js';

// ──────────────────────────────────────────────
// 1. Типы
// ──────────────────────────────────────────────

/**
 * Состояние модуля MemoryCleaner.
 * - `idle` — готов к работе
 * - `running` — выполняется очистка
 * - `error` — последняя очистка завершилась с ошибкой
 * - `stopped` — планировщик остановлен
 */
export type CleanerState = 'idle' | 'running' | 'error' | 'stopped';

/**
 * Результат выполнения очистки.
 * Заполняется после каждого вызова runCleanup().
 */
export interface CleanupResult {
  /** Дата и время выполнения очистки (ISO 8601) */
  executedAt: string;
  /** Количество удалённых оперативных записей */
  operationalDeleted: number;
  /** Количество удалённых стратегических записей */
  strategicDeleted: number;
  /** Количество сжатых (архивированных) оперативных записей */
  operationalArchived: number;
  /** Статус выполнения */
  status: 'success' | 'error';
  /** Сообщение об ошибке (заполняется при status='error') */
  error?: string;
}

// ──────────────────────────────────────────────
// 2. Состояние модуля
// ──────────────────────────────────────────────

let currentState: CleanerState = 'idle';
let lastResult: CleanupResult | null = null;
let isRunning = false;

function setState(state: CleanerState): void {
  currentState = state;
  console.log(`[MemoryCleaner] Состояние: ${state}`);
}

// ──────────────────────────────────────────────
// 3. Очистка оперативной памяти
// ──────────────────────────────────────────────

/**
 * Очистить оперативную память.
 * Удаляет записи старше 14 дней, сжимает записи старше 7 дней.
 * @returns общее количество обработанных записей (сжатых + удалённых)
 */
function cleanupOperational(): number {
  console.log('[MemoryCleaner] Очистка оперативной памяти...');

  // Сжимаем записи старше 7 дней
  const archived = operationalMemory.archiveOld(7);
  console.log(`[MemoryCleaner] Сжато ${archived} записей`);

  // Удаляем записи старше 14 дней
  const deleted = operationalMemory.cleanupOld(14);
  console.log(`[MemoryCleaner] Удалено ${deleted} записей`);

  return archived + deleted;
}

// ──────────────────────────────────────────────
// 4. Очистка стратегической памяти
// ──────────────────────────────────────────────

/**
 * Очистить стратегическую память.
 * Удаляет KPI-снимки старше 6 месяцев.
 * @returns количество удалённых записей
 */
function cleanupStrategic(): number {
  console.log('[MemoryCleaner] Очистка стратегической памяти...');

  // Удаляем записи старше 180 дней (6 месяцев)
  const deleted = strategicMemory.cleanupOld(180);
  console.log(`[MemoryCleaner] Удалено ${deleted} стратегических записей`);

  return deleted;
}

// ──────────────────────────────────────────────
// 5. Полная очистка
// ──────────────────────────────────────────────

/**
 * Выполнить полную очистку памяти.
 * @param options — опции очистки
 * @param options.operational — очистить оперативную память (по умолчанию true)
 * @param options.strategic — очистить стратегическую память (по умолчанию true)
 * @param options.general — выполнить общую очистку (по умолчанию true)
 * @returns результат очистки
 */
async function runCleanup(options?: {
  /** Очистить оперативную память */
  operational?: boolean;
  /** Очистить стратегическую память */
  strategic?: boolean;
  /** Выполнить общую очистку (cleanup) */
  general?: boolean;
}): Promise<CleanupResult> {
  const opts = {
    operational: true,
    strategic: true,
    general: true,
    ...options,
  };

  setState('running');
  isRunning = true;

  const startTime = Date.now();
  let operationalDeleted = 0;
  let strategicDeleted = 0;
  let operationalArchived = 0;
  let error: string | undefined;

  try {
    // Оперативная память
    if (opts.operational) {
      operationalArchived = cleanupOperational();
      operationalDeleted = operationalMemory.cleanupOld(14);
    }

    // Стратегическая память
    if (opts.strategic) {
      strategicDeleted = cleanupStrategic();
    }

    // Общая очистка
    if (opts.general) {
      await cleanup();
    }

    const duration = Date.now() - startTime;
    lastResult = {
      executedAt: new Date().toISOString(),
      operationalDeleted,
      strategicDeleted,
      operationalArchived,
      status: 'success',
    };

    console.log(`[MemoryCleaner] Очистка завершена за ${duration}ms`);
    console.log(`  Оперативная: удалено ${operationalDeleted}, сжато ${operationalArchived}`);
    console.log(`  Стратегическая: удалено ${strategicDeleted}`);

    setState('idle');
    return lastResult;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    lastResult = {
      executedAt: new Date().toISOString(),
      operationalDeleted,
      strategicDeleted,
      operationalArchived,
      status: 'error',
      error,
    };

    console.error('[MemoryCleaner] Ошибка очистки:', error);
    setState('error');
    throw err;
  } finally {
    isRunning = false;
  }
}

// ──────────────────────────────────────────────
// 6. Расписание очистки
// ──────────────────────────────────────────────

/** Расписание очистки */
interface CleanupSchedule {
  /** Название */
  name: string;
  /** Cron-выражение */
  cron: string;
  /** Опции очистки */
  options: {
    operational?: boolean;
    strategic?: boolean;
    general?: boolean;
  };
  /** Активно */
  enabled: boolean;
}

/** Стандартные расписания */
const DEFAULT_SCHEDULES: CleanupSchedule[] = [
  {
    name: 'Ежедневная очистка',
    cron: '0 3 * * *', // каждый день в 3:00
    options: { operational: true, strategic: false, general: true },
    enabled: true,
  },
  {
    name: 'Еженедельная архивация',
    cron: '0 4 * * 0', // каждое воскресенье в 4:00
    options: { operational: true, strategic: true, general: true },
    enabled: true,
  },
];

let schedules: CleanupSchedule[] = [...DEFAULT_SCHEDULES];
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Проверить и выполнить расписание.
 * Простая проверка: если текущее время совпадает с cron.
 */
function checkAndExecuteSchedules(): void {
  if (isRunning) return;

  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const dayOfWeek = now.getDay(); // 0 = воскресенье
  const dayOfMonth = now.getDate();

  for (const schedule of schedules) {
    if (!schedule.enabled) continue;

    const [cronMinute, cronHour, cronDay, , cronDow] = schedule.cron.split(' ');

    // Простая проверка (без полной поддержки cron)
    const minuteMatch = cronMinute === '*' || parseInt(cronMinute) === minute;
    const hourMatch = cronHour === '*' || parseInt(cronHour) === hour;
    const dowMatch = cronDow === '*' || dayOfWeek === parseInt(cronDow);
    const dayMatch = cronDay === '*' || parseInt(cronDay) === dayOfMonth;

    if (minuteMatch && hourMatch && dowMatch && dayMatch) {
      console.log(`[MemoryCleaner] Выполнение расписания: ${schedule.name}`);
      runCleanup(schedule.options).catch((err) => {
        console.error(`[MemoryCleaner] Ошибка выполнения расписания "${schedule.name}":`, err);
      });
    }
  }
}

/**
 * Запустить планировщик.
 * @param intervalMs — интервал проверки в мс (по умолчанию 60000 = 1 минута)
 */
function startScheduler(intervalMs = 60_000): void {
  if (schedulerInterval) {
    console.warn('[MemoryCleaner] Планировщик уже запущен');
    return;
  }

  console.log('[MemoryCleaner] Запуск планировщика...');
  schedulerInterval = setInterval(checkAndExecuteSchedules, intervalMs);
  setState('idle');
}

/**
 * Останавливает планировщик очистки.
 * Освобождает setInterval и выводит сообщение в лог.
 * Вызывается при shutdown().
 */
function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[MemoryCleaner] Планировщик остановлен');
  }
}

/**
 * Добавить расписание.
 * @param schedule — параметры расписания
 */
function addSchedule(schedule: Omit<CleanupSchedule, 'enabled'> & { enabled?: boolean }): void {
  schedules.push({
    ...schedule,
    enabled: schedule.enabled ?? true,
  });
  console.log(`[MemoryCleaner] Расписание добавлено: ${schedule.name}`);
}

/**
 * Получить расписания.
 * @returns массив расписаний
 */
function getSchedules(): CleanupSchedule[] {
  return [...schedules];
}

/**
 * Удалить расписание по имени.
 * @param name — название расписания
 */
function removeSchedule(name: string): void {
  schedules = schedules.filter((s) => s.name !== name);
  console.log(`[MemoryCleaner] Расписание удалено: ${name}`);
}

// ──────────────────────────────────────────────
// 7. Статистика
// ──────────────────────────────────────────────

/**
 * Получить состояние очистителя.
 * @returns текущее состояние
 */
function getState(): CleanerState {
  return currentState;
}

/**
 * Получить последний результат очистки.
 * @returns последний результат или null
 */
function getLastResult(): CleanupResult | null {
  return lastResult;
}

/**
 * Получить статистику очистителя.
 * @returns объект со статистикой
 */
function getStats(): {
  isRunning: boolean;
  scheduleCount: number;
  lastResult: CleanupResult | null;
} {
  return {
    isRunning,
    scheduleCount: schedules.filter((s) => s.enabled).length,
    lastResult,
  };
}

// ──────────────────────────────────────────────
// 8. Экспорт
// ──────────────────────────────────────────────

/**
 * Экспортировать историю очистки.
 * @returns JSON-строка с историей
 */
function exportHistory(): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    schedules,
    lastResult,
  }, null, 2);
}

// ──────────────────────────────────────────────
// 9. Инициализация
// ──────────────────────────────────────────────

/**
 * Инициализирует модуль MemoryCleaner.
 * Запускает планировщик и выполняет первую очистку.
 * Вызывается автоматически при импорте модуля.
 */
function init(): void {
  console.log('🧹 MemoryCleaner: инициализация...');
  console.log(`   Расписаний: ${schedules.length}`);
  console.log(`   Включено: ${schedules.filter((s) => s.enabled).length}`);

  // Запускаем планировщик
  startScheduler();

  // Выполняем первую очистку
  console.log('[MemoryCleaner] Выполнение первой очистки...');
  runCleanup().catch((err) => {
    console.error('[MemoryCleaner] Ошибка первой очистки:', err);
  });
}

/**
 * Остановить очиститель.
 * Останавливает планировщик и переводит в состояние stopped.
 */
async function shutdown(): Promise<void> {
  stopScheduler();
  setState('stopped');
  console.log('[MemoryCleaner] Остановлен');
}

// ──────────────────────────────────────────────
// 10. Экспорт
// ──────────────────────────────────────────────

export {
  runCleanup,
  cleanupOperational,
  cleanupStrategic,
  startScheduler,
  stopScheduler,
  addSchedule,
  removeSchedule,
  getSchedules,
  getState,
  getLastResult,
  getStats,
  exportHistory,
  init,
  shutdown,
};

// Автоматическая инициализация
init();
