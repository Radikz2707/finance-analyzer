/**
 * Forecast Engine — прогнозирование цен через Python ML.
 *
 * Использует ансамбль моделей (ARIMA, Prophet, LSTM) для прогнозирования.
 */

import { PythonBridge } from '../../python-engine/python-bridge.js';
import { config as newsConfig } from '../news-config.js';

/** Свеча котировок */
export interface CandleData {
  /** Дата */
  date: string;
  /** Цена закрытия */
  close: number;
  /** Максимальная цена */
  high?: number;
  /** Минимальная цена */
  low?: number;
  /** Объём */
  volume?: number;
}

/** Прогноз на один период */
export interface ForecastPoint {
  /** Период: 1_week, 1_month, 3_month */
  period: '1_week' | '1_month' | '3_month' | '6_month' | '1_year';
  /** Прогнозная цена */
  price: number;
  /** Уверенность прогноза (0.0 - 1.0) */
  confidence: number;
  /** Направление: UP, DOWN, SIDEWAYS */
  direction: 'UP' | 'DOWN' | 'SIDEWAYS';
}

/** Результат прогнозирования */
export interface ForecastResult {
  /** Тикер */
  ticker: string;
  /** Текущая цена */
  currentPrice: number;
  /** Прогнозы по периодам */
  forecasts: ForecastPoint[];
  /** Использованные модели */
  modelsUsed: string[];
  /** Факторы влияния */
  factors: {
    technical: string;
    fundamental: string;
    sentiment: string;
    macro: string;
  };
  /** Ансамбль моделей */
  ensemble?: {
    agreementScore: number;
    modelPredictions: Array<{
      name: string;
      prediction: number;
      weight: number;
    }>;
  };
}

/** Forecast Engine */
export class ForecastEngine {
  private bridge = new PythonBridge();

  /**
   * Прогнозирование цен.
   */
  async forecast(
    ticker: string,
    candles: CandleData[],
    sentimentScore: number = 0,
    macroFactors?: Record<string, number>,
  ): Promise<ForecastResult> {
    // Проверка включен ли ML
    if (!newsConfig.ML_FORECASTING_ENABLED) {
      return this.fallbackForecast(ticker, candles);
    }

    try {
      const result = await this.bridge.call<unknown>({
        command: 'forecast_prices' as const,
        payload: {
          ticker,
          candles: candles.slice(-newsConfig.ML_MIN_TRAINING_SAMPLES),
          sentimentScore,
          macroFactors,
        },
      });

      const r = result as {
        ticker: string;
        currentPrice: number;
        forecasts: ForecastPoint[];
        models_used: string[];
        factors: {
          technical: string;
          fundamental: string;
          sentiment: string;
          macro: string;
        };
        ensemble?: {
          agreement_score: number;
          model_predictions: Array<{
            name: string;
            prediction: number;
            weight: number;
          }>;
        };
      };

      return {
        ticker: r.ticker,
        currentPrice: r.currentPrice,
        forecasts: r.forecasts,
        modelsUsed: r.models_used,
        factors: r.factors,
        ensemble: r.ensemble
          ? {
              agreementScore: r.ensemble.agreement_score,
              modelPredictions: r.ensemble.model_predictions,
            }
          : undefined,
      };
    } catch (error) {
      console.warn('[Forecast] Python недоступен, fallback:', error);
      return this.fallbackForecast(ticker, candles);
    }
  }

  /**
   * Fallback: простой прогноз на основе технических индикаторов.
   */
  private fallbackForecast(ticker: string, candles: CandleData[]): ForecastResult {
    const lastCandle = candles[candles.length - 1];
    if (!lastCandle) {
      return {
        ticker,
        currentPrice: 0,
        forecasts: [],
        modelsUsed: ['fallback'],
        factors: {
          technical: 'Нет данных',
          fundamental: 'Нет данных',
          sentiment: 'Нет данных',
          macro: 'Нет данных',
        },
      };
    }

    // Расчёт SMA для определения тренда
    const sma20 = this.calculateSMA(candles, 20);
    const sma50 = this.calculateSMA(candles, 50);

    const trend = sma20 > sma50 ? 'UP' : 'DOWN';

    return {
      ticker,
      currentPrice: lastCandle.close,
      forecasts: [
        {
          period: '1_week',
          price: lastCandle.close * (trend === 'UP' ? 1.03 : 0.97),
          confidence: 0.55,
          direction: trend as 'UP' | 'DOWN' | 'SIDEWAYS',
        },
        {
          period: '1_month',
          price: lastCandle.close * (trend === 'UP' ? 1.08 : 0.92),
          confidence: 0.45,
          direction: trend as 'UP' | 'DOWN' | 'SIDEWAYS',
        },
        {
          period: '3_month',
          price: lastCandle.close * (trend === 'UP' ? 1.15 : 0.85),
          confidence: 0.35,
          direction: trend as 'UP' | 'DOWN' | 'SIDEWAYS',
        },
      ],
      modelsUsed: ['fallback_sma'],
      factors: {
        technical: `Trend: ${trend} (SMA20: ${sma20.toFixed(2)}, SMA50: ${sma50.toFixed(2)})`,
        fundamental: 'Нет данных',
        sentiment: 'Нет данных',
        macro: 'Нет данных',
      },
    };
  }

  /**
   * Расчёт SMA (Simple Moving Average).
   */
  private calculateSMA(candles: CandleData[], period: number): number {
    if (candles.length < period) {
      return candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
    }

    const recent = candles.slice(-period);
    return recent.reduce((sum, c) => sum + c.close, 0) / period;
  }
}
