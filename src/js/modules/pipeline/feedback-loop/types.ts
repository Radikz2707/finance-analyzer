/**
 * FeedbackLoop — цикл обратной связи для автономного робота-ассистента.
 *
 * Компоненты:
 * - OutcomeTracker: отслеживание результатов решений
 * - SuccessMetrics: метрики успешности (win rate, ROI, satisfaction)
 * - ABTestEngine: тестирование разных подходов
 * - ReinforcementLearning: обучение с подкреплением
 * - FeedbackLoop: единый фасад для всех компонентов
 *
 * Интеграция: LearningAgent, DirectorAgent, AI Memory
 */

// ─── OutcomeTracker ────────────────────────────────────────────────────────

/** Исходное решение / рекомендация */
export interface DecisionRecord {
  /** Уникальный идентификатор решения */
  id: string;
  /** Дата и время принятия решения (ISO) */
  createdAt: string;
  /** Вопрос пользователя */
  userQuestion: string;
  /** Категории: asset, portfolio, comparison, scenario, market и т.д. */
  category: string;
  /** Тикеры, связанные с решением */
  tickers: string[];
  /** Рекомендованное действие */
  recommendedAction: string;
  /** Обоснование рекомендации */
  reasoning: string;
  /** Уверенность модели (0-1) */
  confidence: number;
  /** Какие агенты участвовали */
  agentRoles: string[];
  /** ID пайплайна, если был запущен */
  pipelineId?: string;
  /** Метаданные */
  metadata?: Record<string, unknown>;
}

/** Результат реализации решения */
export interface OutcomeRecord {
  /** ID решения, к которому относится результат */
  decisionId: string;
  /** Дата и время фиксации результата (ISO) */
  recordedAt: string;
  /** Фактическое действие, предпринятое директором */
  actualAction: string;
  /** Последствия: positive / negative / neutral / ignored */
  outcome: 'positive' | 'negative' | 'neutral' | 'ignored';
  /** ROI в процентах, если применимо */
  roiPercent?: number;
  /** Оценка удовлетворённости директора (1-5) */
  satisfaction?: number;
  /** Задержка между рекомендацией и действием (мс) */
  actionDelayMs?: number;
  /** Время наблюдения за результатом (мс) */
  observationWindowMs?: number;
  /** Заметки директора */
  notes?: string;
  /** Подтверждено ли, что решение было реализовано */
  implemented: boolean;
  /** Метаданные */
  metadata?: Record<string, unknown>;
}

/** Связка решения и результата */
export interface DecisionOutcomePair {
  decision: DecisionRecord;
  outcome: OutcomeRecord | null;
  matched: boolean;
}

// ─── SuccessMetrics ────────────────────────────────────────────────────────

/** Метрики успешности по категории */
export interface CategoryMetrics {
  /** Категория (asset, portfolio и т.д.) */
  category: string;
  /** Всего решений */
  totalDecisions: number;
  /** Реализованных решений */
  implementedCount: number;
  /** Позитивных результатов */
  positiveCount: number;
  /** Негативных результатов */
  negativeCount: number;
  /** Игнорированных */
  ignoredCount: number;
  /** Win rate (позитивные / реализованные) */
  winRate: number;
  /** Средняя уверенность */
  avgConfidence: number;
  /** Средняя удовлетворённость */
  avgSatisfaction: number;
  /** Средний ROI (%) */
  avgRoi: number;
  /** Средняя задержка (мс) */
  avgActionDelayMs: number;
}

/** Общие метрики системы */
export interface SystemMetrics {
  /** Всего решений */
  totalDecisions: number;
  /** Всего результатов */
  totalOutcomes: number;
  /** Win rate (общий) */
  overallWinRate: number;
  /** Доля реализованных решений */
  implementationRate: number;
  /** Средняя уверенность */
  avgConfidence: number;
  /** Средняя удовлетворённость */
  avgSatisfaction: number;
  /** Средний ROI (%) */
  avgRoi: number;
  /** Метрики по категориям */
  byCategory: CategoryMetrics[];
  /** Метрики по тикерам */
  byTicker: Record<string, CategoryMetrics>;
  /** Метрики по агентам */
  byAgent: Record<string, CategoryMetrics>;
  /** Тренды за последние N дней */
  trend: TrendPoint[];
}

