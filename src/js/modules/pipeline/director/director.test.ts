import { DirectorAgent } from './director.js';
import { ActivityStream } from '../agent-activity/activity-stream.js';
import {
  DirectorAgentFacade,
  type AiDecisionExecutor,
} from './agent-facade.js';
import { TaskExtractor } from '../task-extractor/task-extractor.js';
import type { LlmChatLike } from '../task-extractor/types.js';
import {
  createInMemoryMemoryAdapter,
  DirectorMemoryStore,
} from './director-memory.js';
import { DirectorChatStore } from './chat-session.js';
import { DirectorAuditLog } from './director-audit.js';
import type {
  AgentOpinion,
  ChatResponder,
  DirectorFactsContext,
  DirectorResponse,
} from './director-types.js';

// ─── Helpers ───────────────────────────────────────────────────────

function makeFacts(o?: Partial<DirectorFactsContext>): DirectorFactsContext {
  return {
    assetsAnalysis: [
      {
        ticker: 'PLZL',
        name: 'Полюс',
        currentPercent: 32,
        targetPercent: 15,
        deficitRub: 0,
        status: 'REDUCE',
        balancePrice: 1000,
        currentPrice: 420,
        unrealizedProfitRub: -58000,
        isConcentrated: true,
      },
      {
        ticker: 'SBER',
        name: 'Сбер',
        currentPercent: 8,
        targetPercent: 12,
        deficitRub: 40000,
        status: 'BUY',
        balancePrice: 250,
        currentPrice: 300,
        unrealizedProfitRub: 5000,
      },
    ],
    totalPortfolioValue: 500000,
    freeCashRub: 60000,
    ...o,
  };
}

function stubAiExecutor(
  action: AgentOpinion['action'],
  confidence: number,
  argument: string,
): AiDecisionExecutor {
  return async () => ({
    role: 'ai',
    position: 'custom ai position',
    action,
    confidence,
    arguments: [argument],
  });
}

interface BuildOpts {
  aiExecutor?: AiDecisionExecutor;
  adapter?: ReturnType<typeof createInMemoryMemoryAdapter>;
  initialFacts?: DirectorFactsContext;
  maxRounds?: number;
  chatResponder?: ChatResponder;
  /** Хук приёма задач из свободного текста (мост к автономному циклу) */
  goalIntake?: {
    addGoal(text: string): Promise<{ id: string; name: string }>;
  };
  /** Извлекатель задач из свободной речи (LLM + fallback) */
  taskExtractor?: TaskExtractor;
  /** Детерминированный генератор случайных чисел (0..1) */
  random?: () => number;
}

function buildDirector(opts?: BuildOpts): {
  director: DirectorAgent;
  adapter: ReturnType<typeof createInMemoryMemoryAdapter>;
  audit: DirectorAuditLog;
} {
  const adapter = opts?.adapter ?? createInMemoryMemoryAdapter();
  const memory = new DirectorMemoryStore(adapter);
  const chat = new DirectorChatStore({ memoryAdapter: adapter });
  const audit = new DirectorAuditLog();
  // Один стрим на фасад и директора: живые шаги агентов попадают в ответ
  const activity = new ActivityStream();
  const facade = new DirectorAgentFacade({
    aiExecutor: opts?.aiExecutor,
    activity,
  });
  const director = new DirectorAgent(
    {
      facade,
      memory,
      chat,
      audit,
      initialFacts: opts?.initialFacts ?? makeFacts(),
      random: opts?.random,
      activity,
      taskExtractor: opts?.taskExtractor,
    },
    {
      maxConsiliumRounds: opts?.maxRounds ?? 3,
      chatResponder: opts?.chatResponder,
      goalIntake: opts?.goalIntake,
    },
  );
  director.createSession();
  return { director, adapter, audit };
}

