/**
 * Тесты PersonalizationEngine (Задача 1.3): ProfileStore, InterestTracker,
 * RelevanceRanker, StyleAdapter, фасад PersonalizationEngine.
 *
 * Принципы: детерминизм (DI-часы и DI-источники), честность (пустые/некорректные
 * данные → честные ошибки или warnings, без выдуманных результатов).
 *
 * Глобальные describe/it/expect/vi предоставляются vitest (globals: true в
 * vitest.config.ts). Явный `import ... from 'vitest'` в этом проекте создаёт
 * второй экземпляр @vitest/runner и ломает контекст — поэтому глобалы.
 */

import {
  InterestTracker,
  InterestTrackerError,
  PersonalizationEngine,
  PersonalizationEngineError,
  ProfileStore,
  ProfileStoreError,
  RelevanceRanker,
  RelevanceRankerError,
  RANK_WEIGHTS,
  STYLE_THRESHOLDS,
  StyleAdapter,
  validateGoal,
} from './index.js';
import type {
  ContentItem,
  InteractionEvent,
  InteractionSource,
  ProfileStoreSource,
  UserProfile,
} from './types.js';

const FIXED_NOW = new Date('2026-06-15T12:00:00.000Z');
const now = () => new Date(FIXED_NOW);
const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Моки DI-источников ───────────────────────────────────────────────────

function makeProfileSource(initial: UserProfile | null = null) {
  const saved: UserProfile | null = initial;
  const source: ProfileStoreSource = {
    load: vi.fn(async () => saved),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };
  return source;
}

function makeInteractionSource(events: InteractionEvent[] = []) {
  const store = [...events];
  const source: InteractionSource = {
    getAll: vi.fn(async () => [...store]),
    append: vi.fn(async (event: InteractionEvent) => {
      store.push(event);
    }),
  };
  return { source, store };
}

// ─── Утилиты ──────────────────────────────────────────────────────────────

function daysAgo(days: number): string {
  return new Date(FIXED_NOW.getTime() - days * DAY_MS).toISOString();
}

/** Кастомный профиль для тестов ранжирования. */
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

// ─── ProfileStore ─────────────────────────────────────────────────────────

