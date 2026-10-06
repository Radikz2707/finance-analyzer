/**
 * LearningAgent — агент обучения на обратной связи.
 *
 * Анализирует историю действий агентов (HistoryAgent/массив событий)
 * и память ИИ (ai-memory записи) как источник фактов:
 * - analyze: метрики успешности по агенту/типу действия, среднее время,
 *   частые ошибки (failed events по action), извлечение «уроков»;
 * - learn/feedback: приём оценки { outcome: 'good'|'bad'; action; agent?; note? }
 *   и сохранение урока в память через DI memorySource (по умолчанию —
 *   ai-memory API saveDecision/getByType с ленивым динамическим импортом,
 *   чтобы не тянуть SQLite-граф при импорте модуля);
 * - predict: эвристическое предсказание следующего действия (топ-1 по частоте
 *   в том же окне + время суток/день недели). ЧЕСТНО помечено как эвристика,
 *   без ML;
 * - report: сводка рекомендаций («повторять X чаще», «избегать Y») —
 *   деривация из уроков и метрик.
 *
 * Веса уроков устаревают по экспоненциальному полураспаду
 * (по умолчанию halfLifeDays = 30): computeDecayedWeight().
 *
 * DI: historySource и memorySource инжектируются, чтобы тесты не трогали
 * реальную БД. Падение источника обрабатывается честно — в результат
 * добавляется warning, данные НЕ выдумываются.
 */

import { randomUUID } from 'node:crypto';
import type { AgentResult } from '../agent/types.js';
import type { AgentActionInput } from '../agent/agent-contract.js';

// ──────────────────────────────────────────────
// 1. Типы LearningAgent
// ──────────────────────────────────────────────

/** Статус события истории (совместим с HistoryStatus HistoryAgent) */
export type LearningStatus = 'success' | 'failed' | 'blocked';

/** Оценка результата действия пользователем/системой */
export type LearningOutcome = 'good' | 'bad';

/** Откуда появился урок */
export type LessonSource = 'feedback' | 'history' | 'analysis';

/** Действия, поддерживаемые LearningAgent */
export type LearningAction = 'analyze' | 'learn' | 'predict' | 'report';

/**
 * Минимальное событие истории для анализа.
 * HistoryEvent HistoryAgent структурно совместим (поля не обязательные),
 * поэтому HistoryEvent[] можно передавать напрямую.
 */
export interface LearningEvent {
  /** Имя агента, выполнившего действие (опционально) */
  agentName?: string;
  /** Действие (например, 'read', 'execute', 'security.check') */
  action: string;
  /** Статус выполнения */
  status: LearningStatus;
  /** Время выполнения в миллисекундах */
  durationMs?: number;
  /** Метка времени создания */
  createdAt: string;
  /** Детали/описание (например, текст ошибки) */
  detail?: string;
}

/** Урок, сохранённый в память */
export interface Lesson {
  /** Уникальный ID урока */
  id: string;
  /** Паттерн «агент:действие:исход» (например, 'terminal.execute:good') */
  pattern: string;
  /** Действие, к которому относится урок */
  action: string;
  /** Оценка результата */
  outcome: LearningOutcome;
  /** Базовый вес урока (устанавливается при создании) */
  weight: number;
  /** Метка времени создания урока */
  createdAt: string;
  /** Источник урока */
  source: LessonSource;
  /** Агент, к которому относится урок (опционально) */
  agent?: string;
  /** Комментарий пользователя (опционально) */
  note?: string;
}

/** Входные данные обратной связи */
export interface FeedbackEntry {
  /** Оценка результата */
  outcome: LearningOutcome;
  /** Действие, которое оценивается */
  action: string;
  /** Агент, выполнивший действие (опционально) */
  agent?: string;
  /** Комментарий пользователя (опционально) */
  note?: string;
  /** Начальный вес урока (по умолчанию defaultWeight = 1) */
  weight?: number;
}

