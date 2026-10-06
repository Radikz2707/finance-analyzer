/**
 * SchedulerAgent Tests — планирование задач.
 *
 * Проверяются: interval-режим (запуск через N мс + повторы), cron-режим
 * (nextRunAt на границе), unschedule/pause/resume/list, trigger вне
 * расписания, реакция на события (подписка/фильтр по символам),
 * уведомления onSuccess/onFailure/disabled, падение runPipeline
 * (lastStatus + планировщик продолжает работать), callback-задачи,
 * atStart и execute()-обёртка.
 *
 * Все тесты используют fake timers и мок runPipeline/sendNotification —
 * без сети и БД.
 */

import { SchedulerAgent } from './scheduler-agent.js';
import type {
  SchedulerAgentEvent,
  SchedulerAgentInput,
  SchedulerAgentOptions,
  SchedulerAgentOutput,
  SchedulerJobTask,
  ScheduledJobInfo,
} from './scheduler-agent.js';

// ─── Helpers ───────────────────────────────────────────────

const agents: SchedulerAgent[] = [];

interface MadeAgent {
  agent: SchedulerAgent;
  runPipeline: ReturnType<typeof vi.fn>;
  sendNotification: ReturnType<typeof vi.fn>;
}

function makeAgent(options: SchedulerAgentOptions = {}): MadeAgent {
  const runPipeline = vi.fn(async () => undefined);
  const sendNotification = vi.fn(async () => undefined);
  const agent = new SchedulerAgent({
    tickMs: 1000,
    autostart: true,
    runPipeline,
    sendNotification,
    ...options,
  });
  agents.push(agent);
  return { agent, runPipeline, sendNotification };
}

function schedule(
  agent: SchedulerAgent,
  input: Omit<SchedulerAgentInput, 'action'>,
): Promise<SchedulerAgentOutput> {
  return agent.handle({ action: 'schedule', ...input });
}

function jobInfo(
  output: SchedulerAgentOutput,
  jobId: string,
): ScheduledJobInfo {
  const found = output.jobs.find((job) => job.jobId === jobId);
  if (!found) {
    throw new Error(`Job "${jobId}" не найден в выводе`);
  }
  return found;
}

/** Дождаться обработки микрозадач без сдвига времени. */
async function flushMicrotasks(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  // Локальные компоненты даты: 6 октября 2026, 09:00 (TZ-независимо через
  // конструктор Date; cron-утилиты работают в локальном времени).
  vi.setSystemTime(new Date(2026, 9, 6, 9, 0, 0));
});

afterEach(async () => {
  for (const agent of agents) {
    await agent.stop();
  }
  agents.length = 0;
  vi.useRealTimers();
});

// ─── Interval-режим ─────────────────────────────────────────

