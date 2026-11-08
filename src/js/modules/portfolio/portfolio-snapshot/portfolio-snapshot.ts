/**
 * Единый детерминированный снимок портфеля для передачи в AI.
 *
 * Источник данных: parseAggregatedPortfolio() → AggregatedAsset[] → PortfolioSnapshot
 * Не используется обратное схлопывание через accountId = "A,B".
 *
 * Pipeline:
 *   Excel → account positions → parseAggregatedPortfolio() → AggregatedAsset[]
 *   → buildPortfolioSnapshot() → PortfolioSnapshot → AI context → Ollama
 */

// ─── Утилиты ─────────────────────────────────────────────────────────────────

/**
 * Безопасный парсинг булева значения из Excel.
 * Поддерживает: true/false, 1/0, TRUE/FALSE, да/нет, yes/no
 */
export function parseBooleanValue(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val === 1;
  if (typeof val !== 'string') return false;

  const normalized = val.trim().toLowerCase();

  const trueValues = ['true', '1', 'да', 'yes', 'y'];
  const falseValues = ['false', '0', 'нет', 'no', 'n'];

  if (trueValues.includes(normalized)) return true;
  if (falseValues.includes(normalized)) return false;

  return false;
}

// ─── Интерфейсы ──────────────────────────────────────────────────────────────

/** Финансовые метрики портфеля */
export interface FinancialSnapshot {
  /** Текущая рыночная стоимость портфеля */
  currentAssets: number;
  /** Свободные средства (кэш) */
  freeCash: number;
  /** Лично внесённые средства */
  contributedCapital: number;
  /** Дефицит/профицит долевой позиции в рублях */
  currentEquityGap: number;
  /** Дефицит/профицит долевой позиции в процентах */
  currentEquityGapPct: number;
  /** Исторический результат (прибыль/убыток с начала учёта) */
  historicalMarketResult: number;
  /** Метка времени снимка */
  snapshotTimestamp: string;
}

/** Информация о счёте */
export interface AccountSnapshot {
  accountId: string;
  accountType: 'IIS' | 'BROKER' | string;
  totalLiquidationValue: number;
  freeCash?: number;
}

/** Позиция на конкретном счёте */
export interface AssetAccountSnapshot {
  accountId: string;
  accountType: string;
  quantity: number;
  balanceValue: number;
  liquidationValue: number;
  liquidationWeightPct: number;
  targetWeightPct?: number;
  holdOnly: boolean;
  excludeFromStockPool: boolean;
}

/** Агрегированная позиция по тикеру */
export interface AssetSnapshot {
  ticker: string;
  name?: string;

  balanceValue: number;
  liquidationValue: number;

  liquidationWeightPct: number;
  targetWeightPct?: number;
  deviationPct?: number;

  status?: string;

  holdOnly: boolean;
  excludeFromStockPool: boolean;
  targetPercentConflict: boolean;
  /** true если targetWeightPct === undefined (target не указан в Excel) */
  targetNotSet: boolean;

  accounts: AssetAccountSnapshot[];
}

/** Полный снимок портфеля для AI */
export interface PortfolioSnapshot {
  financial: FinancialSnapshot;

  totalLiquidationValue: number;
  totalBalanceValue: number;

  accounts: AccountSnapshot[];
  assets: AssetSnapshot[];
}

