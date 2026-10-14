/**
 * ImprovementGoals — генерация целей улучшения из слабых категорий
 * FeedbackLoop.analyze().
 *
 * Правило: категория с win rate < WEAK_WIN_RATE_THRESHOLD (0.4) и хотя бы
 * одним реализованным решением → цель «Пересмотреть подход к категории X».
 * Категории без реализованных решений пропускаются (метрики ненадёжны —
 * честное ограничение, как в FeedbackLoop.analyze()).
 *
 * Модуль чистый: без Node-зависимостей, DI только для часов (детерминизм
 * в тестах).
 */

import { randomUUID } from 'node:crypto';
import type { AnalysisResult } from '../feedback-loop/types.js';

// ──────────────────────────────────────────────
// 1. Типы
// ──────────────────────────────────────────────

/** Цель улучшения, порождённая слабой категорией */
export interface ImprovementGoal {
  /** Уникальный ID цели */
  id: string;
  /** Категория FeedbackLoop (asset, portfolio, comparison, ...) */
  category: string;
  /** Текущий win rate категории (0..1) */
  winRate: number;
  /** Сколько решений категории реализовано */
  implementedCount: number;
  /** Человекочитаемая цель */
  goal: string;
  /** Приоритет: high для критически слабых (win rate < 0.25), иначе normal */
  priority: 'high' | 'normal';
  /** Метка времени создания (ISO) */
  createdAt: string;
}

// ──────────────────────────────────────────────
// 2. Константы
// ──────────────────────────────────────────────

/** Порог win rate, ниже которого категория считается слабой */
export const WEAK_WIN_RATE_THRESHOLD = 0.4;

/** Порог win rate для приоритета high */
export const CRITICAL_WIN_RATE_THRESHOLD = 0.25;

// ──────────────────────────────────────────────
// 3. Генерация целей
// ──────────────────────────────────────────────

/**
 * Сгенерировать цели улучшения из слабых категорий анализа FeedbackLoop.
 * Пустой/нулевой анализ → пустой список (честно: нет данных — нет целей).
 */
export function generateImprovementGoals(
  analysis: AnalysisResult | null | undefined,
  now: () => Date = () => new Date(),
): ImprovementGoal[] {
  if (!analysis) {
    return [];
  }
  const goals: ImprovementGoal[] = [];
  for (const category of analysis.metrics.byCategory) {
    if (category.implementedCount === 0) {
      continue; // метрики ненадёжны — не строим целей
    }
    if (category.winRate >= WEAK_WIN_RATE_THRESHOLD) {
      continue; // категория не слабая
    }
    goals.push({
      id: randomUUID(),
      category: category.category,
      winRate: category.winRate,
      implementedCount: category.implementedCount,
      goal: `Пересмотреть подход к категории «${category.category}» (win rate ${(category.winRate * 100).toFixed(0)}%)`,
      priority:
        category.winRate < CRITICAL_WIN_RATE_THRESHOLD ? 'high' : 'normal',
      createdAt: now().toISOString(),
    });
  }
  // Стабильный порядок: сначала критичные, затем по убыванию win rate.
  goals.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority === 'high' ? -1 : 1;
    }
    return a.winRate - b.winRate;
  });
  return goals;
}

/** Сводка целей одной строкой (для отчётов и чата) */
export function summarizeImprovementGoals(
  goals: readonly ImprovementGoal[],
): string {
  if (goals.length === 0) {
    return 'Слабых категорий не обнаружено — цели улучшения не требуются.';
  }
  const lines = goals.map(
    (goal) =>
      `- ${goal.goal} (реализовано решений: ${goal.implementedCount}, приоритет: ${goal.priority})`,
  );
  return `Цели улучшения (${goals.length}):\n${lines.join('\n')}`;
}
