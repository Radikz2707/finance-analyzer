/**
 * ContextManager — управление контекстом LLM.
 */

import { randomUUID } from 'crypto';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import type {
  ContextManagerInput,
  ContextManagerOutput,
  CreateSessionParams,
  AddFragmentParams,
  GetSessionParams,
  CompressContextParams,
  SearchRelevanceParams,
  GetContextWindowParams,
  GetStatsParams,
  ArchiveSessionParams,
  DeleteSessionParams,
  ContextSession,
  ContextFragment,
  ContextFragmentType,
  RelevanceLevel,
} from './types.js';

const DEFAULT_MAX_TOKENS = 128000;

export class ContextManager extends AgentBase {
  private sessions: Map<string, ContextSession>;

  constructor(config: AgentConfig) {
    super({ ...config, timeoutMs: config.timeoutMs ?? 30000 });
    this.sessions = new Map();
  }

  protected async executeInternal(input: unknown): Promise<unknown> {
    const p = input as ContextManagerInput;
    switch (p.action) {
      case 'create-session':
        return this.createSession(p.params as CreateSessionParams);
      case 'add-fragment':
        return this.addFragment(p.params as AddFragmentParams);
      case 'get-session':
        return this.getSession((p.params as GetSessionParams).sessionId);
      case 'get-all-sessions':
        return this.getAllSessions();
      case 'compress-context':
        return this.compressContext(p.params as CompressContextParams);
      case 'search-relevance':
        return this.searchRelevance(p.params as SearchRelevanceParams);
      case 'get-context-window':
        return this.getContextWindow(p.params as GetContextWindowParams);
      case 'get-stats':
        return this.getStats(p.params as GetStatsParams | undefined);
      case 'archive-session':
        return this.archiveSession(
          (p.params as ArchiveSessionParams).sessionId,
        );
      case 'delete-session':
        return this.deleteSession((p.params as DeleteSessionParams).sessionId);
      case 'clear-all':
        return this.clearAll();
      default:
        throw new Error('Unknown action: ' + (p as { action: string }).action);
    }
  }

  private now(): string {
    return new Date().toISOString();
  }

  private createSession(params: CreateSessionParams): ContextManagerOutput {
    const session: ContextSession = {
      id: randomUUID(),
      name: params.name,
      fragments: [],
      status: 'active',
      createdAt: this.now(),
      updatedAt: this.now(),
      lastAccessedAt: this.now(),
      totalTokens: 0,
      maxTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    this.sessions.set(session.id, session);
    return {
      success: true,
      message: 'Сессия "' + session.name + '" создана',
      session,
    };
  }

  private addFragment(params: AddFragmentParams): ContextManagerOutput {
    const session = this.sessions.get(params.sessionId);
    if (!session) return { success: false, message: 'Сессия не найдена' };

    const relevance = params.relevance ?? 'medium';
    const weight = this.getWeightForRelevance(relevance);

    const fragment: ContextFragment = {
      id: randomUUID(),
      type: params.type,
      content: params.content,
      relevance,
      weight,
      createdAt: this.now(),
      sessionId: params.sessionId,
      metadata: params.metadata,
    };

    session.fragments.push(fragment);
    session.totalTokens += this.estimateTokens(params.content);
    session.updatedAt = this.now();
    session.lastAccessedAt = this.now();

    if (session.totalTokens > session.maxTokens) {
      this.autoCompress(session);
    }

    return { success: true, message: 'Фрагмент добавлен', fragment };
  }

  private getSession(sessionId: string): ContextManagerOutput {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, message: 'Сессия не найдена' };
    session.lastAccessedAt = this.now();
    return { success: true, message: 'Сессия найдена', session };
  }

  private getAllSessions(): ContextManagerOutput {
    const sessions = Array.from(this.sessions.values());
    return {
      success: true,
      message: 'Найдено ' + sessions.length + ' сессий',
      sessions,
    };
  }

  private compressContext(params: CompressContextParams): ContextManagerOutput {
    const session = this.sessions.get(params.sessionId);
    if (!session) return { success: false, message: 'Сессия не найдена' };

    const originalCount = session.fragments.length;
    const removedFragments: string[] = [];

    if (params.strategy === 'prune') {
      session.fragments = session.fragments.filter((f) => {
        if (f.relevance === 'irrelevant') {
          removedFragments.push(f.id);
          session.totalTokens -= this.estimateTokens(f.content);
          return false;
        }
        return true;
      });
    } else if (params.strategy === 'archive') {
      const keep = 50;
      if (session.fragments.length > keep) {
        const toArchive = session.fragments.slice(
          0,
          session.fragments.length - keep,
        );
        for (const f of toArchive) {
          removedFragments.push(f.id);
          session.totalTokens -= this.estimateTokens(f.content);
        }
        session.fragments = session.fragments.slice(-keep);
      }
    } else if (
      params.strategy === 'truncate' &&
      params.targetTokens &&
      session.totalTokens > params.targetTokens
    ) {
      let currentTokens = 0;
      const newFragments: ContextFragment[] = [];
      for (let i = session.fragments.length - 1; i >= 0; i--) {
        const frag = session.fragments[i];
        if (!frag) continue;
        const tokens = this.estimateTokens(frag.content);
        if (currentTokens + tokens <= params.targetTokens) {
          newFragments.unshift(frag);
          currentTokens += tokens;
        } else {
          removedFragments.push(frag.id);
        }
      }
      session.fragments = newFragments;
      session.totalTokens = currentTokens;
    }

    session.updatedAt = this.now();

    return {
      success: true,
      message: 'Контекст сжат',
      session,
      compressionResult: {
        originalFragments: originalCount,
        compressedFragments: session.fragments.length,
        tokensSaved: originalCount - session.fragments.length,
        strategy: params.strategy,
        removedFragments,
      },
    };
  }

