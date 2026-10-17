/**
 * DirectorAgent — главный интеллектуальный координатор инвестиционной системы.
 *
 * Director:
 * - разговаривает с пользователем естественным языком;
 * - понимает контекст предыдущих разговоров (через стратегическую память);
 * - сам определяет, какие агенты нужны для ответа;
 * - делегирует задачи агентам и собирает результаты;
 * - инициирует многораундовый Consilium при сложных вопросах;
 * - анализирует разногласия и формирует собственный итоговый вывод;
 * - сохраняет решения в стратегическую память;
 * - проактивно предлагает темы и follow-up задачи.
 *
 * Director НЕ исполняет операции: рекомендация != совершённый ордер.
 * Факты портфеля (цены, доли, P&L, USER_TARGET_PERCENT) неизменяемы.
 */

import type { AgentState } from '../agent/types.js';
import { ActivityStream } from '../agent-activity/activity-stream.js';
import { NewsDriver } from '../news-driver/news-driver.js';
import type { NewsCacheLike, NewsImpact } from '../news-driver/types.js';
import { resolveTaskAction } from '../task-extractor/action-resolver.js';
import { TaskExtractor } from '../task-extractor/task-extractor.js';
import type { ExtractedTask, TaskAction } from '../task-extractor/types.js';
import {
  looksLikeAutomationRequest,
  looksLikeCodeRequest,
  looksLikeFileRequest,
  looksLikePackageRequest,
  looksLikeProcessRequest,
  looksLikeSystemStatusRequest,
  looksLikeTerminalRequest,
  parseUserMessage,
} from './nl-parser.js';
import { DialogueEngine } from '../dialogue-engine/dialogue-engine.js';
import {
  DirectorDelegationPlanner,
  AGENT_ROLE_LABELS,
} from './delegation-planner.js';
import {
  buildHelpText,
  executeChatCommand,
  parseChatInput,
  type ChatCommand,
  type ChatCommandSources,
} from './director-chat-commands.js';
import {
  DirectorAgentFacade,
  actionLabel,
  type DirectorAgentPayload,
} from './agent-facade.js';
import { DirectorMemoryStore } from './director-memory.js';
import { buildBrowserChatResponse } from './browser-chat-responder.js';
import { DirectorAuditLog } from './director-audit.js';
import { DirectorChatStore } from './chat-session.js';
import { ProactiveSuggester } from './proactive-suggester.js';
import { runMultiRoundConsilium } from './multi-round-consilium.js';
import type {
  AgentOpinion,
  AgentResultEntry,
  AgentRole,
  ChatMessage,
  DirectorAuditEvent,
  DirectorChatSession,
  DirectorConfig,
  DirectorFactsContext,
  DirectorPlan,
  DirectorResponse,
  DirectorStrategicMemory,
  DirectorTask,
  InterpretedQuestion,
  MultiRoundConsiliumOutput,
  ProactiveMessage,
  IDirectorAgent,
} from './director-types.js';

/** Зависимости Director (DI) */
export interface DirectorAgentDeps {
  planner?: DirectorDelegationPlanner;
  facade?: DirectorAgentFacade;
  memory?: DirectorMemoryStore;
  chat?: DirectorChatStore;
  audit?: DirectorAuditLog;
  proactive?: ProactiveSuggester;
  initialFacts?: DirectorFactsContext;
  /** Генератор случайных чисел 0..1 (DI для детерминированных тестов) */
  random?: () => number;
  /** Движок естественного диалога (NLU вместо regex-веток); без него — fallback */
  dialogue?: DialogueEngine;
  /** Стрим активности агентов (живые шаги в UI); без него — свой экземпляр */
  activity?: ActivityStream;
  /** Извлекатель задач из свободной речи (LLM + fallback на nl-parser) */
  taskExtractor?: TaskExtractor;
  /** Новостной драйвер (новости как драйвер прогноза/оценки/корректировки) */
  newsDriver?: NewsDriver;
  /** Кэш новостей (gatekeeper); без него новостной фон не анализируется */
  newsCache?: NewsCacheLike;
}

/** Пустые факты по умолчанию */
function emptyFacts(): DirectorFactsContext {
  return {
    assetsAnalysis: [],
    totalPortfolioValue: 0,
    freeCashRub: 0,
  };
}

/** Порог уверенности извлечённой задачи по умолчанию */
const DEFAULT_TASK_EXTRACTION_THRESHOLD = 0.7;

/** Действия, по которым Director строит план напрямую (без категорийной маршрутизации) */
const DIRECT_PLAN_ACTIONS: ReadonlySet<TaskAction> = new Set([
  'file',
  'terminal',
  'code',
  'package',
  'process',
  'automation',
]);

/** Слова-связки для определения follow-up сообщения */
const FOLLOW_UP_PREFIXES = [
  'а если',
  'а что',
  'а ещё',
  'если',
  'дальше',
  'ну а',
  'а когда',
];

/**
 * Разбить текст на чанки для streaming (по предложениям/абзацам).
 * UI получает части ответа LLM каждые 20-50 символов.
 */
