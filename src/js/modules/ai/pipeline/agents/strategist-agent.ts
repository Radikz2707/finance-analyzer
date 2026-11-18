/**
 * StrategistAgent — независимый аналитический агент по стратегии и рискам.
 *
 * Роль: аналитик, который оценивает структуру портфеля, концентрацию,
 * P&L, просадки и устойчивость. Может не согласиться с AI, предложить
 * альтернативное действие, оценить риски — но НЕ имеет права автоматически
 * блокировать или изменять решение AI.
 *
 * Главный инвестиционный вывод определяется качеством совокупного анализа,
 * а не заранее прошитым veto.
 *
 * Инвестиционные стратегии строятся детерминированно из того же
 * валидированного JSON, что и карточки активов. Модель не генерирует
 * шаги, суммы и прогнозы доходности.
 */

import type { AssetAnalysis } from '../../../portfolio/portfolio-math/portfolio-math.js';
import type { AiAction } from '../../../research/types.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import {
  buyDeviationPp,
  isBondAssetType,
  isBuyAllowedByMath,
  isSellAllowedByMath,
  isSellAllowedByPolicy,
  isStockAssetType,
  sellDeviationPp,
  validateStrategyConsistency,
  type StrategyConflict,
  type StrategyValidationPolicy,
} from './strategy-validator.js';

// ──────────────────────────────────────────────
// 1. Types
// ──────────────────────────────────────────────

/** Входные данные для одного актива: что предложил AI */
export interface StrategistProposal {
  ticker: string;
  /** Действие, предложенное AI (BUY/SELL/HOLD/REDUCE/EXIT/AVOID/AVERAGE или null) */
  action: AiAction | null;
  /** Катализаторы, найденные AI (фундамент, отчёт, дивиденды...) */
  keyCatalysts?: string[];
  /** Обоснование AI */
  rationale?: string | null;
}

/** Входные данные StrategistAgent */
export interface StrategistAgentInput {
  /** Согласованность Math и AI по каждому тикеру */
  mathAiAgreements?: Map<
    string,
    { math: string; ai: string; conflict: boolean } | null
  >;
  /** Анализ всех активов портфеля (из AnalysisAgent / PortfolioMath) */
  assetsAnalysis: AssetAnalysis[];
  /** Предложения AI по каждому активу */
  proposals: StrategistProposal[];
  /** Средний ежемесячный взнос (фактический источник — investedFunds.averageMonthlyDeposit) */
  monthlyContribution?: number;
  /** Тикеры, которые пользователь запретил продавать */
  noSellTickers?: string[];
  /** Типы активов, которые пользователь запретил продавать */
  noSellAssetTypes?: string[];
  /** Предупреждения по загрузке пользовательской политики (для отчёта) */
  policyWarnings?: string[];
  /** Доходности облигаций (QUIK yield), % годовых, по тикеру/ISIN */
  bondYields?: Record<string, number | null>;
  /** Дивидендные доходности акций, % годовых, по тикеру */
  dividendYields?: Record<string, number | null>;
  /** Источник и дата дивидендной доходности по тикеру */
  dividendYieldsMeta?: Record<
    string,
    {
      source: 'EXCEL_DIVIDENDS' | 'EXCEL_DECLARED' | 'SMART_LAB';
      asOf: string | null;
      kind: 'LTM' | 'DECLARED' | 'UNKNOWN';
    }
  >;
  /** Размеры лотов по тикерам (по умолчанию 1) */
  lotSizes?: Record<string, number>;
}

/** Вердикт стратега по одному активу */
export interface StrategistDecision {
  ticker: string;
  name: string;
  /** Действие, предложенное AI */
  suggestedAction: AiAction | null;
  /** Итоговое действие (совпадает с AI — стратег не блокирует) */
  finalAction: AiAction | null;
  /** Просадка от цены покупки, % (отрицательная = убыток) */
  drawdownPercent: number | null;
  /** Концентрация позиции, % */
  concentrationPercent: number | null;
  /** Примечание стратега (аналитическое, не блокирующее) */
  note: string | null;
  /** Есть ли конфликт между Math и AI, требующий ручной проверки */
  hasConflict: boolean;
}

