/**
 * ProcessAgent Tests — управление процессами.
 *
 * Проверяются: запуск (whitelist, PID, cwd), остановка (SIGTERM →
 * SIGKILL по таймауту), авто-перезапуск с backoff (fake timers),
 * лимит попыток → crashed, status, restart, ограничение outputTail.
 *
 * Все тесты используют мок spawn (реальные процессы не запускаются).
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProcessAgent } from './process-agent.js';
import type { ProcessAgentOutput } from './process-agent.js';

// ─── Helpers ───────────────────────────────────────────────

function dataOf(result: { data?: unknown }): ProcessAgentOutput {
  return result.data as ProcessAgentOutput;
}

/** Минимальная структура фейкового дочернего процесса */
interface FakeChild {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  exitCode: number | null;
  killed: boolean;
  killSignals: Array<string | undefined>;
  spawnOptions: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    shell?: boolean;
    windowsHide?: boolean;
  };
  kill: (signal?: NodeJS.Signals) => boolean;
  on: (event: string | symbol, listener: (...args: never[]) => void) => unknown;
  once: (
    event: string | symbol,
    listener: (...args: never[]) => void,
  ) => unknown;
  emit: (event: string | symbol, ...args: unknown[]) => boolean;
}

let pidCounter = 100;

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as unknown as FakeChild;
  child.pid = ++pidCounter;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.killSignals = [];
  child.spawnOptions = {};
  // По умолчанию фейк ИГНОРИРУЕТ сигналы: завершение процесса
  // (close) эмитится только явно из теста через emitClose().
  child.kill = (signal?: NodeJS.Signals): boolean => {
    child.killSignals.push(signal);
    child.killed = true;
    return true;
  };
  return child;
}

/** Фабрика мок-spawn: каждый вызов создаёт нового фейкового ребёнка */
function createSpawnFake(): {
  spawn: typeof import('child_process').spawn;
  children: FakeChild[];
} {
  const children: FakeChild[] = [];
  const spawn = ((
    _command: string,
    _args: string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      shell?: boolean;
      windowsHide?: boolean;
    },
  ) => {
    const child = makeFakeChild();
    child.spawnOptions = options ?? {};
    children.push(child);
    return child;
  }) as unknown as typeof import('child_process').spawn;
  return { spawn, children };
}

function createAgent(
  root: string,
  options?: {
    spawn?: typeof import('child_process').spawn;
    killTimeoutMs?: number;
    maxRestarts?: number;
    restartBackoffMs?: number;
    maxOutputTailLines?: number;
  },
): ProcessAgent {
  return new ProcessAgent(
    { name: 'ProcessAgent' },
    {
      roots: [root],
      spawn: options?.spawn,
      killTimeoutMs: options?.killTimeoutMs,
      maxRestarts: options?.maxRestarts,
      restartBackoffMs: options?.restartBackoffMs,
      maxOutputTailLines: options?.maxOutputTailLines,
    },
  );
}

function emitData(
  fake: FakeChild,
  stream: 'stdout' | 'stderr',
  text: string,
): void {
  fake[stream].emit('data', Buffer.from(text, 'utf-8'));
}

function emitClose(
  fake: FakeChild,
  code: number | null,
  signal: NodeJS.Signals | null = null,
): void {
  fake.emit('close', code, signal);
}

// ─── Start ─────────────────────────────────────────────────

