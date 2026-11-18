import type { AssetAnalysis } from '../../../portfolio/portfolio-math/portfolio-math.js';
import type { AiAction } from '../../../research/types.js';
import type {
  InvestmentStrategy,
  StrategyIncomeAnchor,
  StrategyStep,
  StrategistDecision,
} from './strategist-agent.js';
import {
  isBuyAllowedByMath,
  validateStrategyConsistency,
} from './strategy-validator.js';

const EMPTY_ANCHOR: StrategyIncomeAnchor = {
  bondYieldPercent: null,
  dividendYieldPercent: null,
  totalYieldPercent: null,
  unavailableReason: 'нет данных',
  dividendSource: null,
  dividendAsOf: null,
  dividendKind: null,
  text: 'Прогноз недоступен.',
};

function createAsset(o: Partial<AssetAnalysis> = {}): AssetAnalysis {
  return {
    name: 'Сбер',
    ticker: 'SBER',
    assetType: 'А',
    currentPercent: 10,
    targetPercent: 15,
    deficitRub: 5000,
    status: 'BUY',
    dynamicsPercent: 0,
    nkdRub: 0,
    nominal: 0,
    quantity: 10,
    balancePrice: 300,
    currentPrice: 320,
    unrealizedProfitRub: 2000,
    priority: 0,
    isConcentrated: false,
    ...o,
  };
}

function createDecision(
  ticker: string,
  finalAction: AiAction | null,
  drawdownPercent: number | null = 0,
): StrategistDecision {
  return {
    ticker,
    name: ticker,
    suggestedAction: finalAction,
    finalAction,
    drawdownPercent,
    concentrationPercent: 10,
    note: null,
    hasConflict: false,
  };
}

function createStep(
  ticker: string,
  action: string,
  overrides: Partial<StrategyStep> = {},
): StrategyStep {
  return {
    order: 1,
    action,
    ticker,
    amountRub: 1000,
    amount: 'на 1 000 ₽ — дефицит доли 1,0 п.п.',
    deviationPp: 1,
    rationale: 'Соответствует действию карточки BUY.',
    ...overrides,
  };
}

function createStrategy(steps: StrategyStep[]): InvestmentStrategy {
  return {
    name: 'Тестовая стратегия',
    description: 'Тест',
    steps,
    incomeAnchor: EMPTY_ANCHOR,
    riskLevel: 'MEDIUM',
  };
}