/** Источник памяти: чтение/запись уроков */
export interface LearningMemorySource {
  /** Сохранить урок, вернуть ID */
  saveLesson(lesson: Lesson): string | Promise<string>;
  /** Получить все сохранённые уроки */
  getLessons(): readonly Lesson[] | Promise<readonly Lesson[]>;
}

/** Опции конфигурации LearningAgent (DI) */
export interface LearningAgentOptions {
  /** DI: источник истории действий (по умолчанию — пустой массив) */
  historySource?: () =>
    readonly LearningEvent[] | Promise<readonly LearningEvent[]>;
  /** DI: источник уроков в памяти (по умолчанию — ai-memory API) */
  memorySource?: LearningMemorySource;
  /** Период полураспада весов уроков в днях (по умолчанию 30) */
  halfLifeDays?: number;
  /** Вес урока по умолчанию (по умолчанию 1) */
  defaultWeight?: number;
  /** DI: часы для детерминированных тестов (по умолчанию new Date()) */
  now?: () => Date;
}

/** Метрики одного действия */
export interface ActionMetrics {
  action: string;
  total: number;
  success: number;
  failed: number;
  blocked: number;
  /** Доля успехов 0..1 (0 при отсутствии событий) */
  successRate: number;
  /** Средняя длительность в мс (если есть данные) */
  avgDurationMs?: number;
}

/** Метрики одного агента */
export interface AgentMetrics {
  agentName: string;
  total: number;
  successRate: number;
  actions: ActionMetrics[];
}

/** Частая ошибка: failed-события, сгруппированные по действию */
export interface CommonFailure {
  action: string;
  agentName?: string;
  count: number;
  /** Время последней ошибки (ISO) */
  lastAt: string;
  /** Пример деталей последней ошибки */
  exampleDetail?: string;
}

/** Сводные метрики успешности */
export interface LearningMetrics {
  totalEvents: number;
  /** Общая доля успехов 0..1 */
  successRate: number;
  /** Средняя длительность в мс (если есть данные) */
  avgDurationMs?: number;
  /** Метрики по действиям (сортировка: по убыванию числа событий) */
  byAction: ActionMetrics[];
  /** Метрики по агентам */
  byAgent: AgentMetrics[];
  /** Частые ошибки (топ-5 по числу failed) */
  commonFailures: CommonFailure[];
  windowMs?: number;
  scope?: string;
}

/** Результат анализа */
export interface AnalyzeResult {
  summary: string;
  metrics: LearningMetrics;
  lessons: Lesson[];
  /** Честные предупреждения о падении источников */
  warnings: string[];
}

/** Результат предсказания */
export interface PredictResult {
  /** Вероятное следующее действие или null (нет данных) */
  nextActionLikely: string | null;
  /** Уверенность 0..1 (доля частоты) */
  confidence: number;
  /** Причины предсказания */
  reasons: string[];
  /** Всегда true: предсказание — эвристика без ML */
  heuristic: true;
  warnings: string[];
}

/** Результат сводки рекомендаций */
export interface ReportResult {
  summary: string;
  recommendations: string[];
  lessons: Lesson[];
  metrics: LearningMetrics;
  warnings: string[];
}

/**
 * Входные данные execute().
 * Расширяет единый стандарт входа action-агента `AgentActionInput`.
 */
export interface LearningAgentInput extends AgentActionInput<LearningAction> {
  action: LearningAction;
  /** Окно анализа в мс (по умолчанию — вся история) */
  windowMs?: number;
  /** Фильтр по имени агента */
  scope?: string;
  /** Обратная связь (обязательна для action: 'learn') */
  feedback?: FeedbackEntry;
}

/** Выходные данные execute(): дискриминированный союз по kind */
export type LearningAgentOutput =
  | { kind: 'analyze'; value: AnalyzeResult }
  | { kind: 'learn'; value: Lesson }
  | { kind: 'predict'; value: PredictResult }
  | { kind: 'report'; value: ReportResult };