function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  const chunkSize = 30; // символов на чанк

  // Сначала разбиваем на абзацы
  const paragraphs = text.split('\n\n');

  for (const paragraph of paragraphs) {
    if (paragraph.length <= chunkSize) {
      if (paragraph) chunks.push(paragraph);
      continue;
    }

    // Разбиваем длинный абзац на чанки
    let remaining = paragraph;
    while (remaining.length > 0) {
      // Ищем удобную точку разрыва (пробел, знак препинания)
      let splitAt = chunkSize;
      const spaceIndex = remaining.indexOf(' ', chunkSize);
      if (spaceIndex > 0 && spaceIndex < chunkSize + 20) {
        splitAt = spaceIndex;
      }

      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Director Agent — координатор диалога и решений.
 */
export class DirectorAgent implements IDirectorAgent {
  public readonly name = 'DirectorAgent';

  private _state: AgentState = 'idle';
  private readonly config: DirectorConfig;
  private readonly planner: DirectorDelegationPlanner;
  private readonly facade: DirectorAgentFacade;
  private readonly memory: DirectorMemoryStore;
  private readonly chat: DirectorChatStore;
  private readonly audit: DirectorAuditLog;
  private readonly proactiveSuggester: ProactiveSuggester;
  private readonly dialogue: DialogueEngine;
  private readonly activity: ActivityStream;
  private readonly taskExtractor: TaskExtractor;
  private readonly taskExtractionThreshold: number;
  private readonly newsDriver: NewsDriver;
  private readonly newsCache?: NewsCacheLike;

  private facts: DirectorFactsContext;
  private currentSessionId: string | null = null;
  private lastActiveTask: DirectorTask | null = null;
  private proactiveMessages: ProactiveMessage[] = [];
  private readonly random: () => number;
  /** Новостной фон по портфелю (пересчитывается на каждый запрос) */
  private newsImpacts: NewsImpact[] = [];

  // Ленивый анализ
  private analysisReady: boolean = false;
  private analysisInProgress: boolean = false;
  /** Последний ленивый анализ упал — не перезапускаем бесконечно */
  private analysisFailed: boolean = false;

  constructor(deps?: DirectorAgentDeps, config?: DirectorConfig) {
    this.config = config ?? {};
    this.planner =
      deps?.planner ??
      new DirectorDelegationPlanner({
        maxAgents: this.config.maxAgentsPerTask ?? 0,
        consiliumThreshold: this.config.consiliumComplexityThreshold ?? 3,
      });
    this.activity = deps?.activity ?? new ActivityStream();
    this.facade =
      deps?.facade ?? new DirectorAgentFacade({ activity: this.activity });
    this.memory = deps?.memory ?? new DirectorMemoryStore();
    this.chat = deps?.chat ?? new DirectorChatStore();
    this.audit = deps?.audit ?? new DirectorAuditLog();
    this.proactiveSuggester = deps?.proactive ?? new ProactiveSuggester();
    this.dialogue = deps?.dialogue ?? new DialogueEngine();
    this.taskExtractor = deps?.taskExtractor ?? new TaskExtractor();
    this.taskExtractionThreshold =
      this.config.taskExtractionThreshold ?? DEFAULT_TASK_EXTRACTION_THRESHOLD;
    this.newsDriver = deps?.newsDriver ?? new NewsDriver();
    this.newsCache = deps?.newsCache;
    this.facts = deps?.initialFacts ?? emptyFacts();
    this.random = deps?.random ?? Math.random;
  }

  get state(): AgentState {
    return this._state;
  }

  get currentSession(): DirectorChatSession | null {
    return this.chat.getSession(this.currentSessionId ?? undefined);
  }

  /** Установить снимок фактических данных портфеля (неизменяемый источник) */
  setFacts(facts: DirectorFactsContext): void {
    this.facts = facts;
  }

  /** Установить идентификатор текущей сессии */
  useSession(sessionId: string): void {
    this.currentSessionId = sessionId;
    this.chat.getOrCreateSession(sessionId);
  }

  /** Проверить, готов ли анализ портфеля */
  get isAnalysisReady(): boolean {
    return this.analysisReady;
  }

  /** Получить статус анализа (для UI) */
  get analysisStatus(): 'ready' | 'pending' | 'in_progress' | 'none' {
    if (this.analysisReady) return 'ready';
    if (this.analysisInProgress) return 'in_progress';
    if (this.facts.assetsAnalysis.length > 0) return 'pending';
    return 'none';
  }

  /**
   * Актуальные факты портфеля (обновляются при перезагрузке Excel).
   * Используется отчётом анализа для таблиц активов/алертов.
   */
  getFacts(): DirectorFactsContext {
    return this.facts;
  }

  /** Запустить ленивый анализ портфеля */
  async runLazyAnalysis(): Promise<string> {
    if (this.analysisInProgress) {
      return 'Анализ уже запущен, подождите...';
    }
    if (!this.facts || this.facts.assetsAnalysis.length === 0) {
      return 'Нет данных для анализа. Сначала загрузите Excel-файл.';
    }

    this.analysisInProgress = true;
    this._state = 'running';

    try {
      // Запускаем анализ через facade (pipeline)
      const result = await this.facade.runFullAnalysis(this.facts);
      this.analysisReady = true;
      return (
        result || 'Анализ портфеля завершён. Данные готовы к использованию.'
      );
    } catch (err) {
      // Честная фиксация провала: без этого флага рекурсивный повтор
      // processUserMessage вечно попадает в ветку ленивого анализа.
      this.analysisFailed = true;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return `Ошибка анализа: ${errorMsg}`;
    } finally {
      this.analysisInProgress = false;
      this._state = 'idle';
    }
  }

  /** Сбросить кэш анализа (при изменении Excel) */
  resetAnalysisCache(): void {
    this.analysisReady = false;
    this.analysisInProgress = false;
    this.analysisFailed = false;
  }

  /**
   * Обработать сообщение пользователя.
   * Основной вход Director: USER -> INTERPRETATION -> PLAN -> DELEGATE ->
   * CONSILIUM (при необходимости) -> SYNTHESIS -> MEMORY -> RESPONSE.
   */
  async processUserMessage(rawMessage: string): Promise<DirectorResponse> {
    const message = (rawMessage ?? '').trim();
    this._state = 'running';
    const session = this.chat.getOrCreateSession(
      this.currentSessionId ?? undefined,
    );
    this.currentSessionId = session.sessionId;

    // 0.1 Новостной фон по портфелю (NewsDriver): влияет на LLM-контекст
    // и корректировку рекомендаций. Без подключённого кэша — пусто.
    this.newsImpacts = this.newsCache
      ? this.newsDriver.analyzePortfolio(this.facts, this.newsCache)
      : [];

    // 0. Системные команды чата (/status, /log, /undo, /help)
    const parsed = parseChatInput(message);
    if (parsed.kind === 'command') {
      return this.handleChatCommand(parsed.command, message);
    }

    // 0.3 Естественный диалог: анализ интента/эмоции/контекста (NLU)
    // вместо цепочки regex-проверок. DialogueEngine (LLM + fallback на
    // nl-parser) даёт intent, по которому маршрутизируются ветки ниже.
    const dialogueAnalysis = await this.dialogue.analyze({
      text: message,
      context: this.dialogue.getContext(),
      facts: this.facts,
    });

    // 0.4 Вопрос о состоянии дел («Как дела?», «Что нового?») —
    // мгновенный ответ из фактов и статуса БЕЗ LLM (fast-path).
    // Financial-реплики («что происходит с портфелем?») классифицируются
    // как portfolio и обрабатываются штатным конвейером агентов.
    if (dialogueAnalysis.intent === 'status') {
      this.chat.appendMessage(this.currentSessionId, 'user', message);
      this.memory.saveConversation('user', message, []);
      const replyText = this.buildStatusDigest();
      this.chat.appendMessage(this.currentSessionId, 'director', replyText);
      this.memory.saveConversation('director', replyText, []);
      this.audit.record('director.status_answered', 'Быстрый статус без LLM');
      this._state = 'idle';
      return {
        text: replyText,
        connectedAgents: [],
        needsConsilium: false,
      };
    }

    // 0.45 Реплика-задача/идея («давай добавим…», «задача: …») —
    // превращается в цель автономного цикла, если подключён goalIntake.
    // Немедленные действия (файл/терминал/код/процесс/автоматизация) и
    // финансовые вопросы обрабатываются штатно — идея создаёт цель, а не
    // запускает тяжёлый анализ прямо сейчас.
    if (this.config.goalIntake) {
      const isImmediateAction =
        looksLikeFileRequest(message) ||
        looksLikeTerminalRequest(message) ||
        looksLikePackageRequest(message) ||
        looksLikeProcessRequest(message) ||
        looksLikeAutomationRequest(message) ||
        looksLikeSystemStatusRequest(message) ||
        looksLikeCodeRequest(message);
      if (
        dialogueAnalysis.intent === 'task' &&
        dialogueAnalysis.category === 'general' &&
        dialogueAnalysis.tickers.length === 0 &&
        !isImmediateAction
      ) {
        try {
          const goal = await this.config.goalIntake.addGoal(message);
          this.chat.appendMessage(this.currentSessionId, 'user', message);
          this.memory.saveConversation('user', message, []);
          const replyText =
            '🎯 Принял как задачу — поставил в план автономного цикла:\n' +
            `«${goal.name}» [${goal.id.slice(0, 8)}]\n\n` +
            'Выполню фоном, итог придёт в чат. Список целей: /goals.\n' +
            'Если нужно сделать СЕЙЧАС — сформулируй как действие, ' +
            'например: «создай файл …», «запусти тесты».';
          this.chat.appendMessage(this.currentSessionId, 'director', replyText);
          this.memory.saveConversation('director', replyText, []);
          this.audit.record('director.goal_created', goal.id);
          this._state = 'idle';
          return {
            text: replyText,
            connectedAgents: [],
            needsConsilium: false,
          };
        } catch (err) {
          // Не удалось создать цель — реплика пойдёт по общему конвейеру
          this.audit.record(
            'director.goal_created',
            `Ошибка приёма задачи: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // 0.5 Приветствие/прощание: дружелюбный ответ без делегирования агентам
    if (
      dialogueAnalysis.intent === 'greeting' ||
      dialogueAnalysis.intent === 'farewell'
    ) {
      this.chat.appendMessage(this.currentSessionId, 'user', message);
      this.memory.saveConversation('user', message, []);
      const replyText =
        dialogueAnalysis.intent === 'farewell'
          ? 'До встречи! Буду ждать ваших вопросов по портфелю. 🤝'
          : 'Здравствуйте! Я — ваш финансовый директор. Готов обсудить портфель: ' +
            'спросите про актив (например, «Что с SBER?»), стратегию, рынок или новости.';
      this.chat.appendMessage(this.currentSessionId, 'director', replyText);
      this.memory.saveConversation('director', replyText, []);
      this.audit.record('director.greeting_answered', replyText.slice(0, 80));
      this._state = 'idle';
      return {
        text: replyText,
        connectedAgents: [],
        needsConsilium: false,
      };
    }

    // 0.55 Оффтопик: темы вне компетенции (погода, спорт, кулинария и т.д.)
    // Честный ответ БЕЗ запуска агентов анализа и БЕЗ портфельного контекста.
    if (dialogueAnalysis.intent === 'off-topic') {
      this.chat.appendMessage(this.currentSessionId, 'user', message);
      this.memory.saveConversation('user', message, []);
      const replyText =
        'Хороший вопрос, но он не про портфель 😊\n\n' +
        'Я — ваш финансовый директор и разбираюсь в инвестициях, ' +
        'а не в погоде, спорте или кулинарии. Зато могу помочь с:\n' +
        '• «Что с SBER?» — разбор конкретного актива\n' +
        '• «Как выглядит портфель?» — сводка по всем позициям\n' +
        '• «Есть ли риски?» — концентрация, просадки, отклонения\n' +
        '• «Стратегия» — план по структуре портфеля';
      this.chat.appendMessage(this.currentSessionId, 'director', replyText);
      this.memory.saveConversation('director', replyText, []);
      this.audit.record('director.offtopic_answered', replyText.slice(0, 80));
      this._state = 'idle';
      return {
        text: replyText,
        connectedAgents: [],
        needsConsilium: false,
      };
    }

    // 0.6 Простые бытовые вопросы (smalltalk/вежливость): сразу LLM без агентов
    if (
      dialogueAnalysis.intent === 'smalltalk' ||
      dialogueAnalysis.intent === 'courtesy'
    ) {
      this.chat.appendMessage(this.currentSessionId, 'user', message);
      this.memory.saveConversation('user', message, []);
      const historyText = this.chat
        .getHistory(this.currentSessionId ?? '')
        .slice(-6)
        .map((m) => `${m.role}: ${m.text}`)
        .join('\n');
      const answer = this.config.chatResponder
        ? await this.config.chatResponder({
            question: message,
            facts: this.factsWithNewsContext(),
            history: historyText,
          })
        : null;
      const replyText =
        answer ?? 'Можем обсудить ваш портфель или просто поболтать.';
      this.chat.appendMessage(this.currentSessionId, 'director', replyText);
      this.memory.saveConversation('director', replyText, []);
      this.audit.record(
        'director.chat_message_sent',
        answer ? 'Быстрый ответ через LLM' : 'Ответ по фактам',
      );
      this._state = 'idle';
      return {
        text: replyText,
        connectedAgents: [],
        needsConsilium: false,
      };
    }

    // 0.7 Извлечение задач из свободной речи (TaskExtractor).
    // Запускается для action/task-интентов: LLM-извлечение структурированных
    // задач с fallback на nl-parser + action-input-builder. Если найдена
    // задача с confidence >= порога — строим план напрямую, минуя
    // категорийную маршрутизацию (parseUserMessage).
    if (
      dialogueAnalysis.intent === 'action' ||
      dialogueAnalysis.intent === 'task'
    ) {
      const extraction = await this.taskExtractor.extract(message, {
        facts: this.facts,
      });
      const bestTask = extraction.tasks
        .filter((t) => t.confidence >= this.taskExtractionThreshold)
        .sort((a, b) => b.confidence - a.confidence)[0];

      if (bestTask) {
        this.audit.record(
          'director.task_extracted',
          `Задача: ${bestTask.action} → ${
            bestTask.target || bestTask.rawText.slice(0, 60)
          } (${Math.round(bestTask.confidence * 100)}%)`,
          {
            metadata: {
              action: bestTask.action,
              confidence: bestTask.confidence,
              source: extraction.source,
            },
          },
        );

        // Цель автономного цикла (fallback для goalIntake)
        if (bestTask.action === 'goal') {
          const goalResponse = await this.tryCreateGoal(bestTask, message);
          if (goalResponse) {
            return goalResponse;
          }
          // Без goalIntake — задача идёт обычным конвейером
        } else if (DIRECT_PLAN_ACTIONS.has(bestTask.action)) {
          return this.handleExtractedTask(bestTask, message);
        }
      }
    }

    // 1. Интерпретация вопроса
    const knownAssets = this.facts.assetsAnalysis.map((a) => ({
      ticker: a.ticker,
      name: a.name,
    }));
    let interpreted = parseUserMessage(message, knownAssets);
    this.audit.record('director.question_received', message);

    // 1.1 Свободный диалог: нефинансовый вопрос → LLM (с фактами портфеля)
    // или честный fallback-ответ без запуска агентов анализа.
    // Файловые/терминальные запросы («создай файл», «запусти тесты») в эту
    // ветку НЕ попадают — они идут через делегирование action-агентам.
    if (
      interpreted.category === 'general' &&
      interpreted.tickers.length === 0 &&
      !looksLikeFileRequest(message) &&
      !looksLikeTerminalRequest(message) &&
      !looksLikeProcessRequest(message) &&
      !looksLikeAutomationRequest(message) &&
      !looksLikeCodeRequest(message)
    ) {
      this.chat.appendMessage(this.currentSessionId, 'user', message);
      this.memory.saveConversation('user', message, []);
      const historyText = this.chat
        .getHistory(this.currentSessionId ?? '')
        .slice(-6)
        .map((m) => `${m.role}: ${m.text}`)
        .join('\n');
      const answer = this.config.chatResponder
        ? await this.config.chatResponder({
            question: message,
            facts: this.factsWithNewsContext(),
            history: historyText,
          })
        : null;
      // Без LLM отвечаем по фактам портфеля, а не фиксированной фразой
      const replyText =
        answer ?? this.buildGeneralFallback(message, historyText);
      this.chat.appendMessage(this.currentSessionId, 'director', replyText);
      this.memory.saveConversation('director', replyText, []);
      this.audit.record(
        'director.chat_message_sent',
        answer
          ? 'Свободный ответ сгенерирован через LLM'
          : 'Ответ построен по фактам портфеля (без LLM)',
      );
      this._state = 'idle';
      return {
        text: replyText,
        connectedAgents: [],
        needsConsilium: false,
      };
    }

    // 2. Контекст предыдущего разговора (follow-up без повторения тикеров)
    if (
      interpreted.tickers.length === 0 &&
      this.lastActiveTask &&
      this.isFollowUp(interpreted)
    ) {
      const prevTickers = this.lastActiveTask.interpretedQuestion.tickers;
      if (prevTickers.length > 0) {
        interpreted = {
          ...interpreted,
          tickers: [...prevTickers],
          contextReference: 'продолжение обсуждения ' + prevTickers.join(', '),
        };
      }
    }
    this.audit.record(
      'director.question_interpreted',
      interpreted.category +
        '/' +
        interpreted.intent +
        ': ' +
        interpreted.topic,
      {
        metadata: {
          tickers: interpreted.tickers,
          complexity: interpreted.complexity,
        },
      },
    );

    // 3. Контекст из памяти
    const memoryContext = this.memory.loadContext(
      interpreted.tickers,
      interpreted.category,
    );

    // 4. План делегирования
    const plan = this.planner.buildPlan(interpreted, memoryContext);
    const agentTasks = this.planner.buildAgentTasks(interpreted);
    this.audit.record(
      'director.plan_created',
      'Подключены агенты: ' +
        plan.connectedAgents.join(', ') +
        '. Consilium: ' +
        String(plan.needsConsilium),
      { metadata: { agents: plan.connectedAgents } },
    );

    // 4.1 Ленивый анализ: если есть тикеры и анализ ещё не готов — запускаем
    if (
      (interpreted.tickers.length > 0 || plan.connectedAgents.length > 0) &&
      !this.analysisReady &&
      !this.analysisInProgress &&
      !this.analysisFailed
    ) {
      const analysisResult = await this.runLazyAnalysis();

      if (this.analysisReady) {
        // Анализ реально выполнен: фиксируем диалог и повторяем вопрос
        this.chat.appendMessage(this.currentSessionId, 'user', message, {
          tickers: interpreted.tickers,
        });
        this.memory.saveConversation('user', message, interpreted.tickers);
        this.chat.appendMessage(
          this.currentSessionId,
          'director',
          analysisResult,
        );
        this.memory.saveConversation('director', analysisResult, []);
        console.info(
          `[director] Ленивый анализ запущен: ${interpreted.tickers.join(', ')}`,
        );
        // После завершения анализа повторяем вопрос
        return this.processUserMessage(rawMessage);
      }

      // Анализ не выполнен (нет данных / ошибка): предупреждаем и идём
      // обычным путём. Повтор запроса здесь бессмыслен и зацикливал бы
      // обработку (bugfix: бесконечный «Ленивый анализ запущен»).
      this.chat.appendMessage(
        this.currentSessionId,
        'director',
        analysisResult,
      );
      this.memory.saveConversation('director', analysisResult, []);
    }

    // 5. Сохраняем сообщение пользователя в чат и память
    this.chat.appendMessage(this.currentSessionId, 'user', message, {
      tickers: interpreted.tickers,
    });
    this.memory.saveConversation('user', message, interpreted.tickers);

    // 6. Делегирование агентам
    this.audit.record(
      'director.task_delegated',
      'Делегирование ' + plan.connectedAgents.length + ' агентам',
      { metadata: { agents: plan.connectedAgents } },
    );
    // События активности фиксируются до/после делегирования: в ответ
    // попадают только события текущей задачи (живые шаги агентов).
    const activityBefore = this.activity.getRecent().length;
    const agentResults = await this.facade.executeRoles(
      plan.connectedAgents,
      interpreted,
      this.facts,
    );
    const activity = this.activity.getRecent().slice(activityBefore);
    for (const r of agentResults) {
      this.audit.record(
        'director.agent_result_received',
        'Результат от ' + r.role + ': ' + (r.success ? 'ok' : 'error'),
        { metadata: { durationMs: r.durationMs } },
      );
    }

    // 7. Мнения агентов для обсуждения
    const opinions = extractOpinions(agentResults);

    // 8. Consilium (только для сложных вопросов)
    let consilium: MultiRoundConsiliumOutput | undefined;
    let recommendation: DirectorTask['recommendation'];
    const needConsilium = plan.needsConsilium && opinions.length >= 2;

    if (needConsilium) {
      this.audit.record('director.consilium_started', 'Созыв консилиума', {
        metadata: { opinions: opinions.length },
      });
      consilium = runMultiRoundConsilium({
        topic: interpreted.topic,
        tickers: interpreted.tickers,
        initialOpinions: opinions,
        discussionTopics: plan.discussionTopics,
        maxRounds: this.config.maxConsiliumRounds ?? 3,
        aiTieBreak: this.config.aiTieBreak ?? true,
      });
      this.audit.record(
        'director.consilium_completed',
        'Раундов: ' +
          consilium.rounds.length +
          ', итог: ' +
          consilium.finalRecommendation.action,
        { metadata: { rounds: consilium.rounds.length } },
      );
      recommendation = {
        action: consilium.finalRecommendation.action,
        confidence: consilium.directorConfidence,
        reasoning: consilium.directorReasoning,
      };
    } else {
      const best = pickBestOpinion(opinions);
      recommendation = {
        action: best?.action ?? null,
        confidence: best?.confidence ?? 0,
        reasoning:
          best?.position ??
          'Недостаточно данных для рекомендации; факты сохранены.',
      };
    }

    // 8.1 Новостная корректировка рекомендации (NewsDriver):
    // критический негатив → пересмотреть позицию, позитив → усилить тезис.
    if (this.newsImpacts.length > 0) {
      const adjusted = this.newsDriver.adjustRecommendation(
        recommendation,
        this.newsImpacts,
      );
      recommendation = {
        action: adjusted.action,
        confidence: adjusted.confidence,
        reasoning: adjusted.reasoning,
      };
      this.audit.record(
        'director.recommendation_formed',
        'Рекомендация скорректирована новостным фоном: ' +
          String(adjusted.action),
        { metadata: { adjustedByNews: true } },
      );
    }

    // 9. Синтез итога
    const finalSynthesis = this.synthesize(
      interpreted,
      plan,
      agentResults,
      consilium,
      recommendation,
    );

    // 10. Завершение задачи
    const task: DirectorTask = {
      taskId: plan.taskId,
      userQuestion: message,
      interpretedQuestion: interpreted,
      goal: plan.goal,
      status: 'completed',
      agents: agentTasks,
      agentResults,
      needsConsilium: plan.needsConsilium,
      consilium,
      consiliumRounds: consilium?.rounds.length ?? 0,
      finalSynthesis,
      recommendation,
      savedToMemory: false,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    this.audit.record(
      'director.synthesis_created',
      finalSynthesis.slice(0, 150),
      { taskId: task.taskId },
    );
    this.audit.record(
      'director.recommendation_formed',
      String(recommendation.action) +
        ' (' +
        Math.round(recommendation.confidence * 100) +
        '%)',
      { taskId: task.taskId },
    );

    // 11. Стратегическая память (ДО follow-up, чтобы решение было первым)
    const saved = this.memory.saveTaskOutcome({
      taskId: task.taskId,
      userQuestion: message,
      tickers: interpreted.tickers,
      action: recommendation.action,
      confidence: recommendation.confidence,
      reasoning: recommendation.reasoning,
    });
    task.savedToMemory = true;
    this.audit.record(
      'director.memory_saved',
      'Решение сохранено: ' + saved.id,
      { taskId: task.taskId },
    );

    // 12. Follow-up задачи (предложения продолжения)
    const followUps = this.buildFollowUps(interpreted, recommendation);
    for (const f of followUps) {
      this.memory.saveStrategicMemoryEntry({
        type: 'future-task',
        ticker: interpreted.tickers[0],
        content: f,
        reason: 'Предложено Director как логичное продолжение обсуждения',
        status: 'active',
        priority: 'normal',
      });
    }

    // 13. Ответ Director в чат + память
    const replyText = this.buildReply(
      interpreted,
      plan,
      recommendation,
      consilium,
      followUps,
      agentResults,
    );
    this.chat.appendMessage(this.currentSessionId, 'director', replyText, {
      taskId: task.taskId,
      connectedAgents: plan.connectedAgents,
      isWorking: false,
    });
    this.memory.saveConversation('director', replyText, interpreted.tickers);
    // Запоминаем ответ Director в контексте диалога (для follow-up-анафор)
    this.dialogue.pushDirector(replyText);
    this.audit.record(
      'director.chat_message_sent',
      'Ответ Director отправлен',
      {
        taskId: task.taskId,
      },
    );

    // 14. Сохраняем активную задачу для контекста follow-up
    this.lastActiveTask = task;
    this._state = 'idle';

    return {
      text: replyText,
      task,
      plan,
      connectedAgents: plan.connectedAgents,
      needsConsilium: needConsilium,
      recommendation,
      activity,
      news: this.newsImpacts,
    };
  }

  /**
   * Потоковая версия processUserMessage.
   * Отправляет части ответа LLM через onChunk в реальном времени.
   * Используется для real-time отображения в UI виджета.
   *
   * Поддерживает streaming только для LLM-ответов (smalltalk, analysis).
   * Системные команды (/status, /log) и быстрые ответы — без streaming.
   */
  async processUserMessageStreaming(
    rawMessage: string,
    onChunk: (chunk: string) => void,
  ): Promise<DirectorResponse> {
    const message = (rawMessage ?? '').trim();
    this._state = 'running';
    const session = this.chat.getOrCreateSession(
      this.currentSessionId ?? undefined,
    );
    this.currentSessionId = session.sessionId;

    // Новостной фон
    this.newsImpacts = this.newsCache
      ? this.newsDriver.analyzePortfolio(this.facts, this.newsCache)
      : [];

    // Системные команды — без streaming (мгновенный ответ)
    const parsed = parseChatInput(message);
    if (parsed.kind === 'command') {
      return this.handleChatCommand(parsed.command, message);
    }

    // NLU анализ
    const dialogueAnalysis = await this.dialogue.analyze({
      text: message,
      context: this.dialogue.getContext(),
      facts: this.facts,
    });

    // Быстрые пути — без streaming
    if (dialogueAnalysis.intent === 'status') {
      this.chat.appendMessage(this.currentSessionId, 'user', message);
      this.memory.saveConversation('user', message, []);
      const replyText = this.buildStatusDigest();
      this.chat.appendMessage(this.currentSessionId, 'director', replyText);
      this.memory.saveConversation('director', replyText, []);
      this.audit.record('director.status_answered', 'Быстрый статус без LLM');
      this._state = 'idle';
      return {
        text: replyText,
        connectedAgents: [],
        needsConsilium: false,
      };
    }

    // Greeting/farewell — мгновенно
    if (
      dialogueAnalysis.intent === 'greeting' ||
      dialogueAnalysis.intent === 'farewell'
    ) {
      this.chat.appendMessage(this.currentSessionId, 'user', message);
      this.memory.saveConversation('user', message, []);
      const replyText =
        dialogueAnalysis.intent === 'farewell'
          ? 'До встречи! Буду ждать ваших вопросов по портфелю. 🤝'
          : 'Здравствуйте! Я — ваш финансовый директор. Готов обсудить портфель: ' +
            'спросите про актив (например, «Что с SBER?»), стратегию, рынок или новости.';
      this.chat.appendMessage(this.currentSessionId, 'director', replyText);
      this.memory.saveConversation('director', replyText, []);
      this.audit.record('director.greeting_answered', replyText.slice(0, 80));
      this._state = 'idle';
      return {
        text: replyText,
        connectedAgents: [],
        needsConsilium: false,
      };
    }

    // Оффтопик — мгновенно
    if (dialogueAnalysis.intent === 'off-topic') {
      this.chat.appendMessage(this.currentSessionId, 'user', message);
      this.memory.saveConversation('user', message, []);
      const replyText =
        'Хороший вопрос, но он не про портфель 😊\n\n' +
        'Я — ваш финансовый директор и разбираюсь в инвестициях, ' +
        'а не в погоде, спорте или кулинарии. Зато могу помочь с:\n' +
        '• «Что с SBER?» — разбор конкретного актива\n' +
        '• «Как выглядит портфель?» — сводка по всем позициям\n' +
        '• «Есть ли риски?» — концентрация, просадки, отклонения\n' +
        '• «Стратегия» — план по структуре портфеля';
      this.chat.appendMessage(this.currentSessionId, 'director', replyText);
      this.memory.saveConversation('director', replyText, []);
      this.audit.record('director.offtopic_answered', replyText.slice(0, 80));
      this._state = 'idle';
      return {
        text: replyText,
        connectedAgents: [],
        needsConsilium: false,
      };
    }

    // Smalltalk — с streaming через LLM
    if (dialogueAnalysis.intent === 'smalltalk') {
      this.chat.appendMessage(this.currentSessionId, 'user', message);
      this.memory.saveConversation('user', message, []);

      const fullText = await this.handleSmalltalkStreaming(
        message,
        onChunk,
      );

      this.chat.appendMessage(this.currentSessionId, 'director', fullText);
      this.memory.saveConversation('director', fullText, []);
      this.dialogue.pushDirector(fullText);
      this._state = 'idle';
      return {
        text: fullText,
        connectedAgents: [],
        needsConsilium: false,
      };
    }

    // Для сложных запросов (analysis, task, portfolio) — используем
    // стандартный processUserMessage (streaming не применим из-за
    // многошаговости: agents → consilium → synthesis).
    // UI покажет «Director думает…» до получения полного ответа.
    const response = await this.processUserMessage(message);

    // После получения полного ответа — отправляем через onChunk
    // для согласованности с UI
    const chunks = splitIntoChunks(response.text);
    for (const chunk of chunks) {
      onChunk(chunk);
    }

    return response;
  }

  /**
   * Обработка smalltalk с потоковой отправкой ответа LLM.
   */
  private async handleSmalltalkStreaming(
    message: string,
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    const systemPrompt = 'Ты — дружелюбный финансовый директор инвестиционного портфеля. Отвечай кратко (2-3 предложения), естественно, с эмодзи. Если вопрос не про финансы — вежливо перенаправь к портфелю.';

    try {
      const { OllamaClient } = await import('./ollama-client.js');
      const client = new OllamaClient({
        temperature: 0.9,
        maxTokens: 500,
      });

      const fullText = await client.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        onChunk,
      );

      return fullText || 'Привет! Рад помочь с портфелем 💰';
    } catch {
      // Fallback без LLM
      return 'Привет! Готов обсудить твой портфель 💰';
    }
  }

  // ──────────────────────────────────────────────
  // Чат
  // ──────────────────────────────────────────────

  createSession(): DirectorChatSession {
    const session = this.chat.createSession();
    this.currentSessionId = session.sessionId;
    return session;
  }

  getChatHistory(sessionId?: string): ChatMessage[] {
    return this.chat.getHistory(sessionId ?? this.currentSessionId ?? '');
  }

  restoreSession(sessionId: string): DirectorChatSession {
    const session = this.chat.restoreSession(sessionId);
    this.currentSessionId = session.sessionId;
    return session;
  }

  /** События аудит-лога Director (для команд чата и внешних интеграций) */
  getAuditEvents(): DirectorAuditEvent[] {
    return this.audit.getAll();
  }

  /** Добавить системное сообщение в текущую сессию чата */
  addSystemMessage(text: string): ChatMessage {
    const session = this.chat.getOrCreateSession(
      this.currentSessionId ?? undefined,
    );
    return this.chat.appendMessage(session.sessionId, 'system', text);
  }

  // ──────────────────────────────────────────────
  // Память
  // ──────────────────────────────────────────────

  getStrategicMemory(): DirectorStrategicMemory[] {
    return this.memory.getStrategicMemory();
  }

  saveToStrategicMemory(
    entry: Omit<DirectorStrategicMemory, 'id' | 'createdAt' | 'updatedAt'>,
  ): void {
    this.memory.saveStrategicMemoryEntry(entry);
  }

  // ──────────────────────────────────────────────
  // Проактивные сообщения
  // ──────────────────────────────────────────────

  getProactiveMessages(): ProactiveMessage[] {
    return [...this.proactiveMessages];
  }

  createProactiveMessage(
    params: Omit<ProactiveMessage, 'id' | 'createdAt' | 'read'>,
  ): void {
    this.proactiveMessages.push({
      ...params,
      id: 'pm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      createdAt: new Date().toISOString(),
      read: false,
    });
  }

  /** Выполнить проактивное сканирование по текущим фактам и памяти */
  suggestProactive(facts?: DirectorFactsContext): ProactiveMessage[] {
    const suggested = this.proactiveSuggester.suggest({
      facts: facts ?? this.facts,
      strategicMemory: this.memory.getStrategicMemory(),
      userName: this.config.userName ?? 'Радик',
    });
    for (const msg of suggested) {
      this.proactiveMessages.push(msg);
      this.audit.record('director.proactive_message_sent', msg.title, {
        metadata: { type: msg.type, ticker: msg.ticker },
      });
    }
    return suggested;
  }

  /** Предложить пользователю темы для обсуждения (на основе фактов) */
  proposeTopics(facts?: DirectorFactsContext): string[] {
    const topics: string[] = [];
    const source = facts ?? this.facts;

    const concentrated = source.assetsAnalysis.filter(
      (a) => (a.currentPercent ?? 0) > 25,
    );
    if (concentrated.length > 0) {
      topics.push(
        'Пересмотреть структуру портфеля: концентрация по ' +
          concentrated.map((a) => a.ticker).join(', '),
      );
    }
    if (source.freeCashRub > 5000) {
      const deficit = source.assetsAnalysis.filter(
        (a) => (a.deficitRub ?? 0) > 0,
      );
      if (deficit.length > 0) {
        topics.push(
          'Выровнять структуру: докупить ' +
            deficit.map((a) => a.ticker).join(', '),
        );
      }
    }
    const pending = this.memory.getPendingItems();
    if (pending.length > 0) {
      topics.push('Вернуться к отложенным вопросам (' + pending.length + ')');
    }
    return topics;
  }

  // ──────────────────────────────────────────────
  // Остановка
  // ──────────────────────────────────────────────

  async stop(): Promise<void> {
    if (this._state === 'stopped') return;
    this._state = 'stopped';
  }

  // ──────────────────────────────────────────────
  // Системные команды чата
  // ──────────────────────────────────────────────

  /**
   * Обработать системную команду (/status, /log, /undo, /help).
   * Команда НЕ проходит полный цикл делегирования: ответ строится на
   * реально доступных данных (состояние, аудит, история, память).
   */
  private async handleChatCommand(
    command: ChatCommand,
    message: string,
  ): Promise<DirectorResponse> {
    const session = this.chat.getOrCreateSession(
      this.currentSessionId ?? undefined,
    );
    this.currentSessionId = session.sessionId;
    this.chat.appendMessage(session.sessionId, 'user', message);

    const reply = executeChatCommand(
      { kind: 'command', command },
      this.collectCommandSources(),
    );
    const text = reply?.text ?? buildHelpText();

    this.chat.appendMessage(session.sessionId, 'system', text);
    this.audit.record(
      'director.chat_message_sent',
      'Системная команда /' + command.name,
      {
        metadata: { command: command.name, known: command.known },
      },
    );
    this._state = 'idle';

    return {
      text,
      plan: this.emptyPlan('Системная команда /' + command.name),
      connectedAgents: [],
      needsConsilium: false,
    };
  }

  /** Собрать снимок данных для системных команд (честно, из доступного) */
  private collectCommandSources(): ChatCommandSources {
    const history = this.getChatHistory();
    const lastDirectorMessage = [...history]
      .reverse()
      .find((m) => m.role === 'director');
    const events = this.audit.getAll();
    const lastEvent = events[events.length - 1];
    const completedTasks = events.filter(
      (e) => e.type === 'director.synthesis_created',
    ).length;

    return {
      state: this._state,
      chatMessageCount: history.length,
      completedTasks,
      strategicMemoryCount: this.memory.getStrategicMemory().length,
      connectedAgents: lastDirectorMessage?.connectedAgents?.map((role) => ({
        role,
        label: AGENT_ROLE_LABELS[role] ?? role,
      })),
      auditEvents: events,
      lastActionDescription:
        lastEvent?.message ??
        (lastDirectorMessage ? lastDirectorMessage.text.slice(0, 160) : null),
      canUndo: false,
    };
  }

  /** Пустой план для ответов на системные команды */
  private emptyPlan(reason: string): DirectorPlan {
    return {
      taskId:
        'cmd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      userQuestion: reason,
      goal: reason,
      connectedAgents: [],
      agentAssignments: [],
      discussionTopics: [],
      needsConsilium: false,
      directorSynthesis: '',
    };
  }

  // ──────────────────────────────────────────────
  // Извлечённые задачи (TaskExtractor)
  // ──────────────────────────────────────────────

  /**
   * Создать цель автономного цикла из извлечённой задачи (action 'goal').
   * Возвращает ответ Director или null, если goalIntake не подключён/упал.
   */
  private async tryCreateGoal(
    task: ExtractedTask,
    message: string,
  ): Promise<DirectorResponse | null> {
    if (!this.config.goalIntake) return null;
    const session = this.chat.getOrCreateSession(
      this.currentSessionId ?? undefined,
    );
    this.currentSessionId = session.sessionId;
    try {
      const goal = await this.config.goalIntake.addGoal(task.rawText);
      this.chat.appendMessage(this.currentSessionId, 'user', message);
      this.memory.saveConversation('user', message, []);
      const replyText =
        '🎯 Принял как задачу — поставил в план автономного цикла:\n' +
        `«${goal.name}» [${goal.id.slice(0, 8)}]\n\n` +
        'Выполню фоном, итог придёт в чат. Список целей: /goals.';
      this.chat.appendMessage(this.currentSessionId, 'director', replyText);
      this.memory.saveConversation('director', replyText, []);
      this.audit.record('director.goal_created', goal.id);
      this._state = 'idle';
      return {
        text: replyText,
        connectedAgents: [],
        needsConsilium: false,
      };
    } catch (err) {
      this.audit.record(
        'director.goal_created',
        `Ошибка приёма задачи: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Обработать извлечённую задачу: план напрямую (минуя категорийную
   * маршрутизацию) → делегирование action-агентам → ответ.
   */
  private async handleExtractedTask(
    task: ExtractedTask,
    message: string,
  ): Promise<DirectorResponse> {
    const session = this.chat.getOrCreateSession(
      this.currentSessionId ?? undefined,
    );
    this.currentSessionId = session.sessionId;
    const plan = this.planner.buildPlanFromTask(task);
    const question = this.toInterpretedQuestion(task, plan.connectedAgents);
    const agentTasks = this.planner.buildAgentTasksFromTask(task);
    const resolved = resolveTaskAction(task);

    // Входы action-агентов из задачи (если резолвер дал структурированный вход)
    const taskInputs: Partial<Record<AgentRole, unknown>> = {};
    if (resolved.input !== undefined && resolved.input !== null) {
      for (const role of plan.connectedAgents) {
        taskInputs[role] = resolved.input;
      }
    }

    this.audit.record(
      'director.plan_created',
      'Подключены агенты: ' +
        plan.connectedAgents.join(', ') +
        '. Consilium: false',
      { metadata: { agents: plan.connectedAgents } },
    );

    // Сохраняем сообщение пользователя
    this.chat.appendMessage(this.currentSessionId, 'user', message);
    this.memory.saveConversation('user', message, []);

    // Делегирование action-агентам
    this.audit.record(
      'director.task_delegated',
      'Делегирование ' + plan.connectedAgents.length + ' агентам',
      { metadata: { agents: plan.connectedAgents } },
    );
    const activityBefore = this.activity.getRecent().length;
    const agentResults = await this.facade.executeRoles(
      plan.connectedAgents,
      question,
      this.facts,
      taskInputs,
    );
    const activity = this.activity.getRecent().slice(activityBefore);
    for (const r of agentResults) {
      this.audit.record(
        'director.agent_result_received',
        'Результат от ' + r.role + ': ' + (r.success ? 'ok' : 'error'),
        { metadata: { durationMs: r.durationMs } },
      );
    }

    // Рекомендация для action-задачи: действия выполнили агенты
    const recommendation: DirectorTask['recommendation'] = {
      action: null,
      confidence: 0,
      reasoning:
        'Задача выполнена агентами; инвестиционная рекомендация не требуется.',
    };

    // Синтез
    const finalSynthesis = this.synthesize(
      question,
      plan,
      agentResults,
      undefined,
      recommendation,
    );

    // Задача Director
    const taskRecord: DirectorTask = {
      taskId: plan.taskId,
      userQuestion: message,
      interpretedQuestion: question,
      goal: plan.goal,
      status: 'completed',
      agents: agentTasks,
      agentResults,
      needsConsilium: false,
      consiliumRounds: 0,
      finalSynthesis,
      recommendation,
      savedToMemory: false,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    this.audit.record(
      'director.synthesis_created',
      finalSynthesis.slice(0, 150),
      { taskId: taskRecord.taskId },
    );

    // Стратегическая память
    const saved = this.memory.saveTaskOutcome({
      taskId: taskRecord.taskId,
      userQuestion: message,
      tickers: [],
      action: recommendation.action,
      confidence: recommendation.confidence,
      reasoning: recommendation.reasoning,
    });
    taskRecord.savedToMemory = true;
    this.audit.record(
      'director.memory_saved',
      'Решение сохранено: ' + saved.id,
      { taskId: taskRecord.taskId },
    );

    // Ответ
    const replyText = this.buildActionTaskReply(task, plan, agentResults);
    this.chat.appendMessage(this.currentSessionId, 'director', replyText, {
      taskId: taskRecord.taskId,
      connectedAgents: plan.connectedAgents,
      isWorking: false,
    });
    this.memory.saveConversation('director', replyText, []);
    this.dialogue.pushDirector(replyText);
    this.audit.record(
      'director.chat_message_sent',
      'Ответ Director отправлен',
      { taskId: taskRecord.taskId },
    );

    this.lastActiveTask = taskRecord;
    this._state = 'idle';

    return {
      text: replyText,
      task: taskRecord,
      plan,
      connectedAgents: plan.connectedAgents,
      needsConsilium: false,
      recommendation,
      activity,
      news: this.newsImpacts,
    };
  }

  /** Построить InterpretedQuestion из извлечённой задачи (для фасада) */
  private toInterpretedQuestion(
    task: ExtractedTask,
    roles: AgentRole[],
  ): InterpretedQuestion {
    return {
      category: 'general',
      tickers: [],
      topic: task.target || task.rawText,
      text: task.rawText,
      requiredAgents: roles,
      needsConsilium: false,
      complexity: 1,
      intent: 'decide-action',
    };
  }

  /** Человеческий ответ на action-задачу (результаты агентов) */
  private buildActionTaskReply(
    task: ExtractedTask,
    plan: DirectorPlan,
    agentResults: AgentResultEntry[],
  ): string {
    const lines: string[] = [];
    lines.push(
      this.randomFrom(
        this.getIntroductions(
          this.toInterpretedQuestion(task, plan.connectedAgents),
        ),
      ),
    );

    const actionSummaries = agentResults
      .filter(
        (entry) =>
          entry.success &&
          (entry.role === 'file' ||
            entry.role === 'terminal' ||
            entry.role === 'process' ||
            entry.role === 'automation' ||
            entry.role === 'code'),
      )
      .map(
        (entry) =>
          (entry.data as unknown as DirectorAgentPayload | undefined)?.summary,
      )
      .filter((summary): summary is string => Boolean(summary));

    if (actionSummaries.length > 0) {
      lines.push('');
      lines.push('Выполненные действия:');
      for (const summary of actionSummaries) {
        lines.push('• ' + summary);
      }
    } else {
      const failed = agentResults.filter((entry) => !entry.success);
      if (failed.length > 0) {
        lines.push('');
        lines.push('Не удалось выполнить задачу:');
        for (const entry of failed) {
          const payload = entry.data as unknown as
            DirectorAgentPayload | undefined;
          lines.push(
            '• ' + (payload?.summary ?? `Агент «${entry.role}» не выполнен`),
          );
        }
      } else {
        lines.push('');
        lines.push('Задача принята, агенты подключены.');
      }
    }

    lines.push('');
    lines.push(
      'Все операции выполняются через SecurityAgent и не выходят за пределы разрешённых корней проекта.',
    );
    return lines.join('\n');
  }

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  private isFollowUp(interpreted: InterpretedQuestion): boolean {
    if (interpreted.category === 'scenario') return true;
    const lower = interpreted.text.toLowerCase();
    return FOLLOW_UP_PREFIXES.some((p) => lower.startsWith(p));
  }

  /**
   * Мгновенная сводка «как дела» без LLM: состояние Директора,
   * краткие факты портфеля, лидер/аутсайдер и подсказки по командам.
   */
  private buildStatusDigest(): string {
    const stateText =
      this._state === 'running'
        ? 'сейчас работаю над вашей задачей'
        : 'свободен и жду указаний';
    const lines: string[] = [`Всё под контролем: ${stateText}.`];

    const assets = this.facts.assetsAnalysis;
    if (assets.length > 0) {
      const rub = (value: number): string =>
        Math.round(value).toLocaleString('ru-RU');
      lines.push(
        `Портфель: ${assets.length} актив(ов), стоимость ` +
          `${rub(this.facts.totalPortfolioValue)} ₽, свободные средства ` +
          `${rub(this.facts.freeCashRub)} ₽.`,
      );
      const byProfit = [...assets].sort(
        (a, b) => (b.unrealizedProfitRub ?? 0) - (a.unrealizedProfitRub ?? 0),
      );
      const best = byProfit[0];
      const worst = byProfit[byProfit.length - 1];
      if (
        best &&
        worst &&
        best.ticker !== worst.ticker &&
        (best.unrealizedProfitRub ?? 0) !== (worst.unrealizedProfitRub ?? 0)
      ) {
        lines.push(
          `Лидер: ${best.ticker} (+${rub(best.unrealizedProfitRub ?? 0)} ₽), ` +
            `аутсайдер: ${worst.ticker} (${rub(worst.unrealizedProfitRub ?? 0)} ₽).`,
        );
      }
    } else {
      lines.push(
        'Данные портфеля ещё не загружены — откройте Excel с портфелем, ' +
          'и я подключу полный анализ.',
      );
    }

    lines.push('Подробная сводка — команда /status, все команды — /help.');
    return lines.join('\n');
  }

  /**
   * Честный ответ на свободный (общий) вопрос без LLM.
   * Строится по фактам портфеля (доли, цель, P&L, концентрация), а не
   * фиксированной фразой «спросите про актив».
   */
  private buildGeneralFallback(question: string, historyText: string): string {
    const response = buildBrowserChatResponse({
      question,
      facts: this.facts,
      history: historyText,
    });
    if (response) return response;
    // Крайний случай: responder не распознал вопрос — короткая честная реплика
    const templates = [
      'Пока я не смог распознать этот вопрос как запрос по портфелю.\n\n' +
        'Попробуйте спросить иначе: «Что с SBER?», «Как выглядит портфель?», ' +
        '«Есть ли риски?», «Новости» или «Стратегия».',
      'Этот вопрос не совсем про мой портфель. Но я могу обсудить:\n\n' +
        '«Что с SBER?», «Как выглядит портфель?», ' +
        '«Есть ли риски?», «Новости» или «Стратегия».',
      'Я не уверен, что правильно понял ваш запрос.\n\n' +
        'Мои сильные темы: «Что с SBER?», «Как выглядит портфель?», ' +
        '«Есть ли риски?», «Новости» или «Стратегия».',
    ];
    return this.randomFrom(templates);
  }

  /**
   * Новостной контекст для LLM (NewsDriver.buildNewsContext).
   * Пустая строка, если новостной фон не подключён/нейтрален.
   */
  private buildLlmContext(): string {
    if (this.newsImpacts.length === 0) return '';
    return this.newsDriver.buildNewsContext(this.newsImpacts);
  }

  /**
   * Факты портфеля, обогащённые новостным контекстом (для LLM).
   * Оригинальные факты НЕ мутируются — возвращается копия.
   */
  private factsWithNewsContext(): DirectorFactsContext {
    const newsContext = this.buildLlmContext();
    if (!newsContext) return this.facts;
    return { ...this.facts, newsContext };
  }

  /** Синтез: короткое резюме пути решения */
  private synthesize(
    question: InterpretedQuestion,
    plan: DirectorPlan,
    agentResults: AgentResultEntry[],
    consilium: MultiRoundConsiliumOutput | undefined,
    recommendation: DirectorTask['recommendation'],
  ): string {
    const okCount = agentResults.filter((r) => r.success).length;
    const totalAgents = plan.agentAssignments.length;
    const actionText = actionLabel(recommendation.action);
    const confPct = Math.round(recommendation.confidence * 100);

    // Пулы шаблонов синтеза
    const agentTemplates = [
      `Подключено агентов: ${okCount}/${totalAgents}.`,
      `Задействованы агенты: ${okCount} из ${totalAgents} успешно.`,
      `Работали ${okCount} из ${totalAgents} агентов.`,
      `Агентов успешно: ${okCount}/${totalAgents}.`,
    ];

    const questionTemplates = [
      `Вопрос: ${question.text}. Цель: ${plan.goal}.`,
      `Запрос: ${question.text}. Задача: ${plan.goal}.`,
      `Тема: ${question.text}. Фокус: ${plan.goal}.`,
    ];

    const consiliumTemplates = consilium
      ? [
          `Consilium: ${consilium.rounds.length} раунд(а), итог «${consilium.finalRecommendation.action}».`,
          `Консилиум провёл ${consilium.rounds.length} раунд(а) — решение: «${consilium.finalRecommendation.action}».`,
          `После ${consilium.rounds.length} раунда(ов) Consilium: «${consilium.finalRecommendation.action}».`,
        ]
      : [];

    const recTemplates = [
      `Рекомендация: ${actionText} (${confPct}%).`,
      `Итог: ${actionText} с уверенностью ${confPct}%.`,
      `Решение: ${actionText} (${confPct}%).`,
    ];

    const parts: string[] = [];
    parts.push(this.randomFrom(questionTemplates));
    parts.push(this.randomFrom(agentTemplates));

    if (consilium && consiliumTemplates.length > 0) {
      parts.push(this.randomFrom(consiliumTemplates));
    }

    parts.push(this.randomFrom(recTemplates));

    return parts.join(' ');
  }

  /** Человеческий ответ пользователю */
  private buildReply(
    question: InterpretedQuestion,
    plan: DirectorPlan,
    recommendation: DirectorTask['recommendation'],
    consilium: MultiRoundConsiliumOutput | undefined,
    followUps: string[],
    agentResults: AgentResultEntry[],
  ): string {
    const lines: string[] = [];

    // Случайное вступление из пула
    const intro = this.randomFrom(this.getIntroductions(question));
    lines.push(intro);

    if (this.config.includeAgentDetails ?? true) {
      lines.push('');
      lines.push(
        'Для ответа я подключил: ' +
          plan.connectedAgents.map((r) => AGENT_ROLE_LABELS[r]).join(', ') +
          '.',
      );
    }

    if (consilium) {
      lines.push('');
      lines.push(
        'Вопрос оказался сложным, поэтому я созвал консилиум: проведено ' +
          consilium.rounds.length +
          ' раунд(а) обсуждения между агентами.',
      );
      if (consilium.pointsOfAgreement.length > 0) {
        lines.push(
          'Точки согласия: ' +
            consilium.pointsOfAgreement.slice(0, 2).join('; ') +
            '.',
        );
      }
      if (consilium.pointsOfDisagreement.length > 0) {
        lines.push(
          'Разногласия: ' +
            consilium.pointsOfDisagreement.slice(0, 2).join('; ') +
            '.',
        );
      }
    }

    // Действия action-агентов (file/terminal): результат должен дойти до
    // пользователя человекочитаемо («Файл создан», «доступно в десктопном
    // режиме», «Операция отклонена»...)
    const actionSummaries = agentResults
      .filter(
        (entry) =>
          entry.success &&
          (entry.role === 'file' ||
            entry.role === 'terminal' ||
            entry.role === 'process' ||
            entry.role === 'automation' ||
            entry.role === 'code'),
      )
      .map(
        (entry) =>
          (entry.data as unknown as DirectorAgentPayload | undefined)?.summary,
      )
      .filter((summary): summary is string => Boolean(summary));

    if (actionSummaries.length > 0) {
      lines.push('');
      lines.push('Выполненные действия:');
      for (const summary of actionSummaries) {
        lines.push('• ' + summary);
      }
    }

    lines.push('');
    const recLabel = actionLabel(recommendation.action);
    // Если тикеры не указаны в вопросе, но рекомендация упоминает актив —
    // показываем его (например, «сократить по PLZL» вместо «сократить»).
    let recTickers = question.tickers;
    if (recTickers.length === 0) {
      const mentioned = this.facts.assetsAnalysis.find((a) =>
        recommendation.reasoning.includes(a.ticker),
      );
      if (mentioned) recTickers = [mentioned.ticker];
    }
    lines.push(
      'Моя рекомендация: ' +
        recLabel +
        (recTickers.length > 0 ? ' по ' + recTickers.join(', ') : '') +
        ' (уверенность ' +
        Math.round(recommendation.confidence * 100) +
        '%).',
    );
    lines.push(recommendation.reasoning.slice(0, 400));

    // Новостной фон (NewsDriver): сентимент, важность, влияние на позицию
    const relevantImpacts = this.newsImpacts.filter(
      (i) =>
        question.tickers.length === 0 ||
        question.tickers.some(
          (t) => t.toUpperCase() === i.ticker.toUpperCase(),
        ),
    );
    if (relevantImpacts.length > 0) {
      lines.push('');
      lines.push('📰 Новостной фон:');
      for (const impact of relevantImpacts.slice(0, 3)) {
        const directionLabel =
          impact.impactDirection === 'positive'
            ? 'позитивный'
            : impact.impactDirection === 'negative'
              ? 'негативный'
              : 'нейтральный';
        lines.push(
          `• ${impact.ticker}: ${directionLabel} ` +
            `(сентимент ${impact.sentimentScore.toFixed(2)}, важность «${impact.importance}»). ` +
            impact.reasoning,
        );
      }
    }

    // Случайное заключение из пула
    const outro = this.randomFrom(this.getOutros());
    lines.push('');
    lines.push(outro);
    lines.push('Факты портфеля (цены, доли, P&L) при этом не изменяются.');

    if (followUps.length > 0) {
      lines.push('');
      lines.push('Можно продолжить обсуждение:');
      for (const f of followUps) {
        lines.push('• ' + f);
      }
    }

    return lines.join('\n');
  }

  /** Случайный элемент из массива */
  private randomFrom<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('randomFrom: массив пуст');
    }
    return arr[Math.floor(this.random() * arr.length)]!;
  }

  /** Пул вступлений к ответу */
  private getIntroductions(question: InterpretedQuestion): string[] {
    const base = 'Я понял ваш вопрос: «' + question.text + '».';
    const context = question.contextReference
      ? ' Продолжаем обсуждение: ' + question.contextReference + '.'
      : '';

    return [
      base + context,
      'Разбираю ваш запрос: «' + question.text + '».' + context,
      'Анализирую вопрос: «' + question.text + '».' + context,
      'Принял ваш вопрос: «' + question.text + '».' + context,
      'Ваш вопрос: «' + question.text + '». Давайте разберём.' + context,
    ];
  }

  /** Пул заключений (про рекомендацию ≠ операция) */
  private getOutros(): string[] {
    return [
      'Это рекомендация, а не совершённая операция: исполнение остаётся ' +
        'отдельным этапом и произойдёт только после вашего подтверждения.',
      'Важно: это совет, а не торговая команда. Решение за вами — ' +
        'я только помогаю проанализировать.',
      'Помните: это аналитическая рекомендация, а не готовый ордер. ' +
        'Финальное решение принимаете вы.',
      'Я даю рекомендацию на основе доступных данных, но окончательное ' +
        'решение — за вами.',
    ];
  }

  /** Предложить follow-up задачи по итогам обсуждения */
  private buildFollowUps(
    question: InterpretedQuestion,
    recommendation: DirectorTask['recommendation'],
  ): string[] {
    const result: string[] = [];
    const tickers = question.tickers;
    // Обобщённый subject: если тикеры не указаны — «позиции»,
    // чтобы follow-up не выглядели как «Определить целевую долю для ».
    const subject = tickers.length > 0 ? tickers.join(', ') : 'позиции';

    // Пулы follow-up для каждого action
    const followUpPools: Record<string, string[]> = {
      SELL: [
        'Спланировать поэтапное сокращение ' + subject,
        'Определить оптимальный объём продажи ' + subject,
        'Рассчитать налоговые последствия продажи ' + subject,
        'Подготовить план выхода из ' + subject,
      ],
      REDUCE: [
        'Спланировать поэтапное сокращение ' + subject,
        'Определить целевую долю для ' + subject,
        'Рассчитать оптимальный объём сокращения ' + subject,
      ],
      BUY: [
        'Определить точную сумму покупки ' +
          subject +
          ' в пределах свободных средств',
        'Составить план накопления ' + subject,
        'Рассчитать оптимальную дату и объём покупки ' + subject,
        'Проверить исторические точки входа по ' + subject,
      ],
      HOLD: [
        'Проверить фундаментал и рынок по ' +
          subject +
          ' в следующем цикле исследования',
        'Определить триггеры для пересмотра позиции по ' + subject,
        'Сравнить текущую стратегию удержания с альтернативами',
      ],
      EXIT: [
        'Подготовить полный план выхода из ' + subject,
        'Оценить последствия полного выхода из ' + subject,
      ],
      AVOID: [
        'Сформировать критерии для повторного рассмотрения ' + subject,
        'Определить условия, при которых ' +
          subject +
          ' станет привлекательным',
      ],
      AVERAGE: [
        'Спланировать стратегию усреднения по ' + subject,
        'Рассчитать точку усреднения для ' + subject,
      ],
    };

    const actionKey = recommendation.action ?? 'HOLD';
    const pool = followUpPools[actionKey] ?? followUpPools.HOLD;
    const shown = this.getRecentlyShownFollowUps();
    const available = pool!.filter((f) => !shown.includes(f));
    const shuffled = available.sort(() => this.random() - 0.5);
    const selected = shuffled.slice(0, 2);

    if (selected.length > 0) {
      result.push(...selected);
      this.recordShownFollowUps(selected);
    }

    if (question.category === 'strategy' || question.category === 'plan') {
      result.push('Составить план действий на ближайший месяц');
    }

    if (result.length === 0) {
      result.push('Продолжить анализ других активов портфеля');
    }

    return result.slice(0, 3);
  }

  /** Недавно показанные follow-up (для исключения повторов) */
  private recentlyShownFollowUps: string[] = [];

  private getRecentlyShownFollowUps(): string[] {
    return [...this.recentlyShownFollowUps];
  }

  private recordShownFollowUps(followUps: string[]): void {
    this.recentlyShownFollowUps = [
      ...this.recentlyShownFollowUps.slice(-5),
      ...followUps,
    ].slice(-10); // Храним последние 10
  }
}

// ──────────────────────────────────────────────
// Утилиты
// ──────────────────────────────────────────────

/** Извлечь мнения агентов из результатов */
function extractOpinions(results: AgentResultEntry[]): AgentOpinion[] {
  const opinions: AgentOpinion[] = [];
  for (const result of results) {
    if (!result.success || !result.data) continue;
    const payload = result.data as unknown as DirectorAgentPayload;
    if (payload.opinion) {
      opinions.push(payload.opinion);
    }
  }
  return opinions;
}

/** Выбрать наиболее убедительное мнение (без Consilium) */
function pickBestOpinion(opinions: AgentOpinion[]): AgentOpinion | null {
  if (opinions.length === 0) return null;
  const withAction = opinions.filter((o) => o.action !== null);
  const pool = withAction.length > 0 ? withAction : opinions;
  return [...pool].sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}
