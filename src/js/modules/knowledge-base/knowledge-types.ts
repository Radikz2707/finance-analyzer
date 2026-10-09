/**
 * KnowledgeBase Types — типы и интерфейсы для модуля знаний.
 *
 * KnowledgeBase — третий слой памяти, который хранит:
 * 1. Факты — информация о компаниях, рынках, инструментах
 * 2. Навыки — шаблоны решений и лучшие практики
 * 3. Предпочтения — стиль инвестирования директора
 * 4. Контекст — история решений и их результаты
 *
 * Отличия от AI Memory:
 * - AI Memory: оперативная/стратегическая память для ИИ-агентов
 * - KnowledgeBase: структурированные знания с семантическим поиском
 */

// ──────────────────────────────────────────────
// 1. Типы знаний
// ──────────────────────────────────────────────

/**
 * Тип хранимого знания.
 * - fact: фактическая информация (о компании, рынке, инструменте)
 * - skill: шаблон решения или лучшая практика
 * - preference: предпочтение директора (стиль, риски, сектора)
 * - context: история решений и их результаты
 */
export type KnowledgeType = 'fact' | 'skill' | 'preference' | 'context';

/**
 * Источник знания.
 * Откуда было получено знание (chat, pipeline, manual, inference).
 */
export type KnowledgeSource =
  | 'chat'            // Извлечено из диалога с Director
  | 'pipeline'        // Извлечено из pipeline-анализа
  | 'manual'          // Введено вручную
  | 'inference'       // Выведено ИИ на основе паттернов
  | 'import';         // Импортировано из внешнего источника

/**
 * Уровень достоверности знания.
 * - confirmed: подтверждено несколькими источниками
 * - probable: вероятно истинно (1-2 источника)
 * - hypothesis: гипотеза (требует проверки)
 */
export type KnowledgeConfidence = 'confirmed' | 'probable' | 'hypothesis';

// ──────────────────────────────────────────────
// 2. Структура знания
// ──────────────────────────────────────────────

/**
 * Базовая структура любого знания.
 * Все типы знаний (fact, skill, preference, context) наследуются от этого интерфейса.
 */
export interface KnowledgeEntry {
  /** Уникальный идентификатор записи (UUID v4) */
  id: string;
  /** Тип знания (fact, skill, preference, context) */
  type: KnowledgeType;
  /** Заголовок знания (краткое описание) */
  title: string;
  /** Основное содержимое знания */
  content: string;
  /** Массив ключевых слов для поиска */
  keywords: string[];
  /** Источник знания */
  source: KnowledgeSource;
  /** Уровень достоверности */
  confidence: KnowledgeConfidence;
  /** Время создания */
  createdAt: string;
  /** Время последнего обновления */
  updatedAt: string;
  /** Время последнего доступа */
  lastAccessedAt: string;
  /** Счётчик обращений к знанию */
  accessCount: number;
  /** Вес знания (убывает со временем, half-life = 60 дней) */
  weight: number;
  /** Связанные тикеры/активы */
  relatedAssets: string[];
  /** Связанные секторы */
  relatedSectors: string[];
  /** Метаданные (произвольные дополнительные данные) */
  metadata?: Record<string, unknown>;
}

/**
 * Факт — информация о компании, рынке, инструменте.
 * Примеры: "Сбер выплатил дивиденды 32.5 руб. на акцию",
 *          "Ключевая ставка ЦБ = 21%"
 */
export interface FactKnowledge extends KnowledgeEntry {
  type: 'fact';
  /** Подтип факта (dividend, rate, earnings, merger, regulation и т.д.) */
  factType:
    | 'dividend'
    | 'rate'
    | 'earnings'
    | 'merger'
    | 'regulation'
    | 'product'
    | 'general';
  /** Верифицирован ли факт (проверен по официальным источникам) */
  verified: boolean;
  /** URL официального источника */
  sourceUrl?: string;
}

/**
 * Навык — шаблон решения или лучшая практика.
 * Примеры: "Как проводить ребалансировку",
 *          "Паттерн: при key_rate > 20% искать облигации с фиксированным купоном"
 */
export interface SkillKnowledge extends KnowledgeEntry {
  type: 'skill';
  /** Категория навыка (analysis, rebalancing, risk, timing и т.д.) */
  category:
    | 'analysis'
    | 'rebalancing'
    | 'risk_management'
    | 'market_timing'
    | 'sector_rotation'
    | 'general';
  /** Сложность навыка (beginner, intermediate, advanced) */
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  /** Шаги выполнения (пошаговая инструкция) */
  steps: string[];
  /** Условия применения (когда этот навык полезен) */
  applicableConditions: string[];
}

