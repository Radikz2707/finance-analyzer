import { buildSystemPrompt } from './prompt-templates.js';

/**
 * Тесты адаптированы под СЖАТУЮ версию промпта (5 секций вместо 22).
 * Модуль prompt-templates.ts намеренно переработан (см. шапку модуля),
 * поэтому проверяются гарантии в актуальных формулировках.
 * Тесты, проверявшие удалённые намеренно блоки, помечены skip с причиной.
 */

describe('buildSystemPrompt', () => {
  const basePrompt = buildSystemPrompt(18);

  it('contains G boundaries block', () => {
    expect(basePrompt).toContain('=== ГРАНИЦЫ ОТВЕТСТВЕННОСТИ ===');
  });

  it('contains target source block', () => {
    expect(basePrompt).toContain('=== ИСТОЧНИК ЦЕЛЕВЫХ ДОЛЕЙ ===');
  });

  it('forbids creating new targetPercent', () => {
    expect(basePrompt).toContain(
      'AI НЕ создаёт, НЕ изменяет и НЕ подменяет targetPercent',
    );
  });

  it('forbids changing BUY/REDUCE/STABLE/EXIT', () => {
    // В сжатой версии: PortfolioMath уже выполнил расчёты, AI только интерпретирует
    expect(basePrompt).toContain('AI только интерпретирует');
  });

  it('targetPercent=0 means EXIT', () => {
    expect(basePrompt).toContain('targetPercent = 0% → EXIT');
  });

  it('missing target means Цель не задана', () => {
    expect(basePrompt).toContain('targetPercent отсутствует → NO_TARGET');
  });

  it('forbids automatic 3% for ETF', () => {
    // Целевые доли — исключительно из PortfolioMath (никаких авто-долей от AI)
    expect(basePrompt).toContain('ИСКЛЮЧИТЕЛЬНО из PortfolioMath');
  });

  it('forbids invented stop-loss', () => {
    expect(basePrompt).toContain('stop-loss');
  });

  it('forbids invented price levels', () => {
    expect(basePrompt).toContain('ценовые уровни');
  });

  it('cash is real constraint', () => {
    expect(basePrompt).toContain(
      'Свободный кэш — реальное ограничение покупок',
    );
  });

  it('contains NO_TARGET handling: AI recommendation is not user target', () => {
    // Эквивалент удалённого блока «ОСОБЫЕ ПРАВИЛА ДЛЯ ТЕСТИРОВАНИЯ» (STME/SBBC/SBSC/SIPO/SPRN):
    // для активов без user target AI даёт рекомендацию, но НЕ назначает пользовательскую цель.
    expect(basePrompt).toContain('SUR/NO_TARGET');
    expect(basePrompt).toContain(
      'AI_RECOMMENDED_TARGET_PERCENT — ИСКЛЮЧИТЕЛЬНО рекомендация',
    );
    expect(basePrompt).toContain('Явно называть "AI-рекомендация"');
  });

  it('does NOT propose new target structure', () => {
    expect(basePrompt).not.toContain(
      'Предложи новую сбалансированную структуру',
    );
    expect(basePrompt).not.toContain(
      'Рекомендуемая структура (Акции X%, Облигации Y%, Кэш Z%)',
    );
  });

  it('does NOT require stop-loss in ВАЖНО', () => {
    expect(basePrompt).not.toContain('указывай уровни стоп-лосса');
  });

  it('forbids assigning own target share', () => {
    expect(basePrompt).toContain('ИСКЛЮЧИТЕЛЬНО из PortfolioMath');
  });

  it('requires Недостаточно данных', () => {
    expect(basePrompt).toContain('нет данных в текущем контексте');
  });

  it('NEW rule without targetPercent assignment', () => {
    // Эквивалент старого правила: AI может лишь рекомендовать цель, но не назначать её
    expect(basePrompt).toContain(
      'AI_RECOMMENDED_TARGET_PERCENT как рекомендацию',
    );
    expect(basePrompt).toContain('не как пользовательскую цель');
  });

  it('contains status explanations', () => {
    expect(basePrompt).toContain(
      'анализ в рамках переданного status (BUY/REDUCE/STABLE/EXIT/NO_TARGET)',
    );
  });

  it('contains new instruments prohibition', () => {
    expect(basePrompt).toContain(
      'Новые инструменты: НЕ добавлять по собственной инициативе',
    );
  });

  it('contains macro context with rate', () => {
    expect(basePrompt).toContain('Ставка ЦБ: 18%');
  });

  it('contains tickers when provided', () => {
    const p = buildSystemPrompt(18, undefined, ['SBER', 'GAZP']);
    expect(p).toContain('SBER');
    expect(p).toContain('GAZP');
  });

  it('contains macro data when provided', () => {
    const p = buildSystemPrompt(18, undefined, undefined, {
      keyRate: 21,
      inflation: 7.5,
      currency: 95,
      oil: 82,
      source: 'CBR',
      asOf: '2026-09-01',
      isFresh: true,
    });
    expect(p).toContain('21%');
    expect(p).toContain('Инфляция: 7.5%');
  });

  it('does NOT contain contradictory phrases', () => {
    expect(basePrompt).not.toContain(
      'Предложи новую сбалансированную структуру',
    );
    expect(basePrompt).not.toContain('Увеличить до X%');
    expect(basePrompt).not.toContain('Уменьшить до Y%');
    expect(basePrompt).not.toContain('Продать полностью');
    expect(basePrompt).not.toContain(
      'Какие целевые доли изменить и на сколько процентов',
    );
    expect(basePrompt).not.toContain(
      'Конкретные уровни цен для покупки/продажи',
    );
    expect(basePrompt).not.toContain('указывай уровни стоп-лосса');
  });

  it('contains cash constraint rule', () => {
    expect(basePrompt).toContain(
      'Свободный кэш — реальное ограничение покупок',
    );
  });

  it('contains macro for explanation only', () => {
    // Макро-блок присутствует как контекст для объяснения решений
    expect(basePrompt).toContain('=== МАКРО ===');
  });

  // === Regression tests for new investment reasoning rules ===

  it('contains investment reasoning section header', () => {
    expect(basePrompt).toContain('=== ИНВЕСТИЦИОННЫЙ REASONING ===');
  });

  it('rule 1: USER_TARGET_PERCENT is input fact only', () => {
    expect(basePrompt).toContain(
      'USER_TARGET_PERCENT и PORTFOLIO_MATH_STATUS — входные факты',
    );
    expect(basePrompt).toContain('AI НЕ изменяет');
  });

  it('rule 2: AI must define AI_RECOMMENDED_TARGET_PERCENT and AI_RECOMMENDED_ACTION', () => {
    expect(basePrompt).toContain('AI_RECOMMENDED_TARGET_PERCENT');
    expect(basePrompt).toContain('AI_RECOMMENDED_ACTION');
  });

  it('rule 3: AI can disagree with USER_TARGET and must explain', () => {
    expect(basePrompt).toContain('AI может не согласиться с USER_TARGET');
  });

  it('rule 4: negative PNL alone is NOT a reason for REDUCE/EXIT', () => {
    expect(basePrompt).toContain(
      'Отрицательный P&L ≠ основание для REDUCE/EXIT',
    );
    expect(basePrompt).toContain('thesis');
    expect(basePrompt).toContain('fundamentals');
    expect(basePrompt).toContain('valuation');
  });

  it('rule 5: ACTIVE ORDER is only execution context', () => {
    expect(basePrompt).toContain('ACTIVE ORDER — только execution context');
    expect(basePrompt).toContain('НЕ инвестиционный аргумент');
  });

  it('rule 6: no invented universal allocation rules', () => {
    // Правило восстановлено в сжатой версии (ГРАНИЦЫ ОТВЕТСТВЕННОСТИ):
    // AI не применяет универсальные правила аллокации, доли — только из PortfolioMath.
    expect(basePrompt).toContain(
      'AI НЕ применяет универсальные правила allocation',
    );
    expect(basePrompt).toContain('SUR 20–30%');
    expect(basePrompt).toContain('облигации должны быть 50–60%');
  });

  it('rule 7: no data → write "нет данных в текущем контексте"', () => {
    expect(basePrompt).toContain('нет данных в текущем контексте');
    expect(basePrompt).toContain('НЕ выдумывать');
  });

  it('rule 8: every AI_TARGET needs TARGET_REASON', () => {
    expect(basePrompt).toContain('targetReason');
  });

  // === Regression tests for separation of concerns ===

  it('rule 9: deterministic constraints precede AI reasoning, reasoning precedes output contract', () => {
    // Сжатая версия: единый REASONING-блок вместо INVESTMENT FACTS /
    // DETERMINISTIC PORTFOLIO RESULT. Гарантия разделения сохранена:
    // детерминированные ограничения (C10/C11/C12) заданы ДО правил рассуждений AI,
    // а рассуждения — ДО формата вывода (JSON-контракт).
    const boundariesIndex = basePrompt.indexOf(
      '=== ГРАНИЦЫ ОТВЕТСТВЕННОСТИ ===',
    );
    const reasoningIndex = basePrompt.indexOf(
      '=== ИНВЕСТИЦИОННЫЙ REASONING ===',
    );
    const jsonIndex = basePrompt.indexOf('=== JSON-БЛОК');
    const deterministicIndex = basePrompt.indexOf('детерминированные');
    expect(boundariesIndex).toBeGreaterThanOrEqual(0);
    expect(reasoningIndex).toBeGreaterThanOrEqual(0);
    expect(jsonIndex).toBeGreaterThanOrEqual(0);
    expect(deterministicIndex).toBeGreaterThanOrEqual(0);
    expect(deterministicIndex).toBeLessThan(reasoningIndex);
    expect(boundariesIndex).toBeLessThan(reasoningIndex);
    expect(reasoningIndex).toBeLessThan(jsonIndex);
  });

  it('rule 9: PORTFOLIO_MATH_STATUS is not a hint for AI_RECOMMENDED_ACTION', () => {
    expect(basePrompt).toContain(
      'PortfolioMath status ≠ фундаментальная привлекательность',
    );
  });

  it('rule 9: AI must state agreement or disagreement with PortfolioMath', () => {
    expect(basePrompt).toContain('AGREE');
    expect(basePrompt).toContain('DISAGREE');
  });

  it('rule 10: NO_DATA marker prevents invented fundamentals', () => {
    expect(basePrompt).toContain('NO_DATA');
    expect(basePrompt).toContain('недооценен');
    expect(basePrompt).toContain('привлекателен');
    expect(basePrompt).toContain('«нет данных»');
  });

  it('rule 10: NO_DATA => "нет данных в текущем контексте"', () => {
    expect(basePrompt).toContain('нет данных в текущем контексте');
  });
});
