import { MacroGoals, CurrentAsset, PriceUnit } from '../../data/xlsx-parser/xlsx-parser.js';
import { PortfolioConfig } from '../../../config/portfolio-config.js';

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

/**
 * Генерирует короткое название для актива.
 * Сначала пытается использовать name из Excel, если он не ISIN.
 */
export function generateShortName(asset: CurrentAsset): string {
  const name = asset.name || '';
  const ticker = asset.ticker || '';
  const assetType = asset.assetType || '';

  // Если name не пустой и не ISIN — используем его
  if (name && !name.match(/^RU000/i)) {
    return name;
  }

  // Если name — это ISIN (начинается с RU000) — извлекаем суффикс из ticker
  if (assetType === 'О' || assetType === 'Облигация') {
    const match = ticker.match(/^RU000([A-Z0-9]+)$/i);
    if (match) {
      return match[1]!;
    }
    return ticker;
  }

  // Для всех остальных типов — используем name или ticker
  if (name) {
    return name;
  }

  return ticker;
}

/**
 * Проверяет, является ли актив «Ядром» портфеля (Core).
 * Ядро — это стабильные, ликвидные активы с низкой волатильностью.
 */
export function isCoreAsset(ticker: string): boolean {
  const coreTickers = [
    'SBER', 'GAZP', 'LKOH', 'ROSN', 'VTBR', 'MGNT', 'TATN',
    'ALRS', 'GMKN', 'SNGS', 'FESK', 'MTLR', 'CHMF', 'NLMK',
    'MAGN', 'PHOR', 'RSTI', 'AFLT', 'HYES', 'MOEX', 'SBGB',
    'TCSG', 'BRSB', 'EAST', 'SBERP', 'GAZPM', 'ROSNP', 'VTBRP', 'TATNP',
  ];
  return coreTickers.includes(ticker.toUpperCase());
}

/**
 * Классифицирует актив как «Ядро» (Core) или «Спутник» (Satellite).
 * Ядро — стабильные активы, Спутники — рискованные.
 */
export function classifyAssetRole(asset: CurrentAsset): 'core' | 'satellite' {
  // Облигации — всегда ядро
  if (asset.assetType === 'О' || asset.assetType === 'Облигация') return 'core';

  // Акции/ETF — проверяем по списку core ticker
  if (isCoreAsset(asset.ticker)) return 'core';

  return 'satellite';
}

export interface AssetAnalysis {
  name: string;
  ticker: string;
  /** Короткое название для отображения (из name или сгенерированное из ticker) */
  shortName?: string;
  assetType: string;
  /** Роль актива: «Ядро» (стабильные) или «Спутник» (рискованные) */
  coreRole?: 'core' | 'satellite';
  /** Уровень риска актива (LOW/MEDIUM/HIGH/CRITICAL) — на основе просадки и типа */
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  currentPercent: number;
  targetPercent?: number;
  deficitRub: number;
  status: 'HOLD' | 'BUY' | 'STABLE' | 'REDUCE' | 'NEW' | 'EXIT' | 'NO_TARGET';
  dynamicsPercent: number;
  dailyDynamicsPercent?: number; // Дневная динамика из листа "Акции"
  nkdRub: number;
  /** Купонная ставка в рублях (для облигаций) */
  couponRub?: number;
  nominal: number;
  quantity: number;
  balancePrice: number;
  currentPrice: number;
  /** Единица currentPrice: RUB / PERCENT_OF_NOMINAL / UNKNOWN */
  priceUnit?: PriceUnit;
  /** Статус нормализации currentPrice в RUB: true когда priceUnit !== 'UNKNOWN' */
  priceNormalized?: boolean;
  unrealizedProfitRub: number;
  priority: number;
  isConcentrated: boolean;
  /** Запрет на продажу (например, для защитных позиций) */
  holdOnly?: boolean;
  /** Идентификатор счёта (например, 'S04J3LB' или '403GPBT') */
  accountId?: string;
  /** Расчётный денежный остаток (100% − sum целевых долей) */
  calculatedCashReservePercent?: number;
  /** Расхождение расчётного и фактического кэша в % от портфеля */
  cashDiscrepancy?: number;
  // ─── ИСПРАВЛЕНИЕ Этап 2: диагностика рублёвого дефицита ───
  /** Расчётная база для deficitRub (totalLiquidationValue) */
  deficitCalculationBase?: number;
  /** Процентное отклонение (liquidationPercent - targetPercent) */
  deficitDeviationPct?: number;
  /** Формула расчёта: deficitRub = round((-deviationPct / 100) * calculationBase) */
  deficitFormula?: string;
}

