import { MacroGoals, CurrentAsset, PriceUnit } from '../xlsx-parser/xlsx-parser.js';
import { PortfolioConfig } from '../../config/portfolio-config.js';

// ============================================================================
// Классификатор типов активов
// ============================================================================

/**
 * Определяет класс актива (STOCK / BOND / ETF / CASH / OTHER)
 * на основе assetType из Excel и дополнительных признаков.
 */
export function classifyAsset(asset: CurrentAsset): 'STOCK' | 'BOND' | 'ETF' | 'CASH' | 'OTHER' {
  const type = (asset.assetType || '').toUpperCase().trim();

  // Акции
  if (type === 'А' || type === 'АКЦИЯ' || type === 'STOCK') {
    return 'STOCK';
  }

  // Облигации
  if (type === 'О' || type === 'ОБЛИГАЦИЯ' || type === 'BOND') {
    return 'BOND';
  }

  // Фонды/ETF
  if (type === 'Ф' || type === 'ETF' || type === 'FUND' || type.includes('ФОНД') || type.includes('ETF')) {
    return 'ETF';
  }

  // Деньги (свободный остаток)
  if (type === 'Д' || type === 'ДЕНЬГИ' || type === 'CASH' || type === 'ВАЛЮТА') {
    return 'CASH';
  }

  // По умолчанию — OTHER (не учитывается в расчётах классов)
  return 'OTHER';
}

/**
 * Является ли актив акцией для целей расчёта stock pool.
 */
export function isStockAsset(asset: CurrentAsset): boolean {
  return classifyAsset(asset) === 'STOCK';
}

/**
 * Является ли актив облигацией для целей расчёта bond pool.
 */
export function isBondAsset(asset: CurrentAsset): boolean {
  return classifyAsset(asset) === 'BOND';
}

export interface AssetAnalysis {
  name: string;
  ticker: string;
  assetType: string;
  currentPercent: number;
  targetPercent?: number;
  deficitRub: number;
  status: 'HOLD' | 'BUY' | 'STABLE' | 'REDUCE' | 'NEW' | 'EXIT' | 'NO_TARGET';
  dynamicsPercent: number;
  dailyDynamicsPercent?: number; // Дневная динамика из листа "Акции"
  nkdRub: number;
  nominal: number;
  quantity: number;
  balancePrice: number;
  currentPrice: number;
  /** Единица currentPrice: RUB / PERCENT_OF_NOMINAL / UNKNOWN */
  priceUnit?: PriceUnit;
  unrealizedProfitRub: number;
  priority: number;
  isConcentrated: boolean;
  /** Запрет на продажу (например, для защитных позиций) */
  holdOnly?: boolean;
  /** Идентификатор счёта (например, 'S04J3LB' или '403GPBT') */
  accountId?: string;
}

export interface PortfolioReportData {
  macro: MacroGoals;
  assetsAnalysis: AssetAnalysis[];
  freeStocksPoolPercent: number;
}

