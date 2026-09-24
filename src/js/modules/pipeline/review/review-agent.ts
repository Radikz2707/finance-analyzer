/**
 * Review Agent — 3 ревизора проверяют рекомендации AI с разных сторон.
 *
 * Conservative Reviewer  — оценивает риски при падении рынка
 * Aggressive Reviewer    — ищет скрытый потенциал роста
 * Risk Manager           — проверяет соблюдение лимитов и диверсификации
 */

import type { DataAgentOutput } from '../agents/data-agent.js';
import type { AnalysisAgentOutput } from '../agents/analysis-agent.js';
import type { AiAgentOutput } from '../agents/ai-agent.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

/** Таймаут для каждого ревизора (5 секунд) */
const REVIEWER_TIMEOUT_MS = 5000;

// ──────────────────────────────────────────────
// 1. Review types
// ──────────────────────────────────────────────

/** Тип ревизора */
export type ReviewerType = 'conservative' | 'aggressive' | 'risk_manager';

/** Предупреждение от ревизора */
export interface ReviewWarning {
  /** Тикер актива (если применимо) */
  ticker?: string;
  /** Уровень серьёзности */
  severity: 'low' | 'medium' | 'high';
  /** Тип предупреждения */
  category: 'risk' | 'opportunity' | 'concentration' | 'diversification' | 'liquidity' | 'valuation';
  /** Текст предупреждения */
  message: string;
}

/** Результат одного ревизора */
export interface ReviewerResult {
  /** Тип ревизора */
  reviewerType: ReviewerType;
  /** Имя ревизора */
  name: string;
  /** Предупреждения */
  warnings: ReviewWarning[];
  /** Рекомендации (если есть) */
  recommendations?: string;
  /** Уверенность в результате (0-100%) */
  confidence: number;
  /** Сводка */
  summary: string;
  /** Время выполнения в миллисекундах */
  durationMs: number;
  /** Был ли перевыполнен по таймауту */
  timedOut: boolean;
}

/** Метрики производительности review */
export interface ReviewMetrics {
  /** Общее время выполнения review */
  totalDurationMs: number;
  /** Время выполнения каждого ревизора */
  reviewerTimings: Record<ReviewerType, number>;
  /** Сколько ревизоров выполнились успешно */
  successfulReviewers: number;
  /** Сколько ревизоров были таймаутнуты */
  timedOutReviewers: number;
}

/** Итоговый результат review */
export interface ReviewResult {
  /** Результаты всех 3 ревизоров */
  reviewers: Map<ReviewerType, ReviewerResult>;
  /** Согласие между ревизорами (0-100%) */
  agreementPercent: number;
  /** Есть ли расхождения */
  hasDisagreement: boolean;
  /** Итоговая рекомендация */
  finalRecommendation: string;
  /** Метка времени */
  reviewedAt: string;
  /** Метрики производительности */
  metrics: ReviewMetrics;
}

// ──────────────────────────────────────────────
// 2. Review Agent
// ──────────────────────────────────────────────

/**
 * Review Agent — запускает 3 ревизора параллельно и агрегирует результаты.
 */
export class ReviewAgent extends AgentBase {
  constructor(config?: AgentConfig) {
    super(config ?? { name: 'ReviewAgent' });
  }

  protected async executeInternal(
    input: {
      data: DataAgentOutput;
      analysis: AnalysisAgentOutput;
      ai: AiAgentOutput;
    },
  ): Promise<ReviewResult> {
    console.log('[ReviewAgent] >>> Запуск review-агентов параллельно');

    const { data, analysis, ai } = input;
    const reviewStart = Date.now();

    // Запускаем 3 ревизора параллельно с изоляцией ошибок и таймаутами
    const [conservativeResult, aggressiveResult, riskManagerResult] = await Promise.all([
      this.runReviewerWithTimeout(
        'conservative',
        'Консервативный ревизор',
        () => this.runConservativeReviewer(data, analysis, ai),
      ),
      this.runReviewerWithTimeout(
        'aggressive',
        'Агрессивный ревизор',
        () => this.runAggressiveReviewer(data, analysis, ai),
      ),
      this.runReviewerWithTimeout(
        'risk_manager',
        'Risk Manager',
        () => this.runRiskManagerReviewer(data, analysis, ai),
      ),
    ]);

    // Агрегируем результаты
    const reviewers = new Map<ReviewerType, ReviewerResult>();
    reviewers.set('conservative', conservativeResult);
    reviewers.set('aggressive', aggressiveResult);
    reviewers.set('risk_manager', riskManagerResult);

    const totalDurationMs = Date.now() - reviewStart;

    // Вычисляем метрики производительности
    const metrics: ReviewMetrics = {
      totalDurationMs,
      reviewerTimings: {
        conservative: conservativeResult.durationMs,
        aggressive: aggressiveResult.durationMs,
        risk_manager: riskManagerResult.durationMs,
      },
      successfulReviewers: [conservativeResult, aggressiveResult, riskManagerResult].filter(
        (r) => !r.timedOut,
      ).length,
      timedOutReviewers: [conservativeResult, aggressiveResult, riskManagerResult].filter(
        (r) => r.timedOut,
      ).length,
    };

    // Вычисляем согласие между ревизорами (исключаем таймаутнутых)
    const agreementPercent = this.calculateAgreement(
      conservativeResult,
      aggressiveResult,
      riskManagerResult,
    );
    const hasDisagreement = agreementPercent < 80 || metrics.timedOutReviewers > 0;

    // Формируем итоговую рекомендацию
    const finalRecommendation = this.buildFinalRecommendation(
      conservativeResult,
      aggressiveResult,
      riskManagerResult,
      hasDisagreement,
    );

    console.log(
      `[ReviewAgent] ✅ Review завершён: согласие=${agreementPercent}%, ` +
      `расхождения=${hasDisagreement ? 'ДА' : 'НЕТ'}, ` +
      `время=${totalDurationMs}мс, ` +
      `успешных=${metrics.successfulReviewers}, ` +
      `таймаутов=${metrics.timedOutReviewers}`,
    );

    return {
      reviewers,
      agreementPercent,
      hasDisagreement,
      finalRecommendation,
      reviewedAt: new Date().toISOString(),
      metrics,
    };
  }

