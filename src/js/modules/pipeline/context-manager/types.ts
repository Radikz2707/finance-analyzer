/**
 * ContextManager — управление контекстом LLM, сжатие, релевантность,
 * умный поиск в памяти, управление сессиями.
 */

// ──────────────────────────────────────────────
// 1. Типы контекста
// ──────────────────────────────────────────────

/** Статус контекста */
export type ContextStatus = 'active' | 'archived' | 'expired';

/** Уровень релевантности */
export type RelevanceLevel = 'high' | 'medium' | 'low' | 'irrelevant';

/** Тип фрагмента контекста */
export type ContextFragmentType =
  | 'system_prompt'
  | 'user_message'
  | 'assistant_message'
  | 'tool_result'
  | 'memory_retrieval'
  | 'agent_output'
  | 'knowledge_base'
  | 'system_event';

/** Стратегия сжатия */
export type CompressionStrategy =
  'summarize' | 'truncate' | 'compress' | 'archive' | 'prune';

// ──────────────────────────────────────────────
// 2. Интерфейсы
// ──────────────────────────────────────────────

/** Фрагмент контекста */
export interface ContextFragment {
  id: string;
  type: ContextFragmentType;
  content: string;
  relevance: RelevanceLevel;
  weight: number; // 0-1, чем выше тем важнее
  createdAt: string;
  sessionId: string;
  metadata?: Record<string, unknown>;
}

/** Сессия контекста */
export interface ContextSession {
  id: string;
  name: string;
  fragments: ContextFragment[];
  status: ContextStatus;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  totalTokens: number;
  maxTokens: number;
}

/** Результат сжатия */
export interface CompressionResult {
  originalFragments: number;
  compressedFragments: number;
  tokensSaved: number;
  strategy: CompressionStrategy;
  removedFragments: string[];
}

/** Результат поиска релевантности */
export interface RelevanceResult {
  query: string;
  results: { fragmentId: string; score: number; relevance: RelevanceLevel }[];
}

/** Статистика контекста */
export interface ContextStats {
  totalSessions: number;
  activeSessions: number;
  totalFragments: number;
  byType: Record<ContextFragmentType, number>;
  byRelevance: Record<RelevanceLevel, number>;
  averageTokensPerSession: number;
}

// ──────────────────────────────────────────────
// 3. Входы и выходы
// ──────────────────────────────────────────────

/** Действия ContextManager */
export type ContextManagerAction =
  | 'create-session'
  | 'add-fragment'
  | 'get-session'
  | 'get-all-sessions'
  | 'compress-context'
  | 'search-relevance'
  | 'get-context-window'
  | 'get-stats'
  | 'archive-session'
  | 'delete-session'
  | 'clear-all';

/** Создание сессии */
export interface CreateSessionParams {
  name: string;
  maxTokens?: number;
}

/** Добавление фрагмента */
export interface AddFragmentParams {
  sessionId: string;
  type: ContextFragmentType;
  content: string;
  relevance?: RelevanceLevel;
  weight?: number;
  metadata?: Record<string, unknown>;
}

/** Получение сессии */
export interface GetSessionParams {
  sessionId: string;
}

/** Сжатие контекста */
export interface CompressContextParams {
  sessionId: string;
  strategy: CompressionStrategy;
  targetTokens?: number;
}

/** Поиск релевантности */
export interface SearchRelevanceParams {
  sessionId: string;
  query: string;
  limit?: number;
}

/** Получение контекстного окна */
export interface GetContextWindowParams {
  sessionId: string;
  maxTokens: number;
}

/** Получение статистики */
export interface GetStatsParams {
  sessionId?: string;
}

/** Архивация сессии */
export interface ArchiveSessionParams {
  sessionId: string;
}

/** Удаление сессии */
export interface DeleteSessionParams {
  sessionId: string;
}

/** Вход ContextManager */
export type ContextManagerInput =
  | { action: 'create-session'; params: CreateSessionParams }
  | { action: 'add-fragment'; params: AddFragmentParams }
  | { action: 'get-session'; params: GetSessionParams }
  | { action: 'get-all-sessions'; params?: Record<string, never> }
  | { action: 'compress-context'; params: CompressContextParams }
  | { action: 'search-relevance'; params: SearchRelevanceParams }
  | { action: 'get-context-window'; params: GetContextWindowParams }
  | { action: 'get-stats'; params?: GetStatsParams }
  | { action: 'archive-session'; params: ArchiveSessionParams }
  | { action: 'delete-session'; params: DeleteSessionParams }
  | { action: 'clear-all'; params?: Record<string, never> };

/** Результат операции */
export interface ContextOperationResult {
  success: boolean;
  message: string;
  session?: ContextSession;
  sessions?: ContextSession[];
  fragment?: ContextFragment;
  compressionResult?: CompressionResult;
  relevanceResult?: RelevanceResult;
  contextWindow?: ContextFragment[];
  stats?: ContextStats;
}

/** Выход ContextManager */
export type ContextManagerOutput = ContextOperationResult;
