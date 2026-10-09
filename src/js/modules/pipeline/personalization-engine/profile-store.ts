/**
 * ProfileStore (Задача 1.3.2): хранение и обновление профиля пользователя.
 *
 * - Персистентность инжектируется через ProfileStoreSource (DI).
 * - Отсутствие профиля → дефолтный консервативный профиль (без выдумок).
 * - Некорректные поля патча → честная ошибка ProfileStoreError.
 */

import type {
  ContentDetailLevel,
  FinancialGoal,
  ProfileStoreSource,
  RiskAppetite,
  UserProfile,
  UserProfilePatch,
} from './types.js';

export class ProfileStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProfileStoreError';
  }
}

export const RISK_APPETITES: readonly RiskAppetite[] = [
  'conservative',
  'moderate',
  'aggressive',
] as const;

export const DETAIL_LEVELS: readonly ContentDetailLevel[] = [
  'brief',
  'standard',
  'detailed',
] as const;

/** Допустимые значения detailLevel профиля, включая '' (не задан). */
const ALL_PROFILE_DETAIL_LEVELS: readonly string[] = [
  '',
  ...DETAIL_LEVELS,
] as const;

/** Валидация цели. Возвращает список ошибок (пустой — если цель корректна). */
export function validateGoal(goal: unknown, index: number): string[] {
  const errors: string[] = [];
  if (typeof goal !== 'object' || goal === null) {
    return [`goals[${index}]: цель должна быть объектом`];
  }
  const g = goal as Partial<FinancialGoal>;
  if (typeof g.id !== 'string' || g.id.trim() === '') {
    errors.push(`goals[${index}]: id должен быть непустой строкой`);
  }
  if (typeof g.kind !== 'string' || g.kind.trim() === '') {
    errors.push(`goals[${index}]: kind должен быть непустой строкой`);
  }
  if (
    g.targetAmount !== undefined &&
    (typeof g.targetAmount !== 'number' ||
      !Number.isFinite(g.targetAmount) ||
      g.targetAmount < 0)
  ) {
    errors.push(
      `goals[${index}]: targetAmount должен быть конечным числом ≥ 0`,
    );
  }
  if (
    g.horizonMonths !== undefined &&
    (typeof g.horizonMonths !== 'number' ||
      !Number.isFinite(g.horizonMonths) ||
      g.horizonMonths <= 0)
  ) {
    errors.push(
      `goals[${index}]: horizonMonths должен быть конечным числом > 0`,
    );
  }
  return errors;
}

export interface ProfileStoreOptions {
  source: ProfileStoreSource;
  /** Часы (инжектируются для тестов). */
  now?: () => Date;
  /** Идентификатор пользователя для дефолтного профиля. */
  userId?: string;
}

export class ProfileStore {
  private readonly source: ProfileStoreSource;
  private readonly now: () => Date;
  private readonly userId: string;
  private cached: UserProfile | null = null;

  constructor(options: ProfileStoreOptions) {
    if (!options.source || typeof options.source.load !== 'function') {
      throw new ProfileStoreError(
        'ProfileStore требует source с методами load/save/clear',
      );
    }
    this.source = options.source;
    this.now = options.now ?? (() => new Date());
    this.userId = options.userId ?? 'default';
  }

  /**
   * Возвращает профиль: сохранённый или дефолтный.
   * Повреждённые сохранённые данные → честная ошибка.
   */
  async getProfile(): Promise<UserProfile> {
    if (this.cached) return this.cached;
    let loaded: UserProfile | null;
    try {
      loaded = await this.source.load();
    } catch (cause) {
      throw new ProfileStoreError('Не удалось загрузить профиль из источника', {
        cause: cause instanceof Error ? cause : new Error(String(cause)),
      });
    }
    if (loaded === null) {
      this.cached = this.defaultProfile();
      return this.cached;
    }
    const problems = this.validateProfileShape(loaded);
    if (problems.length > 0) {
      throw new ProfileStoreError(
        `Сохранённый профиль повреждён: ${problems.join('; ')}`,
      );
    }
    this.cached = loaded;
    return this.cached;
  }

