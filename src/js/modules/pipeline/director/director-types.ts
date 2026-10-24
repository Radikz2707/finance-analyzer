/**
 * Director Agent — типы и интерфейсы (упрощённые).
 */

import type { AgentState } from '../agent/types.js';

// ──────────────────────────────────────────────
// 1. Типы вопросов пользователя
// ──────────────────────────────────────────────

/** Категория вопроса пользователя */
export type UserQuestionCategory =
  | 'asset'
  | 'portfolio'
  | 'comparison'
  | 'scenario'
  | 'market'
  | 'news'
  | 'strategy'
  | 'plan'
  | 'past-decision'
  | 'system-quality'
  | 'general';

/** Интерпретированный вопрос */
export interface InterpretedQuestion {
  category: UserQuestionCategory;
  entities: string[];
  intent: string;
  confidence: number;
  tickers?: string[];
  complexity?: number;
  requiredAgents?: AgentRole[];
  topic?: string;
  text?: string;
  needsConsilium?: boolean;
}

/** Намерение пользователя */
export type UserIntent =
  | 'analyze'
  | 'compare'
  | 'recommend'
  | 'explain'
  | 'general'
  | 'decide-action'
  | 'compare-options'
  | 'explore-scenario'
  | 'review-past'
  | 'plan-future'
  | 'critique-system'
  | 'understand'
  | 'general-inquiry';

/** Ввод для многораундового Consilium */
export interface ConsiliumDiscussionInput {
  question: string;
  facts: DirectorFactsContext;
  agentOpinions: AgentOpinion[];
}

/** Раунд Consilium */
export interface ConsiliumRound {
  round: number;
  opinions: AgentOpinion[];
  consensus: boolean;
}

// ──────────────────────────────────────────────
// 2. Роли агентов
// ──────────────────────────────────────────────

/** Роли агентов, которые может использовать Director */
export type AgentRole =
  | 'ai'
  | 'research'
  | 'strategist'
  | 'scenario'
  | 'review'
  | 'analysis'
  | 'terminal'
  | 'file'
  | 'package'
  | 'process'
  | 'system'
  | 'automation'
  | 'code'
  | 'self-improve'
  | 'gigacode';

// ──────────────────────────────────────────────
// 3. Мнения и результаты агентов
// ──────────────────────────────────────────────

/** Мнение одного агента */
export interface AgentOpinion {
  role: AgentRole;
  opinion: string;
  reasoning: string;
  confidence: number;
  tickers?: string[];
  position?: string;
  action?: string;
  arguments?: string;
}

/** Результат выполнения агента */
export interface AgentResultEntry {
  role: AgentRole;
  success: boolean;
  data?: unknown;
  error?: string;
}

// ──────────────────────────────────────────────
// 4. Контекст фактов
// ──────────────────────────────────────────────

/** Контекст фактов для Director */
export interface DirectorFactsContext {
  /** Активы портфеля (упрощённый формат) */
  assets: Array<{
    ticker: string;
    name: string;
    quantity: number;
    currentPrice: number;
    balancePrice: number;
    currentPercent: number;
    targetPercent?: number;
    deficitRub: number;
    status: string;
  }>;
  /** Полный анализ активов (из AnalysisAgent) */
  assetsAnalysis?: Array<{
    ticker: string;
    name: string;
    assetType: string;
    currentPercent: number;
    targetPercent?: number;
    deficitRub: number;
    status: string;
    balancePrice: number;
    currentPrice: number;
    quantity: number;
    nkdRub: number;
    unrealizedProfitRub: number;
    dynamicsPercent: number;
    holdOnly?: boolean;
  }>;
  /** Макро-данные */
  macro: {
    totalBalance: number;
    freeCash: number;
    stocksPercent: number;
    bondsPercent: number;
  };
  /** Общее значение портфеля */
  totalPortfolioValue?: number;
  /** Свободный кэш в рублях */
  freeCashRub?: number;
  /** Ценовые алерты */
  priceAlerts?: Array<{ ticker: string; alertLevel: string; threshold: number }>;
  /** Новостной контекст (строка для обратной совместимости) */
  newsContext?: string;
  /** Структурированные данные о сентименте по тикерам */
  sentimentData?: Record<string, {
    score: number; // -1 to 1
    label: 'bullish' | 'bearish' | 'neutral';
    keyPhrases: string[];
    sourceCount: number;
    newsSummary?: string;
  }>;
  /** Котировки */
  quotes?: Record<string, { currentPrice: number; dailyDynamicsPercent: number }>;
}