  private searchRelevance(params: SearchRelevanceParams): ContextManagerOutput {
    const session = this.sessions.get(params.sessionId);
    if (!session) return { success: false, message: 'Сессия не найдена' };

    const query = params.query.toLowerCase();
    const results = session.fragments.map((f) => {
      const content = f.content.toLowerCase();
      let score = 0;
      const queryWords = query.split(/\s+/);
      for (const word of queryWords) {
        if (content.includes(word)) score += 0.5;
      }
      if (f.relevance === 'high') score += 0.3;
      else if (f.relevance === 'medium') score += 0.1;
      score += f.weight * 0.2;
      const relevance: RelevanceLevel =
        score > 1.0 ? 'high' : score > 0.5 ? 'medium' : 'low';
      return { fragmentId: f.id, score, relevance };
    });

    results.sort((a, b) => b.score - a.score);
    const limit = params.limit ?? results.length;

    return {
      success: true,
      message: 'Найдено ' + results.length + ' результатов',
      relevanceResult: {
        query: params.query,
        results: results.slice(0, limit),
      },
    };
  }

  private getContextWindow(
    params: GetContextWindowParams,
  ): ContextManagerOutput {
    const session = this.sessions.get(params.sessionId);
    if (!session) return { success: false, message: 'Сессия не найдена' };

    const sorted = [...session.fragments].sort((a, b) => b.weight - a.weight);
    const contextWindow: ContextFragment[] = [];
    let totalTokens = 0;

    for (const fragment of sorted) {
      const tokens = this.estimateTokens(fragment.content);
      if (totalTokens + tokens <= params.maxTokens) {
        contextWindow.push(fragment);
        totalTokens += tokens;
      } else {
        break;
      }
    }

    return {
      success: true,
      message:
        'Контекстное окно: ' +
        contextWindow.length +
        ' фрагментов, ' +
        totalTokens +
        ' токенов',
      contextWindow,
    };
  }

  private getStats(params?: GetStatsParams): ContextManagerOutput {
    const sessions = params?.sessionId
      ? [this.sessions.get(params.sessionId!)!]
      : Array.from(this.sessions.values());

    const byType: Record<ContextFragmentType, number> = {
      system_prompt: 0,
      user_message: 0,
      assistant_message: 0,
      tool_result: 0,
      memory_retrieval: 0,
      agent_output: 0,
      knowledge_base: 0,
      system_event: 0,
    };
    const byRelevance: Record<RelevanceLevel, number> = {
      high: 0,
      medium: 0,
      low: 0,
      irrelevant: 0,
    };
    let totalFragments = 0;
    let totalTokens = 0;

    for (const session of sessions) {
      for (const f of session.fragments) {
        byType[f.type]++;
        byRelevance[f.relevance]++;
        totalFragments++;
        totalTokens += this.estimateTokens(f.content);
      }
    }

    return {
      success: true,
      message: 'Статистика контекста',
      stats: {
        totalSessions: this.sessions.size,
        activeSessions: sessions.filter((s) => s.status === 'active').length,
        totalFragments,
        byType,
        byRelevance,
        averageTokensPerSession:
          sessions.length > 0 ? totalTokens / sessions.length : 0,
      },
    };
  }

  private archiveSession(sessionId: string): ContextManagerOutput {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, message: 'Сессия не найдена' };
    session.status = 'archived';
    session.updatedAt = this.now();
    return { success: true, message: 'Сессия архивирована', session };
  }

  private deleteSession(sessionId: string): ContextManagerOutput {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, message: 'Сессия не найдена' };
    this.sessions.delete(sessionId);
    return { success: true, message: 'Сессия удалена' };
  }

  private clearAll(): ContextManagerOutput {
    const count = this.sessions.size;
    this.sessions.clear();
    return { success: true, message: 'Все сессии очищены (' + count + ')' };
  }

  private getWeightForRelevance(relevance: RelevanceLevel): number {
    switch (relevance) {
      case 'high':
        return 1.0;
      case 'medium':
        return 0.7;
      case 'low':
        return 0.3;
      case 'irrelevant':
        return 0.0;
    }
  }

  private estimateTokens(text: string): number {
    const words = text.split(/\s+/).length;
    return Math.max(words, Math.floor(text.length / 4));
  }

  private autoCompress(session: ContextSession): void {
    const keep = Math.floor(session.fragments.length * 0.7);
    const toRemove = session.fragments.slice(
      0,
      session.fragments.length - keep,
    );
    for (const f of toRemove) {
      session.totalTokens -= this.estimateTokens(f.content);
    }
    session.fragments = session.fragments.slice(-keep);
    session.updatedAt = this.now();
  }

  getSessionCount(): number {
    return this.sessions.size;
  }
}
