/**
 * SchedulerAgent — агент планирования задач.
 *
 * Агент-обёртка над cron/interval-планированием:
 * - регистрация job'ов по расписанию: cron (5 полей) или интервал (мс);
 * - автоматический запуск pipeline через DI-колбэк runPipeline
 *   (как в AdaptiveScheduler — без жёсткой связи с PipelineCoordinator);
 * - реакция на события (news / price-change / file-change) через onEvent();
 * - уведомления в Telegram через DI-колбэк sendNotification (клиент
 *   НЕ подключается — реальное подключение вне этой задачи);
 * - управление: pause / resume / unschedule / list / trigger.
 *
 * Внутренний цикл — один интервальный тик (по умолчанию 1 с, настраивается
 * tickMs), который проверяет due-задачи; это упрощает тестирование
 * (fake timers) и повторное использование cron-утилит из cron-utils.ts.
 *
 * Состояние in-memory (персистентность не требуется); экспорт текущего
 * состояния — метод exportState().
 */

import { nextCronRun, parseCron } from '../cron-utils.js';
import type { AgentResult, AgentState, AgentSummary } from '../agent/types.js';
import type { AgentActionInput } from '../agent/agent-contract.js';

// ──────────────────────────────────────────────
// 1. Типы SchedulerAgent
// ──────────────────────────────────────────────

/** Действие управления планировщиком */
export type SchedulerAgentAction =
  'schedule' | 'unschedule' | 'list' | 'trigger' | 'pause' | 'resume';

/** Типы событий, на которые можно подписать job */
export type SchedulerEventType = 'news' | 'price-change' | 'file-change';

/** Статус последнего выполнения job'а */
export type SchedulerJobStatus = 'success' | 'failed';

/** Задача, которую выполняет job */
export interface SchedulerJobTask {
  /** kind: 'pipeline' — вызывает runPipeline; 'callback' — именованный колбэк */
  kind: 'pipeline' | 'callback';
  /** Имя колбэка из опций callbacks (обязателен при kind: 'callback') */
  callbackName?: string;
}

/** Конфигурация уведомлений job'а */
export interface SchedulerNotifyConfig {
  /** Уведомления включены */
  enabled: boolean;
  /** Слать уведомление после успешного выполнения */
  onSuccess?: boolean;
  /** Слать уведомление после падения */
  onFailure?: boolean;
  /** Канал доставки (пока только telegram) */
  channel: 'telegram';
}

/** Фильтр подписки job'а на события */
export interface SchedulerEventFilter {
  /** Типы событий (пустой/отсутствующий список = любые) */
  types?: SchedulerEventType[];
  /** Дополнительный фильтр по символам (если payload.symbol задан) */
  symbols?: string[];
}

/**
 * Входные данные SchedulerAgent.
 * Расширяет единый стандарт входа action-агента `AgentActionInput`.
 */
export interface SchedulerAgentInput extends AgentActionInput<SchedulerAgentAction> {
  /** ID job'а (для schedule — опционально, генерируется; иначе — обязателен) */
  jobId?: string;
  /** Cron-выражение из 5 полей (для schedule) */
  cron?: string;
  /** Интервал в мс (для schedule; взаимоисключающ с cron) */
  intervalMs?: number;
  /** Задача job'а (для schedule) */
  task?: SchedulerJobTask;
  /** Подписка на события */
  eventFilter?: SchedulerEventFilter;
  /** Уведомления */
  notify?: SchedulerNotifyConfig;
  /** Выполнить немедленно при регистрации (по умолчанию false) */
  atStart?: boolean;
}

/** Публичная информация о зарегистрированном job'е */
export interface ScheduledJobInfo {
  jobId: string;
  /** Cron-выражение (если job по расписанию cron) */
  cron?: string;
  /** Интервал в мс (если job по интервалу) */
  intervalMs?: number;
  /** Задача */
  task: SchedulerJobTask;
  /** Подписка на события */
  eventFilter?: SchedulerEventFilter;
  /** Уведомления */
  notify?: SchedulerNotifyConfig;
  /** Активен ли (false после pause) */
  enabled: boolean;
  /** Следующий запланированный запуск (ISO) или null для event-only */
  nextRunAt?: string | null;
  /** Последний запуск (ISO) */
  lastRunAt?: string | null;
  /** Статус последнего запуска */
  lastStatus?: SchedulerJobStatus | null;
  /** Сколько раз выполнялся */
  runs: number;
  /** Выполняется ли прямо сейчас */
  running: boolean;
}

