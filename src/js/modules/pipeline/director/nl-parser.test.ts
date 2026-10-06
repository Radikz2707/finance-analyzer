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
    // Теперь русские названия тоже распознаются
    expect(hasTicker('Что делать с Полюсом?')).toBe(true);
    expect(hasTicker('Что с сбером?')).toBe(true);
    expect(hasTicker('Как дела?')).toBe(false);
  });

  it('несколько тикеров привлекают research для фактов', () => {
    const parsed = parseUserMessage('Сравни PLZL и SBER');
    expect(parsed.tickers.length).toBeGreaterThanOrEqual(2);
    expect(parsed.requiredAgents).toContain('research');
  });

  it('распознаёт русские названия компаний', () => {
    let parsed = parseUserMessage('Что с Полюсом?');
    expect(parsed.tickers).toContain('PLZL');

    parsed = parseUserMessage('Как Сбер?');
    expect(parsed.tickers).toContain('SBER');

    parsed = parseUserMessage('Что с Лукойлом?');
    expect(parsed.tickers).toContain('LKOH');

    parsed = parseUserMessage('Газпром растет?');
    expect(parsed.tickers).toContain('GAZP');
  });

  it('распознаёт составные названия', () => {
    let parsed = parseUserMessage('Что с Норникелем?');
    expect(parsed.tickers).toContain('GMKN');

    parsed = parseUserMessage('Аэрофлот падает');
    expect(parsed.tickers).toContain('AFLT');
  });
});

describe('NL Parser (Director): файловые операции', () => {
  it('«Создай файл src/test.ts» включает file', () => {
    const parsed = parseUserMessage('Создай файл src/test.ts');
    expect(parsed.requiredAgents).toContain('file');
  });

  it('«Удали файл data/report.json» включает file', () => {
    const parsed = parseUserMessage('Удали файл data/report.json');
    expect(parsed.requiredAgents).toContain('file');
  });

  it('«Прочитай файл package.json» включает file', () => {
    const parsed = parseUserMessage('Прочитай файл package.json');
    expect(parsed.requiredAgents).toContain('file');
  });

  it('чистая файловая операция не тянет analysis/ai', () => {
    const parsed = parseUserMessage('Создай файл src/test.ts');
    expect(parsed.requiredAgents).toEqual(['file']);
  });
});

describe('NL Parser (Director): терминальные операции', () => {
  it('«npm install axios» включает terminal', () => {
    const parsed = parseUserMessage('npm install axios');
    expect(parsed.requiredAgents).toContain('terminal');
  });

  it('«установи пакет axios» включает terminal', () => {
    const parsed = parseUserMessage('установи пакет axios');
    expect(parsed.requiredAgents).toContain('terminal');
  });

  it('«git commit и push» включает terminal', () => {
    const parsed = parseUserMessage('git commit и push');
    expect(parsed.requiredAgents).toContain('terminal');
  });

  it('«Запусти тесты» включает terminal', () => {
    const parsed = parseUserMessage('Запусти тесты');
    expect(parsed.requiredAgents).toContain('terminal');
  });

  it('чистая терминальная операция не тянет analysis/ai', () => {
    const parsed = parseUserMessage('npm install axios');
    expect(parsed.requiredAgents).toEqual(['terminal']);
  });
});

describe('NL Parser (Director): регресс — операции не ломают финансовые вопросы', () => {
  it('«Как дела с портфелем?» не включает file/terminal', () => {
    const parsed = parseUserMessage('Как дела с портфелем?');
    expect(parsed.category).toBe('portfolio');
    expect(parsed.requiredAgents).not.toContain('file');
    expect(parsed.requiredAgents).not.toContain('terminal');
  });

  it('«Что с акциями Сбера?» — прежние роли без file/terminal', () => {
    const parsed = parseUserMessage('Что с акциями Сбера?');
    expect(parsed.requiredAgents).toContain('analysis');
    expect(parsed.requiredAgents).toContain('research');
    expect(parsed.requiredAgents).toContain('ai');
    expect(parsed.requiredAgents).not.toContain('file');
    expect(parsed.requiredAgents).not.toContain('terminal');
  });

  it('финансовый вопрос с упоминанием тикера не тянет операции', () => {
    const parsed = parseUserMessage('Что делать с PLZL?');
    expect(parsed.requiredAgents).toContain('analysis');
    expect(parsed.requiredAgents).not.toContain('file');
    expect(parsed.requiredAgents).not.toContain('terminal');
  });
});
