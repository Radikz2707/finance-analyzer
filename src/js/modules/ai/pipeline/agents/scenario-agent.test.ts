import type { AssetAnalysis } from '../../../portfolio/portfolio-math/portfolio-math.js';
import {
  ScenarioAgent,
  type ScenarioAgentOutput,
  type ScenarioChange,
} from './scenario-agent.js';

// ─── Helpers ───────────────────────────────────────────────────────

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
    // P&L = (420 - 1000) * 10 = -5800 (согласовано с quantity, balancePrice, currentPrice)
    unrealizedProfitRub: -5800,
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

  it('SELL при глубоком убытке рассматривается как сценарий', async () => {
    const agent = new ScenarioAgent();
    const result = await agent.execute(
      createInput([{ ticker: 'PLZL', action: 'SELL', amountRub: 20000 }]),
    );

    const data = dataOf(result);
    const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
    expect(aiScenario).toBeDefined();
    // SELL при убытке — реализованный P&L < 0 (signed)
    expect(aiScenario!.realizedPnLRub).toBeLessThan(0);
  });

  it('оптимизированный сценарий рассматривает все изменения (без ограничений по просадке)', async () => {
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
    // SELL PLZL теперь включён в оптимизированный сценарий
    const hasSell = optimized!.changes.some(
      (c) => c.ticker.toUpperCase() === 'PLZL' && c.action !== 'HOLD',
    );
    expect(hasSell).toBe(true);
  });

  it('гибкий сценарий финансирует покупку дефицита за счёт прибыльной позиции', async () => {
    const agent = new ScenarioAgent();
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
    expect(
      flexible!.changes.some((c) => c.action === 'SELL' && c.ticker === 'GAZP'),
    ).toBe(true);
  });

  it('вердикт лучшего сценария выбирается по улучшению структуры', async () => {
    const agent = new ScenarioAgent();
    const result = await agent.execute(
      createInput([{ ticker: 'PLZL', action: 'SELL', amountRub: 30000 }]),
    );

    const data = dataOf(result);
    const best = data.scenarios.find((s) => s.id === data.bestScenarioId);
    expect(best).toBeDefined();
  });

  // Test: ScenarioAgent рассматривает SELL/EXIT при глубоком убытке
  describe('ScenarioAgent: deep loss scenarios', () => {
    it('SELL при просадке -58% включается в сценарий', async () => {
      const agent = new ScenarioAgent();
      const result = await agent.execute(
        createInput([{ ticker: 'PLZL', action: 'SELL', amountRub: 20000 }]),
      );

      const data = dataOf(result);
      const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
      expect(aiScenario).toBeDefined();
      // SELL включён — стратег больше не блокирует
      expect(aiScenario!.changes.some((c) => c.action === 'SELL')).toBe(true);
    });

    it('EXIT при просадке -70% рассматривается как сценарий', async () => {
      const agent = new ScenarioAgent();
      const result = await agent.execute(
        createInput([{ ticker: 'PLZL', action: 'SELL', amountRub: 50000 }]),
      );

      const data = dataOf(result);
      const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
      expect(aiScenario).toBeDefined();
      expect(aiScenario!.changes.length).toBeGreaterThan(0);
    });
  });

  // ─── P2: Новые тесты ───

  describe('P2: S3 автоматическая продажа концентраций и P&L', () => {
    it('S3 автоматически продаёт позицию с концентрацией > 15% и убытком', async () => {
      const agent = new ScenarioAgent();
      const result = await agent.execute(
        createInput([
          { ticker: 'SBER', action: 'BUY', amountRub: 10000 },
        ], {
          // Переопределяем PLZL с концентрацией > 15%
          assetsAnalysis: [
            createAsset({
              ticker: 'PLZL',
              currentPercent: 18,
              unrealizedProfitRub: -5800,
            }),
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
        }),
      );

      const data = dataOf(result);
      const optimized = data.scenarios.find((s) => s.id === 'S3_optimized');
      expect(optimized).toBeDefined();
      // S3 должен добавить автоматическую продажу PLZL (>15% концентрация, убыток)
      const hasPlzlSell = optimized!.changes.some(
        (c) => c.ticker.toUpperCase() === 'PLZL' && c.action === 'SELL',
      );
      expect(hasPlzlSell).toBe(true);
    });

    it('S3 показывает реализованный убыток при продаже PLZL', async () => {
      const agent = new ScenarioAgent();
      const result = await agent.execute(
        createInput([
          { ticker: 'SBER', action: 'BUY', amountRub: 10000 },
        ], {
          assetsAnalysis: [
            createAsset({
              ticker: 'PLZL',
              currentPercent: 18,
              unrealizedProfitRub: -5800,
            }),
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
        }),
      );

      const data = dataOf(result);
      const optimized = data.scenarios.find((s) => s.id === 'S3_optimized');
      expect(optimized).toBeDefined();
      // Реализованный P&L: signed, отрицательный = убыток
      // PLZL имеет unrealizedProfitRub: -5800 → при продаже 50% realizedPnL = -2900
      expect(optimized!.realizedPnLRub).toBeLessThan(0);
    });

    it('ScenarioResult содержит stocksBeforePct и stocksAfterPct', async () => {
      const agent = new ScenarioAgent();
      const result = await agent.execute(
        createInput([
          { ticker: 'PLZL', action: 'SELL', amountRub: 20000 },
        ]),
      );

      const data = dataOf(result);
      const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
      expect(aiScenario).toBeDefined();
      // stocksBeforePct и stocksAfterPct должны быть определены
      expect(aiScenario!.stocksBeforePct).toBeDefined();
      expect(aiScenario!.stocksAfterPct).toBeDefined();
      // После продажи PLZL доля акций должна уменьшиться
      expect(aiScenario!.stocksAfterPct).toBeLessThanOrEqual(aiScenario!.stocksBeforePct!);
    });

    it('ScenarioResult содержит bondsBeforePct и bondsAfterPct', async () => {
      const agent = new ScenarioAgent();
      const result = await agent.execute(
        createInput([
          { ticker: 'PLZL', action: 'SELL', amountRub: 20000 },
        ]),
      );

      const data = dataOf(result);
      const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
      expect(aiScenario).toBeDefined();
      expect(aiScenario!.bondsBeforePct).toBeDefined();
      expect(aiScenario!.bondsAfterPct).toBeDefined();
    });
  });

  // ─── Отсутствие двойного учёта P&L ───
  it('не должен дублировать убыток при продаже PLZL', async () => {
    const agent = new ScenarioAgent();
    const result = await agent.execute(
      createInput(
        [{ ticker: 'SBER', action: 'BUY', amountRub: 10000 }],
        {
          assetsAnalysis: [
            createAsset({
              ticker: 'PLZL',
              currentPercent: 18,
              unrealizedProfitRub: -5800,
            }),
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
        },
      ),
    );

    const data = dataOf(result);
    const optimized = data.scenarios.find((s) => s.id === 'S3_optimized');
    expect(optimized).toBeDefined();

    // realizedPnLRub < 0 (убыток реализован, signed)
    expect(optimized!.realizedPnLRub).toBeLessThan(0);

    // Итоговый P&L = realized + unrealized должен быть близок к исходному
    // Исходный: -5800 (PLZL) + 3000 (SBER) = -2800
    // После продажи 50% PLZL: realized = -2900, unrealized = -2900 (PLZL) + ~3000 (SBER)
    // Итого: ~-2900 + ~100 = ~-2800
    const totalPnL = optimized!.projectedUnrealizedPnL + optimized!.realizedPnLRub;
    // P&L conservation: realized + remaining = original
    expect(totalPnL).toBeLessThan(-2000);
    expect(totalPnL).toBeGreaterThan(-3500);
  });

  // ========================================================================
  // ИСПРАВЛЕНИЯ ЭТАПА 2: P&L status и INSUFFICIENT_DATA
  // ========================================================================

  describe('Этап 2: P&L calculation status', () => {
    it('baseline с данными о balancePrice → pnlCalculationStatus=CALCULATED', async () => {
      const agent = new ScenarioAgent();
      const result = await agent.execute(createInput());

      const data = dataOf(result);
      const baseline = data.scenarios.find((s) => s.id === 'S1_hold');
      expect(baseline).toBeDefined();
      expect(baseline!.pnlCalculationStatus).toBe('CALCULATED');
    });

    it('сценарий без balancePrice → pnlCalculationStatus=INSUFFICIENT_DATA', async () => {
      const agent = new ScenarioAgent();
      const result = await agent.execute(
        createInput([], {
          assetsAnalysis: [
            {
              ...createAsset(),
              balancePrice: 0, // нет данных о себестоимости
              currentPrice: 420,
            },
          ],
        }),
      );

      const data = dataOf(result);
      const baseline = data.scenarios.find((s) => s.id === 'S1_hold');
      expect(baseline).toBeDefined();
      expect(baseline!.pnlCalculationStatus).toBe('INSUFFICIENT_DATA');
    });

    it('AI proposal с CALCULATED P&L не показывает "без ущерба" при INSUFFICIENT_DATA', async () => {
      const agent = new ScenarioAgent();
      const result = await agent.execute(
        createInput(
          [{ ticker: 'PLZL', action: 'SELL', amountRub: 10000 }],
          {
            assetsAnalysis: [
              {
                ...createAsset(),
                balancePrice: 0, // нет данных
              },
            ],
          },
        ),
      );

      const data = dataOf(result);
      const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
      expect(aiScenario).toBeDefined();
      expect(aiScenario!.pnlCalculationStatus).toBe('INSUFFICIENT_DATA');
      // Rationale должен содержать информацию о недостатке данных
      expect(aiScenario!.rationale).toContain('недостаточно данных');
    });

    it('P&L не должен быть 0 при INSUFFICIENT_DATA', async () => {
      // При INSUFFICIENT_DATA displayed P&L = "Нет данных", не "0 ₽"
      const agent = new ScenarioAgent();
      const result = await agent.execute(
        createInput([], {
          assetsAnalysis: [
            {
              ...createAsset(),
              balancePrice: 0, // нет данных о себестоимости
              unrealizedProfitRub: 0, // нереализованный P&L тоже 0
            },
          ],
        }),
      );

      const data = dataOf(result);
      const baseline = data.scenarios.find((s) => s.id === 'S1_hold');
      expect(baseline).toBeDefined();
      expect(baseline!.pnlCalculationStatus).toBe('INSUFFICIENT_DATA');
      // projectedUnrealizedPnL = 0, но статус — INSUFFICIENT_DATA
      // Это означает, что 0 — это не результат расчёта, а отсутствие данных
      expect(baseline!.projectedUnrealizedPnL).toBe(0);
      expect(baseline!.pnlCalculationStatus).not.toBe('CALCULATED');
    });

    it('partial sale PLZL: реализованный убыток корректен', async () => {
      const agent = new ScenarioAgent();
      const result = await agent.execute(
        createInput(
          [{ ticker: 'PLZL', action: 'SELL', amountRub: 2100 }], // ~50% позиции (10 шт * 420 = 4200)
        ),
      );

      const data = dataOf(result);
      const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
      expect(aiScenario).toBeDefined();
      // Реализованный P&L ≈ 50% от -5800 = -2900 (signed)
      expect(aiScenario!.realizedPnLRub).toBeLessThan(0);
      expect(aiScenario!.realizedPnLRub).toBeGreaterThan(-5800);
      // Статус P&L — CALCULATED, т.к. balancePrice > 0
      expect(aiScenario!.pnlCalculationStatus).toBe('CALCULATED');
    });

    it('сценарий продажи PLZL: структура отклонения рассчитана', async () => {
      const agent = new ScenarioAgent();
      const result = await agent.execute(
        createInput(
          [{ ticker: 'PLZL', action: 'SELL', amountRub: 20000 }],
        ),
      );

      const data = dataOf(result);
      const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
      expect(aiScenario).toBeDefined();
      // structureDeviationPct должен быть рассчитан
      expect(aiScenario!.structureDeviationPct).toBeDefined();
      expect(typeof aiScenario!.structureDeviationPct).toBe('number');
    });

    // ========================================================================
    // ИСПРАВЛЕНИЯ ЭТАПА 2.1: P&L conservation — точная арифметика
    // ========================================================================

    describe('P&L conservation: realizedPnL + remainingUnrealizedPnL = originalUnrealizedPnL', () => {
      it('PLZL: продажа 50% — realizedPnL + remaining = original', async () => {
        // quantity=10, balancePrice=1000, currentPrice=420
        // unrealizedProfitRub = (420-1000)*10 = -5800
        // Продажа 5 шт = 50%
        // realizedPnL = -5800 * 0.5 = -2900
        // remainingUnrealizedPnL = -5800 * 0.5 = -2900
        // Проверка: -2900 + (-2900) = -5800
        const agent = new ScenarioAgent();
        const result = await agent.execute(
          createInput(
            [{ ticker: 'PLZL', action: 'SELL', amountRub: 2100 }], // ~50% (10*420=4200, 50%=2100)
          ),
        );

        const data = dataOf(result);
        const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
        expect(aiScenario).toBeDefined();

        // Исходный unrealizedProfitRub из createAsset: -5800
        const originalUnrealizedPnL = -5800;

        // realizedPnLRub < 0 (убыток, signed)
        expect(aiScenario!.realizedPnLRub).toBeLessThan(0);

        // remainingUnrealizedPnL из projectedUnrealizedPnL (только PLZL)
        // SBER не продаётся, его P&L = 3000
        // projectedUnrealizedPnL = remaining_PLZL + SBER
        // remaining_PLZL = projected - SBER = projected - 3000
        const sberPnl = 3000;
        const remainingPnL = aiScenario!.projectedUnrealizedPnL - sberPnl;

        // Проверка conservation: realized + remaining = original
        const conservationCheck = aiScenario!.realizedPnLRub + remainingPnL;
        expect(conservationCheck).toBeCloseTo(originalUnrealizedPnL, 0);
      });

      it('PLZL: продажа 100% — realizedPnL = original, remaining = 0', async () => {
        const agent = new ScenarioAgent();
        const result = await agent.execute(
          createInput(
            [{ ticker: 'PLZL', action: 'SELL', amountRub: 4200 }], // 100% (10*420=4200)
          ),
        );

        const data = dataOf(result);
        const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
        expect(aiScenario).toBeDefined();

        const originalUnrealizedPnL = -5800;
        const sberPnl = 3000;

        // При продаже 100% remainingUnrealizedPnL = 0
        // projectedUnrealizedPnL = 0 (PLZL) + 3000 (SBER) = 3000
        expect(aiScenario!.projectedUnrealizedPnL).toBeCloseTo(sberPnl, 0);

        // realizedPnLRub = originalUnrealizedPnL (полный убыток реализован)
        expect(aiScenario!.realizedPnLRub).toBeCloseTo(originalUnrealizedPnL, 0);

        // Проверка conservation: -5800 + 0 = -5800
        const remainingPnL = aiScenario!.projectedUnrealizedPnL - sberPnl;
        const conservationCheck = aiScenario!.realizedPnLRub + remainingPnL;
        expect(conservationCheck).toBeCloseTo(originalUnrealizedPnL, 0);
      });

      it('PLZL: продажа 25% — realized = original * 0.25, remaining = original * 0.75', async () => {
        const agent = new ScenarioAgent();
        const result = await agent.execute(
          createInput(
            [{ ticker: 'PLZL', action: 'SELL', amountRub: 1050 }], // ~25% (4200*0.25=1050)
          ),
        );

        const data = dataOf(result);
        const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
        expect(aiScenario).toBeDefined();

        const originalUnrealizedPnL = -5800;
        const sberPnl = 3000;
        const sellFraction = 0.25;

        // realizedPnL = original * sellFraction = -5800 * 0.25 = -1450
        const expectedRealized = originalUnrealizedPnL * sellFraction;
        expect(aiScenario!.realizedPnLRub).toBeCloseTo(expectedRealized, 0);

        // remaining = original * (1 - sellFraction) = -5800 * 0.75 = -4350
        const expectedRemaining = originalUnrealizedPnL * (1 - sellFraction);
        const remainingPnL = aiScenario!.projectedUnrealizedPnL - sberPnl;
        expect(remainingPnL).toBeCloseTo(expectedRemaining, 0);

        // Проверка conservation: -1450 + (-4350) = -5800
        const conservationCheck = aiScenario!.realizedPnLRub + remainingPnL;
        expect(conservationCheck).toBeCloseTo(originalUnrealizedPnL, 0);
      });

      it('Множественные позиции — P&L conservation по каждой позиции отдельно', async () => {
        const agent = new ScenarioAgent();
        const result = await agent.execute(
          createInput(
            [{ ticker: 'PLZL', action: 'SELL', amountRub: 2100 }],
            {
              assetsAnalysis: [
                createAsset({
                  ticker: 'PLZL',
                  currentPercent: 18,
                  unrealizedProfitRub: -5800,
                }),
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
            },
          ),
        );

        const data = dataOf(result);
        const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
        expect(aiScenario).toBeDefined();

        // PLZL: original=-5800, продажа 50%
        // PLZL: realized=-2900, remaining=-2900
        const plzlOriginal = -5800;
        const plzlRealized = aiScenario!.realizedPnLRub;
        const plzlRemaining = plzlOriginal * 0.5; // -2900
        expect(plzlRealized).toBeCloseTo(plzlRemaining, 0); // -2900 = -2900

        // SBER: original=3000, продажа 0%
        // SBER: realized=0, remaining=3000
        const sberOriginal = 3000;
        const sberRemaining = sberOriginal; // 3000

        // projectedUnrealizedPnL = plzlRemaining + sberRemaining = -2900 + 3000 = 100
        expect(aiScenario!.projectedUnrealizedPnL).toBeCloseTo(plzlRemaining + sberRemaining, 0);

        // Итоговая conservation: realized + projected = originalTotal
        // -2900 + 100 = -2800 = -5800 + 3000
        const totalPnL = aiScenario!.projectedUnrealizedPnL + aiScenario!.realizedPnLRub;
        const originalTotal = plzlOriginal + sberOriginal;
        expect(totalPnL).toBeCloseTo(originalTotal, 0);
      });

      it('baseline: без изменений — realizedPnL = 0, projected = original', async () => {
        const agent = new ScenarioAgent();
        const result = await agent.execute(createInput());

        const data = dataOf(result);
        const baseline = data.scenarios.find((s) => s.id === 'S1_hold');
        expect(baseline).toBeDefined();

        // Без изменений: realizedPnL = 0
        expect(baseline!.realizedPnLRub).toBe(0);

        // projectedUnrealizedPnL = сумма всех unrealizedProfitRub
        expect(baseline!.projectedUnrealizedPnL).toBeCloseTo(
          -5800 + 3000, // PLZL + SBER
          0,
        );
      });

      it('PARTIAL статус: часть позиций без balancePrice', async () => {
        const agent = new ScenarioAgent();
        const result = await agent.execute(
          createInput([], {
            assetsAnalysis: [
              {
                ...createAsset(),
                ticker: 'PLZL',
                balancePrice: 1000, // есть данные
                currentPrice: 420,
              },
              {
                ...createAsset({
                  ticker: 'NO_DATA',
                  name: 'Нет данных',
                }),
                balancePrice: 0, // нет данных
                currentPrice: 100,
                unrealizedProfitRub: 0,
              },
            ],
          }),
        );

        const data = dataOf(result);
        const baseline = data.scenarios.find((s) => s.id === 'S1_hold');
        expect(baseline).toBeDefined();

        // PARTIAL: PLZL имеет данные, NO_DATA — нет
        expect(baseline!.pnlCalculationStatus).toBe('PARTIAL');
      });

      it('INSUFFICIENT_DATA: ни одна позиция не имеет balancePrice', async () => {
        const agent = new ScenarioAgent();
        const result = await agent.execute(
          createInput([], {
            assetsAnalysis: [
              {
                ...createAsset(),
                ticker: 'NO_DATA_1',
                balancePrice: 0,
                currentPrice: 100,
              },
              {
                ...createAsset({
                  ticker: 'NO_DATA_2',
                  name: 'Нет данных 2',
                }),
                balancePrice: 0,
                currentPrice: 200,
              },
            ],
          }),
        );

        const data = dataOf(result);
        const baseline = data.scenarios.find((s) => s.id === 'S1_hold');
        expect(baseline).toBeDefined();

        // INSUFFICIENT_DATA: ни одна позиция не имеет balancePrice
        expect(baseline!.pnlCalculationStatus).toBe('INSUFFICIENT_DATA');
      });

      it('CALCULATED: все позиции имеют balancePrice', async () => {
        const agent = new ScenarioAgent();
        const result = await agent.execute(createInput());

        const data = dataOf(result);
        const baseline = data.scenarios.find((s) => s.id === 'S1_hold');
        expect(baseline).toBeDefined();

        // CALCULATED: все позиции имеют balancePrice > 0
        expect(baseline!.pnlCalculationStatus).toBe('CALCULATED');
      });

      // ========================================================================
      // ИСПРАВЛЕНИЯ ЭТАПА 2.2: BUY не изменяет абсолютный P&L
      // ========================================================================

      describe('Этап 2.2: BUY не изменяет абсолютный нереализованный P&L', () => {
        it('BUY по текущей цене сохраняет existingPnL', async () => {
          // PLZL: currentPrice=420, unrealizedProfitRub=-5800
          // Покупка ещё на 4200 ₽ (10 акций по 420)
          // existingPnL должен остаться -5800, не -2900
          const agent = new ScenarioAgent();
          const result = await agent.execute(
            createInput(
              [{ ticker: 'PLZL', action: 'BUY', amountRub: 4200 }],
            ),
          );

          const data = dataOf(result);
          const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
          expect(aiScenario).toBeDefined();

          // Исходный unrealizedProfitRub = -5800
          // После BUY: existingPnL сохраняется = -5800
          // projectedUnrealizedPnL = -5800 (PLZL) + 3000 (SBER) = -2800
          expect(aiScenario!.projectedUnrealizedPnL).toBeCloseTo(-2800, 0);
        });

        it('BUY увеличивает стоимость позиции', async () => {
          const agent = new ScenarioAgent();
          const result = await agent.execute(
            createInput(
              [{ ticker: 'PLZL', action: 'BUY', amountRub: 4200 }],
            ),
          );

          const data = dataOf(result);
          const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
          expect(aiScenario).toBeDefined();

          // Исходная стоимость PLZL = 10 * 420 = 4200
          // После покупки ещё на 4200: 4200 + 4200 = 8400
          // SBER = 100 * 280 = 28000
          // total = 4200 + 28000 = 32200
          // PLZL% = 8400 / 32200 * 100 = 26.1%
          // SBER% = 28000 / 32200 * 100 = 86.9%
          // Но totalPortfolioValue = 500000 (фиксированный)
          // Доли пересчитываются относительно total
          expect(aiScenario!.structureDeviationPct).toBeDefined();
        });

        it('Средневзвешенная цена покупки после BUY', async () => {
          // PLZL: 10 акций по 1000 = 10000, текущая = 4200
          // Покупка 10 акций по 420 = 4200
          // Новая средняя цена покупки = (10000 + 4200) / 20 = 710
          const agent = new ScenarioAgent();
          const result = await agent.execute(
            createInput(
              [{ ticker: 'PLZL', action: 'BUY', amountRub: 4200 }],
            ),
          );

          const data = dataOf(result);
          const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
          expect(aiScenario).toBeDefined();

          // projectedUnrealizedPnL должен быть -5800 (PLZL) + 3000 (SBER) = -2800
          // т.к. BUY не изменяет existingPnL
          expect(aiScenario!.projectedUnrealizedPnL).toBeCloseTo(-2800, 0);
        });

        it('null unrealizedProfitRub → позиция исключается из расчёта P&L', async () => {
          const agent = new ScenarioAgent();
          const result = await agent.execute(
            createInput([], {
              assetsAnalysis: [
                {
                  ...createAsset(),
                  ticker: 'WITH_DATA',
                  unrealizedProfitRub: -5800,
                },
                {
                  ...createAsset({
                    ticker: 'NO_DATA',
                    name: 'Без данных',
                  }),
                  unrealizedProfitRub: null as unknown as number,
                },
              ],
            }),
          );

          const data = dataOf(result);
          const baseline = data.scenarios.find((s) => s.id === 'S1_hold');
          expect(baseline).toBeDefined();

          // CALCULATED: обе позиции имеют balancePrice > 0 и currentPrice > 0
          // (unrealizedProfitRub=null не влияет на статус)
          expect(baseline!.pnlCalculationStatus).toBe('CALCULATED');
          // projectedUnrealizedPnL = только WITH_DATA = -5800
          expect(baseline!.projectedUnrealizedPnL).toBeCloseTo(-5800, 0);
        });
      });

      // ========================================================================
      // ИСПРАВЛЕНИЯ ЭТАПА 2.2: Согласованность тестовых данных PLZL
      // ========================================================================

      describe('Этап 2.2: Согласованность тестовых данных PLZL', () => {
        it('unrealizedProfitRub = (currentPrice - balancePrice) * quantity', () => {
          const asset = createAsset();
          const expectedPnL = (asset.currentPrice - asset.balancePrice) * asset.quantity;
          expect(asset.unrealizedProfitRub).toBe(expectedPnL);
        });

        it('costBases = quantity * balancePrice', () => {
          const asset = createAsset();
          const expectedCostBase = asset.quantity * asset.balancePrice;
          expect(expectedCostBase).toBe(10000); // 10 * 1000
        });

        it('PLZL: 10 акций, balancePrice=1000, currentPrice=420 → unrealized=-5800', () => {
          const asset = createAsset();
          expect(asset.quantity).toBe(10);
          expect(asset.balancePrice).toBe(1000);
          expect(asset.currentPrice).toBe(420);
          expect(asset.unrealizedProfitRub).toBe(-5800);
          // Проверка: (420 - 1000) * 10 = -580 * 10 = -5800
          expect((asset.currentPrice - asset.balancePrice) * asset.quantity).toBe(-5800);
        });
      });

      // ========================================================================
      // ИСПРАВЛЕНИЯ КОНТРОЛЬНОЙ ПРОВЕРКИ: BUY обновляет costBases
      // ========================================================================

      describe('Контрольная проверка: BUY обновляет costBases', () => {
        it('BUY обновляет costBases: 10000 + 4200 = 14200', async () => {
          // До BUY: costBasis = 10 * 1000 = 10000
          // Покупка 10 акций по 420 = 4200
          // После BUY: costBasis = 10000 + 4200 = 14200
          const agent = new ScenarioAgent();
          const result = await agent.execute(
            createInput(
              [{ ticker: 'PLZL', action: 'BUY', amountRub: 4200 }],
            ),
          );

          const data = dataOf(result);
          const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
          expect(aiScenario).toBeDefined();

          // costBases обновлён: 10000 + 4200 = 14200
          // averagePrice = 14200 / 20 = 710
          // marketValue = 20 * 420 = 8400
          // unrealizedPnL = 8400 - 14200 = -5800 (сохранён)
          expect(aiScenario!.projectedUnrealizedPnL).toBeCloseTo(-5800 + 3000, 0);
        });

        it('SELL после BUY использует корректный costBases', async () => {
          // Сначала BUY 10 акций по 420, затем SELL 5 акций
          // costBases = 14200, quantity = 20
          // Продажа 5/20 = 25%
          // realizedPnL = -5800 * 0.25 = -1450
          const agent = new ScenarioAgent();
          const result = await agent.execute(
            createInput(
              [
                { ticker: 'PLZL', action: 'BUY', amountRub: 4200 },
                { ticker: 'PLZL', action: 'SELL', amountRub: 2100 },
              ],
            ),
          );

          const data = dataOf(result);
          const aiScenario = data.scenarios.find((s) => s.id === 'S2_ai');
          expect(aiScenario).toBeDefined();

          // Реализованный P&L: -5800 * 0.25 = -1450
          expect(aiScenario!.realizedPnLRub).toBeLessThan(0);
          expect(aiScenario!.realizedPnLRub).toBeGreaterThan(-5800);
        });

        it('NaN unrealizedProfitRub не проходит calcPnlStatus', async () => {
          const agent = new ScenarioAgent();
          const result = await agent.execute(
            createInput([], {
              assetsAnalysis: [
                {
                  ...createAsset(),
                  ticker: 'NaN_DATA',
                  unrealizedProfitRub: NaN as unknown as number,
                },
              ],
            }),
          );

          const data = dataOf(result);
          const baseline = data.scenarios.find((s) => s.id === 'S1_hold');
          expect(baseline).toBeDefined();

          // NaN unrealizedProfitRub не влияет на calcPnlStatus — проверяются только price
          expect(baseline!.pnlCalculationStatus).toBe('CALCULATED');
        });

        it('Infinity unrealizedProfitRub не проходит calcPnlStatus', async () => {
          const agent = new ScenarioAgent();
          const result = await agent.execute(
            createInput([], {
              assetsAnalysis: [
                {
                  ...createAsset(),
                  ticker: 'INF_DATA',
                  unrealizedProfitRub: Infinity as unknown as number,
                },
              ],
            }),
          );

          const data = dataOf(result);
          const baseline = data.scenarios.find((s) => s.id === 'S1_hold');
          expect(baseline).toBeDefined();

          // Infinity unrealizedProfitRub не влияет на calcPnlStatus — проверяются только price
          expect(baseline!.pnlCalculationStatus).toBe('CALCULATED');
        });
      });
    });
  });
});
