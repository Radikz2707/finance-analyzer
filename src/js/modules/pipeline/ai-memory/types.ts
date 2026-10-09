/**
 * AIMemory Types — типы и интерфейсы для двухслойной памяти ИИ.
 *
 * Двухслойная память:
 * 1. Оперативная (Operational) — детальные логи и переписка за 7-14 дней
 * 2. Стратегическая (Strategic) — сжатые KPI портфеля за 3-6 месяцев
 */

// ──────────────────────────────────────────────
// 1. Состояние памяти
// ──────────────────────────────────────────────

/**
 * Состояние модуля AIMemory.
 * - `idle` — готов к работе
 * - `loading` — выполняется загрузка/запрос
 * - `saving` — выполняется сохранение/очистка
 * - `error` — произошла ошибка
 */
export type MemoryState = 'idle' | 'loading' | 'saving' | 'error';

/**
 * Тип записи памяти.
 * Оперативные типы: conversation, pipeline_result, decision, recommendation,
 *                   portfolio_analysis, portfolio_context, user_preference, market_regime
 * Стратегические типы: kpi_snapshot, trend_data, anomaly,
 *                      strategy_snapshot, lesson_learned, market_cycle
 */
export type MemoryEntryType =
  // ── Общие типы (используются в обоих слоях) ──
  | 'kpi_snapshot'       // Снимок KPI
  | 'trend_data'         // Трендовые данные
  | 'anomaly'            // Аномалия
  // ── Оперативная память (краткосрочная, 7-14 дней) ──
  | 'conversation'       // Переписка с Director
  | 'pipeline_result'    // Результат pipeline
  | 'decision'           // Решение Director
  | 'recommendation'     // Рекомендация
  | 'portfolio_analysis' // Полный анализ портфеля с контекстом
  | 'portfolio_context'  // Snapshot портфеля на момент анализа
  | 'user_preference'    // Предпочтения директора
  | 'market_regime';     // Текущий рыночный режим (рост/падение/флэт)

/**
 * Уровень важности записи.
 * - `critical` — критическая (автоматическая очистка в последнюю очередь)
 * - `high` — высокая
 * - `medium` — средняя (по умолчанию)
 * - `low` — низкая (может быть удалена первой)
 */
export type MemoryPriority = 'critical' | 'high' | 'medium' | 'low';

// ──────────────────────────────────────────────
// 2. Запись оперативной памяти
// ──────────────────────────────────────────────

/**
 * Запись оперативной памяти (краткосрочная).
 * Хранит детальные логи, переписку, решения за 7-14 дней.
 * Автоматически сжимается и удаляется по истечении TTL.
 */
export interface OperationalMemoryEntry {
  /** Уникальный идентификатор записи (UUID v4) */
  id: string;
  /** Тип записи (conversation, pipeline_result, decision и т.д.) */
  type: MemoryEntryType;
  /** Время создания записи в формате ISO 8601 */
  createdAt: string;
  /** Время последнего чтения/доступа (обновляется при каждом read) */
  lastAccessedAt: string;
  /** Уровень важности — влияет на приоритет очистки */
  priority: MemoryPriority;
  /** Массив ключевых слов для полнотекстового поиска */
  keywords: string[];
  /** Основное содержимое записи */
  content: string;
  /** Произвольные метаданные (опционально) */
  metadata?: Record<string, unknown>;
  /** Размер контента в байтах (для оценки лимитов хранилища) */
  sizeBytes: number;
}

// ──────────────────────────────────────────────
// 2.1. Расширенные типы оперативной памяти
// ──────────────────────────────────────────────

/**
 * Полный анализ портфеля с контекстом.
 * Сохраняет все детали анализа: метрики, рекомендации, источники данных.
 */
