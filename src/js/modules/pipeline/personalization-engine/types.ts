/**
 * Типы PersonalizationEngine (Задача 1.3).
 *
 * Модуль персонализации: профиль пользователя, веса интересов
 * (по взаимодействиям с затуханием), ранжирование контента
 * по релевантности и адаптация стиля подачи.
 *
 * Принципы проекта: DI-источники вместо жёстких зависимостей,
 * честные ошибки (честные ошибки вместо выдуманных данных),
 * warnings вместо молчаливых пропусков.
 */

// ─── Профиль пользователя ─────────────────────────────────────────────────

export type RiskAppetite = 'conservative' | 'moderate' | 'aggressive';

export type ContentDetailLevel = 'brief' | 'standard' | 'detailed';

/** Финансовая цель пользователя. */
export interface FinancialGoal {
  /** Уникальный идентификатор цели. */
  id: string;
  /** Род цели: 'income' | 'growth' | 'protection' | произвольная строка. */
  kind: string;
  /** Целевая сумма в валюте портфеля (опционально). */
  targetAmount?: number;
  /** Горизонт в месяцах (опционально). */
  horizonMonths?: number;
}

/** Профиль пользователя. */
export interface UserProfile {
  userId: string;
  riskAppetite: RiskAppetite;
  goals: FinancialGoal[];
  /** Категории, которые пользователь явно обозначил интересными. */
  preferredCategories: string[];
  /** Явная настройка детализации; '' — не задана (авто по опыту). */
  detailLevel: ContentDetailLevel | '';
  /** ISO-время последнего обновления профиля. */
  updatedAt: string;
}

/** Частичное обновление профиля (merge поверх существующего). */
export interface UserProfilePatch {
  riskAppetite?: RiskAppetite;
  goals?: FinancialGoal[];
  preferredCategories?: string[];
  detailLevel?: ContentDetailLevel | '';
}

// ─── Взаимодействия и интересы ────────────────────────────────────────────

export type InteractionAction = 'view' | 'expand' | 'accept' | 'dismiss';

/** Событие взаимодействия пользователя с контентом. */
export interface InteractionEvent {
  /** ISO-время события. */
  ts: string;
  /** Категория контента (например 'dividends', 'macro', 'orders'). */
  category: string;
  action: InteractionAction;
}

/** Вес интереса к категории. */
export interface InterestWeight {
  category: string;
  /** Нормированный вес 0..1. */
  weight: number;
  /** «Сырая» накопленная сила интереса (до нормировки). */
  rawScore: number;
  lastInteractionAt: string | null;
  interactions: number;
}

/** Вес события взаимодействия. */
export type InteractionActionWeight = Record<InteractionAction, number>;

/** Результат расчёта весов интересов. */
export interface InterestProfileResult {
  /** Отсортированы по весу (убывание), при равенстве — лексикографически. */
  interests: InterestWeight[];
  warnings: string[];
}

// ─── Контент и ранжирование ───────────────────────────────────────────────

/** Элемент контента, который нужно отранжировать под пользователя. */
export interface ContentItem {
  id: string;
  category: string;
  /** Уровень детализации, на который рассчитан контент. */
  detailLevel?: ContentDetailLevel;
  /** Род(ы) целей, которым контент релевантен. */
  goalKinds?: string[];
  /** Для каких риск-аппетитов контент уместен (пусто/undefined — нейтрален). */
  riskFit?: RiskAppetite[];
}

/** Ранжированный элемент контента. */
export interface RankedItem {
  item: ContentItem;
  /** Итоговая оценка (может быть отрицательной). */
  score: number;
  /** Человеческие причины оценки. */
  reasons: string[];
}

/** Результат ранжирования. */
export interface RankResult {
  /** Отсортированы по score (убывание), при равенстве — по id. */
  items: RankedItem[];
  warnings: string[];
}

// ─── Стиль подачи ─────────────────────────────────────────────────────────

export type ToneStyle = 'neutral' | 'educational' | 'concise';

/** Адаптированный стиль подачи. */
export interface StyleAdjustment {
  detailLevel: ContentDetailLevel;
  tone: ToneStyle;
  /** Причины выбора (прозрачность персонализации). */
  reasons: string[];
}

// ─── DI-источники ─────────────────────────────────────────────────────────

/** Источник хранения профиля ( персистентность инжектируется). */
export interface ProfileStoreSource {
  load(): Promise<UserProfile | null>;
  save(profile: UserProfile): Promise<void>;
  /** Полное удаление профиля (для reset). */
  clear(): Promise<void>;
}

/** Источник событий взаимодействия. */
export interface InteractionSource {
  getAll(): Promise<InteractionEvent[]>;
  append(event: InteractionEvent): Promise<void>;
}

// ─── Фасад ────────────────────────────────────────────────────────────────

export type PersonalizationAction =
  | 'get-profile'
  | 'update-profile'
  | 'track-interaction'
  | 'rank'
  | 'adapt-style'
  | 'full-report';

/** Выход фасада PersonalizationEngine. */
export interface PersonalizationOutput {
  success: boolean;
  action: PersonalizationAction;
  /** Данные при успехе (форма зависит от action). */
  data?: unknown;
  /** Честные ошибки секций (для full-report) или общая ошибка. */
  errors?: Partial<Record<string, string>> & { general?: string };
  warnings?: string[];
}