/** Внутренний тип для агрегированного актива (дублирует AggregatedAsset из xlsx-parser) */
export interface InternalAggregatedAsset {
  ticker: string;
  name: string;
  assetType: string;
  totalLiquidationValue: number;
  totalLiquidationPercent: number;
  totalBalancePercent: number;
  targetPercent?: number;
  totalQuantity: number;
  balancePrice: number;
  currentPrice: number;
  totalUnrealizedProfitRub: number;
  dynamicsPercent: number;
  dailyDynamicsPercent?: number;
  nkdRub?: number;
   nominal?: number;
   holdOnly?: boolean;
   excludeFromStockPool?: boolean;
   targetPercentConflict?: boolean;
   accounts: Array<{
     accountId: string;
     accountType: 'IIS' | 'BROKER';
     liquidationValue: number;
     liquidationPercent: number;
     balancePercent: number;
     targetPercent?: number;
     quantity: number;
     balancePrice: number;
     currentPrice: number;
     unrealizedProfitRub: number;
     dynamicsPercent: number;
     nkdRub?: number;
     nominal?: number;
     holdOnly?: boolean;
     excludeFromStockPool?: boolean;
   }>;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Вычисляет балансовую стоимость позиции из percent-данных.
 * balanceValue = balancePercent * liqValue / liqPercent
 */
function calcBalanceValueFromPct(
  balancePercent: number,
  liquidationValue: number,
  liquidationPercent: number,
): number {
  if (balancePercent <= 0 || liquidationPercent <= 0) return liquidationValue;
  return (balancePercent / liquidationPercent) * liquidationValue;
}

/**
 * Собирает PortfolioSnapshot из агрегированных активов.
 *
 * КРИТИЧЕСКИЕ ПРАВИЛА:
 *   1. liquidationWeightPct = liqValue(position) / totalLiqValue(portfolio) × 100
 *      НЕ суммировать проценты отдельных счетов!
 *   2. targetWeightPct = undefined при конфликте между счетами
 *   3. holdOnly / excludeFromStockPool = OR-логика
 *   4. accounts[] обязательно попадает в снимок
 */
export function buildPortfolioSnapshot(
  aggregated: InternalAggregatedAsset[],
  macro: {
    totalBalance: number;
    freeCash: number;
    stocksDeficitRub?: number;
    bondsDeficitRub?: number;
  },
  historicalData?: {
    profitC10: number;
    profitC11: number;
    investedNet: number;
  },
): PortfolioSnapshot {
  const now = new Date().toLocaleDateString('ru-RU');

  // 1. Считаем общую ликвидационную и балансовую стоимость
  let totalLiqValue = 0;
  let totalBalanceValue = 0;

  for (const asset of aggregated) {
    totalLiqValue += asset.totalLiquidationValue;
    // Суммируем балансовые стоимости из позиций на каждом счёте
    for (const acc of asset.accounts) {
      totalBalanceValue += calcBalanceValueFromPct(
        acc.balancePercent,
        acc.liquidationValue,
        acc.liquidationPercent,
      );
    }
  }

  // 2. Собираем AccountSnapshot по уникальным accountId
  const accountMap = new Map<string, AccountSnapshot>();

  for (const asset of aggregated) {
    for (const acc of asset.accounts) {
      if (!accountMap.has(acc.accountId)) {
        accountMap.set(acc.accountId, {
          accountId: acc.accountId,
          accountType: acc.accountType,
          totalLiquidationValue: 0,
        });
      }
      const snap = accountMap.get(acc.accountId)!;
      snap.totalLiquidationValue += acc.liquidationValue;
    }
  }

  // 3. Собираем AssetSnapshot
  const assets: AssetSnapshot[] = [];

  for (const agg of aggregated) {
    // Правильный liquidationWeightPct из totalLiquidationValue
    const liquidationWeightPct = totalLiqValue > 0
      ? Math.round((agg.totalLiquidationValue / totalLiqValue) * 10000) / 100
      : 0;

    // Обработка targetPercent конфликта
    const uniqueTargetPcts = Array.from(
      new Set(agg.accounts.map((a) => a.targetPercent).filter((v): v is number => v != null && v > 0)),
    );

    let targetWeightPct: number | undefined = undefined;
    let targetPercentConflict = false;

    if (uniqueTargetPcts.length === 1) {
      targetWeightPct = uniqueTargetPcts[0];
    } else if (uniqueTargetPcts.length > 1) {
      // КОНФЛИКТ: разные target на разных счетах
      targetPercentConflict = true;
      targetWeightPct = undefined; // НЕ выбираем молча первое!

      console.warn(
        `⚠️ [SNAPSHOT] TARGET_CONFLICT: ticker=${agg.ticker}, ` +
        `targets=[${uniqueTargetPcts.join(', ')}], ` +
        `accounts=[${agg.accounts.map((a) => `${a.accountId}(${a.accountType}:${a.targetPercent}%)`).join(', ')}]`,
      );
    }

    // deviationPct = фактический вес минус целевой вес
    const deviationPct = targetWeightPct !== undefined
      ? Math.round((liquidationWeightPct - targetWeightPct) * 100) / 100
      : undefined;

    // OR-логика для holdOnly и excludeFromStockPool
    const holdOnly = agg.accounts.some((a) => a.holdOnly === true);
    const excludeFromStockPool = agg.accounts.some(
      (a) => a.excludeFromStockPool === true,
    );

    // Балансовая стоимость позиции = сумма балансовых стоимостей на каждом счёте
    const balanceValue = agg.accounts.reduce((sum: number, a) => {
      return (
        sum +
        calcBalanceValueFromPct(
          a.balancePercent,
          a.liquidationValue,
          a.liquidationPercent,
        )
      );
    }, 0);

    // Собираем AssetAccountSnapshot
    const accounts: AssetAccountSnapshot[] = agg.accounts.map((acc) => {
      const accLiqWeight = totalLiqValue > 0
        ? Math.round((acc.liquidationValue / totalLiqValue) * 10000) / 100
        : 0;

      // Для каждого счёта targetWeightPct — берём значение этого счёта
      const accTargetPct = acc.targetPercent != null && acc.targetPercent > 0 ? acc.targetPercent : undefined;

      return {
        accountId: acc.accountId,
        accountType: acc.accountType,
        quantity: acc.quantity,
        balanceValue: calcBalanceValueFromPct(
          acc.balancePercent,
          acc.liquidationValue,
          acc.liquidationPercent,
        ),
        liquidationValue: acc.liquidationValue,
        liquidationWeightPct: accLiqWeight,
        targetWeightPct: accTargetPct,
        holdOnly: acc.holdOnly || false,
        excludeFromStockPool: acc.excludeFromStockPool || false,
      };
    });

    assets.push({
      ticker: agg.ticker,
      name: agg.name,
      balanceValue,
      liquidationValue: agg.totalLiquidationValue,
      liquidationWeightPct,
      targetWeightPct,
      deviationPct,
      status: targetPercentConflict ? 'TARGET_CONFLICT' : undefined,
      holdOnly,
      excludeFromStockPool,
      targetPercentConflict,
      targetNotSet: targetWeightPct === undefined && !targetPercentConflict,
      accounts,
    });
  }

  // 4. FinancialSnapshot
  //   profitC10 = исторический рыночный результат (прибыль/убыток с начала учёта)
  //   profitC11 = текущий дефицит/профицит долевой позиции (текущий финансовый результат)
  //   stocksDeficitRub / bondsDeficitRub = 0 в текущих данных, не являются источником
  const contributedCapital = historicalData?.investedNet ?? 0;
  const historicalMarketResult = historicalData?.profitC10 ?? 0;
  const currentEquityGap = historicalData?.profitC11 ?? 0;
  const currentEquityGapPct = totalLiqValue > 0
    ? Math.round((currentEquityGap / totalLiqValue) * 10000) / 100
    : 0;

  const financial: FinancialSnapshot = {
    currentAssets: totalLiqValue,
    freeCash: macro.freeCash,
    contributedCapital,
    currentEquityGap,
    currentEquityGapPct,
    historicalMarketResult,
    snapshotTimestamp: now,
  };

  return {
    financial,
    totalLiquidationValue: totalLiqValue,
    totalBalanceValue,
    accounts: Array.from(accountMap.values()),
    assets,
  };
}
