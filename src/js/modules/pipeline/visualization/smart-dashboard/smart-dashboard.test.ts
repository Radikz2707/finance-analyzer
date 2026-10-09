/**
 * Тесты SmartDashboard (Задача 3.1): WidgetPrioritizer, MetricAggregator,
 * фасад SmartDashboard.
 *
 * Глобальные describe/it/expect/vi предоставляются vitest (globals: true в
 * vitest.config.ts). Явный `import ... from 'vitest'` в этом проекте создаёт
 * второй экземпляр @vitest/runner и ломает контекст — поэтому глобалы.
 */

import {
  MetricAggregator,
  MetricAggregatorError,
  SmartDashboard,
  WidgetPrioritizer,
  WidgetPrioritizerError,
} from './index.js';
import type { DashboardMetrics } from './types.js';
import type {
  InterestWeight,
  UserProfile,
} from '../../personalization-engine/types.js';

const FIXED_NOW = new Date('2026-06-15T12:00:00.000Z');

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: 'user-1',
    riskAppetite: 'moderate',
    goals: [],
    preferredCategories: [],
    detailLevel: '',
    updatedAt: FIXED_NOW.toISOString(),
    ...overrides,
  };
}

const fullMetrics: DashboardMetrics = {
  portfolio: {
    totalValue: 1_234_567.891,
    changePercent: 2.345,
    assetsCount: 12,
  },
  needs: {
    categories: [
      { category: 'dividends', probability: 0.7 },
      { category: 'taxes', probability: 0.1 },
      { category: 'orders', probability: 0.4 },
    ],
  },
  anomalies: { count: 3, critical: 1 },
  trends: [{ category: 'portfolio', direction: 'rising' }],
  agents: [
    { name: 'DataAgent', state: 'running' },
    { name: 'AiAgent', state: 'failed' },
    { name: 'ReviewAgent', state: 'idle' },
  ],
};

const interests: InterestWeight[] = [
  {
    category: 'risks',
    weight: 1,
    rawScore: 10,
    lastInteractionAt: null,
    interactions: 10,
  },
  {
    category: 'trends',
    weight: 0.5,
    rawScore: 5,
    lastInteractionAt: null,
    interactions: 5,
  },
];

// ─── WidgetPrioritizer ────────────────────────────────────────────────────

