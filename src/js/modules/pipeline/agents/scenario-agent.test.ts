import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import {
  ScenarioAgent,
  type ScenarioAgentOutput,
  type ScenarioChange,
} from './scenario-agent.js';

// ─── Helpers ───────────────────────────────────────────────────────

// AgentBase.execute() типизирует data как unknown — приводим к конкретному типу
function dataOf(result: { data?: unknown }): ScenarioAgentOutput {
  return result.data as ScenarioAgentOutput;
}

function createAsset(o?: Partial<AssetAnalysis>): AssetAnalysis {
  return {
    name: 'Полюс',
    ticker: 'PLZL',
    assetType: 'STOCK',
    currentPercent: 12,
    targetPercent: 8,
    deficitRub: 0,
    status: 'REDUCE',
    dynamicsPercent: -3,
    nkdRub: 0,
    nominal: 0,
    quantity: 10,
    balancePrice: 1000,
    currentPrice: 420,
    unrealizedProfitRub: -58000,
    priority: 0,
    isConcentrated: true,
    ...o,
  };
}

function createInput(
  proposed?: ScenarioChange[],
  o?: Partial<Parameters<ScenarioAgent['executeInternal']>[0]>,
): Parameters<ScenarioAgent['executeInternal']>[0] {
  return {
    assetsAnalysis: [
      createAsset(),
      createAsset({
        ticker: 'SBER',
        name: 'Сбер',
        currentPercent: 5,
        targetPercent: 10,
        deficitRub: 20000,
        status: 'BUY',
        quantity: 100,
        balancePrice: 250,
        currentPrice: 280,
        unrealizedProfitRub: 3000,
      }),
    ],
    totalPortfolioValue: 500000,
    freeCashRub: 15000,
    proposedChanges: proposed ?? [
      { ticker: 'PLZL', action: 'SELL', amountRub: 20000 },
    ],
    ...o,
  };
}

describe('ScenarioAgent', () => {
  it('строит baseline + сценарии и выбирает лучший', async () => {
    const agent = new ScenarioAgent();
    const result = await agent.execute(createInput());

    expect(result.success).toBe(true);
    const data = dataOf(result);
    expect(data.scenarios.length).toBeGreaterThanOrEqual(2);
    expect(data.scenarios[0]!.id).toBe('S1_hold');
    expect(data.bestScenarioId).not.toBeNull();
    expect(data.summary.baselineDeviationPct).toBeGreaterThan(0);
    expect(data.summary.bestImprovementPct).toBeGreaterThanOrEqual(0);
  });

  it('предложение AI, фиксирующее глубокий убыток, помечается WORSENS', async () => {
    const agent = new ScenarioAgent();
    const result = await agent.execute(
      createInput([{ ticker: 'PLZL', action: 'SELL', amountRub: 20000 }]),
    );

    const data = dataOf(result);
    const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
    expect(aiScenario).toBeDefined();
    expect(aiScenario!.verdict).toBe('WORSENS');
    expect(aiScenario!.realizedLossRub).toBeGreaterThan(0);
  });

  it('оптимизированный сценарий исключает продажу глубокой просадки', async () => {
    const agent = new ScenarioAgent();
    const result = await agent.execute(
      createInput([
        { ticker: 'PLZL', action: 'SELL', amountRub: 20000 },
        { ticker: 'SBER', action: 'BUY', amountRub: 10000 },
      ]),
    );

    const data = dataOf(result);
    const optimized = data.scenarios.find((s) => s.id === 'S3_optimized');
    expect(optimized).toBeDefined();
    const hasLossSell = optimized!.changes.some(
      (c) => c.ticker.toUpperCase() === 'PLZL' && c.action !== 'HOLD',
    );
    expect(hasLossSell).toBe(false);
  });

  it('гибкий сценарий финансирует покупку дефицита за счёт прибыльной позиции', async () => {
    const agent = new ScenarioAgent();
    // Добавляем прибыльный актив с перевесом (REDUCE) — источник финансирования
    const assetsWithProfit = [
      createAsset(),
      createAsset({
        ticker: 'SBER',
        name: 'Сбер',
        currentPercent: 5,
        targetPercent: 10,
        deficitRub: 20000,
        status: 'BUY',
        quantity: 100,
        balancePrice: 250,
        currentPrice: 280,
        unrealizedProfitRub: 3000,
      }),
      createAsset({
        ticker: 'GAZP',
        name: 'Газпром',
        currentPercent: 20,
        targetPercent: 10,
        deficitRub: -50000,
        status: 'REDUCE',
        quantity: 50,
        balancePrice: 200,
        currentPrice: 250,
        unrealizedProfitRub: 2500,
      }),
    ];
    const result = await agent.execute(
      createInput([], {
        freeCashRub: 0,
        totalPortfolioValue: 500000,
        assetsAnalysis: assetsWithProfit,
      }),
    );

    const data = dataOf(result);
    const flexible = data.scenarios.find((s) => s.id === 'S4_flexible');
    expect(flexible).toBeDefined();
    expect(
      flexible!.changes.some((c) => c.action === 'BUY' && c.ticker === 'SBER'),
    ).toBe(true);
    // Финансирование из продажи прибыльной GAZP (не из глубокой просадки)
    expect(
      flexible!.changes.some((c) => c.action === 'SELL' && c.ticker === 'GAZP'),
    ).toBe(true);
  });

  it('вердикт лучшего сценария никогда не WORSENS', async () => {
    const agent = new ScenarioAgent();
    const result = await agent.execute(
      createInput([{ ticker: 'PLZL', action: 'SELL', amountRub: 30000 }]),
    );

    const data = dataOf(result);
    const best = data.scenarios.find((s) => s.id === data.bestScenarioId);
    expect(best).toBeDefined();
    expect(best!.verdict).not.toBe('WORSENS');
  });
});
