import { buildSystemPrompt } from './prompt-templates.js';

describe('buildSystemPrompt', () => {
  const basePrompt = buildSystemPrompt(18);

  it('contains ROLE block', () => {
    expect(basePrompt).toContain('=== РОЛЬ ===');
    expect(basePrompt).toContain('инвестиционный стратег');
  });

  it('contains MAIN RULES block', () => {
    expect(basePrompt).toContain('=== ГЛАВНЫЕ ПРАВИЛА ===');
  });

  it('contains INVESTMENT REASONING block', () => {
    expect(basePrompt).toContain('=== ИНВЕСТИЦИОННЫЙ REASONING ===');
  });

  it('contains JSON-BLOCK format', () => {
    expect(basePrompt).toContain('=== JSON-БЛОК');
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

  // === Core investment freedom rules ===

  it('rule 1: USER_TARGET_PERCENT is input fact only', () => {
    expect(basePrompt).toContain('Целевые доли (targetPercent) — факт пользователя');
    expect(basePrompt).toContain('AI НЕ изменяет этот факт');
  });

  it('rule 2: AI can define AI_RECOMMENDED_TARGET_PERCENT and AI_RECOMMENDED_ACTION', () => {
    expect(basePrompt).toContain('AI_RECOMMENDED_TARGET_PERCENT');
    expect(basePrompt).toContain('AI самостоятельно определяет');
  });

  it('rule 3: AI can disagree with PortfolioMath and USER_TARGET', () => {
    expect(basePrompt).toContain('AI может НЕ соглашаться с PortfolioMath и USER_TARGET');
  });

  it('rule 4: deep loss does NOT block SELL/EXIT/REDUCE', () => {
    expect(basePrompt).toContain('Глубокий убыток НЕ блокирует SELL/EXIT/REDUCE');
    expect(basePrompt).toContain('AI самостоятельно решает');
  });

  it('rule 5: EXIT, AVERAGE are valid AI actions', () => {
    expect(basePrompt).toContain('EXIT');
    expect(basePrompt).toContain('AVERAGE');
    expect(basePrompt).toContain('BUY');
    expect(basePrompt).toContain('SELL');
    expect(basePrompt).toContain('HOLD');
    expect(basePrompt).toContain('REDUCE');
    expect(basePrompt).toContain('AVOID');
  });

  it('rule 6: AI can propose own target different from USER_TARGET', () => {
    expect(basePrompt).toContain('AI может предложить свою целевую долю');
    expect(basePrompt).toContain('отличающуюся от USER_TARGET');
  });

  it('rule 7: AI must not invent missing data', () => {
    expect(basePrompt).toContain('ЗАПРЕЩЕНО: выдумывать отсутствующие данные');
  });

  it('rule 8: targetReason required for AI recommendations', () => {
    expect(basePrompt).toContain('targetReason');
  });

  // === Separation of concerns ===

  it('rule 9: deterministic constraints precede AI reasoning, reasoning precedes output contract', () => {
    const rulesIndex = basePrompt.indexOf('=== ГЛАВНЫЕ ПРАВИЛА ===');
    const reasoningIndex = basePrompt.indexOf('=== ИНВЕСТИЦИОННЫЙ REASONING ===');
    const jsonIndex = basePrompt.indexOf('=== JSON-БЛОК');
    expect(rulesIndex).toBeGreaterThanOrEqual(0);
    expect(reasoningIndex).toBeGreaterThanOrEqual(0);
    expect(jsonIndex).toBeGreaterThanOrEqual(0);
    expect(rulesIndex).toBeLessThan(reasoningIndex);
    expect(reasoningIndex).toBeLessThan(jsonIndex);
  });

  it('rule 9: PortfolioMath status is not a hint for AI_RECOMMENDED_ACTION', () => {
    expect(basePrompt).toContain('PortfolioMath status — результат детерминированной математики');
    expect(basePrompt).toContain('AI может НЕ соглашаться с PortfolioMath');
  });

  it('rule 9: AI must state agreement or disagreement with PortfolioMath', () => {
    expect(basePrompt).toContain('AGREE');
    expect(basePrompt).toContain('DISAGREE');
  });

  it('rule 10: NO_DATA marker prevents invented fundamentals', () => {
    expect(basePrompt).toContain('NO_DATA');
    expect(basePrompt).toContain('«нет данных»');
    expect(basePrompt).toContain('НЕ писать "недооценен"');
  });

  it('rule 10: AI shows uncertainty when data is missing', () => {
    expect(basePrompt).toContain('При конфликте данных AI показывает источник/характер неопределённости');
  });

  // === Prohibitions ===

  it('forbids guaranteed returns', () => {
    expect(basePrompt).toContain('ЗАПРЕЩЕНО: "гарантированная доходность"');
  });

  it('forbids risk-free claims', () => {
    expect(basePrompt).toContain('безрисковый');
  });

  it('does NOT propose new target structure', () => {
    expect(basePrompt).not.toContain('Предложи новую сбалансированную структуру');
  });

  it('does NOT require stop-loss', () => {
    expect(basePrompt).not.toContain('указывай уровни стоп-лосса');
  });
});
