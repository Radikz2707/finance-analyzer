/**
 * DirectorMemoryStore — стратегическая память Director поверх ai-memory.
 * Использует СУЩЕСТВУЮЩУЮ memory-систему проекта (адаптер aiMemoryAdapter);
 * параллельная несвязанная система памяти не создаётся.
 */

import {
  saveDecision as memorySaveDecision,
  saveConversation as memorySaveConversation,
  saveRecommendation as memorySaveRecommendation,
  searchByKeywords as memorySearchByKeywords,
  getByType as memoryGetByType,
  getRecent as memoryGetRecent,
} from '../ai-memory/index.js';
import type {
  DirectorStrategicMemory,
  StrategicMemoryType,
} from './director-types.js';

// ──────────────────────────────────────────────
// 1. Адаптер памяти
// ──────────────────────────────────────────────

/** Ссылка на запись памяти (формат, понятный Director) */
export interface MemoryEntryRef {
  id: string;
  type: string;
  content: string;
  createdAt: string;
  priority: string;
  metadata?: Record<string, unknown>;
}

/** Адаптер над памятью ИИ (инжектируется для тестов) */
export interface DirectorMemoryAdapter {
  saveDecision(content: string, keywords?: string[]): string;
  saveConversation(content: string, keywords?: string[]): string;
  saveRecommendation(content: string, ticker?: string): string;
  searchByKeywords(keywords: string[], limit?: number): MemoryEntryRef[];
  queryByType(type: string, limit?: number): MemoryEntryRef[];
  getRecent(limit?: number): MemoryEntryRef[];
}

function toRef(raw: unknown): MemoryEntryRef {
  const r = raw as {
    id?: string;
    type?: string;
    content?: string;
    createdAt?: string;
    priority?: string;
    metadata?: Record<string, unknown>;
  };
  return {
    id: r.id ?? '',
    type: r.type ?? 'unknown',
    content: r.content ?? '',
    createdAt: r.createdAt ?? new Date().toISOString(),
    priority: r.priority ?? 'medium',
    metadata: r.metadata,
  };
}

/** Адаптер по умолчанию — поверх модуля ai-memory проекта. */
export const aiMemoryAdapter: DirectorMemoryAdapter = {
  saveDecision(content, keywords) {
    try {
      return memorySaveDecision(content, keywords);
    } catch (err) {
      console.warn('[DirectorMemory] Ошибка сохранения решения:', err);
      return '';
    }
  },
  saveConversation(content, keywords) {
    try {
      return memorySaveConversation(content, keywords);
    } catch (err) {
      console.warn('[DirectorMemory] Ошибка сохранения переписки:', err);
      return '';
    }
  },
  saveRecommendation(content, ticker) {
    try {
      return memorySaveRecommendation(content, ticker);
    } catch (err) {
      console.warn('[DirectorMemory] Ошибка сохранения рекомендации:', err);
      return '';
    }
  },
  searchByKeywords(keywords, limit = 30) {
    try {
      return memorySearchByKeywords(keywords, limit).map(toRef);
    } catch {
      return [];
    }
  },
  queryByType(type, limit = 30) {
    try {
      return memoryGetByType(type as never, limit).map(toRef);
    } catch {
      return [];
    }
  },
  getRecent(limit = 30) {
    try {
      return memoryGetRecent(limit).map(toRef);
    } catch {
      return [];
    }
  },
};

// ──────────────────────────────────────────────
// 2. In-memory адаптер (для тестов и офлайн-режима)
// ──────────────────────────────────────────────

