import type { AssetAnalysis } from '../../../portfolio/portfolio-math/portfolio-math.js';
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

  it('якорь берёт BROKER и дату Excel из метаданных', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [
        createAsset({
          ticker: 'SBER',
          name: 'Сбер',
          assetType: 'STOCK',
          currentPercent: 10,
          currentPrice: 100,
        }),
      ],
      proposals: [
        {
          ticker: 'SBER',
          action: 'HOLD',
          keyCatalysts: [],
          rationale: 'Держать',
        },
      ],
      dividendYields: { SBER: 50 },
      dividendYieldsMeta: {
        SBER: {
          source: 'BROKER',
          asOf: '2026-11-17T00:00:00.000Z',
          kind: 'LTM',
        },
      },
    });

    const anchor = (dataOf(result).strategies ?? [])[0]?.incomeAnchor;
    expect(anchor?.dividendSource).toBe('BROKER');
    expect(anchor?.dividendAsOf).toBe('2026-11-17T00:00:00.000Z');
    expect(anchor?.text).toContain('BROKER');
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

describe('StrategistAgent — детерминированные стратегии', () => {
  const sber = createAsset({
    ticker: 'SBER',
    name: 'Сбер',
    assetType: 'А',
    currentPercent: 10,
    targetPercent: 15,
    deficitRub: 5000,
    status: 'BUY',
    balancePrice: 300,
    currentPrice: 320,
    unrealizedProfitRub: 2000,
  });

  const gazp = createAsset({
    ticker: 'GAZP',
    name: 'Газпром',
    assetType: 'А',
    currentPercent: 20,
    targetPercent: 16,
    deficitRub: -4000,
    status: 'REDUCE',
    balancePrice: 200,
    currentPrice: 180,
    unrealizedProfitRub: -2000,
  });

  it('строит три стратегии без рейтинга и прогнозов доходности', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [sber, gazp],
      proposals: [
        { ticker: 'SBER', action: 'BUY', keyCatalysts: [] },
        { ticker: 'GAZP', action: 'REDUCE', keyCatalysts: [] },
      ],
    });

    const data = dataOf(result);
    expect(data.strategies).toHaveLength(3);

    for (const strategy of data.strategies!) {
      expect(strategy).not.toHaveProperty('rating');
      expect(strategy).not.toHaveProperty('forecast');
      expect(strategy).not.toHaveProperty('expectedReturn');
    }

    const full = data.strategies![0]!;
    expect(full.name).toBe('Ребалансировка полная');
    expect(
      full.steps.some(
        (step) => step.ticker === 'SBER' && step.action === 'Купить',
      ),
    ).toBe(true);
    expect(
      full.steps.some(
        (step) => step.ticker === 'GAZP' && step.action === 'Продать',
      ),
    ).toBe(true);

    for (const step of full.steps) {
      expect(`${step.amount} ${step.rationale}`).not.toMatch(
        /профит|прибыл|перспектив|освобожда/i,
      );
    }
    expect(full.steps[0]!.amount).toContain('дефицит доли');
    expect(full.steps[1]!.amount).toContain('профицит доли');
  });

  it('не продаёт PLZL при noSellTickers', async () => {
    const agent = new StrategistAgent();
    const frozen = createAsset({
      ticker: 'PLZL',
      name: 'Полюс',
      assetType: 'А',
      currentPercent: 12,
      targetPercent: 8,
      deficitRub: -58000,
      status: 'REDUCE',
      balancePrice: 1000,
      currentPrice: 420,
      unrealizedProfitRub: -58000,
    });

    const result = await agent.execute({
      assetsAnalysis: [frozen],
      proposals: [{ ticker: 'PLZL', action: 'REDUCE', keyCatalysts: [] }],
      noSellTickers: ['PLZL'],
    });

    const data = dataOf(result);
    for (const strategy of data.strategies!) {
      expect(
        strategy.steps.some(
          (step) => step.ticker === 'PLZL' && step.action === 'Продать',
        ),
      ).toBe(false);
    }
    // Продажа не предлагается вовсе, причина попадает в предупреждения.
    expect(
      data.policyWarnings?.some((warning) => warning.includes('PLZL')),
    ).toBe(true);
    expect(data.strategyConflicts ?? []).toHaveLength(0);
  });

  it('не продаёт облигации при noSellAssetTypes', async () => {
    const agent = new StrategistAgent();
    const bond = createAsset({
      ticker: 'RU000A10C8F3',
      name: 'Облигация',
      assetType: 'О',
      currentPercent: 20,
      targetPercent: 15,
      deficitRub: -5000,
      status: 'REDUCE',
      balancePrice: 1000,
      currentPrice: 1000,
      nominal: 1000,
      unrealizedProfitRub: 0,
    });

    const result = await agent.execute({
      assetsAnalysis: [bond],
      proposals: [
        { ticker: 'RU000A10C8F3', action: 'REDUCE', keyCatalysts: [] },
      ],
      noSellAssetTypes: ['О'],
    });

    const data = dataOf(result);
    for (const strategy of data.strategies!) {
      expect(
        strategy.steps.some(
          (step) => step.ticker === 'RU000A10C8F3' && step.action === 'Продать',
        ),
      ).toBe(false);
    }
    expect(
      data.policyWarnings?.some((warning) => warning.includes('RU000A10C8F3')),
    ).toBe(true);
    expect(data.strategyConflicts ?? []).toHaveLength(0);
  });
  it('консервативная стратегия покупает только в пределах взноса и не продаёт', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [sber, gazp],
      proposals: [
        { ticker: 'SBER', action: 'BUY', keyCatalysts: [] },
        { ticker: 'GAZP', action: 'REDUCE', keyCatalysts: [] },
      ],
      monthlyContribution: 3000,
    });

    const conservative = dataOf(result).strategies![2]!;
    expect(conservative.name).toBe('Консервативная');
    expect(conservative.steps.some((step) => step.action === 'Продать')).toBe(
      false,
    );

    const total = conservative.steps.reduce(
      (sum, step) => sum + step.amountRub,
      0,
    );
    expect(total).toBeLessThanOrEqual(3000);
  });

  it('строит покупки по дефициту даже при AI-решении HOLD', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [sber],
      proposals: [{ ticker: 'SBER', action: 'HOLD', keyCatalysts: [] }],
    });

    const data = dataOf(result);
    expect(
      data.strategies![0]!.steps.some(
        (step) => step.ticker === 'SBER' && step.action === 'Купить',
      ),
    ).toBe(true);
    expect(data.strategyConflicts ?? []).toHaveLength(0);
  });

  it('считает якорь по покрытым бумагам и перечисляет непокрытые', async () => {
    const agent = new StrategistAgent();
    const coveredBond = createAsset({
      ticker: 'RU000A10C8F3',
      name: 'Облигация',
      assetType: 'О',
      currentPercent: 50,
      targetPercent: 50,
      deficitRub: 0,
      status: 'HOLD',
      balancePrice: 1000,
      currentPrice: 1000,
      nominal: 1000,
      unrealizedProfitRub: 0,
    });
    const missingBond = createAsset({
      ticker: 'SU29027RMFS8',
      name: 'ОФЗ 29027',
      assetType: 'О',
      currentPercent: 10,
      targetPercent: 10,
      deficitRub: 0,
      status: 'HOLD',
      balancePrice: 1000,
      currentPrice: 1000,
      nominal: 1000,
      unrealizedProfitRub: 0,
    });

    const result = await agent.execute({
      assetsAnalysis: [coveredBond, missingBond, sber],
      proposals: [
        { ticker: 'RU000A10C8F3', action: 'HOLD', keyCatalysts: [] },
        { ticker: 'SU29027RMFS8', action: 'HOLD', keyCatalysts: [] },
        { ticker: 'SBER', action: 'BUY', keyCatalysts: [] },
      ],
      bondYields: { RU000A10C8F3: 12 },
      dividendYields: { SBER: 8 },
    });

    const anchor = dataOf(result).strategies![0]!.incomeAnchor;
    expect(anchor.bondYieldPercent).toBeCloseTo(6, 1);
    expect(anchor.dividendYieldPercent).toBeCloseTo(0.8, 1);
    expect(anchor.totalYieldPercent).toBeCloseTo(6.8, 1);
    expect(anchor.text).toContain('SU29027RMFS8');
  });

  it('считает купонно-дивидендный якорь из доходностей и долей', async () => {
    const agent = new StrategistAgent();
    const bond = createAsset({
      ticker: 'RU000A10C8F3',
      name: 'Облигация',
      assetType: 'О',
      currentPercent: 50,
      targetPercent: 50,
      deficitRub: 0,
      status: 'HOLD',
      balancePrice: 1000,
      currentPrice: 1000,
      nominal: 1000,
      unrealizedProfitRub: 0,
    });

    const result = await agent.execute({
      assetsAnalysis: [bond, sber],
      proposals: [
        { ticker: 'RU000A10C8F3', action: 'HOLD', keyCatalysts: [] },
        { ticker: 'SBER', action: 'BUY', keyCatalysts: [] },
      ],
      bondYields: { RU000A10C8F3: 12 },
      dividendYields: { SBER: 8 },
    });

    const anchor = dataOf(result).strategies![0]!.incomeAnchor;
    expect(anchor.bondYieldPercent).toBeCloseTo(6, 1);
    expect(anchor.dividendYieldPercent).toBeCloseTo(0.8, 1);
    expect(anchor.totalYieldPercent).toBeCloseTo(6.8, 1);
    expect(anchor.text).toContain('6,8% годовых');
    expect(anchor.text).toContain('рыночная переоценка не прогнозируется');
  });

  it('честно пишет «прогноз недоступен» без дивидендных данных', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [sber],
      proposals: [{ ticker: 'SBER', action: 'BUY', keyCatalysts: [] }],
      dividendYields: {},
    });

    const anchor = dataOf(result).strategies![0]!.incomeAnchor;
    expect(anchor.totalYieldPercent).toBeNull();
    expect(anchor.unavailableReason).toContain('нет дивидендных данных');
    expect(anchor.text).toContain('Прогноз недоступен');
  });

  it('строит покупки по реальному знаку deficitDeviationPct и не продаёт PLZL', async () => {
    const agent = new StrategistAgent();
    const result = await agent.execute({
      assetsAnalysis: [
        createAsset({
          ticker: 'IRAO',
          name: 'Ирао',
          currentPercent: 5.6,
          targetPercent: 15,
          deficitRub: 57467,
          status: 'BUY',
          deficitDeviationPct: -9.4,
          balancePrice: 10,
          currentPrice: 12,
          unrealizedProfitRub: 0,
          isConcentrated: false,
        }),
        createAsset({
          ticker: 'TATN',
          name: 'Татнефть',
          currentPercent: 12,
          targetPercent: 10,
          deficitRub: -20000,
          status: 'REDUCE',
          deficitDeviationPct: 2,
          balancePrice: 500,
          currentPrice: 550,
          unrealizedProfitRub: 1000,
          isConcentrated: false,
        }),
        createAsset({
          ticker: 'PLZL',
          currentPercent: 19.8,
          targetPercent: 10,
          deficitRub: -58000,
          status: 'REDUCE',
          deficitDeviationPct: 9.8,
        }),
      ],
      proposals: [
        { ticker: 'IRAO', action: 'BUY', keyCatalysts: [] },
        { ticker: 'TATN', action: 'REDUCE', keyCatalysts: [] },
        { ticker: 'PLZL', action: 'REDUCE', keyCatalysts: [] },
      ],
      noSellTickers: ['PLZL'],
    });

    const steps = dataOf(result).strategies![0]!.steps;
    const tickers = steps.map((step) => step.ticker);

    expect(tickers).toContain('IRAO');
    expect(tickers).toContain('TATN');
    expect(tickers).not.toContain('PLZL');
  });
});
