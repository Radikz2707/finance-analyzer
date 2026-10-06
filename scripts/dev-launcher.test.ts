/// <reference types="vitest/globals" />
/**
 * Тесты dev-launcher — единого запуска `npm run dev`.
 *
 * 1. Unit-тесты чистых утилит (префиксы, буферизация потока, команды, код выхода);
 * 2. e2e-тесты оркестратора с фиктивными командами через DEV_CMD_DASHBOARD /
 *    DEV_CMD_HARNESS:
 *    - быстрые команды (обе платформы): оба префикса в выводе, код 0;
 *    - keep-alive команды + SIGTERM (только POSIX): вежливое завершение,
 *      код 0. На Windows проверка graceful-shutdown пропускается: сигналы
 *      недоступны (kill = TerminateProcess), подтверждается вручную.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  buildChildCommands,
  buildLinePrefixer,
  computeExitCode,
  splitStream,
} from './dev-launcher-utils.js';

/** Корень репозитория (родитель scripts/) */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

// ─── Фиктивные команды для e2e ────────────────────────────────────────

/** Печатает маркер и живёт 60 с (для проверки SIGTERM-завершения) */
const FAKE_DASHBOARD_KEEPALIVE =
  'node -e "console.log(\\"dash-up\\"); setTimeout(()=>{},60000)"';
const FAKE_HARNESS_KEEPALIVE =
  'node -e "console.log(\\"harness-up\\"); setTimeout(()=>{},60000)"';

/** Печатает маркер и сразу выходит с кодом 0 */
const FAKE_DASHBOARD_QUICK = 'node -e "console.log(\\"dash-up\\")"';
const FAKE_HARNESS_QUICK = 'node -e "console.log(\\"harness-up\\")"';

// ─── Helpers для e2e ──────────────────────────────────────────────────

interface LauncherHandle {
  /** Суммарный stdout+stderr лаунчера */
  output(): string;
  /** Promise кода выхода (close) */
  waitForExit(): Promise<number | null>;
  /** Вежливая остановка (SIGTERM) */
  stop(): void;
  /** Принудительная остановка (SIGKILL) — для cleanup при фейле */
  forceStop(): void;
}

function startLauncher(env: Record<string, string>): LauncherHandle {
  const proc = spawn(
    process.execPath,
    ['--import', 'tsx', 'scripts/dev-launcher.ts'],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  let output = '';
  let settled = false;
  const exitPromise = new Promise<number | null>((resolve) => {
    const settle = (code: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(code);
    };
    proc.on('error', (err) => {
      output += `[spawn-error] ${err instanceof Error ? err.message : String(err)}\n`;
      settle(1);
    });
    proc.on('close', (code) => settle(code));
  });

  proc.stdout?.setEncoding('utf8');
  proc.stdout?.on('data', (chunk: string) => {
    output += chunk;
  });
  proc.stderr?.setEncoding('utf8');
  proc.stderr?.on('data', (chunk: string) => {
    output += chunk;
  });

  return {
    output: () => output,
    waitForExit: () => exitPromise,
    stop: () => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // процесс уже завершён
      }
    },
    forceStop: () => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // процесс уже завершён
      }
    },
  };
}

async function waitForText(
  handle: LauncherHandle,
  text: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (handle.output().includes(text)) {
      return;
    }
    await sleep(50);
  }
  throw new Error(
    `Таймаут ожидания "${text}" в выводе лаунчера:\n${handle.output()}`,
  );
}

// ─── Unit: buildLinePrefixer ───────────────────────────────────────────

describe('buildLinePrefixer', () => {
  const prefix = buildLinePrefixer({ tag: '📊 дашборд', color: '36' });

  it('добавляет цветной префикс и сохраняет содержимое строки', () => {
    expect(prefix('hello world')).toBe(
      '\x1b[36m[📊 дашборд]\x1b[0m hello world',
    );
    expect(prefix('hello world')).toContain('hello world');
  });

  it('не ломает строки с лишними пробелами и спецсимволами', () => {
    expect(prefix('a b  c!@#$%^&*()')).toBe(
      '\x1b[36m[📊 дашборд]\x1b[0m a b  c!@#$%^&*()',
    );
  });

  it('stderr дополнительно помечается красным [ERR]', () => {
    const out = prefix('boom', true);
    expect(out).toContain('[ERR]');
    expect(out).toContain('\x1b[31m');
    expect(out).toContain('boom');
  });

  it('игнорирует пустые и пробельные строки', () => {
    expect(prefix('')).toBe('');
    expect(prefix('   ')).toBe('');
    expect(prefix('\t')).toBe('');
  });
});

// ─── Unit: splitStream ─────────────────────────────────────────────────

describe('splitStream', () => {
  it('делит чанк по \\n и сохраняет неполный хвост', () => {
    const first = splitStream('a\nb\nc', '');
    expect(first.lines).toEqual(['a', 'b']);
    expect(first.rest).toBe('c');
  });

  it('накапливает pending между чанками', () => {
    // pending 'c' — неполная строка: она завершается первым сегментом 'd'
    // следующего чанка, образуя полную строку 'cd'.
    const second = splitStream('d\ne\n', 'c');
    expect(second.lines).toEqual(['cd', 'e']);
    expect(second.rest).toBe('');
  });

  it('принимает Buffer и срезает \\r (CRLF)', () => {
    const res = splitStream(Buffer.from('x\r\ny'), '');
    expect(res.lines).toEqual(['x']);
    expect(res.rest).toBe('y');
  });

  it('пустой чанк ничего не даёт, но сохраняет pending', () => {
    const res = splitStream('', 'tail');
    expect(res.lines).toEqual([]);
    expect(res.rest).toBe('tail');
  });

  it('сохраняет средние пустые строки (их отсеивает префиксер)', () => {
    const res = splitStream('a\n\nb\n', '');
    expect(res.lines).toEqual(['a', '', 'b']);
    expect(res.rest).toBe('');
  });
});

