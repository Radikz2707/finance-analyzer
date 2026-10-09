/**
 * Director Agent — типы и интерфейсы.
 *
 * Director — главный интеллектуальный координатор инвестиционной системы.
 * Это НЕ простой chatbot и НЕ ещё один аналитик акций.
 * Director понимает контекст, формулирует вопросы, делегирует агентам,
 * организует многораундовый Consilium, формирует стратегический вывод.
 */

import type { AiAction } from '../../research/types.js';
import type { AgentState } from '../agent/types.js';

// ──────────────────────────────────────────────
// 1. Типы вопросов пользователя
// ──────────────────────────────────────────────

/** Категория вопроса пользователя */
export type UserQuestionCategory =
  | 'asset' // Вопрос по одному активу
  | 'portfolio' // Вопрос по портфелю
  | 'comparison' // Сравнение активов
  | 'scenario' // Сценарный вопрос
  | 'market' // Вопрос по рынку
  | 'news' // Вопрос по новости
  | 'strategy' // Вопрос по стратегии
  | 'plan' // Вопрос по будущему плану
  | 'past-decision' // Вопрос о прошлых решениях
  | 'system-quality' // Вопрос о качестве работы AI-системы
  | 'general'; // Общий вопрос

/** Интерпретированный вопрос пользователя */
export interface InterpretedQuestion {
  /** Категория вопроса */
  category: UserQuestionCategory;
  /** Тикеры, упомянутые в вопросе */
  tickers: string[];
  /** Название вопроса/темы */
  topic: string;
  /** Полное содержание вопроса */
  text: string;
  /** Какие агенты нужны для ответа */
  requiredAgents: AgentRole[];
  /** Нужен ли Consilium */
  needsConsilium: boolean;
  /** Сложность вопроса (1-5) */
  complexity: number;
  /** Контекст предыдущего разговора (если есть) */
  contextReference?: string;
  /** Интенция пользователя */
  intent: UserIntent;
}

/** Интенция пользователя */
export type UserIntent =
  | 'understand' // Понять ситуацию
  | 'decide-action' // Принять решение о действии
  | 'compare-options' // Сравнить варианты
  | 'explore-scenario' // Исследовать сценарий
  | 'review-past' // Пересмотреть прошлое
  | 'plan-future' // Запланировать будущее
  | 'critique-system' // Критиковать систему
  | 'general-inquiry'; // Общий запрос

// ──────────────────────────────────────────────
// 2. Роли агентов
// ──────────────────────────────────────────────

/** Роль агента в системе Director */
export type AgentRole =
  | 'ai' // AI Agent — основной инвестиционный reasoning
  | 'research' // ResearchAgent — факты, фундаментал, новости
  | 'strategist' // StrategistAgent — стратегический анализ и риски
  | 'scenario' // ScenarioAgent — «что если»
  | 'review' // ReviewAgent — проверка качества решений
  | 'analysis' // AnalysisAgent — детерминированный анализ портфеля
  | 'file' // FileAgent — файловые операции (чтение/запись/поиск)
  | 'terminal' // TerminalAgent — безопасное выполнение команд
  | 'process' // ProcessAgent — запуск/остановка/перезапуск процессов
  | 'automation' // AutomationAgent — workflow-автоматизация задач
  | 'code'; // CodingWorkflow — конвейер разработки: write → test → repair → report

/** Описание задачи для агента */
export interface AgentTask {
  /** Уникальный ID задачи */
  taskId: string;
  /** Роль агента */
  role: AgentRole;
  /** Описание задачи */
  description: string;
  /** Входные данные */
  inputData: Record<string, unknown>;
  /** Какие данные ожидаются в результате */
  expectedOutput: string[];
  /** Приоритет задачи */
  priority: 'high' | 'normal' | 'low';
  /** Нужен ли результат для Consilium */
  forConsilium: boolean;
}

// ──────────────────────────────────────────────
// 3. Director Task / Plan
// ──────────────────────────────────────────────