describe('SchedulerAgent: interval', () => {
  it('запускает pipeline через N мс (не раньше)', async () => {
    const { agent, runPipeline } = makeAgent();
    await schedule(agent, {
      jobId: 'i1',
      intervalMs: 5000,
      task: { kind: 'pipeline' },
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(runPipeline).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(runPipeline).toHaveBeenCalledTimes(1);

    await agent.stop();
  });

  it('повторяет запуск с тем же интервалом и ведёт счётчики', async () => {
    const { agent, runPipeline } = makeAgent();
    const out = await schedule(agent, {
      jobId: 'rep',
      intervalMs: 5000,
      task: { kind: 'pipeline' },
    });
    expect(jobInfo(out, 'rep').runs).toBe(0);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(runPipeline).toHaveBeenCalledTimes(2);

    const info = agent.getJob('rep');
    expect(info?.runs).toBe(2);
    expect(info?.lastStatus).toBe('success');
    expect(info?.lastRunAt).not.toBeNull();
    // nextRunAt сдвинут в будущее относительно последнего запуска
    expect(Date.parse(info?.nextRunAt as string)).toBeGreaterThan(
      Date.parse(info?.lastRunAt as string),
    );
  });

  it('не запускает второй раз, пока задача выполняется', async () => {
    let resolveRun: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    const runPipeline = vi.fn(async () => {
      await gate;
    });
    const { agent } = makeAgent({ runPipeline });

    await schedule(agent, {
      jobId: 'busy',
      intervalMs: 500,
      task: { kind: 'pipeline' },
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(agent.getJob('busy')?.running).toBe(true);

    resolveRun?.();
    await flushMicrotasks();
    expect(agent.getJob('busy')?.running).toBe(false);
    expect(agent.getJob('busy')?.runs).toBe(1);
  });

  it('atStart запускает немедленно, следующий запуск — от текущего времени', async () => {
    const { agent, runPipeline } = makeAgent();
    const out = await schedule(agent, {
      jobId: 'start',
      intervalMs: 60_000,
      task: { kind: 'pipeline' },
      atStart: true,
    });

    await flushMicrotasks();
    expect(runPipeline).toHaveBeenCalledTimes(1);

    const info = jobInfo(out, 'start');
    expect(Date.parse(info.nextRunAt as string)).toBe(
      vi.getMockedSystemTime()!.getTime() + 60_000,
    );
  });
});

// ─── Cron-режим ─────────────────────────────────────────────

describe('SchedulerAgent: cron', () => {
  it('вычисляет nextRunAt на границу минуты и запускает в нужный момент', async () => {
    const { agent, runPipeline } = makeAgent();
    const out = await schedule(agent, {
      jobId: 'c1',
      cron: '30 9 * * *',
      task: { kind: 'pipeline' },
    });

    // 09:00 → следующий запуск сегодня в 09:30
    const first = new Date(jobInfo(out, 'c1').nextRunAt as string);
    expect(first.getHours()).toBe(9);
    expect(first.getMinutes()).toBe(30);

    await vi.advanceTimersByTimeAsync(29 * 60_000 + 59_000);
    expect(runPipeline).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(runPipeline).toHaveBeenCalledTimes(1);

    // Следующий запуск — завтра в 09:30
    const second = new Date(agent.getJob('c1')?.nextRunAt as string);
    expect(second.getDate()).toBe(7);
    expect(second.getHours()).toBe(9);
    expect(second.getMinutes()).toBe(30);
  });

  it('повторяется по cron: ещё сутки → ещё один запуск', async () => {
    const { agent, runPipeline } = makeAgent();
    await schedule(agent, {
      jobId: 'c2',
      cron: '30 9 * * *',
      task: { kind: 'pipeline' },
    });

    // 09:00 → запуск в 09:30, следующий — завтра в 09:30 (24 ч 30 м от старта);
    // 25 часов гарантированно покрывают обе границы.
    await vi.advanceTimersByTimeAsync(25 * 60 * 60_000);
    expect(runPipeline).toHaveBeenCalledTimes(2);
    expect(agent.getJob('c2')?.runs).toBe(2);
  });
});

// ─── Управление ─────────────────────────────────────────────

describe('SchedulerAgent: управление', () => {
  it('unschedule удаляет job', async () => {
    const { agent } = makeAgent();
    await schedule(agent, {
      jobId: 'del',
      intervalMs: 5000,
      task: { kind: 'pipeline' },
    });

    const out = await agent.handle({ action: 'unschedule', jobId: 'del' });
    expect(out.message).toContain('del');
    expect(out.jobs).toHaveLength(0);
    expect(agent.getJob('del')).toBeUndefined();
  });

  it('pause останавливает запуски, resume возобновляет без «догоняния»', async () => {
    const { agent, runPipeline } = makeAgent();
    await schedule(agent, {
      jobId: 'pr',
      intervalMs: 5000,
      task: { kind: 'pipeline' },
    });

    await agent.handle({ action: 'pause', jobId: 'pr' });
    expect(agent.getJob('pr')?.enabled).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(runPipeline).not.toHaveBeenCalled();

    await agent.handle({ action: 'resume', jobId: 'pr' });
    expect(agent.getJob('pr')?.enabled).toBe(true);
    // nextRunAt пересчитан в будущее (просроченный запуск не «догоняется»)
    expect(Date.parse(agent.getJob('pr')?.nextRunAt as string)).toBeGreaterThan(
      vi.getMockedSystemTime()!.getTime(),
    );

    await vi.advanceTimersByTimeAsync(5000);
    expect(runPipeline).toHaveBeenCalledTimes(1);
  });

  it('pause/resume/unschedule для неизвестного jobId бросают ошибку', async () => {
    const { agent } = makeAgent();
    await expect(
      agent.handle({ action: 'pause', jobId: 'nope' }),
    ).rejects.toThrow('не найден');
    await expect(
      agent.handle({ action: 'resume', jobId: 'nope' }),
    ).rejects.toThrow('не найден');
    await expect(
      agent.handle({ action: 'unschedule', jobId: 'nope' }),
    ).rejects.toThrow('не найден');
    await expect(
      agent.handle({ action: 'trigger', jobId: 'nope' }),
    ).rejects.toThrow('не найден');
  });

  it('list возвращает все зарегистрированные job-задачи', async () => {
    const { agent } = makeAgent();
    await schedule(agent, {
      jobId: 'a',
      intervalMs: 5000,
      task: { kind: 'pipeline' },
    });
    await schedule(agent, {
      jobId: 'b',
      cron: '0 * * * *',
      task: { kind: 'pipeline' },
    });

    const out = await agent.handle({ action: 'list' });
    expect(out.jobs.map((job) => job.jobId)).toEqual(['a', 'b']);
  });

  it('trigger запускает job вне расписания и не сдвигает nextRunAt', async () => {
    const { agent, runPipeline } = makeAgent();
    await schedule(agent, {
      jobId: 'tr',
      intervalMs: 3_600_000,
      task: { kind: 'pipeline' },
    });

    const before = agent.getJob('tr')?.nextRunAt;
    const out = await agent.handle({ action: 'trigger', jobId: 'tr' });

    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(out.triggered?.jobId).toBe('tr');
    expect(out.triggered?.result.status).toBe('success');
    expect(agent.getJob('tr')?.runs).toBe(1);
    expect(agent.getJob('tr')?.nextRunAt).toBe(before);

    // Спустя 59 минут (до планового запуска через час) повторных запусков нет
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect(runPipeline).toHaveBeenCalledTimes(1);
  });
});

// ─── События ────────────────────────────────────────────────

describe('SchedulerAgent: onEvent', () => {
  it('запускает подписанный job и пропускает неподписанный', async () => {
    const { agent, runPipeline } = makeAgent();
    await schedule(agent, {
      jobId: 'sub',
      intervalMs: 60_000,
      task: { kind: 'pipeline' },
      eventFilter: { types: ['news'] },
    });
    await schedule(agent, {
      jobId: 'nosub',
      intervalMs: 60_000,
      task: { kind: 'pipeline' },
    });

    agent.onEvent({ type: 'news', payload: { headline: 'x' } });
    await flushMicrotasks();
    expect(runPipeline).toHaveBeenCalledTimes(1);

    // Проверяем, что запустился именно подписанный job
    const calls = runPipeline.mock.calls;
    expect(agent.getJob('sub')?.runs).toBe(1);
    expect(agent.getJob('nosub')?.runs).toBe(0);
    expect(calls).toHaveLength(1);

    // Другое событие не триггерит подписку на news
    agent.onEvent({ type: 'price-change', payload: { symbol: 'SBER' } });
    await flushMicrotasks();
    expect(runPipeline).toHaveBeenCalledTimes(1);
  });

  it('фильтрует по символам из payload', async () => {
    const { agent, runPipeline } = makeAgent();
    await schedule(agent, {
      jobId: 'sym',
      intervalMs: 60_000,
      task: { kind: 'pipeline' },
      eventFilter: { types: ['price-change'], symbols: ['SBER'] },
    });

    agent.onEvent({ type: 'price-change', payload: { symbol: 'GAZP' } });
    await flushMicrotasks();
    expect(runPipeline).not.toHaveBeenCalled();

    agent.onEvent({ type: 'price-change', payload: { symbol: 'SBER' } });
    await flushMicrotasks();
    expect(runPipeline).toHaveBeenCalledTimes(1);
  });

  it('не запускает paused job и не трогает расписание', async () => {
    const { agent, runPipeline } = makeAgent();
    const out = await schedule(agent, {
      jobId: 'ev',
      intervalMs: 60_000,
      task: { kind: 'pipeline' },
      eventFilter: { types: ['file-change'] },
    });
    const nextRunBefore = jobInfo(out, 'ev').nextRunAt;

    agent.onEvent({ type: 'file-change', payload: { path: '/tmp/x' } });
    await flushMicrotasks();
    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(agent.getJob('ev')?.nextRunAt).toBe(nextRunBefore);

    await agent.handle({ action: 'pause', jobId: 'ev' });
    agent.onEvent({ type: 'file-change', payload: { path: '/tmp/y' } });
    await flushMicrotasks();
    expect(runPipeline).toHaveBeenCalledTimes(1);
  });
});

// ─── Уведомления ────────────────────────────────────────────

describe('SchedulerAgent: notify', () => {
  it('onSuccess шлёт уведомление после успешного запуска', async () => {
    const { agent, runPipeline, sendNotification } = makeAgent();
    await schedule(agent, {
      jobId: 'ok',
      intervalMs: 5000,
      task: { kind: 'pipeline' },
      notify: { enabled: true, onSuccess: true, channel: 'telegram' },
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const message = String(sendNotification.mock.calls[0]?.[0]);
    expect(message).toContain('ok');
    expect(message).toContain('успешно');
  });

  it('disabled — уведомлений нет', async () => {
    const { agent, sendNotification } = makeAgent();
    await schedule(agent, {
      jobId: 'off',
      intervalMs: 5000,
      task: { kind: 'pipeline' },
      notify: { enabled: false, onSuccess: true, channel: 'telegram' },
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('падение runPipeline → lastStatus failed + onFailure', async () => {
    const runPipeline = vi.fn(async () => {
      throw new Error('boom');
    });
    const { agent, sendNotification } = makeAgent({ runPipeline });

    await schedule(agent, {
      jobId: 'fail',
      intervalMs: 5000,
      task: { kind: 'pipeline' },
      notify: { enabled: true, onFailure: true, channel: 'telegram' },
    });

    await vi.advanceTimersByTimeAsync(5000);

    const info = agent.getJob('fail');
    expect(info?.lastStatus).toBe('failed');
    expect(info?.runs).toBe(1);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const message = String(sendNotification.mock.calls[0]?.[0]);
    expect(message).toContain('fail');
    expect(message).toContain('ошибкой');
    expect(message).toContain('boom');

    // Повторный тик не ломает планировщик
    await vi.advanceTimersByTimeAsync(5000);
    expect(agent.getJob('fail')?.runs).toBe(2);
    expect(agent.getJob('fail')?.lastStatus).toBe('failed');
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it('onSuccess и onFailure независимы: падение при включённом только onSuccess — без уведомления', async () => {
    const runPipeline = vi.fn(async () => {
      throw new Error('boom');
    });
    const { agent, sendNotification } = makeAgent({ runPipeline });

    await schedule(agent, {
      jobId: 'partial',
      intervalMs: 5000,
      task: { kind: 'pipeline' },
      notify: { enabled: true, onSuccess: true, channel: 'telegram' },
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

// ─── Задачи ─────────────────────────────────────────────────

describe('SchedulerAgent: задачи', () => {
  it('callback-задача вызывает именованный колбэк', async () => {
    const hello = vi.fn(async () => 'hi');
    const { agent } = makeAgent({ callbacks: { hello } });
    await schedule(agent, {
      jobId: 'cb',
      intervalMs: 5000,
      task: { kind: 'callback', callbackName: 'hello' },
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(hello).toHaveBeenCalledTimes(1);
    expect(agent.getJob('cb')?.lastStatus).toBe('success');
  });

  it('неизвестный callback → failed без падения планировщика', async () => {
    const { agent } = makeAgent();
    await schedule(agent, {
      jobId: 'missing',
      intervalMs: 5000,
      task: { kind: 'callback', callbackName: 'ghost' },
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(agent.getJob('missing')?.lastStatus).toBe('failed');

    await vi.advanceTimersByTimeAsync(5000);
    expect(agent.getJob('missing')?.runs).toBe(2);
  });
});

// ─── Валидация и экспорт ────────────────────────────────────

describe('SchedulerAgent: валидация, экспорт, execute', () => {
  it('cron + intervalMs вместе → ошибка', async () => {
    const { agent } = makeAgent();
    await expect(
      schedule(agent, {
        jobId: 'x',
        cron: '* * * * *',
        intervalMs: 1000,
        task: { kind: 'pipeline' },
      }),
    ).rejects.toThrow('взаимоисключающие');
  });

  it('некорректный cron → ошибка', async () => {
    const { agent } = makeAgent();
    await expect(
      schedule(agent, {
        jobId: 'x',
        cron: '99 99 * * *',
        task: { kind: 'pipeline' },
      }),
    ).rejects.toThrow('Invalid');
    await expect(
      schedule(agent, {
        jobId: 'x',
        cron: '* * *',
        task: { kind: 'pipeline' },
      }),
    ).rejects.toThrow('Expected 5 fields');
  });

  it('task без callbackName при kind=callback → ошибка', async () => {
    const { agent } = makeAgent();
    const badTask: SchedulerJobTask = { kind: 'callback' };
    await expect(
      schedule(agent, { jobId: 'x', intervalMs: 1000, task: badTask }),
    ).rejects.toThrow('callbackName');
  });

  it('exportState возвращает deep-копию состояния', async () => {
    const { agent } = makeAgent();
    await schedule(agent, {
      jobId: 'e1',
      intervalMs: 5000,
      task: { kind: 'pipeline' },
    });

    const snapshot = agent.exportState();
    expect(snapshot).toHaveLength(1);
    snapshot[0]!.enabled = false; // мутация копии не влияет на агента
    expect(agent.getJob('e1')?.enabled).toBe(true);
  });

  it('execute() возвращает AgentResult без бросания', async () => {
    const { agent } = makeAgent();
    const ok = await agent.execute({
      action: 'schedule',
      jobId: 'via-execute',
      intervalMs: 5000,
      task: { kind: 'pipeline' },
    });
    expect(ok.success).toBe(true);
    const data = ok.data as SchedulerAgentOutput;
    expect(data.action).toBe('schedule');
    expect(data.jobs[0]?.jobId).toBe('via-execute');

    const bad = await agent.execute({ action: 'trigger', jobId: 'absent' });
    expect(bad.success).toBe(false);
    expect(bad.error?.message).toContain('не найден');
  });

  it('event-only job: не запускается по тику, только по событию/триггеру', async () => {
    const { agent, runPipeline } = makeAgent();
    await schedule(agent, {
      jobId: 'eo',
      task: { kind: 'pipeline' },
      eventFilter: { types: ['news'] },
    });

    const info = agent.getJob('eo');
    expect(info?.nextRunAt).toBeNull();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runPipeline).not.toHaveBeenCalled();

    const event: SchedulerAgentEvent = { type: 'news', payload: {} };
    agent.onEvent(event);
    await flushMicrotasks();
    expect(runPipeline).toHaveBeenCalledTimes(1);
  });
});
