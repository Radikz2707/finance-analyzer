/**
 * AI Command Center — координатор review + human-in-the-loop.
 *
 * Управляет процессом:
 * 1. Запуск review-агентов
 * 2. Сравнение результатов 3 ревизоров
 * 3. Отправка директору на проверку
 * 4. Обработка фидбэка (approve/reject/modify)
 * 5. Итеративная доработка AI
 */

import type { DataAgentOutput } from './agents/data-agent.js';
import type { AnalysisAgentOutput } from './agents/analysis-agent.js';
import type { AiAgentOutput } from './agents/ai-agent.js';
import type { ReviewResult } from './review/review-agent.js';
import { ReviewAgent } from './review/review-agent.js';
import type { AuditLog } from './audit/audit-log.js';

// ──────────────────────────────────────────────
// 1. Director decision types
// ──────────────────────────────────────────────

/** Тип решения директора */
export type DirectorDecision = 'approve' | 'reject' | 'modify';

/** Решение директора */
export interface DirectorDecisionInput {
  /** Тип решения */
  decision: DirectorDecision;
  /** Комментарий (если reject/modify) */
  comment?: string;
  /** Итерация */
  iteration: number;
}

/** Результат работы Command Center */
export interface CommandCenterResult {
  /** Успешно ли */
  success: boolean;
  /** Итоговая рекомендация */
  recommendation: string;
  /** Результаты review */
  reviewResult: ReviewResult | null;
  /** Решение директора */
  directorDecision?: DirectorDecisionInput;
  /** Итерация */
  iteration: number;
  /** Ошибка (если success=false) */
  error?: string;
}

// ──────────────────────────────────────────────
// 2. AI Command Center
// ──────────────────────────────────────────────

/**
 * AI Command Center — координатор review + human-in-the-loop.
 *
 * Процесс:
 * 1. Запускает 3 review-агента
 * 2. Если согласие > 80% → approve автоматически
 * 3. Если расхождение > 20% → отправляет директору
 * 4. Директор может approve/reject/modify
 * 5. При reject/modify — AI переделывает с учётом фидбэка
 */
export class AICommandCenter {
  private reviewAgent: ReviewAgent;
  private auditLog: AuditLog;
  private currentIteration = 0;

  constructor(
    auditLog: AuditLog,
  ) {
    this.reviewAgent = new ReviewAgent();
    this.auditLog = auditLog;
  }

