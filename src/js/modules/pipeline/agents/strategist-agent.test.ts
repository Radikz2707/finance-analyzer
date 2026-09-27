import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import {
  StrategistAgent,
  type StrategistAgentOutput,
} from './strategist-agent.js';

// ─── Helpers ───────────────────────────────────────────────────────

// AgentBase.execute() типизирует data как unknown — приводим к конкретному типу
function dataOf(result: { data?: unknown }): StrategistAgentOutput {
  return result.data as StrategistAgentOutput;
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

describe('StrategistAgent', () => {
  it('блокирует SELL при просадке 58% без катализатора → HOLD + veto', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [createAsset()],
      proposals: [
        {
          ticker: 'PLZL',
          action: 'SELL',
          keyCatalysts: [],
          rationale: 'Зафиксировать убыток',
        },
      ],
    });

    expect(result.success).toBe(true);
    const data = dataOf(result);
    expect(data.decisions).toHaveLength(1);
    expect(data.decisions[0]!.suggestedAction).toBe('SELL');
    expect(data.decisions[0]!.finalAction).toBe('HOLD');
    expect(data.decisions[0]!.veto).not.toBeNull();
    expect(data.decisions[0]!.drawdownPercent).toBeCloseTo(-58, 1);
    expect(data.summary.actionsBlocked).toBe(1);
  });

  it('не блокирует SELL при наличии катализатора', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [createAsset()],
      proposals: [
        {
          ticker: 'PLZL',
          action: 'SELL',
          keyCatalysts: ['Снижение мультипликаторов', 'Слабый отчёт'],
          rationale: 'Фундаментальное ухудшение бизнеса',
        },
      ],
    });

    const data = dataOf(result);
    expect(data.decisions[0]!.finalAction).toBe('SELL');
    expect(data.decisions[0]!.veto).toBeNull();
  });

  it('не блокирует BUY даже при глубокой просадке', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [createAsset()],
      proposals: [{ ticker: 'PLZL', action: 'BUY', keyCatalysts: [] }],
    });

    const data = dataOf(result);
    expect(data.decisions[0]!.finalAction).toBe('BUY');
    expect(data.decisions[0]!.veto).toBeNull();
  });

  it('не блокирует SELL при небольшой просадке (выше порога)', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [
        createAsset({
          balancePrice: 500,
          currentPrice: 450,
          unrealizedProfitRub: -500,
        }),
      ],
      proposals: [
        {
          ticker: 'PLZL',
          action: 'SELL',
          keyCatalysts: [],
          rationale: 'Уменьшить концентрацию',
        },
      ],
    });

    const data = dataOf(result);
    expect(data.decisions[0]!.finalAction).toBe('SELL');
    expect(data.decisions[0]!.veto).toBeNull();
  });

  it('правило применяется к любому активу, не только PLZL', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [
        createAsset({
          ticker: 'SBER',
          name: 'Сбер',
          balancePrice: 400,
          currentPrice: 200,
          status: 'REDUCE',
        }),
        createAsset({
          ticker: 'GAZP',
          name: 'Газпром',
          balancePrice: 300,
          currentPrice: 120,
        }),
      ],
      proposals: [
        { ticker: 'SBER', action: 'SELL', keyCatalysts: [] },
        {
          ticker: 'GAZP',
          action: 'REDUCE',
          keyCatalysts: [],
          rationale: 'stop-loss',
        },
      ],
    });

    const data = dataOf(result);
    expect(data.decisions).toHaveLength(2);
    expect(data.decisions[0]!.finalAction).toBe('HOLD');
    expect(data.decisions[1]!.finalAction).toBe('HOLD');
    expect(data.summary.actionsBlocked).toBe(2);
  });

  it('возвращает пустой результат при отсутствии входных данных', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({ assetsAnalysis: [], proposals: [] });

    expect(result.success).toBe(true);
    expect(dataOf(result).decisions).toHaveLength(0);
  });
});
