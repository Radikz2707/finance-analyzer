/**
 * StrategistAgent — независимый аналитический агент по стратегии и рискам.
 *
 * Роль: аналитик, который оценивает структуру портфеля, концентрацию,
 P&L, просадки и устойчивость. Может не согласиться с AI, предложить
 альтернативное действие, оценить риски — но НЕ имеет права автоматически
 блокировать или изменять решение AI.
 *
 * Главный инвестиционный вывод определяется качеством совокупного анализа,
 а не заранее прошитым veto.
 */

import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import type { AiAction } from '../../research/types.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';

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
  /** Итоговое действие (совпадает с AI — стратег не блокирует) */
  finalAction: AiAction | null;
  /** Просадка от цены покупки, % (отрицательная = убыток) */
  drawdownPercent: number | null;
  /** Концентрация позиции, % */
  concentrationPercent: number | null;
  /** Примечание стратега (аналитическое, не блокирующее) */
  note: string | null;
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
}

// ──────────────────────────────────────────────
// 2. StrategistAgent
// ──────────────────────────────────────────────

/**
 * StrategistAgent — агент-аналитик стратегии и рисков.
 *
 * Задачи:
 * - оценить структуру и концентрацию портфеля;
 * - указать на риски концентрации, просадки, P&L;
 * - предложить альтернативное действие (но НЕ блокировать AI);
 * - оценить устойчивость портфеля;
 * - сравнить стратегии.
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

    for (const proposal of proposals) {
      const asset = assetByTicker.get(proposal.ticker.toUpperCase());

      if (!asset) {
        decisions.push({
          ticker: proposal.ticker,
          name: proposal.ticker,
          suggestedAction: proposal.action,
          finalAction: proposal.action,
          drawdownPercent: null,
          concentrationPercent: null,
          note: 'Актив не найден в анализе.',
        });
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

      decisions.push({
        ticker: asset.ticker,
        name: asset.name,
        suggestedAction: proposal.action,
        finalAction: proposal.action, // стратег НЕ изменяет action AI
        drawdownPercent,
        concentrationPercent,
        note,
      });
    }

    return {
      decisions,
      summary: {
        assetsChecked: assetsAnalysis.length,
        goal:
          'Максимизировать потенциальную прибыль портфеля, вывести портфель ' +
          'в зелёную зону, сохраняя надёжность и устойчивость.',
      },
    };
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
    };
  }
}
