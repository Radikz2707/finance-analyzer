/**
 * SmartDashboard (Задача 3.1.3): фасад адаптивного дашборда.
 *
 * Объединяет WidgetPrioritizer (раскладка по профилю/интересам) и
 * MetricAggregator (честная агрегация карточек). Выход — данные
 * для фронтенда, без зависимости от UI-фреймворка.
 */

import type { DashboardLayout, DashboardMetrics } from './types.js';
import type {
  InterestWeight,
  UserProfile,
} from '../../personalization-engine/types.js';
import { MetricAggregator, type AggregatedCards } from './metric-aggregator.js';
import { WidgetPrioritizer } from './widget-prioritizer.js';

export {
  MetricAggregator,
  MetricAggregatorError,
  type AggregatedCards,
  type PortfolioCard,
  type NeedsCard,
  type AgentsCard,
} from './metric-aggregator.js';
export {
  WidgetPrioritizer,
  WidgetPrioritizerError,
  WIDGET_PRIORITIZER_DEFAULTS,
  BASE_PRIORITY,
  type WidgetPrioritizerOptions,
} from './widget-prioritizer.js';
export type {
  DashboardLayout,
  DashboardMetrics,
  GridDensity,
  WidgetDefinition,
  WidgetKind,
  WidgetSize,
} from './types.js';

export interface SmartDashboardOutput {
  layout: DashboardLayout;
  cards: AggregatedCards;
  warnings: string[];
}

export class SmartDashboard {
  private readonly prioritizer: WidgetPrioritizer;
  private readonly aggregator: MetricAggregator;

  constructor(
    options: {
      prioritizer?: WidgetPrioritizer;
      aggregator?: MetricAggregator;
    } = {},
  ) {
    this.prioritizer = options.prioritizer ?? new WidgetPrioritizer();
    this.aggregator = options.aggregator ?? new MetricAggregator();
  }

  /** Полная сборка дашборда: раскладка + карточки. */
  build(
    profile: UserProfile,
    interests: InterestWeight[],
    metrics: DashboardMetrics,
  ): SmartDashboardOutput {
    const layout = this.prioritizer.buildLayout(profile, interests, metrics);
    const cards = this.aggregator.aggregate(metrics);
    return {
      layout,
      cards,
      warnings: [...layout.warnings, ...cards.warnings],
    };
  }
}