/** Ошибка LearningAgent (честный проброс падения источника записи) */
export class LearningAgentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LearningAgentError';
  }
}

// ──────────────────────────────────────────────
// 2. Константы и чистые функции
// ──────────────────────────────────────────────

/** Период полураспада весов уроков по умолчанию (дней) */
export const DEFAULT_HALF_LIFE_DAYS = 30;
/** Вес урока по умолчанию */
export const DEFAULT_LESSON_WEIGHT = 1;
/** Максимум отображаемых частых ошибок */
const MAX_COMMON_FAILURES = 5;
/** Ключевое слово в ai-memory для поиска уроков */
const LESSON_KEYWORD = 'lesson';

const WEEKDAY_NAMES = [
  'воскресенье',
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
];

/**
 * Экспоненциальный полураспад веса: weight * 0.5 ^ (age / halfLifeDays).
 * Возраст не может быть отрицательным; halfLifeDays <= 0 — без устаревания.
 */
export function computeDecayedWeight(
  baseWeight: number,
  createdAt: string,
  now: Date,
  halfLifeDays: number,
): number {
  if (halfLifeDays <= 0 || !Number.isFinite(baseWeight)) return baseWeight;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return baseWeight;
  const ageMs = Math.max(0, now.getTime() - created);
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
  return baseWeight * Math.pow(0.5, ageMs / halfLifeMs);
}

/** Построить паттерн урока: [agent:]action:outcome */
export function buildLessonPattern(
  action: string,
  outcome: LearningOutcome,
  agent?: string,
): string {
  const prefix = agent && agent.trim().length > 0 ? `${agent.trim()}:` : '';
  return `${prefix}${action}:${outcome}`;
}

/** Распарсить урок из JSON-контента записи памяти; null при некорректных данных */
export function parseStoredLesson(content: string): Lesson | null {
  try {
    const raw = JSON.parse(content) as unknown;
    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (
      typeof obj.id !== 'string' ||
      typeof obj.pattern !== 'string' ||
      typeof obj.action !== 'string' ||
      (obj.outcome !== 'good' && obj.outcome !== 'bad') ||
      typeof obj.weight !== 'number' ||
      typeof obj.createdAt !== 'string'
    ) {
      return null;
    }
    const lesson: Lesson = {
      id: obj.id,
      pattern: obj.pattern,
      action: obj.action,
      outcome: obj.outcome,
      weight: obj.weight,
      createdAt: obj.createdAt,
      source:
        obj.source === 'history' || obj.source === 'analysis'
          ? obj.source
          : 'feedback',
      agent: typeof obj.agent === 'string' ? obj.agent : undefined,
      note: typeof obj.note === 'string' ? obj.note : undefined,
    };
    return lesson;
  } catch {
    return null;
  }
}

/** Сообщение об ошибке любой природы */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Процент 0..1 → строка '42%' */
function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Человекочитаемое окно анализа */
function humanizeWindow(ms?: number): string {
  if (!ms || ms <= 0) return 'всё время';
  const hours = ms / 3_600_000;
  if (hours >= 24) return `${Math.round(hours / 24)} дн`;
  if (hours >= 1) return `${Math.round(hours)} ч`;
  return `${Math.max(1, Math.round(ms / 60_000))} мин`;
}

/** Округление до 2 знаков */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ──────────────────────────────────────────────
// 3. Источник памяти по умолчанию (ai-memory)
// ──────────────────────────────────────────────

/**
 * По умолчанию уроки хранятся в оперативной памяти ai-memory
 * как записи типа 'decision' с keyword 'lesson' (через saveDecision).
 * Импорт ai-memory — ленивый (динамический), чтобы не тянуть граф
 * better-sqlite3 при импорте модуля learning-agent.
 */