/**
 * Предпочтение — стиль инвестирования директора.
 * Примеры: "Предпочитает технологические секторы",
 *          "Толерантность к риску = 7/10"
 */
export interface PreferenceKnowledge extends KnowledgeEntry {
  type: 'preference';
  /** Категория предпочтения (style, risk, sector, communication и т.д.) */
  category:
    | 'investment_style'
    | 'risk_tolerance'
    | 'sector_preference'
    | 'communication'
    | 'reporting'
    | 'general';
  /** Значение предпочтения (числовое или строковое) */
  value: number | string;
  /** Изменилось ли предпочтение recently (для отслеживания эволюции) */
  isChanged: boolean;
  /** Предыдущее значение (если изменилось) */
  previousValue?: number | string;
}

/**
 * Контекст — история решений и их результаты.
 * Примеры: "2024-01-15: купил Сбер по 280р, сейчас 310р (+10.7%)",
 *          "2024-02-01: продал Газпром, рынок упал на 5% — правильное решение"
 */
export interface ContextKnowledge extends KnowledgeEntry {
  type: 'context';
  /** Подтип контекста (decision, outcome, lesson, pattern) */
  contextType: 'decision' | 'outcome' | 'lesson' | 'pattern';
  /** Состояние портфеля на момент события */
  portfolioState: {
    totalValue: number;
    assetCount: number;
    cashPercent: number;
  };
  /** Результат (positive, negative, neutral) */
  outcome: 'positive' | 'negative' | 'neutral';
  /** Извлечённый урок (если есть) */
  lesson?: string;
}

// ──────────────────────────────────────────────
// 3. Поиск и запросы
// ──────────────────────────────────────────────

/**
 * Параметры поиска по KnowledgeBase.
 */
export interface KnowledgeQuery {
  /** Массив типов знаний для поиска (если не указан — ищутся все типы) */
  types?: KnowledgeType[];
  /** Массив ключевых слов для полнотекстового поиска */
  keywords?: string[];
  /** Фильтр по тикерам/активам */
  assets?: string[];
  /** Фильтр по секторам */
  sectors?: string[];
  /** Фильтр по источникам */
  sources?: KnowledgeSource[];
  /** Минимальный уровень достоверности */
  minConfidence?: KnowledgeConfidence;
  /** Начальная граница периода (ISO 8601) */
  from?: string;
  /** Конечная граница периода (ISO 8601) */
  to?: string;
  /** Максимальное количество результатов (по умолчанию 50) */
  maxResults?: number;
  /** Сортировка: relevance (по релевантности), date (по дате), weight (по весу) */
  sortBy?: 'relevance' | 'date' | 'weight';
}

/**
 * Результат поиска по KnowledgeBase.
 */
export interface KnowledgeQueryResult {
  /** Массив найденных знаний */
  entries: KnowledgeEntry[];
  /** Общее количество найденных записей */
  totalFound: number;
  /** Время выполнения запроса в миллисекундах */
  queryDurationMs: number;
  /** Использованные ключевые слова для поиска */
  usedKeywords: string[];
}

// ──────────────────────────────────────────────
// 4. Статистика и конфигурация
// ──────────────────────────────────────────────

/**
 * Статистика KnowledgeBase.
 */
export interface KnowledgeBaseStats {
  /** Общее количество знаний */
  totalEntries: number;
  /** Количество знаний по типам */
  byType: {
    fact: number;
    skill: number;
    preference: number;
    context: number;
  };
  /** Общий размер базы в байтах */
  totalSizeBytes: number;
  /** Количество подтверждённых знаний */
  confirmedCount: number;
  /** Количество гипотез */
  hypothesisCount: number;
  /** Средний вес знания */
  averageWeight: number;
  /** Количество знаний, доступ к которым был за последние 7 дней */
  recentlyAccessed: number;
}

/**
 * Конфигурация KnowledgeBase.
 */
export interface KnowledgeBaseConfig {
  /** Максимальное количество записей (по умолчанию 5000) */
  maxEntries?: number;
  /** Срок хранения знаний в днях до авто-очистки (по умолчанию 90) */
  ttlDays?: number;
  /** Период полураспада веса в днях (по умолчанию 60) */
  weightHalfLifeDays?: number;
  /** Включить автоматическое извлечение знаний из диалогов */
  autoExtractFromChat?: boolean;
  /** Включить автоматическое извлечение из pipeline */
  autoExtractFromPipeline?: boolean;
  /** Путь к файлу SQLite (по умолчанию ./data/knowledge-base.db) */
  dbPath?: string;
  /** Подробное логирование */
  verbose?: boolean;
}
