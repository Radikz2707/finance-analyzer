/**
 * Multi-Round Consilium — многораундовое обсуждение агентов.
 *
 * Это НЕ простое голосование. Каждый агент имеет право:
 * - предложить решение и привести аргументы;
 * - возразить другому агенту (контраргументы);
 * - поддержать аргумент;
 * - указать на противоречие;
 * - предложить альтернативу;
 * - изменить свою позицию после новых аргументов.
 *
 * Принципы:
 * 1. Ни у одного агента нет безусловного veto.
 * 2. Конфликт НЕ превращается автоматически в HOLD.
 * 3. Director при равенстве голосов вправе выбрать позицию AI —
 *    это право Director (качество рассуждения), а не привилегия агента.
 */

import type { AiAction } from '../../research/types.js';
import type {
  AgentOpinion,
  AgentRole,
  ConsiliumDiscussionInput,
  ConsiliumRound,
  MultiRoundConsiliumOutput,
} from './director-types.js';

// ──────────────────────────────────────────────
// 1. Константы
// ──────────────────────────────────────────────

const DEFAULT_MAX_ROUNDS = 3;

/** Последовательность типов раундов */
const ROUND_TYPES: readonly ConsiliumRound['roundType'][] = [
  'initial',
  'response',
  'rebuttal',
  'final',
];

/** Порядок ролей для детерминированных разрешений ничьих */
const ROLE_ORDER: readonly AgentRole[] = [
  'ai',
  'analysis',
  'strategist',
  'scenario',
  'research',
  'review',
];

/** Человекочитаемые метки ролей (локально, без циклических импортов) */
const ROLE_LABELS: Record<AgentRole, string> = {
  ai: 'AI',
  analysis: 'Analysis',
  strategist: 'Strategist',
  scenario: 'Scenario',
  research: 'Research',
  review: 'Review',
};

// ──────────────────────────────────────────────
// 2. Основной движок
// ──────────────────────────────────────────────

/**
 * Провести многораундовое обсуждение агентов.
 *
 * @returns MultiRoundConsiliumOutput с полным следом раундов.
 */
export function runMultiRoundConsilium(
  input: ConsiliumDiscussionInput,
): MultiRoundConsiliumOutput {
  const maxRounds = Math.max(1, input?.maxRounds ?? DEFAULT_MAX_ROUNDS);
  const aiTieBreak = input?.aiTieBreak ?? true;
  const opinions = dedupeByRole(input?.initialOpinions ?? []);
  const discussionTopics = input?.discussionTopics ?? [];

  const rounds: ConsiliumRound[] = [];
  const changedRoles = new Set<AgentRole>();

  if (opinions.length === 0) {
    return emptyOutput(discussionTopics);
  }

  // ── Раунд 1: первичные позиции ──
  let current = opinions;
  rounds.push(buildRound(current, 1, 'initial'));

  // ── Дополнительные раунды при существенном конфликте ──
  let roundNumber = 1;
  let consensus = hasConsensus(current);

  while (!consensus && roundNumber < maxRounds) {
    roundNumber++;
    const roundType =
      ROUND_TYPES[Math.min(roundNumber, ROUND_TYPES.length - 1)] ?? 'response';

    const { next, changes } = respondToObjections(
      current,
      roundNumber,
      changedRoles,
    );
    current = next;
    for (const change of changes) {
      changedRoles.add(change.role);
    }

    // Последний раунд помечается как final
    const effectiveType: ConsiliumRound['roundType'] =
      roundNumber === maxRounds || hasConsensus(current) ? 'final' : roundType;

    const round = buildRound(current, roundNumber, effectiveType);
    round.positionChanges.push(...changes);
    rounds.push(round);

    consensus = hasConsensus(current);
  }

  // ── Итоговая рекомендация ──
  const finalRound = rounds[rounds.length - 1]!;
  const recommendation = resolveRecommendation(
    finalRound.agentOpinions,
    aiTieBreak,
  );

  return {
    rounds,
    keyArguments: collectKeyArguments(rounds),
    counterArguments: collectCounterArguments(rounds),
    pointsOfAgreement: finalRound.pointsOfAgreement,
    pointsOfDisagreement: finalRound.pointsOfDisagreement,
    finalRecommendation: recommendation,
    directorReasoning: buildDirectorReasoning(rounds, recommendation),
    directorConfidence: recommendation.confidence,
  };
}

