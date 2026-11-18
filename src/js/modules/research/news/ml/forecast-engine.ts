/**
 * Forecast Engine — прогнозирование цен через Python ML.
 *
 * Использует ансамбль моделей (ARIMA, Prophet, LSTM) для прогнозирования.
 */

import { PythonBridge } from '../../../shared/python-engine/python-bridge.js';
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
   * Fallback: прогноз на основе технических индикаторов (RSI, ATR, Bollinger Bands, SMA).
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

    // Расчёт SMA
    const sma20 = this.calculateSMA(candles, 20);
    const sma50 = this.calculateSMA(candles, 50);

    // RSI (Relative Strength Index) — 14-период
    const rsi = this.calculateRSI(candles, 14);

    // ATR (Average True Range) — 14-период
    const atr = this.calculateATR(candles, 14);

    // Bollinger Bands (20, 2)
    const bbUpper = this.calculateBollingerUpper(candles, 20, 2);
    const bbLower = this.calculateBollingerLower(candles, 20, 2);

    // Определяем позицию цены относительно Bollinger Bands
    const bbPosition = (lastCandle.close - bbLower) / (bbUpper - bbLower || 1);

    // Определяем тренд по комбинации SMA и RSI
    let trend: 'UP' | 'DOWN' | 'SIDEWAYS';
    if (sma20 > sma50 && rsi > 50 && rsi < 70) {
      trend = 'UP';
    } else if (sma20 < sma50 && rsi < 50 && rsi > 30) {
      trend = 'DOWN';
    } else if (rsi >= 70) {
      trend = 'DOWN'; // перекупленность
    } else if (rsi <= 30) {
      trend = 'UP'; // перепроданность
    } else {
      trend = 'SIDEWAYS';
    }

    // Определяем коэффициент волатильности на основе ATR
    const atrPct = lastCandle.close > 0 ? atr / lastCandle.close : 0.02;
    const volatilityMultiplier = Math.max(0.5, Math.min(2, atrPct * 10));

    // Коэффициенты прогноза с учётом волатильности
    const weeklyFactor = trend === 'UP' ? (1 + atrPct * 1.5 * volatilityMultiplier)
      : trend === 'DOWN' ? (1 - atrPct * 1.5 * volatilityMultiplier)
      : (1 + atrPct * 0.3 * volatilityMultiplier);

    const monthlyFactor = trend === 'UP' ? (1 + atrPct * 2.5 * volatilityMultiplier)
      : trend === 'DOWN' ? (1 - atrPct * 2.5 * volatilityMultiplier)
      : (1 + atrPct * 0.5 * volatilityMultiplier);

    const threeMonthFactor = trend === 'UP' ? (1 + atrPct * 4 * volatilityMultiplier)
      : trend === 'DOWN' ? (1 - atrPct * 4 * volatilityMultiplier)
      : (1 + atrPct * 0.8 * volatilityMultiplier);

    // Уверенность прогноза зависит от количества данных и RSI
    const dataConfidence = Math.min(0.9, candles.length / 100);
    const rsiConfidence = rsi > 30 && rsi < 70 ? 0.8 : 0.6; // RSI в норме = выше уверенность
    const confidence = {
      week: Math.round(Math.min(0.85, dataConfidence * rsiConfidence * 1.1) * 100) / 100,
      month: Math.round(Math.min(0.7, dataConfidence * rsiConfidence * 0.9) * 100) / 100,
      threeMonth: Math.round(Math.min(0.55, dataConfidence * rsiConfidence * 0.7) * 100) / 100,
    };

    return {
      ticker,
      currentPrice: lastCandle.close,
      forecasts: [
        {
          period: '1_week',
          price: Math.round(lastCandle.close * weeklyFactor * 100) / 100,
          confidence: confidence.week,
          direction: trend as 'UP' | 'DOWN' | 'SIDEWAYS',
        },
        {
          period: '1_month',
          price: Math.round(lastCandle.close * monthlyFactor * 100) / 100,
          confidence: confidence.month,
          direction: trend as 'UP' | 'DOWN' | 'SIDEWAYS',
        },
        {
          period: '3_month',
          price: Math.round(lastCandle.close * threeMonthFactor * 100) / 100,
          confidence: confidence.threeMonth,
          direction: trend as 'UP' | 'DOWN' | 'SIDEWAYS',
        },
      ],
      modelsUsed: ['fallback_technical'],
      factors: {
        technical: `Trend: ${trend}, RSI: ${rsi.toFixed(1)}, ATR: ${atr.toFixed(2)}, BB: ${bbLower.toFixed(2)}-${bbUpper.toFixed(2)} (позиция: ${(bbPosition * 100).toFixed(0)}%)`,
        fundamental: 'Нет данных',
        sentiment: 'Нет данных',
        macro: 'Нет данных',
      },
      ensemble: {
        agreementScore: confidence.month,
        modelPredictions: [
          { name: 'SMA_Trend', prediction: lastCandle.close * (trend === 'UP' ? 1.05 : trend === 'DOWN' ? 0.95 : 1), weight: 0.4 },
          { name: 'RSI_MeanReversion', prediction: rsi > 70 ? lastCandle.close * 0.97 : rsi < 30 ? lastCandle.close * 1.03 : lastCandle.close, weight: 0.3 },
          { name: 'ATR_Volatility', prediction: lastCandle.close * (1 + (trend === 'UP' ? 0.02 : trend === 'DOWN' ? -0.02 : 0) * volatilityMultiplier), weight: 0.3 },
        ],
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

  /**
   * Расчёт RSI (Relative Strength Index).
   */
  private calculateRSI(candles: CandleData[], period: number): number {
    if (candles.length < period + 1) {
      return 50; // нейтральное значение при недостатке данных
    }

    const closes = candles.map((c) => c.close);
    let gains = 0;
    let losses = 0;

    // Начальный расчёт
    for (let i = 1; i <= period; i++) {
      const change = closes[candles.length - period + i]! - closes[candles.length - period + i - 1]!;
      if (change > 0) gains += change;
      else losses -= change;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Расчёт ATR (Average True Range).
   */
  private calculateATR(candles: CandleData[], period: number): number {
    if (candles.length < period + 1) {
      // Простая оценка волатильности
      const recent = candles.slice(-period);
      const max = Math.max(...recent.map((c) => c.high ?? c.close));
      const min = Math.min(...recent.map((c) => c.low ?? c.close));
      return (max - min) / 2;
    }

    const trueRanges: number[] = [];
    const closes = candles.map((c) => c.close);

    for (let i = candles.length - period; i < candles.length; i++) {
      const high = candles[i]!.high ?? candles[i]!.close;
      const low = candles[i]!.low ?? candles[i]!.close;
      const prevClose = closes[i - 1] ?? candles[i]!.close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose),
      );
      trueRanges.push(tr);
    }

    return trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
  }

  /**
   * Расчёт верхней границы Bollinger Bands.
   */
  private calculateBollingerUpper(candles: CandleData[], period: number, stdDev: number): number {
    const sma = this.calculateSMA(candles, period);
    const recent = candles.slice(-period);
    const variance = recent.reduce((sum, c) => sum + Math.pow(c.close - sma, 2), 0) / period;
    return sma + stdDev * Math.sqrt(variance);
  }

  /**
   * Расчёт нижней границы Bollinger Bands.
   */
  private calculateBollingerLower(candles: CandleData[], period: number, stdDev: number): number {
    const sma = this.calculateSMA(candles, period);
    const recent = candles.slice(-period);
    const variance = recent.reduce((sum, c) => sum + Math.pow(c.close - sma, 2), 0) / period;
    return sma - stdDev * Math.sqrt(variance);
  }
}
