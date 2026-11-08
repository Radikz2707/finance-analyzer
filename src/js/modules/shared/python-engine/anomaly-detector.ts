/**
 * AnomalyDetector — детектор статистических аномалий цен.
 *
 * Основной путь: Python-движок (src/python/) через PythonBridge.
 * Fallback: при недоступности Python — встроенная TS-реализация
 * с той же математикой (Z-score, SMA, RSI, волатильность).
 *
 * Это гарантирует, что pipeline работает даже без установленного Python.
 */

import { PythonBridge } from './python-bridge.js';
import type {
  AnomalyDetectionResult,
  AnomalyDetectorConfig,
  AnomalyPoint,
  IPythonBridge,
  PriceSeriesInput,
} from './types.js';

const DEFAULT_CONFIG: AnomalyDetectorConfig = {
  zScoreThreshold: 2.0,
  window: 20,
  volatilityWindow: 20,
  rsiPeriod: 14,
};

/**
 * AnomalyDetector — высокоуровневый сервис анализа аномалий.
 */
export class AnomalyDetector {
  private readonly bridge: IPythonBridge;
  private readonly config: AnomalyDetectorConfig;
  private pythonAvailable: boolean | null = null;

  constructor(bridge?: IPythonBridge, config?: Partial<AnomalyDetectorConfig>) {
    this.bridge = bridge ?? new PythonBridge();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Детекция аномалий для нескольких серий цен.
   * Python-движок → прозрачный fallback на TypeScript.
   */
  async detectAnomalies(
    series: PriceSeriesInput[],
  ): Promise<AnomalyDetectionResult[]> {
    if (series.length === 0) {
      return [];
    }

    if (this.pythonAvailable === null) {
      this.pythonAvailable = await this.bridge.isAvailable();
    }

    if (this.pythonAvailable) {
      try {
        const data = await this.bridge.call<AnomalyDetectionResult[]>({
          command: 'detect_anomalies',
          config: { ...this.config },
          payload: { series },
        });
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[AnomalyDetector] ⚠️ Python-движок: ${message}. Fallback на TypeScript.`,
        );
        this.pythonAvailable = false;
      }
    }

    return series.map((s) => detectAnomaliesInTypeScript(s, this.config));
  }
}

// ──────────────────────────────────────────────
// TypeScript fallback (та же математика, что и в Python)
// ──────────────────────────────────────────────

/** Скользящее среднее (первые window-1 элементов = null) */
function sma(values: number[], windowSize: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (windowSize <= 0 || values.length < windowSize) {
    return result;
  }

  let running = 0;
  for (let i = 0; i < windowSize; i++) {
    running += values[i] ?? 0;
  }
  result[windowSize - 1] = running / windowSize;

  for (let i = windowSize; i < values.length; i++) {
    running += (values[i] ?? 0) - (values[i - windowSize] ?? 0);
    result[i] = running / windowSize;
  }

  return result;
}

/** Стандартное отклонение (population) */
function stddev(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Z-score точек относительно окна ПРЕДШЕСТВУЮЩИХ значений */
function rollingZScore(
  values: number[],
  windowSize: number,
  threshold: number,
): (AnomalyPoint | null)[] {
  const points: (AnomalyPoint | null)[] = [];

  for (let i = 0; i < values.length; i++) {
    if (i < windowSize) {
      points.push(null);
      continue;
    }

    const history = values.slice(i - windowSize, i);
    const mean = history.reduce((a, b) => a + b, 0) / windowSize;
    const std = stddev(history);
    const value = values[i] ?? 0;
    const z = std === 0 ? 0 : (value - mean) / std;
    const deviationPct = mean !== 0 ? ((value - mean) / mean) * 100 : 0;

    points.push({
      index: i,
      date: null,
      price: value,
      zScore: Number(z.toFixed(4)),
      isAnomaly: Math.abs(z) > threshold,
      deviationPct: Number(deviationPct.toFixed(2)),
    });
  }

  return points;
}

/** RSI (Wilder) */
function rsi(values: number[], period: number): number {
  if (values.length < period + 1) {
    return 50;
  }

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = (values[i] ?? 0) - (values[i - 1] ?? 0);
    avgGain += Math.max(change, 0);
    avgLoss += Math.max(-change, 0);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < values.length; i++) {
    const change = (values[i] ?? 0) - (values[i - 1] ?? 0);
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

/** Аннуализированная волатильность по хвосту окна */
function annualizedVolatility(
  values: number[],
  windowSize: number,
  periodsPerYear = 252,
): number {
  const rets: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1] ?? 0;
    const cur = values[i] ?? 0;
    if (prev > 0 && cur > 0) {
      rets.push(Math.log(cur / prev));
    }
  }
  if (rets.length < 2) {
    return 0;
  }
  const tail = rets.slice(-windowSize);
  return Number((stddev(tail) * Math.sqrt(periodsPerYear)).toFixed(4));
}

/** Определение тренда по SMA20/SMA50 */
function detectTrend(
  values: number[],
  sma20: (number | null)[],
  sma50: (number | null)[],
): AnomalyDetectionResult['trend'] {
  const last = values.length - 1;
  if (last < 0) {
    return 'flat';
  }
  const s20 = sma20[last];
  const s50 = sma50[last];

  if (s20 !== undefined && s20 !== null && s50 !== undefined && s50 !== null) {
    const lastValue = values[last];
    if (lastValue !== undefined) {
      if (s20 > s50 && lastValue > s20) {
        return 'up';
      }
      if (s20 < s50 && lastValue < s20) {
        return 'down';
      }
    }
  }
  return 'flat';
}

/** Уровень риска */
function riskLevel(
  volatility: number,
  zScore: number,
  threshold: number,
): AnomalyDetectionResult['riskLevel'] {
  let score = 0;
  if (volatility > 0.5) score += 2;
  else if (volatility > 0.3) score += 1;
  if (Math.abs(zScore) > threshold) score += 1;

  if (score >= 3) return 'high';
  if (score === 2) return 'medium';
  return 'low';
}

/** Fallback-детекция на чистом TypeScript */
export function detectAnomaliesInTypeScript(
  input: PriceSeriesInput,
  config: Partial<AnomalyDetectorConfig> = {},
): AnomalyDetectionResult {
  const cfg: AnomalyDetectorConfig = { ...DEFAULT_CONFIG, ...config };
  const { prices } = input;
  const lastIdx = prices.length - 1;

  if (prices.length < cfg.window + 1) {
    return {
      ticker: input.ticker,
      lastPrice: lastIdx >= 0 ? prices[lastIdx]! : 0,
      zScoreLast: 0,
      isLastAnomaly: false,
      volatilityAnnual: 0,
      rsi: 50,
      sma20: null,
      sma50: null,
      trend: 'flat',
      riskLevel: 'low',
      anomaliesCount: 0,
      pointsCount: prices.length,
      anomalies: [],
    };
  }

  const zPoints = rollingZScore(prices, cfg.window, cfg.zScoreThreshold);
  const sma20 = sma(prices, 20);
  const sma50 = sma(prices, 50);
  const volatility = annualizedVolatility(prices, cfg.volatilityWindow);
  const rsiValue = rsi(prices, cfg.rsiPeriod);
  const trend = detectTrend(prices, sma20, sma50);

  const anomalies: AnomalyPoint[] = [];
  for (let i = 0; i < zPoints.length; i++) {
    const point = zPoints[i];
    if (point && point.isAnomaly) {
      anomalies.push({
        ...point,
        date: input.dates?.[i] ?? null,
      });
    }
  }

  const lastPoint = zPoints[lastIdx];
  const lastZ = lastPoint ? lastPoint.zScore : 0;
  const isLastAnomaly = lastPoint ? lastPoint.isAnomaly : false;

  return {
    ticker: input.ticker,
    lastPrice: prices[lastIdx]!,
    zScoreLast: lastZ,
    isLastAnomaly,
    volatilityAnnual: volatility,
    rsi: rsiValue,
    sma20: sma20[lastIdx] !== null ? Number(sma20[lastIdx]!.toFixed(4)) : null,
    sma50: sma50[lastIdx] !== null ? Number(sma50[lastIdx]!.toFixed(4)) : null,
    trend,
    riskLevel: riskLevel(volatility, lastZ, cfg.zScoreThreshold),
    anomaliesCount: anomalies.length,
    pointsCount: prices.length,
    anomalies,
  };
}