// ──────────────────────────────────────────────
// 3. Построение раунда
// ──────────────────────────────────────────────

/** Построить один раунд обсуждения из позиций агентов */
function buildRound(
  opinions: AgentOpinion[],
  roundNumber: number,
  roundType: ConsiliumRound['roundType'],
): ConsiliumRound {
  const agentOpinions: ConsiliumRound['agentOpinions'] = opinions.map((o) => ({
    role: o.role,
    position: o.position,
    action: o.action,
    confidence: o.confidence,
    arguments: [...o.arguments],
    counterArguments: [],
    agreedWith: [],
    disagreedWith: [],
  }));

  // Определяем согласие/разногласия внутри раунда
  const actionGroups = groupByAction(opinions);

  for (const entry of agentOpinions) {
    const disagreeingRoles: AgentRole[] = [];
    const agreeingRoles: AgentRole[] = [];

    for (const [action, group] of actionGroups) {
      if (action === entry.action) {
        agreeingRoles.push(...group.filter((r) => r !== entry.role));
      } else {
        disagreeingRoles.push(...group);
      }
    }

    entry.agreedWith = unique(agreeingRoles);
    entry.disagreedWith = unique(disagreeingRoles);

    // Контраргументы: если есть противоположная группа — формулируем возражение
    if (disagreeingRoles.length > 0) {
      entry.counterArguments = [
        `${ROLE_LABELS[entry.role]}: против моей позиции выступают ` +
          `${labelRoles(disagreeingRoles)} — их аргументы нужно учесть.`,
      ];
    }
  }

  return {
    roundNumber,
    roundType,
    agentOpinions,
    pointsOfAgreement: buildPointsOfAgreement(opinions),
    pointsOfDisagreement: buildPointsOfDisagreement(opinions),
    positionChanges: [],
  };
}

/**
 * Агенты отвечают на возражения: уточняют аргументы и при необходимости
 * корректируют позицию. Позиция меняется только если:
 * - существует конфликт действий;
 * - собственная уверенность ниже средней уверенности оппонентов;
 * - сторона оппонентов не меньше по числу.
 */
function respondToObjections(
  opinions: AgentOpinion[],
  roundNumber: number,
  alreadyChanged: Set<AgentRole>,
): {
  next: AgentOpinion[];
  changes: ConsiliumRound['positionChanges'];
} {
  const actionGroups = groupByAction(opinions);
  const changes: ConsiliumRound['positionChanges'] = [];
  const next: AgentOpinion[] = [];

  for (const opinion of opinions) {
    const opposing = [...actionGroups.entries()].filter(
      ([action]) => action !== opinion.action,
    );
    const opposingOpinions = opposing
      .flatMap(([, roles]) =>
        roles.map((role) => opinions.find((o) => o.role === role)),
      )
      .filter((o): o is AgentOpinion => o !== undefined);

    const ownGroupSize = actionGroups.get(opinion.action)?.length ?? 1;

    const shouldChange =
      opposing.length > 0 &&
      !alreadyChanged.has(opinion.role) &&
      roundNumber >= 2 &&
      opinion.confidence < averageConfidence(opposingOpinions) &&
      opposingOpinions.length >= ownGroupSize;

    if (!shouldChange || opposingOpinions.length === 0) {
      next.push({
        ...opinion,
        arguments: [...opinion.arguments],
      });
      continue;
    }

    const dominantOpposing = dominantAction(opposingOpinions);
    const newConfidence = clamp(
      Math.min(opinion.confidence, averageConfidence(opposingOpinions) - 0.05),
      0,
      1,
    );

    changes.push({
      role: opinion.role,
      previousAction: opinion.action,
      newAction: dominantOpposing,
      reason:
        `После возражений ${labelRoles(
          opposingOpinions.map((o) => o.role),
        )} (уверенность ${fmtConfidence(
          averageConfidence(opposingOpinions),
        )}) агент уточнил позицию: ` +
        'новые аргументы перевешивают прежнюю уверенность.',
    });

    next.push({
      ...opinion,
      action: dominantOpposing,
      confidence: newConfidence,
      position:
        `Уточнено: после обсуждения склоняюсь к «${dominantOpposing}» ` +
        `(уверенность снижена до ${fmtConfidence(newConfidence)}).`,
      arguments: [
        ...opinion.arguments,
        `Пересмотрено в раунде ${roundNumber}: аргументы оппонентов приняты во внимание.`,
      ],
    });
  }

  return { next, changes };
}

