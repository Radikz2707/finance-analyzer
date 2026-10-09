/**
 * RelevanceRanker (Задача 1.3.4): ранжирование контента под пользователя.
 *
 * score = WEIGHTS.interest · вес категории
 *       + WEIGHTS.goals · доля совпавших целей
 *       + WEIGHTS.riskFit · (0 / 1 / −штраф при несовпадении)
 *       − WEIGHTS.detailMismatch (если уровень детализации контента отличается
 *         от адаптированного).
 *
 * Детерминированная сортировка: score убыв., при равенстве — по id.
 */

import type {
  ContentItem,
  InterestWeight,
  RankResult,
  RankedItem,
  UserProfile,
} from './types.js';

export class RelevanceRankerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RelevanceRankerError';
  }
}

export const RANK_WEIGHTS = {
  /** Вклад интереса к категории. */
  interest: 0.6,
  /** Вклад совпадения с целями (доля целей, покрытых контентом). */
  goals: 0.3,
  /** Вклад риск-соответствия (0 при нейтральном контенте). */
  riskFit: 0.2,
  /** Штраф за риск-несоответствие (вычитается целиком). */
  riskMismatchPenalty: 0.3,
  /** Штраф за несовпадение уровня детализации. */
  detailMismatchPenalty: 0.15,
} as const;

export const RANKER_DEFAULTS = {
  minScore: -1,
  topN: 10,
} as const;

export interface RelevanceRankerOptions {
  minScore?: number;
  /** Ограничение размера результата. */
  topN?: number;
}

export class RelevanceRanker {
  private readonly minScore: number;
  private readonly topN: number;

  constructor(options: RelevanceRankerOptions = {}) {
    this.minScore = options.minScore ?? RANKER_DEFAULTS.minScore;
    this.topN = options.topN ?? RANKER_DEFAULTS.topN;
    if (!Number.isFinite(this.topN) || this.topN < 1) {
      throw new RelevanceRankerError(
        `topN должен быть конечным числом ≥ 1, получено ${this.topN}`,
      );
    }
  }

  /**
   * Ранжирует контент под профиль и интересы.
   * Пустой список → честная ошибка; некорректные элементы → warning + пропуск.
   */
  rank(
    items: readonly ContentItem[],
    context: {
      profile: UserProfile;
      interests: InterestWeight[];
    },
  ): RankResult {
    if (!Array.isArray(items)) {
      throw new RelevanceRankerError('rank: items должен быть массивом');
    }
    if (items.length === 0) {
      throw new RelevanceRankerError(
        'rank: пустой список контента — нечего ранжировать',
      );
    }

    const warnings: string[] = [];
    const interestByCategory = new Map<string, InterestWeight>();
    for (const interest of context.interests) {
      interestByCategory.set(interest.category, interest);
    }
    const goalKinds = new Set(
      context.profile.goals
        .map((goal) => goal.kind)
        .filter((kind) => kind !== ''),
    );

    const ranked: RankedItem[] = [];

    items.forEach((item, index) => {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof item.id !== 'string' ||
        item.id.trim() === '' ||
        typeof item.category !== 'string' ||
        item.category.trim() === ''
      ) {
        warnings.push(
          `items[${index}]: некорректный элемент (нужны непустые id и category) — пропущен`,
        );
        return;
      }

      const reasons: string[] = [];
      let score = 0;

      // 1) Интерес к категории
      const interest = interestByCategory.get(item.category);
      const interestScore =
        (interest ? interest.weight : 0) * RANK_WEIGHTS.interest;
      score += interestScore;
      if (interest) {
        reasons.push(
          `интерес к «${item.category}»: ${interest.weight} (×${RANK_WEIGHTS.interest})`,
        );
      } else {
        reasons.push(
          `категория «${item.category}»: истории взаимодействий нет (0)`,
        );
      }

      // 2) Совпадение с целями
      if (goalKinds.size === 0) {
        reasons.push('целей в профиле нет — вклад целей 0');
      } else if (!item.goalKinds || item.goalKinds.length === 0) {
        reasons.push('контент не привязан к целям — вклад целей 0');
      } else {
        const matched = item.goalKinds.filter((kind: string) =>
          goalKinds.has(kind),
        ).length;
        const coverage = matched / goalKinds.size;
        score += coverage * RANK_WEIGHTS.goals;
        reasons.push(
          `цели: ${matched}/${goalKinds.size} покрыто (×${RANK_WEIGHTS.goals})`,
        );
      }

      // 3) Риск-соответствие
      if (!item.riskFit || item.riskFit.length === 0) {
        reasons.push('риск-аппетит контента нейтрален');
      } else if (item.riskFit.includes(context.profile.riskAppetite)) {
        score += RANK_WEIGHTS.riskFit;
        reasons.push(`риск-аппетит соответствует (×${RANK_WEIGHTS.riskFit})`);
      } else {
        score -= RANK_WEIGHTS.riskMismatchPenalty;
        reasons.push(
          `риск-несоответствие: контент для ${item.riskFit.join('/')}, профиль ${context.profile.riskAppetite}`,
        );
      }

      // 4) Детализация (сравнение с заданным уровнем профиля, если задан)
      if (
        context.profile.detailLevel !== '' &&
        item.detailLevel !== undefined &&
        item.detailLevel !== context.profile.detailLevel
      ) {
        score -= RANK_WEIGHTS.detailMismatchPenalty;
        reasons.push(
          `детализация контента «${item.detailLevel}» ≠ профильной «${context.profile.detailLevel}»`,
        );
      }

      ranked.push({ item, score: round(score), reasons });
    });

    const filtered = ranked
      .filter((entry) => entry.score >= this.minScore)
      .sort((a, b) =>
        b.score !== a.score
          ? b.score - a.score
          : a.item.id.localeCompare(b.item.id),
      )
      .slice(0, this.topN);

    return { items: filtered, warnings };
  }
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
