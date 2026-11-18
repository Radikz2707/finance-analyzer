/**
 * Strategy validator — проверка консистентности шагов инвестиционных стратегий.
 *
 * Шаги строятся детерминированно из PortfolioMath (дефицит/профицит доли),
 * а не из текстового направления AI-карточки. Поэтому и проверяются они
 * против PortfolioMath:
 *  1. покупка разрешена только при дефиците (deficitRub > 0) и отклонении
 *     больше 0,5 п.п.; запрещена при профиците, статусе REDUCE/EXIT и
 *     отклонении ≤ 0,5 п.п.;
 *  2. продажа разрешена только при профиците и статусе REDUCE/EXIT;
 *  3. продажа актива, запрещённая пользовательской политикой (no-sell);
 *  4. формулировка о «профите» для позиции с реальным убытком.
 *
 * Любое нарушение помечается кодом STRATEGY_CONFLICT и логируется.
 * Модуль не зависит от DOM/сети — чистые вычисления.
 */

import type { AssetAnalysis } from '../../../portfolio/portfolio-math/portfolio-math.js';
import type { AiAction } from '../../../research/types.js';
import type {
  InvestmentStrategy,
  StrategistDecision,
} from './strategist-agent.js';

/** Пользовательская политика, влияющая на допустимость продаж. */
export interface StrategyValidationPolicy {
  /** Тикеры, которые запрещено продавать. */
  noSellTickers?: string[];
  /** Типы активов, которые запрещено продавать (например, облигации). */
  noSellAssetTypes?: string[];
}

/** Один конфликт шага стратегии. */
export interface StrategyConflict {
  code: 'STRATEGY_CONFLICT';
  strategyName: string;
  stepOrder: number;
  ticker: string;
  reason: string;
}

const BOND_TYPE_ALIASES = new Set(['О', 'ОБЛИГАЦИЯ', 'BOND', 'BONDS']);
const STOCK_TYPE_ALIASES = new Set(['А', 'АКЦИЯ', 'STOCK', 'STOCKS']);

/** Является ли тип актива облигационным. */
export function isBondAssetType(assetType: string | undefined): boolean {
  return BOND_TYPE_ALIASES.has((assetType ?? '').trim().toUpperCase());
}

/** Является ли тип актива акционерным. */
export function isStockAssetType(assetType: string | undefined): boolean {
  return STOCK_TYPE_ALIASES.has((assetType ?? '').trim().toUpperCase());
}

function normalizeTicker(ticker: string | undefined): string {
  return (ticker ?? '').trim().toUpperCase();
}

/** Минимальное отклонение доли, п.п., при котором сделка имеет смысл. */
export const MIN_DEVIATION_PP = 0.5;

/**
 * Знаковое отклонение доли от целевой, п.п.
 *
 * Приоритет — `deficitDeviationPct` из PortfolioMath (текущая − целевая).
 * Если поле не рассчитано, используется `currentPercent − targetPercent`.
 */
export function resolveSignedDeviationPp(asset: AssetAnalysis): number {
  const value = asset.deficitDeviationPct;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const target = asset.targetPercent;
  if (typeof target !== 'number' || !Number.isFinite(target)) {
    return 0;
  }
  return asset.currentPercent - target;
}

/** Отклонение для покупки (дефицит доли), п.п. ≥ 0. */
export function buyDeviationPp(asset: AssetAnalysis): number {
  return Math.max(0, -resolveSignedDeviationPp(asset));
}

/** Отклонение для продажи (профицит доли), п.п. ≥ 0. */
export function sellDeviationPp(asset: AssetAnalysis): number {
  return Math.max(0, resolveSignedDeviationPp(asset));
}

/** PortfolioMath сигнализирует сокращение позиции. */
function isMathSellDirection(asset: AssetAnalysis): boolean {
  return asset.status === 'REDUCE' || asset.status === 'EXIT';
}

/**
 * Покупка разрешена PortfolioMath: есть дефицит и отклонение > 0,5 п.п.,
 * а статус не требует сокращения позиции.
 */
export function isBuyAllowedByMath(asset: AssetAnalysis): boolean {
  if (isMathSellDirection(asset)) {
    return false;
  }
  // NEW-бумаги (например, ОФЗ) могут иметь отклонение ровно 0.5 п.п.
  // или не иметь targetPercent, но при положительном дефиците они
  // участвуют в приведении портфеля к целям.
  if (asset.status === 'NEW' && asset.deficitRub > 0) {
    return true;
  }
  return asset.deficitRub > 0 && buyDeviationPp(asset) > MIN_DEVIATION_PP;
}

/**
 * Продажа разрешена PortfolioMath: есть профицит (или EXIT) и статус
 * REDUCE/EXIT. Политика no-sell проверяется отдельно.
 */
export function isSellAllowedByMath(asset: AssetAnalysis): boolean {
  if (!isMathSellDirection(asset)) {
    return false;
  }
  if (asset.status === 'EXIT') {
    return Math.abs(asset.deficitRub) > 0 || asset.currentPercent > 0;
  }
  return asset.deficitRub < 0;
}

function isSellStep(action: string): boolean {
  return /^(продать|частично продать|сократить|выйти)/i.test(
    (action ?? '').trim(),
  );
}

function isBuyStep(action: string): boolean {
  return /^(купить|докупить|нарастить)/i.test((action ?? '').trim());
}

/** Действие карточки: приоритет — финальное действие стратега, иначе статус математики. */
export function resolveCardAction(
  asset: AssetAnalysis,
  decision?: StrategistDecision | null,
): AiAction | null {
  if (decision) {
    return decision.finalAction;
  }

  switch (asset.status) {
    case 'BUY':
    case 'NEW':
      return 'BUY';
    case 'REDUCE':
      return 'REDUCE';
    case 'EXIT':
      return 'EXIT';
    default:
      return 'HOLD';
  }
}