// ─── Unit: buildChildCommands ──────────────────────────────────────────

describe('buildChildCommands', () => {
  const initialDashboard = process.env.DEV_CMD_DASHBOARD;
  const initialHarness = process.env.DEV_CMD_HARNESS;

  afterEach(() => {
    if (initialDashboard === undefined) {
      delete process.env.DEV_CMD_DASHBOARD;
    } else {
      process.env.DEV_CMD_DASHBOARD = initialDashboard;
    }
    if (initialHarness === undefined) {
      delete process.env.DEV_CMD_HARNESS;
    } else {
      process.env.DEV_CMD_HARNESS = initialHarness;
    }
  });

  it('по умолчанию: gulp start и harness-start', () => {
    delete process.env.DEV_CMD_DASHBOARD;
    delete process.env.DEV_CMD_HARNESS;

    expect(buildChildCommands()).toEqual([
      {
        tag: 'dashboard',
        cmd: 'node',
        args: ['node_modules/gulp/bin/gulp.js', 'start'],
      },
      {
        tag: 'harness',
        cmd: 'node',
        args: ['--import', 'tsx', 'scripts/harness-start.ts'],
      },
    ]);
  });

  it('использует переопределения из DEV_CMD_* (с двойными кавычками)', () => {
    process.env.DEV_CMD_DASHBOARD = 'node -e "console.log(\\"dash\\")"';
    process.env.DEV_CMD_HARNESS = 'node scripts/fake-harness.ts';

    const [dashboard, harness] = buildChildCommands();
    expect(dashboard).toEqual({
      tag: 'dashboard',
      cmd: 'node',
      args: ['-e', 'console.log("dash")'],
    });
    expect(harness).toEqual({
      tag: 'harness',
      cmd: 'node',
      args: ['scripts/fake-harness.ts'],
    });
  });

  it('поддерживает одинарные кавычки в переопределении', () => {
    process.env.DEV_CMD_DASHBOARD = 'node -e \'console.log("x")\'';

    const [dashboard] = buildChildCommands();
    expect(dashboard?.args).toEqual(['-e', 'console.log("x")']);
  });
});

// ─── Unit: computeExitCode ─────────────────────────────────────────────

describe('computeExitCode', () => {
  it('0 при отсутствии завершившихся процессов (остановка пользователем)', () => {
    expect(computeExitCode([])).toBe(0);
  });

  it('возвращает код первого завершившегося процесса', () => {
    expect(computeExitCode([3, 0])).toBe(3);
    expect(computeExitCode([0, 1])).toBe(0);
    expect(computeExitCode([1])).toBe(1);
  });
});

// ─── e2e: быстрые фиктивные команды (обе платформы) ───────────────────

describe('e2e: dev-launcher с быстрыми фиктивными командами', () => {
  it('запускает оба процесса, выводит оба префикса и завершается с кодом 0', async () => {
    const handle = startLauncher({
      DEV_CMD_DASHBOARD: FAKE_DASHBOARD_QUICK,
      DEV_CMD_HARNESS: FAKE_HARNESS_QUICK,
    });
    try {
      await waitForText(handle, 'dash-up');
      await waitForText(handle, 'harness-up');

      const code = await Promise.race([
        handle.waitForExit(),
        sleep(15_000).then(() => null),
      ]);
      expect(code).toBe(0);

      const output = handle.output();
      expect(output).toContain('[📊 дашборд]');
      expect(output).toContain('[🔄 harness]');
      expect(output).toContain('dash-up');
      expect(output).toContain('harness-up');
      expect(output).toContain('Итоговый код: 0');
    } finally {
      handle.forceStop();
    }
  }, 20_000);
});

// ─── e2e: graceful shutdown по SIGTERM (только POSIX) ──────────────────

const SIGTERM_SUPPORTED = process.platform !== 'win32';

describe.skipIf(!SIGTERM_SUPPORTED)(
  'e2e: graceful shutdown по SIGTERM (на Windows пропускается — ' +
    'сигналы недоступны, проверка вручную)',
  () => {
    it('SIGTERM лаунчеру → оба ребёнка завершены, итоговый код 0', async () => {
      const handle = startLauncher({
        DEV_CMD_DASHBOARD: FAKE_DASHBOARD_KEEPALIVE,
        DEV_CMD_HARNESS: FAKE_HARNESS_KEEPALIVE,
      });
      try {
        await waitForText(handle, 'dash-up');
        await waitForText(handle, 'harness-up');

        // Лаунчер должен вежливо завершить ОБА дочерних процесса
        // (иначе сам не выйдет: ждёт их exit перед финалом).
        handle.stop();

        const code = await Promise.race([
          handle.waitForExit(),
          sleep(20_000).then(() => null),
        ]);
        expect(code).toBe(0);

        const output = handle.output();
        expect(output).toContain('завершаю дочерние процессы');
        expect(output).toContain('Итоговый код: 0');
      } finally {
        handle.forceStop();
      }
    }, 30_000);
  },
);
