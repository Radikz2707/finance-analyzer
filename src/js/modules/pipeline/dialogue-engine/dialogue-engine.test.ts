import {
  DialogueEngine,
  IntentClassifier,
  ContextTracker,
  fallbackClassify,
  detectEmotion,
} from './index.js';
import type { LlmChatLike } from './types.js';
import type { DirectorFactsContext } from '../director/director-types.js';

/** Мок LLM-клиента с заданным ответом */
function llmMock(respond: (messages: unknown[]) => string): LlmChatLike {
  return {
    async chat(messages) {
      return respond(messages);
    },
  };
}

/** Простой мок LLM: возвращает JSON-классификацию */
function jsonLlm(intent: string, confidence = 0.9): LlmChatLike {
  return llmMock(() =>
    JSON.stringify({
      intent,
      emotion: 'neutral',
      tickers: [],
      confidence,
      actionKind: null,
      summary: 'тест',
    }),
  );
}

/** Пустой контекст для тестов */
function emptyCtx(): ReturnType<ContextTracker['getContext']> {
  return new ContextTracker().getContext();
}

/** Факты портфеля для smalltalk-тестов */
function facts(): DirectorFactsContext {
  return {
    assetsAnalysis: [
      {
        ticker: 'SBER',
        name: 'Сбербанк',
        currentPercent: 30,
        targetPercent: 25,
        deficitRub: 0,
        status: 'STABLE',
        unrealizedProfitRub: 5000,
      },
      {
        ticker: 'GAZP',
        name: 'Газпром',
        currentPercent: 10,
        targetPercent: 15,
        deficitRub: 2000,
        status: 'STABLE',
        unrealizedProfitRub: -1000,
      },
    ],
    totalPortfolioValue: 1_000_000,
    freeCashRub: 50_000,
  };
}

describe('DialogueEngine (fallback-классификация)', () => {
  it('распознаёт приветствие', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Привет!',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('greeting');
    expect(analysis.needsAgents).toBe(false);
  });

  it('распознаёт прощание', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Пока, до встречи!',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('farewell');
  });

  it('распознаёт вопрос о статусе («как дела») без запуска агентов', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Как дела?',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('status');
    expect(analysis.needsAgents).toBe(false);
  });

  it('НЕ классифицирует «что происходит с портфелем» как статус', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Что происходит с моим портфелем?',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('portfolio');
    expect(analysis.needsAgents).toBe(true);
  });

  it('распознаёт оффтопик (погода)', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Какая завтра погода?',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('off-topic');
    expect(analysis.needsAgents).toBe(false);
  });

  it('распознаёт запрос возможностей («что ты умеешь») как smalltalk', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Что ты умеешь?',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('smalltalk');
    expect(analysis.needsAgents).toBe(false);
  });

  it('распознаёт поправку к данным портфеля', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Доля PLZL 19%',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('correction');
    expect(analysis.tickers).toContain('PLZL');
  });

  it('распознаёт запрос отчёта', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Покажи отчёт по портфелю',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('report');
  });

  it('распознаёт задачу/идею (цель автономного цикла)', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Давай добавим экспорт отчёта в PDF',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('task');
    expect(analysis.needsAgents).toBe(false);
  });

  it('распознаёт файловую операцию', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Создай файл src/test.ts',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('action');
    expect(analysis.actionKind).toBe('file');
    expect(analysis.needsAgents).toBe(true);
  });

  it('распознаёт терминальную операцию', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Запусти тесты',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('action');
    expect(analysis.actionKind).toBe('terminal');
  });

  it('распознаёт задачу разработки кода', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Реализуй функционал в src/js/modules/x/y.ts',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('action');
    expect(analysis.actionKind).toBe('code');
  });

  it('распознаёт вопрос по активу с тикером', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Что с SBER?',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('asset');
    expect(analysis.tickers).toContain('SBER');
    expect(analysis.needsAgents).toBe(true);
  });

  it('распознаёт сценарий', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'А если рынок упадёт на 10%?',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('scenario');
  });

  it('обрабатывает пустой ввод как unknown', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({ text: '', context: emptyCtx() });
    expect(analysis.intent).toBe('unknown');
  });
});

describe('ContextTracker (follow-up и контекст)', () => {
  it('запоминает тикеры и применяет их к follow-up', async () => {
    const tracker = new ContextTracker();
    const engine = new DialogueEngine({ trackerInstance: tracker });

    await engine.analyze({
      text: 'Что с PLZL?',
      context: tracker.getContext(),
    });
    expect(tracker.getContext().lastTickers).toContain('PLZL');

    // Follow-up без тикера
    const followUp = await engine.analyze({
      text: 'А если сократить его?',
      context: tracker.getContext(),
    });
    expect(followUp.isFollowUp).toBe(true);
    expect(tracker.getContext().lastTickers).toContain('PLZL');
  });

  it('не считает follow-up реплику с тикером', () => {
    const tracker = new ContextTracker();
    tracker.update(
      { ...fallbackClassify('Что с PLZL?', emptyCtx()), tickers: ['PLZL'] },
      'Что с PLZL?',
    );
    expect(tracker.isFollowUp('А что с SBER?', ['SBER'])).toBe(false);
  });

  it('хранит хвост истории с ограничением', () => {
    const tracker = new ContextTracker();
    for (let i = 0; i < 20; i++) {
      tracker.update(
        { ...fallbackClassify(`Вопрос ${i}`, emptyCtx()), tickers: [] },
        `Вопрос ${i}`,
      );
    }
    expect(tracker.getContext().historyTail.length).toBeLessThanOrEqual(12);
    expect(tracker.getContext().historyTail[0]?.text).toBe('Вопрос 8');
  });
});

