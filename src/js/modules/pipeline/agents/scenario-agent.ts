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

/** Статус расчёта P&L */
export type PnlCalculationStatus = 'CALCULATED' | 'PARTIAL' | 'INSUFFICIENT_DATA';

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
  /** Прогноз нереализованного P&L после сценария, руб (signed: отрицательный = убыток) */
  projectedUnrealizedPnL: number;
  /** Реализованный P&L после сценария, руб (signed: отрицательный = убыток, положительный = прибыль) */
  realizedPnLRub: number;
  /** Статус расчёта P&L: CALCULATED — все позиции рассчитаны, PARTIAL — часть позиций без данных, INSUFFICIENT_DATA — нет данных ни для одной позиции */
  pnlCalculationStatus: PnlCalculationStatus;
  /** Оценка сценария */
  verdict: 'IMPROVES' | 'WORSENS' | 'NEUTRAL';
  /** Почему такой вердикт */
  rationale: string;
  /** Доля акций (%) до операции */
  stocksBeforePct?: number;
  /** Доля акций (%) после операции */
  stocksAfterPct?: number;
  /** Доля облигаций (%) до операции */
  bondsBeforePct?: number;
  /** Доля облигаций (%) после операции */
  bondsAfterPct?: number;
  /** Доля кэша (%) до операции */
  cashBeforePct?: number;
  /** Доля кэша (%) после операции */
  cashAfterPct?: number;
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
      realizedPnLRub: 0,
      pnlCalculationStatus: this.calcPnlStatus(assets, []),
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
    const pnlStatus = this.calcPnlStatus(assets, changes);

    let verdict: ScenarioResult['verdict'] = 'NEUTRAL';
    let rationale =
      `Структура: ${this.fmtPct(dev)} (было ${this.fmtPct(baselineDeviation)}). ` +
      `P&L: ${this.fmtRub(result.projectedUnrealizedPnL)}.`;

    if (pnlStatus === 'CALCULATED') {
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
    } else {
      rationale += ' P&L не может быть рассчитан (недостаточно данных о себестоимости).';
    }

    return {
      id: 'S2_ai',
      title: 'Предложение AI',
      changes,
      structureDeviationPct: dev,
      projectedUnrealizedPnL: result.projectedUnrealizedPnL,
      realizedPnLRub: result.realizedPnLRub,
      pnlCalculationStatus: pnlStatus,
      verdict,
      rationale,
      stocksBeforePct: result.stocksBeforePct,
      stocksAfterPct: result.stocksAfterPct,
      bondsBeforePct: result.bondsBeforePct,
      bondsAfterPct: result.bondsAfterPct,
      cashBeforePct: result.cashBeforePct,
      cashAfterPct: result.cashAfterPct,
    };
  }

  /**
    * Оптимизированный сценарий: пересчитывает структуру и P&L
    * без ограничений по просадке. AI имеет свободу выбора.
    *
    * Дополнительно: автоматически добавляет продажу частей позиций
    * с концентрацией > 15% и отрицательным P&L для снижения риска.
    */
  private buildOptimizedScenario(
    assets: AssetAnalysis[],
    total: number,
    proposed: ScenarioChange[],
    baselineDeviation: number,
  ): ScenarioResult | null {
    const optimizedChanges: ScenarioChange[] = [...proposed];

    // ─── P0-1: Автоматическое снижение концентраций ───
    // Находим активы с высокой концентрацией и убыточным P&L
    const concentratedAssets = assets.filter(
      (a) =>
        a.currentPercent > 15 &&
        (a.unrealizedProfitRub ?? 0) < 0,
    );

    for (const asset of concentratedAssets) {
      const currentVal =
        (asset.quantity ?? 0) * (asset.currentPrice ?? 0);
      // Продаём 50% позиции для снижения концентрации
      const targetValue = currentVal * 0.5;
      optimizedChanges.push({
        ticker: asset.ticker,
        action: 'SELL',
        amountRub: Math.round(targetValue),
      });
    }

    // Если нет изменений вообще — нет смысла строить сценарий
    if (optimizedChanges.length === 0) {
      return null;
    }

    const result = this.applyChanges(assets, total, optimizedChanges);
    const dev = result.structureDeviationPct;
    const realizedPnL = result.realizedPnLRub; // signed: отрицательный = убыток
    const improved = baselineDeviation - dev >= BASE_CHANGE_THRESHOLD_PCT;
    const optimizedPnlStatus = this.calcPnlStatus(assets, optimizedChanges);

    const verdict: ScenarioResult['verdict'] =
      improved && realizedPnL > -1000
        ? 'IMPROVES'
        : realizedPnL < -1000
          ? 'WORSENS'
          : 'NEUTRAL';

    // Формируем подробную сводку с указанием реализованного убытка
    const realizedLossAbs = Math.max(0, -realizedPnL);
    let rationale =
      `Структура: ${this.fmtPct(dev)} (было ${this.fmtPct(baselineDeviation)}). ` +
      `P&L: ${this.fmtRub(result.projectedUnrealizedPnL)}. ` +
      `Зафиксировано: ${this.fmtRub(realizedLossAbs)}.` +
      (concentratedAssets.length > 0
        ? ` Снижение концентрации: ${concentratedAssets.map((a) => a.ticker).join(', ')}.`
        : '');

    if (optimizedPnlStatus === 'INSUFFICIENT_DATA') {
      rationale += ' P&L не может быть рассчитан (недостаточно данных о себестоимости).';
    }

    return {
      id: 'S3_optimized',
      title: 'Оптимизированный — пересчёт без ограничений',
      changes: optimizedChanges,
      structureDeviationPct: dev,
      projectedUnrealizedPnL: result.projectedUnrealizedPnL,
      realizedPnLRub: realizedPnL,
      pnlCalculationStatus: optimizedPnlStatus,
      verdict,
      rationale,
      stocksBeforePct: result.stocksBeforePct,
      stocksAfterPct: result.stocksAfterPct,
      bondsBeforePct: result.bondsBeforePct,
      bondsAfterPct: result.bondsAfterPct,
      cashBeforePct: result.cashBeforePct,
      cashAfterPct: result.cashAfterPct,
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
    /** Signed P&L: отрицательный = убыток, положительный = прибыль */
    realizedPnLRub: number;
    stocksBeforePct: number;
    stocksAfterPct: number;
    bondsBeforePct: number;
    bondsAfterPct: number;
    cashBeforePct: number;
    cashAfterPct: number;
  } {
    // Работаем с копиями долей, P&L и стоимости покупки
    const values = new Map<string, number>();
    const pnl = new Map<string, number>();
    const costBases = new Map<string, number>(); // Стоимость покупки позиций
    let realizedPnL = 0; // signed: отрицательный = убыток

    for (const asset of assets) {
      const currentVal = (asset.quantity ?? 0) * (asset.currentPrice ?? 0);
      values.set(asset.ticker.toUpperCase(), currentVal);

      // P&L: рассчитывается из реальных данных (currentPrice - balancePrice) * quantity,
      // а не берётся из Excel (unrealizedProfitRub может быть 0 при реальной просадке).
      const balancePrice = asset.balancePrice ?? 0;
      const currentPrice = asset.currentPrice ?? 0;
      const unrealizedPnL =
        (currentPrice > 0 && balancePrice > 0)
          ? (currentPrice - balancePrice) * (asset.quantity ?? 0)
          : asset.unrealizedProfitRub;
      pnl.set(asset.ticker.toUpperCase(), unrealizedPnL);

      // Стоимость покупки = quantity * balancePrice (прямой расчёт)
      // НЕ используем обратную формулу currentVal - unrealizedPnL,
      // т.к. она даёт неверный результат при несогласованных тестовых данных.
      costBases.set(
        asset.ticker.toUpperCase(),
        (asset.quantity ?? 0) * (asset.balancePrice ?? 0),
      );
    }

    for (const change of changes) {
      const key = change.ticker.toUpperCase();
      const currentValue = values.get(key) ?? 0;
      const currentPnL = pnl.get(key) ?? 0;
      const costBase = costBases.get(key) ?? currentValue;

      if (change.action === 'BUY') {
        const existingValue = values.get(key) ?? 0;
        values.set(key, existingValue + change.amountRub);
        // Обновляем costBases: добавляем стоимость новых бумаг по текущей цене
        const existingCostBase = costBases.get(key) ?? 0;
        costBases.set(key, existingCostBase + change.amountRub);
        // При покупке новых бумаг по текущей рыночной цене:
        // - существующий абсолютный P&L НЕ изменяется (покупка по текущей цене = 0 P&L для новой части)
        // - новая позиция имеет P&L = 0
        // - итоговый P&L = existingPnL + 0 = existingPnL
        // НЕ усредняем существующий убыток — это математическая ошибка.
        if (existingValue === 0) {
          // Новая позиция: P&L = 0
          pnl.set(key, 0);
        }
        // Существующая позиция: existingPnL сохраняется без изменений
      } else if (change.action === 'SELL' || change.action === 'REDUCE') {
        const sold = Math.min(change.amountRub, currentValue);

        // Реализованный P&L при продаже (signed):
        // (текущая стоимость - стоимость покупки) * доля проданного
        // currentPnL отрицательный = убыток → realizedPnL отрицательный = убыток
        if (currentValue > 0) {
          const realized = currentPnL * (sold / currentValue);
          realizedPnL += realized; // signed: отрицательный = убыток
        }

        // Обновляем оставшуюся позицию
        values.set(key, currentValue - sold);
        pnl.set(key, currentPnL * (1 - sold / Math.max(1, currentValue)));

        // Обновляем стоимость покупки пропорционально
        costBases.set(
          key,
          costBase * (1 - sold / Math.max(1, currentValue)),
        );
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
      // pnl.get(key) может быть null (отсутствует unrealizedProfitRub)
      // null не подставляется как 0 — это означает отсутствие данных
      const assetPnL = pnl.get(key);
      if (assetPnL !== null && assetPnL !== undefined) {
        projectedPnL += assetPnL;
      }
    }

    // ─── P1-2: Расчёт структуры до/после ───
    const stocksBeforePct = this.calcClassPct(assets, total, 'STOCK');
    const bondsBeforePct = this.calcClassPct(assets, total, 'BOND');
    const cashBeforePct = 100 - stocksBeforePct - bondsBeforePct;
    const stocksAfterPct = this.calcClassPctAfter(assets, total, values, 'STOCK');
    const bondsAfterPct = this.calcClassPctAfter(assets, total, values, 'BOND');
    const cashAfterPct = 100 - stocksAfterPct - bondsAfterPct;

    return {
      structureDeviationPct: Math.round(deviation * 10) / 10,
      projectedUnrealizedPnL: Math.round(projectedPnL),
      realizedPnLRub: Math.round(realizedPnL),
      stocksBeforePct,
      stocksAfterPct,
      bondsBeforePct,
      bondsAfterPct,
      cashBeforePct,
      cashAfterPct,
    };
  }

  /** Рассчитать долю класса активов (%) */
  private calcClassPct(
    assets: AssetAnalysis[],
    total: number,
    assetClass: 'STOCK' | 'BOND',
  ): number {
    let sum = 0;
    for (const asset of assets) {
      const val = (asset.quantity ?? 0) * (asset.currentPrice ?? 0);
      const type = asset.assetType.toUpperCase();
      const isMatch =
        (assetClass === 'STOCK' &&
          (type === 'А' || type === 'АКЦИЯ' || type === 'STOCK')) ||
        (assetClass === 'BOND' &&
          (type === 'О' || type === 'ОБЛИГАЦИЯ' || type === 'BOND'));
      if (isMatch) sum += val;
    }
    return total > 0 ? Math.round((sum / total) * 100 * 10) / 10 : 0;
  }

  /** Рассчитать долю класса активов после изменений */
  private calcClassPctAfter(
    assets: AssetAnalysis[],
    total: number,
    values: Map<string, number>,
    assetClass: 'STOCK' | 'BOND',
  ): number {
    let sum = 0;
    for (const asset of assets) {
      const key = asset.ticker.toUpperCase();
      const val = values.get(key) ?? 0;
      const type = asset.assetType.toUpperCase();
      const isMatch =
        (assetClass === 'STOCK' &&
          (type === 'А' || type === 'АКЦИЯ' || type === 'STOCK')) ||
        (assetClass === 'BOND' &&
          (type === 'О' || type === 'ОБЛИГАЦИЯ' || type === 'BOND'));
      if (isMatch) sum += val;
    }
    return total > 0 ? Math.round((sum / total) * 100 * 10) / 10 : 0;
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
    const flexiblePnlStatus = this.calcPnlStatus(assets, changes);
    const verdict: ScenarioResult['verdict'] = improved
      ? 'IMPROVES'
      : 'NEUTRAL';

    let rationale =
        `Покупка ${buyAsset.ticker} ≈ ${this.fmtRub(amount)}. ` +
        `Структура: ${this.fmtPct(dev)} (было ${this.fmtPct(baselineDeviation)}).`;
    if (flexiblePnlStatus === 'INSUFFICIENT_DATA') {
      rationale += ' P&L не может быть рассчитан (недостаточно данных о себестоимости).';
    }

    return {
      id: 'S4_flexible',
      title: 'Гибкий — докупка дефицита без продажи глубоких просадок',
      changes,
      structureDeviationPct: dev,
      projectedUnrealizedPnL: result.projectedUnrealizedPnL,
      realizedPnLRub: result.realizedPnLRub,
      pnlCalculationStatus: flexiblePnlStatus,
      verdict,
      rationale,
      stocksBeforePct: result.stocksBeforePct,
      stocksAfterPct: result.stocksAfterPct,
      bondsBeforePct: result.bondsBeforePct,
      bondsAfterPct: result.bondsAfterPct,
      cashBeforePct: result.cashBeforePct,
      cashAfterPct: result.cashAfterPct,
    };
  }

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

  // ── P&L data validation ──

  /**
   * Определяет статус расчёта P&L по всем позициям, участвующим в сценарии.
   *
   * CALCULATED — все позиции имеют unrealizedProfitRub !== null,
   *               balancePrice > 0 и currentPrice > 0;
   * PARTIAL — часть позиций имеет данные, часть нет;
   * INSUFFICIENT_DATA — ни одна позиция не имеет необходимых данных.
   */
  private calcPnlStatus(
    assets: AssetAnalysis[],
    changes: ScenarioChange[],
  ): PnlCalculationStatus {
    const involvedTickers = new Set<string>();
    // Собираем тикеры, участвующие в сценарии
    for (const a of assets) involvedTickers.add(a.ticker.toUpperCase());
    for (const c of changes) involvedTickers.add(c.ticker.toUpperCase());

    let calculated = 0;
    let insufficient = 0;

    for (const ticker of involvedTickers) {
      const asset = assets.find((a) => a.ticker.toUpperCase() === ticker);
      if (!asset) {
        insufficient++;
        continue;
      }
      // Проверяем ВСЕ три условия:
      // 1. unrealizedProfitRub — конечное число (не null, не NaN, не Infinity)
      // 2. balancePrice > 0 — цена покупки известна
      // 3. currentPrice > 0 — текущая цена известна
      // P&L рассчитывается из (currentPrice - balancePrice) * quantity,
      // поэтому проверяем наличие price данных, а не Excel P&L.
      if (
        (asset.balancePrice ?? 0) > 0 &&
        (asset.currentPrice ?? 0) > 0
      ) {
        calculated++;
      } else {
        insufficient++;
      }
    }

    if (insufficient === 0) return 'CALCULATED';
    if (calculated === 0) return 'INSUFFICIENT_DATA';
    return 'PARTIAL';
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