  // ── Timeout & Error Handling ──

  /**
   * Запуск ревизора с таймаутом и изоляцией ошибок.
   * Если ревизор не успевает или падает — возвращаем дефолтный результат.
   */
  private async runReviewerWithTimeout(
    reviewerType: ReviewerType,
    name: string,
    runner: () => ReviewerResult | Promise<ReviewerResult>,
  ): Promise<ReviewerResult> {
    try {
      const startTime = Date.now();

      // Используем Promise.race для таймаута
      const resolved = await Promise.race([
        Promise.resolve(runner()),
        new Promise<ReviewerResult>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), REVIEWER_TIMEOUT_MS),
        ),
      ]);

      const durationMs = Date.now() - startTime;

      console.log(
        `[ReviewAgent] ✅ ${name} завершён за ${durationMs}мс`,
      );

      return {
        ...resolved,
        durationMs,
        timedOut: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      console.warn(
        `[ReviewAgent] ⚠️ ${reviewerType} завершён с ошибкой: ${errorMessage}`,
      );

      // Возвращаем дефолтный результат, чтобы не ломать весь review
      return {
        reviewerType,
        name,
        warnings: [],
        recommendations: `Ревизор ${name} не смог завершить анализ: ${errorMessage}`,
        confidence: 0,
        summary: `${name}: ошибка выполнения`,
        durationMs: REVIEWER_TIMEOUT_MS,
        timedOut: errorMessage === 'TIMEOUT',
      };
    }
  }

  // ── Reviewers ──

  private runConservativeReviewer(
    data: DataAgentOutput,
    analysis: AnalysisAgentOutput,
    _ai: AiAgentOutput,
  ): ReviewerResult {
    const warnings: ReviewWarning[] = [];
    const { macroGoals } = data;
    const { assetsAnalysis } = analysis.portfolioAnalysis;

    // Проверяем концентрацию
    for (const asset of assetsAnalysis) {
      if (asset.currentPercent > 10) {
        warnings.push({
          ticker: asset.ticker,
          severity: 'high',
          category: 'concentration',
          message: `Высокая концентрация ${asset.name}: ${asset.currentPercent.toFixed(1)}% — риск при падении рынка`,
        });
      }

      // Проверяем отрицательную динамику
      if (asset.dailyDynamicsPercent && asset.dailyDynamicsPercent < -5) {
        warnings.push({
          ticker: asset.ticker,
          severity: 'medium',
          category: 'risk',
          message: `Резкое падение ${asset.name}: ${asset.dailyDynamicsPercent.toFixed(1)}% — возможна коррекция`,
        });
      }
    }

    // Проверяем свободные средства
    if (macroGoals.freeCash > 0 && macroGoals.freeCash < macroGoals.totalBalance * 0.01) {
      warnings.push({
        severity: 'medium',
        category: 'liquidity',
        message: `Минимальный резерв свободных средств: ${macroGoals.freeCash.toFixed(0)} руб — нет запаса прочности`,
      });
    }

    return {
      reviewerType: 'conservative',
      name: 'Консервативный ревизор',
      warnings,
      recommendations: warnings.length > 0
        ? 'Рекомендую снизить риски: диверсифицировать концентрацию, увеличить резерв'
        : 'Риски приемлемы, но рекомендуется мониторинг',
      confidence: warnings.length === 0 ? 85 : 60,
      summary: warnings.length === 0
        ? 'Консервативный анализ: риски минимальны'
        : `Консервативный анализ: найдено ${warnings.length} предупреждений`,
      durationMs: 0,
      timedOut: false,
    };
  }

  private runAggressiveReviewer(
    data: DataAgentOutput,
    analysis: AnalysisAgentOutput,
    _ai: AiAgentOutput,
  ): ReviewerResult {
    const warnings: ReviewWarning[] = [];
    const { quotes } = data;
    const { assetsAnalysis } = analysis.portfolioAnalysis;

    // Ищем недооценённые активы
    for (const asset of assetsAnalysis) {
      const quote = quotes[asset.ticker];
      if (quote && quote.dailyDynamicsPercent > 5) {
        warnings.push({
          ticker: asset.ticker,
          severity: 'low',
          category: 'opportunity',
          message: `${asset.name} растёт: ${quote.dailyDynamicsPercent.toFixed(1)}% — потенциал продолжения тренда`,
        });
      }

      // Проверяем дефицит
      if (asset.status === 'BUY' && asset.deficitRub > 0) {
        warnings.push({
          ticker: asset.ticker,
          severity: 'low',
          category: 'opportunity',
          message: `${asset.name} имеет дефицит ${asset.deficitRub.toFixed(0)} руб — возможность для роста`,
        });
      }
    }

    return {
      reviewerType: 'aggressive',
      name: 'Агрессивный ревизор',
      warnings,
      recommendations: warnings.length > 0
        ? `Возможности для роста: ${warnings.filter((w) => w.category === 'opportunity').length} активов`
        : 'Не вижу явных возможностей для агрессивной стратегии',
      confidence: 70,
      summary: warnings.length === 0
        ? 'Агрессивный анализ: явных возможностей нет'
        : `Агрессивный анализ: найдено ${warnings.length} возможностей`,
      durationMs: 0,
      timedOut: false,
    };
  }

  private runRiskManagerReviewer(
    _data: DataAgentOutput,
    analysis: AnalysisAgentOutput,
    _ai: AiAgentOutput,
  ): ReviewerResult {
    const warnings: ReviewWarning[] = [];
    const { riskValidation } = analysis;
    const { assetsAnalysis } = analysis.portfolioAnalysis;

    // Проверяем валидацию рисков
    for (const error of riskValidation.errors) {
      warnings.push({
        severity: 'high',
        category: 'risk',
        message: `Нарушение лимита: ${error}`,
      });
    }

    // Проверяем диверсификацию
    const stockCount = assetsAnalysis.filter((a) => a.assetType === 'А').length;
    const bondCount = assetsAnalysis.filter((a) => a.assetType === 'О').length;

    if (stockCount === 0 && bondCount === 0) {
      warnings.push({
        severity: 'high',
        category: 'diversification',
        message: 'Портфель не диверсифицирован: нет акций и облигаций',
      });
    } else if (stockCount === 0) {
      warnings.push({
        severity: 'medium',
        category: 'diversification',
        message: 'Портфель состоит только из облигаций — нет роста',
      });
    } else if (bondCount === 0) {
      warnings.push({
        severity: 'medium',
        category: 'diversification',
        message: 'Портфель состоит только из акций — высокий риск',
      });
    }

    return {
      reviewerType: 'risk_manager',
      name: 'Risk Manager',
      warnings,
      recommendations: riskValidation.isValid
        ? 'Лимиты соблюдены, диверсификация приемлема'
        : 'Необходимо пересмотреть структуру портфеля',
      confidence: riskValidation.isValid ? 90 : 40,
      summary: riskValidation.isValid
        ? 'Risk Manager: лимиты соблюдены'
        : `Risk Manager: найдено ${riskValidation.errors.length} нарушений`,
      durationMs: 0,
      timedOut: false,
    };
  }

  // ── Helpers ──

  private calculateAgreement(
    conservative: ReviewerResult,
    aggressive: ReviewerResult,
    riskManager: ReviewerResult,
  ): number {
    // Простая эвристика: считаем совпадение confidence
    const avgConfidence =
      (conservative.confidence + aggressive.confidence + riskManager.confidence) / 3;

    // Если все confidence > 70% — согласие высокое
    if (
      conservative.confidence > 70 &&
      aggressive.confidence > 70 &&
      riskManager.confidence > 70
    ) {
      return 85;
    }

    // Если есть high severity предупреждения — согласие ниже
    const allWarnings = [
      ...conservative.warnings,
      ...aggressive.warnings,
      ...riskManager.warnings,
    ];
    const highSeverityCount = allWarnings.filter((w) => w.severity === 'high').length;

    if (highSeverityCount > 2) {
      return 50;
    }

    return avgConfidence;
  }

  private buildFinalRecommendation(
    conservative: ReviewerResult,
    _aggressive: ReviewerResult,
    riskManager: ReviewerResult,
    hasDisagreement: boolean,
  ): string {
    if (!hasDisagreement) {
      return 'Все ревизоры согласны: рекомендации стабильны';
    }

    const highRiskWarnings = [
      ...conservative.warnings,
      ...riskManager.warnings,
    ].filter((w) => w.severity === 'high');

    if (highRiskWarnings.length > 0) {
      return `⚠️ Найдены критические риски: ${highRiskWarnings.length} предупреждений — требуется внимание директора`;
    }

    return 'Расхождения между ревизорами: рекомендуется ручной обзор';
  }
}