export class PortfolioMathModule {
  public analyzePortfolio(
    macro: MacroGoals,
    assets: CurrentAsset[],
    totalLiquidationValue: number,
  ): PortfolioReportData {
    const assetsAnalysis: AssetAnalysis[] = [];

    // ─── Расчёт allocatedStocksPercent и allocatedBondsPercent ───
    // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: учитываем ТОЛЬКО активы соответствующего класса.
    // Фонды, деньги и другие активы НЕ попадают в stock/bond pool.
    let allocatedStocksPercent = 0;
    let allocatedBondsPercent = 0;

    assets.forEach((asset) => {
      // Пропускаем активы с excludeFromStockPool или holdOnly
      if (asset.holdOnly || asset.excludeFromStockPool) return;

      // Пропускаем активы без целевой доли или с targetPercent=0
      if (asset.targetPercent === undefined || asset.targetPercent <= 0) return;

      // Классифицируем актив и учитываем ТОЛЬКО соответствующий класс
      const assetClass = classifyAsset(asset);

      if (assetClass === 'STOCK') {
        allocatedStocksPercent += asset.targetPercent;
      } else if (assetClass === 'BOND') {
        allocatedBondsPercent += asset.targetPercent;
      }
      // ETF, CASH, OTHER — НЕ учитываем в stock/bond pool
    });

    // Валидация: если сумма целевых долей акций превышает макроцель — предупреждаем
    if (allocatedStocksPercent > macro.stocksPercent) {
      console.warn(
        `⚠️ [VALIDATION] Сумма целевых долей акций (${allocatedStocksPercent.toFixed(2)}%) ` +
        `превышает макроцель (${macro.stocksPercent}%). ` +
        `Избыток: ${(allocatedStocksPercent - macro.stocksPercent).toFixed(2)}%. ` +
        'Проверьте целевые доли в Excel.',
      );
    }

    if (allocatedBondsPercent > macro.bondsPercent) {
      console.warn(
        `⚠️ [VALIDATION] Сумма целевых долей облигаций (${allocatedBondsPercent.toFixed(2)}%) ` +
        `превышает макроцель (${macro.bondsPercent}%). ` +
        `Избыток: ${(allocatedBondsPercent - macro.bondsPercent).toFixed(2)}%. ` +
        'Проверьте целевые доли в Excel.',
      );
    }

    const freeStocksPoolPercent = Math.max(
      0,
      macro.stocksPercent - allocatedStocksPercent,
    );

    const { buyDeviationPct, reduceDeviationPct, concentrationLimitPct } =
      PortfolioConfig.rebalance;

    assets.forEach((asset) => {
      const nameUpper = asset.name.toUpperCase();
      if (
        nameUpper.includes('ИТОГО') ||
        nameUpper.includes('БАЛАНС') ||
        !isNaN(Number(asset.name))
      ) {
        return;
      }

      // ─── Логика статусов на основе targetPercent и liquidationPercent ───

      // Предохранитель: при конфликте target — НЕ принимаем решение
      if (asset.targetPercentConflict) {
        assetsAnalysis.push({
          name: asset.name,
          ticker: asset.ticker,
          assetType: asset.assetType,
          currentPercent: asset.liquidationPercent,
          targetPercent: undefined,
          deficitRub: 0,
          status: 'HOLD',
          dynamicsPercent: asset.dynamicsPercent,
          dailyDynamicsPercent: asset.dailyDynamicsPercent,
          nkdRub: asset.nkdRub || 0,
          nominal: asset.nominal ?? 0,
          quantity: asset.quantity || 0,
          balancePrice: asset.balancePrice ?? 0,
          currentPrice: asset.currentPrice ?? 0,
          priceUnit: asset.priceUnit,
          unrealizedProfitRub: asset.unrealizedProfitRub || 0,
          priority: 0,
          isConcentrated: asset.liquidationPercent > concentrationLimitPct,
        });
        return;
      }

      // ─── TARGET_NOT_SET: targetPercent отсутствует в Excel ───
      if (asset.targetPercent === undefined) {
        assetsAnalysis.push({
          name: asset.name,
          ticker: asset.ticker,
          assetType: asset.assetType,
          currentPercent: asset.liquidationPercent,
          targetPercent: undefined,
          deficitRub: 0,
          status: 'NO_TARGET',
          dynamicsPercent: asset.dynamicsPercent,
          dailyDynamicsPercent: asset.dailyDynamicsPercent,
          nkdRub: asset.nkdRub || 0,
          nominal: asset.nominal ?? 0,
          quantity: asset.quantity || 0,
          balancePrice: asset.balancePrice ?? 0,
          currentPrice: asset.currentPrice ?? 0,
          priceUnit: asset.priceUnit,
          unrealizedProfitRub: asset.unrealizedProfitRub || 0,
          priority: 0,
          isConcentrated: asset.liquidationPercent > concentrationLimitPct,
        });
        return;
      }

      let targetPercent: number;
      let status: 'HOLD' | 'BUY' | 'STABLE' | 'REDUCE' | 'NEW' | 'EXIT';
      let deficitRub: number;

      // ─── КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: holdOnly проверяется ДО присвоения EXIT/REDUCE/SELL ───
      // Если позиция запрещена к продаже, мы НЕ можем продать/уменьшить её,
      // даже если targetPercent=0 или есть перебор.
      if (asset.holdOnly && asset.liquidationPercent > 0) {
        // HoldOnly: позиция запрещена к продаже → принудительный HOLD
        // Но логируем конфликт, если targetPercent=0
        if (asset.targetPercent === 0) {
          console.warn(
            `⚠️ [HOLD_ONLY_CONFLICT] ${asset.ticker}: ` +
            'holdOnly=true, но targetPercent=0 (EXIT). ' +
            'Принудительный HOLD — продажа запрещена политикой инвестора.',
          );
        }
        status = 'HOLD';
        targetPercent = asset.targetPercent ?? asset.liquidationPercent;
        deficitRub = 0;
      } else if (asset.targetPercent === 0 && asset.liquidationPercent > 0) {
        // Целевая доля 0, но актив есть в портфеле → плановый выход
        // (holdOnly уже проверен выше)
        status = 'EXIT';
        targetPercent = 0;
        deficitRub = Math.round(
          (asset.liquidationPercent / 100) * totalLiquidationValue,
        );
      } else if (asset.targetPercent === 0 && asset.liquidationPercent === 0) {
        // Целевая 0 и текущая 0 → пропускаем (нет позиции)
        return;
      } else if (asset.targetPercent > 0 && asset.liquidationPercent === 0) {
        // Целевая есть, но позиции нет → новый актив
        status = 'NEW';
        targetPercent = asset.targetPercent;
        deficitRub = Math.round((targetPercent / 100) * totalLiquidationValue);
      } else {
        // Оба значения > 0 → считаем отклонение
        targetPercent = asset.targetPercent;
        // deviationPct: положительный → перебор (REDUCE), отрицательный → дефицит (BUY)
        const deviationPct = asset.liquidationPercent - targetPercent;
        // deficitRub: положительный = нужно докупить, отрицательный = можно продать
        deficitRub = Math.round((-deviationPct / 100) * totalLiquidationValue);

        // Защитный HOLD: позиция запрещена к продаже
        if (asset.holdOnly) {
          status = 'HOLD';
        } else if (deviationPct < -buyDeviationPct) {
          status = 'BUY';
        } else if (deviationPct > reduceDeviationPct) {
          status = 'REDUCE';
        } else {
          status = 'STABLE';
        }
      }

      // Используем реальные цены из Excel, если они есть
      const balancePrice = asset.balancePrice ?? 0;
      const currentPrice = asset.currentPrice ?? 0;

      // Проверяем концентрацию (позиция > X% — риск)
      const isConcentrated = asset.liquidationPercent > concentrationLimitPct;

      assetsAnalysis.push({
        name: asset.name,
        ticker: asset.ticker,
        assetType: asset.assetType,
        currentPercent: asset.liquidationPercent,
        targetPercent: targetPercent,
        deficitRub: deficitRub,
        status: status,
        dynamicsPercent: asset.dynamicsPercent,
        dailyDynamicsPercent: asset.dailyDynamicsPercent,
        nkdRub: asset.nkdRub || 0,
        nominal: asset.nominal ?? 0,
        quantity: asset.quantity || 0,
        balancePrice: balancePrice,
        currentPrice: currentPrice,
        priceUnit: asset.priceUnit,
        unrealizedProfitRub: asset.unrealizedProfitRub || 0,
        priority: deficitRub,
        isConcentrated: isConcentrated,
      });
    });

    // Сортируем по приоритету покупок (больший дефицит = выше приоритет)
    assetsAnalysis.sort((a, b) => b.deficitRub - a.deficitRub);

    // Валидация: сумма долей не может превышать 100%
    const totalPercent = assetsAnalysis.reduce(
      (sum, a) => sum + a.currentPercent,
      0,
    );
    if (totalPercent > 100.01) {
      console.warn(
        '⚠️ [VALIDATION] Сумма долей активов: ' +
          totalPercent.toFixed(1) +
          '% (должно быть ≤ 100%). Проверьте данные в Excel.',
      );
    }

    return {
      macro,
      assetsAnalysis,
      freeStocksPoolPercent,
    };
  }
}