async function ask(
  director: DirectorAgent,
  message: string,
): Promise<DirectorResponse> {
  return director.processUserMessage(message);
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('Director Agent (integration)', () => {
  it('1. Natural language message -> Director понимает вопрос', async () => {
    const { director } = buildDirector();
    const response = await ask(director, 'Что делать с PLZL?');

    expect(response.task).toBeDefined();
    expect(response.task!.interpretedQuestion.text).toBe('Что делать с PLZL?');
    expect(response.task!.interpretedQuestion.category).toBe('asset');
    expect(response.task!.interpretedQuestion.tickers).toContain('PLZL');
  });

  it('2. Director выбирает подходящих агентов (не всех подряд)', async () => {
    const { director } = buildDirector();
    const response = await ask(director, 'Что происходит с моим портфелем?');

    // Простой вопрос о портфеле: анализ + AI + стратег, без полного набора
    expect(response.connectedAgents.length).toBeLessThan(6);
    expect(response.connectedAgents).toContain('analysis');
    expect(response.connectedAgents).toContain('ai');
    expect(response.connectedAgents).toContain('strategist');
  });

  it('3. Director создаёт delegation plan с обоснованием', async () => {
    const { director } = buildDirector();
    const response = await ask(director, 'Что делать с PLZL?');

    expect(response.plan).toBeDefined();
    expect(response.plan!.taskId).toBeTruthy();
    expect(response.plan!.goal).toBeTruthy();
    expect(response.plan!.agentAssignments.length).toBeGreaterThan(0);
    // Для каждого агента указано, ПОЧЕМУ он подключён
    for (const assignment of response.plan!.agentAssignments) {
      expect(assignment.rationale.length).toBeGreaterThan(10);
    }
  });

  it('4. Director собирает результаты агентов', async () => {
    const { director } = buildDirector();
    const response = await ask(director, 'Что делать с PLZL?');

    expect(response.task!.agentResults).toHaveLength(
      response.connectedAgents.length,
    );
    for (const result of response.task!.agentResults) {
      expect(result.success).toBe(true);
      expect(result.completedAt).toBeTruthy();
    }
  });

  it('4.1 Director возвращает activity: живые шаги агентов', async () => {
    const { director } = buildDirector();
    const response = await ask(director, 'Что делать с PLZL?');

    expect(response.activity).toBeDefined();
    expect(response.activity!.length).toBeGreaterThanOrEqual(1);

    const phases = response.activity!.map((event) => event.phase);
    // Для каждого подключённого агента есть старт и завершение
    expect(phases).toContain('started');
    expect(phases).toContain('completed');
    // События привязаны к ролям подключённых агентов
    const roles = new Set(response.activity!.map((event) => event.role));
    for (const role of response.connectedAgents) {
      expect(roles).toContain(role);
    }
  });

  it('5. Director запускает Consilium для сложного вопроса', async () => {
    const { director } = buildDirector();
    const response = await ask(
      director,
      'Какова моя инвестиционная стратегия по PLZL?',
    );

    expect(response.needsConsilium).toBe(true);
    expect(response.task!.consilium).toBeDefined();
    expect(response.task!.consilium!.rounds.length).toBeGreaterThanOrEqual(1);
    expect(response.task!.consiliumRounds).toBeGreaterThanOrEqual(1);
  });

  it('6. Consilium поддерживает несколько раундов', async () => {
    const { director } = buildDirector({
      aiExecutor: stubAiExecutor('BUY', 0.99, 'Дефицит позиции очевиден'),
    });
    const response = await ask(
      director,
      'Какова моя инвестиционная стратегия по PLZL?',
    );

    expect(response.task!.consilium).toBeDefined();
    expect(response.task!.consilium!.rounds.length).toBeGreaterThanOrEqual(2);
  });

  it('7. Ни один агент не имеет безусловного veto', async () => {
    const { director } = buildDirector({
      aiExecutor: stubAiExecutor('BUY', 0.95, 'Покупка выравнивает структуру'),
    });
    const response = await ask(
      director,
      'Какова моя инвестиционная стратегия по PLZL?',
    );

    expect(response.task!.consilium).toBeDefined();
    expect(response.task!.consilium!.directorReasoning).toContain(
      'без безусловного veto',
    );
  });

  it('8. Strategist не может принудительно изменить AI action', async () => {
    const { director } = buildDirector({
      aiExecutor: stubAiExecutor('HOLD', 0.9, 'Оснований для изменений нет'),
    });
    const response = await ask(director, 'Какая стратегия по PLZL лучше?');

    // Стратег видит концентрацию и предлагал бы REDUCE,
    // но итоговое действие осталось позицией AI (HOLD)
    expect(response.recommendation!.action).toBe('HOLD');
  });

  it('9. ScenarioAgent не исключает SELL из-за убытка', async () => {
    const { director } = buildDirector({
      initialFacts: makeFacts({
        proposals: [{ ticker: 'PLZL', action: 'SELL' }],
      }),
    });
    const response = await ask(
      director,
      'Сравни: продать PLZL или удержать его',
    );

    const scenarioResult = response.task!.agentResults.find(
      (r) => r.role === 'scenario',
    );
    expect(scenarioResult).toBeDefined();
    const detail = scenarioResult!.data as unknown as {
      detail?: {
        scenarios?: Array<{
          changes: Array<{ ticker: string; action: string }>;
        }>;
      };
    };
    const scenarios = detail?.detail?.scenarios ?? [];
    const hasSell = scenarios.some((s) =>
      s.changes.some((c) => c.ticker === 'PLZL' && c.action === 'SELL'),
    );
    expect(hasSell).toBe(true);
  });

  it('10. Director сохраняет стратегическое решение в memory', async () => {
    const { director, adapter } = buildDirector();
    await ask(director, 'Что делать с PLZL?');

    const decisions = adapter.queryByType('decision');
    expect(decisions.length).toBeGreaterThan(0);
    // Ищем запись с содержимым решения (buildDecisionContent содержит 'Действие:')
    const hasDecisionContent = decisions.some((d) =>
      d.content.includes('Действие:'),
    );
    expect(hasDecisionContent).toBe(true);
    expect(director.getStrategicMemory().length).toBeGreaterThan(0);
  });

  it('11. Director использует прошлый контекст разговора', async () => {
    const { director } = buildDirector();
    await ask(director, 'Что делать с PLZL?');

    const followUp = await ask(director, 'А если он вырастет на 20%?');
    // Тема унаследована из предыдущего обсуждения PLZL
    expect(followUp.task!.interpretedQuestion.tickers).toContain('PLZL');
    expect(followUp.task!.interpretedQuestion.contextReference).toBeTruthy();
  });

  it('12. Director может предложить follow-up task', async () => {
    const { director } = buildDirector();
    const response = await ask(director, 'Что делать с PLZL?');

    expect(response.text).toContain('Можно продолжить обсуждение');
    const futureTasks = director
      .getStrategicMemory()
      .filter((m) => m.type === 'future-task');
    expect(futureTasks.length).toBeGreaterThan(0);
  });

  it('13. Director может сформировать proactive task', async () => {
    const { director } = buildDirector();
    const messages = director.suggestProactive();

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]!.content).toContain('Радик');
    expect(director.getProactiveMessages().length).toBeGreaterThan(0);
  });

  it('14. AI может не согласиться с PortfolioMath', async () => {
    // PortfolioMath помечает PLZL как REDUCE (концентрация),
    // но AI имеет полную свободу и говорит BUY
    const { director } = buildDirector({
      aiExecutor: stubAiExecutor('BUY', 0.8, 'Я вижу потенциал роста'),
    });
    const response = await ask(director, 'Что делать с PLZL?');

    expect(response.recommendation!.action).toBe('BUY');
  });

  it('15. AI может не согласиться с USER_TARGET', async () => {
    const { director } = buildDirector({
      aiExecutor: stubAiExecutor('SELL', 0.8, 'Фундаментально позиция слабая'),
      initialFacts: makeFacts({
        userTargetPercent: [
          { ticker: 'PLZL', targetPercent: 15 },
          { ticker: 'SBER', targetPercent: 12 },
        ],
      }),
    });
    const response = await ask(director, 'Что делать с PLZL?');

    // Целевая доля 15% не мешает AI предложить полный выход
    expect(response.recommendation!.action).toBe('SELL');
  });

  it('16. Все факты остаются неизменными', async () => {
    const facts = makeFacts();
    const snapshotBefore = JSON.stringify(facts);
    const { director } = buildDirector({ initialFacts: facts });

    await ask(director, 'Какая стратегия по PLZL лучше?');
    await ask(director, 'Что делать с PLZL?');

    expect(JSON.stringify(facts)).toBe(snapshotBefore);
  });

  it('17. Recommendation != executed order', async () => {
    // random=()=>0: интро/outro берутся первыми элементами пулов —
    // тест детерминирован (пулы интро/outро расширялись ранее)
    const { director } = buildDirector({ random: () => 0 });
    const response = await ask(director, 'Какая стратегия по PLZL лучше?');

    expect(response.recommendation).toBeDefined();
    expect(response.text).toContain('не совершённая операция');
    expect(response.text).toContain('подтверждения');
  });

  it('18. Audit trace содержит весь путь решения', async () => {
    const { director, audit } = buildDirector();
    const response = await ask(
      director,
      'Какова моя инвестиционная стратегия по PLZL?',
    );

    const trace = audit.getTrace(response.task!);
    expect(trace).not.toBeNull();
    expect(trace!.userQuestion).toBe(
      'Какова моя инвестиционная стратегия по PLZL?',
    );
    expect(trace!.directorInterpretation).toContain('strategy');
    expect(trace!.delegatedTasks.length).toBeGreaterThan(0);
    expect(trace!.consiliumRounds).toBeGreaterThanOrEqual(1);
    expect(trace!.finalRecommendation).toContain('%');
  });

  it('19. Chat history восстанавливается', async () => {
    const sharedAdapter = createInMemoryMemoryAdapter();
    const { director } = buildDirector({ adapter: sharedAdapter });
    await ask(director, 'Что делать с PLZL?');

    // Проверяем, что сообщения записаны в память
    const conversations = sharedAdapter.queryByType('conversation');
    expect(conversations.length).toBeGreaterThanOrEqual(2);

    // Новый экземпляр Director с тем же адаптером памяти
    const memory = new DirectorMemoryStore(sharedAdapter);
    const chat = new DirectorChatStore({ memoryAdapter: sharedAdapter });
    const facade = new DirectorAgentFacade();
    const director2 = new DirectorAgent(
      {
        facade,
        memory,
        chat,
        audit: new DirectorAuditLog(),
        initialFacts: makeFacts(),
      },
      { maxConsiliumRounds: 3 },
    );
    // Восстанавливаем сессию и проверяем что сообщения восстановлены
    director2.restoreSession(conversations[0]!.id);

    // Проверяем что история содержит сообщения из памяти
    const history = director2.getChatHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history.some((m) => m.role === 'user')).toBe(true);
    expect(history.some((m) => m.role === 'director')).toBe(true);
  });

  it('20. Конфликт агентов не превращается автоматически в HOLD', async () => {
    const { director } = buildDirector({
      aiExecutor: stubAiExecutor('SELL', 0.95, 'Выход обоснован'),
    });
    const response = await ask(
      director,
      'Какова моя инвестиционная стратегия по PLZL?',
    );

    // В раунде 1 был конфликт (AI: SELL против стратега: REDUCE),
    // но итог — SELL, а не принудительный HOLD
    expect(response.task!.consilium).toBeDefined();
    expect(response.recommendation!.action).toBe('SELL');
  });
});

