/**
 * PredictionEngine — предсказание потребностей и прогнозирование (Этап 4, Задача 1.2).
 *
 * Компоненты:
 * - TimeSeriesForecaster: прогнозирование временных рядов (Holt, экспоненциальное
 *   сглаживание) с доверительными интервалами
 * - NeedPredictor: предсказание потребностей директора по истории запросов
 *   (FeedbackLoop)
 * - AnomalyDetectorV2: улучшенное обнаружение аномалий (z-score + CUSUM-сдвиги)
 * - TrendAnalyzer: анализ долгосрочных трендов (линейная регрессия, R²)
 * - ScenarioPlanner: сценарии best/worst/base на основе прогноза
 * - PredictionEngine: единый фасад
 *
 * Принципы: детерминированность (без LLM), честная неопределённость
 * (интервалы и confidence), DI для тестируемости.
 */

// ─── TimeSeriesForecaster ──────────────────────────────────────────────────

/** Метод прогнозирования */
export type ForecastMethod = 'sma' | 'ema' | 'holt';

/** Точка временного ряда */
export interface TimeSeriesPoint {
  /** Метка времени (ISO или любая строка) */
  ts: string;
  /** Значение */
  value: number;
}

/** Прогноз одной точки */
export interface ForecastPoint {
  /** Горизонт (шаг вперёд) */
  step: number;
  /** Точечный прогноз */
  value: number;
  /** Нижняя граница (level) */
  lower: number;
  /** Верхняя граница (level) */
  upper: number;
}

/** Результат прогнозирования */
export interface ForecastResult {
  /** Метод, которым построен прогноз */
  method: ForecastMethod;
  /** Прогнозные точки */
  points: ForecastPoint[];
  /** Уровень доверия интервалов (например, 0.95) */
  confidenceLevel: number;
  /** Среднеквадратичное отклонение остатков на истории */
  residualStd: number;
  /** Качество модели: MAPE на истории (0..1), null если не вычислено */
  mape: number | null;
  /** Честные предупреждения */
  warnings: string[];
}

/** Опции прогнозирования */
export interface ForecastOptions {
  /** Метод (по умолчанию 'holt') */
  method?: ForecastMethod;
  /** Горизонт прогноза (точек) */
  horizon?: number;
  /** Уровень доверия (по умолчанию 0.95) */
  confidenceLevel?: number;
  /** Сглаживание уровня для EMA/Holt (0..1, по умолчанию 0.3) */
  alpha?: number;
  /** Сглаживание тренда для Holt (0..1, по умолчанию 0.1) */
  beta?: number;
  /** Окно SMA (по умолчанию 5) */
  smaWindow?: number;
}

// ─── NeedPredictor ─────────────────────────────────────────────────────────

/** Категория потребности */
export interface NeedCategoryStats {
  category: string;
  /** Количество запросов за период */
  count: number;
  /** Доля от всех запросов (0..1) */
  share: number;
  /** Средний интервал между запросами категории (мс), если >=2 */
  avgIntervalMs: number | null;
  /** Пиковые часы запросов (0-23), отсортированы по частоте */
  peakHours: number[];
  /** Последний запрос категории (ISO) */
  lastAt: string | null;
}

/** Предсказанная потребность */
export interface PredictedNeed {
  /** Категория потребности */
  category: string;
  /** Вероятность запроса в ближайший час (0..1) */
  probability: number;
  /** Причины предсказания */
  reasons: string[];
  /** Ожидаемое время запроса (ISO), если прогнозируется */
  expectedAt: string | null;
  /** Честный флаг: эвристика без ML */
  heuristic: true;
}

/** Результат предсказания потребностей */
export interface NeedPredictionResult {
  /** Предсказанные потребности, отсортированы по вероятности */
  needs: PredictedNeed[];
  /** Статистика по категориям */
  categoryStats: NeedCategoryStats[];
  /** Всего проанализировано решений */
  analyzedDecisions: number;
  /** Честные предупреждения */
  warnings: string[];
}

/** Источник решений для NeedPredictor (совместим с FeedbackLoop DecisionSource) */
export interface NeedDecisionSource {
  getAll: () => Promise<
    Array<{
      id: string;
      createdAt: string;
      category: string;
      userQuestion?: string;
      tickers?: string[];
    }>
  >;
}

// ─── AnomalyDetectorV2 ─────────────────────────────────────────────────────

