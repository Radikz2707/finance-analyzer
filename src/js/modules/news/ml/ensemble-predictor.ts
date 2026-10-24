/**
 * Ensemble Predictor — ансамбль ML-моделей для прогнозирования.
 *
 * Объединяет прогнозы нескольких моделей (ARIMA, Prophet, LSTM, XGBoost)
 * с взвешенным голосованием для повышения точности.
 */

import { config as newsConfig } from '../news-config.js';

/** Прогноз от одной модели */
export interface ModelPrediction {
  /** Название модели */
  name: string;
  /** Прогнозная цена */
  prediction: number;
  /** Вес модели (точность в прошлом) */
  weight: number;
}

/** Результат ансамбля */
export interface EnsembleResult {
  /** Взвешенное среднее прогноза */
  ensemblePrediction: number;
  /** Уверенность ансамбля (0.0 - 1.0) */
  confidence: number;
  /** Согласованность моделей (0.0 - 1.0) */
  agreementScore: number;
  /** Предсказания отдельных моделей */
  modelPredictions: ModelPrediction[];
  /** Предупреждение о расхождении моделей */
  divergenceAlert: string | null;
}

/** Ensemble Predictor */
export class EnsemblePredictor {
  /**
   * Создание ансамбля прогнозов.
   */
  predict(predictions: ModelPrediction[]): EnsembleResult {
    // Фильтрация моделей с нулевым весом
    const validPredictions = predictions.filter((p) => p.weight > 0);

    if (validPredictions.length === 0) {
      return this.emptyResult();
    }

    // Ограничение количества моделей
    const limited = validPredictions.slice(
      0,
      newsConfig.ML_ENSEMBLE_MAX_MODELS,
    );

    // Расчёт взвешенного среднего
    const totalWeight = limited.reduce((sum, p) => sum + p.weight, 0);
    const weightedSum = limited.reduce(
      (sum, p) => sum + p.prediction * p.weight,
      0,
    );
    const ensemblePrediction = weightedSum / totalWeight;

    // Расчёт согласованности (стандартное отклонение / среднее)
    const mean = ensemblePrediction;
    const variance = limited.reduce(
      (sum, p) => sum + Math.pow(p.prediction - mean, 2) * p.weight,
      0,
    ) / totalWeight;
    const stdDev = Math.sqrt(variance);
    const agreementScore = Math.max(0, 1 - stdDev / mean);

    // Расчёт уверенности
    const confidence = this.calculateConfidence(agreementScore, limited.length);

    // Проверка на расхождение моделей
    const divergenceAlert = this.checkDivergence(limited, mean);

    return {
      ensemblePrediction,
      confidence,
      agreementScore,
      modelPredictions: limited,
      divergenceAlert,
    };
  }

  /**
   * Расчёт уверенности ансамбля.
   */
  private calculateConfidence(
    agreementScore: number,
    modelCount: number,
  ): number {
    // Уверенность зависит от согласованности и количества моделей
    const agreementWeight = 0.7;
    const countWeight = 0.3;

    const countFactor = Math.min(1, modelCount / newsConfig.ML_ENSEMBLE_MAX_MODELS);
    return agreementScore * agreementWeight + countFactor * countWeight;
  }

  /**
   * Проверка на расхождение моделей.
   */
  private checkDivergence(
    predictions: ModelPrediction[],
    mean: number,
  ): string | null {
    const maxDiff = Math.max(
      ...predictions.map((p) => Math.abs(p.prediction - mean)),
    );
    const maxDiffPercent = (maxDiff / mean) * 100;

    if (maxDiffPercent > 10) {
      return `⚠️ Расхождение моделей: ${maxDiffPercent.toFixed(1)}% (ARIMA и Prophet сильно расходятся)`;
    }

    if (maxDiffPercent > 5) {
      return `⚡ Умеренное расхождение: ${maxDiffPercent.toFixed(1)}%`;
    }

    return null;
  }

  /**
   * Пустой результат.
   */
  private emptyResult(): EnsembleResult {
    return {
      ensemblePrediction: 0,
      confidence: 0,
      agreementScore: 0,
      modelPredictions: [],
      divergenceAlert: 'Нет доступных моделей для ансамбля',
    };
  }
}
