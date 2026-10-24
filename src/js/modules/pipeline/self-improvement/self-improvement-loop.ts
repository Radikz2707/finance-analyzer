/**
 * SelfImprovementLoop — замкнутый цикл самоулучшения инвестиционного анализа.
 *
 * Цикл: collect outcomes → analyze patterns → update weights → report
 *
 * Задачи:
 * - Запоминать успешные/неуспешные рекомендации AI
 * - Корректировать веса стратегий на основе результатов
 * - Сохранять уроки для будущих pipeline-запусков
 * - Обновлять предпочтения Director на основе обратной связи
 */

import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import { aiMemoryImpl } from '../ai-memory/index.js';

// ──────────────────────────────────────────────
// 1. Типы
// ──────────────────────────────────────────────

/** Результат рекомендации AI (запоминается для обучения) */
export interface RecommendationOutcome {
  /** ID pipeline-запуска */
  pipelineId: string;
  /** Тикер актива */
  ticker: string;
  /** Рекомендованное действие */
  recommendedAction: string;
  /** Фактическое действие пользователя (или null если не выполнено) */
  actualAction?: string;
  /** P&L через 30 дней (%) */
  pnl30d?: number;
  /** P&L через 90 дней (%) */
  pnl90d?: number;
  /** Успешна ли рекомендация */
  success: boolean;
  /** Заметки */
  notes?: string;
  /** Дата записи */
  recordedAt: string;
}

/** Паттерн, обнаруженный в исторических данных */
export interface LearnedPattern {
  /** Название паттерна */
  pattern: string;
  /** Описание */
  description: string;
  /** Тикеры, к которым применим */
  applicableTickers: string[];
  /** Точность (%) */
  accuracy: number;
  /** Количество наблюдений */
  sampleSize: number;
  /** Рекомендация */
  recommendation: string;
}

/** Результат цикла самоулучшения */
export interface SelfImprovementOutput {
  /** Успешен ли цикл */
  success: boolean;
  /** Обнаруженные паттерны */
  patterns: LearnedPattern[];
  /** Обновлённые веса стратегий */
  strategyWeights: Record<string, number>;
  /** Сохранённые уроки */
  lessonsSaved: number;
  /** Сообщение */
  message: string;
}

/** Входные данные для цикла самоулучшения */
export interface SelfImprovementInput {
  /** Действие: 'analyze' | 'update' | 'report' */
  action: 'analyze' | 'update' | 'report';
  /** Новые результаты для обучения (опционально) */
  newOutcomes?: RecommendationOutcome[];
  /** Цикл улучшения (опционально) */
  improveGoal?: string;
}

// ──────────────────────────────────────────────
// 2. Цикл самоулучшения
// ──────────────────────────────────────────────

export class SelfImprovementLoop extends AgentBase {
  constructor(config?: AgentConfig) {
    super(config ?? { name: 'SelfImprovementLoop' });
  }

  protected async executeInternal(
    input: SelfImprovementInput,
  ): Promise<SelfImprovementOutput> {
    if (!input || typeof input !== 'object') {
      throw new Error('SelfImprovementLoop: входные данные отсутствуют');
    }

    const { action: _action, newOutcomes } = input;

    // 1. Сохранить новые результаты (если есть)
    if (newOutcomes && newOutcomes.length > 0) {
      await this.saveOutcomes(newOutcomes);
    }

    // 2. Проанализировать исторические данные
    const patterns = await this.analyzePatterns();

    // 3. Обновить веса стратегий
    const strategyWeights = await this.updateStrategyWeights(patterns);

    // 4. Собрать уроки
    const lessons = await this.collectLessons(patterns);

    // 5. Сохранить в стратегическую память
    await this.saveLessons(lessons);

    const success = patterns.length > 0 || newOutcomes !== undefined;
    const message = this.buildMessage(
      success,
      patterns.length,
      lessons.length,
      newOutcomes?.length ?? 0,
    );

    return {
      success,
      patterns,
      strategyWeights,
      lessonsSaved: lessons.length,
      message,
    };
  }

  // ── Сохранение результатов ──

  private async saveOutcomes(
    outcomes: RecommendationOutcome[],
  ): Promise<void> {
    for (const outcome of outcomes) {
      try {
        await aiMemoryImpl.saveOperational({
          type: 'decision',
          content: JSON.stringify(outcome, null, 2),
          priority: 'medium',
          keywords: ['outcome', outcome.ticker, outcome.recommendedAction],
          createdAt: outcome.recordedAt,
          metadata: {
            pipelineId: outcome.pipelineId,
            ticker: outcome.ticker,
            action: outcome.recommendedAction,
            success: outcome.success,
          },
        });
      } catch {
        // Падение не роняет цикл
      }
    }
  }

  // ── Анализ паттернов ──

