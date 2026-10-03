import { runMultiRoundConsilium } from './multi-round-consilium.js';
import type {
  AgentOpinion,
  ConsiliumDiscussionInput,
} from './director-types.js';

function opinion(
  role: AgentOpinion['role'],
  action: AgentOpinion['action'],
  confidence: number,
  arg: string,
): AgentOpinion {
  return {
    role,
    position: role + ' => ' + String(action) + ' (' + arg + ')',
    action,
    confidence,
    arguments: [arg],
  };
}

function buildInput(
  o?: Partial<ConsiliumDiscussionInput>,
): ConsiliumDiscussionInput {
  return {
    topic: 'Что делать с PLZL',
    tickers: ['PLZL'],
    initialOpinions: [
      opinion('ai', 'SELL', 0.8, 'Структура перегружена'),
      opinion('research', 'SELL', 0.7, 'Новостной фон негативный'),
      opinion('strategist', 'HOLD', 0.9, 'Продавать на просадке рискованно'),
      opinion(
        'scenario',
        'SELL',
        0.6,
        'Сценарий сокращения улучшает структуру',
      ),
    ],
    discussionTopics: ['Действие по PLZL'],
    ...o,
  };
}

describe('Multi-Round Consilium', () => {
  it('проводит один раунд при полном консенсусе', () => {
    const input = buildInput({
      initialOpinions: [
        opinion('ai', 'HOLD', 0.8, 'Нет оснований'),
        opinion('strategist', 'HOLD', 0.7, 'Структура в норме'),
      ],
    });
    const out = runMultiRoundConsilium(input);
    expect(out.rounds).toHaveLength(1);
    expect(out.rounds[0]!.roundNumber).toBe(1);
    expect(out.rounds[0]!.roundType).toBe('initial');
    expect(out.finalRecommendation.action).toBe('HOLD');
    expect(out.pointsOfAgreement.length).toBeGreaterThan(0);
  });

  it('поддерживает несколько раундов при существенном конфликте', () => {
    const input = buildInput({
      maxRounds: 3,
      // Все агенты уверены в своих позициях — конфликт не разрешается за 1 раунд
      initialOpinions: [
        opinion('ai', 'BUY', 0.99, 'Дефицит позиции'),
        opinion('research', 'BUY', 0.99, 'Фундаментал сильный'),
        opinion('strategist', 'HOLD', 0.99, 'Неопределённость высокая'),
        opinion('scenario', 'SELL', 0.99, 'Альтернатива эффективнее'),
      ],
    });
    const out = runMultiRoundConsilium(input);

    // Дополнительные раунды при наличии существенного конфликта
    expect(out.rounds.length).toBeGreaterThanOrEqual(2);
    // Последний раунд помечается как final
    expect(out.rounds[out.rounds.length - 1]!.roundType).toBe('final');
    // Внутри каждого раунда есть точки согласия/разногласия
    expect(out.rounds[0]!.pointsOfDisagreement.length).toBeGreaterThan(0);
    expect(out.finalRecommendation.action).toBeDefined();
  });

  it('конфликт не превращается автоматически в HOLD', () => {
    const input = buildInput({
      maxRounds: 2,
      initialOpinions: [
        opinion('ai', 'SELL', 0.8, 'Структура перегружена'),
        opinion('research', 'SELL', 0.7, 'Негативный фон'),
        opinion('scenario', 'SELL', 0.6, 'Сценарий сокращения лучше'),
        opinion('strategist', 'HOLD', 0.95, 'Осторожность'),
      ],
    });
    const out = runMultiRoundConsilium(input);

    // Есть конфликт (SELL vs HOLD), но итог НЕ принудительный HOLD
    expect(out.pointsOfDisagreement.length).toBeGreaterThan(0);
    expect(out.finalRecommendation.action).toBe('SELL');
  });

  it('ни один агент не имеет безусловного veto', () => {
    const input = buildInput({
      initialOpinions: [
        opinion('ai', 'BUY', 0.7, 'Дефицит'),
        opinion('research', 'BUY', 0.7, 'Рост прибыли'),
        opinion('scenario', 'BUY', 0.7, 'Покупка выравнивает структуру'),
        opinion('strategist', 'SELL', 0.95, 'Высокий риск концентрации'),
      ],
    });
    const out = runMultiRoundConsilium(input);

    // Strategist может быть в меньшинстве без блокировки решения
    expect(out.finalRecommendation.action).toBe('BUY');
  });

  it('агент может изменить позицию после новых аргументов', () => {
    const input = buildInput({
      maxRounds: 3,
      initialOpinions: [
        opinion('ai', 'BUY', 0.4, 'Хочется докупить'),
        opinion('strategist', 'BUY', 0.5, 'В пользу покупки'),
        opinion('scenario', 'SELL', 0.9, 'Сценарий продажи лучший'),
        opinion('research', 'SELL', 0.8, 'Данные говорят о снижении'),
      ],
    });
    const out = runMultiRoundConsilium(input);

    const changes = out.rounds.flatMap((r) => r.positionChanges);
    expect(changes.length).toBeGreaterThan(0);
    // Позиции скорректированы под сильные контраргументы
    expect(out.finalRecommendation.action).toBe('SELL');
    // Причина изменения зафиксирована
    expect(changes[0]!.reason.length).toBeGreaterThan(10);
  });

  it('Director может выбрать позицию AI при равенстве голосов (право Director, не veto)', () => {
    const input = buildInput({
      maxRounds: 2,
      aiTieBreak: true,
      initialOpinions: [
        opinion('strategist', 'REDUCE', 0.8, 'Сократить'),
        opinion('research', 'REDUCE', 0.8, 'Риски'),
        opinion('ai', 'HOLD', 0.8, 'Удержать'),
        opinion('scenario', 'HOLD', 0.8, 'Не менять'),
      ],
    });
    const withTieBreak = runMultiRoundConsilium(input);
    expect(withTieBreak.finalRecommendation.action).toBe('HOLD');

    const withoutTieBreak = runMultiRoundConsilium({
      ...input,
      aiTieBreak: false,
    });
    expect(withoutTieBreak.finalRecommendation.action).toBe('REDUCE');
  });

  it('при отсутствии мнений возвращает корректный пустой результат', () => {
    const out = runMultiRoundConsilium({
      topic: 'Пустой вопрос',
      tickers: [],
      initialOpinions: [],
      discussionTopics: [],
    });
    expect(out.rounds).toHaveLength(0);
    expect(out.finalRecommendation.action).toBe('HOLD');
    expect(out.directorReasoning).toContain('Консилиум не проводился');
  });

  it('учитывает ключевые аргументы и контраргументы', () => {
    const input = buildInput({
      initialOpinions: [
        opinion('ai', 'SELL', 0.8, 'Структура перегружена'),
        opinion('research', 'SELL', 0.7, 'Новостной фон негативный'),
        opinion('strategist', 'HOLD', 0.9, 'Продавать на просадке рискованно'),
        opinion(
          'scenario',
          'SELL',
          0.6,
          'Сценарий сокращения улучшает структуру',
        ),
      ],
    });
    const out = runMultiRoundConsilium(input);

    expect(out.keyArguments.length).toBeGreaterThan(0);
    expect(out.counterArguments.length).toBeGreaterThan(0);
    expect(out.directorReasoning).toContain('без безусловного veto');
  });
});