// ──────────────────────────────────────────────
// 5. Ответ Director
// ──────────────────────────────────────────────

/** Ответ Director */
export interface DirectorResponse {
  text: string;
  agentsUsed: AgentRole[];
  consiliumRounds?: Array<{
    round: number;
    opinions: AgentOpinion[];
    consensus: boolean;
  }>;
  pipelineId?: string;
}

// ──────────────────────────────────────────────
// 6. Сессия чата
// ──────────────────────────────────────────────

/** Сообщение в чате */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  pipelineId?: string;
}

/** Сессия чата */
export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ──────────────────────────────────────────────
// 7. Состояние Director
// ──────────────────────────────────────────────

/** Состояние Director */
export interface DirectorState {
  state: AgentState;
  currentSession?: string;
  lastPipelineId?: string;
}

// ──────────────────────────────────────────────
// 8. Конфигурация и планы Director
// ──────────────────────────────────────────────

/** Конфигурация Director */
export interface DirectorConfig {
  userName?: string;
  includeAgentDetails?: boolean;
}

/** План Director */
export interface DirectorPlan {
  goal: string;
  steps: Array<{ description: string }>;
}

/** Многораундовый Consilium */
export interface MultiRoundConsiliumOutput {
  rounds: unknown[];
  consensus: boolean;
  keyArguments?: string;
}

/** Проактивное сообщение */
export interface ProactiveMessage {
  id?: string;
  type?: string;
  title?: string;
  text: string;
  reason: string;
  ticker?: string;
  priority?: string;
  createdAt?: string;
}

/** Тип проактивного сообщения */
export type ProactiveMessageType = string;

/** Интерфейс Director Agent */
export interface IDirectorAgent {
  processUserMessage: (msg: string) => Promise<DirectorResponse>;
}

// ──────────────────────────────────────────────
// 8. Аудит Director
// ──────────────────────────────────────────────

/** Тип события аудита */
export type DirectorAuditEventType =
  | 'question'
  | 'delegate'
  | 'consilium'
  | 'response'
  | 'pipeline'
  | 'error';

/** Событие аудита Director */
export interface DirectorAuditEvent {
  id: string;
  type: DirectorAuditEventType;
  timestamp: string;
  pipelineId?: string;
  sessionId?: string;
  taskId?: string;
  question?: string;
  agents?: AgentRole[];
  outcome?: string;
  error?: string;
  trace?: string;
}

/** Задача Director */
export interface DirectorTask {
  id: string;
  type: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  result?: string;
  userQuestion?: string;
  interpretedQuestion?: unknown;
  agents?: AgentRole[];
  consiliumRounds?: unknown[];
  finalSynthesis?: string;
  recommendation?: string;
  agentResults?: unknown[];
}

// ──────────────────────────────────────────────
// 9. Стратегическая память Director
// ──────────────────────────────────────────────

/** Тип стратегической памяти */
export type StrategicMemoryType =
  | 'investment_lesson'
  | 'pattern'
  | 'preference'
  | 'kpi_snapshot'
  | 'strategy_weights'
  | 'strategic_decision'
  | 'pending-decision'
  | 'unresolved-question'
  | 'future-task'
  | 'pending-review';

/** Запись стратегической памяти */
export interface DirectorStrategicMemory {
  id: string;
  type: StrategicMemoryType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
  ticker?: string;
  reason?: string;
  status?: string;
  priority?: string;
}