export interface PortfolioAnalysisEntry {
  /** Дата анализа */
  date: string;
  /** Общая стоимость портфеля */
  totalValue: number;
  /** Доходность (%) */
  returnPercent: number;
  /** Структура портфеля (доли активов) */
  allocation: Array<{
    ticker: string;
    percent: number;
    type: 'stock' | 'bond' | 'etf' | 'cash';
  }>;
  /** Ключевые метрики (Sharpe, Volatility, MaxDD) */
  metrics: {
    sharpeRatio?: number;
    volatility?: number;
    maxDrawdown?: number;
  };
  /** Рекомендации ИИ */
  recommendations: Array<{
    action: 'buy' | 'sell' | 'hold' | 'rebalance';
    ticker: string;
    reason: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  /** Источники данных (MOEX, CBR, Finam и т.д.) */
  dataSources: string[];
  /** Состояние рынка на момент анализа */
  marketRegime: 'bull' | 'bear' | 'sideways' | 'volatile';
}

/**
 * Snapshot портфеля на момент анализа.
 * Фиксирует состав портфеля, баланс, историю изменений.
 */
export interface PortfolioContextEntry {
  /** Дата snapshot'а */
  date: string;
  /** Список позиций на момент анализа */
  positions: Array<{
    ticker: string;
    quantity: number;
    avgPrice: number;
    currentPrice: number;
    marketValue: number;
    percent: number;
  }>;
  /** Баланс счета */
  cashBalance: number;
  /** История изменений за период (последние N сделок) */
  recentTrades: Array<{
    date: string;
    type: 'buy' | 'sell';
    ticker: string;
    quantity: number;
    price: number;
  }>;
  /** Целевые доли (из Excel) */
  targetAllocation: Array<{
    ticker: string;
    targetPercent: number;
    currentPercent: number;
    deviation: number;
  }>;
}

/**
 * Предпочтения директора.
 * Сохраняет стиль инвестирования, риск-профиль, любимые сектора.
 */
export interface UserPreferenceEntry {
  /** Дата записи предпочтений */
  date: string;
  /** Стиль инвестирования (value, growth, income, aggressive, conservative) */
  investmentStyle: 'value' | 'growth' | 'income' | 'aggressive' | 'conservative';
  /** Толерантность к риску (1-10) */
  riskTolerance: number;
  /** Инвестиционный горизонт (short, medium, long) */
  horizon: 'short' | 'medium' | 'long';
  /** Любимые сектора (technology, energy, finance и т.д.) */
  favoriteSectors: string[];
  /** Любимые тикеры */
  favoriteTickers: string[];
  /** Избигаемые сектора/тикеры (ESG, taboo) */
  avoidedAssets: string[];
  /** Стиль общения (formal, casual, brief, detailed) */
  communicationStyle: 'formal' | 'casual' | 'brief' | 'detailed';
  /** Частота отчётов (daily, weekly, monthly, on-demand) */
  reportFrequency: 'daily' | 'weekly' | 'monthly' | 'on-demand';
  /** Контекст: откуда извлечены предпочтения (chat, decision, feedback) */
  source: string;
}

/**
 * Текущий рыночный режим.
 * Определяет фазу рынка для адаптации стратегии.
 */
export interface MarketRegimeEntry {
  /** Дата определения режима */
  date: string;
  /** Общий режим рынка (bull, bear, sideways, volatile) */
  regime: 'bull' | 'bear' | 'sideways' | 'volatile';
  /** Индекс MOEX (текущее значение) */
  moexIndex: number;
  /** Тренд индекса (up, down, flat) */
  indexTrend: 'up' | 'down' | 'flat';
  /** Волатильность (VIX или расчётная) */
  volatility: number;
  /** Объемы торгов (растут, падают, стабильны) */
  volumeTrend: 'increasing' | 'decreasing' | 'stable';
  /** Отраслевые лидеры (топ-3 сектора) */
  leadingSectors: string[];
  /** Отраслевие аутсайдеры (топ-3 сектора) */
  laggingSectors: string[];
  /** Макро-факторы (ключевая ставка, инфляция, курс USD) */
  macroFactors: {
    keyRate?: number;
    inflation?: number;
    usdRate?: number;
    cnyRate?: number;
  };
  /** Уверенность в определении режима (0-1) */
  confidence: number;
}

// ──────────────────────────────────────────────
// 3. Запись стратегической памяти
// ──────────────────────────────────────────────

/**
 * Снимок KPI портфеля (стратегическая память).
 * Сжатый моментальный снимок ключевых метрик портфеля на определённую дату.
 * Используется для анализа долгосрочных трендов и обнаружения аномалий.
 */
export interface PortfolioKpiSnapshot {
  /** Дата снимка в формате ISO 8601 */
  date: string;
  /** Общая рыночная стоимость портфеля (₽) */
  totalValue: number;
  /** Накопительная доходность за период (%) */
  returnPercent: number;
  /** Стандартное отклонение доходности (волатильность, %) */
  volatility: number;
  /** Коэффициент Шарпа (доходность на единицу риска) */
  sharpeRatio: number;
  /** Максимальная просадка от пика (%) */
  maxDrawdown: number;
  /** Количество активных активов в портфеле */
  assetCount: number;
  /** Доля акций в портфеле (%) */
  stocksPercent: number;
  /** Доля облигаций в портфеле (%) */
  bondsPercent: number;
  /** Полученный дивидендный доход (₽) */
  dividendIncome: number;
  /** Реализованная прибыль от сделок (₽) */
  realizedProfit: number;
  /** Нереализованная прибыль/убыток (mark-to-market, ₽) */
  unrealizedProfit: number;
}

/**
 * Тип записи стратегической памяти.
 * Включает базовые типы (kpi_snapshot, trend_data, anomaly)
 * и новые типы для расширения знаний (strategy_snapshot, lesson_learned, market_cycle).
 */
export type StrategicMemoryEntryType =
  | 'kpi_snapshot'       // Снимок KPI
  | 'trend_data'         // Трендовые данные
  | 'anomaly'            // Аномалия
  | 'strategy_snapshot'  // Сжатая сводка инвестиционной стратегии
  | 'lesson_learned'     // Урок из успешного/неудачного решения
  | 'market_cycle';      // Долгосрочный тренд рынка (3-6 месяцев)

/**
 * Сводка инвестиционной стратегии (стратегическая память).
 * Сжатая версия текущей стратегии с ключевыми параметрами.
 */
export interface StrategySnapshot {
  /** Дата снимка стратегии */
  date: string;
  /** Общая стратегия (growth, value, income, balanced, aggressive) */
  style: 'growth' | 'value' | 'income' | 'balanced' | 'aggressive';
  /** Толерантность к риску (1-10) */
  riskTolerance: number;
  /** Доля акций в стратегии (%) */
  targetStocksPercent: number;
  /** Доля облигаций в стратегии (%) */
  targetBondsPercent: number;
  /** Доля других активов (%) */
  targetOtherPercent: number;
  /** Ключевые сектора (technology, energy, finance и т.д.) */
  focusSectors: string[];
  /** Любимые тикеры (топ-5) */
  favoriteTickers: string[];
  /** Ребалансировка: frequency (monthly, quarterly, annual, threshold) */
  rebalanceFrequency: 'monthly' | 'quarterly' | 'annual' | 'threshold';
  /** Порог ребалансировки (%) */
  rebalanceThreshold: number;
  /** Цели (массив целей с сроками и суммами) */
  goals: Array<{
    name: string;
    targetAmount: number;
    deadline: string;
    priority: number;
  }>;
}

/**
 * Урок, извлечённый из опыта (стратегическая память).
 * Сохраняет паттерны успешных/неудачных решений.
 */
export interface LessonLearned {
  /** Дата урока */
  date: string;
  /** Тип урока (decision, market_timing, sector_rotation, risk_management) */
  type: 'decision' | 'market_timing' | 'sector_rotation' | 'risk_management';
  /** Исход (good, bad, neutral) */
  outcome: 'good' | 'bad' | 'neutral';
  /** Контекст: какие данные были доступны */
  context: string;
  /** Действие: что было сделано */
  action: string;
  /** Результат: что произошло */
  result: string;
  /** Вывод: главный урок */
  lesson: string;
  /** Ключевые слова для поиска */
  keywords: string[];
  /** Вес урока (убывает со временем, half-life = 30 дней) */
  weight: number;
  /** Связанные тикеры/сектора */
  relatedAssets: string[];
}

/**
 * Тренд рыночного цикла (стратегическая память).
 * Долгосрочные тренды рынков за 3-6 месяцев.
 */
export interface MarketCycleData {
  /** Дата анализа */
  date: string;
  /** Индикатор рынка (MOEX Index или общий) */
  index: string;
  /** Текущая фаза цикла (accumulation, markup, distribution, markdown) */
  phase: 'accumulation' | 'markup' | 'distribution' | 'markdown';
  /** Тренд (up, down, sideways) */
  trend: 'up' | 'down' | 'sideways';
  /** Сила тренда (0-1) */
  strength: number;
  /** Волатильность (VIX или расчётная) */
  volatility: number;
  /** Объемы (растут/падают/стабильны) */
  volumeTrend: 'increasing' | 'decreasing' | 'stable';
  /** Макро-условия (good, neutral, bad, crisis) */
  macroConditions: 'good' | 'neutral' | 'bad' | 'crisis';
  /** Ключевые события периода */
  keyEvents: Array<{
    date: string;
    title: string;
    impact: 'positive' | 'negative' | 'neutral';
  }>;
  /** Прогноз на следующий период */
  forecast: string;
}

/**
 * Запись стратегической памяти (долгосрочная).
 * Хранит сжатые KPI-снимки, трендовые данные, аномалии,
 * сводки стратегии, уроки из опыта и рыночные циклы.
 */
export interface StrategicMemoryEntry {
  /** Уникальный идентификатор записи (UUID v4) */
  id: string;
  /** Тип записи: снимок KPI, тренд, аномалия, стратегия, урок, цикл */
  type: StrategicMemoryEntryType;
  /** Дата записи (для KPI — дата снимка, для тренда — дата анализа) */
  date: string;
  /** Сжатое содержимое (без дубликатов и лишних пробелов) */
  compressedData: string;
  /** Развёрнутые данные — полный KPI-снимок (опционально, для kpi_snapshot) */
  raw?: PortfolioKpiSnapshot;
  /** Расширенные данные (для новых типов: strategy_snapshot, lesson_learned, market_cycle) */
  extendedData?: StrategySnapshot | LessonLearned | MarketCycleData;
  /**
   * Результат трендового анализа.
   * direction — направление (рост/падение/стабильность)
   * strength — сила тренда (0 = нет тренда, 1 = сильный тренд)
   * periodDays — период анализа в днях
   */
  trend?: {
    direction: 'up' | 'down' | 'stable';
    strength: number; // 0-1
    periodDays: number;
  };
  /**
   * Список обнаруженных аномалий в этот период.
   * severity — серьёзность аномалии (0 = минимальная, 1 = критическая)
   */
  anomalies?: Array<{
    type: string;
    severity: number; // 0-1
    description: string;
  }>;
}

// ──────────────────────────────────────────────
// 4. Запрос к памяти
// ──────────────────────────────────────────────

/**
 * Параметры запроса к двухслойной памяти.
 * Позволяет фильтровать записи по типам, ключевым словам и датам.
 */
export interface MemoryQuery {
  /** Массив типов записей для поиска (если не указан — ищутся все типы) */
  types?: MemoryEntryType[];
  /** Массив ключевых слов для полнотекстового поиска по содержанию */
  keywords?: string[];
  /** Начальная граница периода (ISO 8601, включительно) */
  from?: string;
  /** Конечная граница периода (ISO 8601, включительно) */
  to?: string;
  /** Максимальное количество возвращаемых записей (по умолчанию 50) */
  maxResults?: number;
  /** Если true — искать только в оперативной памяти */
  operationalOnly?: boolean;
  /** Если true — искать только в стратегической памяти */
  strategicOnly?: boolean;
}

/**
 * Результат запроса к памяти.
 * Содержит найденные записи из обоих слоёв и метаданные запроса.
 */
export interface MemoryQueryResult {
  /** Массив найденных записей оперативной памяти */
  operationalEntries: OperationalMemoryEntry[];
  /** Массив найденных записей стратегической памяти */
  strategicEntries: StrategicMemoryEntry[];
  /** Общее количество найденных записей (сумма operational + strategic) */
  totalFound: number;
  /** Время выполнения запроса в миллисекундах (для мониторинга производительности) */
  queryDurationMs: number;
}

// ──────────────────────────────────────────────
// 5. Конфигурация памяти
// ──────────────────────────────────────────────

/**
 * Конфигурация модуля AIMemory.
 * Определяет лимиты хранилища, TTL и режим логирования.
 * Все поля опциональны — используются значения по умолчанию.
 */
export interface AIMemoryConfig {
  /** Максимальное количество записей в оперативной памяти (по умолчанию 10000) */
  maxOperationalEntries?: number;
  /** Срок хранения оперативных записей в днях до автоматической очистки (по умолчанию 14) */
  operationalTtlDays?: number;
  /** Максимальное количество записей в стратегической памяти (по умолчанию 500) */
  maxStrategicEntries?: number;
  /** Интервал архивации KPI-снимков в днях (по умолчанию 1 — каждый день) */
  kpiArchiveIntervalDays?: number;
  /** Путь к файлу SQLite для оперативной памяти (по умолчанию ./data/ai-memory.db) */
  operationalFilePath?: string;
  /** Путь к файлу SQLite для стратегической памяти (разделяется с оперативной) */
  strategicFilePath?: string;
  /** Включить подробное логирование всех операций (по умолчанию false) */
  verbose?: boolean;
}

/** Стандартные лимиты */

/** Срок хранения оперативных записей по умолчанию (14 дней) */
export const DEFAULT_OPERATIONAL_TTL_DAYS = 14;

/** Максимальное количество оперативных записей по умолчанию (10 000) */
export const DEFAULT_MAX_OPERATIONAL_ENTRIES = 10000;

/** Максимальное количество стратегических записей по умолчанию (500) */
export const DEFAULT_MAX_STRATEGIC_ENTRIES = 500;

/** Интервал архивации KPI-снимков по умолчанию (1 день) */
export const DEFAULT_KPI_ARCHIVE_INTERVAL_DAYS = 1;

// ──────────────────────────────────────────────
// 6. Статистика памяти
// ──────────────────────────────────────────────

/**
 * Статистика модуля памяти.
 * Используется для мониторинга состояния и отображения в Dashboard.
 */
export interface AIMemoryStats {
  /** Текущее количество записей в оперативной памяти */
  operationalCount: number;
  /** Текущее количество записей в стратегической памяти */
  strategicCount: number;
  /** Общий размер оперативной памяти в байтах (сумма size_bytes всех записей) */
  operationalSizeBytes: number;
  /** Общий размер стратегической памяти в байтах (сумма LENGTH(compressed_data)) */
  strategicSizeBytes: number;
  /** Средний возраст оперативной записи в днях (от creation до now) */
  avgOperationalAgeDays: number;
  /** Максимальный возраст стратегической записи в днях */
  maxStrategicAgeDays: number;
  /** Количество аномалий, обнаруженных за последние 7 дней */
  recentAnomalies: number;
}

// ──────────────────────────────────────────────
// 7. Интерфейс AIMemory
// ──────────────────────────────────────────────

/**
 * Публичный интерфейс модуля AIMemory.
 * Предоставляет абстракцию над двухслойной памятью для других модулей.
 * Все методы асинхронны для неблокирующей работы.
 */
export interface IAIMemory {
  /**
   * Сохранить запись в оперативную память.
   * @param entry — данные записи (id, sizeBytes, lastAccessedAt генерируются автоматически)
   * @returns ID сохранённой записи
   */
  saveOperational(entry: Omit<OperationalMemoryEntry, 'id' | 'sizeBytes' | 'lastAccessedAt'>): Promise<string>;

  /**
   * Сохранить снимок KPI портфеля в стратегическую память.
   * @param snapshot — полный снимок метрик портфеля
   */
  saveStrategicKpi(snapshot: PortfolioKpiSnapshot): Promise<void>;

  /**
   * Выполнить объединённый запрос к оперативной и стратегической памяти.
   * @param query — параметры фильтрации
   * @returns результат запроса с найденными записями
   */
  query(query: MemoryQuery): Promise<MemoryQueryResult>;

  /**
   * Получить текущую статистику памяти.
   * @returns объект со статистикой (количество, размеры, возраст, аномалии)
   */
  getStats(): AIMemoryStats;

  /**
   * Получить текущее состояние модуля.
   * @returns состояние ('idle' | 'loading' | 'saving' | 'error')
   */
  getState(): MemoryState;

  /**
   * Очистить просроченные записи согласно TTL и лимитам.
   * Удаляет старые записи и архивирует записи старше 7 дней.
   */
  cleanup(): Promise<void>;

  /**
   * Экспортировать все данные памяти.
   * @param format — формат экспорта: 'json' (машины) или 'markdown' (человек)
   * @returns строка с экспортированными данными
   */
  exportMemory(format: 'json' | 'markdown'): Promise<string>;
}
