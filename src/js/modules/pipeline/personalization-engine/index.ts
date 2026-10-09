/**
 * PersonalizationEngine (Задача 1.3): профиль, интересы, ранжирование,
 * стиль подачи. Реэкспорт всех публичных частей модуля.
 */

export type {
  ContentDetailLevel,
  ContentItem,
  FinancialGoal,
  InteractionAction,
  InteractionActionWeight,
  InteractionEvent,
  InteractionSource,
  InterestProfileResult,
  InterestWeight,
  PersonalizationAction,
  PersonalizationOutput,
  ProfileStoreSource,
  RankResult,
  RankedItem,
  RiskAppetite,
  StyleAdjustment,
  ToneStyle,
  UserProfile,
  UserProfilePatch,
} from './types.js';

export {
  DETAIL_LEVELS,
  ProfileStore,
  ProfileStoreError,
  RISK_APPETITES,
  validateGoal,
  type ProfileStoreOptions,
} from './profile-store.js';

export {
  DEFAULT_ACTION_WEIGHTS,
  InterestTracker,
  InterestTrackerError,
  INTEREST_TRACKER_DEFAULTS,
  type InterestTrackerOptions,
} from './interest-tracker.js';

export {
  RANK_WEIGHTS,
  RANKER_DEFAULTS,
  RelevanceRanker,
  RelevanceRankerError,
  type RelevanceRankerOptions,
} from './relevance-ranker.js';

export {
  STYLE_THRESHOLDS,
  StyleAdapter,
  type StyleAdapterOptions,
} from './style-adapter.js';

export {
  PersonalizationEngine,
  PersonalizationEngineError,
  type FullReportResult,
  type PersonalizationEngineInput,
  type PersonalizationEngineOptions,
} from './personalization-engine.js';