function createDefaultMemorySource(): LearningMemorySource {
  return {
    async saveLesson(lesson: Lesson): Promise<string> {
      const api = await import('../ai-memory/index.js');
      return api.saveDecision(JSON.stringify(lesson), [
        LESSON_KEYWORD,
        lesson.outcome,
        lesson.action,
      ]);
    },
    async getLessons(): Promise<Lesson[]> {
      const api = await import('../ai-memory/index.js');
      const entries = api.getByType('decision', 500);
      const lessons: Lesson[] = [];
      for (const entry of entries) {
        if (!entry.keywords.includes(LESSON_KEYWORD)) continue;
        const lesson = parseStoredLesson(entry.content);
        if (lesson) lessons.push(lesson);
      }
      return lessons;
    },
  };
}

// ──────────────────────────────────────────────
// 4. LearningAgent
// ──────────────────────────────────────────────

/**
 * Агент обучения на обратной связи: анализ истории, уроки,
 * эвристическое предсказание и сводка рекомендаций.
 */
export class LearningAgent {
  readonly name = 'LearningAgent';

  private readonly historySource: () =>
    readonly LearningEvent[] | Promise<readonly LearningEvent[]>;
  private readonly memorySource: LearningMemorySource;
  private readonly halfLifeDays: number;
  private readonly defaultWeight: number;
  private readonly now: () => Date;

  constructor(options?: LearningAgentOptions) {
    this.historySource = options?.historySource ?? (() => []);
    this.memorySource = options?.memorySource ?? createDefaultMemorySource();
    this.halfLifeDays = options?.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
    this.defaultWeight = options?.defaultWeight ?? DEFAULT_LESSON_WEIGHT;
    this.now = options?.now ?? (() => new Date());
  }

  // ── Внутренние помощники ──

  /** Применить полураспад к уроку: копия с актуальным весом */
  private decayLesson(lesson: Lesson): Lesson {
    return {
      ...lesson,
      weight: computeDecayedWeight(
        lesson.weight,
        lesson.createdAt,
        this.now(),
        this.halfLifeDays,
      ),
    };
  }

  /** Загрузить уроки из памяти с применённым устареванием весов */
  private async loadLessons(): Promise<Lesson[]> {
    const stored = await this.memorySource.getLessons();
    return stored.map((lesson) => this.decayLesson(lesson));
  }

  /** Отфильтровать события по окну времени и scope (агенту) */
  private filterEvents(
    events: readonly LearningEvent[],
    opts: { windowMs?: number; scope?: string },
  ): LearningEvent[] {
    const nowTs = this.now().getTime();
    return events.filter((event) => {
      if (opts.scope && event.agentName !== opts.scope) return false;
      if (opts.windowMs && opts.windowMs > 0) {
        const t = Date.parse(event.createdAt);
        if (Number.isFinite(t) && t < nowTs - opts.windowMs) return false;
      }
      return true;
    });
  }

