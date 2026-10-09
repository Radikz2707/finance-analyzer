/**
 * Типы SmartDashboard (Задача 3.1): адаптивная модель дашборда.
 *
 * Дашборд — не UI, а данные: подбор и приоритизация виджетов
 * под профиль пользователя и его интересы (стыковка с PersonalizationEngine),
 * агрегация метрик. Фронтенд получает готовую раскладку.
 */

export type WidgetKind =
  | 'portfolio-summary'
  | 'need-forecast'
  | 'anomalies'
  | 'trends'
  | 'scenarios'
  | 'agent-status'
  | 'quick-actions'
  | 'lessons';

export type WidgetSize = 'small' | 'medium' | 'large';

export type GridDensity = 'single' | 'two-column' | 'three-column';

export interface WidgetDefinition {
  id: string;
  kind: WidgetKind;
  title: string;
  /** Итоговый приоритет (чем больше — тем выше в раскладке). */
  score: number;
  size: WidgetSize;
  /** Почему виджет попал в раскладку (прозрачность). */
  reason: string;
}

export interface DashboardLayout {
  widgets: WidgetDefinition[];
  grid: GridDensity;
  warnings: string[];
}

/** Сырые метрики для агрегации (все секции опциональны — честно). */
export interface DashboardMetrics {
  /** Всего активов и суммарная стоимость (валюта портфеля). */
  portfolio?: {
    totalValue: number;
    changePercent: number;
    assetsCount: number;
  };
  /** Прогноз потребностей (из PredictionEngine). */
  needs?: {
    categories: { category: string; probability: number }[];
  };
  /** Аномалии (из PredictionEngine). */
  anomalies?: {
    count: number;
    critical: number;
  };
  /** Тренды (из PredictionEngine). */
  trends?: {
    category: string;
    direction: 'rising' | 'falling' | 'stable' | 'insufficient';
  }[];
  /** Статусы агентов конвейера. */
  agents?: {
    name: string;
    state: 'idle' | 'running' | 'failed';
  }[];
}
