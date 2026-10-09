/**
 * WidgetPrioritizer (Задача 3.1.1): подбор и приоритизация виджетов.
 *
 * score = BASE_PRIORITY[kind] · важность для риск-аппетита
 *       + буст за явные интересы (вес интереса категории виджета)
 *       + буст за наличие данных (виджет без данных не показывается,
 *         если требовательный).
 *
 * Детерминированно: сортировка по score убыв., при равенстве — по id.
 */

import type {
  DashboardMetrics,
  DashboardLayout,
  WidgetDefinition,
  WidgetKind,
  WidgetSize,
} from './types.js';
import type {
  InterestWeight,
  UserProfile,
} from '../../personalization-engine/types.js';

export class WidgetPrioritizerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WidgetPrioritizerError';
  }
}

export const WIDGET_PRIORITIZER_DEFAULTS = {
  maxWidgets: 8,
  minScore: 1,
} as const;

/** Базовый приоритет виджета (0..10). */
export const BASE_PRIORITY: Record<WidgetKind, number> = {
  'portfolio-summary': 10,
  'need-forecast': 7,
  anomalies: 8,
  trends: 6,
  scenarios: 5,
  'agent-status': 4,
  'quick-actions': 3,
  lessons: 2,
} as const;

/** Мультипликатор важности по риск-аппетиту. */
const RISK_WEIGHTS: Record<
  UserProfile['riskAppetite'],
  Partial<Record<WidgetKind, number>>
> = {
  conservative: { scenarios: 1.4, trends: 1.2, anomalies: 1.3 },
  moderate: {},
  aggressive: { 'quick-actions': 1.5, trends: 1.3, scenarios: 1.2 },
};

/** Категория интереса, бустящая виджет. */
const KIND_CATEGORY: Partial<Record<WidgetKind, string>> = {
  'need-forecast': 'needs',
  anomalies: 'risks',
  trends: 'trends',
  scenarios: 'scenarios',
  lessons: 'education',
};

/** Виджеты, показываемые только при наличии данных. */
const DATA_REQUIRED: readonly WidgetKind[] = [
  'portfolio-summary',
  'need-forecast',
  'anomalies',
  'trends',
  'scenarios',
  'lessons',
] as const;

const SIZES: Record<WidgetKind, WidgetSize> = {
  'portfolio-summary': 'large',
  'need-forecast': 'medium',
  anomalies: 'medium',
  trends: 'medium',
  scenarios: 'large',
  'agent-status': 'small',
  'quick-actions': 'small',
  lessons: 'small',
};

export interface WidgetPrioritizerOptions {
  maxWidgets?: number;
  minScore?: number;
}

export class WidgetPrioritizer {
  private readonly maxWidgets: number;
  private readonly minScore: number;

  constructor(options: WidgetPrioritizerOptions = {}) {
    this.maxWidgets =
      options.maxWidgets ?? WIDGET_PRIORITIZER_DEFAULTS.maxWidgets;
    this.minScore = options.minScore ?? WIDGET_PRIORITIZER_DEFAULTS.minScore;
    if (!(this.maxWidgets >= 1)) {
      throw new WidgetPrioritizerError('maxWidgets должен быть ≥ 1');
    }
  }

  /**
   * Строит раскладку: доступные виджеты, отсортированные по score.
   * Профиль и метрики обязательны; без данных требовательные виджеты
   * пропускаются с честным warning.
   */
  buildLayout(
    profile: UserProfile,
    interests: InterestWeight[],
    metrics: DashboardMetrics,
  ): DashboardLayout {
    if (typeof profile !== 'object' || profile === null) {
      throw new WidgetPrioritizerError('buildLayout: profile обязателен');
    }
    if (typeof metrics !== 'object' || metrics === null) {
      throw new WidgetPrioritizerError('buildLayout: metrics обязательны');
    }

    const warnings: string[] = [];
    const interestByCategory = new Map(
      interests.map((entry) => [entry.category, entry]),
    );
    const riskBoosts = RISK_WEIGHTS[profile.riskAppetite] ?? {};

    const widgets: WidgetDefinition[] = [];
    const kinds = Object.keys(BASE_PRIORITY) as WidgetKind[];

    for (const kind of kinds) {
      const base = BASE_PRIORITY[kind];
      const riskFactor = riskBoosts[kind] ?? 1;

      // Требовательные виджеты без данных пропускаются
      if (DATA_REQUIRED.includes(kind) && !this.hasData(kind, metrics)) {
        warnings.push(`виджет «${kind}» пропущен: данных нет`);
        continue;
      }

      // Буст за интересы
      const category = KIND_CATEGORY[kind];
      const interestWeight = category
        ? (interestByCategory.get(category)?.weight ?? 0)
        : 0;

      const score =
        Math.round((base * riskFactor + interestWeight * 2) * 100) / 100;
      if (score < this.minScore) {
        warnings.push(
          `виджет «${kind}» отброшен: score ${score} < ${this.minScore}`,
        );
        continue;
      }

      const reasonParts: string[] = [`база ${base}`];
      if (riskFactor !== 1) reasonParts.push(`риск-профиль ×${riskFactor}`);
      if (interestWeight > 0) {
        reasonParts.push(
          `интерес «${category}» +${Math.round(interestWeight * 200) / 100}`,
        );
      }

      widgets.push({
        id: `widget-${kind}`,
        kind,
        title: this.titleOf(kind),
        score,
        size: SIZES[kind],
        reason: reasonParts.join(', '),
      });
    }

    widgets.sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id),
    );

    // Сетка рассчитывается по итоговому числу виджетов (после ограничения)
    const visible = widgets.slice(0, this.maxWidgets);
    const grid = this.gridFor(visible.length);
    return { widgets: visible, grid, warnings };
  }

  private hasData(kind: WidgetKind, metrics: DashboardMetrics): boolean {
    switch (kind) {
      case 'portfolio-summary':
        return metrics.portfolio !== undefined;
      case 'need-forecast':
        return metrics.needs !== undefined;
      case 'anomalies':
        return metrics.anomalies !== undefined;
      case 'trends':
        return metrics.trends !== undefined;
      case 'scenarios':
        return metrics.portfolio !== undefined;
      case 'lessons':
        return false;
      default:
        return true;
    }
  }

  private gridFor(count: number): DashboardLayout['grid'] {
    if (count <= 2) return 'single';
    if (count <= 4) return 'two-column';
    return 'three-column';
  }

  private titleOf(kind: WidgetKind): string {
    const titles: Record<WidgetKind, string> = {
      'portfolio-summary': 'Сводка портфеля',
      'need-forecast': 'Прогноз потребностей',
      anomalies: 'Аномалии',
      trends: 'Тренды',
      scenarios: 'Сценарии',
      'agent-status': 'Статус агентов',
      'quick-actions': 'Быстрые действия',
      lessons: 'Уроки',
    };
    return titles[kind];
  }
}