  /** Посчитать метрики по событиям */
  private computeMetrics(
    events: readonly LearningEvent[],
    opts: { windowMs?: number; scope?: string },
  ): LearningMetrics {
    interface ActionAccum {
      total: number;
      success: number;
      failed: number;
      blocked: number;
      durations: number[];
    }
    interface AgentAccum {
      total: number;
      success: number;
      actions: Map<string, ActionAccum>;
    }

    const actionMap = new Map<string, ActionAccum>();
    const agentMap = new Map<string, AgentAccum>();
    const failureAgg = new Map<string, CommonFailure>();
    let totalSuccess = 0;

    for (const event of events) {
      const actionName = event.action.length > 0 ? event.action : 'unknown';
      const agentName = event.agentName?.trim().length
        ? event.agentName
        : 'unknown';

      let acc = actionMap.get(actionName);
      if (!acc) {
        acc = {
          total: 0,
          success: 0,
          failed: 0,
          blocked: 0,
          durations: [],
        };
        actionMap.set(actionName, acc);
      }
      acc.total += 1;
      if (event.status === 'success') {
        acc.success += 1;
        totalSuccess += 1;
      } else if (event.status === 'failed') {
        acc.failed += 1;
      } else if (event.status === 'blocked') {
        acc.blocked += 1;
      }
      if (
        typeof event.durationMs === 'number' &&
        Number.isFinite(event.durationMs)
      ) {
        acc.durations.push(event.durationMs);
      }

      let agentAcc = agentMap.get(agentName);
      if (!agentAcc) {
        agentAcc = { total: 0, success: 0, actions: new Map() };
        agentMap.set(agentName, agentAcc);
      }
      agentAcc.total += 1;
      if (event.status === 'success') agentAcc.success += 1;
      const aAcc = agentAcc.actions.get(actionName);
      if (aAcc) {
        aAcc.total += 1;
        if (event.status === 'success') aAcc.success += 1;
        if (event.status === 'failed') aAcc.failed += 1;
        if (event.status === 'blocked') aAcc.blocked += 1;
        if (
          typeof event.durationMs === 'number' &&
          Number.isFinite(event.durationMs)
        ) {
          aAcc.durations.push(event.durationMs);
        }
      } else {
        agentAcc.actions.set(actionName, {
          total: 1,
          success: event.status === 'success' ? 1 : 0,
          failed: event.status === 'failed' ? 1 : 0,
          blocked: event.status === 'blocked' ? 1 : 0,
          durations:
            typeof event.durationMs === 'number' &&
            Number.isFinite(event.durationMs)
              ? [event.durationMs]
              : [],
        });
      }

      if (event.status === 'failed') {
        const key = `${agentName}:${actionName}`;
        let failure = failureAgg.get(key);
        if (!failure) {
          failure = {
            action: actionName,
            agentName: event.agentName?.trim().length
              ? event.agentName
              : undefined,
            count: 0,
            lastAt: event.createdAt,
            exampleDetail: event.detail,
          };
          failureAgg.set(key, failure);
        }
        failure.count += 1;
        if (Date.parse(event.createdAt) > Date.parse(failure.lastAt)) {
          failure.lastAt = event.createdAt;
          failure.exampleDetail = event.detail;
        }
      }
    }

    const toActionMetrics = (
      acc: ActionAccum,
      actionName: string,
    ): ActionMetrics => {
      const durations = acc.durations;
      const metrics: ActionMetrics = {
        action: actionName,
        total: acc.total,
        success: acc.success,
        failed: acc.failed,
        blocked: acc.blocked,
        successRate: acc.total > 0 ? acc.success / acc.total : 0,
      };
      if (durations.length > 0) {
        metrics.avgDurationMs =
          durations.reduce((sum, d) => sum + d, 0) / durations.length;
      }
      return metrics;
    };

    const byAction: ActionMetrics[] = [...actionMap.entries()]
      .map(([name, acc]) => toActionMetrics(acc, name))
      .sort((a, b) => b.total - a.total);

    const byAgent: AgentMetrics[] = [...agentMap.entries()]
      .map(([name, acc]) => {
        const actions: ActionMetrics[] = [...acc.actions.entries()]
          .map(([aName, aAcc]) => toActionMetrics(aAcc, aName))
          .sort((a, b) => b.total - a.total);
        return {
          agentName: name,
          total: acc.total,
          successRate: acc.total > 0 ? acc.success / acc.total : 0,
          actions,
        };
      })
      .sort((a, b) => b.total - a.total);

    const commonFailures: CommonFailure[] = [...failureAgg.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_COMMON_FAILURES);

    const allDurations: number[] = [];
    for (const acc of actionMap.values()) {
      for (const d of acc.durations) allDurations.push(d);
    }

    const metrics: LearningMetrics = {
      totalEvents: events.length,
      successRate: events.length > 0 ? totalSuccess / events.length : 0,
      byAction,
      byAgent,
      commonFailures,
    };
    if (allDurations.length > 0) {
      metrics.avgDurationMs =
        allDurations.reduce((sum, d) => sum + d, 0) / allDurations.length;
    }
    if (opts.windowMs) metrics.windowMs = opts.windowMs;
    if (opts.scope) metrics.scope = opts.scope;
    return metrics;
  }

