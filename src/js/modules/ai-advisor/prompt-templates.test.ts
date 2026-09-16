import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './prompt-templates.js';

describe('buildSystemPrompt', () => {
  const basePrompt = buildSystemPrompt(18);

  it('contains G boundaries block', () => {
    expect(basePrompt).toContain('=== ГРАНИЦЫ ОТВЕТСТВЕННОСТИ AI ===');
  });

  it('contains target source block', () => {
    expect(basePrompt).toContain('=== ИСТОЧНИК ЦЕЛЕВЫХ ДОЛЕЙ ===');
  });

  it('forbids creating new targetPercent', () => {
    expect(basePrompt).toContain('AI НЕ создаёт новые targetPercent');
  });

  it('forbids changing BUY/REDUCE/STABLE/EXIT', () => {
    expect(basePrompt).toContain('AI НЕ изменяет BUY / REDUCE / STABLE / EXIT');
  });

  it('targetPercent=0 means EXIT', () => {
    expect(basePrompt).toContain('targetPercent = 0% → EXIT');
  });

  it('missing target means Цель не задана', () => {
    expect(basePrompt).toContain('Цель не задана');
  });

  it('forbids automatic 3% for ETF', () => {
    expect(basePrompt).toContain('не назначает ETF/фондам/новым активам стандартные 3%');
  });

  it('forbids invented stop-loss', () => {
    expect(basePrompt).toContain('stop-loss');
  });

  it('forbids invented price levels', () => {
    expect(basePrompt).toContain('ценовые уровни');
  });

  it('cash is real constraint', () => {
    expect(basePrompt).toContain('Свободный кэш является реальным ограничением покупок');
  });

  it('contains special test rules', () => {
    expect(basePrompt).toContain('ОСОБЫЕ ПРАВИЛА ДЛЯ ТЕСТИРОВАНИЯ');
    expect(basePrompt).toContain('STME targetPercent=0 → EXIT');
    expect(basePrompt).toContain('SBBC/SBSC/SIPO/SPRN без targetPercent');
  });

  it('does NOT propose new target structure', () => {
    expect(basePrompt).not.toContain('Предложи новую сбалансированную структуру');
    expect(basePrompt).not.toContain('Рекомендуемая структура (Акции X%, Облигации Y%, Кэш Z%)');
  });

  it('does NOT require stop-loss in ВАЖНО', () => {
    expect(basePrompt).not.toContain('указывай уровни стоп-лосса');
  });

  it('forbids assigning own target share', () => {
    expect(basePrompt).toContain('AI НЕ имеет права назначать собственную целевую долю');
  });

  it('requires Недостаточно данных', () => {
    expect(basePrompt).toContain('Недостаточно данных');
  });

  it('NEW rule without targetPercent assignment', () => {
    expect(basePrompt).toContain('Если актив указан как NEW');
    expect(basePrompt).toContain('Не назначай ему targetPercent, если targetPercent не задан PortfolioMath');
  });

  it('contains status explanations', () => {
    expect(basePrompt).toContain('status=BUY → объясни необходимость достижения существующей цели');
    expect(basePrompt).toContain('status=REDUCE → объясни снижение к существующей цели');
    expect(basePrompt).toContain('status=STABLE → объясни сохранение около существующей цели');
    expect(basePrompt).toContain('status=EXIT → объясни выход к targetPercent=0%');
  });

  it('contains new instruments prohibition', () => {
    expect(basePrompt).toContain('Не добавляй новые инструменты по собственной инициативе');
    expect(basePrompt).toContain('Новые инструменты: не определены пользователем');
  });

  it('contains macro context with rate', () => {
    expect(basePrompt).toContain('Ключевая ставка ЦБ РФ: 18%');
  });

  it('contains tickers when provided', () => {
    const p = buildSystemPrompt(18, undefined, ['SBER', 'GAZP']);
    expect(p).toContain('SBER');
    expect(p).toContain('GAZP');
  });

  it('contains macro data when provided', () => {
    const p = buildSystemPrompt(18, undefined, undefined, {
      keyRate: 21, inflation: 7.5, currency: 95, oil: 82,
      source: 'CBR', asOf: '2026-09-01', isFresh: true,
    });
    expect(p).toContain('21%');
    expect(p).toContain('Инфляция: 7.5%');
  });

  it('does NOT contain contradictory phrases', () => {
    expect(basePrompt).not.toContain('Предложи новую сбалансированную структуру');
    expect(basePrompt).not.toContain('Увеличить до X%');
    expect(basePrompt).not.toContain('Уменьшить до Y%');
    expect(basePrompt).not.toContain('Продать полностью');
    expect(basePrompt).not.toContain('Какие целевые доли изменить и на сколько процентов');
    expect(basePrompt).not.toContain('Конкретные уровни цен для покупки/продажи');
    expect(basePrompt).not.toContain('указывай уровни стоп-лосса');
  });

  it('contains cash constraint rule', () => {
    expect(basePrompt).toContain('Не считать, что все BUY-дефициты можно выполнить одновременно, если свободного кэша недостаточно');
  });

  it('contains macro for explanation only', () => {
    expect(basePrompt).toContain('Макроэкономические данные и новости используются для ОБЪЯСНЕНИЯ решений PortfolioMath, но не для создания новых targetPercent');
  });

  // === Regression tests for new investment reasoning rules ===

  it('contains investment reasoning section header', () => {
    expect(basePrompt).toContain('=== ИНВЕСТИЦИОННЫЙ REASONING — ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ===');
  });

  it('rule 1: USER_TARGET_PERCENT is input fact only', () => {
    expect(basePrompt).toContain('USER_TARGET_PERCENT и PORTFOLIO_MATH_STATUS — только входные факты');
    expect(basePrompt).toContain('AI НЕ изменяет, НЕ переписывает и НЕ подменяет их своими значениями');
  });

  it('rule 2: AI must define AI_RECOMMENDED_TARGET_PERCENT and AI_RECOMMENDED_ACTION', () => {
    expect(basePrompt).toContain('AI_RECOMMENDED_TARGET_PERCENT');
    expect(basePrompt).toContain('AI_RECOMMENDED_ACTION');
  });

  it('rule 3: AI can disagree with USER_TARGET and must explain', () => {
    expect(basePrompt).toContain('AI может НЕ согласиться с USER_TARGET');
    expect(basePrompt).toContain('почему пользовательская цель не оптимальна');
    expect(basePrompt).toContain('почему выбрана именно AI_RECOMMENDED_TARGET_PERCENT');
  });

  it('rule 4: negative PNL alone is NOT a reason for REDUCE/EXIT', () => {
    expect(basePrompt).toContain('Отрицательный PNL сам по себе НЕ является основанием для REDUCE или EXIT');
    expect(basePrompt).toContain('investment thesis');
    expect(basePrompt).toContain('fundamentals');
    expect(basePrompt).toContain('valuation');
  });

  it('rule 5: ACTIVE ORDER is only execution context', () => {
    expect(basePrompt).toContain('ACTIVE ORDER — только execution context');
    expect(basePrompt).toContain('AI НЕ должен рекомендовать BUY / SELL только потому, что в данных есть active order');
  });

  it('rule 6: no invented universal allocation rules', () => {
    expect(basePrompt).toContain('Запрещены выдуманные универсальные правила allocation');
    expect(basePrompt).toContain('SUR 20–30%');
    expect(basePrompt).toContain('облигации должны быть 50–60%');
  });

  it('rule 7: no data → write "нет данных в текущем контексте"', () => {
    expect(basePrompt).toContain('нет данных в текущем контексте');
    expect(basePrompt).toContain('Запрещено выдумывать');
  });

  it('rule 8: every AI_TARGET needs TARGET_REASON', () => {
    expect(basePrompt).toContain('TARGET_REASON');
    expect(basePrompt).toContain('Для каждого AI_RECOMMENDED_TARGET_PERCENT обязательно дать краткий TARGET_REASON');
  });

  // === Regression tests for separation of concerns ===

  it('rule 9: AI decision block is BEFORE deterministic PortfolioMath', () => {
    const prompt = basePrompt;
    const investmentFactsIndex = prompt.indexOf('INVESTMENT FACTS');
    const portfolioResultIndex = prompt.indexOf('DETERMINISTIC PORTFOLIO RESULT');
    expect(investmentFactsIndex).toBeGreaterThanOrEqual(0);
    expect(portfolioResultIndex).toBeGreaterThanOrEqual(0);
    expect(investmentFactsIndex).toBeLessThan(portfolioResultIndex);
  });

  it('rule 9: PORTFOLIO_MATH_STATUS is not a hint for AI_RECOMMENDED_ACTION', () => {
    expect(basePrompt).toContain('PORTFOLIO_MATH_STATUS НЕ является подсказкой для AI_RECOMMENDED_ACTION');
  });

  it('rule 9: AI must state agreement or disagreement with PortfolioMath', () => {
    expect(basePrompt).toContain('AI согласен с PortfolioMath');
    expect(basePrompt).toContain('AI не согласен');
  });

  it('rule 10: NO_DATA marker prevents invented fundamentals', () => {
    expect(basePrompt).toContain('NO_DATA');
    expect(basePrompt).toContain('недооценен');
    expect(basePrompt).toContain('высокая дивидендная доходность');
    expect(basePrompt).toContain('высокая купонная доходность');
    expect(basePrompt).toContain('привлекателен');
  });

  it('rule 10: NO_DATA => "нет данных в текущем контексте"', () => {
    expect(basePrompt).toContain('нет данных в текущем контексте');
  });
});
