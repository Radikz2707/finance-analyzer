/**
 * Единый конфигурационный объект для всех модулей проекта.
 * Содержит все вынесенные из бизнес-логики числовые значения, пороги и маппинги.
 */

export const PortfolioConfig = {
  /** Пороги статусов ребалансировки */
  rebalance: {
    buyDeviationPct: 2,
    reduceDeviationPct: 3,
    concentrationLimitPct: 20,
    singleAssetLimitPct: 20,
  } as const,

  /** Параметры автоматического распределения целевых долей */
  autoTarget: {
    defaultStockCount: 8,
    defaultBondCount: 6,
    fundDefaultPct: 3,
    minTargetPct: 1,
  } as const,

  /** Налоговые ставки */
  tax: {
    dividendNdflRate: 0.13,
  } as const,

  /** Пороги макроэкономических условий для fallback-отчётов */
  macroThresholds: {
    highCbrRate: 18,
    mediumCbrRate: 12,
    lowDivYieldThreshold: 5,
    highDivYieldThreshold: 10,
  } as const,

  /** Маппинг идентификаторов счетов на типы */
  accountTypeMapping: {
    S04J3LB: 'IIS',
    '403GPBT': 'BROKER',
  } as const,

  /** Параметры YandexGPT */
  yandexGpt: {
    modelUri: 'gpt://d4ece1grc8m9rnbpj0l8/yandexgpt-lite',
  } as const,
} as const;
