/**
 * DecisionLogger — система обучения на ошибках для инвестиционных решений.
 *
 * Ключевые принципы:
 * - Сохраняет каждое решение с метаданными
 * - Проверяет результаты через N дней
 * - Обновляет веса на основе результатов
 * - Передаёт контекст AI для улучшения рекомендаций
 *
 * Архитектура:
 * 1. DecisionLogger — запись решений
 * 2. ResultTracker — проверка результатов
 * 3. ReinforcementLearning — обновление весов
 * 4. AI Context — передача истории в промпт
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveAppDataDir } from '../../shared/app-paths.js';

// ──────────────────────────────────────────────
// 1. Типы данных
// ──────────────────────────────────────────────

/** Тип действия */
export type DecisionAction = 'BUY' | 'SELL' | 'HOLD' | 'REDUCE' | 'EXIT';

/** Результат решения */
export type DecisionResult = 'GOOD' | 'BAD' | 'NEUTRAL' | 'PENDING';

/** Одно инвестиционное решение */
export interface InvestmentDecision {
  /** Уникальный ID решения */
  id: string;

  /** Тикер актива */
  ticker: string;

  /** Название актива */
  assetName: string;

  /** Действие */
  action: DecisionAction;

  /** Цена входа (при покупке/продаже) */
  entryPrice: number;

  /** Текущая цена при принятии решения */
  priceAtDecision: number;

  /** Обоснование от AI */
  rationale: string;

  /** Timestamp принятия решения */
  decisionTimestamp: string;

  /** Результат решения (GOOD/BAD/NEUTRAL/PENDING) */
  result: DecisionResult;

  /** ROI после закрытия позиции */
  roiPercent?: number;

  /** Timestamp проверки результата */
  resultTimestamp?: string;

  /** Категория решения (на основе rationale) */
  category?: string;

  /** Метаданные */
  metadata?: Record<string, unknown>;
}

/** Веса для категорий решений */
export interface DecisionWeights {
  /** Общий счётчик решений */
  totalDecisions: number;

  /** Успешные решения */
  successfulDecisions: number;

  /** Веса по категориям */
  categoryWeights: Record<string, number>;

  /** Веса по действиям */
  actionWeights: Record<DecisionAction, number>;

  /** Веса по тикерам */
  tickerWeights: Record<string, number>;
}

// ──────────────────────────────────────────────
// 2. DecisionLogger
// ──────────────────────────────────────────────

/**
 * DecisionLogger — система логирования и анализа инвестиционных решений.
 */
export class DecisionLogger {
  private decisions: InvestmentDecision[];
  private weights: DecisionWeights;
  private filePath: string;

  constructor() {
    this.filePath = path.join(resolveAppDataDir(), 'investment-decisions.json');
    this.decisions = this.loadDecisions();
    this.weights = this.calculateWeights();
  }

  /**
   * Сохранить инвестиционное решение.
   */
  saveDecision(
    ticker: string,
    assetName: string,
    action: DecisionAction,
    entryPrice: number,
    priceAtDecision: number,
    rationale: string,
    metadata?: Record<string, unknown>,
  ): InvestmentDecision {
    const decision: InvestmentDecision = {
      id: `dec_${Date.now()}_${ticker}_${Math.random().toString(36).substring(2, 9)}`,
      ticker,
      assetName,
      action,
      entryPrice,
      priceAtDecision,
      rationale,
      decisionTimestamp: new Date().toISOString(),
      result: 'PENDING',
      category: this.extractCategory(rationale),
      metadata,
    };

    this.decisions.push(decision);
    this.saveToFile();
    this.weights = this.calculateWeights();

    console.log(
      `[DecisionLogger] Сохранено решение: ${ticker} ${action} @ ${entryPrice}₽ (rationale: ${rationale.substring(0, 50)}...)`,
    );

    return decision;
  }

  /**
   * Обновить результат решения.
   */
  updateDecisionResult(
    decisionId: string,
    result: DecisionResult,
    roiPercent?: number,
  ): void {
    const decision = this.decisions.find((d) => d.id === decisionId);
    if (!decision) {
      console.warn(`[DecisionLogger] Решение ${decisionId} не найдено`);
      return;
    }

    decision.result = result;
    decision.roiPercent = roiPercent;
    decision.resultTimestamp = new Date().toISOString();

    this.saveToFile();
    this.weights = this.calculateWeights();

    console.log(
      `[DecisionLogger] Результат обновлён: ${decision.ticker} ${decision.action} → ${result} (ROI: ${roiPercent?.toFixed(2)}%)`,
    );
  }