/** Статус задачи Director */
export type DirectorTaskStatus =
  | 'pending'
  | 'delegating'
  | 'running'
  | 'collecting'
  | 'consilium'
  | 'synthesizing'
  | 'completed'
  | 'cancelled'
  | 'failed';

/** Результат работы одного агента в рамках задачи Director */
export interface AgentResultEntry {
  /** Роль агента */
  role: AgentRole;
  /** Уникальный ID задачи */
  taskId: string;
  /** Успешно ли выполнен */
  success: boolean;
  /** Данные результата */
  data?: Record<string, unknown>;
  /** Ошибка */
  error?: string;
  /** Время выполнения */
  durationMs: number;
  /** Метка времени */
  completedAt: string;
}

/** Раунд многораундового Consilium */
export interface ConsiliumRound {
  /** Номер раунда */
  roundNumber: number;
  /** Тип раунда */
  roundType: 'initial' | 'response' | 'rebuttal' | 'final';
  /** Мнения агентов */
  agentOpinions: Array<{
    role: AgentRole;
    position: string;
    action: AiAction | null;
    confidence: number; // 0-1
    arguments: string[];
    counterArguments?: string[];
    agreedWith?: string[]; // роли, с которыми согласен
    disagreedWith?: string[]; // роли, с которыми не согласен
  }>;
  /** Точки согласия */
  pointsOfAgreement: string[];
  /** Точки разногласия */
  pointsOfDisagreement: string[];
  /** Изменённые позиции (если были) */
  positionChanges: Array<{
    role: AgentRole;
    previousAction: AiAction | null;
    newAction: AiAction | null;
    reason: string;
  }>;
}

/** Результат многораундового Consilium */
export interface MultiRoundConsiliumOutput {
  /** Все раунды */
  rounds: ConsiliumRound[];
  /** Ключевые аргументы */
  keyArguments: string[];
  /** Контраргументы */
  counterArguments: string[];
  /** Точки согласия */
  pointsOfAgreement: string[];
  /** Точки разногласия */
  pointsOfDisagreement: string[];
  /** Итоговая рекомендация */
  finalRecommendation: {
    action: AiAction;
    confidence: number; // 0-1
    reasoning: string;
  };
  /** Почему Director принимает/не принимает вывод */
  directorReasoning: string;
  /** Степень уверенности Director */
  directorConfidence: number; // 0-1
}

/** Задача Director */
export interface DirectorTask {
  /** Уникальный ID задачи */
  taskId: string;
  /** Исходный вопрос пользователя */
  userQuestion: string;
  /** Интерпретированный вопрос */
  interpretedQuestion: InterpretedQuestion;
  /** Цель задачи */
  goal: string;
  /** Статус */
  status: DirectorTaskStatus;
  /** Назначенные агенты */
  agents: AgentTask[];
  /** Результаты агентов */
  agentResults: AgentResultEntry[];
  /** Нужен ли Consilium */
  needsConsilium: boolean;
  /** Многораундовый Consilium (если нужен) */
  consilium?: MultiRoundConsiliumOutput;
  /** Номер раунда Consilium */
  consiliumRounds: number;
  /** Итоговый вывод Director */
  finalSynthesis: string;
  /** Рекомендация Director */
  recommendation: {
    action: AiAction | null;
    confidence: number;
    reasoning: string;
  };
  /** Сохранено ли в память */
  savedToMemory: boolean;
  /** Метки времени */
  createdAt: string;
  completedAt?: string;
}

/** План задачи Director */
export interface DirectorPlan {
  /** ID задачи */
  taskId: string;
  /** Исходный вопрос */
  userQuestion: string;
  /** Цель */
  goal: string;
  /** Какие агенты подключены */
  connectedAgents: AgentRole[];
  /** Задачи для каждого агента */
  agentAssignments: Array<{
    role: AgentRole;
    task: string;
    inputData: string;
    /** Почему Director подключает этого агента (явное обоснование) */
    rationale: string;
  }>;
  /** Какие вопросы требуют обсуждения */
  discussionTopics: string[];
  /** Нужен ли Consilium */
  needsConsilium: boolean;
  /** Итоговый вывод Director */
  directorSynthesis: string;
}

