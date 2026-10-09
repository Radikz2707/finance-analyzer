/**
 * InterestTracker (Задача 1.3.3): веса интересов по взаимодействиям.
 *
 * Модель: сила интереса категории = Σ (вес события · 0.5^(возрастДней / halfLifeDays)),
 * нормировка на normCap, clamp 0..1. Прошедшие события по умолчанию заменяют
 * старые, будущие ts → честный warning + пропуск.
 */

import type {
  InteractionAction,
  InteractionActionWeight,
  InteractionEvent,
  InteractionSource,
  InterestProfileResult,
  InterestWeight,
} from './types.js';

export class InterestTrackerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InterestTrackerError';
  }
}

export const DEFAULT_ACTION_WEIGHTS: InteractionActionWeight = {
  view: 0.5,
  expand: 0.7,
  accept: 1.0,
  dismiss: -0.8,
} as const;

export const INTEREST_TRACKER_DEFAULTS = {
  halfLifeDays: 14,
  normCap: 10,
} as const;

export interface InterestTrackerOptions {
  source: InteractionSource;
  /** Часы (инжектируются для тестов). */
  now?: () => Date;
  /** Период полураспада интереса в днях. */
  halfLifeDays?: number;
  /** «Сырое» значение, соответствующее весу 1.0. */
  normCap?: number;
  actionWeights?: Partial<InteractionActionWeight>;
}

const ACTIONS: readonly InteractionAction[] = [
  'view',
  'expand',
  'accept',
  'dismiss',
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export class InterestTracker {
  private readonly source: InteractionSource;
  private readonly now: () => Date;
  private readonly halfLifeDays: number;
  private readonly normCap: number;
  private readonly actionWeights: InteractionActionWeight;

  constructor(options: InterestTrackerOptions) {
    if (!options.source || typeof options.source.getAll !== 'function') {
      throw new InterestTrackerError(
        'InterestTracker требует source с методами getAll/append',
      );
    }
    this.source = options.source;
    this.now = options.now ?? (() => new Date());
    this.halfLifeDays =
      options.halfLifeDays ?? INTEREST_TRACKER_DEFAULTS.halfLifeDays;
    this.normCap = options.normCap ?? INTEREST_TRACKER_DEFAULTS.normCap;
    this.actionWeights = {
      ...DEFAULT_ACTION_WEIGHTS,
      ...options.actionWeights,
    };

    if (!(this.halfLifeDays > 0) || !Number.isFinite(this.halfLifeDays)) {
      throw new InterestTrackerError(
        `halfLifeDays должен быть конечным числом > 0, получено ${this.halfLifeDays}`,
      );
    }
    if (!(this.normCap > 0) || !Number.isFinite(this.normCap)) {
      throw new InterestTrackerError(
        `normCap должен быть конечным числом > 0, получено ${this.normCap}`,
      );
    }
  }

  /**
   * Записывает событие взаимодействия с валидацией.
   * Некорректное событие → честная ошибка (не записывается).
   */
  async track(event: InteractionEvent): Promise<void> {
    const problems: string[] = [];
    if (typeof event !== 'object' || event === null) {
      throw new InterestTrackerError('track: event должен быть объектом');
    }
    if (typeof event.ts !== 'string' || Number.isNaN(Date.parse(event.ts))) {
      problems.push('ts должен быть валидной ISO-датой');
    }
    if (typeof event.category !== 'string' || event.category.trim() === '') {
      problems.push('category должна быть непустой строкой');
    }
    if (!ACTIONS.includes(event.action)) {
      problems.push(`action: недопустимое значение "${String(event.action)}"`);
    }
    if (problems.length > 0) {
      throw new InterestTrackerError(
        `track: некорректное событие — ${problems.join('; ')}`,
      );
    }
    try {
      await this.source.append(event);
    } catch (cause) {
      throw new InterestTrackerError(
        'track: не удалось записать событие в источник',
        { cause: cause instanceof Error ? cause : new Error(String(cause)) },
      );
    }
  }

  /** Веса интересов по всей истории взаимодействий. */
  async getInterests(): Promise<InterestProfileResult> {
    let events: InteractionEvent[];
    try {
      events = await this.source.getAll();
    } catch (cause) {
      throw new InterestTrackerError(
        `getInterests: не удалось получить события из источника (причина: ${
          cause instanceof Error ? cause.message : String(cause)
        })`,
        { cause: cause instanceof Error ? cause : new Error(String(cause)) },
      );
    }

    const warnings: string[] = [];
    const nowTs = this.now().getTime();
    const nowMs = this.now().getTime();

    interface Accum {
      rawScore: number;
      lastTs: string | null;
      lastTsMs: number;
      count: number;
    }
    const byCategory = new Map<string, Accum>();

    for (const event of events) {
      const tsMs = Date.parse(event.ts);
      if (Number.isNaN(tsMs)) {
        warnings.push(
          `Событие с невалидным ts="${String(event.ts)}" пропущено`,
        );
        continue;
      }
      if (tsMs > nowTs) {
        warnings.push(
          `Событие в будущем (${event.ts}) пропущено: категория "${event.category}"`,
        );
        continue;
      }
      const weight = this.actionWeights[event.action];
      if (typeof weight !== 'number') {
        warnings.push(
          `Событие с неизвестным action="${String(event.action)}" пропущено`,
        );
        continue;
      }
      const ageDays = Math.max(0, (nowMs - tsMs) / DAY_MS);
      const decay = 0.5 ** (ageDays / this.halfLifeDays);
      const contribution = weight * decay;

      const accum = byCategory.get(event.category) ?? {
        rawScore: 0,
        lastTs: null,
        lastTsMs: Number.NEGATIVE_INFINITY,
        count: 0,
      };
      accum.rawScore += contribution;
      accum.count += 1;
      if (accum.lastTs === null || tsMs > accum.lastTsMs) {
        accum.lastTs = event.ts;
        accum.lastTsMs = tsMs;
      }
      byCategory.set(event.category, accum);
    }

    const interests: InterestWeight[] = [...byCategory.entries()]
      .map(([category, accum]) => ({
        category,
        weight: round(clamp01(accum.rawScore / this.normCap)),
        rawScore: round(accum.rawScore),
        lastInteractionAt: accum.lastTs,
        interactions: accum.count,
      }))
      .sort((a, b) => {
        if (b.weight !== a.weight) return b.weight - a.weight;
        return a.category.localeCompare(b.category);
      });

    return { interests, warnings };
  }

  /** Вес интереса конкретной категории (0 при отсутствии истории). */
  async getCategoryWeight(category: string): Promise<number> {
    const { interests } = await this.getInterests();
    const found = interests.find((entry) => entry.category === category);
    return found ? found.weight : 0;
  }
}
