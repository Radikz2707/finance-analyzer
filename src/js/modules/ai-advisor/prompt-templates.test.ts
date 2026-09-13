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
});
