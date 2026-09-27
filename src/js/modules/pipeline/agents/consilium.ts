/**
 * Consilium — общее совещание агентов портфеля.
 *
 * Роль: решения о продаже/покупке НЕ принимаются одним агентом.
 * Каждое значимое действие выносится на голосование всех участников:
 *   - ai         — LLM-рекомендация (предложение);
 *   - strategist — детерминированные правила защиты (зелёная зона);
 *   - scenario   — агент «что если» (лучший сценарий по структуре/P&L);
 *   - research   — новостной фон (катализаторы/риски).
 *
 * Принципы:
 * 1. Вето стратега имеет наивысший приоритет (безопасность > прибыль).
 * 2. Research без новостей не блокирует, но предпочитает HOLD при
 *    отсутствии катализаторов.
 * 3. Итоговое решение фиксирует согласие: UNANIMOUS/MAJORITY/CONFLICT —
 *    пользователь всегда видит, был ли консенсус.
 */

import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import type { AiAction } from '../../research/types.js';
import type { StrategistOverride } from '../../ai-advisor/structured-ai-recommendation.js';
import type {
  StrategistAgentOutput,
  StrategistProposal,
} from './strategist-agent.js';
import type { ScenarioAgentOutput } from './scenario-agent.js';

// ──────────────────────────────────────────────
// 1. Types
// ──────────────────────────────────────────────

/** Голос одного агента по активу */
export interface ConsiliumVote {
  agent: 'ai' | 'strategist' | 'scenario' | 'research';
  action: AiAction;
  /** Пояснение голоса */
  note?: string;
}

/** Итоговое решение консилиума по активу */
export interface ConsiliumAssetDecision {
  ticker: string;
  name: string;
  /** Финальное действие (после голосования) */
  finalAction: AiAction;
  /** Степень согласия агентов */
  agreement: 'UNANIMOUS' | 'MAJORITY' | 'CONFLICT';
  /** Все голоса */
  votes: ConsiliumVote[];
  /** Вето стратега (если применялось) */
  strategistVeto: StrategistOverride | null;
  /** Лучший сценарий, поддержанный агентом сценариев */
  bestScenarioId: string | null;
}

/** Входные данные консилиума */
export interface ConsiliumInput {
  /** Анализ всех активов портфеля */
  assetsAnalysis: AssetAnalysis[];
  /** Предложения AI */
  proposals: StrategistProposal[];
  /** Решения стратега */
  strategistOutput: StrategistAgentOutput;
  /** Сценарии агента «что если» */
  scenarioOutput: ScenarioAgentOutput;
  /** Новостной фон (опционально) */
  newsContext?: string;
}

/** Результат консилиума */
export interface ConsiliumOutput {
  decisions: ConsiliumAssetDecision[];
  summary: {
    assetsDiscussed: number;
    unanimous: number;
    majority: number;
    conflicts: number;
    vetoed: number;
  };
}

// ──────────────────────────────────────────────
// 2. Research vote (новостной фон)
// ──────────────────────────────────────────────

/** Ключевые слова негативного/позитивного фона */
const NEGATIVE_NEWS_HINTS: readonly string[] = [
  'санкци',
  'геополитик',
  'падение',
  'убыток',
  'штраф',
  'снижение',
  'риск',
  'блокировк',
  'конфискаци',
];

const POSITIVE_NEWS_HINTS: readonly string[] = [
  'рост',
  'рекорд',
  'прибыл',
  'дивиденд',
  'выкуп',
  'поддержка',
  'смягчение',
  'соглашение',
];

/**
 * Голос агента research по активу.
 *
 * Без новостного контекста или при негативном фоне без катализатора —
 * осторожный HOLD (не даём поводов для панических продаж).
 * Позитивный фон — поддержка предлагаемых действий (кроме продаж в убыток).
 */
function researchVote(
  proposedAction: AiAction,
  catalysts: string[],
  newsContext: string | undefined,
): ConsiliumVote {
  const text = (newsContext ?? '').toLowerCase();
  const hasCatalyst = catalysts.length > 0;

  if (!text) {
    return {
      agent: 'research',
      action: hasCatalyst ? proposedAction : 'HOLD',
      note: hasCatalyst
        ? 'Катализатор указан, новостной фон не передан.'
        : 'Новостной фон отсутствует — придерживаемся осторожности (HOLD).',
    };
  }

  const negative = NEGATIVE_NEWS_HINTS.some((h) => text.includes(h));
  const positive = POSITIVE_NEWS_HINTS.some((h) => text.includes(h));

  if (negative && !hasCatalyst) {
    return {
      agent: 'research',
      action: 'HOLD',
      note: 'Негативный новостной фон без катализатора — избегаем продаж и новых покупок.',
    };
  }

  if (positive) {
    return {
      agent: 'research',
      action: proposedAction,
      note: 'Позитивный новостной фон подтверждает активность.',
    };
  }

  return {
    agent: 'research',
    action: proposedAction,
    note: 'Новостной фон нейтрален.',
  };
}

// ──────────────────────────────────────────────
// 3. Consilium
// ──────────────────────────────────────────────

/**
 * Провести совещание агентов по всем активам с предложениями.
 */