  /** Рекомендации из уроков и метрик */
  private buildRecommendations(
    metrics: LearningMetrics,
    lessons: Lesson[],
  ): string[] {
    const recs: string[] = [];
    const goodWeights = new Map<string, number>();
    const badWeights = new Map<string, number>();
    for (const lesson of lessons) {
      if (lesson.weight <= 0.01) continue; // полностью устаревший урок не влияет
      const target = lesson.outcome === 'good' ? goodWeights : badWeights;
      target.set(
        lesson.action,
        (target.get(lesson.action) ?? 0) + lesson.weight,
      );
    }
    for (const [action, weight] of goodWeights) {
      recs.push(
        `Повторять «${action}» чаще — отмечено как хорошее (вес ${round2(weight)}).`,
      );
    }
    for (const [action, weight] of badWeights) {
      recs.push(
        `Избегать «${action}» — отмечено как плохое (вес ${round2(weight)}).`,
      );
    }
    for (const am of metrics.byAction) {
      if (am.total >= 2 && am.failed >= 1 && am.successRate < 0.5) {
        recs.push(
          `Проверить «${am.action}»: успех ${formatPercent(am.successRate)} (${am.success}/${am.total}), ошибок ${am.failed}.`,
        );
      }
    }
    return recs;
  }

  // ── Публичное API ──

  /**
   * Анализ успешности действий по истории и урокам.
   * Падение источников → warning в результате (данные не выдумываются).
   */
  async analyze(input?: {
    windowMs?: number;
    scope?: string;
  }): Promise<AnalyzeResult> {
    const opts = input ?? {};
    const warnings: string[] = [];
    let events: LearningEvent[] = [];
    try {
      events = this.filterEvents(await this.historySource(), opts);
    } catch (error) {
      warnings.push(`history source failed: ${errorMessage(error)}`);
    }
    let lessons: Lesson[] = [];
    try {
      lessons = await this.loadLessons();
    } catch (error) {
      warnings.push(`memory source failed: ${errorMessage(error)}`);
    }

    const metrics = this.computeMetrics(events, opts);
    const scopePart = opts.scope ? ` по агенту «${opts.scope}»` : '';
    let summary: string;
    if (metrics.totalEvents === 0 && lessons.length === 0) {
      summary = `Анализ${scopePart} за ${humanizeWindow(metrics.windowMs)}: данных нет (пустая история и память).`;
    } else {
      const topFailure = metrics.commonFailures[0];
      const failurePart = topFailure
        ? ` Частая ошибка: «${topFailure.action}» (${topFailure.count}×)${topFailure.agentName ? ` у агента ${topFailure.agentName}` : ''}.`
        : '';
      summary =
        `Анализ${scopePart} за ${humanizeWindow(metrics.windowMs)}: ` +
        `${metrics.totalEvents} событий, успех ${formatPercent(metrics.successRate)}` +
        (metrics.avgDurationMs !== undefined
          ? `, среднее время ${Math.round(metrics.avgDurationMs)} мс`
          : '') +
        `, уроков в памяти: ${lessons.length}.` +
        failurePart;
    }
    if (warnings.length > 0) {
      summary += ` Предупреждения: ${warnings.join('; ')}`;
    }
    return { summary, metrics, lessons, warnings };
  }

