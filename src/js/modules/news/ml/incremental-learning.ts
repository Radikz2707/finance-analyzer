/**
 * IncrementalLearningEngine — адаптация весов ML-моделей на основе обратной связи.
 *
 * Использует:
 * 1. Экспоненциальное затухание весов (half-life decay)
 * 2. Адаптацию ключевых слов на основе статистики
 * 3. Обновление весов моделей на основе точности прогнозов
 */

import { PythonBridge } from '../../python-engine/python-bridge.js';
import { config as newsConfig } from '../news-config.js';

/** Результат обновления весов */
export interface WeightUpdateResult {
  /** Обновлённые веса моделей */
  modelWeights: Record<string, number>;
  /** Адаптированные ключевые слова */
  adaptedKeywords: { high: string[]; medium: string[]; low: string[] };
  /** Точность моделей за период */
  modelAccuracy: Record<string, number>;
  /** Предупреждения */
  warnings: string[];
}

/** IncrementalLearningEngine */
export class IncrementalLearningEngine {
  private bridge = new PythonBridge();
  private modelWeights: Record<string, number> = {};
  private lastUpdateAt: string | null = null;

  /**
   * Обновление весов ML-моделей на основе обратной связи.
   *
   * @param modelPredictions — предсказания моделей {modelName: {prediction, actual, accuracy}}
   * @param feedback — обратная связь от пользователей/системы
   */
  async updateWeights(
    modelPredictions: Array<{
      model: string;
      prediction: number;
      actual: number;
      accuracy: number;
    }>,
    feedback: Array<{
      action: string;
      outcome: 'good' | 'bad';
      model?: string;
    }>,
  ): Promise<WeightUpdateResult> {
    const warnings: string[] = [];

    // 1. Обновление весов моделей через Python
    try {
      const result = await this.bridge.call<Record<string, unknown>>({
        command: 'update_model_weights' as const,
        payload: {
          modelPredictions,
          feedback,
          decayFactor: newsConfig.ML_DECAY_FACTOR,
          updateInterval: newsConfig.ML_WEIGHT_UPDATE_INTERVAL_DAYS,
        },
      });

      const r = result as {
        model_weights: Record<string, number>;
        model_accuracy: Record<string, number>;
      };

      this.modelWeights = r.model_weights || this.modelWeights;
      this.lastUpdateAt = new Date().toISOString();

      return {
        modelWeights: this.modelWeights,
        adaptedKeywords: { high: [], medium: [], low: [] },
        modelAccuracy: r.model_accuracy || {},
        warnings,
      };
    } catch (err) {
      warnings.push(`Python недоступен: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Fallback: экспоненциальное затухание
    this.applyExponentialDecay();

    return {
      modelWeights: this.modelWeights,
      adaptedKeywords: { high: [], medium: [], low: [] },
      modelAccuracy: {},
      warnings,
    };
  }

  /**
   * Адаптация ключевых слов на основе статистики.
   *
   * @param keywordStats — статистика упоминаний {keyword: {count, relevance}}
   */
  async adaptKeywords(
    keywordStats: Array<{ keyword: string; count: number; relevance: number }>,
  ): Promise<{ high: string[]; medium: string[]; low: string[] }> {
    // Сортируем по relevance * log(count + 1)
    const sorted = [...keywordStats].sort(
      (a, b) =>
        b.relevance * Math.log(b.count + 1) -
        a.relevance * Math.log(a.count + 1),
    );

    return {
      high: sorted.slice(0, 50).map((k) => k.keyword),
      medium: sorted.slice(50, 100).map((k) => k.keyword),
      low: sorted.slice(100, 150).map((k) => k.keyword),
    };
  }

  /**
   * Экспоненциальное затухание весов.
   * weight * 0.5 ^ (age / halfLifeDays)
   */
  private applyExponentialDecay(): void {
    const now = new Date();
    const halfLifeMs = newsConfig.ML_WEIGHT_UPDATE_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

    for (const [model, weight] of Object.entries(this.modelWeights)) {
      const ageMs = now.getTime() - Date.parse(this.lastUpdateAt || now.toISOString());
      const decayedWeight = weight * Math.pow(0.5, ageMs / halfLifeMs);
      this.modelWeights[model] = decayedWeight;
    }
  }

  /**
   * Получение текущих весов моделей.
   */
  getWeights(): Record<string, number> {
    return { ...this.modelWeights };
  }

  /**
   * Сброс весов.
   */
  resetWeights(): void {
    this.modelWeights = {};
    this.lastUpdateAt = null;
  }
}