export function runConsilium(input: ConsiliumInput): ConsiliumOutput {
  const assetsAnalysis = input?.assetsAnalysis ?? [];
  const proposals = input?.proposals ?? [];
  const strategist = input?.strategistOutput;
  const scenarios = input?.scenarioOutput;
  const newsContext = input?.newsContext;

  const assetByTicker = new Map<string, AssetAnalysis>();
  for (const asset of assetsAnalysis) {
    assetByTicker.set(asset.ticker.toUpperCase(), asset);
  }

  // Индекс решений стратега и сценариев по тикеру
  const strategistByTicker = new Map<
    string,
    (typeof strategist extends null
      ? never
      : NonNullable<typeof strategist>)['decisions'][number]
  >();
  if (strategist) {
    for (const d of strategist.decisions) {
      strategistByTicker.set(d.ticker.toUpperCase(), d);
    }
  }

  const decisions: ConsiliumAssetDecision[] = [];
  let unanimous = 0;
  let majority = 0;
  let conflicts = 0;
  let vetoed = 0;

  for (const proposal of proposals) {
    const key = proposal.ticker.toUpperCase();
    const asset = assetByTicker.get(key);
    const strategistDecision = strategistByTicker.get(key);
    const name = asset?.name ?? proposal.ticker;

    // 1. Голос AI — исходное предложение
    const aiVote: ConsiliumVote = {
      agent: 'ai',
      action: proposal.action ?? 'HOLD',
      note: 'Предложение LLM-советника.',
    };

    // 2. Голос стратега — итоговое действие после правил
    const strategistAction = strategistDecision?.finalAction ?? 'HOLD';
    const strategistVote: ConsiliumVote = {
      agent: 'strategist',
      action: strategistAction,
      note: strategistDecision?.veto
        ? 'Вето: ' + strategistDecision.veto.reason
        : 'Правила защиты портфеля соблюдены.',
    };

    // 3. Голос сценариста — из лучшего сценария
    const scenarioVote = buildScenarioVote(
      proposal,
      scenarios?.bestScenarioId ?? null,
      scenarios?.scenarios ?? [],
    );

    // 4. Голос research — новостной фон
    const research = researchVote(
      proposal.action ?? 'HOLD',
      proposal.keyCatalysts ?? [],
      newsContext,
    );

    const votes: ConsiliumVote[] = [
      aiVote,
      strategistVote,
      scenarioVote,
      research,
    ];

    // 5. Подсчёт голосов
    const veto = strategistDecision?.veto ?? null;
    let finalAction: AiAction;
    let agreement: ConsiliumAssetDecision['agreement'];

    if (veto) {
      // Вето стратега имеет высший приоритет
      finalAction = strategistAction;
      agreement = 'CONFLICT';
      vetoed++;
      conflicts++;
    } else {
      const actionCounts = new Map<AiAction, number>();
      for (const v of votes) {
        actionCounts.set(v.action, (actionCounts.get(v.action) ?? 0) + 1);
      }
      const sorted = [...actionCounts.entries()].sort((a, b) => b[1] - a[1]);
      const topEntry = sorted[0];
      const secondCount = sorted[1]?.[1] ?? 0;

      // votes гарантированно непустой (4 участника), но защищаемся от крайностей
      const topAction: AiAction = topEntry ? topEntry[0] : 'HOLD';
      const topCount = topEntry ? topEntry[1] : 0;

      if (topCount === votes.length) {
        agreement = 'UNANIMOUS';
        unanimous++;
        finalAction = topAction;
      } else if (topCount >= 3 || (topCount === 2 && secondCount === 1)) {
        agreement = 'MAJORITY';
        majority++;
        finalAction = topAction;
      } else {
        // Ничья 2:2 — стратег (безопасность) решает спор
        agreement = 'CONFLICT';
        conflicts++;
        finalAction = strategistAction;
      }
    }

    decisions.push({
      ticker: proposal.ticker,
      name,
      finalAction,
      agreement,
      votes,
      strategistVeto: veto,
      bestScenarioId: scenarios?.bestScenarioId ?? null,
    });
  }

  return {
    decisions,
    summary: {
      assetsDiscussed: decisions.length,
      unanimous,
      majority,
      conflicts,
      vetoed,
    },
  };
}

// ──────────────────────────────────────────────
// 4. Helpers
// ──────────────────────────────────────────────

/** Голос сценариста: поддерживает действие из лучшего сценария или HOLD */
function buildScenarioVote(
  proposal: StrategistProposal,
  bestScenarioId: string | null,
  scenarios: NonNullable<ScenarioAgentOutput['scenarios']>,
): ConsiliumVote {
  if (!bestScenarioId) {
    return {
      agent: 'scenario',
      action: 'HOLD',
      note: 'Сценарии не построены — baseline (удержание).',
    };
  }

  const best = scenarios.find((s) => s.id === bestScenarioId);
  if (!best) {
    return {
      agent: 'scenario',
      action: 'HOLD',
      note: 'Лучший сценарий не найден.',
    };
  }

  const change = best.changes.find(
    (c) => c.ticker.toUpperCase() === proposal.ticker.toUpperCase(),
  );

  if (!change || best.verdict === 'WORSENS') {
    return {
      agent: 'scenario',
      action: 'HOLD',
      note: `Сценарий «${best.title}»: изменений по активу нет / сценарий не улучшает.`,
    };
  }

  const action: AiAction =
    change.action === 'BUY'
      ? 'BUY'
      : change.action === 'SELL' || change.action === 'REDUCE'
        ? 'REDUCE'
        : 'HOLD';

  return {
    agent: 'scenario',
    action,
    note:
      `Сценарий «${best.title}» улучшает структуру (` +
      `${best.structureDeviationPct}% отклонение).`,
  };
}
