/**
 * StyleAdapter (Задача 1.3.5): адаптация детализации и тона подачи.
 *
 * Правила (прозрачные, с объяснением причин):
 * - Явная настройка профиля (detailLevel !== '') уважается всегда.
 * - Иначе уровень детализации — авто по опыту (количеству взаимодействий):
 *   < BRIEF_THRESHOLD → 'brief', < DETAILED_THRESHOLD → 'standard', иначе 'detailed'.
 * - Тон от риск-аппетита: conservative → 'educational', moderate → 'neutral',
 *   aggressive → 'concise'.
 */

import type {
  ContentDetailLevel,
  InterestWeight,
  StyleAdjustment,
  ToneStyle,
  UserProfile,
} from './types.js';

export const STYLE_THRESHOLDS = {
  /** Ниже — brief. */
  brief: 5,
  /** Ниже — standard, от него — detailed. */
  detailed: 20,
} as const;

const TONE_BY_RISK: Record<UserProfile['riskAppetite'], ToneStyle> = {
  conservative: 'educational',
  moderate: 'neutral',
  aggressive: 'concise',
};

export interface StyleAdapterOptions {
  /** Пороги опыта для авто-детализации. */
  thresholds?: typeof STYLE_THRESHOLDS;
}

export class StyleAdapter {
  private readonly thresholds: typeof STYLE_THRESHOLDS;

  constructor(options: StyleAdapterOptions = {}) {
    const t = options.thresholds ?? STYLE_THRESHOLDS;
    if (!(t.brief > 0) || !(t.detailed > t.brief)) {
      throw new Error(
        `StyleAdapter: пороги должны удовлетворять 0 < brief < detailed, получено brief=${t.brief}, detailed=${t.detailed}`,
      );
    }
    this.thresholds = t;
  }

  adapt(profile: UserProfile, interests: InterestWeight[]): StyleAdjustment {
    if (typeof profile !== 'object' || profile === null) {
      throw new Error('StyleAdapter.adapt: profile должен быть объектом');
    }

    const reasons: string[] = [];
    const experience = interests.reduce(
      (sum, entry) => sum + entry.interactions,
      0,
    );
    reasons.push(`опыт: ${experience} взаимодействий`);

    let detailLevel: ContentDetailLevel;
    if (profile.detailLevel !== '') {
      detailLevel = profile.detailLevel;
      reasons.push(
        `детализация задана пользователем явно: «${profile.detailLevel}»`,
      );
    } else if (experience < this.thresholds.brief) {
      detailLevel = 'brief';
      reasons.push(
        `детализация авто: <${this.thresholds.brief} взаимодействий → «brief»`,
      );
    } else if (experience < this.thresholds.detailed) {
      detailLevel = 'standard';
      reasons.push(
        `детализация авто: ${this.thresholds.brief}–${this.thresholds.detailed - 1} взаимодействий → «standard»`,
      );
    } else {
      detailLevel = 'detailed';
      reasons.push(
        `детализация авто: ≥${this.thresholds.detailed} взаимодействий → «detailed»`,
      );
    }

    const tone = TONE_BY_RISK[profile.riskAppetite];
    reasons.push(`тон по риск-аппетиту «${profile.riskAppetite}» → «${tone}»`);

    return { detailLevel, tone, reasons };
  }
}