/** Конкретный шаг стратегии */
export interface StrategyStep {
  order: number;
  /** Действие: «Купить» / «Продать» / «Удерживать» */
  action: string;
  ticker: string;
  /** Сумма сделки, ₽ (0 для шага удержания) */
  amountRub: number;
  /** Отображаемая сумма и отклонение: «на 5 000 ₽ — дефицит доли 2,0 п.п.» */
  amount: string;
  /** Дефицит/профицит доли, п.п. (положительное число) */
  deviationPp: number;
  /** Фактическое основание шага без оценочных формулировок */
  rationale: string;
}

/**
 * Купонно-дивидендный якорь доходности.
 *
 * Считается только из фактических данных:
 *  - доходность облигаций (QUIK yield) × доля в портфеле;
 *  - дивидендная доходность акций × доля в портфеле.
 *
 * Если данных по имеющейся части портфеля нет — totalYieldPercent = null,
 * а text содержит честное «прогноз недоступен». Рыночная переоценка
 * не прогнозируется.
 */
export interface StrategyIncomeAnchor {
  /** Взвешенная купонная доходность облигационной части, % годовых */
  bondYieldPercent: number | null;
  /** Взвешенная дивидендная доходность акционной части, % годовых */
  dividendYieldPercent: number | null;
  /** Итоговый купонно-дивидендный доход, % годовых */
  totalYieldPercent: number | null;
  /** Причина, по которой доходность рассчитать нельзя */
  unavailableReason: string | null;
  /** Источник дивидендной части якоря */
  dividendSource:
    'EXCEL_DIVIDENDS' | 'EXCEL_DECLARED' | 'SMART_LAB' | 'MIXED' | null;
  /** Дата источника дивидендной части */
  dividendAsOf: string | null;
  /** LTM (полученные) или DECLARED (форвардные) */
  dividendKind: 'LTM' | 'DECLARED' | 'MIXED' | 'UNKNOWN' | null;
  /** Готовая строка для отчёта */
  text: string;
}