/** Адаптер памяти в оперативной памяти (детерминированный, для тестов) */
export function createInMemoryMemoryAdapter(
  seed?: MemoryEntryRef[],
): DirectorMemoryAdapter {
  const entries: MemoryEntryRef[] = [...(seed ?? [])];
  let counter = 0;

  const push = (
    type: string,
    content: string,
    priority: string,
    metadata?: Record<string, unknown>,
  ): string => {
    counter++;
    const entry: MemoryEntryRef = {
      id: `mem-${counter}`,
      type,
      content,
      createdAt: new Date().toISOString(),
      priority,
      metadata,
    };
    entries.push(entry);
    return entry.id;
  };

  return {
    saveDecision(content) {
      return push('decision', content, 'critical');
    },
    saveConversation(content) {
      return push('conversation', content, 'medium');
    },
    saveRecommendation(content, ticker) {
      return push('recommendation', content, 'high', { ticker });
    },
    searchByKeywords(keywords, limit = 30) {
      const lower = keywords.map((k) => k.toLowerCase());
      return entries
        .filter((e) => lower.some((k) => e.content.toLowerCase().includes(k)))
        .slice(-limit)
        .reverse();
    },
    queryByType(type, limit = 30) {
      return entries
        .filter((e) => e.type === type)
        .slice(-limit)
        .reverse();
    },
    getRecent(limit = 30) {
      return [...entries].slice(-limit).reverse();
    },
  };
}

// ──────────────────────────────────────────────
// 3. DirectorMemoryStore
// ──────────────────────────────────────────────

/** Стратегическая память Director поверх адаптера. */
export class DirectorMemoryStore {
  private readonly adapter: DirectorMemoryAdapter;
  /** Кэш стратегической памяти в рантайме */
  private cache: DirectorStrategicMemory[];

  constructor(adapter?: DirectorMemoryAdapter) {
    this.adapter = adapter ?? aiMemoryAdapter;
    this.cache = this.loadAll();
  }

  /** Загрузить все записи стратегической памяти */
  getStrategicMemory(): DirectorStrategicMemory[] {
    return [...this.cache];
  }

