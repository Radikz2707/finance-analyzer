/**
 * SmartDashboard (Задача 3.1): адаптивная модель дашборда.
 */

export {
  SmartDashboard,
  type SmartDashboardOutput,
} from './smart-dashboard.js';
export {
  MetricAggregator,
  MetricAggregatorError,
  type AggregatedCards,
  type AgentsCard,
  type NeedsCard,
  type PortfolioCard,
} from './metric-aggregator.js';
export {
  BASE_PRIORITY,
  WIDGET_PRIORITIZER_DEFAULTS,
  WidgetPrioritizer,
  WidgetPrioritizerError,
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