/** Результат ручного/немедленного запуска job'а */
export interface SchedulerTriggerResult {
  jobId: string;
  result: {
    status: SchedulerJobStatus;
    /** Момент завершения (ISO) */
    at: string;
    durationMs?: number;
    error?: string;
  };
}

/** Выходные данные SchedulerAgent */
export interface SchedulerAgentOutput {
  /** Выполненное действие */
  action: SchedulerAgentAction;
  /** Все зарегистрированные job'ы (после действия) */
  jobs: ScheduledJobInfo[];
  /** Человекочитаемое описание результата */
  message: string;
  /** Результат немедленного запуска (только для action: 'trigger') */
  triggered?: SchedulerTriggerResult;
}

/** Событие для onEvent() */
export interface SchedulerAgentEvent {
  type: SchedulerEventType;
  payload?: unknown;
}

/** Опции конфигурации SchedulerAgent (DI) */
export interface SchedulerAgentOptions {
  /** Интервал тика проверки due-задач в мс (по умолчанию 1000) */
  tickMs?: number;
  /** DI: запуск pipeline (job kind: 'pipeline') */
  runPipeline?: () => unknown;
  /** DI: именованные колбэки (job kind: 'callback') */
  callbacks?: Record<string, () => unknown>;
  /** DI: отправка уведомлений (Telegram) */
  sendNotification?: (message: string) => unknown;
  /** DI: часы (epoch мс) */
  now?: () => number;
  /** DI: таймер задержки */
  setTimeout?: typeof globalThis.setTimeout;
  /** DI: отмена таймера */
  clearTimeout?: typeof globalThis.clearTimeout;
  /** Автостарт тика при создании (по умолчанию false) */
  autostart?: boolean;
}

/** Внутреннее состояние job'а (не публикуется наружу целиком) */
interface InternalScheduledJob {
  jobId: string;
  cron?: string;
  intervalMs?: number;
  task: SchedulerJobTask;
  eventFilter?: SchedulerEventFilter;
  notify?: SchedulerNotifyConfig;
  enabled: boolean;
  /** Epoch мс следующего запуска (null — event-only job) */
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: SchedulerJobStatus | null;
  runs: number;
  running: boolean;
}

/** Причина запуска job'а */
type LaunchReason = 'schedule' | 'event' | 'trigger';

// ──────────────────────────────────────────────
// 2. SchedulerAgent
// ──────────────────────────────────────────────

/** Интервал тика по умолчанию: 1 с */
export const DEFAULT_TICK_MS = 1000;

export class SchedulerAgent {
  public readonly name = 'SchedulerAgent';

  private readonly tickMs: number;
  private readonly runPipeline: (() => unknown) | undefined;
  private readonly callbacks: Record<string, () => unknown>;
  private readonly sendNotification: ((message: string) => unknown) | undefined;
  private readonly now: () => number;
  private readonly setTimer: (
    handler: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;

  private readonly jobs = new Map<string, InternalScheduledJob>();
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private totalExecutions = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private lastExecution: AgentSummary['lastExecution'] | undefined;

  constructor(options: SchedulerAgentOptions = {}) {
    this.tickMs =
      options.tickMs && options.tickMs > 0 ? options.tickMs : DEFAULT_TICK_MS;
    this.runPipeline = options.runPipeline;
    this.callbacks = options.callbacks ?? {};
    this.sendNotification = options.sendNotification;
    this.now = options.now ?? (() => Date.now());

    // Обёртки поверх глобальных таймеров: fake timers (vitest) перехватывают
    // globalThis.setTimeout/clearTimeout в момент вызова, а не импорта.
    this.setTimer =
      options.setTimeout !== undefined
        ? (handler, ms) => options.setTimeout!(handler, ms)
        : (handler, ms) => setTimeout(handler, ms);
    this.clearTimer =
      options.clearTimeout !== undefined
        ? (handle) => options.clearTimeout!(handle)
        : (handle) => clearTimeout(handle);

    if (options.autostart) {
      this.start();
    }
  }

  // ── Жизненный цикл ──

  /** Запустить тик планировщика (идемпотентно). */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.scheduleNextTick();
  }

  /** Остановить тик планировщика. Повторный start() возобновит работу. */
  async stop(): Promise<void> {
    this.started = false;
    if (this.tickTimer !== null) {
      this.clearTimer(this.tickTimer);
      this.tickTimer = null;
    }
  }

  // ── Основная точка управления ──