  /**
   * Merge патча поверх текущего профиля с валидацией.
   * Некорректные поля → ProfileStoreError (без частичной записи).
   */
  async updateProfile(patch: UserProfilePatch): Promise<UserProfile> {
    if (typeof patch !== 'object' || patch === null) {
      throw new ProfileStoreError('updateProfile: patch должен быть объектом');
    }
    const current = await this.getProfile();
    const problems: string[] = [];

    if (
      patch.riskAppetite !== undefined &&
      !RISK_APPETITES.includes(patch.riskAppetite)
    ) {
      problems.push(
        `riskAppetite: недопустимое значение "${String(patch.riskAppetite)}"`,
      );
    }
    if (
      patch.detailLevel !== undefined &&
      !ALL_PROFILE_DETAIL_LEVELS.includes(patch.detailLevel)
    ) {
      problems.push(
        `detailLevel: недопустимое значение "${String(patch.detailLevel)}"`,
      );
    }
    if (patch.goals !== undefined) {
      if (!Array.isArray(patch.goals)) {
        problems.push('goals: должен быть массивом');
      } else {
        patch.goals.forEach((goal, index) => {
          for (const problem of validateGoal(goal, index))
            problems.push(problem);
        });
      }
    }
    if (patch.preferredCategories !== undefined) {
      if (!Array.isArray(patch.preferredCategories)) {
        problems.push('preferredCategories: должен быть массивом строк');
      } else if (
        patch.preferredCategories.some(
          (category) => typeof category !== 'string' || category.trim() === '',
        )
      ) {
        problems.push(
          'preferredCategories: все элементы должны быть непустыми строками',
        );
      }
    }
    if (problems.length > 0) {
      throw new ProfileStoreError(
        `updateProfile: некорректный патч — ${problems.join('; ')}`,
      );
    }

    const updated: UserProfile = {
      ...current,
      riskAppetite: patch.riskAppetite ?? current.riskAppetite,
      goals: patch.goals
        ? patch.goals.map((goal) => ({ ...goal }))
        : current.goals,
      preferredCategories: patch.preferredCategories
        ? [...patch.preferredCategories]
        : current.preferredCategories,
      detailLevel:
        patch.detailLevel !== undefined
          ? patch.detailLevel
          : current.detailLevel,
      updatedAt: this.now().toISOString(),
    };

    try {
      await this.source.save(updated);
    } catch (cause) {
      throw new ProfileStoreError(
        'updateProfile: не удалось сохранить профиль',
        { cause: cause instanceof Error ? cause : new Error(String(cause)) },
      );
    }
    this.cached = updated;
    return updated;
  }

  /** Сброс профиля к дефолтному (источник очищается). */
  async reset(): Promise<UserProfile> {
    try {
      await this.source.clear();
    } catch (cause) {
      throw new ProfileStoreError(
        'reset: не удалось очистить источник профиля',
        { cause: cause instanceof Error ? cause : new Error(String(cause)) },
      );
    }
    this.cached = this.defaultProfile();
    return this.cached;
  }

  private defaultProfile(): UserProfile {
    return {
      userId: this.userId,
      riskAppetite: 'conservative',
      goals: [],
      preferredCategories: [],
      detailLevel: '',
      updatedAt: this.now().toISOString(),
    };
  }

  private validateProfileShape(profile: UserProfile): string[] {
    const problems: string[] = [];
    if (typeof profile.userId !== 'string' || profile.userId.trim() === '') {
      problems.push('userId должен быть непустой строкой');
    }
    if (!RISK_APPETITES.includes(profile.riskAppetite)) {
      problems.push(
        `riskAppetite: недопустимое значение "${String(profile.riskAppetite)}"`,
      );
    }
    if (!Array.isArray(profile.goals)) {
      problems.push('goals должен быть массивом');
    } else {
      profile.goals.forEach((goal, index) => {
        for (const problem of validateGoal(goal, index)) problems.push(problem);
      });
    }
    if (!Array.isArray(profile.preferredCategories)) {
      problems.push('preferredCategories должен быть массивом');
    }
    if (!ALL_PROFILE_DETAIL_LEVELS.includes(profile.detailLevel)) {
      problems.push(
        `detailLevel: недопустимое значение "${String(profile.detailLevel)}"`,
      );
    }
    return problems;
  }
}