describe('EmotionDetector', () => {
  it('определяет тревогу', () => {
    expect(detectEmotion('Боюсь, что портфель падает')).toBe('concerned');
  });
  it('определяет позитив', () => {
    expect(detectEmotion('Спасибо, отличная работа!')).toBe('positive');
  });
  it('определяет срочность', () => {
    expect(detectEmotion('Срочно продай всё!')).toBe('urgent');
  });
  it('определяет нейтральность', () => {
    expect(detectEmotion('Что с SBER?')).toBe('neutral');
  });
});

describe('DialogueEngine (smalltalk-ответы)', () => {
  it('даёт живое приветствие с фактами портфеля', async () => {
    const engine = new DialogueEngine({ userName: 'Радик' });
    const analysis = await engine.analyze({
      text: 'Привет',
      context: emptyCtx(),
    });
    const reply = engine.buildSmallTalk(analysis, facts());
    expect(reply).toContain('Добрый');
    expect(reply).toMatch(/1\s*000\s*000/);
  });

  it('даёт ответ на прощание', async () => {
    const engine = new DialogueEngine({ userName: 'Радик' });
    const analysis = await engine.analyze({
      text: 'Пока',
      context: emptyCtx(),
    });
    const reply = engine.buildSmallTalk(analysis, facts());
    expect(reply).toContain('До встречи');
  });

  it('возвращает null для интентов с агентами', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Что с SBER?',
      context: emptyCtx(),
    });
    expect(engine.buildSmallTalk(analysis, facts())).toBeNull();
  });

  it('статус содержит лидера и аутсайдера', async () => {
    const engine = new DialogueEngine();
    const analysis = await engine.analyze({
      text: 'Как дела?',
      context: emptyCtx(),
    });
    const reply = engine.buildSmallTalk(analysis, facts());
    expect(reply).toContain('SBER');
  });
});

describe('DialogueEngine (LLM-классификация)', () => {
  it('использует LLM-результат при высокой уверенности', async () => {
    const engine = new DialogueEngine({
      classifier: { llm: jsonLlm('scenario', 0.95) },
    });
    const analysis = await engine.analyze({
      text: 'Если я продам половину Газпрома, что будет?',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('scenario');
    expect(analysis.source).toBe('llm');
  });

  it('использует LLM-результат для нестандартной формулировки', async () => {
    const engine = new DialogueEngine({
      classifier: { llm: jsonLlm('comparison', 0.92) },
    });
    const analysis = await engine.analyze({
      text: 'Стоит ли перекладываться из Сбера в Татнефть?',
      context: emptyCtx(),
    });
    expect(analysis.intent).toBe('comparison');
  });

  it('падает на fallback при низкой уверенности LLM', async () => {
    const engine = new DialogueEngine({
      classifier: { llm: jsonLlm('scenario', 0.3) },
    });
    const analysis = await engine.analyze({
      text: 'Что с SBER?',
      context: emptyCtx(),
    });
    expect(analysis.source).toBe('fallback');
    expect(analysis.intent).toBe('asset');
  });

  it('падает на fallback при падении LLM', async () => {
    const failingLlm: LlmChatLike = {
      async chat() {
        throw new Error('Ollama offline');
      },
    };
    const engine = new DialogueEngine({ classifier: { llm: failingLlm } });
    const analysis = await engine.analyze({
      text: 'Что с SBER?',
      context: emptyCtx(),
    });
    expect(analysis.source).toBe('fallback');
    expect(analysis.intent).toBe('asset');
  });

  it('падает на fallback при невалидном JSON LLM', async () => {
    const badLlm = llmMock(() => 'это не json');
    const engine = new DialogueEngine({ classifier: { llm: badLlm } });
    const analysis = await engine.analyze({
      text: 'Как дела?',
      context: emptyCtx(),
    });
    expect(analysis.source).toBe('fallback');
    expect(analysis.intent).toBe('status');
  });

  it('падает на fallback при неизвестном интенте LLM', async () => {
    const engine = new DialogueEngine({
      classifier: { llm: jsonLlm('not-a-real-intent', 0.99) },
    });
    const analysis = await engine.analyze({
      text: 'Что с SBER?',
      context: emptyCtx(),
    });
    expect(analysis.source).toBe('fallback');
  });
});

describe('IntentClassifier (прямые проверки)', () => {
  it('возвращает fallback без LLM', async () => {
    const classifier = new IntentClassifier();
    expect(classifier.hasLlm()).toBe(false);
    const analysis = await classifier.classify('Что с GAZP?', emptyCtx());
    expect(analysis.tickers).toContain('GAZP');
  });

  it('интенты без агентов помечаются needsAgents=false', async () => {
    const engine = new DialogueEngine();
    const greeting = await engine.analyze({
      text: 'Здравствуйте!',
      context: emptyCtx(),
    });
    expect(greeting.needsAgents).toBe(false);
    const offTopic = await engine.analyze({
      text: 'Какой фильм посмотреть?',
      context: emptyCtx(),
    });
    expect(offTopic.intent).toBe('off-topic');
    expect(offTopic.needsAgents).toBe(false);
  });

  it('category совместима с delegation-planner', async () => {
    const analysis = fallbackClassify('Что с PLZL?', emptyCtx());
    expect(analysis.category).toBe('asset');
    expect(analysis.directorIntent).toBe('understand');
  });
});
