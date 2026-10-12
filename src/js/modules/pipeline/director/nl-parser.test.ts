import {
  extractCorrection,
  looksLikeCorrection,
  looksLikeGreeting,
  looksLikeOffTopic,
  looksLikeReportRequest,
  looksLikeStatusQuestion,
  looksLikeTaskIntent,
  parseUserMessage,
  quickCategory,
  hasTicker,
} from './nl-parser.js';

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
  it('«git commit и push» включает terminal', () => {
    const parsed = parseUserMessage('git commit и push');
    expect(parsed.requiredAgents).toContain('terminal');
  });

  it('«Запусти тесты» включает terminal', () => {
    const parsed = parseUserMessage('Запусти тесты');
    expect(parsed.requiredAgents).toContain('terminal');
  });
});

describe('NL Parser (Director): операции с зависимостями (package)', () => {
  it('«npm install axios» включает package вместо terminal', () => {
    const parsed = parseUserMessage('npm install axios');
    expect(parsed.requiredAgents).toContain('package');
    expect(parsed.requiredAgents).not.toContain('terminal');
  });

  it('«установи пакет axios» включает package вместо terminal', () => {
    const parsed = parseUserMessage('установи пакет axios');
    expect(parsed.requiredAgents).toContain('package');
    expect(parsed.requiredAgents).not.toContain('terminal');
  });

  it('«обнови зависимости» включает package', () => {
    const parsed = parseUserMessage('обнови зависимости');
    expect(parsed.requiredAgents).toEqual(['package']);
  });

  it('«проверь конфликты зависимостей» включает package', () => {
    const parsed = parseUserMessage('проверь конфликты зависимостей');
    expect(parsed.requiredAgents).toEqual(['package']);
  });

  it('«удали пакет lodash» включает package', () => {
    const parsed = parseUserMessage('удали пакет lodash');
    expect(parsed.requiredAgents).toEqual(['package']);
  });

  it('«удали блок old-block» остаётся терминальной (gulp-конструктор)', () => {
    const parsed = parseUserMessage('удали блок old-block');
    expect(parsed.requiredAgents).toEqual(['terminal']);
  });
});

describe('NL Parser (Director): системные ресурсы (system)', () => {
  it('«какая загрузка CPU» включает system', () => {
    const parsed = parseUserMessage('какая загрузка CPU?');
    expect(parsed.requiredAgents).toEqual(['system']);
  });

  it('«сколько памяти на компьютере» включает system', () => {
    const parsed = parseUserMessage('сколько памяти на компьютере');
    expect(parsed.requiredAgents).toEqual(['system']);
  });

  it('«состояние системы» включает system', () => {
    const parsed = parseUserMessage('состояние системы');
    expect(parsed.requiredAgents).toEqual(['system']);
  });

  it('финансовый вопрос про состояние портфеля не включает system', () => {
    const parsed = parseUserMessage('Как дела с портфелем?');
    expect(parsed.requiredAgents).not.toContain('system');
  });
});