  private async analyzePatterns(): Promise<LearnedPattern[]> {
    const patterns: LearnedPattern[] = [];

    try {
      // Загружаем исторические результаты из памяти
      const result = await aiMemoryImpl.query({
        types: ['recommendation', 'pipeline_result'],
        maxResults: 100,
      });

      const entries = result.operationalEntries ?? [];
      if (entries.length === 0) {
        return patterns;
      }

      // Группируем по тикеру и действию
      const groups = new Map<
        string,
        Array<{ ticker: string; action: string; success: boolean }>
      >();

      for (const entry of entries) {
        try {
          const content = entry.content as string;
          const outcome = JSON.parse(content) as RecommendationOutcome;
          const key = `${outcome.ticker}:${outcome.recommendedAction}`;
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key)!.push({
            ticker: outcome.ticker,
            action: outcome.recommendedAction,
            success: outcome.success,
          });
        } catch {
          // Пропускаем некорректные записи
        }
      }

      // Находим значимые паттерны (минимум 3 наблюдения, точность > 60%)
      for (const [key, observations] of groups) {
        if (observations.length < 3) continue;

        const successCount = observations.filter((o) => o.success).length;
        const accuracy = (successCount / observations.length) * 100;

        if (accuracy >= 60) {
          const parts = key.split(':');
          const ticker = parts[0] ?? '';
          const action = parts.slice(1).join(':') ?? '';
          patterns.push({
            pattern: `${ticker}:${action}`,
            description: `Рекомендация ${action} для ${ticker} работает с точностью ${accuracy.toFixed(1)}%`,
            applicableTickers: [ticker],
            accuracy,
            sampleSize: observations.length,
            recommendation: `Продолжать рекомендовать ${action} для ${ticker}`,
          });
        }
      }

      // Сортируем по точности
      patterns.sort((a, b) => b.accuracy - a.accuracy);
    } catch {
      // Падение не роняет цикл
    }

    return patterns;
  }

  // ── Обновление весов стратегий ──

  private async updateStrategyWeights(
    patterns: LearnedPattern[],
  ): Promise<Record<string, number>> {
    // Базовые веса стратегий
    const weights: Record<string, number> = {
      momentum: 0.25,
      meanReversion: 0.20,
      dividendFocus: 0.20,
      valueInvesting: 0.15,
      growthInvesting: 0.10,
      riskParity: 0.10,
    };

    // Корректируем веса на основе паттернов
    for (const pattern of patterns) {
      if (pattern.accuracy > 80) {
        // Высокая точность — увеличиваем вес
        if (pattern.pattern.includes('BUY')) {
          weights.momentum = (weights.momentum ?? 0) + 0.05;
          weights.valueInvesting = (weights.valueInvesting ?? 0) + 0.03;
        } else if (pattern.pattern.includes('SELL') || pattern.pattern.includes('EXIT')) {
          weights.riskParity = (weights.riskParity ?? 0) + 0.05;
          weights.meanReversion = (weights.meanReversion ?? 0) + 0.03;
        } else if (pattern.pattern.includes('HOLD')) {
          weights.dividendFocus = (weights.dividendFocus ?? 0) + 0.05;
        }
      }
    }

    // Нормализуем веса (сумма = 1.0)
    const total = Object.values(weights).reduce((sum, w) => sum + (w ?? 0), 0);
    if (total > 0) {
      for (const key of Object.keys(weights)) {
        weights[key] = Math.round(((weights[key] ?? 0) / total) * 1000) / 1000;
      }
    }

    return weights;
  }

  // ── Сбор уроков ──

  private async collectLessons(
    patterns: LearnedPattern[],
  ): Promise<Array<{ lesson: string; category: string; confidence: number }>> {
    const lessons: Array<{ lesson: string; category: string; confidence: number }> = [];

    for (const pattern of patterns) {
      lessons.push({
        lesson: pattern.description,
        category: 'investment_pattern',
        confidence: pattern.accuracy / 100,
      });
    }

    return lessons;
  }

  // ── Сохранение уроков ──

  private async saveLessons(
    lessons: Array<{ lesson: string; category: string; confidence: number }>,
  ): Promise<void> {
    for (const lesson of lessons) {
      try {
        await aiMemoryImpl.saveOperational({
          type: 'pipeline_result',
          content: JSON.stringify(lesson, null, 2),
          priority: 'medium',
          keywords: ['lesson', lesson.category],
          createdAt: new Date().toISOString(),
          metadata: {
            confidence: lesson.confidence,
            category: lesson.category,
          },
        });
      } catch {
        // Падение не роняет цикл
      }
    }
  }

  // ── Формирование сообщения ──

  private buildMessage(
    success: boolean,
    patternsCount: number,
    lessonsCount: number,
    outcomesCount: number,
  ): string {
    const parts: string[] = [];
    parts.push(`Цикл самоулучшения: ${success ? 'успешен' : 'требует данных'}`);
    parts.push(`Обнаружено паттернов: ${patternsCount}`);
    parts.push(`Сохранено уроков: ${lessonsCount}`);
    if (outcomesCount > 0) {
      parts.push(`Новых результатов: ${outcomesCount}`);
    }
    return parts.join('; ');
  }
}
