/**
 * Audit Log — полный аудит-трейл всех действий системы.
 *
 * Записывает:
 * - Запуск/остановку агентов
 * - Изменение конфигурации
 * - Переопределения результатов
 * - Команды директора
 * - Ошибки и retry
 * - Результаты review-агентов
 * - Human-in-the-loop решения
 */

// ──────────────────────────────────────────────
// 1. Типы событий
// ──────────────────────────────────────────────

export type AuditEventType =
  | 'agent.start'
  | 'agent.stop'
  | 'agent.restart'
  | 'agent.pause'
  | 'agent.resume'
  | 'agent.config_change'
  | 'agent.error'
  | 'agent.retry'
  | 'pipeline.start'
  | 'pipeline.complete'
  | 'pipeline.error'
  | 'review.start'
  | 'review.complete'
  | 'review.disagreement'
  | 'command.director'
  | 'command.override'
  | 'command.approve'
  | 'command.reject'
  | 'command.modify'
  | 'iteration.complete';

// ──────────────────────────────────────────────
// 2. Audit Entry
// ──────────────────────────────────────────────

/** Одна запись в аудит-логе */
export interface AuditEntry {
  /** Уникальный ID записи */
  id: string;
  /** Метка времени */
  timestamp: string;
  /** Тип события */
  type: AuditEventType;
  /** Кто выполнил действие (agent name, 'director', 'system') */
  actor: string;
  /** Описание действия */
  message: string;
  /** Дополнительные данные */
  metadata?: Record<string, unknown>;
  /** ID pipeline (если применимо) */
  pipelineId?: string;
  /** Итерация (если применимо) */
  iteration?: number;
}

// ──────────────────────────────────────────────
// 3. Audit Log
// ──────────────────────────────────────────────

/**
 * Audit Log — in-memory лог с возможностью фильтрации.
 *
 * Хранит все события в памяти с ограничением размера (по умолчанию 1000 записей).
 */
export class AuditLog {
  private entries: AuditEntry[] = [];
  private maxEntries = 1000;

  /** Добавить запись */
  log(
    type: AuditEventType,
    actor: string,
    message: string,
    metadata?: Record<string, unknown>,
    pipelineId?: string,
    iteration?: number,
  ): AuditEntry {
    const entry: AuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      type,
      actor,
      message,
      metadata,
      pipelineId,
      iteration,
    };

    this.entries.push(entry);

    // Ограничиваем размер лога
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    return entry;
  }

  /** Получить все записи */
  getAll(): AuditEntry[] {
    return [...this.entries];
  }

  /** Получить записи за последние N минут */
  getRecent(minutes: number): AuditEntry[] {
    const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
    return this.entries.filter((e) => e.timestamp >= cutoff);
  }

  /** Получить записи по типу */
  getByType(type: AuditEventType): AuditEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  /** Получить записи по actor */
  getByActor(actor: string): AuditEntry[] {
    return this.entries.filter((e) => e.actor === actor);
  }

  /** Получить записи по pipelineId */
  getByPipeline(pipelineId: string): AuditEntry[] {
    return this.entries.filter((e) => e.pipelineId === pipelineId);
  }

  /** Получить записи с пагинацией */
  getPage(page: number, pageSize: number): {
    entries: AuditEntry[];
    total: number;
    page: number;
    pageSize: number;
  } {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return {
      entries: this.entries.slice(start, end),
      total: this.entries.length,
      page,
      pageSize,
    };
  }

  /** Очистить лог */
  clear(): void {
    this.entries = [];
  }

  /** Сформировать текстовый отчёт для Telegram */
  formatReport(limit: number = 50): string {
    const recent = this.entries.slice(-limit);
    let text = '<b>📋 Аудит-трейл</b>\n\n';

    if (recent.length === 0) {
      text += 'Нет записей.';
      return text;
    }

    for (const entry of recent.reverse()) {
      const time = new Date(entry.timestamp).toLocaleTimeString('ru-RU');
      const typeEmoji = this.getTypeEmoji(entry.type);
      const typeLabel = entry.type.split('.')[1]?.toUpperCase() ?? '';

      text += `${typeEmoji} <b>[${time}] ${entry.actor}</b> ${typeLabel}\n`;
      text += `  ${entry.message}\n`;

      if (entry.metadata) {
        const metaStr = Object.entries(entry.metadata)
          .slice(0, 3)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        if (metaStr) {
          text += `  📎 ${metaStr}\n`;
        }
      }
      text += '\n';
    }

    return text;
  }

  /** Сформировать summary для /agents */
  formatSummary(): string {
    const recent = this.getRecent(60); // последние 60 минут
    const agentStarts = recent.filter((e) => e.type === 'agent.start').length;
    const agentErrors = recent.filter((e) => e.type === 'agent.error').length;
    const reviews = recent.filter((e) => e.type.startsWith('review.')).length;
    const commands = recent.filter((e) => e.type === 'command.director').length;
    const iterations = recent.filter((e) => e.type === 'iteration.complete').length;

    let text = '<b>📊 Сводка за 60 мин:</b>\n\n';
    text += `🚀 Запусков агентов: ${agentStarts}\n`;
    text += `❌ Ошибок: ${agentErrors}\n`;
    text += `🔍 Review-сессий: ${reviews}\n`;
    text += `👤 Команд директора: ${commands}\n`;
    text += `🔄 Итераций: ${iterations}\n`;
    text += `\n📝 Всего записей: ${this.entries.length}`;

    return text;
  }

  // ── Helpers ──

  private getTypeEmoji(type: AuditEventType): string {
    switch (type) {
      case 'agent.start':
        return '🚀';
      case 'agent.stop':
        return '⏹️';
      case 'agent.restart':
        return '🔄';
      case 'agent.pause':
        return '⏸️';
      case 'agent.resume':
        return '▶️';
      case 'agent.config_change':
        return '⚙️';
      case 'agent.error':
        return '❌';
      case 'agent.retry':
        return '🔁';
      case 'pipeline.start':
        return '🏁';
      case 'pipeline.complete':
        return '✅';
      case 'pipeline.error':
        return '💥';
      case 'review.start':
        return '🔍';
      case 'review.complete':
        return '📊';
      case 'review.disagreement':
        return '⚠️';
      case 'command.director':
        return '👤';
      case 'command.override':
        return '🔄';
      case 'command.approve':
        return '✅';
      case 'command.reject':
        return '❌';
      case 'command.modify':
        return '✏️';
      case 'iteration.complete':
        return '🔄';
      default:
        return '📝';
    }
  }
}
