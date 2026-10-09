/**
 * PersonalizationEngine (Задача 1.3.6): фасад модуля персонализации.
 *
 * Actions: get-profile, update-profile, track-interaction, rank,
 * adapt-style, full-report (агрегирует всё, изолируя ошибки секций).
 */

import type {
  InteractionEvent,
  InterestWeight,
  PersonalizationAction,
  PersonalizationOutput,
  RankResult,
  StyleAdjustment,
  UserProfile,
  UserProfilePatch,
} from './types.js';
import { InterestTracker } from './interest-tracker.js';
import { ProfileStore } from './profile-store.js';
import { RelevanceRanker } from './relevance-ranker.js';
import { StyleAdapter } from './style-adapter.js';

export class PersonalizationEngineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PersonalizationEngineError';
  }
}

export interface PersonalizationEngineOptions {
  profileStore?: ProfileStore;
  interestTracker?: InterestTracker;
  ranker?: RelevanceRanker;
  styleAdapter?: StyleAdapter;
}

export interface PersonalizationEngineInput {
  action: PersonalizationAction;
  /** Для update-profile. */
  patch?: UserProfilePatch;
  /** Для track-interaction. */
  event?: InteractionEvent;
  /** Для rank. */
  items?: readonly unknown[];
  /** userId для get-profile. */
  userId?: string;
}

/**
 * Данные full-report. Секция, упавшая с ошибкой, в данных отсутствует
 * (честность: без выдуманных заглушек — см. PersonalizationOutput.errors).
 */
export interface FullReportResult {
  profile?: UserProfile;
  interests?: InterestWeight[];
  style?: StyleAdjustment;
}

export class PersonalizationEngine {
  private readonly profileStore: ProfileStore;
  private readonly interestTracker: InterestTracker;
  private readonly ranker: RelevanceRanker;
  private readonly styleAdapter: StyleAdapter;

  constructor(options: PersonalizationEngineOptions = {}) {
    if (
      !options.profileStore ||
      !(options.profileStore instanceof ProfileStore)
    ) {
      throw new PersonalizationEngineError(
        'PersonalizationEngine требует profileStore (экземпляр ProfileStore)',
      );
    }
    if (
      !options.interestTracker ||
      !(options.interestTracker instanceof InterestTracker)
    ) {
      throw new PersonalizationEngineError(
        'PersonalizationEngine требует interestTracker (экземпляр InterestTracker)',
      );
    }
    this.profileStore = options.profileStore;
    this.interestTracker = options.interestTracker;
    this.ranker = options.ranker ?? new RelevanceRanker();
    this.styleAdapter = options.styleAdapter ?? new StyleAdapter();
  }

  async getProfile(): Promise<UserProfile> {
    return this.profileStore.getProfile();
  }

  async updateProfile(patch: UserProfilePatch): Promise<UserProfile> {
    return this.profileStore.updateProfile(patch);
  }

  async trackInteraction(event: InteractionEvent): Promise<void> {
    await this.interestTracker.track(event);
  }

  async rank(
    items: readonly unknown[],
  ): Promise<RankResult & { style: StyleAdjustment }> {
    if (!Array.isArray(items)) {
      throw new PersonalizationEngineError(
        'rank: items должен быть массивом контента',
      );
    }
    const [profile, { interests }] = await Promise.all([
      this.profileStore.getProfile(),
      this.interestTracker.getInterests(),
    ]);
    const ranked = this.ranker.rank(items, { profile, interests });
    const style = this.styleAdapter.adapt(profile, interests);
    return { ...ranked, style };
  }

  async adaptStyle(): Promise<StyleAdjustment> {
    const [profile, { interests }] = await Promise.all([
      this.profileStore.getProfile(),
      this.interestTracker.getInterests(),
    ]);
    return this.styleAdapter.adapt(profile, interests);
  }

  /**
   * Агрегированный отчёт: профиль + интересы + стиль.
   * Ошибка любой секции попадает в errors, не роняя отчёт.
   */
  async fullReport(): Promise<PersonalizationOutput> {
    const data: FullReportResult = {};
    const errors: NonNullable<PersonalizationOutput['errors']> = {};
    let warnings: string[] = [];

    let profile: UserProfile | null = null;
    let interests: InterestWeight[] = [];

    try {
      profile = await this.profileStore.getProfile();
      data.profile = profile;
    } catch (error) {
      errors.profile = error instanceof Error ? error.message : String(error);
    }

    try {
      const result = await this.interestTracker.getInterests();
      interests = result.interests;
      warnings = result.warnings;
      data.interests = result.interests;
    } catch (error) {
      errors.interests = error instanceof Error ? error.message : String(error);
    }

    // Стиль считается только если обе базовые секции успешны.
    if (profile !== null) {
      try {
        data.style = this.styleAdapter.adapt(profile, interests);
      } catch (error) {
        errors.style = error instanceof Error ? error.message : String(error);
      }
    }

    const errorCount = Object.keys(errors).length;
    return {
      success: errorCount === 0,
      action: 'full-report',
      data: errorCount === 0 ? data : undefined,
      errors: errorCount > 0 ? errors : undefined,
      warnings,
    };
  }

  /** Диспетчер действий по контракту PersonalizationOutput. */
  async execute(
    input: PersonalizationEngineInput,
  ): Promise<PersonalizationOutput> {
    try {
      if (typeof input !== 'object' || input === null) {
        throw new PersonalizationEngineError(
          'execute: input должен быть объектом',
        );
      }
      switch (input.action) {
        case 'get-profile': {
          const profile = await this.getProfile();
          return { success: true, action: input.action, data: profile };
        }
        case 'update-profile': {
          if (!input.patch || typeof input.patch !== 'object') {
            throw new PersonalizationEngineError(
              'update-profile требует patch (объект UserProfilePatch)',
            );
          }
          const profile = await this.updateProfile(input.patch);
          return { success: true, action: input.action, data: profile };
        }
        case 'track-interaction': {
          if (!input.event || typeof input.event !== 'object') {
            throw new PersonalizationEngineError(
              'track-interaction требует event (InteractionEvent)',
            );
          }
          await this.trackInteraction(input.event);
          return {
            success: true,
            action: input.action,
            data: { tracked: true },
          };
        }
        case 'rank': {
          if (!Array.isArray(input.items)) {
            throw new PersonalizationEngineError(
              'rank требует items (массив ContentItem)',
            );
          }
          const result = await this.rank(input.items);
          return { success: true, action: input.action, data: result };
        }
        case 'adapt-style': {
          const style = await this.adaptStyle();
          return { success: true, action: input.action, data: style };
        }
        case 'full-report': {
          return await this.fullReport();
        }
        default: {
          return {
            success: false,
            action: (input as PersonalizationEngineInput)
              .action as PersonalizationAction,
            errors: {
              general: `Неизвестный action: "${String((input as PersonalizationEngineInput).action)}"`,
            },
          };
        }
      }
    } catch (error) {
      return {
        success: false,
        action: (input as PersonalizationEngineInput).action ?? 'get-profile',
        errors: {
          general: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