  /**
   * Выполнить действие планировщика (schedule/unschedule/list/trigger/pause/resume).
   * Бросает ошибку при невалидном входе или отсутствующем jobId.
   */
  async handle(input: SchedulerAgentInput): Promise<SchedulerAgentOutput> {
    switch (input.action) {
      case 'schedule':
        return this.schedule(input);
      case 'unschedule':
        return this.unschedule(input);
      case 'list':
        return this.listJobs();
      case 'trigger':
        return this.trigger(input);
      case 'pause':
        return this.setEnabled(input, false);
      case 'resume':
        return this.setEnabled(input, true);
      default: {
        const exhaustive: never = input.action;
        throw new Error(
          `SchedulerAgent: неизвестное действие ${String(exhaustive)}`,
        );
      }
    }
  }

  /**
   * Совместимая обёртка агента конвейера (IAgent-контракт):
   * никогда не бросает — результат возвращается в AgentResult.
   */
  async execute(input: unknown): Promise<AgentResult<SchedulerAgentOutput>> {
    const startMs = this.now();
    try {
      const data = await this.handle(input as SchedulerAgentInput);
      const durationMs = this.now() - startMs;
      this.totalExecutions += 1;
      this.totalSuccesses += 1;
      this.lastExecution = {
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date(this.now()).toISOString(),
        durationMs,
        success: true,
      };
      return { success: true, data, durationMs, completedAt: this.isoNow() };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const durationMs = this.now() - startMs;
      this.totalExecutions += 1;
      this.totalFailures += 1;
      this.lastExecution = {
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date(this.now()).toISOString(),
        durationMs,
        success: false,
        error: error.message,
      };
      return {
        success: false,
        error,
        durationMs,
        completedAt: this.isoNow(),
      };
    }
  }

  /** Текущее состояние агента (для IAgent-контракта). */
  get state(): AgentState {
    return this.started ? 'running' : 'stopped';
  }

  /** Сводка о выполнении (для IAgent-контракта). */
  getSummary(): AgentSummary {
    return {
      name: this.name,
      state: this.state,
      lastExecution: this.lastExecution,
      totalExecutions: this.totalExecutions,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
    };
  }

  // ── События ──

  /**
   * Реакция на внешнее событие: запускаются все подписанные (enabled) job'ы,
   * чей eventFilter совпадает с типом события (и символами, если заданы).
   * Запуск по событию не сдвигает nextRunAt.
   */
  onEvent(event: SchedulerAgentEvent): void {
    for (const job of this.jobs.values()) {
      if (!job.enabled || job.running) {
        continue;
      }
      if (!this.isSubscribed(job, event)) {
        continue;
      }
      void this.launch(job, 'event');
    }
  }

  // ── Управление и состояние ──

  /** Список всех зарегистрированных job'ов (включая paused). */
  list(): ScheduledJobInfo[] {
    return this.toInfos();
  }

  /** Получить публичную информацию о job'е. */
  getJob(jobId: string): ScheduledJobInfo | undefined {
    const job = this.jobs.get(jobId);
    return job ? this.toInfo(job) : undefined;
  }

  /**
   * Экспорт текущего состояния планировщика (deep-копия).
   * Персистентное хранение не реализуется (in-memory достаточно).
   */
  exportState(): ScheduledJobInfo[] {
    return this.toInfos().map((info) => structuredClone(info));
  }

  // ── Действия ──

  private schedule(input: SchedulerAgentInput): SchedulerAgentOutput {
    const task = input.task;
    if (!task) {
      throw new Error('SchedulerAgent: поле task обязательно для schedule');
    }
    if (task.kind === 'callback' && !task.callbackName) {
      throw new Error(
        'SchedulerAgent: для task.kind="callback" нужно указать callbackName',
      );
    }
    if (input.cron !== undefined && input.intervalMs !== undefined) {
      throw new Error(
        'SchedulerAgent: cron и intervalMs взаимоисключающие — укажите один',
      );
    }
    if (
      input.intervalMs !== undefined &&
      (!Number.isFinite(input.intervalMs) || input.intervalMs <= 0)
    ) {
      throw new Error(
        `SchedulerAgent: некорректный intervalMs=${input.intervalMs}`,
      );
    }
    if (input.cron !== undefined) {
      // Валидация выражения (бросает при неверном формате)
      parseCron(input.cron);
    }

    const jobId =
      input.jobId !== undefined && input.jobId.trim() !== ''
        ? input.jobId.trim()
        : `job-${crypto.randomUUID().slice(0, 8)}`;

    if (this.jobs.has(jobId)) {
      throw new Error(`SchedulerAgent: job "${jobId}" уже существует`);
    }

    const job: InternalScheduledJob = {
      jobId,
      cron: input.cron,
      intervalMs: input.intervalMs,
      task: { kind: task.kind, callbackName: task.callbackName },
      eventFilter: input.eventFilter,
      notify: input.notify,
      enabled: true,
      nextRunAt: null,
      lastRunAt: null,
      lastStatus: null,
      runs: 0,
      running: false,
    };
    job.nextRunAt = this.computeNextRun(job);
    this.jobs.set(jobId, job);

    if (input.atStart) {
      // Немедленный запуск при регистрации; nextRunAt пересчитается по итогу.
      void this.launch(job, 'schedule');
    }

    return {
      action: 'schedule',
      jobs: this.toInfos(),
      message: `Job "${jobId}" зарегистрирован`,
    };
  }