describe('NL Parser (Director): резервная копия/восстановление памяти', () => {
  it('«сделай бэкап памяти» включает terminal', () => {
    const parsed = parseUserMessage('сделай бэкап памяти');
    expect(parsed.requiredAgents).toEqual(['terminal']);
  });

  it('«сделай резервную копию данных» включает terminal', () => {
    const parsed = parseUserMessage('сделай резервную копию данных');
    expect(parsed.requiredAgents).toEqual(['terminal']);
  });

  it('«восстанови память из копии» включает terminal', () => {
    const parsed = parseUserMessage('восстанови память из копии');
    expect(parsed.requiredAgents).toEqual(['terminal']);
  });

  it('«восстанови файл src/test.ts» не маршрутизируется как restore', () => {
    const parsed = parseUserMessage('восстанови файл src/test.ts');
    expect(parsed.requiredAgents).toContain('file');
    expect(parsed.requiredAgents).not.toContain('terminal');
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

describe('NL Parser (Director): приветствия', () => {
  it('«Привет» распознаётся как приветствие', () => {
    expect(looksLikeGreeting('Привет')).toBe(true);
  });

  it('«Здравствуйте! Как дела?» распознаётся', () => {
    expect(looksLikeGreeting('Здравствуйте! Как дела?')).toBe(true);
  });

  it('пустое сообщение — не приветствие', () => {
    expect(looksLikeGreeting('')).toBe(false);
  });

  it('длинный вопрос с «привет» в начале — не приветствие', () => {
    const long =
      'Привет! Расскажи подробно про мою стратегию, риски и что стоит сократить';
    expect(looksLikeGreeting(long)).toBe(false);
  });

  it('содержательный финансовый вопрос не считается приветствием', () => {
    expect(looksLikeGreeting('Что делать с SBER?')).toBe(false);
  });

  it('«Как дела?» распознаётся как вопрос о статусе (fast-path без LLM)', () => {
    expect(looksLikeStatusQuestion('Как дела?')).toBe(true);
    expect(looksLikeStatusQuestion('что нового')).toBe(true);
    expect(looksLikeStatusQuestion('Как ты там?')).toBe(true);
    expect(looksLikeStatusQuestion('Что происходит с портфелем?')).toBe(true);
  });

  it('содержательный вопрос не считается вопросом о статусе', () => {
    expect(looksLikeStatusQuestion('Что делать с SBER?')).toBe(false);
    expect(looksLikeStatusQuestion('Проанализируй стратегию')).toBe(false);
  });

  it('реплики-задачи/идеи распознаются как task-intent', () => {
    expect(looksLikeTaskIntent('Задача: покрыть модуль тестами')).toBe(true);
    expect(looksLikeTaskIntent('Идея: экспорт дашборда в PDF')).toBe(true);
    expect(looksLikeTaskIntent('Давай добавим экспорт в Excel')).toBe(true);
    expect(
      looksLikeTaskIntent('Хочу, чтобы уведомления приходили в Telegram'),
    ).toBe(true);
    expect(looksLikeTaskIntent('Нужно реализовать фильтр по секторам')).toBe(
      true,
    );
    expect(looksLikeTaskIntent('Запланируй рефакторинг модуля')).toBe(true);
  });

  it('бытовые/финансовые вопросы не считаются task-intent', () => {
    expect(looksLikeTaskIntent('Как дела?')).toBe(false);
    expect(looksLikeTaskIntent('Что делать с SBER?')).toBe(false);
    expect(looksLikeTaskIntent('привет')).toBe(false);
    expect(looksLikeTaskIntent('')).toBe(false);
  });

  it('оффтопик-вопросы (погода, спорт) распознаются и НЕ идут в агенты', () => {
    expect(looksLikeOffTopic('Какая завтра погода в Домодедово?')).toBe(true);
    expect(looksLikeOffTopic('о погоде можно поговорить?')).toBe(true);
    expect(looksLikeOffTopic('Кто выиграл вчерашний матч?')).toBe(true);
    expect(looksLikeOffTopic('Дай рецепт борща')).toBe(true);
    expect(looksLikeOffTopic('Какой фильм посмотреть?')).toBe(true);
  });

  it('финансовые вопросы НЕ считаются оффтопиком', () => {
    expect(looksLikeOffTopic('Что делать с PLZL?')).toBe(false);
    expect(looksLikeOffTopic('Как выглядит портфель?')).toBe(false);
    expect(looksLikeOffTopic('Есть ли риски?')).toBe(false);
    expect(looksLikeOffTopic('Стратегия на год')).toBe(false);
  });

  it('«а если» классифицируется как сценарный вопрос (ScenarioAgent)', () => {
    const parsed = parseUserMessage(
      'а если я сокращу PLZL за счет увеличения доли других активов, что тогда?',
    );
    expect(parsed.category).toBe('scenario');
    expect(parsed.requiredAgents).toContain('scenario');
  });

  it('запрос отчёта/анализа распознаётся', () => {
    expect(
      looksLikeReportRequest('ты же видишь сейчас мой отчет по портфелю?'),
    ).toBe(true);
    expect(looksLikeReportRequest('Проанализируй отчёт ещё раз')).toBe(true);
    expect(looksLikeReportRequest('Что во вкладке Анализ?')).toBe(true);
    expect(looksLikeReportRequest('Покажи отчёт по портфелю')).toBe(true);
  });

  it('финансовые вопросы не считаются запросом отчёта', () => {
    expect(looksLikeReportRequest('Что делать с SBER?')).toBe(false);
    expect(looksLikeReportRequest('Как дела?')).toBe(false);
  });

  it('поправки пользователя распознаются и извлекаются', () => {
    expect(
      looksLikeCorrection(
        'С чего ты взял, что 35,4%? Его доля всего почти 19%',
      ),
    ).toBe(true);
    expect(looksLikeCorrection('доля PLZL 19%')).toBe(true);
    expect(looksLikeCorrection('не 35,4%')).toBe(true);
    expect(looksLikeCorrection('35,4% неверно')).toBe(true);
    expect(looksLikeCorrection('на самом деле 19%')).toBe(true);
  });

  it('extractCorrection извлекает тикер и процент', () => {
    const correction = extractCorrection('доля PLZL 19%');
    expect(correction).not.toBeNull();
    expect(correction!.ticker).toBe('PLZL');
    expect(correction!.currentPercent).toBeCloseTo(19, 5);

    const noTicker = extractCorrection('не 35,4%');
    expect(noTicker).not.toBeNull();
    expect(noTicker!.ticker).toBeNull();
    expect(noTicker!.currentPercent).toBeCloseTo(35.4, 5);
  });

  it('extractCorrection возвращает null для не-поправок', () => {
    expect(extractCorrection('Что делать с PLZL?')).toBeNull();
    expect(extractCorrection('Как дела?')).toBeNull();
  });
});