export interface PortfolioReportData {
  macro: MacroGoals;
  assetsAnalysis: AssetAnalysis[];
  freeStocksPoolPercent: number;
  /** Расчётный денежный остаток (100% − sum целевых долей) */
  calculatedCashReservePercent?: number;
  /** Фактический денежный остаток в % от портфеля */
  actualCashPercent?: number;
  /** Расхождение расчётного и фактического кэша */
  cashDiscrepancy?: number;
  // ─── ИСПРАВЛЕНИЕ Этап 2.1: расшифровка расчётной базы ───
  /** Детализация totalLiquidationValue: какие активы включены/исключены */
  calculationBaseBreakdown?: {
    totalLiquidationValue: number;
    includedAssetsCount: number;
    excludedAssetsCount: number;
    includedAssets: Array<{ ticker: string; value: number; reason: string }>;
    excludedAssets: Array<{ ticker: string; value: number; reason: string }>;
  };
  // ─── P4: Мост финансовой сверки ───
  /** Разложение финансовых показателей портфеля */
  financialReconciliation?: {
    /** Текущая стоимость портфеля (liquidation value) */
    totalMarketValue: number;
    /** Суммарный нереализованный P&L */
    totalUnrealizedPnL: number;
    /** Реализованный P&L от исторических сделок */
    realizedPnL: number;
    /** Суммарные купоны */
    totalCoupons: number;
    /** Суммарные дивиденды */
    totalDividends: number;
    /** Суммарные комиссии */
    totalCommissions: number;
    /** Суммарные налоги */
    totalTaxes: number;
    /** Суммарные взносы */
    totalDeposits: number;
    /** Суммарные выводы */
    totalWithdrawals: number;
    /** Чистый вложенный капитал (взносы − выводы) */
    netInvestedCapital: number;
    /** Итоговая формула: marketValue = netInvested + unrealizedPnL + realizedPnL + coupons + dividends − commissions − taxes */
    formula: string;
  };
  // ─── P5: Раскрытие allocationBaseValue ───
  /** Стоимость портфеля, относительно которой рассчитываются проценты и рублёвые отклонения */
  allocationBaseValue?: number;
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
          coreRole: classifyAssetRole(asset),
          currentPercent: asset.liquidationPercent,
          targetPercent: undefined,
          deficitRub: 0,
          status: 'HOLD',
          dynamicsPercent: asset.dynamicsPercent,
          dailyDynamicsPercent: asset.dailyDynamicsPercent,
          nkdRub: asset.nkdRub || 0,
          couponRub: asset.couponRub,
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
          coreRole: classifyAssetRole(asset),
          currentPercent: asset.liquidationPercent,
          targetPercent: undefined,
          deficitRub: 0,
          status: 'NO_TARGET',
          dynamicsPercent: asset.dynamicsPercent,
          dailyDynamicsPercent: asset.dailyDynamicsPercent,
          nkdRub: asset.nkdRub || 0,
          couponRub: asset.couponRub,
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

      // ─── TARGET SET: targetPercent есть в Excel ───
      let status: AssetAnalysis['status'];
      let targetPercent: number | undefined;
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

      // ─── Расчёт уровня риска актива ───
      const riskLevel = calculateRiskLevel(asset, totalLiquidationValue);

