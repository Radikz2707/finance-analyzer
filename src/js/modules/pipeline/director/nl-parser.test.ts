import { parseUserMessage, quickCategory, hasTicker } from './nl-parser.js';

describe('NL Parser (Director)', () => {
  it('определяет вопрос по активу и извлекает тикер', () => {
    const parsed = parseUserMessage('Что делать с PLZL?');
    expect(parsed.category).toBe('asset');
    expect(parsed.tickers).toContain('PLZL');
    expect(parsed.intent).toBe('decide-action');
    expect(parsed.complexity).toBeGreaterThanOrEqual(1);
  });

  it('определяет вопрос по портфелю', () => {
    const parsed = parseUserMessage('Что происходит с моим портфелем?');
    expect(parsed.category).toBe('portfolio');
    expect(parsed.requiredAgents).toContain('analysis');
    expect(parsed.requiredAgents).toContain('ai');
  });

  it('определяет вопрос-сравнение', () => {
    const parsed = parseUserMessage('Сравни: держать PLZL или сократить его');
    expect(parsed.category).toBe('comparison');
    expect(parsed.requiredAgents).toContain('scenario');
  });

  it('определяет сценарный вопрос', () => {
    const parsed = parseUserMessage('А если рынок упадёт на 10%?');
    expect(parsed.category).toBe('scenario');
    expect(parsed.intent).toBe('explore-scenario');
  });

  it('определяет вопрос о качестве системы', () => {
    const parsed = parseUserMessage('Насколько хорошо работает ResearchAgent?');
    expect(parsed.category).toBe('system-quality');
    expect(parsed.requiredAgents).toContain('review');
  });

  it('обрабатывает пустой ввод как общий вопрос', () => {
    const parsed = parseUserMessage('');
    expect(parsed.category).toBe('general');
    expect(parsed.requiredAgents).toEqual([]);
  });

  it('quickCategory и hasTicker работают быстро', () => {
    expect(quickCategory('Что делать с PLZL?')).toBe('asset');
    expect(hasTicker('Что делать с PLZL?')).toBe(true);
    expect(hasTicker('Что делать с Полюсом?')).toBe(false);
  });

  it('несколько тикеров привлекают research для фактов', () => {
    const parsed = parseUserMessage('Сравни PLZL и SBER');
    expect(parsed.tickers.length).toBeGreaterThanOrEqual(2);
    expect(parsed.requiredAgents).toContain('research');
  });
});