/** Инвестиционная стратегия */
export interface InvestmentStrategy {
  name: string;
  description: string;
  steps: StrategyStep[];
  incomeAnchor: StrategyIncomeAnchor;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

/** Выходные данные StrategistAgent */
export interface StrategistAgentOutput {
  /** Решения по всем активам, по которым были предложения */
  decisions: StrategistDecision[];
  /** Сводка работы стратега */
  summary: {
    /** Сколько активов проверено */
    assetsChecked: number;
    /** Текущая цель портфеля (для отчётов и объяснений) */
    goal: string;
  };
  /** Три стратегии с конкретными шагами */
  strategies?: InvestmentStrategy[];
  /** Конфликты шагов с PortfolioMath/политикой (код STRATEGY_CONFLICT) */
  strategyConflicts?: StrategyConflict[];
  /** Предупреждения по загрузке пользовательской политики (для отчёта) */
  policyWarnings?: string[];
}

// ──────────────────────────────────────────────
// 2. Детерминированные помощники
// ──────────────────────────────────────────────

interface StrategyCandidate {
  asset: AssetAnalysis;
  direction: 'BUY' | 'SELL';
  amountRub: number;
  deviationPp: number;
  cardAction: AiAction;
}

function formatRub(value: number): string {
  return (
    new Intl.NumberFormat('ru-RU').format(Math.max(0, Math.round(value))) + ' ₽'
  );
}

function formatPp(value: number): string {
  return Math.abs(value).toFixed(1).replace('.', ',');
}

function formatYield(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/**
 * Округление суммы до лота (акции) или листа (облигации).
 * Если цена неизвестна — сумма остаётся целой, без выдуманных значений.
 */
/** Стоимость одного лота/листа в рублях (0 — цена неизвестна). */
function lotValueOf(
  asset: AssetAnalysis,
  lotSizes: Record<string, number> | undefined,
): number {
  const lotSize = Math.max(
    1,
    Math.floor(lotSizes?.[asset.ticker.toUpperCase()] ?? 1),
  );
  const unitPrice =
    asset.currentPrice > 0
      ? asset.currentPrice
      : asset.nominal > 0
        ? asset.nominal
        : 0;
  return unitPrice > 0 ? unitPrice * lotSize : 0;
}

function roundAmountToLot(
  amountRub: number,
  asset: AssetAnalysis,
  lotSizes: Record<string, number> | undefined,
  mode: 'nearest' | 'floor' = 'nearest',
): number {
  if (!Number.isFinite(amountRub) || amountRub <= 0) {
    return 0;
  }

  const lotSize = Math.max(
    1,
    Math.floor(lotSizes?.[asset.ticker.toUpperCase()] ?? 1),
  );
  const unitPrice =
    asset.currentPrice > 0
      ? asset.currentPrice
      : asset.nominal > 0
        ? asset.nominal
        : 0;

  if (unitPrice <= 0) {
    return Math.round(amountRub);
  }

  const lotValue = unitPrice * lotSize;
  if (!Number.isFinite(lotValue) || lotValue <= 0) {
    return Math.round(amountRub);
  }

  const lots =
    mode === 'floor'
      ? Math.floor(amountRub / lotValue)
      : Math.round(amountRub / lotValue);

  if (lots <= 0) {
    return mode === 'floor' ? 0 : Math.round(amountRub);
  }

  return Math.round(lots * lotValue);
}

function buildCandidates(assetsAnalysis: AssetAnalysis[]): StrategyCandidate[] {
  const candidates: StrategyCandidate[] = [];

  for (const asset of assetsAnalysis) {
    // Кандидаты строятся только из PortfolioMath (дефицит/профицит доли),
    // а не из направления AI-карточки: AI может советовать HOLD, но
    // математика портфеля показывает дефицит, требующий покупки.
    if (isSellAllowedByMath(asset)) {
      const surplusRub = Math.abs(asset.deficitRub);
      if (surplusRub <= 0) {
        continue;
      }

      const isExit = asset.status === 'EXIT';
      candidates.push({
        asset,
        direction: 'SELL',
        amountRub: surplusRub,
        deviationPp: isExit ? asset.currentPercent : sellDeviationPp(asset),
        cardAction: isExit ? 'EXIT' : 'REDUCE',
      });
      continue;
    }

    if (isBuyAllowedByMath(asset)) {
      candidates.push({
        asset,
        direction: 'BUY',
        amountRub: asset.deficitRub,
        deviationPp: buyDeviationPp(asset),
        cardAction: 'BUY',
      });
    }
  }

  return candidates;
}

function buildStep(
  candidate: StrategyCandidate,
  order: number,
  amountRub: number,
  extraNote?: string,
): StrategyStep {
  const isBuy = candidate.direction === 'BUY';
  const action = isBuy ? 'Купить' : 'Продать';
  const deviationLabel = isBuy ? 'дефицит доли' : 'профицит доли';
  const rationale = isBuy
    ? `Покупка соответствует действию карточки ${candidate.cardAction}.`
    : `Сокращение соответствует действию карточки ${candidate.cardAction}.`;

  const note = extraNote ? ` ${extraNote}` : '';

  return {
    order,
    action,
    ticker: candidate.asset.ticker,
    amountRub,
    amount:
      `на ${formatRub(amountRub)} — ${deviationLabel} ` +
      `${formatPp(candidate.deviationPp)} п.п.${note}`,
    deviationPp: candidate.deviationPp,
    rationale,
  };
}

function buildHoldStep(reason: string): StrategyStep {
  return {
    order: 1,
    action: 'Удерживать',
    ticker: 'ПОРТФЕЛЬ',
    amountRub: 0,
    amount: 'без сделок',
    deviationPp: 0,
    rationale: reason,
  };
}

interface WeightedYieldResult {
  /** Взвешенная доходность по покрытым бумагам, п.п. портфеля */
  value: number | null;
  missingTickers: string[];
  hasAssets: boolean;
  /** Суммарная доля покрытых бумаг, % портфеля */
  coveredPercent: number;
}

function calculateWeightedYield(
  assets: AssetAnalysis[],
  yields: Record<string, number | null> | undefined,
): WeightedYieldResult {
  const relevant = assets.filter((asset) => asset.currentPercent > 0);
  if (relevant.length === 0) {
    return {
      value: 0,
      missingTickers: [],
      hasAssets: false,
      coveredPercent: 0,
    };
  }

  let weighted = 0;
  let coveredPercent = 0;
  const missingTickers: string[] = [];

  for (const asset of relevant) {
    const yieldPercent = yields?.[asset.ticker.toUpperCase()];
    if (
      typeof yieldPercent === 'number' &&
      Number.isFinite(yieldPercent) &&
      yieldPercent > 0
    ) {
      weighted += yieldPercent * (asset.currentPercent / 100);
      coveredPercent += asset.currentPercent;
    } else {
      missingTickers.push(asset.ticker);
    }
  }

  return {
    // Якорь остаётся числом, пока покрыта хотя бы одна бумага класса.
    // Непокрытые тикеры перечисляются в отчёте явно, без домыслов.
    value: coveredPercent > 0 ? weighted : null,
    missingTickers,
    hasAssets: true,
    coveredPercent,
  };
}

function calculateIncomeAnchor(
  assetsAnalysis: AssetAnalysis[],
  bondYields: Record<string, number | null> | undefined,
  dividendYields: Record<string, number | null> | undefined,
  dividendYieldsMeta?: StrategistAgentInput['dividendYieldsMeta'],
): StrategyIncomeAnchor {
  const bondAssets = assetsAnalysis.filter((asset) =>
    isBondAssetType(asset.assetType),
  );
  const stockAssets = assetsAnalysis.filter((asset) =>
    isStockAssetType(asset.assetType),
  );

  const bondPart = calculateWeightedYield(bondAssets, bondYields);
  const dividendPart = calculateWeightedYield(stockAssets, dividendYields);
  const hasAnyAssetClass = bondPart.hasAssets || dividendPart.hasAssets;

  // Класс участвует в сумме, если у него есть бумаги и хотя бы одна покрыта.
  const bondUsable = !bondPart.hasAssets || bondPart.value !== null;
  const dividendUsable = !dividendPart.hasAssets || dividendPart.value !== null;

  const totalYieldPercent =
    hasAnyAssetClass && bondUsable && dividendUsable
      ? (bondPart.value ?? 0) + (dividendPart.value ?? 0)
      : null;

  let unavailableReason: string | null = null;
  if (totalYieldPercent === null) {
    const reasons: string[] = [];
    if (!hasAnyAssetClass) {
      reasons.push('в портфеле нет акций и облигаций с рыночной стоимостью');
    } else {
      if (bondPart.value === null) {
        reasons.push(
          `нет данных по доходности облигаций: ${bondPart.missingTickers.join(', ')}`,
        );
      }
      if (dividendPart.value === null) {
        reasons.push(
          `нет дивидендных данных: ${dividendPart.missingTickers.join(', ')}`,
        );
      }
    }
    unavailableReason = reasons.join('; ');
  }

  // Непокрытые бумаги не выдумываем: перечисляем их явно рядом с числом.
  const coverageNotes: string[] = [];
  if (bondPart.missingTickers.length > 0) {
    coverageNotes.push(
      `облигации без данных: ${bondPart.missingTickers.join(', ')}`,
    );
  }
  if (dividendPart.missingTickers.length > 0) {
    coverageNotes.push(
      `акции без дивидендных данных: ${dividendPart.missingTickers.join(', ')}`,
    );
  }
  const coverageNote =
    coverageNotes.length > 0
      ? ` Покрытие неполное — не учтены: ${coverageNotes.join('; ')}.`
      : '';

  const usedStockTickers = stockAssets
    .map((asset) => asset.ticker.trim().toUpperCase())
    .filter((ticker) => {
      const value = dividendYields?.[ticker];
      return typeof value === 'number' && Number.isFinite(value) && value > 0;
    });
  const sourceSet = new Set<
    'EXCEL_DIVIDENDS' | 'EXCEL_DECLARED' | 'SMART_LAB'
  >();
  const kindSet = new Set<'LTM' | 'DECLARED' | 'UNKNOWN'>();
  let dividendAsOf: string | null = null;
  for (const ticker of usedStockTickers) {
    const meta = dividendYieldsMeta?.[ticker];
    if (!meta) continue;
    sourceSet.add(meta.source);
    kindSet.add(meta.kind);
    if (meta.asOf && (!dividendAsOf || meta.asOf > dividendAsOf)) {
      dividendAsOf = meta.asOf;
    }
  }

  const dividendSource: StrategyIncomeAnchor['dividendSource'] =
    sourceSet.size === 0
      ? null
      : sourceSet.size === 1
        ? Array.from(sourceSet)[0]!
        : 'MIXED';
  const dividendKind: StrategyIncomeAnchor['dividendKind'] =
    kindSet.size === 0
      ? null
      : kindSet.size === 1
        ? Array.from(kindSet)[0]!
        : 'MIXED';
  const dividendSourceNote = dividendSource
    ? ` Источник дивидендов: ${dividendSource}` +
      (dividendAsOf ? ` (${dividendAsOf.slice(0, 10)})` : '') +
      (dividendKind === 'DECLARED' ? ' — форвардная доходность' : '') +
      '.'
    : '';

  const text =
    totalYieldPercent !== null
      ? `Портфель несёт купонно-дивидендный доход ~${formatYield(totalYieldPercent)}% годовых, ` +
        `если эмитенты выполнят выплаты; рыночная переоценка не прогнозируется.${dividendSourceNote}${coverageNote}`
      : `Купонно-дивидендный доход рассчитать нельзя: ${unavailableReason}. ` +
        'Прогноз недоступен. Рыночная переоценка не прогнозируется.';

  return {
    bondYieldPercent: bondPart.value,
    dividendYieldPercent: dividendPart.value,
    totalYieldPercent,
    unavailableReason,
    dividendSource,
    dividendAsOf,
    dividendKind,
    text,
  };
}

function sortCandidates(candidates: StrategyCandidate[]): StrategyCandidate[] {
  return [...candidates].sort((a, b) => b.amountRub - a.amountRub);
}

function removeConflictingSteps(
  strategies: InvestmentStrategy[],
  conflicts: StrategyConflict[],
): void {
  if (conflicts.length === 0) {
    return;
  }

  const conflictKeys = new Set(
    conflicts.map(
      (conflict) => `${conflict.strategyName}|${conflict.stepOrder}`,
    ),
  );

  for (const strategy of strategies) {
    strategy.steps = strategy.steps
      .filter((step) => !conflictKeys.has(`${strategy.name}|${step.order}`))
      .map((step, index) => ({ ...step, order: index + 1 }));

    if (strategy.steps.length === 0) {
      strategy.steps = [
        buildHoldStep('Конфликтующие шаги исключены валидатором.'),
      ];
    }
  }
}

// ──────────────────────────────────────────────
// 3. StrategistAgent
// ──────────────────────────────────────────────

/**
 * StrategistAgent — агент-аналитик стратегии и рисков.
 *
 * Задачи:
 * - оценить структуру и концентрацию портфеля;
 * - указать на риски концентрации, просадки, P&L;
 * - предложить альтернативное действие (но НЕ блокировать AI);
 * - оценить устойчивость портфеля;
 * - собрать три детерминированные стратегии из карточек.
 *
 * Все вычисления синхронные (без I/O и LLM) — агент не может зависнуть.
 */
export class StrategistAgent extends AgentBase {
  constructor(config?: AgentConfig) {
    super(config ?? { name: 'StrategistAgent' });
  }

  protected async executeInternal(
    input: StrategistAgentInput,
  ): Promise<StrategistAgentOutput> {
    const assetsAnalysis = input?.assetsAnalysis ?? [];
    const proposals = input?.proposals ?? [];

    console.log(
      `[STRATEGIST_INPUT] assets=${assetsAnalysis.length} proposals=${proposals.length} ` +
        `dividendYields=${Object.keys(input?.dividendYields ?? {}).length} ` +
        `bondYields=${Object.keys(input?.bondYields ?? {}).length}`,
    );

    if (assetsAnalysis.length === 0 || proposals.length === 0) {
      return this.emptyResult();
    }

    // Индекс активов по тикеру (для быстрого поиска AssetAnalysis)
    const assetByTicker = new Map<string, AssetAnalysis>();
    for (const asset of assetsAnalysis) {
      assetByTicker.set(asset.ticker.toUpperCase(), asset);
    }

    const decisions: StrategistDecision[] = [];

    for (const proposal of proposals) {
      const asset = assetByTicker.get(proposal.ticker.toUpperCase());

      if (!asset) {
        continue;
      }

      // Расчёт просадки
      const balancePrice = asset.balancePrice ?? 0;
      const currentPrice = asset.currentPrice ?? 0;
      const drawdownPercent =
        balancePrice > 0 && currentPrice > 0
          ? ((currentPrice - balancePrice) / balancePrice) * 100
          : null;

      // Концентрация
      const concentrationPercent = asset.currentPercent || null;

      // Аналитическое примечание (не блокирующее)
      const note = this.buildStrategistNote(
        proposal.action,
        drawdownPercent,
        concentrationPercent,
        asset.unrealizedProfitRub ?? 0,
        proposal.rationale ?? null,
      );

      const agreement = input.mathAiAgreements?.get(
        proposal.ticker.toUpperCase(),
      );
      const hasConflict = agreement?.conflict ?? false;
      const conflictNote = hasConflict
        ? ' ⚠️ Conflict: Math=' +
          (agreement?.math ?? '?') +
          ', AI=' +
          (agreement?.ai ?? '?') +
          ' \u2014 manual review required'
        : '';

      // ─── P0-2: finalAction = null при конфликте MathAiAgreement ───
      // Если есть неразрешённый конфликт, стратег НЕ должен предлагать
      // исполняемое действие. suggestedAction остаётся (аналитическое),
      // но finalAction = null (блокировка исполнения).
      const finalAction = hasConflict ? null : proposal.action;

      decisions.push({
        ticker: asset.ticker,
        name: asset.name,
        suggestedAction: proposal.action,
        finalAction,
        drawdownPercent,
        concentrationPercent,
        note: note ? note + conflictNote : conflictNote,
        hasConflict,
      });
    }

    const { strategies, conflicts, blockedByPolicy } = this.generateStrategies(
      assetsAnalysis,
      decisions,
      input,
    );

    const policyWarnings = [...(input.policyWarnings ?? [])];
    if (blockedByPolicy.length > 0) {
      policyWarnings.push(
        `Продажи запрещены политикой и исключены из шагов: ${blockedByPolicy.join(', ')}`,
      );
    }

    console.log(
      `[STRATEGIST_STRATEGY] full=${strategies[0]?.steps.length ?? 0} ` +
        `partial=${strategies[1]?.steps.length ?? 0} ` +
        `conservative=${strategies[2]?.steps.length ?? 0}`,
    );

    return {
      decisions,
      summary: {
        assetsChecked: assetsAnalysis.length,
        goal:
          'Максимизировать потенциальальную прибыль портфеля, вывести портфель ' +
          'в зелёную зону, сохраняя надёжность и устойчивость.',
      },
      strategies,
      strategyConflicts: conflicts,
      policyWarnings,
    };
  }

  // ── Генерация 3 стратегий ──

  private generateStrategies(
    assetsAnalysis: AssetAnalysis[],
    decisions: StrategistDecision[],
    input: StrategistAgentInput,
  ): {
    strategies: InvestmentStrategy[];
    conflicts: StrategyConflict[];
    blockedByPolicy: string[];
  } {
    const policy: StrategyValidationPolicy = {
      noSellTickers: input.noSellTickers,
      noSellAssetTypes: input.noSellAssetTypes,
    };

    // Запрещённые политикой продажи не предлагаем вовсе — иначе отчёт
    // заполняется STRATEGY_CONFLICT на каждую бумагу из no-sell списка.
    const blockedByPolicy = new Set<string>();
    const candidates = buildCandidates(assetsAnalysis).filter((candidate) => {
      if (candidate.direction !== 'SELL') {
        return true;
      }
      if (isSellAllowedByPolicy(candidate.asset, policy)) {
        return true;
      }
      blockedByPolicy.add(candidate.asset.ticker);
      return false;
    });

    const buyCandidates = sortCandidates(
      candidates.filter((candidate) => candidate.direction === 'BUY'),
    );
    const sellCandidates = sortCandidates(
      candidates.filter((candidate) => candidate.direction === 'SELL'),
    );

    console.log(
      `[STRATEGIST_CANDIDATES] buys=${
        buyCandidates
          .map((c) => `${c.asset.ticker}:${Math.round(c.amountRub)}`)
          .join(',') || 'none'
      } sells=${
        sellCandidates
          .map((c) => `${c.asset.ticker}:${Math.round(c.amountRub)}`)
          .join(',') || 'none'
      } blockedByPolicy=${[...blockedByPolicy].join(',') || 'none'}`,
    );

    const stockTickers = assetsAnalysis
      .filter((asset) => {
        const type = (asset.assetType || '').toUpperCase();
        return type === 'А' || type === 'АКЦИЯ' || type === 'STOCK';
      })
      .map((asset) => (asset.ticker || '').trim().toUpperCase())
      .filter(Boolean);
    const receivedDividendTickers = Object.entries(input.dividendYields ?? {})
      .filter(
        ([, value]) => typeof value === 'number' && Number.isFinite(value),
      )
      .map(([ticker]) => ticker.toUpperCase());
    const missingDividendTickers = stockTickers.filter(
      (ticker) => !receivedDividendTickers.includes(ticker),
    );
    const incomeAnchor = calculateIncomeAnchor(
      assetsAnalysis,
      input.bondYields,
      input.dividendYields,
      input.dividendYieldsMeta,
    );
    console.log(
      `[DIVIDEND_YIELDS_STRATEGIST] received=${receivedDividendTickers.join(',') || 'none'} ` +
        `used=${receivedDividendTickers.length} missing=${missingDividendTickers.join(',') || 'none'} ` +
        `source=${incomeAnchor.dividendSource ?? 'none'} ` +
        `asOf=${incomeAnchor.dividendAsOf ?? 'n/a'} ` +
        `kind=${incomeAnchor.dividendKind ?? 'none'}`,
    );

    // ─── Стратегия 1: Ребалансировка полная ───
    const fullSteps: StrategyStep[] = [];
    for (const candidate of [...buyCandidates, ...sellCandidates]) {
      fullSteps.push(
        buildStep(candidate, fullSteps.length + 1, candidate.amountRub),
      );
    }
    if (fullSteps.length === 0) {
      fullSteps.push(
        buildHoldStep('Отклонений по валидированным карточкам нет.'),
      );
    }

    const fullStrategy: InvestmentStrategy = {
      name: 'Ребалансировка полная',
      description:
        'Все покупки из дефицитов и сокращения из профицитов по валидированным карточкам. ' +
        'Продажи активов, запрещённых пользовательской политикой, исключены.',
      steps: fullSteps,
      incomeAnchor,
      riskLevel: 'MEDIUM',
    };

    // ─── Стратегия 2: Ребалансировка частичная ───
    const partialCandidates = [...buyCandidates, ...sellCandidates].filter(
      (candidate) => candidate.deviationPp > 1,
    );
    const partialSteps: StrategyStep[] = [];
    for (const candidate of partialCandidates) {
      const roundedAmount = roundAmountToLot(
        candidate.amountRub,
        candidate.asset,
        input.lotSizes,
        'nearest',
      );
      if (roundedAmount <= 0) {
        continue;
      }
      partialSteps.push(
        buildStep(candidate, partialSteps.length + 1, roundedAmount),
      );
    }
    if (partialSteps.length === 0) {
      partialSteps.push(
        buildHoldStep(
          'Нет отклонений больше 1 п.п. по валидированным карточкам.',
        ),
      );
    }

    const partialStrategy: InvestmentStrategy = {
      name: 'Ребалансировка частичная',
      description:
        'Только отклонения больше 1 п.п. Суммы округлены до лота акции ' +
        'или листа облигации.',
      steps: partialSteps,
      incomeAnchor,
      riskLevel: 'MEDIUM',
    };

    // ─── Стратегия 3: Консервативная ───
    const monthlyContribution = Math.max(0, input.monthlyContribution ?? 0);
    const conservativeSteps: StrategyStep[] = [];

    if (monthlyContribution > 0 && buyCandidates.length > 0) {
      const totalDeficit = buyCandidates.reduce(
        (sum, candidate) => sum + candidate.amountRub,
        0,
      );

      // Взнос распределяется пропорционально дефицитам, чтобы покрыть
      // несколько бумаг, а не только самую крупную позицию.
      const planned = buyCandidates.map((candidate) => {
        const raw =
          totalDeficit > 0
            ? (monthlyContribution * candidate.amountRub) / totalDeficit
            : 0;
        const amount = roundAmountToLot(
          Math.min(raw, candidate.amountRub),
          candidate.asset,
          input.lotSizes,
          'floor',
        );
        return { candidate, raw, amount };
      });

      let remainingBudget =
        monthlyContribution -
        planned.reduce((sum, item) => sum + item.amount, 0);

      // Остаток от округления — по наибольшей дробной части лота.
      while (remainingBudget > 0) {
        let best: (typeof planned)[number] | null = null;
        let bestFraction = -1;

        for (const item of planned) {
          const lotValue = lotValueOf(item.candidate.asset, input.lotSizes);
          if (lotValue <= 0 || lotValue > remainingBudget) {
            continue;
          }
          if (item.amount + lotValue > item.candidate.amountRub) {
            continue;
          }
          const fraction = (item.raw - item.amount) / lotValue;
          if (fraction > bestFraction) {
            bestFraction = fraction;
            best = item;
          }
        }

        if (!best) {
          break;
        }

        const lotValue = lotValueOf(best.candidate.asset, input.lotSizes);
        const nextAmount = Math.floor(best.amount + lotValue);
        const delta = nextAmount - best.amount;
        if (delta <= 0) {
          break;
        }
        best.amount = nextAmount;
        remainingBudget -= delta;
      }

      for (const item of planned) {
        if (item.amount <= 0) {
          continue;
        }
        conservativeSteps.push(
          buildStep(
            item.candidate,
            conservativeSteps.length + 1,
            item.amount,
            `(в пределах ежемесячного взноса ${formatRub(monthlyContribution)})`,
          ),
        );
      }
    }

    if (conservativeSteps.length === 0) {
      conservativeSteps.push(
        buildHoldStep(
          monthlyContribution > 0
            ? 'Покупок в пределах ежемесячного взноса не требуется; продажи не выполняются.'
            : 'Ежемесячный взнос не задан; продажи не выполняются.',
        ),
      );
    }

    const conservativeStrategy: InvestmentStrategy = {
      name: 'Консервативная',
      description:
        'Только покупки в пределах ежемесячного взноса. Продажи не выполняются.',
      steps: conservativeSteps,
      incomeAnchor,
      riskLevel: 'LOW',
    };

    const strategies = [fullStrategy, partialStrategy, conservativeStrategy];
    const conflicts = validateStrategyConsistency(
      strategies,
      decisions,
      assetsAnalysis,
      policy,
    );
    removeConflictingSteps(strategies, conflicts);

    return { strategies, conflicts, blockedByPolicy: [...blockedByPolicy] };
  }

  // ── Helpers ──

  private buildStrategistNote(
    action: AiAction | null,
    drawdownPercent: number | null,
    concentrationPercent: number | null,
    unrealizedPnl: number,
    rationale: string | null,
  ): string | null {
    const notes: string[] = [];

    // Указание на глубокую просадку (аналитика, не блокировка)
    if (drawdownPercent !== null && drawdownPercent < -30) {
      notes.push(
        `Глубокая просадка: ${drawdownPercent.toFixed(1)}% от цены покупки. ` +
          `Нереализованный P&L: ${unrealizedPnl.toFixed(0)} ₽.`,
      );
    }

    // Указание на высокую концентрацию
    if (concentrationPercent !== null && concentrationPercent > 25) {
      notes.push(
        `Высокая концентрация: ${concentrationPercent.toFixed(1)}% портфеля.`,
      );
    }

    // Если AI предлагает EXIT/SELL при большой прибыли — похвала
    if (
      (action === 'SELL' || action === 'EXIT') &&
      unrealizedPnl > 0 &&
      drawdownPercent !== null &&
      drawdownPercent > 0
    ) {
      notes.push(
        `AI предлагает ${action} при нереализованной прибыли ${unrealizedPnl.toFixed(0)} ₽. ` +
          `Обоснование: ${rationale || 'не указано'}.`,
      );
    }

    return notes.length > 0 ? notes.join(' ') : null;
  }

  private emptyResult(): StrategistAgentOutput {
    return {
      decisions: [],
      summary: {
        assetsChecked: 0,
        goal:
          'Максимизировать потенциальную прибыль портфеля, вывести портфель ' +
          'в зелёную зону, сохраняя надёжность и устойчивость.',
      },
      strategies: [],
      strategyConflicts: [],
      policyWarnings: [],
    };
  }
}