// ──────────────────────────────────────────────
// 4. Стратегическая память Director
// ──────────────────────────────────────────────

/** Тип записи стратегической памяти Director */
export type StrategicMemoryType =
  | 'user-goal' // Важная пользовательская цель
  | 'strategic-decision' // Принятое стратегическое решение
  | 'pending-decision' // Отложенное решение
  | 'observed-asset' // Наблюдаемый актив
  | 'active-thesis' // Активный инвестиционный тезис
  | 'unresolved-question' // Нерешённый вопрос
  | 'future-task' // Будущая задача
  | 'agreement' // Договорённость с пользователем
  | 'consilium-result' // Результат Consilium
  | 'past-mistake' // Ошибка прошлых решений
  | 'system-insight'; // Инсайт о работе системы

/** Запись стратегической памяти Director */
export interface DirectorStrategicMemory {
  /** Уникальный ID */
  id: string;
  /** Тип записи */
  type: StrategicMemoryType;
  /** Тикер (если применимо) */
  ticker?: string;
  /** Содержание */
  content: string;
  /** Причина (почему запись создана) */
  reason: string;
  /** Статус (active / resolved / archived) */
  status: 'active' | 'resolved' | 'archived';
  /** Приоритет */
  priority: 'critical' | 'high' | 'normal' | 'low';
  /** Создана */
  createdAt: string;
  /** Обновлена */
  updatedAt: string;
  /** Решена */
  resolvedAt?: string;
}

// ──────────────────────────────────────────────
// 5. Промпты
// ──────────────────────────────────────────────

/** Тип проактивного сообщения */
export type ProactiveMessageType =
  | 'market-change' // Существенное изменение рынка
  | 'important-news' // Важная новость по активу
  | 'thesis-change' // Изменение инвестиционного тезиса
  | 'structure-deviation' // Сильное отклонение структуры
  | 'new-risk' // Новый риск
  | 'opportunity' // Возможность для пересмотра позиции
  | 'pending-review' // Необходимость проверить отложенный вопрос
  | 'contradiction' // Обнаружено противоречие между решениями
  | 'new-topic'; // Новая тема для обсуждения

/** Промптное сообщение Director */
export interface ProactiveMessage {
  /** Уникальный ID */
  id: string;
  /** Тип сообщения */
  type: ProactiveMessageType;
  /** Заголовок (короткий) */
  title: string;
  /** Содержание */
  content: string;
  /** Тикер (если применимо) */
  ticker?: string;
  /** Приоритет */
  priority: 'high' | 'normal' | 'low';
  /** Создана */
  createdAt: string;
  /** Прочитана пользователем */
  read: boolean;
}

// ──────────────────────────────────────────────
// 6. Чат Director
// ──────────────────────────────────────────────

/** Роль сообщения в чате Director */
export type ChatMessageRole = 'user' | 'director' | 'system';

/** Сообщение чата Director */
export interface ChatMessage {
  /** Уникальный ID */
  id: string;
  /** Роль отправителя */
  role: ChatMessageRole;
  /** Текст сообщения */
  text: string;
  /** Связанная задача Director (если есть) */
  taskId?: string;
  /** Подключённые агенты (для сообщений Director) */
  connectedAgents?: AgentRole[];
  /** Индикатор работы Director */
  isWorking: boolean;
  /** Метка времени */
  timestamp: string;
}

/** Сессия чата Director */
export interface DirectorChatSession {
  /** Уникальный ID сессии */
  sessionId: string;
  /** История сообщений */
  messages: ChatMessage[];
  /** Текущая задача Director (если есть) */
  activeTaskId?: string;
  /** Контекст предыдущих разговоров */
  context: string;
  /** Создана */
  createdAt: string;
  /** Последняя активность */
  lastActivityAt: string;
}

// ──────────────────────────────────────────────
// 7. Audit Log Director
// ──────────────────────────────────────────────

