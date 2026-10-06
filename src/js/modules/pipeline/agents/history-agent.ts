/**
 * HistoryAgent — систематическое хранилище истории действий агентов.
 *
 * Даёт Director'у и пользователю полный след выполнения:
 * - запись событий: «запуск → результат» с таймингом и статусом;
 * - поиск по агенту, статусу, диапазону времени и подстроке в detail;
 * - визуализация цепочки выполнения (trace/chain) через сквозной runId,
 *   который генерируется при startRun() если в pipeline нет своего taskId;
 * - экспорт истории в JSON-файл (с защитой пути, как в FileAgent)
 *   и markdown-сводку для чата/report.
 *
 * Безопасность:
 * - экспорт работает ТОЛЬКО внутри разрешённых корней (по умолчанию process.cwd());
 * - выход за пределы корня через "../" или абсолютные пути вне корня блокируется.
 *
 * Событие совместимо с результатом AgentResult: recordFromResult() пишет событие
 * из уже полученного результата, wrapAgentExecution() — оборачивает agent.execute().
 */

import * as fs from 'fs';
import * as path from 'path';
import { isInside } from './file-agent.js';
import type { AgentResult } from '../agent/types.js';

// ──────────────────────────────────────────────
// 1. Типы HistoryAgent
// ──────────────────────────────────────────────

/** Статус события */
export type HistoryStatus = 'success' | 'failed' | 'blocked';

/** Одно событие истории действий */
export interface HistoryEvent {
  /** Уникальный ID события */
  id: string;
  /** Имя агента, выполнившего действие */
  agentName: string;
  /** Роль агента в задаче (опционально) */
  role?: string;
  /** Действие (например, 'read', 'execute', 'security.check') */
  action: string;
  /** Детали/описание действия */
  detail?: string;
  /** Статус выполнения */
  status: HistoryStatus;
  /** Время выполнения в миллисекундах */
  durationMs?: number;
  /** Метка времени создания */
  createdAt: string;
  /** Сквозной ID запуска для группировки цепочки (runId) */
  runId?: string;
  /** ID задачи Director (если доступен) */
  taskId?: string;
}

/** Входные данные record(): id/createdAt генерируются автоматически */
export type HistoryEventInput = Omit<HistoryEvent, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: string;
};

/** Запрос поиска по истории */
export interface HistoryFindQuery {
  /** Точное имя агента */
  agentName?: string;
  /** Статус события */
  status?: HistoryStatus;
  /** Начало диапазона времени (ISO-строка или Date) */
  from?: string | Date;
  /** Конец диапазона времени (ISO-строка или Date) */
  to?: string | Date;
  /** Полнотекстовая подстрока в detail (регистронезависимо) */
  query?: string;
  /** Лимит количества записей */
  limit?: number;
  /** Сортировка по createdAt: 'desc' (новые сверху) или 'asc' */
  sort?: 'asc' | 'desc';
}

/** Опции конфигурации HistoryAgent */
export interface HistoryAgentOptions {
  /** Ограничение размера истории (по умолчанию 1000) */
  maxEntries?: number;
  /** Разрешённые корни для экспорта (по умолчанию — process.cwd()) */
  roots?: string[];
}

/** Сводная статистика истории */
export interface HistoryStats {
  total: number;
  success: number;
  failed: number;
  blocked: number;
  /** Количество событий по каждому агенту */
  byAgent: Record<string, number>;
}

/** Активная сессия запуска (runId для группировки цепочки) */
export interface RunSession {
  runId: string;
  startedAt: string;
}

/** Цепочка выполнения одного запроса: последовательность «запуск → результат» */
export interface HistoryTrace {
  runId?: string;
  taskId?: string;
  /** Время первого события цепочки */
  startedAt?: string;
  /** Время последнего события цепочки */
  completedAt?: string;
  /** Длительность цепочки (мс, от первого до последнего события) */
  durationMs?: number;
  /** События цепочки в хронологическом порядке */
  events: HistoryEvent[];
  /** Сводка статусов внутри цепочки */
  counts: HistoryStats;
}

/** Минимальный контракт агента для wrapAgentExecution */
export interface AgentLike {
  readonly name: string;
  execute(input: unknown): Promise<AgentResult>;
}

