/**
 * ScenarioAgent — агент сценарного моделирования («что если»).
 *
 * Роль: гибкость. Перед принятием решения о продаже/покупке строит
 * несколько моделей будущего портфеля и оценивает каждую:
 *   S1. Удержание (baseline) — ничего не меняем;
 *   S2. Предложение AI — как предлагает LLM;
 *   S3. Оптимизированный вариант — избегает фиксации глубоких убытков,
 *       покупки финансируются свободными средствами или продажей
 *       прибыльных позиций;
 *   S4. Гибкий вариант — комбинация улучшений (если применимо).
 *
 * Модель детерминированная (без LLM): пересчитывает доли, отклонение
 * структуры от целевых значений и нереализованный P&L. Вердикт
 * IMPROVES/WORSENS/NEUTRAL передаётся в Consilium как голос агента.
 */

import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import type { AiAction } from '../../research/types.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';

// ──────────────────────────────────────────────
// 1. Types
// ──────────────────────────────────────────────

/** Одно изменение в сценарии */
export interface ScenarioChange {
  ticker: string;
  /** Что делаем с активом */
  action: Extract<AiAction, 'BUY' | 'SELL' | 'REDUCE'> | 'HOLD';
  /** Сумма операции, руб (для BUY/SELL/REDUCE) */
  amountRub: number;
}

/** Входные данные ScenarioAgent */
export interface ScenarioAgentInput {
  /** Анализ всех активов портфеля */
  assetsAnalysis: AssetAnalysis[];
  /** Общая стоимость портфеля, руб */
  totalPortfolioValue: number;
  /** Свободные средства, руб */
  freeCashRub: number;
  /** Предложенные AI изменения (проверяются и улучшаются) */
  proposedChanges: ScenarioChange[];
}

/** Результат одного сценария */
export interface ScenarioResult {
  /** Уникальный ID сценария */
  id: string;
  /** Человекочитаемый заголовок */
  title: string;
  /** Изменения в сценарии */
  changes: ScenarioChange[];
  /** Отклонение структуры от целевых долей после сценария, п.п. */
  structureDeviationPct: number;
  /** Прогноз нереализованного P&L после сценария, руб */
  projectedUnrealizedPnL: number;
  /** Зафиксированный убыток в сценарии, руб (0 если нет) */
  realizedLossRub: number;
  /** Оценка сценария */
  verdict: 'IMPROVES' | 'WORSENS' | 'NEUTRAL';
  /** Почему такой вердикт */
  rationale: string;
}

/** Выходные данные ScenarioAgent */
export interface ScenarioAgentOutput {
  /** Все построенные сценарии (первый — baseline) */
  scenarios: ScenarioResult[];
  /** Лучший сценарий по оценке агента */
  bestScenarioId: string | null;
  /** Сводка */
  summary: {
    scenariosBuilt: number;
    baselineDeviationPct: number;
    bestImprovementPct: number;
  };
}

// ──────────────────────────────────────────────
// 2. ScenarioAgent
// ──────────────────────────────────────────────

const BASE_CHANGE_THRESHOLD_PCT = 1.5; // значимое улучшение структуры, п.п.
const MIN_BUDGET_RUB = 5000; // минимальный бюджет для сценария покупки
const MIN_BUY_RUB = 1000; // минимальная сумма покупки

/**
 * ScenarioAgent — агент «что если».
 *
 * Строит детерминированные сценарии и выбирает лучший по двум осям:
 * структура портфеля (отклонение от целевых долей) и P&L (не ухудшать,
 * не фиксировать глубокие убытки).
 */
export class ScenarioAgent extends AgentBase {
  constructor(config?: AgentConfig) {
    super(config ?? { name: 'ScenarioAgent' });
  }

