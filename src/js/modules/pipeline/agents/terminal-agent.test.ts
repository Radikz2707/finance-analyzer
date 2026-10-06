/**
 * TerminalAgent Tests — безопасное выполнение команд.
 *
 * Проверяются: whitelist команд, blacklist опасных паттернов,
 * таймаут, успешный вывод, ошибка команды, ограничение вывода,
 * стриминг stdout, логирование и валидация рабочей директории.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TerminalAgent } from './terminal-agent.js';
import type { TerminalAgentOutput } from './terminal-agent.js';

// ─── Helpers ───────────────────────────────────────────────

function outputOf(result: { data?: unknown }): TerminalAgentOutput {
  return result.data as TerminalAgentOutput;
}

function createAgent(
  root: string,
  options?: {
    cwd?: string;
    maxOutputBytes?: number;
    defaultTimeoutMs?: number;
  },
): TerminalAgent {
  return new TerminalAgent(
    { name: 'TerminalAgent' },
    {
      roots: [root],
      cwd: options?.cwd ?? root,
      maxOutputBytes: options?.maxOutputBytes,
      defaultTimeoutMs: options?.defaultTimeoutMs,
    },
  );
}

/** Минимальная структура фейкового дочернего процесса */
interface FakeChild {
  stdout: EventEmitter;
  stderr: EventEmitter;
  exitCode: number | null;
  killed?: boolean;
  kill: (signal?: NodeJS.Signals) => boolean;
  on: (event: string | symbol, listener: (...args: never[]) => void) => unknown;
  emit: (event: string | symbol, ...args: unknown[]) => boolean;
}

/** Создать агента с подменённым spawn (для проверки валидации без бинаря) */
function createAgentWithFakeSpawn(root: string): {
  agent: TerminalAgent;
  fake: FakeChild;
} {
  const fake = makeFakeChild();
  const agent = new TerminalAgent(
    { name: 'TerminalAgent' },
    {
      roots: [root],
      cwd: root,
      spawn: (() => fake) as unknown as typeof import('child_process').spawn,
    },
  );
  return { agent, fake };
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as unknown as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.kill = (signal?: NodeJS.Signals): boolean => {
    child.killed = true;
    child.exitCode = signal ? 1 : 0;
    return true;
  };
  return child;
}

function emitData(
  fake: FakeChild,
  stream: 'stdout' | 'stderr',
  text: string,
): void {
  fake[stream].emit('data', Buffer.from(text, 'utf-8'));
}

function emitClose(fake: FakeChild, code: number): void {
  fake.emit('close', code, null);
}

// ─── Выполнение команд ─────────────────────────────────────