describe('strategy-validator', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('STRATEGY_CONFLICT: продажа при карточке HOLD', () => {
    const conflicts = validateStrategyConsistency(
      [createStrategy([createStep('SBER', 'Продать')])],
      [createDecision('SBER', 'HOLD')],
      [createAsset({ status: 'HOLD', deficitRub: 0 })],
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.code).toBe('STRATEGY_CONFLICT');
    expect(conflicts[0]!.reason).toContain('HOLD');
  });

  it('STRATEGY_CONFLICT: покупка при карточке REDUCE', () => {
    const conflicts = validateStrategyConsistency(
      [createStrategy([createStep('GAZP', 'Купить')])],
      [createDecision('GAZP', 'REDUCE')],
      [
        createAsset({
          ticker: 'GAZP',
          status: 'REDUCE',
          deficitRub: -4000,
        }),
      ],
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toContain('REDUCE');
  });

  it('STRATEGY_CONFLICT: продажа запрещена noSellTickers', () => {
    const conflicts = validateStrategyConsistency(
      [createStrategy([createStep('PLZL', 'Продать')])],
      [createDecision('PLZL', 'REDUCE')],
      [
        createAsset({
          ticker: 'PLZL',
          status: 'REDUCE',
          deficitRub: -58000,
          balancePrice: 1000,
          currentPrice: 420,
          unrealizedProfitRub: -58000,
        }),
      ],
      { noSellTickers: ['PLZL'] },
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toContain('no-sell');
  });

  it('STRATEGY_CONFLICT: продажа облигаций запрещена noSellAssetTypes', () => {
    const conflicts = validateStrategyConsistency(
      [createStrategy([createStep('RU000A10C8F3', 'Продать')])],
      [createDecision('RU000A10C8F3', 'REDUCE')],
      [
        createAsset({
          ticker: 'RU000A10C8F3',
          assetType: 'О',
          status: 'REDUCE',
          deficitRub: -5000,
          nominal: 1000,
          balancePrice: 1000,
          currentPrice: 1000,
          unrealizedProfitRub: 0,
        }),
      ],
      { noSellAssetTypes: ['О'] },
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toContain('no-sell');
  });

  it('STRATEGY_CONFLICT: «профит» при реальном убытке', () => {
    const conflicts = validateStrategyConsistency(
      [
        createStrategy([
          createStep('PLZL', 'Продать', {
            amount: 'на 58 000 ₽ — профит покрыт',
            rationale: 'Освобождаем капитал',
          }),
        ]),
      ],
      [createDecision('PLZL', 'REDUCE', -58)],
      [
        createAsset({
          ticker: 'PLZL',
          status: 'REDUCE',
          deficitRub: -58000,
          balancePrice: 1000,
          currentPrice: 420,
          unrealizedProfitRub: -58000,
        }),
      ],
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toContain('профите');
  });

  it('покупка при AI-карточке HOLD разрешена, если PortfolioMath видит дефицит', () => {
    const conflicts = validateStrategyConsistency(
      [createStrategy([createStep('SBER', 'Купить')])],
      [createDecision('SBER', 'HOLD')],
      [
        createAsset({
          status: 'BUY',
          deficitRub: 5000,
          currentPercent: 10,
          targetPercent: 15,
        }),
      ],
    );

    expect(conflicts).toHaveLength(0);
  });

  it('покупка запрещена при отклонении ≤ 0,5 п.п.', () => {
    const conflicts = validateStrategyConsistency(
      [createStrategy([createStep('SBER', 'Купить')])],
      [createDecision('SBER', 'BUY')],
      [
        createAsset({
          status: 'BUY',
          deficitRub: 1000,
          currentPercent: 14.8,
          targetPercent: 15,
        }),
      ],
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toContain('0,5');
  });

  it('продажа при профиците и REDUCE разрешена даже при AI-карточке HOLD', () => {
    const conflicts = validateStrategyConsistency(
      [createStrategy([createStep('GAZP', 'Продать')])],
      [createDecision('GAZP', 'HOLD')],
      [
        createAsset({
          ticker: 'GAZP',
          status: 'REDUCE',
          deficitRub: -4000,
          currentPercent: 20,
          targetPercent: 16,
        }),
      ],
    );

    expect(conflicts).toHaveLength(0);
  });

  it('продажа запрещена при PortfolioMath=BUY даже при профиците', () => {
    const conflicts = validateStrategyConsistency(
      [createStrategy([createStep('SBER', 'Продать')])],
      [createDecision('SBER', 'BUY')],
      [
        createAsset({
          status: 'BUY',
          deficitRub: -1000,
          currentPercent: 16,
          targetPercent: 15,
        }),
      ],
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toContain('BUY');
  });

  it('не находит конфликтов в согласованных шагах', () => {
    const conflicts = validateStrategyConsistency(
      [
        createStrategy([
          createStep('SBER', 'Купить'),
          createStep('GAZP', 'Продать', {
            amount: 'на 4 000 ₽ — профицит доли 4,0 п.п.',
            rationale: 'Сокращение соответствует действию карточки REDUCE.',
          }),
        ]),
      ],
      [createDecision('SBER', 'BUY'), createDecision('GAZP', 'REDUCE')],
      [
        createAsset(),
        createAsset({
          ticker: 'GAZP',
          status: 'REDUCE',
          deficitRub: -4000,
          balancePrice: 200,
          currentPrice: 180,
          unrealizedProfitRub: -2000,
        }),
      ],
    );

    expect(conflicts).toHaveLength(0);
  });

  it('покупка разрешена при реальном знаке deficitDeviationPct (current − target)', () => {
    const irao = createAsset({
      ticker: 'IRAO',
      currentPercent: 5.6,
      targetPercent: 15,
      deficitRub: 57467,
      status: 'BUY',
      // Реальный PortfolioMath: current − target = 5.6 − 15 = −9.4
      deficitDeviationPct: -9.4,
    });

    expect(isBuyAllowedByMath(irao)).toBe(true);
  });

  it('NEW-ОФЗ с дефицитом и отклонением ровно 0.5 п.п. разрешена к покупке', () => {
    const ofz = createAsset({
      ticker: 'SU26238RMFS4',
      assetType: 'О',
      currentPercent: 9.5,
      targetPercent: 10,
      deficitRub: 5168,
      status: 'NEW',
      deficitDeviationPct: -0.5,
    });

    expect(isBuyAllowedByMath(ofz)).toBe(true);
  });

  it('покупка запрещена при профиците (deficitDeviationPct > 0)', () => {
    const plzl = createAsset({
      ticker: 'PLZL',
      currentPercent: 19.8,
      targetPercent: 10,
      deficitRub: -50000,
      status: 'REDUCE',
      deficitDeviationPct: 9.8,
    });

    expect(isBuyAllowedByMath(plzl)).toBe(false);
  });
});