describe('ProfileStore', () => {
  it('отсутствие профиля → дефолтный консервативный профиль', async () => {
    const store = new ProfileStore({ source: makeProfileSource(null), now });
    const profile = await store.getProfile();
    expect(profile.riskAppetite).toBe('conservative');
    expect(profile.goals).toEqual([]);
    expect(profile.detailLevel).toBe('');
  });

  it('updateProfile: merge патча + сохранение через источник', async () => {
    const source = makeProfileSource(null);
    const store = new ProfileStore({ source, now });
    await store.updateProfile({
      riskAppetite: 'aggressive',
      goals: [{ id: 'g1', kind: 'growth' }],
    });
    const profile = await store.getProfile();
    expect(profile.riskAppetite).toBe('aggressive');
    expect(profile.goals).toHaveLength(1);
    expect(source.save).toHaveBeenCalledTimes(1);
  });

  it('updateProfile: некорректный riskAppetite → честная ошибка, без записи', async () => {
    const source = makeProfileSource(null);
    const store = new ProfileStore({ source, now });
    await expect(
      store.updateProfile({ riskAppetite: 'gambling' as never }),
    ).rejects.toThrow(ProfileStoreError);
    expect(source.save).not.toHaveBeenCalled();
  });

  it('updateProfile: некорректная цель детектируется через validateGoal', () => {
    expect(validateGoal({ id: '', kind: 'growth' }, 0)).toHaveLength(1);
    expect(
      validateGoal({ id: 'g', kind: 'growth', targetAmount: -5 }, 0),
    ).toHaveLength(1);
    expect(
      validateGoal({ id: 'g', kind: 'growth', horizonMonths: 0 }, 0),
    ).toHaveLength(1);
    expect(validateGoal({ id: 'g', kind: 'growth' }, 0)).toHaveLength(0);
  });

  it('падение источника при загрузке → ProfileStoreError (честная ошибка)', async () => {
    const broken: ProfileStoreSource = {
      load: vi.fn(async () => {
        throw new Error('disk failure');
      }),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const store = new ProfileStore({ source: broken, now });
    await expect(store.getProfile()).rejects.toThrow(ProfileStoreError);
  });

  it('reset очищает источник и возвращает дефолтный профиль', async () => {
    const source = makeProfileSource(
      makeProfile({ riskAppetite: 'aggressive' }),
    );
    const store = new ProfileStore({ source, now });
    const profile = await store.reset();
    expect(profile.riskAppetite).toBe('conservative');
    expect(source.clear).toHaveBeenCalledTimes(1);
  });

  it('конструктор без источника → честная ошибка', () => {
    expect(() => new ProfileStore({ source: null as never })).toThrow(
      ProfileStoreError,
    );
  });
});

// ─── InterestTracker ──────────────────────────────────────────────────────

describe('InterestTracker', () => {
  it('пустая история → пустой список интересов без ошибок', async () => {
    const { source } = makeInteractionSource();
    const tracker = new InterestTracker({ source, now });
    const result = await tracker.getInterests();
    expect(result.interests).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('свежие accept дают больший вес, чем старые view', async () => {
    const { source } = makeInteractionSource([
      { ts: daysAgo(1), category: 'dividends', action: 'accept' },
      { ts: daysAgo(120), category: 'macro', action: 'view' },
    ]);
    const tracker = new InterestTracker({ source, now });
    const { interests } = await tracker.getInterests();
    expect(interests).toHaveLength(2);
    const dividends = interests.find((i) => i.category === 'dividends');
    const macro = interests.find((i) => i.category === 'macro');
    expect(dividends!.weight).toBeGreaterThan(macro!.weight);
    // rawScore = 1·0.5^(1/14) ≈ 0.9516, weight = rawScore / normCap(10)
    expect(dividends!.rawScore).toBeCloseTo(0.9516, 2);
    expect(dividends!.weight).toBeCloseTo(0.0952, 2);
    expect(interests[0]!.category).toBe('dividends');
  });

  it('dismiss снижает вес категории', async () => {
    const { source } = makeInteractionSource([
      { ts: daysAgo(1), category: 'crypto', action: 'dismiss' },
      { ts: daysAgo(1), category: 'bonds', action: 'accept' },
    ]);
    const tracker = new InterestTracker({ source, now });
    const { interests } = await tracker.getInterests();
    const crypto = interests.find((i) => i.category === 'crypto')!;
    const bonds = interests.find((i) => i.category === 'bonds')!;
    expect(crypto.rawScore).toBeLessThan(0);
    expect(bonds.weight).toBeGreaterThan(crypto.weight);
  });

  it('полураспад: событие возраста halfLifeDays даёт половину вклада', async () => {
    const { source } = makeInteractionSource([
      { ts: daysAgo(0), category: 'a', action: 'accept' },
      { ts: daysAgo(0), category: 'b', action: 'accept' },
      { ts: daysAgo(14), category: 'c', action: 'accept' },
    ]);
    const tracker = new InterestTracker({
      source,
      now,
      halfLifeDays: 14,
      normCap: 1,
    });
    const { interests } = await tracker.getInterests();
    const fresh = interests.find((i) => i.category === 'a')!;
    const aged = interests.find((i) => i.category === 'c')!;
    expect(aged.rawScore).toBeCloseTo(fresh.rawScore * 0.5, 3);
  });

  it('будущие и некорректные события пропускаются с честным warning', async () => {
    const { source } = makeInteractionSource([
      { ts: '2030-01-01T00:00:00.000Z', category: 'future', action: 'view' },
      { ts: 'not-a-date', category: 'broken', action: 'view' },
      { ts: daysAgo(1), category: 'ok', action: 'accept' },
    ]);
    const tracker = new InterestTracker({ source, now });
    const { interests, warnings } = await tracker.getInterests();
    expect(interests).toHaveLength(1);
    expect(interests[0]!.category).toBe('ok');
    expect(warnings).toHaveLength(2);
  });

  it('track: некорректное событие → InterestTrackerError, без записи', async () => {
    const { source } = makeInteractionSource();
    const tracker = new InterestTracker({ source, now });
    await expect(
      tracker.track({ ts: 'nope', category: 'x', action: 'view' }),
    ).rejects.toThrow(InterestTrackerError);
    await expect(
      tracker.track({ ts: daysAgo(0), category: 'x', action: 'hack' as never }),
    ).rejects.toThrow(InterestTrackerError);
    expect(source.append).not.toHaveBeenCalled();
  });

  it('track: корректное событие записывается в источник', async () => {
    const { source } = makeInteractionSource();
    const tracker = new InterestTracker({ source, now });
    await tracker.track({ ts: daysAgo(0), category: 'orders', action: 'view' });
    expect(source.append).toHaveBeenCalledTimes(1);
  });

  it('конструктор без источника → честная ошибка', () => {
    expect(() => new InterestTracker({ source: null as never })).toThrow(
      InterestTrackerError,
    );
  });
});

// ─── RelevanceRanker ──────────────────────────────────────────────────────

describe('RelevanceRanker', () => {
  const profile = makeProfile({
    riskAppetite: 'conservative',
    goals: [{ id: 'g1', kind: 'income' }],
    detailLevel: 'standard',
  });

  it('контент с интересом и совпадением целей ранжируется выше', () => {
    const ranker = new RelevanceRanker();
    const items: ContentItem[] = [
      { id: 'b', category: 'macro' },
      {
        id: 'a',
        category: 'dividends',
        goalKinds: ['income'],
        riskFit: ['conservative'],
      },
    ];
    const interests = [
      {
        category: 'dividends',
        weight: 1,
        rawScore: 10,
        lastInteractionAt: null,
        interactions: 10,
      },
      {
        category: 'macro',
        weight: 0.1,
        rawScore: 1,
        lastInteractionAt: null,
        interactions: 2,
      },
    ];
    const result = ranker.rank(items, { profile, interests });
    expect(result.items[0]!.item.id).toBe('a');
    const top = result.items[0]!;
    // 0.6·1 + 0.3·1 + 0.2 = 1.1
    expect(top.score).toBeCloseTo(1.1, 3);
    expect(top.reasons.length).toBeGreaterThan(0);
  });

  it('риск-несоответствие даёт штраф', () => {
    const ranker = new RelevanceRanker();
    const interests = [
      {
        category: 'crypto',
        weight: 1,
        rawScore: 10,
        lastInteractionAt: null,
        interactions: 10,
      },
    ];
    const result = ranker.rank(
      [{ id: 'x', category: 'crypto', riskFit: ['aggressive'] }],
      { profile, interests },
    );
    const base = RANK_WEIGHTS.interest;
    expect(result.items[0]!.score).toBeCloseTo(
      base - RANK_WEIGHTS.riskMismatchPenalty,
      3,
    );
    expect(
      result.items[0]!.reasons.some((r) => r.includes('риск-несоответствие')),
    ).toBe(true);
  });

  it('несовпадение детализации штрафуется', () => {
    const ranker = new RelevanceRanker();
    const interests = [
      {
        category: 'macro',
        weight: 1,
        rawScore: 10,
        lastInteractionAt: null,
        interactions: 10,
      },
    ];
    const result = ranker.rank(
      [{ id: 'x', category: 'macro', detailLevel: 'detailed' }],
      { profile, interests },
    );
    expect(result.items[0]!.score).toBeCloseTo(
      RANK_WEIGHTS.interest - RANK_WEIGHTS.detailMismatchPenalty,
      3,
    );
  });

  it('детерминированная сортировка при равных оценках (по id)', () => {
    const ranker = new RelevanceRanker();
    const items: ContentItem[] = [
      { id: 'zz', category: 'same' },
      { id: 'aa', category: 'same' },
    ];
    const result = ranker.rank(items, { profile, interests: [] });
    expect(result.items.map((r) => r.item.id)).toEqual(['aa', 'zz']);
  });

  it('topN ограничивает результат', () => {
    const ranker = new RelevanceRanker({ topN: 2 });
    const items: ContentItem[] = [
      { id: '1', category: 'a' },
      { id: '2', category: 'b' },
      { id: '3', category: 'c' },
    ];
    const result = ranker.rank(items, { profile, interests: [] });
    expect(result.items).toHaveLength(2);
  });

  it('пустой список → честная ошибка; некорректные элементы → warning', () => {
    const ranker = new RelevanceRanker();
    expect(() => ranker.rank([], { profile, interests: [] })).toThrow(
      RelevanceRankerError,
    );
    const result = ranker.rank(
      [{ id: '', category: 'x' } as ContentItem, { id: 'ok', category: 'y' }],
      { profile, interests: [] },
    );
    expect(result.items).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });
});

// ─── StyleAdapter ─────────────────────────────────────────────────────────

describe('StyleAdapter', () => {
  const adapter = new StyleAdapter();

  it('явная настройка профиля уважается всегда', () => {
    const profile = makeProfile({ detailLevel: 'brief' });
    const interests = [
      {
        category: 'x',
        weight: 1,
        rawScore: 100,
        lastInteractionAt: null,
        interactions: 100,
      },
    ];
    const style = adapter.adapt(profile, interests);
    expect(style.detailLevel).toBe('brief');
    expect(style.reasons.some((r) => r.includes('явно'))).toBe(true);
  });

  it('без явной настройки: малый опыт → brief, большой → detailed', () => {
    const few = adapter.adapt(makeProfile(), [
      {
        category: 'x',
        weight: 1,
        rawScore: 5,
        lastInteractionAt: null,
        interactions: STYLE_THRESHOLDS.brief - 1,
      },
    ]);
    expect(few.detailLevel).toBe('brief');
    const many = adapter.adapt(makeProfile(), [
      {
        category: 'x',
        weight: 1,
        rawScore: 5,
        lastInteractionAt: null,
        interactions: STYLE_THRESHOLDS.detailed,
      },
    ]);
    expect(many.detailLevel).toBe('detailed');
  });

  it('тон определяется риск-аппетитом', () => {
    expect(
      adapter.adapt(makeProfile({ riskAppetite: 'conservative' }), []).tone,
    ).toBe('educational');
    expect(
      adapter.adapt(makeProfile({ riskAppetite: 'moderate' }), []).tone,
    ).toBe('neutral');
    expect(
      adapter.adapt(makeProfile({ riskAppetite: 'aggressive' }), []).tone,
    ).toBe('concise');
  });

  it('конструктор: некорректные пороги → честная ошибка', () => {
    expect(
      () =>
        new StyleAdapter({ thresholds: { brief: 10, detailed: 10 } as never }),
    ).toThrow();
  });
});

// ─── Фасад PersonalizationEngine ──────────────────────────────────────────

describe('PersonalizationEngine', () => {
  const makeEngine = (interactionEvents: InteractionEvent[] = []) => {
    const { source: interactionSource } =
      makeInteractionSource(interactionEvents);
    return {
      engine: new PersonalizationEngine({
        profileStore: new ProfileStore({
          source: makeProfileSource(null),
          now,
        }),
        interestTracker: new InterestTracker({
          source: interactionSource,
          now,
        }),
      }),
      interactionSource,
    };
  };

  it('execute dispatch по всем action', async () => {
    const { engine } = makeEngine();
    const actions = [
      { action: 'get-profile' },
      { action: 'update-profile', patch: { riskAppetite: 'moderate' } },
      {
        action: 'track-interaction',
        event: { ts: daysAgo(0), category: 'x', action: 'view' },
      },
      { action: 'adapt-style' },
    ] as const;
    for (const input of actions) {
      const result = await engine.execute(input);
      expect(result.success).toBe(true);
    }
  });

  it('track-interaction → интересы учитываются в getInterests через фасад', async () => {
    const { engine } = makeEngine();
    await engine.execute({
      action: 'track-interaction',
      event: { ts: daysAgo(0), category: 'dividends', action: 'accept' },
    });
    const result = await engine.execute({ action: 'adapt-style' });
    expect(result.success).toBe(true);
    const style = result.data as { detailLevel: string; tone: string };
    expect(style.detailLevel).toBe('brief'); // 1 взаимодействие → brief
    expect(style.tone).toBe('educational'); // дефолтный conservative
  });

  it('rank: контент с интересом выше, стиль в результате', async () => {
    const { engine } = makeEngine([
      { ts: daysAgo(0), category: 'dividends', action: 'accept' },
      { ts: daysAgo(0), category: 'dividends', action: 'accept' },
      { ts: daysAgo(0), category: 'dividends', action: 'accept' },
      { ts: daysAgo(0), category: 'dividends', action: 'accept' },
      { ts: daysAgo(0), category: 'dividends', action: 'accept' },
    ]);
    const result = await engine.execute({
      action: 'rank',
      items: [
        { id: 'a', category: 'dividends' },
        { id: 'b', category: 'macro' },
      ],
    });
    expect(result.success).toBe(true);
    const data = result.data as {
      items: { item: { id: string }; score: number }[];
      style: { detailLevel: string };
    };
    expect(data.items[0]!.item.id).toBe('a');
    expect(data.style.detailLevel).toBe('standard'); // 5 взаимодействий → standard
  });

  it('rank без items → честная ошибка', async () => {
    const { engine } = makeEngine();
    const result = await engine.execute({ action: 'rank' });
    expect(result.success).toBe(false);
    expect(result.errors?.general).toContain('items');
  });

  it('неизвестный action → success=false с честной ошибкой', async () => {
    const { engine } = makeEngine();
    const result = await engine.execute({ action: 'teach-me' as never });
    expect(result.success).toBe(false);
    expect(result.errors?.general).toContain('Неизвестный action');
  });

  it('конструктор без компонентов → честная ошибка', () => {
    expect(() => new PersonalizationEngine({})).toThrow(
      PersonalizationEngineError,
    );
  });

  it('full-report агрегирует профиль, интересы и стиль; ошибка секции изолируется', async () => {
    // 1) Успешный отчёт
    const ok = makeEngine([
      { ts: daysAgo(0), category: 'x', action: 'accept' },
    ]);
    const okResult = await ok.engine.execute({ action: 'full-report' });
    expect(okResult.success).toBe(true);
    const okData = okResult.data as {
      profile: unknown;
      interests: unknown[];
      style: unknown;
    };
    expect(okData.profile).toBeDefined();
    expect(okData.interests).toHaveLength(1);
    expect(okData.style).toBeDefined();

    // 2) Падение источника взаимодействий → interests отсутствуют, success=false
    const brokenSource: InteractionSource = {
      getAll: vi.fn(async () => {
        throw new Error('io error');
      }),
      append: vi.fn(async () => undefined),
    };
    const brokenEngine = new PersonalizationEngine({
      profileStore: new ProfileStore({ source: makeProfileSource(null), now }),
      interestTracker: new InterestTracker({ source: brokenSource, now }),
    });
    const brokenResult = await brokenEngine.execute({ action: 'full-report' });
    expect(brokenResult.success).toBe(false);
    expect(brokenResult.errors?.interests).toContain('io error');
    // При ошибке данные отчёта не отдаются вовсе (честность).
    expect(brokenResult.data).toBeUndefined();
  });
});