  /**
   * Получить контекст для AI на основе истории решений.
   */
  getAiContext(ticker?: string): string {
    const relevantDecisions = ticker
      ? this.decisions.filter((d) => d.ticker === ticker)
      : this.decisions;

    if (relevantDecisions.length === 0) {
      return '';
    }

    const successful = relevantDecisions.filter(
      (d) => d.result === 'GOOD',
    ).length;
    const total = relevantDecisions.filter((d) => d.result !== 'PENDING').length;
    const successRate = total > 0 ? (successful / total) * 100 : 0;

    let context = `\n## 📊 История решений по ${ticker || 'портфелю'}\n`;
    context += `- Всего решений: ${relevantDecisions.length}\n`;
    context += `- Успешных: ${successful} из ${total} (${successRate.toFixed(1)}%)\n`;

    // Веса по действиям
    const actionStats = this.getActionStats(relevantDecisions);
    context += '\n**Веса по действиям:**\n';
    for (const [action, weight] of Object.entries(actionStats)) {
      const emoji = weight > 0 ? '✅' : weight < 0 ? '❌' : '⚪';
      context += `- ${emoji} ${action}: ${weight > 0 ? '+' : ''}${weight.toFixed(1)}\n`;
    }

    // Последние 5 решений
    const recent = relevantDecisions
      .filter((d) => d.result !== 'PENDING')
      .slice(-5);

    if (recent.length > 0) {
      context += '\n**Последние решения:**\n';
      for (const d of recent) {
        const resultEmoji =
          d.result === 'GOOD'
            ? '✅'
            : d.result === 'BAD'
              ? '❌'
              : '⚪';
        context += `- ${resultEmoji} ${d.ticker} ${d.action} @ ${d.entryPrice}₽ → ROI: ${d.roiPercent?.toFixed(2) ?? 'N/A'}%\n`;
      }
    }

    return context;
  }

  /**
   * Получить веса решений.
   */
  getWeights(): DecisionWeights {
    return { ...this.weights };
  }

  /**
   * Получить статистику по действиям.
   */
  private getActionStats(
    decisions: InvestmentDecision[],
  ): Record<DecisionAction, number> {
    const stats: Record<DecisionAction, number> = {
      BUY: 0,
      SELL: 0,
      HOLD: 0,
      REDUCE: 0,
      EXIT: 0,
    };

    for (const d of decisions) {
      if (d.result === 'GOOD') {
        stats[d.action] += 1;
      } else if (d.result === 'BAD') {
        stats[d.action] -= 1;
      }
    }

    return stats;
  }

  /**
   * Извлечь категорию из rationale.
   */
  private extractCategory(rationale: string): string {
    // Простая эвристика — извлекаем ключевые слова
    const categories = [
      'dividend',
      'growth',
      'value',
      'momentum',
      'rebalance',
      'risk',
      'technical',
      'fundamental',
    ];

    const upperRationale = rationale.toUpperCase();
    for (const cat of categories) {
      if (upperRationale.includes(cat.toUpperCase())) {
        return cat;
      }
    }

    return 'general';
  }

  /**
   * Рассчитать веса на основе истории решений.
   */
  private calculateWeights(): DecisionWeights {
    const successful = this.decisions.filter(
      (d) => d.result === 'GOOD',
    ).length;

    const categoryWeights: Record<string, number> = {};
    const actionWeights: Record<DecisionAction, number> = {
      BUY: 0,
      SELL: 0,
      HOLD: 0,
      REDUCE: 0,
      EXIT: 0,
    };
    const tickerWeights: Record<string, number> = {};

    // Веса по категориям
    const categories = this.decisions
      .filter((d) => d.result !== 'PENDING')
      .reduce<Record<string, InvestmentDecision[]>>((acc, d) => {
        const cat = d.category || 'general';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(d);
        return acc;
      }, {});

    for (const [cat, decisions] of Object.entries(categories)) {
      const good = decisions.filter((d) => d.result === 'GOOD').length;
      const bad = decisions.filter((d) => d.result === 'BAD').length;
      categoryWeights[cat] = good - bad;
    }

    // Веса по действиям и тикерам
    for (const d of this.decisions) {
      if (d.result === 'GOOD') {
        actionWeights[d.action] += 1;
        tickerWeights[d.ticker] = (tickerWeights[d.ticker] || 0) + 1;
      } else if (d.result === 'BAD') {
        actionWeights[d.action] -= 1;
        tickerWeights[d.ticker] = (tickerWeights[d.ticker] || 0) - 1;
      }
    }

    return {
      totalDecisions: this.decisions.length,
      successfulDecisions: successful,
      categoryWeights,
      actionWeights,
      tickerWeights,
    };
  }

  /**
   * Загрузить решения из файла.
   */
  private loadDecisions(): InvestmentDecision[] {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw) as InvestmentDecision[];
    } catch {
      return [];
    }
  }

  /**
   * Сохранить решения в файл.
   */
  private saveToFile(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.decisions, null, 2));
    } catch (err) {
      console.warn('[DecisionLogger] Ошибка сохранения:', err);
    }
  }
}