  /** Сохранить произвольную стратегическую запись */
  saveStrategicMemoryEntry(
    entry: Omit<DirectorStrategicMemory, 'id' | 'createdAt' | 'updatedAt'>,
  ): DirectorStrategicMemory {
    const now = new Date().toISOString();
    const record: DirectorStrategicMemory = {
      id: `sm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: entry.type,
      ticker: entry.ticker,
      content: entry.content,
      reason: entry.reason,
      status: entry.status,
      priority: entry.priority,
      createdAt: now,
      updatedAt: now,
    };

    this.adapter.saveDecision(
      this.serializeRecord(record),
      ['director', record.ticker ?? '', record.type].filter(Boolean),
    );

    this.cache.push(record);
    return record;
  }

  /**
   * Сохранить итог задачи Director как стратегическое решение:
   * ЧТО решили, ПОЧЕМУ, с какой уверенностью.
   */
  saveTaskOutcome(params: {
    taskId: string;
    userQuestion: string;
    tickers: string[];
    action: string | null;
    confidence: number;
    reasoning: string;
    status?: DirectorStrategicMemory['status'];
    memoryType?: StrategicMemoryType;
  }): DirectorStrategicMemory {
    const record = this.saveStrategicMemoryEntry({
      type: params.memoryType ?? 'strategic-decision',
      ticker: params.tickers[0],
      content: this.buildDecisionContent(params),
      reason:
        `Решение по вопросу «${params.userQuestion.slice(0, 120)}» ` +
        `с уверенностью ${Math.round(params.confidence * 100)}%.`,
      status: params.status ?? 'active',
      priority:
        params.action === 'HOLD' || params.action === null ? 'normal' : 'high',
    });

    if (params.tickers.length > 0) {
      this.adapter.saveRecommendation(
        `Director: ${params.action ?? 'без действия'} по ${params.tickers.join(
          ', ',
        )}. ${params.reasoning.slice(0, 200)}`,
        params.tickers[0],
      );
    }

    return record;
  }

  /** Сохранить сообщение диалога в память */
  saveConversation(
    role: 'user' | 'director',
    text: string,
    tickers: string[],
  ): void {
    this.adapter.saveConversation(
      `[${role}] ${text.slice(0, 500)}`,
      ['director', ...tickers].filter(Boolean),
    );
  }

  /**
   * Загрузить контекст из памяти для текущего вопроса.
   * Позволяет Director вспомнить прошлые решения и разговоры.
   */
  loadContext(tickers: string[], category?: string): string {
    const parts: string[] = [];
    const keywords = tickers.length > 0 ? tickers : ['director'];

    const decisions = this.adapter.searchByKeywords(
      [...keywords, 'decision'],
      10,
    );
    for (const d of decisions.slice(0, 5)) {
      parts.push(
        `[решение ${d.createdAt.slice(0, 10)}] ${d.content.slice(0, 300)}`,
      );
    }

    const conversations = this.adapter.queryByType('conversation', 10);
    for (const c of conversations.slice(0, 5)) {
      parts.push(
        `[диалог ${c.createdAt.slice(0, 10)}] ${c.content.slice(0, 200)}`,
      );
    }

    if (tickers.length > 0) {
      const recs = this.adapter.searchByKeywords(tickers, 8);
      for (const r of recs.slice(0, 4)) {
        if (r.type === 'recommendation') {
          parts.push(`[рекомендация] ${r.content.slice(0, 200)}`);
        }
      }
    }

    if (category === 'past-decision' && decisions.length === 0) {
      parts.push('Прошлых сохранённых решений по теме не найдено.');
    }

    return parts.length > 0 ? parts.join('\n') : '';
  }

  /** Отметить запись как решённую */
  resolveEntry(id: string): boolean {
    const index = this.cache.findIndex((e) => e.id === id);
    if (index === -1) return false;
    this.cache[index] = {
      ...this.cache[index]!,
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return true;
  }

  /** Активные незакрытые вопросы (для проактивных проверок) */
  getPendingItems(): DirectorStrategicMemory[] {
    return this.cache.filter(
      (e) =>
        e.status === 'active' &&
        (e.type === 'pending-decision' ||
          e.type === 'unresolved-question' ||
          e.type === 'future-task'),
    );
  }

  // ── Helpers ──

  private loadAll(): DirectorStrategicMemory[] {
    const recent = this.adapter.getRecent(200);
    return recent
      .filter((e) => e.type === 'decision')
      .map((e) => this.deserializeRecord(e))
      .filter((e): e is DirectorStrategicMemory => e !== null);
  }

  private serializeRecord(record: DirectorStrategicMemory): string {
    return [
      `тип=${record.type}`,
      `тикер=${record.ticker ?? '-'}`,
      `статус=${record.status}`,
      `приоритет=${record.priority}`,
      `содержимое=${record.content}`,
      `причина=${record.reason}`,
    ].join('\n');
  }

  private deserializeRecord(
    ref: MemoryEntryRef,
  ): DirectorStrategicMemory | null {
    if (!ref.content) return null;
    const lines = ref.content.split('\n');
    const get = (key: string): string | undefined => {
      const line = lines.find((l) => l.startsWith(`${key}=`));
      return line?.slice(key.length + 1);
    };

    const type = (get('тип') ?? 'strategic-decision') as StrategicMemoryType;
    const status = (get('статус') ??
      'active') as DirectorStrategicMemory['status'];
    const priority = (get('приоритет') ??
      'normal') as DirectorStrategicMemory['priority'];
    const ticker = get('тикер');
    const content = get('содержимое') ?? ref.content;
    const reason = get('причина') ?? '';

    return {
      id: ref.id,
      type,
      ticker: ticker && ticker !== '-' ? ticker : undefined,
      content,
      reason,
      status,
      priority,
      createdAt: ref.createdAt,
      updatedAt: ref.createdAt,
    };
  }

  private buildDecisionContent(params: {
    userQuestion: string;
    tickers: string[];
    action: string | null;
    confidence: number;
    reasoning: string;
  }): string {
    return (
      `Вопрос: ${params.userQuestion}\n` +
      `Активы: ${params.tickers.join(', ') || '-'}\n` +
      `Действие: ${params.action ?? 'без действия'}\n` +
      `Уверенность: ${Math.round(params.confidence * 100)}%\n` +
      `Обоснование: ${params.reasoning}`
    );
  }
}
