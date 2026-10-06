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
import { parseUserMessage } from './nl-parser.js';
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
import { DirectorAuditLog } from './director-audit.js';
import { DirectorChatStore } from './chat-session.js';
import { ProactiveSuggester } from './proactive-suggester.js';
import { runMultiRoundConsilium } from './multi-round-consilium.js';
import type {
  AgentOpinion,
  AgentResultEntry,
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
}

/** Пустые факты по умолчанию */
function emptyFacts(): DirectorFactsContext {
  return {
    assetsAnalysis: [],
    totalPortfolioValue: 0,
    freeCashRub: 0,
  };
}

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

  private facts: DirectorFactsContext;
  private currentSessionId: string | null = null;
  private lastActiveTask: DirectorTask | null = null;
  private proactiveMessages: ProactiveMessage[] = [];

  constructor(deps?: DirectorAgentDeps, config?: DirectorConfig) {
    this.config = config ?? {};
    this.planner =
      deps?.planner ??
      new DirectorDelegationPlanner({
        maxAgents: this.config.maxAgentsPerTask ?? 0,
        consiliumThreshold: this.config.consiliumComplexityThreshold ?? 3,
      });
    this.facade = deps?.facade ?? new DirectorAgentFacade();
    this.memory = deps?.memory ?? new DirectorMemoryStore();
    this.chat = deps?.chat ?? new DirectorChatStore();
    this.audit = deps?.audit ?? new DirectorAuditLog();
    this.proactiveSuggester = deps?.proactive ?? new ProactiveSuggester();
    this.facts = deps?.initialFacts ?? emptyFacts();
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

    // 0. Системные команды чата (/status, /log, /undo, /help)
    const parsed = parseChatInput(message);
    if (parsed.kind === 'command') {
      return this.handleChatCommand(parsed.command, message);
    }

    // 1. Интерпретация вопроса
    let interpreted = parseUserMessage(message);
    this.audit.record('director.question_received', message);

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
    const agentResults = await this.facade.executeRoles(
      plan.connectedAgents,
      interpreted,
      this.facts,
    );
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
    };
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
  // Helpers
  // ──────────────────────────────────────────────

  private isFollowUp(interpreted: InterpretedQuestion): boolean {
    if (interpreted.category === 'scenario') return true;
    const lower = interpreted.text.toLowerCase();
    return FOLLOW_UP_PREFIXES.some((p) => lower.startsWith(p));
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
    const parts: string[] = [];
    parts.push('Вопрос: ' + question.text + '. Цель: ' + plan.goal + '.');
    parts.push(
      'Подключено агентов: ' +
        okCount +
        '/' +
        plan.agentAssignments.length +
        '.',
    );
    if (consilium) {
      parts.push(
        'Consilium: ' +
          consilium.rounds.length +
          ' раунд(а), итог «' +
          consilium.finalRecommendation.action +
          '».',
      );
    }
    parts.push(
      'Рекомендация: ' +
        actionLabel(recommendation.action) +
        ' (' +
        Math.round(recommendation.confidence * 100) +
        '%).',
    );
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

    lines.push(
      'Я понял ваш вопрос: «' +
        question.text +
        '».' +
        (question.contextReference
          ? ' Продолжаем обсуждение: ' + question.contextReference + '.'
          : ''),
    );

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
          entry.success && (entry.role === 'file' || entry.role === 'terminal'),
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
    lines.push(
      'Моя рекомендация: ' +
        recLabel +
        (question.tickers.length > 0
          ? ' по ' + question.tickers.join(', ')
          : '') +
        ' (уверенность ' +
        Math.round(recommendation.confidence * 100) +
        '%).',
    );
    lines.push(recommendation.reasoning.slice(0, 400));

    lines.push('');
    lines.push(
      'Это рекомендация, а не совершённая операция: исполнение остаётся ' +
        'отдельным этапом и произойдёт только после вашего подтверждения.',
    );
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

  /** Предложить follow-up задачи по итогам обсуждения */
  private buildFollowUps(
    question: InterpretedQuestion,
    recommendation: DirectorTask['recommendation'],
  ): string[] {
    const result: string[] = [];
    const tickers = question.tickers;

    if (tickers.length > 0 && recommendation.action !== null) {
      if (
        recommendation.action === 'REDUCE' ||
        recommendation.action === 'SELL'
      ) {
        result.push('Спланировать поэтапное сокращение ' + tickers.join(', '));
      } else if (recommendation.action === 'BUY') {
        result.push(
          'Определить точную сумму покупки ' +
            tickers.join(', ') +
            ' в пределах свободных средств',
        );
      } else {
        result.push(
          'Проверить фундаментал и рынок по ' +
            tickers.join(', ') +
            ' в следующем цикле исследования',
        );
      }
    }

    if (question.category === 'strategy' || question.category === 'plan') {
      result.push('Составить план действий на ближайший месяц');
    }

    if (result.length === 0) {
      result.push('Продолжить анализ других активов портфеля');
    }

    return result.slice(0, 3);
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
