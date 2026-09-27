import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import type { StrategistAgentOutput } from './strategist-agent.js';
import type { ScenarioAgentOutput, ScenarioChange } from './scenario-agent.js';
import { StrategistAgent } from './strategist-agent.js';
import { ScenarioAgent } from './scenario-agent.js';
import { runConsilium, type ConsiliumInput } from './consilium.js';

// ─── Helpers ───────────────────────────────────────────────────────

function dataOfStrategist(result: { data?: unknown }): StrategistAgentOutput {
  return result.data as StrategistAgentOutput;
}

function dataOfScenario(result: { data?: unknown }): ScenarioAgentOutput {
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

async function buildInput(
  o?: Partial<ConsiliumInput>,
  scenarioProposed?: ScenarioChange[],
): Promise<ConsiliumInput> {
  const assets = [createAsset()];
  const defaultProposals = [
    { ticker: 'PLZL', action: 'SELL' as const, keyCatalysts: [] },
  ];
  const effectiveProposals = o?.proposals ?? defaultProposals;

  const strategist = new StrategistAgent();
  const scenario = new ScenarioAgent();

  const [strategistResult, scenarioResult] = await Promise.all([
    strategist.execute({
      assetsAnalysis: assets,
      proposals: effectiveProposals,
    }),
    scenario.execute({
      assetsAnalysis: assets,
      totalPortfolioValue: 500000,
      freeCashRub: 0,
      proposedChanges: scenarioProposed ?? [
        { ticker: 'PLZL', action: 'SELL' as const, amountRub: 20000 },
      ],
    }),
  ]);

  return {
    assetsAnalysis: assets,
    proposals: effectiveProposals,
    strategistOutput: dataOfStrategist(strategistResult),
    scenarioOutput: dataOfScenario(scenarioResult),
    ...o,
  };
}

describe('Consilium', () => {
  it('вето стратега побеждает: финальное действие HOLD, CONFLICT', async () => {
    const input = await buildInput();
    const output = runConsilium(input);

    expect(output.decisions).toHaveLength(1);
    const decision = output.decisions[0]!;
    expect(decision.finalAction).toBe('HOLD');
    expect(decision.strategistVeto).not.toBeNull();
    expect(decision.agreement).toBe('CONFLICT');
    expect(output.summary.vetoed).toBe(1);
  });

  it('единогласное решение при безопасном BUY', async () => {
    const input = await buildInput(
      {
        proposals: [
          {
            ticker: 'PLZL',
            action: 'BUY' as const,
            keyCatalysts: ['Дивиденды'],
          },
        ],
        newsContext: 'Рост котировок, рекордная прибыль',
      },
      [{ ticker: 'PLZL', action: 'BUY', amountRub: 10000 }],
    );
    const output = runConsilium(input);

    const decision = output.decisions[0]!;
    expect(decision.finalAction).toBe('BUY');
    expect(decision.agreement).toBe('UNANIMOUS');
    expect(decision.strategistVeto).toBeNull();
  });

  it('негативный новостной фон без катализатора → research голосует HOLD', async () => {
    const input = await buildInput({
      newsContext: 'Новые санкции, геополитический риск, падение рынка',
    });
    const output = runConsilium(input);

    const researchVote = output.decisions[0]!.votes.find(
      (v) => v.agent === 'research',
    );
    expect(researchVote).toBeDefined();
    expect(researchVote!.action).toBe('HOLD');
  });

  it('все четыре участника голосуют по каждому активу', async () => {
    const input = await buildInput();
    const output = runConsilium(input);

    expect(output.decisions[0]!.votes).toHaveLength(4);
    const agents = output.decisions[0]!.votes.map((v) => v.agent).sort();
    expect(agents).toEqual(['ai', 'research', 'scenario', 'strategist']);
  });
});
