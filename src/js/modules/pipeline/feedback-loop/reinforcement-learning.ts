/**
 * ReinforcementLearning — обучение с подкреплением (подзадача 1.1.4).
 *
 * Простая и честная реализация bandit-подхода (epsilon-greedy) поверх
 * исторических результатов FeedbackLoop:
 * - Состояние: веса ActionWeight по паре (category, action)
 * - Обновление: w ← w + alpha * (reward - avgReward); статистика avg/std
 *   через Welford (численно стабильный онлайн-алгоритм)
 * - Exploration: с вероятностью epsilon выбирается случайное действие
 *   категории (исследование против эксплуатации)
 * - Устаревание: веса затухают по полураспаду weightHalfLifeDays —
 *   свежие результаты влияют сильнее старых
 *
 * ВАЖНО (честность): это не полноценный Q-learning/DQN, а контекстный
 * bandit по признаку «категория». Прогноз помечается isExploration.
 */

import type {
  ActionWeight,
  FeatureVector,
  RLConfig,
  RLPrediction,
} from './types.js';

// ──────────────────────────────────────────────
// Константы и ошибки
// ──────────────────────────────────────────────

/** Коэффициент обучения по умолчанию */
export const DEFAULT_LEARNING_RATE = 0.1;
/** Дисконтирование по умолчанию (не используется в bandit, для совместимости) */
export const DEFAULT_DISCOUNT_FACTOR = 0.9;
/** Exploration rate по умолчанию */
export const DEFAULT_EXPLORATION_RATE = 0.1;
/** Полураспад весов по умолчанию (дней) */
export const DEFAULT_WEIGHT_HALF_LIFE_DAYS = 30;
/** Границы веса (нормализация) */
const WEIGHT_MIN = -10;
const WEIGHT_MAX = 10;

/** Ошибка ReinforcementLearning */
export class ReinforcementLearningError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReinforcementLearningError';
  }
}

/** Ключ веса: `${category}::${action}` */
function weightKey(category: string, action: string): string {
  return `${category}::${action}`;
}

/** Полураспад: коэффициент затухания за возраст в днях */
function decayFactor(ageDays: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0) return 1; // без устаревания
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ──────────────────────────────────────────────
// ReinforcementLearning
// ──────────────────────────────────────────────

/** Опции RL */
export interface ReinforcementLearningOptions extends RLConfig {
  /** DI: генератор случайных чисел (для детерминированных тестов) */
  random?: () => number;
  /** DI: часы (по умолчанию new Date()) */
  now?: () => Date;
}

/**
 * ReinforcementLearning — контекстный bandit по категориям.
 *
 * Пример:
 * ```ts
 * const rl = new ReinforcementLearning({ explorationRate: 0 });
 * const prediction = rl.predict({
 *   category: 'asset', tickerCount: 1, confidence: 0.8,
 *   agentCount: 2, hourOfDay: 14, dayOfWeek: 3, isWeekend: false,
 *   historicalAvgRoi: 5, historicalWinRate: 0.7,
 * }, ['buy', 'hold', 'sell']);
 * rl.update('asset', 'buy', +1.0); // позитивный исход
 * ```
 */
export class ReinforcementLearning {
  private readonly weights = new Map<string, ActionWeight>();
  private readonly learningRate: number;
  private readonly explorationRate: number;
  private readonly weightHalfLifeDays: number;
  private readonly random: () => number;
  private readonly now: () => Date;