  protected async executeInternal(
    input: ScenarioAgentInput,
  ): Promise<ScenarioAgentOutput> {
    const assets = input?.assetsAnalysis ?? [];
    const total = input?.totalPortfolioValue ?? 0;
    const freeCash = input?.freeCashRub ?? 0;
    const proposed = input?.proposedChanges ?? [];

    if (assets.length === 0 || total <= 0) {
      return this.emptyResult();
    }

    const baselineDeviation = this.calcStructureDeviation(assets);
    const baselinePnL = this.sumUnrealizedPnL(assets);

    const scenarios: ScenarioResult[] = [];

    // S1: Baseline — удержание
    scenarios.push({
      id: 'S1_hold',
      title: 'Удержание (baseline) — ничего не меняем',
      changes: [],
      structureDeviationPct: baselineDeviation,
      projectedUnrealizedPnL: baselinePnL,
      realizedLossRub: 0,
      verdict: 'NEUTRAL',
      rationale: 'Базовый сценарий: текущая структура без изменений.',
    });

    // S2: Предложение AI (если есть изменения)
    if (proposed.length > 0) {
      scenarios.push(
        this.buildAiProposalScenario(
          assets,
          total,
          proposed,
          baselineDeviation,
          baselinePnL,
        ),
      );
    }

    // S3: Оптимизированный — не фиксируем глубокие убытки
    const optimized = this.buildOptimizedScenario(
      assets,
      total,
      proposed,
      baselineDeviation,
    );
    if (optimized) {
      scenarios.push(optimized);
    }

    // S4: Гибкий — докупка дефицитных активов без продажи глубоких просадок
    const flexible = this.buildFlexibleScenario(
      assets,
      total,
      freeCash,
      baselineDeviation,
    );
    if (flexible && flexible.changes.length > 0) {
      scenarios.push(flexible);
    }

    // Выбираем лучший сценарий (не baseline)
    const best = this.pickBest(scenarios);

    return {
      scenarios,
      bestScenarioId: best ? best.id : 'S1_hold',
      summary: {
        scenariosBuilt: scenarios.length,
        baselineDeviationPct: baselineDeviation,
        bestImprovementPct: best
          ? Math.max(0, baselineDeviation - best.structureDeviationPct)
          : 0,
      },
    };
  }

  // ── Builders ──

  /** Сценарий «как предложил AI» */
  private buildAiProposalScenario(
    assets: AssetAnalysis[],
    total: number,
    changes: ScenarioChange[],
    baselineDeviation: number,
    baselinePnL: number,
  ): ScenarioResult {
    const result = this.applyChanges(assets, total, changes);
    const dev = result.structureDeviationPct;
    const loss = result.realizedLossRub;

    let verdict: ScenarioResult['verdict'] = 'NEUTRAL';
    let rationale =
      `Структура: ${this.fmtPct(dev)} (было ${this.fmtPct(baselineDeviation)}). ` +
      `P&L: ${this.fmtRub(result.projectedUnrealizedPnL)}.`;

    if (
      baselineDeviation - dev >= BASE_CHANGE_THRESHOLD_PCT &&
      result.projectedUnrealizedPnL >= baselinePnL
    ) {
      verdict = 'IMPROVES';
      rationale += ' Структура заметно улучшена без ущерба для P&L.';
    } else if (dev > baselineDeviation + BASE_CHANGE_THRESHOLD_PCT) {
      verdict = 'WORSENS';
      rationale += ' Структура ухудшена относительно базовой.';
    }

    return {
      id: 'S2_ai',
      title: 'Предложение AI',
      changes,
      structureDeviationPct: dev,
      projectedUnrealizedPnL: result.projectedUnrealizedPnL,
      realizedLossRub: Math.max(0, -loss),
      verdict,
      rationale,
    };
  }