      // Если риск HIGH/CRITICAL — принудительно REDUCE (если не holdOnly)
      if (
        (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') &&
        !asset.holdOnly &&
        status !== 'BUY' &&
        status !== 'NEW' &&
        status !== 'EXIT'
      ) {
        status = 'REDUCE';
      }

      // ИСПРАВЛЕНИЕ Этап 2: диагностические поля для рублёвого дефицита
      const deficitCalcBase = totalLiquidationValue;
      // deficitPct: положительный = нужно докупить (BUY), отрицательный = можно продать (REDUCE)
      const deficitPct = targetPercent !== undefined
        ? targetPercent - asset.liquidationPercent
        : 0;
      const deficitFormulaStr = `round((${deficitPct.toFixed(2)} / 100) * ${deficitCalcBase}) = ${deficitRub}`;

      assetsAnalysis.push({
        name: asset.name,
        ticker: asset.ticker,
        shortName: generateShortName(asset),
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
        riskLevel: riskLevel,
        // Диагностика рублёвого дефицита
        deficitCalculationBase: deficitCalcBase,
        deficitDeviationPct: deficitPct,
        deficitFormula: deficitFormulaStr,
      });
    });

    // ─── D0-2: Проверка суммы долей + кэш = 100% ───
    const totalTarget = assetsAnalysis.reduce(
      (sum, a) => sum + (a.targetPercent ?? 0),
      0,
    );
    const cashReserve = 100 - totalTarget;

    // Проверка: сумма целевых долей + кэш = 100% (с учётом округления ±0.1%)
    if (Math.abs(totalTarget + cashReserve - 100) > 0.1) {
      console.warn(
        `[PORTFOLIO-MATH] Сумма целевых долей (${totalTarget.toFixed(2)}%) + кэш (${cashReserve.toFixed(2)}%) ≠ 100%`,
      );
    }

    // ─── D0-3: Разделение расчётный кэш vs фактический кэш ───
    const actualCashPercent =
      totalLiquidationValue > 0
        ? (macro.freeCash / totalLiquidationValue) * 100
        : 0;
    const cashDiscrepancy = cashReserve - actualCashPercent;

    // Если расхождение > 50% от стоимости портфеля → warning (не в тестовом режиме)
    if (Math.abs(cashDiscrepancy) > 50 && typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
      console.warn(
        `[PORTFOLIO-MATH] Расхождение кэша: расчётный=${cashReserve.toFixed(2)}%, ` +
        `фактический=${actualCashPercent.toFixed(2)}%, ` +
        `расхождение=${cashDiscrepancy.toFixed(2)}%`,
      );
    }

    // Добавляем кэш-информацию в последний актив (для совместимости с отчётами)
    // Если активов нет — добавляем заглушку в отчёт
    // В большинстве случаев последний актив — самый крупный дефицит
    // Но лучше передать информацию на уровень выше через PortfolioReportData

    // ─── ИСПРАВЛЕНИЕ Этап 2.1: расчёт breakdown totalLiquidationValue ───
    const breakdown: {
      totalLiquidationValue: number;
      includedAssetsCount: number;
      excludedAssetsCount: number;
      includedAssets: Array<{ ticker: string; value: number; reason: string }>;
      excludedAssets: Array<{ ticker: string; value: number; reason: string }>;
    } = {
      totalLiquidationValue,
      includedAssetsCount: 0,
      excludedAssetsCount: 0,
      includedAssets: [],
      excludedAssets: [],
    };

    for (const asset of assets) {
      const value = (asset.quantity ?? 0) * (asset.currentPrice ?? 0);
      const nameUpper = asset.name.toUpperCase();
      let excluded = false;
      let reason = '';

      // Исключения:
      if (nameUpper.includes('ИТОГО') || nameUpper.includes('БАЛАНС') || !isNaN(Number(asset.name))) {
        reason = 'Суммарная строка Excel (ИТОГО/БАЛАНС)';
        excluded = true;
      } else if (asset.targetPercent === undefined && asset.targetPercentConflict) {
        reason = 'Конфликт целевой доли — исключён';
        excluded = true;
      } else if (asset.targetPercent === 0 && asset.liquidationPercent === 0) {
        reason = 'Целевая 0 и текущая 0 — нет позиции';
        excluded = true;
      }

      if (excluded) {
        breakdown.excludedAssets.push({ ticker: asset.ticker, value, reason });
      } else {
        breakdown.includedAssets.push({ ticker: asset.ticker, value, reason: 'Включён в расчёт' });
      }
    }

    breakdown.includedAssetsCount = breakdown.includedAssets.length;
    breakdown.excludedAssetsCount = breakdown.excludedAssets.length;

    const calculationBaseBreakdown = breakdown;

    // ─── P4: Мост финансовой сверки ───
    const totalUnrealizedPnL = assetsAnalysis.reduce(
      (sum, a) => sum + (a.unrealizedProfitRub ?? 0),
      0,
    );

    // ─── P5: Раскрытие allocationBaseValue ───
    // allocationBaseValue = totalLiquidationValue — это стоимость портфеля,
    // относительно которой рассчитываются проценты и рублёвые отклонения.
    const allocationBaseValue = totalLiquidationValue;

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

    // ─── P6: Агрегация дефицитов по классам активов ───
    const stocksDeficitRub = assetsAnalysis
      .filter(a => a.assetType === 'stocks')
      .reduce((sum, a) => sum + a.deficitRub, 0);
    const bondsDeficitRub = assetsAnalysis
      .filter(a => a.assetType === 'bonds')
      .reduce((sum, a) => sum + a.deficitRub, 0);
    macro.stocksDeficitRub = stocksDeficitRub;
    macro.bondsDeficitRub = bondsDeficitRub;

    return {
      macro,
      assetsAnalysis,
      freeStocksPoolPercent,
      calculatedCashReservePercent: cashReserve,
      actualCashPercent,
      cashDiscrepancy,
      calculationBaseBreakdown,
      // ─── P4: Мост финансовой сверки ───
      financialReconciliation: {
        totalMarketValue: totalLiquidationValue,
        totalUnrealizedPnL,
        realizedPnL: 0, // Заполняется из historicalTrades на уровне AI Client
        totalCoupons: 0, // Заполняется из данных по облигациям
        totalDividends: 0, // Заполняется из данных по акциям
        totalCommissions: 0, // Заполняется из historicalTrades
        totalTaxes: 0, // Заполняется из historicalTrades
        totalDeposits: 0, // Заполняется из investedFunds
        totalWithdrawals: 0, // Заполняется из investedFunds
        netInvestedCapital: 0, // Заполняется из investedFunds
        formula: 'marketValue = netInvestedCapital + unrealizedPnL + realizedPnL + coupons + dividends − commissions − taxes',
      },
      // ─── P5: Раскрытие allocationBaseValue ───
      allocationBaseValue,
    };
  }
}

/**
 * Рассчитывает уровень риска актива на основе просадки и типа.
 *
 * Критерии:
 * - CRITICAL: просадка > 60% (крайний риск)
 * - HIGH: просадка > 30% или акция-спутник с просадкой > 20%
 * - MEDIUM: просадка > 10% или акция-спутник
 * - LOW: стабильный актив (облигация, ядро, малая просадка)
 */
export function calculateRiskLevel(
  asset: CurrentAsset,
  _totalValue: number,
): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  const drawdownPct = asset.dynamicsPercent ?? 0;

  // CRITICAL: экстремальная просадка
  if (drawdownPct < -60) return 'CRITICAL';

  // HIGH: глубокая просадка или спутник с просадкой > 20%
  if (drawdownPct < -30) return 'HIGH';
  if (classifyAssetRole(asset) === 'satellite' && drawdownPct < -20) return 'HIGH';

  // MEDIUM: умеренная просадка или спутник
  if (drawdownPct < -10) return 'MEDIUM';
  if (classifyAssetRole(asset) === 'satellite') return 'MEDIUM';

  // LOW: стабильный актив (облигация, ядро, малая просадка)
  return 'LOW';
}