/** Точка тренда */
export interface TrendPoint {
  /** Период (дата) */
  date: string;
  /** Win rate за период */
  winRate: number;
  /** Количество решений */
  decisionCount: number;
  /** Средняя удовлетворённость */
  avgSatisfaction: number;
  /** Средний ROI (%) */
  avgRoi: number;
}

// ─── ABTestEngine ──────────────────────────────────────────────────────────

/** Вариант A/B теста */
export interface ABTestVariant {
  /** Уникальный идентификатор варианта */
  id: string;
  /** Название варианта (A, B, Control и т.д.) */
  name: string;
  /** Описание подхода */
  description: string;
  /** Параметры подхода */
  params: Record<string, unknown>;
}

/** Результат A/B теста */
export interface ABTestResult {
  /** ID теста */
  testId: string;
  /** ID варианта */
  variantId: string;
  /** Количество показов (решений) */
  impressions: number;
  /** Количество конверсий (позитивных результатов) */
  conversions: number;
  /** Conversion rate */
  conversionRate: number;
  /** Средний ROI */
  avgRoi: number;
  /** Средняя удовлетворённость */
  avgSatisfaction: number;
}

/** A/B тест */
export interface ABTest {
  /** Уникальный идентификатор теста */
  id: string;
  /** Название теста */
  name: string;
  /** Описание */
  description: string;
  /** Варианты */
  variants: ABTestVariant[];
  /** Статус: running / completed / cancelled */
  status: 'running' | 'completed' | 'cancelled';
  /** Результаты по вариантам */
  results: ABTestResult[];
  /** Дата создания */
  createdAt: string;
  /** Дата завершения */
  completedAt?: string;
  /** Победивший вариант (если определён) */
  winnerVariantId?: string;
  /** Статистическая значимость (p-value) */
  pValue?: number;
  /** Метаданные */
  metadata?: Record<string, unknown>;
}

/** Параметры запуска теста */
export interface CreateABTestParams {
  /** Название теста */
  name: string;
  /** Описание */
  description?: string;
  /** Варианты */
  variants: Omit<ABTestVariant, 'id'>[];
  /** Метаданные */
  metadata?: Record<string, unknown>;
}

/** Результат сравнения вариантов */
export interface VariantComparison {
  variantId: string;
  variantName: string;
  conversionRate: number;
  avgRoi: number;
  avgSatisfaction: number;
  sampleSize: number;
  confidence: number;
  isWinner: boolean;
  isLoser: boolean;
  isTie: boolean;
}

// ─── ReinforcementLearning ─────────────────────────────────────────────────

/** Вектор признаков для RL */
export interface FeatureVector {
  /** Категория вопроса */
  category: string;
  /** Количество тикеров */
  tickerCount: number;
  /** Уверенность модели */
  confidence: number;
  /** Количество агентов */
  agentCount: number;
  /** Время суток (0-23) */
  hourOfDay: number;
  /** День недели (0-6) */
  dayOfWeek: number;
  /** Флаг выходного дня */
  isWeekend: boolean;
  /** Средний ROI по категории (исторический) */
  historicalAvgRoi: number;
  /** Win rate по категории (исторический) */
  historicalWinRate: number;
}

/** Вес действия в RL */
export interface ActionWeight {
  /** Категория */
  category: string;
  /** Действие */
  action: string;
  /** Текущий вес */
  weight: number;
  /** Количество наблюдений */
  observations: number;
  /** Средний reward */
  avgReward: number;
  /** Стандартное отклонение */
  rewardStd: number;
  /** Последний update */
  lastUpdated: string;
}

/** Настройки RL */
export interface RLConfig {
  /** Коэффициент обучения (alpha) — скорость обновления весов */
  learningRate?: number;
  /** Коэффициент дисконтирования (gamma) — важность будущих наград */
  discountFactor?: number;
  /** Epsilon для exploration (epsilon-greedy) */
  explorationRate?: number;
  /** Half-life устаревания весов (дни) */
  weightHalfLifeDays?: number;
}

