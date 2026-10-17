/**
 * Типы для Natural Language Parser Director Agent.
 *
 * Вынесены из nl-parser.ts для уменьшения размера основного файла
 * и улучшения модульности.
 *
 * @module pipeline/director/nl-parser-types
 */

/** Извлечённая поправка: тикер (если найден) и корректный процент */
export interface UserCorrection {
  /** Тикер, к которому относится поправка (null — применить к последнему) */
  ticker: string | null;
  /** Корректная доля актива, % */
  currentPercent: number;
}
