/**
 * Бенчмарк PortfolioMathModule.analyzePortfolio на синтетическом портфеле.
 *
 * Портфель генерируется в памяти (10 / 100 / 1000 позиций). Сумма долей
 * всегда равна 100%, чтобы не триггерить предупреждение валидации.
 */

import { PortfolioMathModule } from '../../portfolio-math/portfolio-math.js';
import type {
  CurrentAsset,
  MacroGoals,
} from '../../xlsx-parser/xlsx-parser.js';
import { measure, type BenchmarkResult } from './benchmark-runner.js';

const TOTAL_LIQUIDATION_VALUE = 5_000_000;

function makeMacro(): MacroGoals {
  return {
    totalBalance: 4_800_000,
    freeCash: 200_000,
    stocksPercent: 60,
    bondsPercent: 35,
    stocksDeficitRub: 50_000,
    bondsDeficitRub: 0,
    iisOrdersSum: 0,
    brokerOrdersSum: 0,
    activeOrdersListText: '',
  };
}

function roundPercent(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function makeAsset(
  index: number,
  liquidationPercent: number,
  targetPercent: number,
): CurrentAsset {
  return {
    name: `Актив ${index}`,
    ticker: `TICK${index}`,
    assetType: 'Акция',
    targetPercent,
    liquidationPercent,
    balancePercent: liquidationPercent,
    unrealizedProfitRub: ((index % 7) - 2) * 1_000,
    dynamicsPercent: (index % 11) - 5,
    dailyDynamicsPercent: (index % 9) - 4,
    nkdRub: 0,
    nominal: 1_000,
    quantity: index * 10 + 1,
    balancePrice: 100 + (index % 50),
    currentPrice: 105 + (index % 55),
    priceUnit: 'RUB',
    holdOnly: false,
    excludeFromStockPool: false,
    targetPercentConflict: false,
  };
}

/**
 * Синтетический портфель из size позиций.
 * liquidationPercent равномерный (сумма = 100%), targetPercent — с дрейфом
 * ±0.1 п.п., чтобы получались разные статусы (BUY/REDUCE/STABLE).
 */
function makePortfolio(size: number): CurrentAsset[] {
  const assets: CurrentAsset[] = [];
  const basePercent = 100 / size;
  for (let i = 0; i < size; i += 1) {
    const drift = ((i % 3) - 1) * 0.1; // -0.1 / 0 / +0.1
    assets.push(
      makeAsset(
        i,
        roundPercent(basePercent),
        roundPercent(basePercent + drift),
      ),
    );
  }
  return assets;
}

/** Замер расчёта PortfolioMath на портфелях разного размера. */
export async function runPortfolioMathBenchmarks(): Promise<BenchmarkResult[]> {
  const math = new PortfolioMathModule();
  const macro = makeMacro();

  const sizes: Array<{ label: string; size: number }> = [
    { label: 'portfolio-math 10 positions', size: 10 },
    { label: 'portfolio-math 100 positions', size: 100 },
    { label: 'portfolio-math 1000 positions', size: 1_000 },
  ];

  const results: BenchmarkResult[] = [];
  for (const { label, size } of sizes) {
    const portfolio = makePortfolio(size);
    results.push(
      await measure(
        label,
        () => math.analyzePortfolio(macro, portfolio, TOTAL_LIQUIDATION_VALUE),
        { iterations: 300, warmup: 2 },
      ),
    );
  }
  return results;
}