describe('TerminalAgent — выполнение команд', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-agent-test-'));
    fs.writeFileSync(
      path.join(tmp, 'print.js'),
      "process.stdout.write('hello terminal\\n');",
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmp, 'error.js'),
      "console.error('boom'); process.exit(3);",
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmp, 'timeout.js'),
      'setTimeout(() => {}, 60000);',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmp, 'big.js'),
      "for (let i = 0; i < 5000; i++) console.log('x'.repeat(200));",
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('выполняет команду и возвращает stdout (объект-вход)', async () => {
    const result = await createAgent(tmp).execute({
      command: 'node',
      args: ['print.js'],
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).stdout).toContain('hello terminal');
    expect(outputOf(result).exitCode).toBe(0);
    expect(outputOf(result).truncated).toBe(false);
    expect(outputOf(result).command).toContain('node');
    expect(outputOf(result).durationMs).toBeGreaterThanOrEqual(0);
  });

  it('принимает строку команды', async () => {
    const result = await createAgent(tmp).execute('node print.js');
    expect(result.success).toBe(true);
    expect(outputOf(result).stdout).toContain('hello terminal');
  });

  it('возвращает success=false при ошибке команды с кодом и stderr', async () => {
    const result = await createAgent(tmp).execute({
      command: 'node',
      args: ['error.js'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('кодом 3');
    const err = result.error as unknown as { stderr: string; exitCode: number };
    expect(err.stderr).toContain('boom');
    expect(err.exitCode).toBe(3);
  });

  it('возвращает success=false при несуществующем бинаре', async () => {
    const result = await createAgent(tmp).execute({
      command: 'node',
      args: ['/nonexistent-script-that-does-not-exist.js'],
    });
    expect(result.success).toBe(false);
  });

  it('прерывает команду по таймауту', async () => {
    const started = Date.now();
    const result = await createAgent(tmp).execute({
      command: 'node',
      args: ['timeout.js'],
      timeoutMs: 200,
    });
    const elapsed = Date.now() - started;
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('таймаут');
    expect(elapsed).toBeLessThan(10_000);
  });

  it('ограничивает вывод (truncated=true)', async () => {
    const agent = createAgent(tmp, { maxOutputBytes: 1024 });
    const result = await agent.execute({ command: 'node', args: ['big.js'] });
    expect(result.success).toBe(true);
    const output = outputOf(result);
    expect(output.truncated).toBe(true);
    expect(Buffer.byteLength(output.stdout, 'utf-8')).toBeLessThanOrEqual(1024);
  });

  it('собирает стриминг stdout полностью (несколько чанков)', async () => {
    const { agent, fake } = createAgentWithFakeSpawn(tmp);
    const promise = agent.execute({
      command: 'git',
      args: ['log', '--oneline'],
    });
    emitData(fake, 'stdout', 'line1\n');
    emitData(fake, 'stdout', 'line2\n');
    emitData(fake, 'stderr', '');
    emitClose(fake, 0);
    const result = await promise;
    expect(result.success).toBe(true);
    expect(outputOf(result).stdout).toBe('line1\nline2\n');
  });

  it('логирует выполненные команды в истории', async () => {
    const agent = createAgent(tmp);
    await agent.execute({ command: 'node', args: ['print.js'] });
    await agent.execute({ command: 'node', args: ['error.js'] });

    const history = agent.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      success: true,
      exitCode: 0,
      truncated: false,
    });
    expect(history[0]!.command).toContain('node');
    expect(history[1]).toMatchObject({ success: false, exitCode: 3 });
    expect(history[1]!.stderrPreview).toContain('boom');
  });
});

// ─── Whitelist ─────────────────────────────────────────────