  /**
   * Запустить review-процесс.
   * @param data — данные от Data Agent
   * @param analysis — данные от Analysis Agent
   * @param ai — данные от AI Agent
   */
  async runReview(
    data: DataAgentOutput,
    analysis: AnalysisAgentOutput,
    ai: AiAgentOutput,
  ): Promise<CommandCenterResult> {
    this.currentIteration++;
    const iteration = this.currentIteration;

    console.log(`[CommandCenter] Запуск review (итерация ${iteration})`);

    this.auditLog.log(
      'review.start',
      'system',
      `Запущен review (итерация ${iteration})`,
      { iteration },
    );

    try {
      // Шаг 1: Запускаем 3 ревизора
      const reviewResult = await this.reviewAgent.execute({
        data,
        analysis,
        ai,
      });

      if (!reviewResult.success) {
        throw new Error(
          `Review Agent failed: ${reviewResult.error?.message}`,
        );
      }

      const reviewData = reviewResult.data as ReviewResult;

      // Шаг 2: Проверяем согласие
      if (reviewData.agreementPercent >= 80) {
        // Согласие высокое → approve автоматически
        this.auditLog.log(
          'review.complete',
          'system',
          `Review завершён: согласие ${reviewData.agreementPercent}% → approve`,
          { iteration, agreementPercent: reviewData.agreementPercent },
        );

        return {
          success: true,
          recommendation: reviewData.finalRecommendation,
          reviewResult: reviewData,
          directorDecision: {
            decision: 'approve',
            comment: 'Автоматический approve (согласие > 80%)',
            iteration,
          },
          iteration,
        };
      }

      // Шаг 3: Расхождение → отправляем директору
      this.auditLog.log(
        'review.disagreement',
        'system',
        `Расхождение между ревизорами: ${reviewData.agreementPercent}% → отправка директору`,
        { iteration, agreementPercent: reviewData.agreementPercent },
      );

      return {
        success: true,
        recommendation: reviewData.finalRecommendation,
        reviewResult: reviewData,
        iteration,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.auditLog.log(
        'review.complete',
        'system',
        `Review завершён с ошибкой: ${errorMsg}`,
        { iteration, error: errorMsg },
      );

      return {
        success: false,
        recommendation: '',
        reviewResult: null,
        iteration,
        error: errorMsg,
      };
    }
  }

  /**
   * Обработать решение директора.
   * @param decision — approve/reject/modify
   * @param comment — комментарий директора
   */
  processDirectorDecision(
    decision: DirectorDecision,
    comment?: string,
  ): { message: string; shouldReRun: boolean } {
    this.auditLog.log(
      `command.${decision}`,
      'director',
      `Директор принял решение: ${decision}${comment ? ` — ${comment}` : ''}`,
      { decision, comment, iteration: this.currentIteration },
    );

    switch (decision) {
      case 'approve':
        return {
          message: '✅ Директор утвердил рекомендацию. Отчёт будет отправлен.',
          shouldReRun: false,
        };

      case 'reject':
        this.currentIteration++;
        return {
          message: `🔄 Отправлено на доработку (итерация ${this.currentIteration}).\n\nКомментарий директора: ${comment || 'Не указано'}`,
          shouldReRun: true,
        };

      case 'modify':
        this.currentIteration++;
        return {
          message: `✏️ Точечное изменение применено (итерация ${this.currentIteration}).\n\nИзменение: ${comment || 'Не указано'}`,
          shouldReRun: true,
        };

      default:
        return {
          message: '❌ Неизвестное решение директора',
          shouldReRun: false,
        };
    }
  }

  /**
   * Сформировать отчёт для директора о результатах review.
   */
  formatReviewReport(reviewResult: ReviewResult): string {
    let text = '<b>🔍 Результаты review-агентов:</b>\n\n';

    // Консервативный ревизор
    const conservative = reviewResult.reviewers.get('conservative');
    if (conservative) {
      text += '<b>🛡️ Консервативный ревизор</b>\n';
      text += `Уверенность: ${conservative.confidence}%\n`;
      text += `${conservative.summary}\n`;
      if (conservative.warnings.length > 0) {
        text += '\n⚠️ Предупреждения:\n';
        for (const w of conservative.warnings) {
          const severity = w.severity === 'high' ? '🔴' : w.severity === 'medium' ? '🟡' : '🟢';
          text += `${severity} ${w.message}\n`;
        }
      }
      text += '\n';
    }

    // Агрессивный ревизор
    const aggressive = reviewResult.reviewers.get('aggressive');
    if (aggressive) {
      text += '<b>🚀 Агрессивный ревизор</b>\n';
      text += `Уверенность: ${aggressive.confidence}%\n`;
      text += `${aggressive.summary}\n`;
      if (aggressive.warnings.length > 0) {
        text += '\n💡 Возможности:\n';
        for (const w of aggressive.warnings) {
          text += `💡 ${w.message}\n`;
        }
      }
      text += '\n';
    }

    // Risk Manager
    const riskManager = reviewResult.reviewers.get('risk_manager');
    if (riskManager) {
      text += '<b>📋 Risk Manager</b>\n';
      text += `Уверенность: ${riskManager.confidence}%\n`;
      text += `${riskManager.summary}\n`;
      if (riskManager.warnings.length > 0) {
        text += '\n⚠️ Нарушения:\n';
        for (const w of riskManager.warnings) {
          text += `🔴 ${w.message}\n`;
        }
      }
      text += '\n';
    }

    // Итог
    text += '<b>📊 Итог:</b>\n';
    text += `Согласие агентов: ${reviewResult.agreementPercent}%\n`;
    text += `Расхождения: ${reviewResult.hasDisagreement ? 'ДА ⚠️' : 'НЕТ ✅'}\n`;
    text += `\n${reviewResult.finalRecommendation}\n`;

    // Кнопки действий
    text += '\n<b>Что делать?</b>\n';
    text += '/approve — принять\n';
    text += '/reject "комментарий" — отправить на доработку\n';
    text += '/modify "изменение" — точечное изменение';

    return text;
  }
}