/** Опции обёртки wrapAgentExecution */
export interface WrapAgentExecutionOptions {
  role?: string;
  taskId?: string;
  /** Сквозной runId; если не задан — берётся активный или создаётся новый */
  runId?: string;
  /** Имя действия (по умолчанию 'execute') */
  action?: string;
}

// ──────────────────────────────────────────────
// 2. HistoryAgent
// ──────────────────────────────────────────────

/**
 * История действий агентов: in-memory хранилище с фильтрацией,
 * группировкой в цепочки и экспортом.
 */
export class HistoryAgent {
  private entries: HistoryEvent[] = [];
  private readonly maxEntries: number;
  private readonly roots: string[];
  private activeRun: RunSession | null = null;

  constructor(options?: HistoryAgentOptions) {
    this.maxEntries = options?.maxEntries ?? 1000;
    const roots = options?.roots?.length ? options.roots : [process.cwd()];
    this.roots = roots.map((root) => path.resolve(root));
  }

  // ── Запись ──

  /**
   * Записать событие: id и createdAt генерируются автоматически,
   * к событию привязывается активный runId (если он есть и не задан явно).
   */
  record(entry: HistoryEventInput): HistoryEvent {
    const event: HistoryEvent = {
      ...entry,
      id: entry.id ?? this.nextId('hist'),
      createdAt: entry.createdAt ?? new Date().toISOString(),
      runId: entry.runId ?? this.activeRun?.runId,
    };
    return this.append(event);
  }

  /** Добавить готовое событие (без модификации полей) */
  append(event: HistoryEvent): HistoryEvent {
    this.entries.push(event);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
    return event;
  }

  /**
   * Записать событие из результата AgentResult — совместимость
   * с контрактом execute() любого агента.
   */
  recordFromResult(
    result: AgentResult,
    options?: {
      agentName?: string;
      role?: string;
      action?: string;
      taskId?: string;
    },
  ): HistoryEvent {
    return this.record({
      agentName: options?.agentName ?? 'unknown',
      role: options?.role,
      taskId: options?.taskId,
      action: options?.action ?? 'execute',
      status: result.success ? 'success' : 'failed',
      detail: result.success ? 'ok' : (result.error?.message ?? 'error'),
      durationMs: result.durationMs,
    });
  }

  // ── Run-сессии (цепочки) ──

  /**
   * Начать новый run: генерирует сквозной runId, к которому привязываются
   * последующие record() пока сессия активна (до endRun()/следующего startRun()).
   */
  startRun(): RunSession {
    this.activeRun = {
      runId: this.nextId('run'),
      startedAt: new Date().toISOString(),
    };
    return this.activeRun;
  }

  /** Завершить активную run-сессию. Возвращает её (или null). */
  endRun(): RunSession | null {
    const session = this.activeRun;
    this.activeRun = null;
    return session;
  }

  /** ID активной run-сессии (null, если запуск не начат) */
  get activeRunId(): string | null {
    return this.activeRun?.runId ?? null;
  }

  // ── Поиск ──

  /**
   * Поиск по истории с фильтрами: агент, статус, диапазон времени,
   * подстрока в detail. По умолчанию новые события сверху; limit обрезает.
   */
  find(query?: HistoryFindQuery): HistoryEvent[] {
    const q = query ?? {};
    let result = this.entries;

    if (q.agentName) {
      result = result.filter((e) => e.agentName === q.agentName);
    }
    if (q.status) {
      result = result.filter((e) => e.status === q.status);
    }
    if (q.from) {
      const from = toIso(q.from);
      result = result.filter((e) => e.createdAt >= from);
    }
    if (q.to) {
      const to = toIso(q.to);
      result = result.filter((e) => e.createdAt <= to);
    }
    if (q.query) {
      const needle = q.query.toLowerCase();
      result = result.filter(
        (e) =>
          (e.detail ?? '').toLowerCase().includes(needle) ||
          e.action.toLowerCase().includes(needle),
      );
    }

    const sorted = [...result].sort((a, b) => {
      const cmp = a.createdAt.localeCompare(b.createdAt);
      return q.sort === 'asc' ? cmp : -cmp;
    });

    if (q.limit && q.limit > 0) {
      return sorted.slice(0, q.limit);
    }
    return sorted;
  }

  /** Все события (новые сверху) */
  getAll(): HistoryEvent[] {
    return [...this.entries].reverse();
  }

