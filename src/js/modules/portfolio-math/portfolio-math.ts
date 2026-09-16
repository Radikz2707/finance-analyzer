import { MacroGoals, CurrentAsset, PriceUnit } from '../xlsx-parser/xlsx-parser.js';
import { PortfolioConfig } from '../ai-advisor/portfolio-config.js';

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
    let allocatedStocksPercent = 0;

    // Считаем allocatedStocksPercent, исключая активы с excludeFromStockPool
    // targetPercent === undefined → НЕ учитываем (нет целевой доли)
    // targetPercent === 0 → EXIT, НЕ учитываем
    // targetPercent > 0 → учитываем
    assets.forEach((asset) => {
      if (asset.holdOnly || asset.excludeFromStockPool) return;
      if (asset.targetPercent !== undefined && asset.targetPercent > 0) {
        allocatedStocksPercent += asset.targetPercent;
      }
    });

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

      if (asset.targetPercent === 0 && asset.liquidationPercent > 0) {
        // Целевая доля 0, но актив есть в портфеле → плановый выход
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
