/**
 * IntentParser (Задача 3.2.1): rule-based разбор запроса на интент.
 *
 * - Ключевые слова на русском и английском (детерминированно, без LLM).
 * - Интент выбирается по максимальному числу совпадений; ничья — порядок
 *   объявления; 0 совпадений → 'unknown' с confidence 0.
 * - Сущности: тикеры (3–5 заглавных букв, word-boundary), горизонт
 *   («на N дней/нед(елю)», «N дн.»), категория (needs/risks/trends).
 */

import type { NliEntities, NliIntent, NliParseResult } from './types.js';

export class IntentParserError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IntentParserError';
  }
}

/**
 * Ключевые слова интентов — корни слов (без окончаний), чтобы матчить
 * любые падежи: «портфель», «портфеля», «сводка», «сводку» и т.д.
 */
export const INTENT_KEYWORDS: Readonly<
  Record<Exclude<NliIntent, 'unknown'>, readonly string[]>
> = {
  'portfolio-status': [
    'портфел',
    'portfolio',
    'позици',
    'positions',
    'стоимост',
    'сколько стоит',
  ],
  forecast: [
    'прогноз',
    'forecast',
    'предскаж',
    'predict',
    'потребност',
    'needs',
    'понадоб',
  ],
  scenarios: ['сценар', 'scenario', 'best', 'worst'],
  anomalies: ['аномали', 'anomal', 'выброс', 'spike', 'drop', 'резк'],
  dashboard: ['дашборд', 'dashboard', 'сводк', 'overview', 'экран'],
  help: ['помощь', 'help', 'что ты умеешь', 'команд', 'возможност'],
} as const;

/** Категории, распознаваемые в запросе. */
export const CATEGORY_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  needs: ['потребност', 'need'],
  risks: ['риск', 'risk', 'аномали'],
  trends: ['тренд', 'trend'],
  scenarios: ['сценар', 'scenario'],
  education: ['урок', 'обучение', 'lesson'],
} as const;

const HORIZON_DAYS_REGEX = /(\d+)\s*(?:дн|день|дня|дней|days?)/i;
const HORIZON_WEEKS_REGEX = /(\d+)\s*(?:недел|нед|weeks?)/i;

export interface IntentParserOptions {
  /** Минимальный порог уверенности для не-'unknown' интента. */
  minConfidence?: number;
}

export class IntentParser {
  private readonly minConfidence: number;

  constructor(options: IntentParserOptions = {}) {
    this.minConfidence = options.minConfidence ?? 0.5;
  }

  /**
   * Разбирает запрос. Пустой/нестроковый вход → честная ошибка.
   * Неуверенное совпадение (< minConfidence) → intent 'unknown'.
   */
  parse(text: string): NliParseResult {
    if (typeof text !== 'string') {
      throw new IntentParserError(
        `parse: вход должен быть строкой, получено ${typeof text}`,
      );
    }
    const trimmed = text.trim();
    if (trimmed === '') {
      throw new IntentParserError('parse: пустой запрос');
    }

    const lower = trimmed.toLowerCase();
    let bestIntent: NliIntent = 'unknown';
    let bestMatches: string[] = [];
    let bestCount = 0;

    for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
      const matched = keywords.filter((keyword) => lower.includes(keyword));
      if (matched.length > bestCount) {
        bestCount = matched.length;
        bestIntent = intent as NliIntent;
        bestMatches = matched;
      }
    }

    // Уверенность: совпадения / порог 2 (одно слово = 0.5, два+ = 1)
    const rawConfidence = Math.min(1, bestCount / 2);
    const confident =
      bestIntent !== 'unknown' && rawConfidence >= this.minConfidence;

    return {
      intent: confident ? bestIntent : 'unknown',
      confidence: Math.round(rawConfidence * 100) / 100,
      entities: this.extractEntities(trimmed),
      matchedKeywords: bestMatches,
    };
  }

  private extractEntities(text: string): NliEntities {
    const entities: NliEntities = { tickers: [] };

    // Тикеры: только латиница (чтобы не ловить русские слова ЗАГЛАВНЫМИ)
    const tickerMatches = text.match(/\b[A-Z]{3,5}\b/g) ?? [];
    entities.tickers = [...new Set(tickerMatches)];

    // Горизонт
    const days = HORIZON_DAYS_REGEX.exec(text);
    if (days) {
      entities.horizonDays = Number.parseInt(days[1]!, 10);
    } else {
      const weeks = HORIZON_WEEKS_REGEX.exec(text);
      if (weeks) {
        entities.horizonDays = Number.parseInt(weeks[1]!, 10) * 7;
      }
    }

    // Категория
    const lower = text.toLowerCase();
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some((keyword) => lower.includes(keyword))) {
        entities.category = category;
        break;
      }
    }

    return entities;
  }
}