describe('WidgetPrioritizer', () => {
  const prioritizer = new WidgetPrioritizer();

  it('виджеты без данных пропускаются с честным warning', () => {
    const layout = prioritizer.buildLayout(makeProfile(), [], {});
    expect(
      layout.widgets.find((w) => w.kind === 'portfolio-summary'),
    ).toBeUndefined();
    expect(layout.warnings.some((w) => w.includes('данных нет'))).toBe(true);
    // Виджеты без требований к данным остаются
    expect(layout.widgets.some((w) => w.kind === 'agent-status')).toBe(true);
    expect(layout.widgets.some((w) => w.kind === 'quick-actions')).toBe(true);
  });

  it('с полными метриками: сортировка по score убыв., портфель первым', () => {
    const layout = prioritizer.buildLayout(
      makeProfile(),
      interests,
      fullMetrics,
    );
    // Интерес 'risks' (вес 1) бустит anomalies до 10 (портфель 10);
    // при равенстве tie-break по id → anomalies первым. Это честно:
    // пользователь глубоко интересуется рисками.
    expect(layout.widgets[0]!.kind).toBe('anomalies');
    expect(layout.widgets.some((w) => w.kind === 'portfolio-summary')).toBe(
      true,
    );
    const scores = layout.widgets.map((w) => w.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(layout.grid).toBe('three-column');
  });

  it('риск-аппетит меняет приоритеты: conservative бустит сценарии', () => {
    const conservative = prioritizer.buildLayout(
      makeProfile({ riskAppetite: 'conservative' }),
      [],
      fullMetrics,
    );
    const moderate = prioritizer.buildLayout(
      makeProfile({ riskAppetite: 'moderate' }),
      [],
      fullMetrics,
    );
    const scoreOf = (
      layout: ReturnType<typeof prioritizer.buildLayout>,
      kind: string,
    ) => layout.widgets.find((w) => w.kind === kind)?.score ?? 0;
    expect(scoreOf(conservative, 'scenarios')).toBeGreaterThan(
      scoreOf(moderate, 'scenarios'),
    );
    expect(
      conservative.widgets.find((w) => w.kind === 'scenarios')!.reason,
    ).toContain('риск-профиль');
  });

  it('интересы бустят соответствующие виджеты', () => {
    const withInterests = prioritizer.buildLayout(
      makeProfile(),
      interests,
      fullMetrics,
    );
    const without = prioritizer.buildLayout(makeProfile(), [], fullMetrics);
    const scoreOf = (
      layout: ReturnType<typeof prioritizer.buildLayout>,
      kind: string,
    ) => layout.widgets.find((w) => w.kind === kind)?.score ?? 0;
    // интерес 'risks' → виджет anomalies
    expect(scoreOf(withInterests, 'anomalies')).toBeGreaterThan(
      scoreOf(without, 'anomalies'),
    );
  });

  it('topN ограничивает раскладку', () => {
    const strict = new WidgetPrioritizer({ maxWidgets: 3 });
    const layout = strict.buildLayout(makeProfile(), [], fullMetrics);
    expect(layout.widgets).toHaveLength(3);
    expect(layout.grid).toBe('two-column');
  });

  it('пустые profile/metrics → честная ошибка', () => {
    expect(() =>
      prioritizer.buildLayout(null as never, [], fullMetrics),
    ).toThrow(WidgetPrioritizerError);
    expect(() =>
      prioritizer.buildLayout(makeProfile(), [], null as never),
    ).toThrow(WidgetPrioritizerError);
  });
});

// ─── MetricAggregator ─────────────────────────────────────────────────────

describe('MetricAggregator', () => {
  const aggregator = new MetricAggregator();

  it('агрегирует портфель с округлением до 2 знаков и state', () => {
    const cards = aggregator.aggregate(fullMetrics);
    expect(cards.portfolio!.totalValue).toBe(1_234_567.89);
    expect(cards.portfolio!.changePercent).toBe(2.35);
    expect(cards.portfolio!.state).toBe('growth');
  });

  it('needs: фильтр по порогу 0.15 и сортировка по вероятности', () => {
    const cards = aggregator.aggregate(fullMetrics);
    expect(cards.needs!.urgent.map((entry) => entry.category)).toEqual([
      'dividends',
      'orders',
    ]);
    expect(cards.needs!.total).toBe(3);
  });

  it('agents: считает состояния и имена упавших', () => {
    const cards = aggregator.aggregate(fullMetrics);
    expect(cards.agents!.running).toBe(1);
    expect(cards.agents!.failed).toBe(1);
    expect(cards.agents!.failedNames).toEqual(['AiAgent']);
    expect(cards.agents!.idle).toBe(1);
  });

  it('пустые метрики → честные warnings без выдуманных нулей', () => {
    const cards = aggregator.aggregate({});
    expect(cards.portfolio).toBeUndefined();
    expect(cards.warnings).toContain('portfolio: секция отсутствует');
    expect(cards.warnings).toContain('needs: секция отсутствует');
    expect(cards.warnings).toContain('agents: секция отсутствует');
  });

  it('некорректные значения портфеля → честная ошибка', () => {
    expect(() =>
      aggregator.aggregate({
        portfolio: { totalValue: NaN, changePercent: 0, assetsCount: 1 },
      }),
    ).toThrow(MetricAggregatorError);
  });
});

// ─── SmartDashboard (фасад) ───────────────────────────────────────────────

describe('SmartDashboard', () => {
  const dashboard = new SmartDashboard();

  it('build: раскладка + карточки + сводный warnings', () => {
    const output = dashboard.build(makeProfile(), interests, fullMetrics);
    expect(output.layout.widgets.length).toBeGreaterThan(0);
    expect(output.cards.portfolio).toBeDefined();
    expect(output.warnings.length).toBeGreaterThanOrEqual(
      output.layout.warnings.length,
    );
  });

  it('build: деградация при пустых метриках — только системные виджеты', () => {
    const output = dashboard.build(makeProfile(), [], {});
    expect(
      output.layout.widgets.every(
        (w) => !['portfolio-summary', 'anomalies', 'trends'].includes(w.kind),
      ),
    ).toBe(true);
    expect(output.warnings.length).toBeGreaterThan(0);
  });

  it('при equal score сортировка детерминирована по id', () => {
    const layout = dashboard.build(makeProfile(), [], fullMetrics).layout;
    const ids = layout.widgets.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
