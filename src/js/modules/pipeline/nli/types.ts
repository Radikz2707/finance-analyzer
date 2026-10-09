/**
 * Типы NLI (Задача 3.2): интерфейс на естественном языке.
 *
 * Rule-based парсер интентов (без LLM — детерминизм и честность),
 * извлечение сущностей (тикеры, категории, горизонт), маршрутизация
 * к возможностям системы с честными ответами.
 */

export type NliIntent =
  | 'portfolio-status'
  | 'forecast'
  | 'scenarios'
  | 'anomalies'
  | 'dashboard'
  | 'help'
  | 'unknown';

export interface NliEntities {
  /** Тикеры, распознанные в запросе (3–5 заглавных букв). */
  tickers: string[];
  /** Категория потребности/интереса (needs/risks/trends/...). */
  category?: string;
  /** Горизонт в днях, если указан («на неделю», «5 дней»). */
  horizonDays?: number;
}

export interface NliParseResult {
  intent: NliIntent;
  /** 0..1 — доля совпавших ключевых слов к порогу. */
  confidence: number;
  entities: NliEntities;
  /** Ключевые слова, по которым распознан интент. */
  matchedKeywords: string[];
}

export interface NliResponse {
  success: boolean;
  intent: NliIntent;
  /** Человеческий ответ (без выдуманных данных). */
  message: string;
  /** Подсказки: чем запрос можно уточнить. */
  suggestions?: string[];
  /** Данные, если интент выполнен (например layout дашборда). */
  data?: unknown;
}
