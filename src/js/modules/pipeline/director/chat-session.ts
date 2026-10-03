/**
 * DirectorChatStore — сессии диалога Director с пользователем.
 *
 * - Хранит историю сообщений в рантайме;
 * - дублирует диалог в memory-систему проекта (адаптер ai-memory),
 *   что позволяет ВОССТАНОВИТЬ историю после перезапуска;
 * - работает и без адаптера (in-memory режим).
 */

import type {
  AgentRole,
  ChatMessage,
  ChatMessageRole,
  DirectorChatSession,
} from './director-types.js';
import type { DirectorMemoryAdapter } from './director-memory.js';

/** Опции чат-хранилища */
export interface DirectorChatStoreOptions {
  memoryAdapter?: DirectorMemoryAdapter;
  maxMessagesPerSession?: number;
}

/** Хранилище чат-сессий Director */
export class DirectorChatStore {
  private readonly sessions = new Map<string, DirectorChatSession>();
  private readonly adapter: DirectorMemoryAdapter | null;
  private readonly maxMessages: number;

  constructor(opts?: DirectorChatStoreOptions) {
    this.adapter = opts?.memoryAdapter ?? null;
    this.maxMessages = opts?.maxMessagesPerSession ?? 100;
  }

  /** Создать новую сессию */
  createSession(): DirectorChatSession {
    const session: DirectorChatSession = {
      sessionId: this.newId(),
      messages: [],
      context: '',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  /** Получить сессию (без создания) */
  getSession(sessionId?: string): DirectorChatSession | null {
    if (!sessionId) return null;
    return this.sessions.get(sessionId) ?? null;
  }

  /** Получить сессию или создать */
  getOrCreateSession(sessionId?: string): DirectorChatSession {
    const existing = this.getSession(sessionId);
    if (existing) return existing;
    return this.createSession();
  }

  /** История сообщений сессии */
  getHistory(sessionId: string): ChatMessage[] {
    const session = this.getSession(sessionId);
    return session ? [...session.messages] : [];
  }

  /**
   * Добавить сообщение в сессию и продублировать его в память
   * (если адаптер предоставлен).
   */
  appendMessage(
    sessionId: string,
    role: ChatMessageRole,
    text: string,
    opts?: {
      taskId?: string;
      connectedAgents?: AgentRole[];
      isWorking?: boolean;
      tickers?: string[];
    },
  ): ChatMessage {
    const session = this.getOrCreateSession(sessionId);
    const message: ChatMessage = {
      id: this.newId(),
      role,
      text,
      taskId: opts?.taskId,
      connectedAgents: opts?.connectedAgents,
      isWorking: opts?.isWorking ?? false,
      timestamp: new Date().toISOString(),
    };

    session.messages.push(message);
    session.lastActivityAt = message.timestamp;
    if (session.activeTaskId === undefined && opts?.taskId) {
      session.activeTaskId = opts.taskId;
    }

    // Ограничение размера истории
    if (session.messages.length > this.maxMessages) {
      session.messages = session.messages.slice(-this.maxMessages);
    }

    // Дублируем в память для восстановления истории
    if (this.adapter && role !== 'system') {
      this.adapter.saveConversation(
        `[${role}] ${text.slice(0, 500)}`,
        ['director', ...(opts?.tickers ?? [])].filter(Boolean),
      );
    }

    return message;
  }

  /**
   * Восстановить сессию из памяти: пересобирает сообщения из
   * conversation-записей адаптера.
   */
  restoreSession(sessionId: string): DirectorChatSession {
    const session = this.getOrCreateSession(sessionId);

    if (this.adapter) {
      const conversations = this.adapter.queryByType('conversation', 50);
      const restored: ChatMessage[] = [];

      for (const conv of conversations.reverse()) {
        const match = conv.content.match(
          /^\[(user|director|system)\]\s?(.*)$/s,
        );
        if (!match) continue;
        const role = match[1] as ChatMessageRole;
        const text = match[2] ?? '';
        restored.push({
          id: conv.id,
          role,
          text,
          isWorking: false,
          timestamp: conv.createdAt,
        });
      }

      session.messages = restored;
    }

    session.context = `Восстановлено сообщений: ${session.messages.length}`;
    session.lastActivityAt = new Date().toISOString();
    return session;
  }

  /** Пометить последнее сообщение Director как «работает»/«готово» */
  setWorking(sessionId: string, working: boolean): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i]!;
      if (msg.role === 'director' || msg.role === 'system') {
        msg.isWorking = working;
        break;
      }
    }
  }

  /** Активная задача сессии */
  getActiveTaskId(sessionId: string): string | undefined {
    return this.getSession(sessionId)?.activeTaskId;
  }

  private newId(): string {
    return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