// ──────────────────────────────────────────────
// 4. Агрегация и итог
// ──────────────────────────────────────────────

/**
 * Итоговая рекомендация: взвешенная оценка действий последнего раунда.
 * При равенстве голосов Director вправе выбрать позицию AI (не HOLD!).
 */
function resolveRecommendation(
  opinions: ConsiliumRound['agentOpinions'],
  aiTieBreak: boolean,
): MultiRoundConsiliumOutput['finalRecommendation'] {
  const withAction = opinions.filter(
    (o): o is typeof o & { action: AiAction } => o.action !== null,
  );

  if (withAction.length === 0) {
    return {
      action: 'HOLD',
      confidence: 0,
      reasoning: 'Ни один агент не предложил конкретного действия.',
    };
  }

  const scores = new Map<AiAction, number>();
  const counts = new Map<AiAction, number>();

  for (const o of withAction) {
    scores.set(o.action, (scores.get(o.action) ?? 0) + o.confidence);
    counts.set(o.action, (counts.get(o.action) ?? 0) + 1);
  }

  // Взвешенный балл: уверенность + вес за поддержку
  const weighted = new Map<AiAction, number>();
  for (const [action, score] of scores) {
    weighted.set(action, score + 0.5 * (counts.get(action) ?? 0));
  }

  const ranked = [...weighted.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const second = ranked[1];

  let winner: AiAction = top?.[0] ?? 'HOLD';

  // Ничья: Director выбирает позицию AI (право Director, не veto агента)
  if (top && second && Math.abs(top[1] - second[1]) < 0.001) {
    const aiOpinion = withAction.find((o) => o.role === 'ai');
    if (aiTieBreak && aiOpinion) {
      winner = aiOpinion.action;
    } else {
      winner = top[0];
    }
  }

  const totalScore = [...weighted.values()].reduce((s, v) => s + v, 0);
  const winnerScore = weighted.get(winner) ?? 0;
  const confidence = totalScore > 0 ? clamp(winnerScore / totalScore, 0, 1) : 0;

  const distribution = ranked
    .map(([action, score]) => `${action} (${score.toFixed(1)})`)
    .join(', ');

  return {
    action: winner,
    confidence,
    reasoning:
      `Распределение по последнему раунду: ${distribution}. ` +
      `Победило действие «${winner}» по совокупной уверенности и поддержке.`,
  };
}

/** Обоснование Director: почему принят именно такой вывод */
function buildDirectorReasoning(
  rounds: ConsiliumRound[],
  recommendation: MultiRoundConsiliumOutput['finalRecommendation'],
): string {
  const last = rounds[rounds.length - 1];
  const parts: string[] = [];

  parts.push(`Проведено раундов: ${rounds.length}.`);

  if (last && last.pointsOfAgreement.length > 0) {
    parts.push(
      `Точки согласия: ${last.pointsOfAgreement.slice(0, 3).join('; ')}.`,
    );
  }
  if (last && last.pointsOfDisagreement.length > 0) {
    parts.push(
      `Остались разногласия: ${last.pointsOfDisagreement
        .slice(0, 3)
        .join('; ')}.`,
    );
  }

  const changes = rounds.flatMap((r) => r.positionChanges);
  if (changes.length > 0) {
    parts.push(
      `Агенты уточнили позиции: ${changes.length} изменение(я) зафиксировано.`,
    );
  }

  parts.push(
    `Итог: «${recommendation.action}» с уверенностью ` +
      `${Math.round(recommendation.confidence * 100)}%. ` +
      'Решение принято по качеству аргументов, без безусловного veto кого-либо из агентов.',
  );

  return parts.join(' ');
}

// ───'──────────────────────────────────────────'
// 5. Helpers
// ──────────────────────────────────────────────

/** Удалить дубликаты мнений по роли (первый источник — приоритет) */
function dedupeByRole(opinions: AgentOpinion[]): AgentOpinion[] {
  const seen = new Set<AgentRole>();
  const result: AgentOpinion[] = [];
  for (const o of opinions) {
    if (seen.has(o.role)) continue;
    seen.add(o.role);
    result.push(o);
  }
  return result;
}

/** Сгруппировать роли по действию */
function groupByAction(
  opinions: AgentOpinion[],
): Map<AiAction | null, AgentRole[]> {
  const groups = new Map<AiAction | null, AgentRole[]>();
  for (const o of opinions) {
    const list = groups.get(o.action) ?? [];
    list.push(o.role);
    groups.set(o.action, list);
  }
  return groups;
}

/** Есть ли консенсус (одно действие у всех) */
function hasConsensus(opinions: AgentOpinion[]): boolean {
  if (opinions.length === 0) return true;
  const actions = new Set(opinions.map((o) => o.action));
  return actions.size <= 1;
}

function averageConfidence(opinions: AgentOpinion[]): number {
  if (opinions.length === 0) return 0;
  return opinions.reduce((sum, o) => sum + o.confidence, 0) / opinions.length;
}

/** Действие с наибольшей поддержкой среди группы */
function dominantAction(opinions: AgentOpinion[]): AiAction {
  const counts = new Map<AiAction, number>();
  for (const o of opinions) {
    if (o.action !== null) {
      counts.set(o.action, (counts.get(o.action) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? 'HOLD';
}

function buildPointsOfAgreement(opinions: AgentOpinion[]): string[] {
  const points: string[] = [];

  const distinctActions = new Set(opinions.map((o) => o.action));
  if (distinctActions.size === 1 && [...distinctActions][0] !== null) {
    points.push(
      `Все агенты сходятся на действии «${[...distinctActions][0]}».`,
    );
  }

  // Аргументы, повторяющиеся у двух и более агентов
  const seen = new Map<string, AgentRole[]>();
  for (const o of opinions) {
    for (const arg of o.arguments) {
      const key = arg.trim().toLowerCase().slice(0, 60);
      if (!key) continue;
      const roles = seen.get(key) ?? [];
      roles.push(o.role);
      seen.set(key, roles);
    }
  }
  for (const [key, roles] of seen) {
    if (roles.length >= 2) {
      points.push(
        `Аргумент поддержан несколькими агентами (${labelRoles(
          roles,
        )}): «${key}…»`,
      );
    }
  }

  return unique(points);
}

function buildPointsOfDisagreement(opinions: AgentOpinion[]): string[] {
  const points: string[] = [];

  const distinctActions = new Set(opinions.map((o) => o.action));
  if (distinctActions.size > 1) {
    points.push(
      `Разные предложенные действия: ${[...distinctActions].join(' vs ')}.`,
    );
  }

  // Расхождения уверенности при одинаковом действии
  const byAction = new Map<AiAction | null, AgentOpinion[]>();
  for (const o of opinions) {
    const list = byAction.get(o.action) ?? [];
    list.push(o);
    byAction.set(o.action, list);
  }
  for (const [action, list] of byAction) {
    if (action === null || list.length < 2) continue;
    const confidences = list.map((o) => o.confidence);
    const max = Math.max(...confidences);
    const min = Math.min(...confidences);
    if (max - min > 0.3) {
      points.push(
        `Агенты поддерживают «${action}», но уверенность сильно различается: ` +
          `${fmtConfidence(min)}–${fmtConfidence(max)}.`,
      );
    }
  }

  return unique(points);
}

function collectKeyArguments(rounds: ConsiliumRound[]): string[] {
  const args: string[] = [];
  for (const round of rounds) {
    for (const o of round.agentOpinions) {
      args.push(...o.arguments);
    }
  }
  return unique(args);
}

function collectCounterArguments(rounds: ConsiliumRound[]): string[] {
  const args: string[] = [];
  for (const round of rounds) {
    for (const o of round.agentOpinions) {
      if (o.counterArguments) {
        args.push(...o.counterArguments);
      }
    }
  }
  return unique(args);
}

function emptyOutput(discussionTopics: string[]): MultiRoundConsiliumOutput {
  return {
    rounds: [],
    keyArguments: [],
    counterArguments: [],
    pointsOfAgreement: [],
    pointsOfDisagreement: discussionTopics.slice(0, 1),
    finalRecommendation: {
      action: 'HOLD',
      confidence: 0,
      reasoning: 'Нет мнений агентов для обсуждения.',
    },
    directorReasoning:
      'Консилиум не проводился: не было ни одного мнения агентов.',
    directorConfidence: 0,
  };
}

function labelRoles(roles: AgentRole[]): string {
  return unique(roles)
    .map((r) => ROLE_LABELS[r])
    .join(', ');
}

function fmtConfidence(v: number): string {
  return Math.round(v * 100) + '%';
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// Экспорт вспомогательных типов/функций для тестов и повторного использования
export const CONSILIUM_ROLE_ORDER: readonly AgentRole[] = ROLE_ORDER;
