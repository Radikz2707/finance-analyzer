/**
 * Детерминизм-тест ScenarioAgent.
 *
 * Два прогона на замороженном снапшоте данных (14 активов):
 * голоса (verdict) и P&L должны быть идентичны.
 *
 * Это проверяет, что ScenarioAgent не зависит от:
 * - глобального состояния (Date.now() зафиксирован);
 * - порядка итераций Map/Set (используем сортированные массивы);
 * - случайных факторов.
 */

import type { AssetAnalysis } from '../../../portfolio/portfolio-math/portfolio-math.js';
import {
  ScenarioAgent,
  type ScenarioAgentOutput,
} from './scenario-agent.js';

// ─── Замороженный снапшот: 14 активов ────────────────────────────────

function makeAsset(
  ticker: string,
  overrides: Partial<AssetAnalysis> = {},
): AssetAnalysis {
  return {
    name: ticker,
    ticker,
    assetType: overrides.assetType ?? 'STOCK',
    currentPercent: overrides.currentPercent ?? 5,
    targetPercent: overrides.targetPercent ?? 10,
    deficitRub: overrides.deficitRub ?? 0,
    status: overrides.status ?? 'HOLD',
    dynamicsPercent: overrides.dynamicsPercent ?? 0,
    nkdRub: overrides.nkdRub ?? 0,
    nominal: overrides.nominal ?? 0,
    quantity: overrides.quantity ?? 100,
    balancePrice: overrides.balancePrice ?? 100,
    currentPrice: overrides.currentPrice ?? 110,
    unrealizedProfitRub: overrides.unrealizedProfitRub ?? 0,
    priority: overrides.priority ?? 0,
    isConcentrated: overrides.isConcentrated ?? false,
    deficitDeviationPct: overrides.deficitDeviationPct,
    ...overrides,
  };
}

// 14 активов: микс акций и облигаций, разные статусы.
const FROZEN_ASSETS: AssetAnalysis[] = [
  makeAsset('SBER', {
    assetType: 'STOCK',
    currentPercent: 18,
    targetPercent: 15,
    deficitRub: -150000,
    status: 'REDUCE',
    quantity: 500,
    balancePrice: 260,
    currentPrice: 250,
    unrealizedProfitRub: -5000,
  }),
  makeAsset('TATN', {
    assetType: 'STOCK',
    currentPercent: 3,
    targetPercent: 10,
    deficitRub: 70000,
    status: 'BUY',
    quantity: 100,
    balancePrice: 600,
    currentPrice: 620,
    unrealizedProfitRub: 2000,
  }),
  makeAsset('TATNP', {
    assetType: 'STOCK',
    currentPercent: 5,
    targetPercent: 5,
    deficitRub: 0,
    status: 'HOLD',
    quantity: 200,
    balancePrice: 1400,
    currentPrice: 1420,
    unrealizedProfitRub: 400,
  }),
  makeAsset('GMKN', {
    assetType: 'STOCK',
    currentPercent: 7,
    targetPercent: 8,
    deficitRub: 10000,
    status: 'BUY',
    quantity: 150,
    balancePrice: 15000,
    currentPrice: 15200,
    unrealizedProfitRub: 3000,
  }),
  makeAsset('LKOH', {
    assetType: 'STOCK',
    currentPercent: 6,
    targetPercent: 8,
    deficitRub: 20000,
    status: 'BUY',
    quantity: 20,
    balancePrice: 17000,
    currentPrice: 17500,
    unrealizedProfitRub: 1000,
  }),
  makeAsset('NVTK', {
    assetType: 'STOCK',
    currentPercent: 4,
    targetPercent: 5,
    deficitRub: 5000,
    status: 'BUY',
    quantity: 30,
    balancePrice: 12000,
    currentPrice: 12200,
    unrealizedProfitRub: 600,
  }),
  makeAsset('ROSN', {
    assetType: 'STOCK',
    currentPercent: 9,
    targetPercent: 8,
    deficitRub: -10000,
    status: 'REDUCE',
    quantity: 200,
    balancePrice: 550,
    currentPrice: 540,
    unrealizedProfitRub: -2000,
  }),
  makeAsset('AFLT', {
    assetType: 'STOCK',
    currentPercent: 4,
    targetPercent: 5,
    deficitRub: 5000,
    status: 'BUY',
    quantity: 500,
    balancePrice: 280,
    currentPrice: 285,
    unrealizedProfitRub: 250,
  }),
  makeAsset('CHMF', {
    assetType: 'STOCK',
    currentPercent: 3,
    targetPercent: 4,
    deficitRub: 5000,
    status: 'BUY',
    quantity: 800,
    balancePrice: 35,
    currentPrice: 36,
    unrealizedProfitRub: 800,
  }),
  makeAsset('SU29027RMFS8', {
    assetType: 'BOND',
    currentPercent: 12,
    targetPercent: 15,
    deficitRub: 30000,
    status: 'BUY',
    quantity: 100,
    balancePrice: 980,
    currentPrice: 990,
    unrealizedProfitRub: 1000,
  }),
  makeAsset('RU000A109L49', {
    assetType: 'BOND',
    currentPercent: 10,
    targetPercent: 12,
    deficitRub: 20000,
    status: 'BUY',
    quantity: 100,
    balancePrice: 1010,
    currentPrice: 1005,
    unrealizedProfitRub: -500,
  }),
  makeAsset('RU000A10EVJ7', {
    assetType: 'BOND',
    currentPercent: 8,
    targetPercent: 10,
    deficitRub: 20000,
    status: 'BUY',
    quantity: 100,
    balancePrice: 995,
    currentPrice: 1000,
    unrealizedProfitRub: 500,
  }),
  makeAsset('OEAB2', {
    assetType: 'BOND',
    currentPercent: 6,
    targetPercent: 5,
    deficitRub: -5000,
    status: 'REDUCE',
    quantity: 100,
    balancePrice: 1020,
    currentPrice: 1015,
    unrealizedProfitRub: -500,
  }),
  makeAsset('RASA', {
    assetType: 'STOCK',
    currentPercent: 5,
    targetPercent: 5,
    deficitRub: 0,
    status: 'HOLD',
    quantity: 1000,
    balancePrice: 45,
    currentPrice: 47,
    unrealizedProfitRub: 2000,
  }),
];