/** Тип события audit Director */
export type DirectorAuditEventType =
  | 'director.question_received'
  | 'director.question_interpreted'
  | 'director.plan_created'
  | 'director.task_delegated'
  | 'director.agent_result_received'
  | 'director.consilium_started'
  | 'director.consilium_round_completed'
  | 'director.consilium_completed'
  | 'director.synthesis_created'
  | 'director.recommendation_formed'
  | 'director.memory_saved'
  | 'director.proactive_message_sent'
  | 'director.chat_message_sent'
  | 'director.greeting_answered';

/** Событие audit Director */
export interface DirectorAuditEvent {
  /** Уникальный ID */
  id: string;
  /** Метка времени */
  timestamp: string;
  /** Тип события */
  type: DirectorAuditEventType;
  /** ID задачи Director */
  taskId?: string;
  /** Актор */
  actor: 'director' | string;
  /** Описание */
  message: string;
  /** Метаданные */
  metadata: Record<string, unknown>;
  /** Полный путь решения (trace) */
  trace?: {
    userQuestion: string;
    directorInterpretation: string;
    delegatedTasks: string[];
    agentResultsSummary: string;
    consiliumRounds: number;
    directorSynthesis: string;
    finalRecommendation: string;
  };
}

// ──────────────────────────────────────────────
// 8. Director Agent Interface
// ──────────────────────────────────────────────

/** Интерфейс Director Agent */
export interface IDirectorAgent {
  /** Имя */
  readonly name: string;
  /** Состояние */
  readonly state: AgentState;
  /** Текущая сессия чата */
  readonly currentSession: DirectorChatSession | null;

  /** Обработать сообщение пользователя */
  processUserMessage(message: string): Promise<DirectorResponse>;

  /** Получить историю чата */
  getChatHistory(sessionId?: string): ChatMessage[];

  /** Создать новую сессию чата */
  createSession(): DirectorChatSession;

  /** Получить стратегическую память */
  getStrategicMemory(): DirectorStrategicMemory[];

  /** Добавить запись в стратегическую память */
  saveToStrategicMemory(
    entry: Omit<DirectorStrategicMemory, 'id' | 'createdAt' | 'updatedAt'>,
  ): void;

  /** Получить проактивные сообщения */
  getProactiveMessages(): ProactiveMessage[];

  /** Создать проактивное сообщение */
  createProactiveMessage(
    params: Omit<ProactiveMessage, 'id' | 'createdAt' | 'read'>,
  ): void;

  /** Остановить Director */
  stop(): Promise<void>;
}

/** Ответ Director */
export interface DirectorResponse {
  /** Текст ответа */
  text: string;
  /** Задача Director (если создана) */
  task?: DirectorTask;
  /** План Director */
  plan?: DirectorPlan;
  /** Подключённые агенты */
  connectedAgents: AgentRole[];
  /** Нужен ли Consilium */
  needsConsilium: boolean;
  /** Рекомендация */
  recommendation?: {
    action: AiAction | null;
    confidence: number;
    reasoning: string;
  };
  /** Промптное сообщение (если есть) */
  proactiveMessage?: ProactiveMessage;
}

// ──────────────────────────────────────────────
// 9. Многораундовое обсуждение (Consilium)
// ──────────────────────────────────────────────

/**
 * Первичное мнение агента по обсуждаемому вопросу.
 * Формируется из результата работы агента (без LLM-художеств —
 * только интерпретация собранных фактов и позиция агента).
 */
export interface AgentOpinion {
  /** Роль агента */
  role: AgentRole;
  /** Позиция в человекочитаемой форме */
  position: string;
  /** Предлагаемое действие */
  action: AiAction | null;
  /** Уверенность агента (0..1) */
  confidence: number;
  /** Аргументы в поддержку позиции */
  arguments: string[];
}