  /**
   * Оптимизированный сценарий: пересчитывает структуру и P&L
   * без ограничений по просадке. AI имеет свободу выбора.
   */
  private buildOptimizedScenario(
    assets: AssetAnalysis[],
    total: number,
    proposed: ScenarioChange[],
    baselineDeviation: number,
  ): ScenarioResult | null {
    const optimizedChanges: ScenarioChange[] = [...proposed];

    if (optimizedChanges.length === 0) {
      return null;
    }

    const result = this.applyChanges(assets, total, optimizedChanges);
    const dev = result.structureDeviationPct;
    const loss = result.realizedLossRub;
    const improved = baselineDeviation - dev >= BASE_CHANGE_THRESHOLD_PCT;

    const verdict: ScenarioResult['verdict'] =
      improved && loss > -1000
        ? 'IMPROVES'
        : loss < -1000
          ? 'WORSENS'
          : 'NEUTRAL';

    const rationale =
      `Структура: ${this.fmtPct(dev)} (было ${this.fmtPct(baselineDeviation)}). ` +
      `P&L: ${this.fmtRub(result.projectedUnrealizedPnL)}. ` +
      `Зафиксировано: ${this.fmtRub(Math.max(0, -loss))}.`;

    return {
      id: 'S3_optimized',
      title: 'Оптимизированный — пересчёт без ограничений',
      changes: optimizedChanges,
      structureDeviationPct: dev,
      projectedUnrealizedPnL: result.projectedUnrealizedPnL,
      realizedLossRub: Math.max(0, -loss),
      verdict,
      rationale,
    };
  }

  /**
   * Гибкий сценарий: докупаем дефицитные активы за счёт продажи
   * прибыльных (или свободных средств).
   */
  private buildFlexibleScenario(
    assets: AssetAnalysis[],
    total: number,
    freeCash: number,
    baselineDeviation: number,
  ): ScenarioResult | null {
    // Дефицитные активы (BUY/дефицит по PortfolioMath) — кандидаты на покупку
    const buyCandidates = assets
      .filter((a) => a.status === 'BUY' || a.deficitRub > 0)
      .sort((a, b) => b.deficitRub - a.deficitRub);

    // Прибыльные активы с перевесом — кандидаты на частичную продажу
    const sellCandidates = assets
      .filter(
        (a) =>
          a.unrealizedProfitRub > 0 &&
          (a.status === 'REDUCE' || a.status === 'STABLE'),
      )
      .sort((a, b) => b.unrealizedProfitRub - a.unrealizedProfitRub);

    const buyAsset = buyCandidates[0];
    if (!buyAsset) {
      return null;
    }

    const changes: ScenarioChange[] = [];

    // Финансирование: сначала свободные средства, затем прибыльные позиции
    let budget = Math.max(0, freeCash);
    const sellAsset = sellCandidates[0];
    if (budget < MIN_BUDGET_RUB && sellAsset) {
      const sellValue =
        (sellAsset.quantity ?? 0) * (sellAsset.currentPrice ?? 0);
      const amount = Math.min(sellValue, sellAsset.currentPrice * 20);
      budget += amount;
      changes.push({
        ticker: sellAsset.ticker,
        action: 'SELL',
        amountRub: Math.round(amount),
      });
    }

    if (budget < MIN_BUDGET_RUB) {
      return null;
    }

    const amount = Math.min(budget, Math.max(0, buyAsset.deficitRub));
    if (amount < MIN_BUY_RUB) {
      return null;
    }
    changes.push({
      ticker: buyAsset.ticker,
      action: 'BUY',
      amountRub: Math.round(amount),
    });

    const result = this.applyChanges(assets, total, changes);
    const dev = result.structureDeviationPct;
    const improved = baselineDeviation - dev >= BASE_CHANGE_THRESHOLD_PCT;
    const verdict: ScenarioResult['verdict'] = improved
      ? 'IMPROVES'
      : 'NEUTRAL';

    return {
      id: 'S4_flexible',
      title: 'Гибкий — докупка дефицита без продажи глубоких просадок',
      changes,
      structureDeviationPct: dev,
      projectedUnrealizedPnL: result.projectedUnrealizedPnL,
      realizedLossRub: Math.max(0, -result.realizedLossRub),
      verdict,
      rationale:
        `Покупка ${buyAsset.ticker} ≈ ${this.fmtRub(amount)}. ` +
        `Структура: ${this.fmtPct(dev)} (было ${this.fmtPct(baselineDeviation)}).`,
    };
  }