describe('Director: приветствия (smalltalk)', () => {
  it('на «Привет» отвечает без делегирования агентам', async () => {
    const { director } = buildDirector();
    const response = await ask(director, 'Привет');

    expect(response.connectedAgents).toEqual([]);
    expect(response.text).toContain('Здравствуйте');
    expect(response.recommendation).toBeUndefined();
    expect(response.task).toBeUndefined();
  });

  it('короткое «привет!» не запускает анализ портфеля', async () => {
    const { director } = buildDirector({
      aiExecutor: stubAiExecutor('HOLD', 0.6, 'позиция в пределах'),
    });
    const response = await ask(director, 'привет!');

    expect(response.connectedAgents).toEqual([]);
    expect(response.recommendation).toBeUndefined();
  });
});

describe('Director: приём задач из свободного текста (goalIntake)', () => {
  it('реплика-задача превращается в цель без запуска агентов', async () => {
    const created: string[] = [];
    const { director } = buildDirector({
      goalIntake: {
        async addGoal(text) {
          created.push(text);
          return { id: 'goal-1234-uuid', name: text };
        },
      },
    });
    const response = await ask(
      director,
      'Давай добавим экспорт дашборда в PDF',
    );

    // Цель создана и подтверждена в ответе
    expect(created).toHaveLength(1);
    expect(created[0]).toContain('экспорт');
    expect(response.task).toBeUndefined();
    expect(response.connectedAgents).toHaveLength(0);
    expect(response.text).toContain('goal-1234'.slice(0, 4));
    expect(response.text).toContain('план');
  });

  it('немедленные действия (файл) НЕ превращаются в цель', async () => {
    const created: string[] = [];
    const { director } = buildDirector({
      goalIntake: {
        async addGoal(text) {
          created.push(text);
          return { id: 'goal-x', name: text };
        },
      },
    });
    const response = await ask(
      director,
      'Давай создай файл report-test.txt с текстом проверки',
    );

    // Файловый запрос ушёл агентам как действие, а не в цели
    expect(created).toHaveLength(0);
    expect(response.task).toBeDefined();
  });

  it('без goalIntake реплика-задача обрабатывается по-старому', async () => {
    const { director } = buildDirector();
    const response = await ask(
      director,
      'Давай добавим экспорт дашборда в PDF',
    );

    // Хук не подключён — задача не создаётся, идёт свободным диалогом
    expect(response.task).toBeUndefined();
    expect(response.text.length).toBeGreaterThan(0);
  });
});