  constructor(options: ReinforcementLearningOptions = {}) {
    this.learningRate = options.learningRate ?? DEFAULT_LEARNING_RATE;
    // discountFactor зарезервирован для будущих multi-step обновлений (gamma);
    // в контекстном bandit не используется
    void (options.discountFactor ?? DEFAULT_DISCOUNT_FACTOR);
    this.explorationRate = options.explorationRate ?? DEFAULT_EXPLORATION_RATE;
    this.weightHalfLifeDays =
      options.weightHalfLifeDays ?? DEFAULT_WEIGHT_HALF_LIFE_DAYS;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Прогноз предпочтительного действия для категории.
   * Epsilon-greedy: с вероятностью epsilon — случайное действие (exploration),
   * иначе — действие с максимальным затухшим весом (exploitation).
   *
   * @param features признаки контекста
   * @param candidateActions допустимые действия категории
   */
  predict(
    features: FeatureVector,
    candidateActions: readonly string[],
  ): RLPrediction {
    if (candidateActions.length === 0) {
      throw new ReinforcementLearningError(
        'Список допустимых действий пуст — прогноз невозможен',
      );
    }

    const isExploration = this.random() < this.explorationRate;

    if (isExploration) {
      const index = Math.floor(this.random() * candidateActions.length);
      const action = candidateActions[index];
      if (!action) {
        throw new ReinforcementLearningError(
          'Не удалось выбрать случайное действие',
        );
      }
      return {
        recommendedAction: action,
        expectedReward: this.getDecayedWeight(features.category, action),
        confidence: 0, // exploration не даёт уверенности
        usedWeights: this.getWeightsForCategory(features.category),
        isExploration: true,
      };
    }

    // Exploitation: максимум затухшего веса
    let bestAction = candidateActions[0] as string;
    let bestWeight = -Infinity;
    for (const action of candidateActions) {
      const w = this.getDecayedWeight(features.category, action);
      if (w > bestWeight) {
        bestWeight = w;
        bestAction = action;
      }
    }

    // Уверенность: насыщение по числу наблюдений (n / (n + 10)) * нормализованный вес
    const bestW = this.weights.get(weightKey(features.category, bestAction));
    const observations = bestW?.observations ?? 0;
    const normalizedWeight = Math.max(-1, Math.min(1, bestWeight / WEIGHT_MAX));
    const confidence =
      observations > 0
        ? round((observations / (observations + 10)) * normalizedWeight, 4)
        : 0;

    return {
      recommendedAction: bestAction,
      expectedReward: round(bestWeight),
      confidence: Math.max(0, confidence),
      usedWeights: this.getWeightsForCategory(features.category),
      isExploration: false,
    };
  }

  /**
   * Обновить вес действия по reward (результат решения).
   * reward: положительный — успех, отрицательный — провал
   * (например, positive=+1, negative=-1, neutral=0, игнор=-0.2).
   */
  update(category: string, action: string, reward: number): ActionWeight {
    if (!Number.isFinite(reward)) {
      throw new ReinforcementLearningError(
        `reward должен быть конечным числом, получено: ${reward}`,
      );
    }
    const key = weightKey(category, action);
    const existing = this.weights.get(key);

    if (!existing) {
      const weight: ActionWeight = {
        category,
        action,
        weight: round(this.learningRate * reward),
        observations: 1,
        avgReward: reward,
        rewardStd: 0,
        lastUpdated: this.now().toISOString(),
      };
      this.weights.set(key, weight);
      return weight;
    }

    // Применяем затухание к старому весу перед обновлением
    const decayed = this.decayWeight(existing).weight;
    // Welford-подобное обновление среднего
    const newObservations = existing.observations + 1;
    const delta = reward - existing.avgReward;
    const newAvgReward = existing.avgReward + delta / newObservations;
    const newStd =
      newObservations > 1
        ? Math.sqrt(
            ((newObservations - 2) * existing.rewardStd ** 2 +
              delta * (reward - newAvgReward)) /
              (newObservations - 1),
          )
        : 0;

    // Обновление веса: w ← w + alpha * (reward - avgReward)
    let newWeight = decayed + this.learningRate * (reward - existing.avgReward);
    newWeight = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, newWeight));

    const updated: ActionWeight = {
      category,
      action,
      weight: round(newWeight),
      observations: newObservations,
      avgReward: round(newAvgReward),
      rewardStd: round(Number.isFinite(newStd) ? newStd : 0),
      lastUpdated: this.now().toISOString(),
    };
    this.weights.set(key, updated);
    return updated;
  }

  /** Все веса (отсортированы по категории и убыванию веса). */
  getWeights(): ActionWeight[] {
    return [...this.weights.values()].sort(
      (a, b) => a.category.localeCompare(b.category) || b.weight - a.weight,
    );
  }

  /** Веса конкретной категории. */
  getWeightsForCategory(category: string): ActionWeight[] {
    return this.getWeights().filter((w) => w.category === category);
  }

  /**
   * Применить затухание ко всем весам (полураспад по age с lastUpdated).
   * Вызывается периодически фасадом FeedbackLoop.
   */
  decayAllWeights(): ActionWeight[] {
    const now = this.now();
    for (const [key, weight] of this.weights.entries()) {
      this.weights.set(key, this.decayWeight(weight, now));
    }
    return this.getWeights();
  }

  /** Сброс состояния (для тестов и команды reset). */
  reset(): void {
    this.weights.clear();
  }

  /** Экспорт весов (для персистентности фасадом). */
  exportWeights(): ActionWeight[] {
    return this.getWeights();
  }

  /** Импорт весов. */
  importWeights(weights: readonly ActionWeight[]): void {
    this.weights.clear();
    for (const weight of weights) {
      this.weights.set(weightKey(weight.category, weight.action), {
        ...weight,
      });
    }
  }

  // ── приватные ──────────────────────────────────────────────────────────

  /** Затухший вес конкретной пары (категория, действие). */
  private getDecayedWeight(category: string, action: string): number {
    const weight = this.weights.get(weightKey(category, action));
    if (!weight) return 0;
    return round(this.decayWeight(weight).weight);
  }

  /** Применить полураспад к весу (опционально с фиксацией времени). */
  private decayWeight(weight: ActionWeight, at?: Date): ActionWeight {
    const now = at ?? this.now();
    const ageMs = Math.max(
      0,
      now.getTime() - new Date(weight.lastUpdated).getTime(),
    );
    const ageDays = ageMs / 86_400_000;
    const factor = decayFactor(ageDays, this.weightHalfLifeDays);
    const decayed = weight.weight * factor;
    if (Math.abs(decayed - weight.weight) < 1e-9) {
      return weight; // затухание ничтожно — не трогаем lastUpdated
    }
    return {
      ...weight,
      weight: round(decayed),
      lastUpdated: now.toISOString(),
    };
  }
}