  // ── Model (deterministic calculations) ──

  /** Применить изменения и пересчитать метрики */
  private applyChanges(
    assets: AssetAnalysis[],
    total: number,
    changes: ScenarioChange[],
  ): {
    structureDeviationPct: number;
    projectedUnrealizedPnL: number;
    realizedLossRub: number;
  } {
    // Работаем с копиями долей и P&L
    const values = new Map<string, number>();
    const pnl = new Map<string, number>();
    let realizedLoss = 0;

    for (const asset of assets) {
      values.set(
        asset.ticker.toUpperCase(),
        (asset.quantity ?? 0) * (asset.currentPrice ?? 0),
      );
      pnl.set(asset.ticker.toUpperCase(), asset.unrealizedProfitRub ?? 0);
    }

    for (const change of changes) {
      const key = change.ticker.toUpperCase();
      const currentValue = values.get(key) ?? 0;
      const currentPnL = pnl.get(key) ?? 0;

      if (change.action === 'BUY') {
        values.set(key, currentValue + change.amountRub);
      } else if (change.action === 'SELL' || change.action === 'REDUCE') {
        const sold = Math.min(change.amountRub, currentValue);
        // Доля убытка/прибыли реализуется пропорционально проданной сумме
        if (currentValue > 0) {
          realizedLoss += currentPnL * (sold / currentValue);
        }
        values.set(key, currentValue - sold);
        pnl.set(key, currentPnL * (1 - sold / Math.max(1, currentValue)));
      }
    }

    // Пересчёт долей (total считаем неизменным — перераспределение внутри портфеля)
    let deviation = 0;
    let projectedPnL = 0;
    for (const asset of assets) {
      const key = asset.ticker.toUpperCase();
      const value = values.get(key) ?? 0;
      const percent = total > 0 ? (value / total) * 100 : 0;
      if (asset.targetPercent !== undefined && asset.targetPercent > 0) {
        deviation += Math.abs(percent - asset.targetPercent);
      }
      projectedPnL += pnl.get(key) ?? 0;
    }

    return {
      structureDeviationPct: Math.round(deviation * 10) / 10,
      projectedUnrealizedPnL: Math.round(projectedPnL),
      realizedLossRub: Math.round(realizedLoss),
    };
  }

  /** Суммарное отклонение структуры от целевых долей */
  private calcStructureDeviation(assets: AssetAnalysis[]): number {
    let dev = 0;
    for (const asset of assets) {
      if (asset.targetPercent !== undefined && asset.targetPercent > 0) {
        dev += Math.abs(asset.currentPercent - asset.targetPercent);
      }
    }
    return Math.round(dev * 10) / 10;
  }

  /** Суммарный нереализованный P&L */
  private sumUnrealizedPnL(assets: AssetAnalysis[]): number {
    return Math.round(
      assets.reduce((sum, a) => sum + (a.unrealizedProfitRub ?? 0), 0),
    );
  }

  // drawdownOf удалён — больше не используется (не блокируем по просадке)

  /** Выбрать лучший сценарий: макс. улучшение структуры при отсутствии глубокого убытка */
  private pickBest(scenarios: ScenarioResult[]): ScenarioResult | null {
    const candidates = scenarios.filter((s) => s.id !== 'S1_hold');
    if (candidates.length === 0) return null;

    return candidates.reduce((best, cur) => {
      if (cur.verdict === 'WORSENS') return best;
      if (best.verdict === 'WORSENS') return cur;
      return cur.structureDeviationPct < best.structureDeviationPct
        ? cur
        : best;
    });
  }

  // ── Formatting helpers ──

  private fmtPct(v: number): string {
    return v.toFixed(1) + '%';
  }

  private fmtRub(v: number): string {
    return new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' ₽';
  }

  private emptyResult(): ScenarioAgentOutput {
    return {
      scenarios: [],
      bestScenarioId: null,
      summary: {
        scenariosBuilt: 0,
        baselineDeviationPct: 0,
        bestImprovementPct: 0,
      },
    };
  }
}
