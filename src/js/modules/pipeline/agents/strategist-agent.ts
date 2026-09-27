/**
 * StrategistAgent — детерминированный стратег портфеля.
 *
 * Роль: защитник главной цели портфеля — выход в ЗЕЛЁНУЮ ЗОНУ.
 * В отличие от LLM-агентов, стратег работает на жёстких правилах и не
 * может «забыть» про ограничения: решения, которые фиксируют глубокий
 * убыток без подтверждённого катализатора, блокируются для ЛЮБОГО
 * актива (не только для конкретных бумаг).
 *
 * Источник данных: AssetAnalysis из PortfolioMath содержит balancePrice
 * (средняя цена покупки) и currentPrice — на их основе считается
 * просадка drawdownPercent. Правило применяется ко всем тикерам.
 *
 * Интеграция: StrategistAgent — самостоятельный агент конвейера; его
 * решение используется в Consilium (общем совещании агентов) и имеет
 * право вето над рекомендациями AI.
 */

import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import type { AiAction } from '../../research/types.js';
import {
  applyStrategistRules,
  buildDeterministicAssetData,
  type StrategistOverride,
} from '../../ai-advisor/structured-ai-recommendation.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';

// ──────────────────────────────────────────────
// 1. Types
// ──────────────────────────────────────────────

/** Входные данные для одного актива: что предложил AI */
export interface StrategistProposal {
  ticker: string;
  /** Действие, предложенное AI (BUY/SELL/HOLD/REDUCE/AVOID или null) */
  action: AiAction | null;
  /** Катализаторы, найденные AI (фундамент, отчёт, дивиденды...) */
  keyCatalysts?: string[];
  /** Обоснование AI */
  rationale?: string | null;
}

/** Входные данные StrategistAgent */
export interface StrategistAgentInput {
  /** Анализ всех активов портфеля (из AnalysisAgent / PortfolioMath) */
  assetsAnalysis: AssetAnalysis[];
  /** Предложения AI по каждому активу */
  proposals: StrategistProposal[];
}

/** Вердикт стратега по одному активу */
export interface StrategistDecision {
  ticker: string;
  name: string;
  /** Действие, предложенное AI */
  suggestedAction: AiAction | null;
  /** Итоговое действие после правил стратега */
  finalAction: AiAction | null;
  /** Просадка от цены покупки, % (отрицательная = убыток) */
  drawdownPercent: number | null;
  /** Данные о вмешательстве стратега (null = без вмешательства) */
  veto: StrategistOverride | null;
}

/** Выходные данные StrategistAgent */
export interface StrategistAgentOutput {
  /** Решения по всем активам, по которым были предложения */
  decisions: StrategistDecision[];
  /** Сводка работы стратега */
  summary: {
    /** Сколько активов проверено */
    assetsChecked: number;
    /** Сколько действий AI заблокировано/переопределено */
    actionsBlocked: number;
    /** Текущая цель портфеля (для отчётов и объяснений) */
    goal: string;
  };
}

// ──────────────────────────────────────────────
// 2. StrategistAgent
// ──────────────────────────────────────────────

/**
 * StrategistAgent — агент-стратег.
 *
 * Задачи:
 * - проверить ВСЕ предложения AI против правил защиты портфеля;
 * - заблокировать SELL/REDUCE при просадке глубже порога без катализатора;
 * - вернуть veto с человекочитаемой причиной для отчёта/консилиума.
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

    if (assetsAnalysis.length === 0 || proposals.length === 0) {
      return this.emptyResult();
    }

    // Индекс активов по тикеру (для быстрого поиска AssetAnalysis)
    const assetByTicker = new Map<string, AssetAnalysis>();
    for (const asset of assetsAnalysis) {
      assetByTicker.set(asset.ticker.toUpperCase(), asset);
    }

    const decisions: StrategistDecision[] = [];
    let actionsBlocked = 0;

    for (const proposal of proposals) {
      const asset = assetByTicker.get(proposal.ticker.toUpperCase());

      // Актив не найден в анализе — не можем применить правила (данных нет)
      if (!asset) {
        decisions.push({
          ticker: proposal.ticker,
          name: proposal.ticker,
          suggestedAction: proposal.action,
          finalAction: proposal.action,
          drawdownPercent: null,
          veto: null,
        });
        continue;
      }

      const det = buildDeterministicAssetData(asset, []);
      const guarded = applyStrategistRules(
        det,
        proposal.action,
        proposal.keyCatalysts ?? [],
        proposal.rationale ?? null,
      );

      const decision: StrategistDecision = {
        ticker: asset.ticker,
        name: asset.name,
        suggestedAction: proposal.action,
        finalAction: guarded.action,
        drawdownPercent: det.drawdownPercent,
        veto: guarded.override,
      };

      if (guarded.override) {
        actionsBlocked++;
      }

      decisions.push(decision);
    }

    return {
      decisions,
      summary: {
        assetsChecked: assetsAnalysis.length,
        actionsBlocked,
        goal:
          'Зелёная зона: не фиксировать глубокий убыток без катализатора; ' +
          'приоритет — восстановление и рост, а не реализация потерь.',
      },
    };
  }

  // ── Helpers ──

  private emptyResult(): StrategistAgentOutput {
    return {
      decisions: [],
      summary: {
        assetsChecked: 0,
        actionsBlocked: 0,
        goal:
          'Зелёная зона: не фиксировать глубокий убыток без катализатора; ' +
          'приоритет — восстановление и рост, а не реализация потерь.',
      },
    };
  }
}
