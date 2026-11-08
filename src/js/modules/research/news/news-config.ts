/**
 * Конфигурация модуля news.
 *
 * Централизованные настройки для всех подмодулей news.
 */

export interface NewsConfig {
  /** Включить NLP-анализ новостей */
  NLP_ANALYSIS_ENABLED: boolean;
  /** Включить ML-прогнозирование */
  ML_FORECASTING_ENABLED: boolean;
  /** Включить бэктестинг */
  BACKTESTING_ENABLED: boolean;
  /** Включить граф знаний */
  KNOWLEDGE_GRAPH_ENABLED: boolean;
  /** Включить реалтайм-алерты */
  REALTIME_ALERTS_ENABLED: boolean;
  /** Включить инкрементальное обучение */
  INCREMENTAL_LEARNING_ENABLED: boolean;
  /** Интервал опроса новостей (мс) */
  NEWS_POLL_INTERVAL_MS: number;
  /** Интервал обновления ML-прогноза (мс) */
  ML_FORECAST_UPDATE_INTERVAL_MS: number;
  /** Таймаут HTTP-запросов новостей (мс) */
  NEWS_HTTP_TIMEOUT_MS: number;
  /** Таймаут Python-движка (мс) */
  PYTHON_ENGINE_TIMEOUT_MS: number;
  /** TTL кэша новостей (мс) */
  NEWS_CACHE_TTL_MS: number;
  /** TTL кэша ML-прогноза (мс) */
  ML_FORECAST_CACHE_TTL_MS: number;
  /** Максимум новостей за одну сборку */
  NEWS_MAX_ITEMS_PER_COLLECTION: number;
  /** Максимум новостей за источник */
  NEWS_MAX_ITEMS_PER_SOURCE: number;
  /** Порог релевантности */
  NEWS_RELEVANCE_THRESHOLD: number;
  /** Порог сентимент-алерта */
  NEWS_SENTIMENT_ALERT_THRESHOLD: number;
  /** ML-прогнозы */
  ML_ENSEMBLE_MAX_MODELS: number;
  /** Минимальное согласие ML-энсамбля */
  ML_ENSEMBLE_MIN_AGREEMENT: number;
  /** Максимум сценариев */
  SCENARIO_ANALYSIS_MAX_SCENARIOS: number;
  /** Минимальная вероятность сценария */
  SCENARIO_MIN_PROBABILITY: number;
  /** Каналы алертов */
  ALERTS_CHANNELS: string[];
  /** Максимум алертов в минуту */
  ALERTS_MAX_PER_MINUTE: number;
  /** TTL кэша графа знаний (мс) */
  KG_CACHE_TTL_MS: number;
  /** Максимум рёбер на узел */
  KG_MAX_EDGES_PER_NODE: number;
  /** Минимальная сила ребра */
  KG_MIN_EDGE_STRENGTH: number;
  /** Минимальное количество образцов для обучения */
  ML_MIN_TRAINING_SAMPLES: number;
  /** Множитель затухания ML */
  ML_DECAY_FACTOR: number;
  /** Интервал обновления весов ML (дни) */
  ML_WEIGHT_UPDATE_INTERVAL_DAYS: number;
  /** Максимальная доля одного актива */
  PORTFOLIO_MAX_SINGLE_ASSET: number;
  /** Максимальная доля сектора */
  PORTFOLIO_MAX_SECTOR: number;
  /** Минимальная дивидендная доходность */
  PORTFOLIO_MIN_DIVIDEND_YIELD: number;
}

export const config: NewsConfig = {
  NLP_ANALYSIS_ENABLED: true,
  ML_FORECASTING_ENABLED: false,
  BACKTESTING_ENABLED: false,
  KNOWLEDGE_GRAPH_ENABLED: false,
  REALTIME_ALERTS_ENABLED: false,
  INCREMENTAL_LEARNING_ENABLED: false,
  NEWS_POLL_INTERVAL_MS: 300_000,
  ML_FORECAST_UPDATE_INTERVAL_MS: 600_000,
  NEWS_HTTP_TIMEOUT_MS: 10_000,
  PYTHON_ENGINE_TIMEOUT_MS: 30_000,
  NEWS_CACHE_TTL_MS: 3_600_000,
  ML_FORECAST_CACHE_TTL_MS: 7_200_000,
  NEWS_MAX_ITEMS_PER_COLLECTION: 100,
  NEWS_MAX_ITEMS_PER_SOURCE: 50,
  NEWS_RELEVANCE_THRESHOLD: 0.3,
  NEWS_SENTIMENT_ALERT_THRESHOLD: 0.7,
  ML_ENSEMBLE_MAX_MODELS: 5,
  ML_ENSEMBLE_MIN_AGREEMENT: 0.6,
  SCENARIO_ANALYSIS_MAX_SCENARIOS: 10,
  SCENARIO_MIN_PROBABILITY: 0.1,
  ALERTS_CHANNELS: ['telegram', 'email', 'push'],
  ALERTS_MAX_PER_MINUTE: 10,
  KG_CACHE_TTL_MS: 1_800_000,
  KG_MAX_EDGES_PER_NODE: 20,
  KG_MIN_EDGE_STRENGTH: 0.2,
  ML_MIN_TRAINING_SAMPLES: 30,
  ML_DECAY_FACTOR: 0.95,
  ML_WEIGHT_UPDATE_INTERVAL_DAYS: 7,
  PORTFOLIO_MAX_SINGLE_ASSET: 0.3,
  PORTFOLIO_MAX_SECTOR: 0.5,
  PORTFOLIO_MIN_DIVIDEND_YIELD: 0.05,
};