  /**
   * Принять обратную связь и сохранить урок в память.
   * Падение источника записи → LearningAgentError (честная ошибка).
   */
  async feedback(
    entry: FeedbackEntry,
    opts?: { weight?: number },
  ): Promise<Lesson> {
    const now = this.now();
    const weightValue = opts?.weight ?? entry.weight;
    const lesson: Lesson = {
      id: randomUUID(),
      pattern: buildLessonPattern(entry.action, entry.outcome, entry.agent),
      action: entry.action,
      outcome: entry.outcome,
      weight:
        typeof weightValue === 'number' &&
        Number.isFinite(weightValue) &&
        weightValue > 0
          ? weightValue
          : this.defaultWeight,
      createdAt: now.toISOString(),
      source: 'feedback',
      agent: entry.agent,
      note: entry.note,
    };
    try {
      await this.memorySource.saveLesson(lesson);
    } catch (error) {
      throw new LearningAgentError(
        `Не удалось сохранить урок (${lesson.pattern}): ${errorMessage(error)}`,
        { cause: error },
      );
    }
    return lesson;
  }

  /** alias для feedback (action: 'learn') */
  async learn(input: { feedback: FeedbackEntry }): Promise<Lesson> {
    if (!input.feedback) {
      throw new LearningAgentError('learn: отсутствует поле feedback');
    }
    return this.feedback(input.feedback);
  }

