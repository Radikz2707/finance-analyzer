import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import {
  StrategistAgent,
  type StrategistAgentOutput,
} from './strategist-agent.js';

// ─── Helpers ───────────────────────────────────────────────────────

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
  it('НЕ блокирует SELL при просадке 58% — стратег аналитик, не вето', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [createAsset()],
      proposals: [
        {
          ticker: 'PLZL',
          action: 'SELL',
          keyCatalysts: [],
          rationale: 'Фундаментальное ухудшение',
        },
      ],
    });

    expect(result.success).toBe(true);
    const data = dataOf(result);
    expect(data.decisions).toHaveLength(1);
    expect(data.decisions[0]!.suggestedAction).toBe('SELL');
    expect(data.decisions[0]!.finalAction).toBe('SELL'); // НЕ HOLD
    expect(data.decisions[0]!.note).toContain('Глубокая просадка');
    expect(data.decisions[0]!.drawdownPercent).toBeCloseTo(-58, 1);
  });

  it('НЕ блокирует EXIT при просадке 70%', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [
        createAsset({
          balancePrice: 1000,
          currentPrice: 300,
          unrealizedProfitRub: -70000,
        }),
      ],
      proposals: [
        {
          ticker: 'PLZL',
          action: 'EXIT',
          keyCatalysts: [],
          rationale: 'Полный выход',
        },
      ],
    });

    const data = dataOf(result);
    expect(data.decisions[0]!.finalAction).toBe('EXIT');
  });

  it('НЕ блокирует REDUCE при просадке 58%', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [createAsset()],
      proposals: [
        {
          ticker: 'PLZL',
          action: 'REDUCE',
          keyCatalysts: [],
          rationale: 'Снижение целевой доли',
        },
      ],
    });

    const data = dataOf(result);
    expect(data.decisions[0]!.finalAction).toBe('REDUCE');
  });

  it('НЕ блокирует BUY даже при глубокой просадке', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [createAsset()],
      proposals: [{ ticker: 'PLZL', action: 'BUY', keyCatalysts: [] }],
    });

    const data = dataOf(result);
    expect(data.decisions[0]!.finalAction).toBe('BUY');
  });

  it('НЕ блокирует SELL при небольшой просадке', async () => {
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
    // Стратег НЕ блокирует — finalAction = suggestedAction
    expect(data.decisions[0]!.finalAction).toBe('SELL');
    expect(data.decisions[1]!.finalAction).toBe('REDUCE');
  });

  it('возвращает пустой результат при отсутствии входных данных', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({ assetsAnalysis: [], proposals: [] });

    expect(result.success).toBe(true);
    expect(dataOf(result).decisions).toHaveLength(0);
  });

  it('указывает на риск концентрации', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [
        createAsset({
          currentPercent: 35,
          balancePrice: 1000,
          currentPrice: 420,
        }),
      ],
      proposals: [
        {
          ticker: 'PLZL',
          action: 'SELL',
          keyCatalysts: [],
          rationale: 'Высокая концентрация',
        },
      ],
    });

    const data = dataOf(result);
    expect(data.decisions[0]!.note).toContain('Высокая концентрация');
    expect(data.decisions[0]!.finalAction).toBe('SELL');
  });
});
