/**
 * GoalAgent — управление целями, приоритетами и жизненным циклом задач.
 *
 * Агент отслеживает цели портфеля, управляет приоритетами,
 * контролирует дедлайны и обеспечивает прогресс-трекинг.
 */

// -----------------------------------------------
// 1. ТИПЫ ЦЕЛЕЙ
// -----------------------------------------------

/** Тип цели */
export type GoalType =
  | 'tracking'      // Наблюдение за активом/портфелем
  | 'analysis'      // Анализ актива или стратегии
  | 'alert'         // Уведомление при достижении порога
  | 'action'        // Действие (покупка, продажа, ребалансировка)
  | 'research';     // Исследование рынка/сектора

/** Уровень приоритета цели */
export type GoalPriority = 'low' | 'medium' | 'high' | 'critical';

/** Статус цели */
export type GoalStatus =
  | 'pending'       // Ожидает начала
  | 'active'        // Активна
  | 'paused'        // Приостановлена
  | 'completed'     // Завершена
  | 'cancelled';    // Отменена

// -----------------------------------------------
// 2. ИНТЕРФЕЙС ЦЕЛИ
// -----------------------------------------------

/** Цель, управляемая GoalAgent */
export interface Goal {
  /** Уникальный идентификатор */
  id: string;
  /** Уникальное имя цели */
  name: string;
  /** Описание цели */
  description: string;
  /** Тип цели */
  type: GoalType;
  /** Приоритет */
  priority: GoalPriority;
  /** Текущий статус */
  status: GoalStatus;
  /** Прогресс от 0 до 100 */
  progress: number;
  /** Дедлайн (ISO-строка), undefined = без дедлайна */
  deadline?: string;
  /** ID родительской цели (для иерархии) */
  parentId?: string;
  /** Теги для категоризации */
  tags: string[];
  /** Метка времени создания */
  createdAt: string;
  /** Метка времени обновления */
  updatedAt: string;
  /** Метка времени завершения */
  completedAt?: string;
  /** Пользовательские метрики прогресса */
  metrics?: Record<string, number>;
}

// -----------------------------------------------
// 3. ВХОДЫ И ВЫХОДЫ АГЕНТА
// -----------------------------------------------

/** Действия GoalAgent */
export type GoalAgentAction =
  | 'add'              // Добавить новую цель
  | 'update'           // Обновить существующую цель
  | 'complete'         // Пометить цель как завершённую
  | 'cancel'           // Отменить цель
  | 'pause'            // Приостановить цель
  | 'resume'           // Возобновить приостановленную цель
  | 'delete'           // Удалить цель
  | 'get'              // Получить цель по ID
  | 'list'             // Получить список целей с фильтрацией
  | 'reorder'          // Перераспределить приоритеты
  | 'get-progress'     // Получить сводку по прогрессу
  | 'get-overdue'      // Получить просроченные цели
  | 'get-by-tags'      // Получить цели по тегам
  | 'export-goals';    // Экспорт целей в формат

/** Входные параметры для действия 'add' */
export interface GoalAddParams {
  name: string;
  description: string;
  type: GoalType;
  priority?: GoalPriority;
  deadline?: string;
  parentId?: string;
  tags?: string[];
  metrics?: Record<string, number>;
}

/** Входные параметры для действия 'update' */
export interface GoalUpdateParams {
  id: string;
  name?: string;
  description?: string;
  type?: GoalType;
  priority?: GoalPriority;
  status?: GoalStatus;
  progress?: number;
  deadline?: string;
  parentId?: string;
  tags?: string[];
  metrics?: Record<string, number>;
}

/** Входные параметры для действия 'list' */
export interface GoalListParams {
  type?: GoalType;
  status?: GoalStatus;
  priority?: GoalPriority;
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}

/** Входные параметры для действия 'reorder' */
export interface GoalReorderParams {
  rules: GoalReorderRule[];
}

/** Правило перераспределения приоритетов */
export interface GoalReorderRule {
  /** Тип целей, к которым применяется правило */
  targetType?: GoalType;
  /** Приоритет, который нужно установить */
  setPriority?: GoalPriority;
  /** Процент целей, которые нужно повысить */
  boostPercent?: number;
  /** Процент целей, которые нужно понизить */
dPriorityPercent?: number;
}

/** Входные параметры для действия 'get-by-tags' */
export interface GoalByTagsParams {
  tags: string[];
  matchAll?: boolean; // true = все теги, false = любой тег
}

/** Вход GoalAgent */
export type GoalAgentInput =
  | { action: 'add'; params: GoalAddParams }
  | { action: 'update'; params: GoalUpdateParams }
  | { action: 'complete'; params: { id: string; metrics?: Record<string, number> } }
  | { action: 'cancel'; params: { id: string } }
  | { action: 'pause'; params: { id: string } }
  | { action: 'resume'; params: { id: string } }
  | { action: 'delete'; params: { id: string } }
  | { action: 'get'; params: { id: string } }
  | { action: 'list'; params?: GoalListParams }
  | { action: 'reorder'; params: GoalReorderParams }
  | { action: 'get-progress'; params?: Record<string, never> }
  | { action: 'get-overdue'; params?: Record<string, never> }
  | { action: 'get-by-tags'; params: GoalByTagsParams }
  | { action: 'export-goals'; params?: { format?: 'json' | 'csv' } };

// -----------------------------------------------
// 4. ВЫХОДНЫЕ ТИПЫ
// -----------------------------------------------

/** Результат операции с целью */
export interface GoalOperationResult {
  /** Успешность операции */
  success: boolean;
  /** Сообщение о результате */
  message: string;
  /** Затронутая цель */
  goal?: Goal;
  /** Список целей (для list/export) */
  goals?: Goal[];
  /** Статистика прогресса (для get-progress) */
  progressSummary?: ProgressSummary;
}

/** Сводка по прогрессу */
export interface ProgressSummary {
  /** Общее количество целей */
  totalGoals: number;
  /** Количество по статусам */
  byStatus: Record<GoalStatus, number>;
  /** Количество по типам */
  byType: Record<GoalType, number>;
  /** Количество по приоритетам */
  byPriority: Record<GoalPriority, number>;
  /** Средний прогресс */
  averageProgress: number;
  /** Количество просроченных целей */
  overdueCount: number;
  /** Количество завершённых целей */
  completedCount: number;
}

/** Результат экспорта */
export interface ExportResult {
  format: 'json' | 'csv';
  content: string;
  goalCount: number;
}

/** Выход GoalAgent */
export type GoalAgentOutput = GoalOperationResult | ExportResult;