  /** Сводная статистика по всей истории */
  getStats(): HistoryStats {
    const stats: HistoryStats = {
      total: 0,
      success: 0,
      failed: 0,
      blocked: 0,
      byAgent: {},
    };
    for (const entry of this.entries) {
      stats.total++;
      if (entry.status === 'success') {
        stats.success++;
      } else if (entry.status === 'failed') {
        stats.failed++;
      } else {
        stats.blocked++;
      }
      stats.byAgent[entry.agentName] =
        (stats.byAgent[entry.agentName] ?? 0) + 1;
    }
    return stats;
  }

  /** Очистить историю */
  clear(): void {
    this.entries = [];
    this.activeRun = null;
  }

  // ── Визуализация цепочки ──

  /**
   * Цепочка выполнения одного запроса: события «запуск → результат».
   * Выбор группы: по runId или taskId; если ничего не передано —
   * используется активный runId или последний runId в истории.
   * Возвращает null, если подходящих событий нет.
   */
  trace(options?: { runId?: string; taskId?: string }): HistoryTrace | null {
    const explicitTaskId = options?.taskId;
    const runId =
      options?.runId ??
      (explicitTaskId
        ? undefined
        : (this.activeRun?.runId ?? this.lastRunId()));

    const events = this.entries.filter(
      (e) =>
        (runId !== undefined && e.runId === runId) ||
        (explicitTaskId !== undefined && e.taskId === explicitTaskId),
    );

    if (events.length === 0) {
      return null;
    }
    return this.buildTrace(runId, explicitTaskId, events);
  }

  /**
   * Все цепочки выполнения, сгруппированные по runId
   * (новые запуски сверху, внутри — хронологический порядок).
   */
  chain(): HistoryTrace[] {
    const groups = new Map<string, HistoryEvent[]>();
    for (const entry of this.entries) {
      if (!entry.runId) continue;
      const group = groups.get(entry.runId);
      if (group) {
        group.push(entry);
      } else {
        groups.set(entry.runId, [entry]);
      }
    }

    const traces: HistoryTrace[] = [];
    for (const [runId, group] of groups) {
      traces.push(this.buildTrace(runId, undefined, group));
    }
    traces.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    return traces;
  }

  // ── Экспорт ──

  /**
   * Экспорт истории в JSON-файл. Путь защищён: только внутри разрешённых
   * корней. Возвращает абсолютный путь записанного файла.
   */
  exportToJson(filePath: string): string {
    const target = this.resolveSafe(filePath);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(this.entries, null, 2), 'utf-8');
      return target;
    } catch (err) {
      throw new Error(`HistoryAgent: ошибка экспорта: ${errorMessage(err)}`, {
        cause: err,
      });
    }
  }

  /**
   * Markdown-сводка истории для чата/report: статистика +
   * последние N событий в виде таблицы.
   */
  exportSummary(limit: number = 50): string {
    const stats = this.getStats();
    const recent = this.find({ limit, sort: 'desc' });

    const lines: string[] = [];
    lines.push('# 📜 История действий агентов');
    lines.push('');
    lines.push(
      `Всего: **${stats.total}** · ✅ успешно: **${stats.success}** · ` +
        `❌ ошибок: **${stats.failed}** · 🚫 заблокировано: **${stats.blocked}**`,
    );

    const agents = Object.keys(stats.byAgent);
    if (agents.length > 0) {
      lines.push('');
      lines.push(`Агенты: ${agents.join(', ')}`);
    }

    lines.push('');
    lines.push('## Последние события');
    if (recent.length === 0) {
      lines.push('Нет записей.');
    } else {
      lines.push('| # | Время (UTC) | Агент | Статус | Действие | Детали |');
      lines.push('|---|-------------|-------|--------|----------|--------|');
      recent.forEach((entry, index) => {
        const emoji =
          entry.status === 'success'
            ? '✅'
            : entry.status === 'failed'
              ? '❌'
              : '🚫';
        const detail = (entry.detail ?? '').replace(/\|/g, '\\|').slice(0, 80);
        lines.push(
          `| ${index + 1} | ${entry.createdAt} | ${entry.agentName} | ` +
            `${emoji} ${entry.status} | ${entry.action} | ${detail} |`,
        );
      });
    }

    return lines.join('\n');
  }

  // ── Helpers ──

  private buildTrace(
    runId: string | undefined,
    taskId: string | undefined,
    events: HistoryEvent[],
  ): HistoryTrace {
    const ordered = [...events].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    return {
      runId,
      taskId,
      startedAt: first?.createdAt,
      completedAt: last?.createdAt,
      durationMs: durationBetween(first, last),
      events: ordered,
      counts: computeStats(ordered),
    };
  }

  /** Последний runId в истории (для trace() без аргументов) */
  private lastRunId(): string | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry?.runId) {
        return entry.runId;
      }
    }
    return undefined;
  }

  /**
   * Преобразует входной путь в абсолютный путь внутри разрешённого корня.
   * Выход за корень блокируется (как в FileAgent).
   */
  private resolveSafe(rawPath: string): string {
    const root = this.roots[0];
    if (!root) {
      throw new Error('HistoryAgent: не настроен корень экспорта');
    }
    const trimmed = (rawPath ?? '').trim();
    if (trimmed === '') {
      throw new Error('HistoryAgent: не указан путь для экспорта');
    }
    if (path.isAbsolute(trimmed)) {
      const resolved = path.normalize(trimmed);
      if (!this.roots.some((entry) => isInside(entry, resolved))) {
        throw new Error(
          `HistoryAgent: путь вне разрешённых корней: ${resolved}`,
        );
      }
      return resolved;
    }
    const resolved = path.resolve(root, trimmed);
    if (!isInside(root, resolved)) {
      throw new Error(`HistoryAgent: выход за пределы корня: ${trimmed}`);
    }
    return resolved;
  }

  private nextId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

