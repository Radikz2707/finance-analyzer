import { MacroGoals, CurrentAsset } from '../xlsx-parser/xlsx-parser.js';

export interface AssetAnalysis {
  name: string;
  ticker: string;
  currentPercent: number;
  targetPercent: number;
  deficitRub: number;
  status: 'HOLD' | 'BUY' | 'STABLE' | 'REDUCE' | 'NEW';
  dynamicsPercent: number;
  nkdRub: number;
  nominal: number;
  quantity: number;
  balancePrice: number;
  currentPrice: number;
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
  private targetLimits: Record<string, { target: number; holdOnly?: boolean }> =
    {
      Полюс: { target: 20.0, holdOnly: true },
      Сбербанк: { target: 10.0 },
      'Татнфт Зао': { target: 9.0 },
      ИнтерРАОао: { target: 8.0 },
      'КЦ ИКС 5': { target: 8.0 },
      'sГТЛК2P-14': { target: 15.0 },
      'Брус 2Р04': { target: 20.0 },
      Селигдар10: { target: 10.0 },
    };

  public analyzePortfolio(
    macro: MacroGoals,
    assets: CurrentAsset[],
  ): PortfolioReportData {
    const assetsAnalysis: AssetAnalysis[] = [];
    let allocatedStocksPercent = 0;

    Object.keys(this.targetLimits).forEach((name) => {
      if (
        name !== 'sГТЛК2P-14' &&
        name !== 'Брус 2Р04' &&
        name !== 'Селигдар10'
      ) {
        allocatedStocksPercent += this.targetLimits[name].target;
      }
    });

    const freeStocksPoolPercent = Math.max(
      0,
      macro.stocksPercent - allocatedStocksPercent,
    );

    assets.forEach((asset) => {
      const nameUpper = asset.name.toUpperCase();
      if (
        nameUpper.includes('ИТОГО') ||
        nameUpper.includes('БАЛАНС') ||
        !isNaN(Number(asset.name))
      ) {
        return;
      }

      const limitConfig = this.targetLimits[asset.name];

      let targetPercent =
        asset.targetPercent > 0
          ? asset.targetPercent
          : limitConfig
            ? limitConfig.target
            : -1;

      let status: 'HOLD' | 'BUY' | 'STABLE' | 'REDUCE' | 'NEW' = 'STABLE';
      let deficitRub = 0;

      if (targetPercent === -1) {
        status = 'NEW';
        targetPercent = 0;
      } else {
        const deviationPercent = targetPercent - asset.liquidationPercent;
        deficitRub = Math.round((deviationPercent / 100) * macro.totalBalance);

        if (limitConfig?.holdOnly) {
          status = 'HOLD';
        } else if (deficitRub > 1000) {
          status = 'BUY';
        } else if (deficitRub < -2000) {
          status = 'REDUCE';
        }

        if (
          asset.liquidationPercent < asset.balancePercent &&
          status === 'REDUCE'
        ) {
          status = 'HOLD';
        }
      }

      // Используем реальные цены из Excel, если они есть
      const balancePrice = asset.balancePrice ?? 0;
      const currentPrice = asset.currentPrice ?? 0;

      // Проверяем концентрацию (позиция > 20% — риск)
      const isConcentrated = asset.liquidationPercent > 20;

      assetsAnalysis.push({
        name: asset.name,
        ticker: asset.ticker,
        currentPercent: asset.liquidationPercent,
        targetPercent: targetPercent,
        deficitRub: deficitRub,
        status: status,
        dynamicsPercent: asset.dynamicsPercent,
        nkdRub: asset.nkdRub || 0,
        nominal: asset.nominal || 1000,
        quantity: asset.quantity || 0,
        balancePrice: balancePrice,
        currentPrice: currentPrice,
        unrealizedProfitRub: asset.unrealizedProfitRub || 0,
        priority: deficitRub,
        isConcentrated: isConcentrated,
      });
    });

    // Сортируем по приоритету покупок (больший дефицит = выше приоритет)
    assetsAnalysis.sort((a, b) => b.deficitRub - a.deficitRub);

    return {
      macro,
      assetsAnalysis,
      freeStocksPoolPercent,
    };
  }
}
