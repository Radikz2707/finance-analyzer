/**
 * DirectorAuditLog — аудит-трейл решений Director.
 *
 * Каждое решение Director имеет полный след:
 * USER QUESTION -> DIRECTOR INTERPRETATION -> DELEGATED TASKS ->
 * AGENT RESULTS -> CONSILIUM ROUNDS -> DIRECTOR SYNTHESIS -> FINAL RECOMMENDATION
 */

import type {
  DirectorAuditEvent,
  DirectorAuditEventType,
  DirectorTask,
} from './director-types.js';

/** Аудит-лог Director (in-memory, с ограничением размера) */
export class DirectorAuditLog {
  private entries: DirectorAuditEvent[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  /** Записать событие */
  record(
    type: DirectorAuditEventType,
    message: string,
    params?: {
      taskId?: string;
      actor?: string;
      metadata?: Record<string, unknown>;
    },
  ): DirectorAuditEvent {
    const entry: DirectorAuditEvent = {
      id: `dir-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      type,
      taskId: params?.taskId,
      actor: params?.actor ?? 'director',
      message,
      metadata: params?.metadata ?? {},
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
    return entry;
  }

  /** Получить все события */
  getAll(): DirectorAuditEvent[] {
    return [...this.entries];
  }

  /** События по задаче */
  getByTask(taskId: string): DirectorAuditEvent[] {
    return this.entries.filter((e) => e.taskId === taskId);
  }

  /**
   * Сформировать полный trace решения по завершённой задаче.
   */
  buildTrace(task: DirectorTask): NonNullable<DirectorAuditEvent['trace']> {
    const results = task.agentResults.map(
      (r) => `${r.role}: ${r.success ? 'ok' : 'error'}`,
    );
    return {
      userQuestion: task.userQuestion,
      directorInterpretation:
        `${task.interpretedQuestion.category}/${task.interpretedQuestion.intent}, ` +
        `тема: ${task.interpretedQuestion.topic}, ` +
        `тикеры: ${task.interpretedQuestion.tickers.join(', ') || '-'}`,
      delegatedTasks: task.agents.map((a) => `${a.role} — ${a.description}`),
      agentResultsSummary: results.join('; ') || 'нет результатов',
      consiliumRounds: task.consiliumRounds,
      directorSynthesis: task.finalSynthesis,
      finalRecommendation:
        `${task.recommendation.action ?? 'без действия'} ` +
        `(${Math.round(task.recommendation.confidence * 100)}%) — ` +
        `${task.recommendation.reasoning}`,
    };
  }

  /** Получить trace задачи (если задача завершена) */
  getTrace(
    task: DirectorTask,
  ): NonNullable<DirectorAuditEvent['trace']> | null {
    if (task.status !== 'completed') return null;
    return this.buildTrace(task);
  }

  /** События за последние N минут */
  getRecent(minutes: number): DirectorAuditEvent[] {
    const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
    return this.entries.filter((e) => e.timestamp >= cutoff);
  }

  /** Очистить лог */
  clear(): void {
    this.entries = [];
  }
}
