/**
 * MetricAggregator (Задача 3.1.2): агрегация сырых метрик в карточки.
 *
 * Чистые функции: отсутствие секции → honest warning (не выдуманные нули).
 * Все агрегаты округляются до 2 знаков.
 */

import type { DashboardMetrics } from './types.js';

export class MetricAggregatorError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MetricAggregatorError';
  }
}

export interface PortfolioCard {
  totalValue: number;
  changePercent: number;
  assetsCount: number;
  /** Текстовая оценка: 'growth' | 'decline' | 'flat'. */
  state: 'growth' | 'decline' | 'flat';
}

export interface NeedsCard {
  /** Отсортированы по probability убыв., порог 0.15. */
  urgent: { category: string; probability: number }[];
  total: number;
}

export interface AgentsCard {
  running: number;
  failed: number;
  idle: number;
  failedNames: string[];
}

export interface AggregatedCards {
  portfolio?: PortfolioCard;
  needs?: NeedsCard;
  agents?: AgentsCard;
  warnings: string[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export class MetricAggregator {
  /** Агрегирует все доступные секции; отсутствующие — в warnings. */
  aggregate(metrics: DashboardMetrics): AggregatedCards {
    if (typeof metrics !== 'object' || metrics === null) {
      throw new MetricAggregatorError('aggregate: metrics обязательны');
    }
    const warnings: string[] = [];
    const cards: AggregatedCards = { warnings };

    // Портфель
    if (metrics.portfolio) {
      const { totalValue, changePercent, assetsCount } = metrics.portfolio;
      for (const [field, value] of [
        ['totalValue', totalValue],
        ['changePercent', changePercent],
        ['assetsCount', assetsCount],
      ] as const) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new MetricAggregatorError(
            `aggregate.portfolio.${field}: ожидается конечное число, получено ${String(value)}`,
          );
        }
      }
      cards.portfolio = {
        totalValue: round2(totalValue),
        changePercent: round2(changePercent),
        assetsCount,
        state:
          changePercent > 0.5
            ? 'growth'
            : changePercent < -0.5
              ? 'decline'
              : 'flat',
      };
    } else {
      warnings.push('portfolio: секция отсутствует');
    }

    // Потребности
    if (metrics.needs) {
      const urgent = metrics.needs.categories
        .filter((entry) => entry.probability >= 0.15)
        .sort(
          (a, b) =>
            b.probability - a.probability ||
            a.category.localeCompare(b.category),
        )
        .map((entry) => ({
          category: entry.category,
          probability: round2(entry.probability),
        }));
      cards.needs = { urgent, total: metrics.needs.categories.length };
    } else {
      warnings.push('needs: секция отсутствует');
    }

    // Агенты
    if (metrics.agents) {
      const failedNames = metrics.agents
        .filter((agent) => agent.state === 'failed')
        .map((agent) => agent.name);
      cards.agents = {
        running: metrics.agents.filter((agent) => agent.state === 'running')
          .length,
        failed: failedNames.length,
        idle: metrics.agents.filter((agent) => agent.state === 'idle').length,
        failedNames,
      };
    } else {
      warnings.push('agents: секция отсутствует');
    }

    return cards;
  }
}