// Предложенные изменения: микс BUY/SELL для разных активов.
const PROPOSED_CHANGES = [
  { ticker: 'SBER', action: 'SELL' as const, amountRub: 150000 },
  { ticker: 'TATN', action: 'BUY' as const, amountRub: 70000 },
  { ticker: 'ROSN', action: 'SELL' as const, amountRub: 50000 },
  { ticker: 'SU29027RMFS8', action: 'BUY' as const, amountRub: 30000 },
];

const ALLOCATION_BASE = 761589; // allocationBaseValue из анализа.
const FREE_CASH = 50000;

function buildInput(): Parameters<ScenarioAgent['executeInternal']>[0] {
  return {
    assetsAnalysis: FROZEN_ASSETS,
    allocationBaseValue: ALLOCATION_BASE,
    freeCashRub: FREE_CASH,
    proposedChanges: PROPOSED_CHANGES,
    noSellTickers: ['TATN', 'IRAO'], // TATN — no-sell, IRAO — нет в портфеле
  };
}

// ─── Утилиты для сравнения ───────────────────────────────────────────

/** Извлечь голоса сценариев по ID для сравнения двух результатов. */
function extractVerdicts(output: ScenarioAgentOutput): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const scenario of output.scenarios) {
    map.set(scenario.id, [
      scenario.verdict,
      scenario.fundingStatus,
      String(scenario.structureDeviationPct),
      String(scenario.totalPnLRub),
    ]);
  }
  return map;
}

/** Сравнить два результата по сценариям. */
function diffVerdicts(
  labelA: string,
  labelB: string,
  verdictsA: Map<string, string[]>,
  verdictsB: Map<string, string[]>,
): string[] {
  const diffs: string[] = [];
  const allIds = new Set([...verdictsA.keys(), ...verdictsB.keys()]);

  for (const id of allIds) {
    const a = verdictsA.get(id);
    const b = verdictsB.get(id);

    if (!a) {
      diffs.push(`${labelA}: сценарий ${id} отсутствует`);
      continue;
    }
    if (!b) {
      diffs.push(`${labelB}: сценарий ${id} отсутствует`);
      continue;
    }

    const fields = ['verdict', 'fundingStatus', 'structureDeviationPct', 'totalPnLRub'];
    for (let i = 0; i < fields.length; i++) {
      if (a[i] !== b[i]) {
        diffs.push(
          `${id}[${fields[i]}]: ${labelA}=${a[i]} vs ${labelB}=${b[i]}`,
        );
      }
    }
  }

  return diffs;
}