  private unschedule(input: SchedulerAgentInput): SchedulerAgentOutput {
    const jobId = this.requireJobId(input);
    if (!this.jobs.delete(jobId)) {
      throw new Error(`SchedulerAgent: job "${jobId}" не найден`);
    }
    return {
      action: 'unschedule',
      jobs: this.toInfos(),
      message: `Job "${jobId}" удалён`,
    };
  }

  private listJobs(): SchedulerAgentOutput {
    const jobs = this.toInfos();
    return {
      action: 'list',
      jobs,
      message: `Зарегистрировано job'ов: ${jobs.length}`,
    };
  }

  /**
   * Немедленный запуск job'а вне расписания (работает даже для paused job —
   * это явный ручной запрос).
   */
  private async trigger(
    input: SchedulerAgentInput,
  ): Promise<SchedulerAgentOutput> {
    const jobId = this.requireJobId(input);
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`SchedulerAgent: job "${jobId}" не найден`);
    }
    const result = await this.launch(job, 'trigger');
    return {
      action: 'trigger',
      jobs: this.toInfos(),
      message: `Job "${jobId}" запущен: ${result.status}`,
      triggered: { jobId, result },
    };
  }

  /** pause (enabled=false) / resume (enabled=true). */
  private setEnabled(
    input: SchedulerAgentInput,
    enabled: boolean,
  ): SchedulerAgentOutput {
    const jobId = this.requireJobId(input);
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`SchedulerAgent: job "${jobId}" не найден`);
    }
    job.enabled = enabled;
    if (enabled) {
      // При возобновлении пересчитываем просроченный следующий запуск,
      // чтобы job не «догонял» пропущенное время паузы.
      const nowMs = this.now();
      if (job.nextRunAt !== null && job.nextRunAt <= nowMs) {
        job.nextRunAt = this.computeNextRun(job);
      }
    }
    return {
      action: enabled ? 'resume' : 'pause',
      jobs: this.toInfos(),
      message: `Job "${jobId}" ${enabled ? 'возобновлён' : 'приостановлен'}`,
    };
  }

  // ── Внутренний цикл ──

  private scheduleNextTick(): void {
    if (!this.started) {
      return;
    }
    this.tickTimer = this.setTimer(() => {
      this.tickTimer = null;
      this.checkDue();
      this.scheduleNextTick();
    }, this.tickMs);
  }

  /** Один тик: запустить все due-задачи (enabled и не выполняющиеся). */
  private checkDue(): void {
    const nowMs = this.now();
    for (const job of this.jobs.values()) {
      if (!job.enabled || job.running) {
        continue;
      }
      if (job.nextRunAt !== null && job.nextRunAt <= nowMs) {
        void this.launch(job, 'schedule');
      }
    }
  }

  /**
   * Запуск задачи job'а.
   * - schedule: пересчитывает nextRunAt по завершении;
   * - event/trigger: расписание не трогается.
   * Ошибки задачи НЕ роняют планировщик — фиксируются в lastStatus
   * (и отправляется уведомление onFailure, если настроено).
   */
  private async launch(
    job: InternalScheduledJob,
    reason: LaunchReason,
  ): Promise<SchedulerTriggerResult['result']> {
    if (job.running) {
      return {
        status: 'failed',
        at: this.isoNow(),
        error: `job "${job.jobId}" уже выполняется`,
      };
    }

    job.running = true;
    const startedAt = this.now();
    let status: SchedulerJobStatus = 'success';
    let error: string | undefined;

    try {
      await this.runTask(job);
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
    } finally {
      job.running = false;
      job.runs += 1;
      job.lastStatus = status;
      job.lastRunAt = this.now();
      if (reason === 'schedule') {
        job.nextRunAt = this.computeNextRun(job);
      }
    }

    const finishedAt = this.now();
    const durationMs = finishedAt - startedAt;
    await this.notify(job, {
      ok: status === 'success',
      durationMs,
      error,
    });

    return {
      status,
      at: new Date(finishedAt).toISOString(),
      durationMs,
      error,
    };
  }

  /** Выполнить задачу job'а через DI-колбэки. */
  private async runTask(job: InternalScheduledJob): Promise<unknown> {
    if (job.task.kind === 'pipeline') {
      if (!this.runPipeline) {
        throw new Error(
          `SchedulerAgent: runPipeline не настроен (job "${job.jobId}")`,
        );
      }
      return this.runPipeline();
    }
    const callbackName = job.task.callbackName;
    if (!callbackName) {
      throw new Error(
        `SchedulerAgent: не указан callbackName (job "${job.jobId}")`,
      );
    }
    const callback = this.callbacks[callbackName];
    if (!callback) {
      throw new Error(
        `SchedulerAgent: неизвестный callback "${callbackName}" (job "${job.jobId}")`,
      );
    }
    return callback();
  }

  /** Уведомление (Telegram) о завершении job'а — только если настроено. */
  private async notify(
    job: InternalScheduledJob,
    outcome: { ok: boolean; durationMs: number; error?: string },
  ): Promise<void> {
    const notifyConfig = job.notify;
    if (!notifyConfig?.enabled || notifyConfig.channel !== 'telegram') {
      return;
    }
    const wanted = outcome.ok ? notifyConfig.onSuccess : notifyConfig.onFailure;
    if (!wanted || !this.sendNotification) {
      return;
    }
    const kind = job.task.kind;
    const suffix = outcome.error ? `: ${outcome.error}` : '';
    const message =
      `[Scheduler] Job "${job.jobId}" (${kind}) ` +
      `${outcome.ok ? 'успешно выполнен' : 'завершился ошибкой'}${suffix} ` +
      `за ${outcome.durationMs}ms`;
    try {
      await Promise.resolve(this.sendNotification(message));
    } catch {
      // Ошибка уведомления не должна ломать планировщик
    }
  }

  // ── Хелперы ──

  private computeNextRun(job: InternalScheduledJob): number | null {
    const nowMs = this.now();
    if (job.cron !== undefined) {
      return nextCronRun(job.cron, new Date(nowMs)).getTime();
    }
    if (job.intervalMs !== undefined) {
      return nowMs + job.intervalMs;
    }
    return null;
  }

  private isSubscribed(
    job: InternalScheduledJob,
    event: SchedulerAgentEvent,
  ): boolean {
    const filter = job.eventFilter;
    if (!filter) {
      return false;
    }
    const types = filter.types;
    if (
      types !== undefined &&
      types.length > 0 &&
      !types.includes(event.type)
    ) {
      return false;
    }
    const symbols = filter.symbols;
    if (symbols !== undefined && symbols.length > 0) {
      const payload = event.payload as { symbol?: unknown } | null | undefined;
      const symbol = payload?.symbol;
      if (typeof symbol !== 'string' || !symbols.includes(symbol)) {
        return false;
      }
    }
    return true;
  }

  private requireJobId(input: SchedulerAgentInput): string {
    const jobId = input.jobId?.trim();
    if (!jobId) {
      throw new Error(
        `SchedulerAgent: jobId обязателен для действия "${input.action}"`,
      );
    }
    return jobId;
  }

  private toInfos(): ScheduledJobInfo[] {
    return Array.from(this.jobs.values())
      .map((job) => this.toInfo(job))
      .sort((a, b) => a.jobId.localeCompare(b.jobId));
  }

  private toInfo(job: InternalScheduledJob): ScheduledJobInfo {
    return {
      jobId: job.jobId,
      cron: job.cron,
      intervalMs: job.intervalMs,
      task: { ...job.task },
      eventFilter: job.eventFilter
        ? {
            types: job.eventFilter.types
              ? [...job.eventFilter.types]
              : undefined,
            symbols: job.eventFilter.symbols
              ? [...job.eventFilter.symbols]
              : undefined,
          }
        : undefined,
      notify: job.notify ? { ...job.notify } : undefined,
      enabled: job.enabled,
      nextRunAt:
        job.nextRunAt === null ? null : new Date(job.nextRunAt).toISOString(),
      lastRunAt:
        job.lastRunAt === null ? null : new Date(job.lastRunAt).toISOString(),
      lastStatus: job.lastStatus,
      runs: job.runs,
      running: job.running,
    };
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }
}