/** Разрешена ли продажа актива пользовательской политикой. */
export function isSellAllowedByPolicy(
  asset: AssetAnalysis,
  policy?: StrategyValidationPolicy,
): boolean {
  if (asset.holdOnly) {
    return false;
  }

  const ticker = normalizeTicker(asset.ticker);
  const noSellTickers = new Set(
    (policy?.noSellTickers ?? []).map((value) => normalizeTicker(value)),
  );
  if (noSellTickers.has(ticker)) {
    return false;
  }

  const assetType = (asset.assetType ?? '').trim().toUpperCase();
  const noSellAssetTypes = new Set(
    (policy?.noSellAssetTypes ?? []).map((value) =>
      (value ?? '').trim().toUpperCase(),
    ),
  );

  if (noSellAssetTypes.has(assetType)) {
    return false;
  }

  // Синонимы типов: «О» / «Облигация» / «BOND»; «А» / «Акция» / «STOCK».
  if (isBondAssetType(assetType)) {
    if (
      noSellAssetTypes.has('О') ||
      noSellAssetTypes.has('ОБЛИГАЦИЯ') ||
      noSellAssetTypes.has('BOND') ||
      noSellAssetTypes.has('BONDS')
    ) {
      return false;
    }
  }
  if (isStockAssetType(assetType)) {
    if (
      noSellAssetTypes.has('А') ||
      noSellAssetTypes.has('АКЦИЯ') ||
      noSellAssetTypes.has('STOCK') ||
      noSellAssetTypes.has('STOCKS')
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Проверить стратегии на конфликты с карточками и пользовательской политикой.
 *
 * Возвращает список конфликтов; каждый конфликт логируется в консоль
 * с префиксом `[STRATEGY_CONFLICT]`, чтобы попадать в журнал прогона.
 */
export function validateStrategyConsistency(
  strategies: InvestmentStrategy[],
  decisions: StrategistDecision[],
  assetsAnalysis: AssetAnalysis[],
  policy?: StrategyValidationPolicy,
): StrategyConflict[] {
  const conflicts: StrategyConflict[] = [];

  const decisionByTicker = new Map<string, StrategistDecision>();
  for (const decision of decisions) {
    decisionByTicker.set(normalizeTicker(decision.ticker), decision);
  }

  const assetByTicker = new Map<string, AssetAnalysis>();
  for (const asset of assetsAnalysis) {
    assetByTicker.set(normalizeTicker(asset.ticker), asset);
  }

  const addConflict = (
    strategy: InvestmentStrategy,
    stepOrder: number,
    ticker: string,
    reason: string,
  ): void => {
    const conflict: StrategyConflict = {
      code: 'STRATEGY_CONFLICT',
      strategyName: strategy.name,
      stepOrder,
      ticker,
      reason,
    };
    conflicts.push(conflict);
    console.warn(
      `[STRATEGY_CONFLICT] ${strategy.name}, шаг ${stepOrder}, ${ticker}: ${reason}`,
    );
  };

  for (const strategy of strategies) {
    for (const step of strategy.steps) {
      const ticker = normalizeTicker(step.ticker);
      const asset = assetByTicker.get(ticker);
      if (!asset) {
        continue;
      }

      const decision = decisionByTicker.get(ticker) ?? null;
      const sell = isSellStep(step.action);
      const buy = isBuyStep(step.action);

      // Покупка проверяется по PortfolioMath, а не по направлению AI-карточки:
      // AI может советовать HOLD, но математика портфеля показывает дефицит.
      if (buy && !isBuyAllowedByMath(asset)) {
        let reason: string;
        if (isMathSellDirection(asset)) {
          reason = `покупка при PortfolioMath=${asset.status}`;
        } else if (asset.deficitRub <= 0) {
          reason = `покупка при отсутствии дефицита (PortfolioMath=${asset.status}, deficitRub=${Math.round(asset.deficitRub)})`;
        } else {
          reason =
            `покупка при отклонении ${buyDeviationPp(asset).toFixed(1).replace('.', ',')} п.п. ` +
            `≤ ${MIN_DEVIATION_PP.toFixed(1).replace('.', ',')} п.п.`;
        }
        addConflict(strategy, step.order, ticker, reason);
      }

      if (sell && !isSellAllowedByMath(asset)) {
        const reason = isMathSellDirection(asset)
          ? `продажа при отсутствии профицита (PortfolioMath=${asset.status})`
          : `продажа при PortfolioMath=${asset.status} — требуется REDUCE/EXIT`;
        addConflict(strategy, step.order, ticker, reason);
      }

      if (sell && !isSellAllowedByPolicy(asset, policy)) {
        addConflict(
          strategy,
          step.order,
          ticker,
          'продажа запрещена пользовательской политикой (no-sell)',
        );
      }

      const stepText = `${step.amount} ${step.rationale}`;
      const mentionsProfit = /профит|прибыл/i.test(stepText);
      const hasRealLoss =
        (asset.unrealizedProfitRub ?? 0) < 0 ||
        (decision?.drawdownPercent != null && decision.drawdownPercent < 0) ||
        (asset.balancePrice > 0 &&
          asset.currentPrice > 0 &&
          asset.currentPrice < asset.balancePrice);

      if (mentionsProfit && hasRealLoss) {
        addConflict(
          strategy,
          step.order,
          ticker,
          'формулировка о «профите» при реальном убытке позиции',
        );
      }
    }
  }

  return conflicts;
}