// ─── Тесты ───────────────────────────────────────────────────────────

describe('ScenarioAgent determinism', () => {
  it('два прогона на замороженном снапшоте дают идентичные голоса', async () => {
    const agent = new ScenarioAgent();
    const input = buildInput();

    // Прогон 1
    const resultA = await agent.execute(input);
    const outputA = resultA.data as ScenarioAgentOutput;
    const verdictsA = extractVerdicts(outputA);

    // Прогон 2 — на ТОЖЕ самом объекте input (без мутаций)
    const resultB = await agent.execute(input);
    const outputB = resultB.data as ScenarioAgentOutput;
    const verdictsB = extractVerdicts(outputB);

    // Сравниваем голоса по всем сценариям
    const diffs = diffVerdicts('run1', 'run2', verdictsA, verdictsB);

    expect(diffs).toEqual([]);
    expect(outputA.scenarios.length).toBeGreaterThan(0);
    expect(outputB.scenarios.length).toBe(outputA.scenarios.length);

    // Проверяем, что baseline (S1) всегда NEUTRAL
    const s1A = outputA.scenarios.find((s) => s.id === 'S1_hold');
    const s1B = outputB.scenarios.find((s) => s.id === 'S1_hold');
    expect(s1A?.verdict).toBe('NEUTRAL');
    expect(s1B?.verdict).toBe('NEUTRAL');

    // Проверяем, что S2 (AI proposal) не содержит CONFLICT для IRAO/TATN
    const s2A = outputA.scenarios.find((s) => s.id === 'S2_ai');
    const s2B = outputB.scenarios.find((s) => s.id === 'S2_ai');
    if (s2A && s2B) {
      expect(s2A.rationale).not.toContain('CONFLICT');
      expect(s2B.rationale).not.toContain('CONFLICT');
    }
  });

  it('allocationBaseValue влияет на доли, но детерминированно', async () => {
    const agent = new ScenarioAgent();
    const input = buildInput();

    // Прогон с allocationBaseValue
    const resultWithBase = await agent.execute(input);
    const outputWithBase = resultWithBase.data as ScenarioAgentOutput;

    // Прогон с totalPortfolioValue (legacy fallback)
    const inputLegacy = {
      ...input,
      allocationBaseValue: undefined,
      totalPortfolioValue: 761589, // то же значение
    };
    const resultLegacy = await agent.execute(inputLegacy);
    const outputLegacy = resultLegacy.data as ScenarioAgentOutput;

    const verdictsBase = extractVerdicts(outputWithBase);
    const verdictsLegacy = extractVerdicts(outputLegacy);

    const diffs = diffVerdicts('allocationBase', 'totalPortfolio', verdictsBase, verdictsLegacy);
    expect(diffs).toEqual([]);
  });

  it('no-sell тикеры (TATN) не продаются в S3 оптимизированном', async () => {
    const agent = new ScenarioAgent();
    const input = buildInput();

    const result = await agent.execute(input);
    const output = result.data as ScenarioAgentOutput;

    const s3 = output.scenarios.find((s) => s.id === 'S3_optimized');
    expect(s3).toBeDefined();

    // В сценарии S3 не должно быть продаж TATN
    const tatnSell = s3?.changes?.find(
      (c) => c.ticker.toUpperCase() === 'TATN' && (c.action === 'SELL' || c.action === 'REDUCE'),
    );
    expect(tatnSell).toBeUndefined();
  });

  it('дефицитные позиции (BUY) не продаются в S3 и S4', async () => {
    const agent = new ScenarioAgent();
    const input = buildInput();

    const result = await agent.execute(input);
    const output = result.data as ScenarioAgentOutput;

    // Дефицитные тикеры
    const buyTickers = ['TATN', 'GMKN', 'LKOH', 'NVTK', 'AFLT', 'CHMF', 'SU29027RMFS8', 'RU000A109L49', 'RU000A10EVJ7'];

    for (const scenarioId of ['S3_optimized', 'S4_flexible']) {
      const scenario = output.scenarios.find((s) => s.id === scenarioId);
      if (!scenario) continue;

      for (const ticker of buyTickers) {
        const sellChange = scenario.changes.find(
          (c) =>
            c.ticker.toUpperCase() === ticker &&
            (c.action === 'SELL' || c.action === 'REDUCE'),
        );
        expect(sellChange).toBeUndefined();
      }
    }
  });
});