describe('TerminalAgent — whitelist команд', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-agent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('запрещает команду вне whitelist', async () => {
    const result = await createAgent(tmp).execute({
      command: 'curl',
      args: ['https://example.com'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('whitelist');
  });

  it('запрещает git-подкоманду вне whitelist (reset)', async () => {
    const result = await createAgent(tmp).execute({
      command: 'git',
      args: ['reset', '--hard'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('подкоманда git');
  });

  it('запрещает npm без whitelist-подкоманды', async () => {
    const result = await createAgent(tmp).execute({ command: 'npm' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('подкоманда npm');
  });

  it('запрещает npm с подкомандой вне whitelist (publish)', async () => {
    const result = await createAgent(tmp).execute({
      command: 'npm',
      args: ['publish'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('подкоманда npm');
  });

  it('разрешает git status (whitelist подкоманд)', async () => {
    const { agent, fake } = createAgentWithFakeSpawn(tmp);
    const promise = agent.execute({
      command: 'git',
      args: ['status', '--short'],
    });
    emitClose(fake, 0);
    const result = await promise;
    expect(result.success).toBe(true);
    expect(fake.killed).toBeUndefined();
  });

  it('разрешает npm run build (whitelist подкоманд по подстрокам)', async () => {
    const { agent, fake } = createAgentWithFakeSpawn(tmp);
    const promise = agent.execute({
      command: 'npm',
      args: ['run', 'build'],
    });
    emitClose(fake, 0);
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it('разрешает npm install (whitelist подкоманд)', async () => {
    const { agent, fake } = createAgentWithFakeSpawn(tmp);
    const promise = agent.execute({
      command: 'npm',
      args: ['install'],
    });
    emitClose(fake, 0);
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it('добавляет кастомные команды через allowedCommands', async () => {
    const agent = new TerminalAgent(
      { name: 'TerminalAgent' },
      { roots: [tmp], cwd: tmp, allowedCommands: ['custom-tool'] },
    );
    const result = await agent.execute({ command: 'custom-tool' });
    expect(result.success).toBe(false); // бинарь не существует, но валидация прошла
    expect(result.error?.message).not.toContain('whitelist');
  });
});

// ─── Blacklist ─────────────────────────────────────────────

describe('TerminalAgent — blacklist опасных команд', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-agent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('блокирует rm -rf', async () => {
    const result = await createAgent(tmp).execute({
      command: 'echo',
      args: ['rm', '-rf', 'node_modules'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('чёрным списком');
  });

  it('блокирует sudo', async () => {
    const result = await createAgent(tmp).execute({
      command: 'echo',
      args: ['sudo', 'apt', 'install', 'x'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('чёрным списком');
  });

  it('блокирует del (Windows)', async () => {
    const result = await createAgent(tmp).execute({
      command: 'echo',
      args: ['del', '/s', '/q', 'C:\\'],
    });
    expect(result.success).toBe(false);
  });

  it('блокирует format', async () => {
    const result = await createAgent(tmp).execute({
      command: 'echo',
      args: ['format', 'c:'],
    });
    expect(result.success).toBe(false);
  });

  it('блокирует mkfs', async () => {
    const result = await createAgent(tmp).execute({
      command: 'echo',
      args: ['mkfs.ext4', '/dev/sda1'],
    });
    expect(result.success).toBe(false);
  });

  it('блокирует редирект в системный путь', async () => {
    const result = await createAgent(tmp).execute({
      command: 'echo',
      args: ['x', '>', '/etc/passwd'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('чёрным списком');
  });

  it('блокирует bash-инъекцию через ;', async () => {
    const result = await createAgent(tmp).execute({
      command: 'echo',
      args: ['ls;cat x'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('инъекции');
  });

  it('блокирует bash-инъекцию через $(', async () => {
    const result = await createAgent(tmp).execute({
      command: 'echo',
      args: ['$(whoami)'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('инъекции');
  });

  it('блокирует bash-инъекцию через backtick', async () => {
    const result = await createAgent(tmp).execute({
      command: 'echo',
      args: ['`id`'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('инъекции');
  });

  it('блокирует cmd-инъекцию через %0a', async () => {
    const result = await createAgent(tmp).execute({
      command: 'echo',
      args: ['%0arm -rf /'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('инъекции');
  });

  it('блокирует pipe |', async () => {
    const result = await createAgent(tmp).execute({
      command: 'echo',
      args: ['ls', '|', 'grep', 'x'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('инъекции');
  });
});

// ─── Рабочая директория ────────────────────────────────────

describe('TerminalAgent — рабочая директория', () => {
  let tmp: string;
  let outside: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-agent-test-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-agent-outside-'));
    fs.writeFileSync(path.join(tmp, 'note.txt'), 'secret data', 'utf-8');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('бросает ошибку при cwd вне разрешённых корней', () => {
    expect(
      () =>
        new TerminalAgent(
          { name: 'TerminalAgent' },
          { roots: [tmp], cwd: outside },
        ),
    ).toThrow('вне разрешённых корней');
  });

  it('блокирует относительный путь за пределы корня (../)', async () => {
    const result = await createAgent(tmp).execute({
      command: 'node',
      args: ['-e', 'console.log(process.cwd())', '../secret.txt'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('вне разрешённых корней');
  });

  it('блокирует абсолютный путь вне корня', async () => {
    const result = await createAgent(tmp).execute({
      command: 'node',
      args: ['-e', 'console.log(1)', path.join(outside, 'secret.txt')],
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('вне разрешённых корней');
  });

  it('разрешает аргумент-путь внутри корня', async () => {
    const result = await createAgent(tmp).execute({
      command: 'node',
      args: [
        '-e',
        "console.log(require('fs').readFileSync('note.txt','utf8'))",
      ],
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).stdout).toContain('secret data');
  });

  it('выполняет команды в указанной рабочей директории', async () => {
    const nested = path.join(tmp, 'nested');
    fs.mkdirSync(nested);
    const agent = createAgent(tmp, { cwd: nested });
    const result = await agent.execute({
      command: 'node',
      args: ['-e', 'console.log(process.cwd())'],
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).stdout).toContain('nested');
  });
});
