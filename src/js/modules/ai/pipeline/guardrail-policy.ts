/**
 * GuardrailPolicy — политика защитных ограничений для торговых операций.
 *
 * Ключевые принципы:
 * - Нет жёстких запретов на продажу (holdOnly удалён)
 * - Порог убытка настраивается через уровень риска
 * - Продажа в убыток > порога требует ручного подтверждения
 * - AI получает контекст о рисках и сам принимает решение
 *
 * Уровни риска:
 * - conservative: 15% — для новичков, защитный режим
 * - moderate: 25% — баланс между защитой и гибкостью (по умолчанию)
 * - aggressive: 40%+ — для опытных, готовых терпеть просадки
 */

export type RiskLevel = 'conservative' | 'moderate' | 'aggressive';

/** Конфигурация guardrail-политики */
export interface GuardrailPolicy {
  /** Уровень риска (влияет на lossThresholdPct) */
  riskLevel: RiskLevel;

  /** Базовый порог убытка для продажи (%) */
  lossThresholdPct: number;

  /**
   * Индивидуальные пороги для конкретных тикеров.
   * Перезаписывают базовый порог.
   */
  customThresholds: Record<string, number>;

  /** Требовать ручное подтверждение при продаже в убыток > порога */
  requireManualConfirm: boolean;

  /** Требовать обоснование от AI при продаже в убыток */
  requireRationale: boolean;

  /** Максимальный допустимый убыток на одну позицию (%) */
  maxSingleLossPct: number;

  /** Максимальный совокупный убыток по портфелю (%) */
  maxTotalLossPct: number;
}

/** Дефолтные значения для каждого уровня риска */
const RISK_LEVEL_CONFIG: Record<RiskLevel, Omit<GuardrailPolicy, 'customThresholds'>> = {
  conservative: {
    riskLevel: 'conservative',
    lossThresholdPct: 15,
    requireManualConfirm: true,
    requireRationale: true,
    maxSingleLossPct: 20,
    maxTotalLossPct: 30,
  },
  moderate: {
    riskLevel: 'moderate',
    lossThresholdPct: 25,
    requireManualConfirm: true,
    requireRationale: true,
    maxSingleLossPct: 35,
    maxTotalLossPct: 50,
  },
  aggressive: {
    riskLevel: 'aggressive',
    lossThresholdPct: 40,
    requireManualConfirm: true,
    requireRationale: true,
    maxSingleLossPct: 60,
    maxTotalLossPct: 75,
  },
};

/**
 * Создать guardrail-политику с пользовательскими порогами.
 */
export function createGuardrailPolicy(
  riskLevel: RiskLevel = 'moderate',
  customThresholds: Record<string, number> = {},
): GuardrailPolicy {
  const base = RISK_LEVEL_CONFIG[riskLevel];
  return {
    ...base,
    customThresholds,
  };
}

/**
 * Получить порог убытка для конкретного тикера.
 */
export function getLossThreshold(
  policy: GuardrailPolicy,
  ticker: string,
): number {
  const upperTicker = ticker.toUpperCase();
  return policy.customThresholds[upperTicker] ?? policy.lossThresholdPct;
}

/**
 * Проверить, требует ли операция ручного подтверждения.
 */
export function requiresManualConfirmation(
  policy: GuardrailPolicy,
  ticker: string,
  lossPct: number,
): boolean {
  if (!policy.requireManualConfirm) return false;

  const threshold = getLossThreshold(policy, ticker);
  return lossPct < -threshold; // отрицательное значение = убыток
}