describe('ProcessAgent — start', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'process-agent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('регистрирует процесс, возвращает running и PID', async () => {
    const { spawn, children } = createSpawnFake();
    const agent = createAgent(tmp, { spawn });

    const result = await agent.execute({
      action: 'start',
      command: 'node',
      args: ['server.js'],
      name: 'app',
    });

    expect(result.success).toBe(true);
    expect(children).toHaveLength(1);
    const out = dataOf(result);
    expect(out.processes).toHaveLength(1);
    expect(out.processes[0]).toMatchObject({
      name: 'app',
      pid: children[0]!.pid,
      status: 'running',
      command: 'node',
      args: ['server.js'],
      exitCode: null,
      restarts: 0,
    });
    expect(out.message).toContain('Запущен');
    // spawn БЕЗ shell, внутри корня
    expect(children[0]!.spawnOptions).toMatchObject({
      cwd: tmp,
      shell: false,
      windowsHide: true,
    });
  });

  it('разрешает python и gulp (расширение whitelist)', async () => {
    const { spawn, children } = createSpawnFake();
    const agent = createAgent(tmp, { spawn });

    await agent.execute({
      action: 'start',
      command: 'python',
      args: ['app.py'],
    });
    await agent.execute({ action: 'start', command: 'gulp', args: ['styles'] });
    expect(children).toHaveLength(2);
  });

  it('генерирует имя, если name не указан', async () => {
    const { spawn } = createSpawnFake();
    const agent = createAgent(tmp, { spawn });

    const result = await agent.execute({
      action: 'start',
      command: 'node',
      args: ['a.js'],
    });
    const name = dataOf(result).processes[0]!.name;
    expect(name).toMatch(/^proc-node-\d+$/);
  });

  it('start с командой вне whitelist → ошибка', async () => {
    const agent = createAgent(tmp);
    const result = await agent.execute({
      action: 'start',
      command: 'curl',
      args: ['-s', 'https://example.com'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('whitelist');
  });

  it('start с инъекцией в аргументах → ошибка', async () => {
    const agent = createAgent(tmp);
    const result = await agent.execute({
      action: 'start',
      command: 'node',
      args: ['--eval', 'ls;cat /etc/passwd'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('инъекции');
  });

  it('start с cwd вне корня → ошибка', async () => {
    const agent = createAgent(tmp);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'process-outside-'));
    try {
      const result = await agent.execute({
        action: 'start',
        command: 'node',
        cwd: outside,
      });
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('вне разрешённых корней');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('повторный start с тем же именем → ошибка', async () => {
    const { spawn } = createSpawnFake();
    const agent = createAgent(tmp, { spawn });
    await agent.execute({
      action: 'start',
      command: 'node',
      args: ['a.js'],
      name: 'dup',
    });
    const result = await agent.execute({
      action: 'start',
      command: 'node',
      args: ['b.js'],
      name: 'dup',
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('уже существует');
  });
});

// ─── Stop ──────────────────────────────────────────────────

describe('ProcessAgent — stop', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'process-agent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('шлёт SIGTERM и переводит в stopped после close', async () => {
    vi.useFakeTimers();
    try {
      const { spawn, children } = createSpawnFake();
      const agent = createAgent(tmp, { spawn, killTimeoutMs: 5000 });
      await agent.execute({
        action: 'start',
        command: 'node',
        args: ['srv.js'],
        name: 'srv',
      });

      const stopPromise = agent.execute({ action: 'stop', name: 'srv' });
      expect(children[0]!.killSignals).toEqual(['SIGTERM']);
      // Процесс подчинился: close пришёл сразу, таймер SIGKILL не сработал
      emitClose(children[0]!, 0, null);
      const result = await stopPromise;

      expect(result.success).toBe(true);
      expect(dataOf(result).processes[0]).toMatchObject({
        name: 'srv',
        status: 'stopped',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('при игноре SIGTERM → SIGKILL после таймаута', async () => {
    vi.useFakeTimers();
    try {
      const { spawn, children } = createSpawnFake();
      const agent = createAgent(tmp, { spawn, killTimeoutMs: 5000 });
      await agent.execute({
        action: 'start',
        command: 'node',
        args: ['stuck.js'],
        name: 'stuck',
      });

      const stopPromise = agent.execute({ action: 'stop', name: 'stuck' });
      expect(children[0]!.killSignals).toEqual(['SIGTERM']);

      // До таймаута — SIGKILL ещё не отправлен
      await vi.advanceTimersByTimeAsync(4999);
      expect(children[0]!.killSignals).toEqual(['SIGTERM']);

      // По таймауту — жёсткое завершение
      await vi.advanceTimersByTimeAsync(1);
      expect(children[0]!.killSignals).toEqual(['SIGTERM', 'SIGKILL']);

      emitClose(children[0]!, null, 'SIGKILL');
      const result = await stopPromise;

      expect(result.success).toBe(true);
      expect(dataOf(result).processes[0]!.status).toBe('stopped');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop несуществующего процесса → ошибка', async () => {
    const agent = createAgent(tmp);
    const result = await agent.execute({ action: 'stop', name: 'ghost' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('не найден');
  });

  it('stop по PID', async () => {
    const { spawn, children } = createSpawnFake();
    const agent = createAgent(tmp, { spawn });
    await agent.execute({
      action: 'start',
      command: 'node',
      args: ['a.js'],
      name: 'by-pid',
    });
    const stopPromise = agent.execute({
      action: 'stop',
      name: children[0]!.pid,
    });
    emitClose(children[0]!, 0, null);
    const result = await stopPromise;
    expect(result.success).toBe(true);
    expect(dataOf(result).processes[0]!.status).toBe('stopped');
  });
});

// ─── Exit / Auto-restart ───────────────────────────────────

describe('ProcessAgent — exit и авто-перезапуск', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'process-agent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('exit с кодом 0 → exited', async () => {
    const { spawn, children } = createSpawnFake();
    const agent = createAgent(tmp, { spawn });
    await agent.execute({
      action: 'start',
      command: 'node',
      args: ['ok.js'],
      name: 'ok',
    });

    emitClose(children[0]!, 0, null);

    const result = await agent.execute({ action: 'status', name: 'ok' });
    expect(dataOf(result).processes[0]).toMatchObject({
      status: 'exited',
      exitCode: 0,
      pid: null,
    });
  });

  it('exit с ненулевым кодом без restartOnExit → crashed', async () => {
    const { spawn, children } = createSpawnFake();
    const agent = createAgent(tmp, { spawn });
    await agent.execute({
      action: 'start',
      command: 'node',
      args: ['bad.js'],
      name: 'bad',
    });

    emitClose(children[0]!, 7, null);

    const result = await agent.execute({ action: 'status', name: 'bad' });
    expect(dataOf(result).processes[0]).toMatchObject({
      status: 'crashed',
      exitCode: 7,
      restarts: 0,
    });
  });

  it('перезапуски с backoff (1с→2с→4с) и лимит попыток → crashed', async () => {
    vi.useFakeTimers();
    try {
      const { spawn, children } = createSpawnFake();
      const agent = createAgent(tmp, {
        spawn,
        restartBackoffMs: 1000,
        maxRestarts: 3,
      });
      await agent.execute({
        action: 'start',
        command: 'node',
        args: ['worker.js'],
        name: 'w',
        restartOnExit: true,
      });
      expect(children).toHaveLength(1);

      // Падение #1 → restarting с задержкой 1с
      emitClose(children[0]!, 1, null);
      let info = dataOf(await agent.execute({ action: 'status', name: 'w' }))
        .processes[0]!;
      expect(info.status).toBe('restarting');
      expect(info.restarts).toBe(1);

      // До истечения задержки рестарта нет
      await vi.advanceTimersByTimeAsync(999);
      expect(children).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(children).toHaveLength(2);
      info = dataOf(await agent.execute({ action: 'status', name: 'w' }))
        .processes[0]!;
      expect(info.status).toBe('running');

      // Падение #2 → задержка 2с
      emitClose(children[1]!, 1, null);
      await vi.advanceTimersByTimeAsync(1999);
      expect(children).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(children).toHaveLength(3);

      // Падение #3 → задержка 4с
      emitClose(children[2]!, 1, null);
      await vi.advanceTimersByTimeAsync(4000);
      expect(children).toHaveLength(4);

      // Падение #4 → лимит (3 попытки) исчерпан → crashed
      emitClose(children[3]!, 1, null);
      info = dataOf(await agent.execute({ action: 'status', name: 'w' }))
        .processes[0]!;
      expect(info.status).toBe('crashed');
      expect(info.restarts).toBe(3);
      expect(children).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ручной restart: остановка + старт', async () => {
    const { spawn, children } = createSpawnFake();
    const agent = createAgent(tmp, { spawn });
    await agent.execute({
      action: 'start',
      command: 'node',
      args: ['srv.js'],
      name: 'srv',
    });
    expect(children).toHaveLength(1);

    const restartPromise = agent.execute({ action: 'restart', name: 'srv' });
    // Старый процесс остановлен по SIGTERM
    expect(children[0]!.killSignals).toEqual(['SIGTERM']);
    emitClose(children[0]!, 0, null);

    const result = await restartPromise;
    expect(result.success).toBe(true);
    expect(children).toHaveLength(2);
    expect(dataOf(result).processes[0]).toMatchObject({
      name: 'srv',
      pid: children[1]!.pid,
      status: 'running',
      restarts: 0,
    });
  });

  it('restart несуществующего процесса → ошибка', async () => {
    const agent = createAgent(tmp);
    const result = await agent.execute({ action: 'restart', name: 'ghost' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('не найден');
  });
});

// ─── Status / Output ───────────────────────────────────────

describe('ProcessAgent — status и outputTail', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'process-agent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('status: список всех процессов с корректными полями', async () => {
    const { spawn, children } = createSpawnFake();
    const agent = createAgent(tmp, { spawn });
    await agent.execute({
      action: 'start',
      command: 'node',
      args: ['a.js'],
      name: 'a',
    });
    await agent.execute({
      action: 'start',
      command: 'gulp',
      args: ['styles'],
      name: 'b',
    });

    const result = await agent.execute({ action: 'status' });
    const list = dataOf(result).processes;
    expect(list).toHaveLength(2);

    const a = list.find((p) => p.name === 'a')!;
    expect(a).toMatchObject({
      pid: children[0]!.pid,
      command: 'node',
      args: ['a.js'],
      status: 'running',
      exitCode: null,
      restarts: 0,
      uptimeMs: 0,
    });
    expect(a.startedAt).toBeTruthy();
    expect(typeof a.outputTail).toBe('string');
    expect(a.outputTail).toBe('');
    expect(list.some((p) => p.name === 'b' && p.command === 'gulp')).toBe(true);
  });

  it('status по name возвращает один процесс', async () => {
    const { spawn } = createSpawnFake();
    const agent = createAgent(tmp, { spawn });
    await agent.execute({
      action: 'start',
      command: 'node',
      args: ['a.js'],
      name: 'only',
    });
    const result = await agent.execute({ action: 'status', name: 'only' });
    expect(dataOf(result).processes).toHaveLength(1);
  });

  it('status несуществующего процесса → ошибка', async () => {
    const agent = createAgent(tmp);
    const result = await agent.execute({ action: 'status', name: 'ghost' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('не найден');
  });

  it('outputTail ограничен последними N строками', async () => {
    const { spawn, children } = createSpawnFake();
    const agent = createAgent(tmp, { spawn, maxOutputTailLines: 3 });
    await agent.execute({
      action: 'start',
      command: 'node',
      args: ['log.js'],
      name: 'log',
    });

    emitData(children[0]!, 'stdout', 'line1\nline2\n');
    emitData(children[0]!, 'stdout', 'line3\nline4\n');
    emitData(children[0]!, 'stdout', 'line5\n');
    emitData(children[0]!, 'stderr', 'err1\n');

    const result = await agent.execute({ action: 'status', name: 'log' });
    expect(dataOf(result).processes[0]!.outputTail).toBe('line4\nline5\nerr1');
  });
});