  /**
   * Эвристическое предсказание следующего действия:
   * топ-1 по частоте в окне + время суток/день недели пиковой активности.
   * Пустая история → null с честной причиной.
   */
  async predict(input?: {
    windowMs?: number;
    scope?: string;
  }): Promise<PredictResult> {
    const opts = input ?? {};
    const warnings: string[] = [];
    let events: LearningEvent[] = [];
    try {
      events = this.filterEvents(await this.historySource(), opts);
    } catch (error) {
      warnings.push(`history source failed: ${errorMessage(error)}`);
    }

    if (events.length === 0) {
      const reason =
        warnings.length > 0
          ? 'История недоступна (падение источника) — предсказание невозможно'
          : 'История пуста за выбранное окно — предсказание невозможно';
      return {
        nextActionLikely: null,
        confidence: 0,
        reasons: [reason, ...warnings],
        heuristic: true,
        warnings,
      };
    }

    const counts = new Map<string, number>();
    const hourCounts = new Map<number, number>();
    const weekdayCounts = new Map<number, number>();
    for (const event of events) {
      counts.set(event.action, (counts.get(event.action) ?? 0) + 1);
      const t = Date.parse(event.createdAt);
      if (Number.isFinite(t)) {
        const d = new Date(t);
        hourCounts.set(d.getHours(), (hourCounts.get(d.getHours()) ?? 0) + 1);
        weekdayCounts.set(d.getDay(), (weekdayCounts.get(d.getDay()) ?? 0) + 1);
      }
    }

    // Топ-1: сначала частота, при равенстве — лексикографически первый
    let bestAction: string | null = null;
    let bestCount = 0;
    for (const action of [...counts.keys()].sort()) {
      const count = counts.get(action) ?? 0;
      if (count > bestCount) {
        bestAction = action;
        bestCount = count;
      }
    }

    const reasons: string[] = [];
    if (bestAction !== null) {
      reasons.push(
        `«${bestAction}» встречается чаще всего: ${bestCount} из ${events.length} событий (${formatPercent(bestCount / events.length)}).`,
      );
    }

    let bestHour: number | null = null;
    let bestHourCount = 0;
    for (const [hour, count] of [...hourCounts.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      if (count > bestHourCount) {
        bestHour = hour;
        bestHourCount = count;
      }
    }
    if (bestHour !== null && bestHourCount >= 2) {
      reasons.push(
        `Пик активности около ${String(bestHour).padStart(2, '0')}:00 — ${bestHourCount} событий.`,
      );
    }

    let bestWeekday: number | null = null;
    let bestWeekdayCount = 0;
    for (const [wd, count] of [...weekdayCounts.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      if (count > bestWeekdayCount) {
        bestWeekday = wd;
        bestWeekdayCount = count;
      }
    }
    if (bestWeekday !== null && bestWeekdayCount >= 2) {
      const dayName = WEEKDAY_NAMES[bestWeekday] ?? 'день недели';
      reasons.push(
        `Чаще всего запуски происходят в ${dayName} (${bestWeekdayCount}).`,
      );
    }

    reasons.push(
      'Предсказание — простая эвристика (топ-1 по частоте), без ML.',
    );
    reasons.push(...warnings);

    return {
      nextActionLikely: bestAction,
      confidence: bestAction !== null ? bestCount / events.length : 0,
      reasons,
      heuristic: true,
      warnings,
    };
  }

  /** Сводка рекомендаций на основе уроков и метрик */
  async report(input?: {
    windowMs?: number;
    scope?: string;
  }): Promise<ReportResult> {
    const opts = input ?? {};
    const warnings: string[] = [];
    let events: LearningEvent[] = [];
    try {
      events = this.filterEvents(await this.historySource(), opts);
    } catch (error) {
      warnings.push(`history source failed: ${errorMessage(error)}`);
    }
    let lessons: Lesson[] = [];
    try {
      lessons = await this.loadLessons();
    } catch (error) {
      warnings.push(`memory source failed: ${errorMessage(error)}`);
    }

    const metrics = this.computeMetrics(events, opts);
    const recommendations = this.buildRecommendations(metrics, lessons);
    let summary: string;
    if (recommendations.length === 0) {
      summary =
        `Сводка за ${humanizeWindow(metrics.windowMs)}: рекомендаций пока нет — ` +
        `недостаточно данных (уроков: ${lessons.length}, событий: ${metrics.totalEvents}).`;
    } else {
      summary =
        `Сводка за ${humanizeWindow(metrics.windowMs)}: ${recommendations.length} рекомендаций ` +
        `на основе ${lessons.length} уроков и ${metrics.totalEvents} событий.`;
    }
    if (warnings.length > 0) {
      summary += ` Предупреждения: ${warnings.join('; ')}`;
    }
    return { summary, recommendations, lessons, metrics, warnings };
  }

  /** Получить уроки из памяти с применённым устареванием весов */
  async getLessons(): Promise<Lesson[]> {
    return this.loadLessons();
  }

  /**
   * Точка входа, совместимая с контрактом AgentResult:
   * execute({ action: 'analyze'|'learn'|'predict'|'report', ... }).
   */
  async execute(
    input: LearningAgentInput,
  ): Promise<AgentResult<LearningAgentOutput>> {
    const startedAt = Date.now();
    const complete = (
      data?: LearningAgentOutput,
      error?: Error,
    ): AgentResult<LearningAgentOutput> => ({
      success: data !== undefined && error === undefined,
      data,
      error,
      durationMs: Date.now() - startedAt,
      completedAt: new Date().toISOString(),
    });

    try {
      switch (input.action) {
        case 'analyze':
          return complete({
            kind: 'analyze',
            value: await this.analyze({
              windowMs: input.windowMs,
              scope: input.scope,
            }),
          });
        case 'learn': {
          if (!input.feedback) {
            throw new LearningAgentError('learn: требуется поле feedback');
          }
          return complete({
            kind: 'learn',
            value: await this.feedback(input.feedback),
          });
        }
        case 'predict':
          return complete({
            kind: 'predict',
            value: await this.predict({
              windowMs: input.windowMs,
              scope: input.scope,
            }),
          });
        case 'report':
          return complete({
            kind: 'report',
            value: await this.report({
              windowMs: input.windowMs,
              scope: input.scope,
            }),
          });
        default:
          return complete(
            undefined,
            new LearningAgentError(`Неизвестное действие: ${input.action}`),
          );
      }
    } catch (error) {
      return complete(
        undefined,
        error instanceof Error ? error : new LearningAgentError(String(error)),
      );
    }
  }
}