/** Входные данные многораундового обсуждения */
export interface ConsiliumDiscussionInput {
  /** Тема обсуждения */
  topic: string;
  /** Тикеры, к которым относится обсуждение */
  tickers: string[];
  /** Первичные мнения агентов (раунд 1) */
  initialOpinions: AgentOpinion[];
  /** Вопросы, требующие обсуждения */
  discussionTopics: string[];
  /** Максимальное число раундов (по умолчанию 3) */
  maxRounds?: number;
  /**
   * Может ли Director при равенстве голосов выбрать позицию AI.
   * По умолчанию true — это право Director, а не безусловный veto агента.
   */
  aiTieBreak?: boolean;
}

// ──────────────────────────────────────────────
// 10. Факты портфеля (неизменяемые входные данные Director)
// ──────────────────────────────────────────────

/**
 * Снимок фактических данных портфеля, передаваемый Director.
 *
 * ⚠️ IMMUTABLE: Director и агенты НЕ могут менять эти значения.
 * Они могут только интерпретировать их и делать инвестиционные выводы.
 * Проверяется тестом «все факты остаются неизменными».
 */
export interface DirectorFactsContext {
  /** Математический анализ активов (из PortfolioMath / AnalysisAgent) */
  assetsAnalysis: readonly AssetAnalysisLike[];
  /** Общая стоимость портфеля, руб */
  totalPortfolioValue: number;
  /** Свободные средства, руб */
  freeCashRub: number;
  /** Целевые доли пользователя (USER_TARGET_PERCENT), если известны */
  userTargetPercent?: readonly { ticker: string; targetPercent: number }[];
  /** Статус математики портфеля (PORTFOLIO_MATH_STATUS), если известен */
  portfolioMathStatus?: string;
  /** Новостной контекст (из research/gatekeeper) */
  newsContext?: string;
  /** Ценовые алерты pipeline */
  priceAlerts?: readonly PriceAlertLike[];
  /** Предложения AI из последнего pipeline (для strategist/scenario) */
  proposals?: readonly { ticker: string; action: AiAction | null }[];
}

/** Упрощённое описание актива (без жёсткой привязки к PortfolioMath) */
export interface AssetAnalysisLike {
  ticker: string;
  name: string;
  currentPercent: number;
  targetPercent: number;
  deficitRub: number;
  status: string;
  quantity?: number;
  balancePrice?: number;
  currentPrice?: number;
  unrealizedProfitRub?: number;
  isConcentrated?: boolean;
}

/** Упрощённый ценовой алерт */
export interface PriceAlertLike {
  ticker: string;
  name?: string;
  currentPrice?: number;
  alertLevel?: string;
  threshold?: number;
}

// ──────────────────────────────────────────────
// 11. Конфигурация Director Agent
// ──────────────────────────────────────────────

/** Контекст свободного диалога с пользователем */
export interface ChatDialogueContext {
  /** Вопрос/реплика пользователя */
  question: string;
  /** Факты портфеля (для LLM-контекста) */
  facts: DirectorFactsContext;
  /** Короткая история чата (роль: текст) */
  history: string;
}

/** Исполнитель свободного диалога: возвращает ответ или null (нет LLM) */
export type ChatResponder = (
  input: ChatDialogueContext,
) => Promise<string | null>;

/** Конфигурация DirectorAgent */
export interface DirectorConfig {
  /** Имя пользователя (для обращений в проактивных сообщениях) */
  userName?: string;
  /** Максимум агентов, подключаемых к одной задаче (0 = без лимита) */
  maxAgentsPerTask?: number;
  /** Порог сложности для созыва Consilium (0-5, по умолчанию 3) */
  consiliumComplexityThreshold?: number;
  /** Максимальное число раундов Consilium (по умолчанию 3) */
  maxConsiliumRounds?: number;
  /** Разрешить Director выбирать позицию AI при равенстве голосов */
  aiTieBreak?: boolean;
  /** Включать результаты агентов в текст ответа */
  includeAgentDetails?: boolean;
  /** Свободный диалог (нефинансовые темы) через LLM с контекстом портфеля */
  chatResponder?: ChatResponder;
}