/** Тип аномалии */
export type AnomalyType =
  | 'spike' // резкий выброс вверх
  | 'drop' // резкий выброс вниз
  | 'shift' // сдвиг среднего уровня (CUSUM)
  | 'volatility' // всплеск волатильности
  | 'flatline'; // замирание (одинаковые значения)

/** Обнаруженная аномалия */
export interface Anomaly {
  /** Индекс точки в ряду */
  index: number;
  /** Метка времени точки */
  ts: string;
  /** Значение */
  value: number;
  /** Тип аномалии */
  type: AnomalyType;
  /** Сила аномалии (в сигмах или по метрике типа) */
  severity: number;
  /** Человекочитаемое описание */
  description: string;
}

/** Результат детекции аномалий */
export interface AnomalyV2Result {
  /** Найденные аномалии */
  anomalies: Anomaly[];
  /** Базовые статистики ряда */
  stats: {
    mean: number;
    std: number;
    min: number;
    max: number;
    count: number;
  };
  /** Честные предупреждения */
  warnings: string[];
}

/** Опции детектора аномалий V2 */
export interface AnomalyDetectorV2Options {
  /** Порог z-score для spike/drop (по умолчанию 3) */
  zThreshold?: number;
  /** Порог CUSUM для shift (в единицах std, по умолчанию 5) */
  cusumThreshold?: number;
  /** Минимум точек ряда для анализа (по умолчанию 10) */
  minPoints?: number;
  /** Минимум сигм волатильности (по умолчанию 2.5) */
  volatilityThreshold?: number;
}

// ─── TrendAnalyzer ─────────────────────────────────────────────────────────

/** Направление тренда */
export type TrendDirection = 'rising' | 'falling' | 'stable' | 'insufficient';

/** Результат анализа тренда */
export interface TrendResult {
  /** Направление тренда */
  direction: TrendDirection;
  /** Наклон (единиц за шаг) */
  slope: number;
  /** Свободный член линейной регрессии */
  intercept: number;
  /** R² — доля объяснённой дисперсии (0..1) */
  rSquared: number;
  /** Изменение за окно в процентах (если применимо) */
  changePercent: number | null;
  /** Размер окна анализа */
  windowSize: number;
  /** Честные предупреждения */
  warnings: string[];
}

/** Опции анализа тренда */
export interface TrendAnalyzerOptions {
  /** Порог |наклон| для stable (доля std за шаг, по умолчанию 0.1) */
  slopeThreshold?: number;
  /** Минимум R² для уверенного тренда (по умолчанию 0.3) */
  minRSquared?: number;
  /** Минимум точек (по умолчанию 5) */
  minPoints?: number;
}

// ─── ScenarioPlanner ───────────────────────────────────────────────────────

/** Тип сценария */
export type ScenarioKind = 'best' | 'base' | 'worst';

/** Сценарий будущего */
export interface PlannedScenario {
  /** Тип сценария */
  kind: ScenarioKind;
  /** Описание сценария */
  description: string;
  /** Прогнозные значения (суммарно/по точкам) */
  forecast: ForecastResult;
  /** Итоговое значение на горизонте */
  finalValue: number;
  /** Изменение от последнего известного значения, % */
  changePercent: number;
  /** Вероятностный вес сценария (0..1) */
  weight: number;
}

/** Результат планирования сценариев */
export interface ScenarioPlanResult {
  /** Сценарии: base, best, worst */
  scenarios: PlannedScenario[];
  /** Последнее известное значение ряда */
  lastValue: number;
  /** Честные предупреждения */
  warnings: string[];
}

/** Опции планировщика сценариев */
export interface ScenarioPlannerOptions {
  /** Множитель сигмы для best/worst (по умолчанию 2) */
  sigmaMultiplier?: number;
  /** Горизонт (точек, по умолчанию 10) */
  horizon?: number;
}

// ─── PredictionEngine facade ───────────────────────────────────────────────

/** Действия PredictionEngine */
export type PredictionEngineAction =
  | 'forecast'
  | 'predict-needs'
  | 'detect-anomalies'
  | 'analyze-trend'
  | 'plan-scenarios'
  | 'full-report';

/** Выход PredictionEngine */
export interface PredictionEngineOutput {
  action: PredictionEngineAction;
  success: boolean;
  data?: unknown;
  error?: string;
}