// ──────────────────────────────────────────────
// 3. Фабрика и обёртка
// ──────────────────────────────────────────────

/** Создать HistoryAgent с настройками по умолчанию */
export function createHistoryAgent(
  options?: HistoryAgentOptions,
): HistoryAgent {
  return new HistoryAgent(options);
}

/**
 * Обёртка выполнения агента: вызывает agent.execute(input) и фиксирует
 * в истории два события — «запуск» и «результат» (success/failed).
 *
 * Если runId не передан и активной сессии нет — создаётся своя через
 * startRun(), чтобы события собирались в единую цепочку.
 * Обёртка не меняет AgentBase: она работает поверх контракта IAgent.
 */
export async function wrapAgentExecution(
  agent: AgentLike,
  history: HistoryAgent,
  input: unknown,
  options: WrapAgentExecutionOptions = {},
): Promise<AgentResult> {
  const runId =
    options.runId ?? history.activeRunId ?? history.startRun().runId;
  const action = options.action ?? 'execute';

  history.record({
    agentName: agent.name,
    role: options.role,
    runId,
    taskId: options.taskId,
    action,
    detail: 'start',
    status: 'success',
  });

  const startedAt = Date.now();
  let result: AgentResult;
  try {
    result = await agent.execute(input);
  } catch (err) {
    result = {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
      durationMs: Date.now() - startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  history.record({
    agentName: agent.name,
    role: options.role,
    runId,
    taskId: options.taskId,
    action,
    status: result.success ? 'success' : 'failed',
    detail: result.success ? 'ok' : (result.error?.message ?? 'unknown error'),
    durationMs: result.durationMs,
  });

  return result;
}

// ──────────────────────────────────────────────
// 4. Утилиты
// ──────────────────────────────────────────────

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Длительность цепочки от первого до последнего события (мс) */
function durationBetween(
  first: HistoryEvent | undefined,
  last: HistoryEvent | undefined,
): number | undefined {
  if (!first || !last) return undefined;
  const start = Date.parse(first.createdAt);
  const end = Date.parse(last.createdAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return Math.max(0, end - start);
}

/** Подсчёт статусов по списку событий */
function computeStats(events: HistoryEvent[]): HistoryStats {
  const stats: HistoryStats = {
    total: 0,
    success: 0,
    failed: 0,
    blocked: 0,
    byAgent: {},
  };
  for (const entry of events) {
    stats.total++;
    if (entry.status === 'success') {
      stats.success++;
    } else if (entry.status === 'failed') {
      stats.failed++;
    } else {
      stats.blocked++;
    }
    stats.byAgent[entry.agentName] = (stats.byAgent[entry.agentName] ?? 0) + 1;
  }
  return stats;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