/** Прогноз RL */
export interface RLPrediction {
  /** Предпочтительное действие */
  recommendedAction: string;
  /** Ожидаемый reward */
  expectedReward: number;
  /** Уверенность прогноза */
  confidence: number;
  /** Использованные веса */
  usedWeights: ActionWeight[];
  /** Флаг exploration vs exploitation */
  isExploration: boolean;
}

// ─── FeedbackLoop Facade ───────────────────────────────────────────────────

/** Статус FeedbackLoop */
export type FeedbackLoopStatus = 'idle' | 'tracking' | 'analyzing' | 'learning' | 'error';

/** Опции FeedbackLoop */
export interface FeedbackLoopOptions {
  /** Настройки RL */
  rlConfig?: RLConfig;
  /** Период автоматического анализа (мс) */
  analysisIntervalMs?: number;
  /** Источник решений (DI) */
  decisionSource?: DecisionSource;
  /** Источник результатов (DI) */
  outcomeSource?: OutcomeSource;
  /** Источник уроков LearningAgent (DI) */
  lessonSource?: LessonSource;
}

/** Источник решений */
export interface DecisionSource {
  /** Получить все решения */
  getAll: () => Promise<DecisionRecord[]>;
  /** Получить решение по ID */
  getById: (id: string) => Promise<DecisionRecord | undefined>;
  /** Сохранить решение */
  save: (record: DecisionRecord) => Promise<string>;
  /** Получить решения по категории */
  getByCategory: (category: string) => Promise<DecisionRecord[]>;
  /** Получить решения по тикеру */
  getByTicker: (ticker: string) => Promise<DecisionRecord[]>;
}

/** Источник результатов */
export interface OutcomeSource {
  /** Получить все результаты */
  getAll: () => Promise<OutcomeRecord[]>;
  /** Получить результат по decisionId */
  getByDecisionId: (decisionId: string) => Promise<OutcomeRecord | undefined>;
  /** Сохранить результат */
  save: (record: OutcomeRecord) => Promise<string>;
  /** Получить результаты по decisionId */
  getByDecisionIdList: (decisionId: string) => Promise<OutcomeRecord[]>;
}

/** Источник уроков */
export interface LessonSource {
  /** Сохранить урок */
  saveLesson: (lesson: LessonEntry) => Promise<void>;
  /** Получить все уроки */
  getLessons: () => Promise<LessonEntry[]>;
}

/** Запись урока для LessonSource */
export interface LessonEntry {
  id: string;
  pattern: string;
  action: string;
  outcome: 'positive' | 'negative' | 'neutral';
  weight: number;
  createdAt: string;
  source: 'feedback' | 'history' | 'analysis' | 'reinforcement';
  agent?: string;
  note?: string;
}

/** Результат анализа */
export interface AnalysisResult {
  /** Общие метрики */
  metrics: SystemMetrics;
  /** Сильные стороны */
  strengths: string[];
  /** Слабые стороны */
  weaknesses: string[];
  /** Рекомендации */
  recommendations: string[];
  /** Предупреждения */
  warnings: string[];
}

/** Результат RL-предсказания */
export interface RLResult {
  /** Прогноз */
  prediction: RLPrediction | null;
  /** Обновлённые веса */
  updatedWeights: ActionWeight[];
  /** Применил ли exploration */
  appliedExploration: boolean;
}

/** Входные данные FeedbackLoop */
export type FeedbackLoopAction =
  | 'track-decision'
  | 'record-outcome'
  | 'get-metrics'
  | 'get-analysis'
  | 'create-ab-test'
  | 'record-ab-result'
  | 'get-ab-tests'
  | 'get-ab-result'
  | 'analyze'
  | 'update-weights'
  | 'predict'
  | 'get-weights'
  | 'get-status'
  | 'reset'
  | 'clear-all';

/** Выходные данные FeedbackLoop */
export interface FeedbackLoopOutput {
  action: FeedbackLoopAction;
  success: boolean;
  data?: unknown;
  error?: string;
}
