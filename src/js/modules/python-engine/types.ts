/**
 * Python Engine Types — типы TS↔Python моста и детектора аномалий.
 *
 * Движок (src/python/main.py) вызывается через PythonBridge:
 * одна JSON-строка на stdin → одна JSON-строка на stdout.
 */

// ──────────────────────────────────────────────
// 1. Входные данные анализа
// ──────────────────────────────────────────────

/** Входная серия цен для анализа аномалий */
export interface PriceSeriesInput {
  ticker: string;
  /** Цены закрытия (close) в хронологическом порядке */
  prices: number[];
  /** Даты (ISO), соответствуют prices */
  dates?: string[];
  /** Объёмы торгов (опционально) */
  volumes?: number[];
}

// ──────────────────────────────────────────────
// 2. Результаты анализа
// ──────────────────────────────────────────────

/** Точка аномалии внутри серии цен */
export interface AnomalyPoint {
  index: number;
  date: string | null;
  price: number;
  zScore: number;
  isAnomaly: boolean;
  deviationPct: number;
}

/** Результат детекции аномалий по одному тикеру */
export interface AnomalyDetectionResult {
  ticker: string;
  lastPrice: number;
  zScoreLast: number;
  isLastAnomaly: boolean;
  volatilityAnnual: number;
  rsi: number;
  sma20: number | null;
  sma50: number | null;
  trend: 'up' | 'down' | 'flat';
  riskLevel: 'low' | 'medium' | 'high';
  anomaliesCount: number;
  pointsCount: number;
  anomalies: AnomalyPoint[];
}

/** Конфигурация детектора аномалий */
export interface AnomalyDetectorConfig {
  /** Порог |z| для классификации аномалии (по умолчанию 2.0) */
  zScoreThreshold: number;
  /** Окно Z-score (по умолчанию 20) */
  window: number;
  /** Окно волатильности (по умолчанию 20) */
  volatilityWindow: number;
  /** Период RSI (по умолчанию 14) */
  rsiPeriod: number;
  verbose?: boolean;
}

// ──────────────────────────────────────────────
// 3. Протокол Python-моста
// ──────────────────────────────────────────────

/** Команды Python-движка */
export type PythonCommand =
  'detect_anomalies' | 'get_candles' | 'get_quotes' | 'health';

/** Запрос к Python-мосту */
export interface PythonRequest {
  command: PythonCommand;
  config?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

/** Ответ Python-моста */
export interface PythonResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Конфигурация Python-моста */
export interface PythonBridgeConfig {
  /** Исполняемый файл python ('python' / 'python3' / путь) */
  pythonPath: string;
  /** Путь к main.py движка */
  scriptPath: string;
  /** Таймаут выполнения команды (мс) */
  timeoutMs: number;
  verbose?: boolean;
  /**
   * Число ДОПОЛНИТЕЛЬНЫХ попыток сверх первой (по умолчанию 1).
   * Итого попыток = retries + 1 (первая + повторы).
   * Скрипт не найден — НЕ ретраится (сразу throw).
   */
  retries?: number;
  /**
   * Базовая задержка между попытками, мс (по умолчанию 300).
   * Растёт экспоненциально: delay * 2^attempt.
   */
  retryDelayMs?: number;
}

/** Интерфейс моста (для тестирования и DI) */
export interface IPythonBridge {
  call<T = unknown>(request: PythonRequest): Promise<T>;
  isAvailable(): Promise<boolean>;
  isScriptAvailable(): boolean;
}