describe('Director: свободный диалог (нефинансовые темы)', () => {
  it('общий вопрос без LLM → ответ по фактам портфеля без запуска агентов', async () => {
    const { director } = buildDirector();
    const response = await ask(director, 'Расскажи что-нибудь интересное');

    expect(response.connectedAgents).toEqual([]);
    expect(response.needsConsilium).toBe(false);
    expect(response.recommendation).toBeUndefined();
    expect(response.task).toBeUndefined();
    // Вместо фиксированной отмазки Director отвечает по фактам портфеля
    expect(response.text).toContain('портфеля');
    expect(response.text).toContain('PLZL');
  });

  it('с chatResponder → используется ответ LLM с контекстом портфеля', async () => {
    const chatResponder: ChatResponder = async ({ question, facts }) => {
      return `ОТВЕТ_LLM[${question}] активов: ${facts.assetsAnalysis.length}`;
    };
    const { director } = buildDirector({ chatResponder });
    const response = await ask(director, 'Просто поговори со мной');

    expect(response.connectedAgents).toEqual([]);
    expect(response.needsConsilium).toBe(false);
    expect(response.recommendation).toBeUndefined();
    expect(response.text).toBe('ОТВЕТ_LLM[Просто поговори со мной] активов: 2');
  });
});

describe('Director: извлечение задач из свободной речи (TaskExtractor)', () => {
  it('«Создай файл src/test.ts с тестом» → FileAgent (write)', async () => {
    const { director } = buildDirector();
    const response = await ask(director, 'Создай файл src/test.ts с тестом');

    expect(response.task).toBeDefined();
    expect(response.connectedAgents).toContain('file');
    expect(response.task!.interpretedQuestion.text).toBe(
      'Создай файл src/test.ts с тестом',
    );
    // План построен напрямую из задачи, без категорийной маршрутизации
    expect(response.plan!.goal).toContain('Файловая операция');
    expect(response.needsConsilium).toBe(false);
  });

  it('«Запусти тесты и покажи результат» → TerminalAgent (npm run test)', async () => {
    const { director } = buildDirector();
    const response = await ask(director, 'Запусти тесты и покажи результат');

    expect(response.task).toBeDefined();
    expect(response.connectedAgents).toContain('terminal');
    expect(response.plan!.goal).toContain('Выполнить команду');
  });

  it('«Реализуй функцию в src/js/modules/x/y.ts» → CodingWorkflow', async () => {
    const { director } = buildDirector();
    const response = await ask(
      director,
      'Реализуй функцию в src/js/modules/x/y.ts',
    );

    expect(response.task).toBeDefined();
    expect(response.connectedAgents).toContain('code');
    expect(response.plan!.goal).toContain('Разработать функционал');
  });

  it('«Добавь в план: покрыть модуль тестами» → цель автономного цикла', async () => {
    const created: string[] = [];
    const { director } = buildDirector({
      goalIntake: {
        async addGoal(text) {
          created.push(text);
          return { id: 'goal-task-1', name: text };
        },
      },
    });
    const response = await ask(
      director,
      'Добавь в план: покрыть модуль тестами',
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toContain('покрыть модуль тестами');
    expect(response.connectedAgents).toHaveLength(0);
    expect(response.text).toContain('план');
  });

  it('LLM-извлечённая задача → прямой план (минуя категорийную маршрутизацию)', async () => {
    const llm: LlmChatLike = {
      async chat() {
        return '{"tasks":[{"action":"file","target":"src/llm-test.ts","params":{"action":"write"}}]}';
      },
    };
    const { director } = buildDirector({
      taskExtractor: new TaskExtractor({ llm }),
    });
    const response = await ask(director, 'Создай файл src/llm-test.ts');

    expect(response.task).toBeDefined();
    expect(response.connectedAgents).toContain('file');
    expect(response.plan!.goal).toContain('Файловая операция');
    expect(response.plan!.userQuestion).toBe('Создай файл src/llm-test.ts');
  });

  it('финансовый вопрос не перехватывается извлечением задач', async () => {
    const { director } = buildDirector();
    const response = await ask(director, 'Что делать с PLZL?');

    // Категорийная маршрутизация: анализ + AI + стратег, а не action-агенты
    expect(response.connectedAgents).toContain('analysis');
    expect(response.connectedAgents).toContain('ai');
    expect(response.connectedAgents).not.toContain('file');
  });
});
