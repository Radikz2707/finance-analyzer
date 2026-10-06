/// <reference types="node" />
/**
 * Dev Launcher — единый запуск `npm run dev`.
 *
 * Параллельно поднимает два дочерних процесса в одном терминале:
 *  - веб-дашборд:   `node node_modules/gulp/bin/gulp.js start` (префикс [📊 дашборд]);
 *  - фоновый harness: `node --import tsx scripts/harness-start.ts` (префикс [🔄 harness]).
 *
 * Логи обоих процессов выводятся построчно с цветными префиксами
 * (буферизация по `\n` — ANSI не рвётся, строки не смешиваются),
 * stderr дополнительно помечается красным [ERR].
 *
 * Завершение: Ctrl+C (SIGINT/SIGTERM) → вежливый SIGTERM детям,
 * таймаут 5 с → SIGKILL; итоговый код = коду завершившегося первым ребёнка
 * (или 0 при остановке пользователем). Падение одного процесса НЕ убивает
 * второй: например, harness с невалидным `.env` (assertEnvValid → код 1)
 * роняет только себя, дашборд продолжает работать.
 *
 * Переопределения команд (для тестов): DEV_CMD_DASHBOARD / DEV_CMD_HARNESS.
 *
 * Запуск: npm run dev
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  buildChildCommands,
  buildLinePrefixer,
  computeExitCode,
  splitStream,
  type ChildCommand,
  type LinePrefixer,
} from './dev-launcher-utils.js';

/** Грейс-период после SIGTERM перед SIGKILL, мс */
const SHUTDOWN_GRACE_MS = 5000;

/** Цвета префиксов (ANSI SGR): дашборд — голубой, harness — жёлтый */
const PREFIX_CONFIG: Record<string, { label: string; color: string }> = {
  dashboard: { label: '📊 дашборд', color: '36' },
  harness: { label: '🔄 harness', color: '33' },
};
const FALLBACK_COLOR = '90'; // серый — для незнакомых тегов (env-переопределения)

/** Человекочитаемые имена для сообщений лаунчера (не префиксы) */
const DISPLAY_NAMES: Record<string, string> = {
  dashboard: 'дашборд',
  harness: 'harness',
};

interface RunningChild {
  tag: string;
  proc: ChildProcess;
  prefix: LinePrefixer;
  stdoutPending: string;
  stderrPending: string;
  exited: boolean;
}

function main(): void {
  const commands = buildChildCommands();

  if (commands.some((command) => command.cmd === '')) {
    console.error(
      '[dev-launcher] ❌ Пустая команда в DEV_CMD_DASHBOARD / DEV_CMD_HARNESS — проверьте переменные окружения.',
    );
    process.exitCode = 1;
    return;
  }

  const children = new Map<string, RunningChild>();
  const naturalExitCodes: number[] = [];
  const failures: Array<{ tag: string; code: number }> = [];
  let stopping = false;
  let finished = false;

  console.log(
    '[dev-launcher] 🚀 Запуск: дашборд + harness в одном терминале. Ctrl+C — остановить всё.',
  );

  // ─── Вспомогательные функции ─────────────────────────────────────────

  /** Вывод оставшегося (неполного) буфера потока при завершении процесса */
  function flushPending(child: RunningChild): void {
    if (child.stdoutPending !== '') {
      const line = child.prefix(child.stdoutPending, false);
      if (line !== '') {
        process.stdout.write(`${line}\n`);
      }
      child.stdoutPending = '';
    }
    if (child.stderrPending !== '') {
      const line = child.prefix(child.stderrPending, true);
      if (line !== '') {
        process.stderr.write(`${line}\n`);
      }
      child.stderrPending = '';
    }
  }

  /** Обработка завершения дочернего процесса (exit/error) */
  function handleChildExit(tag: string, exitCode: number): void {
    const child = children.get(tag);
    if (!child || child.exited) {
      return;
    }
    child.exited = true;
    flushPending(child);
    children.delete(tag);

    if (stopping) {
      // Завершение инициировано пользователем — код не учитываем.
    } else {
      naturalExitCodes.push(exitCode);
      if (exitCode !== 0) {
        failures.push({ tag, code: exitCode });
      }
      const alive = [...children.keys()]
        .map((name) => DISPLAY_NAMES[name] ?? name)
        .join(', ');
      console.error(
        `[dev-launcher] ⚠️ ${DISPLAY_NAMES[tag] ?? tag} остановился с кодом ${exitCode} (см. логи выше)` +
          (alive !== '' ? `, ${alive} продолжает работу` : ''),
      );
    }

    if (children.size === 0) {
      finish(stopping ? 0 : computeExitCode(naturalExitCodes));
    }
  }

  /** Построчный вывод stdout/stderr ребёнка с префиксом */
  function pipeStreams(child: RunningChild): void {
    const stdout = child.proc.stdout;
    if (stdout) {
      stdout.setEncoding('utf8');
      stdout.on('data', (chunk: string) => {
        const { lines, rest } = splitStream(chunk, child.stdoutPending);
        child.stdoutPending = rest;
        for (const line of lines) {
          const prefixed = child.prefix(line, false);
          if (prefixed !== '') {
            process.stdout.write(`${prefixed}\n`);
          }
        }
      });
    }

    const stderr = child.proc.stderr;
    if (stderr) {
      stderr.setEncoding('utf8');
      stderr.on('data', (chunk: string) => {
        const { lines, rest } = splitStream(chunk, child.stderrPending);
        child.stderrPending = rest;
        for (const line of lines) {
          const prefixed = child.prefix(line, true);
          if (prefixed !== '') {
            process.stderr.write(`${prefixed}\n`);
          }
        }
      });
    }
  }

  /** Запуск одного дочернего процесса */
  function startChild(command: ChildCommand): void {
    const config = PREFIX_CONFIG[command.tag] ?? {
      label: command.tag,
      color: FALLBACK_COLOR,
    };
    const prefix = buildLinePrefixer({
      tag: config.label,
      color: config.color,
    });

    // Без shell: cmd передаём явно. Голое 'node' заменяем на текущий
    // исполняемый файл — надёжнее на Windows (не зависит от PATH).
    const nodeBin = process.execPath;
    const cmd = command.cmd === 'node' ? nodeBin : command.cmd;
    console.log(
      `[dev-launcher] ▶ ${command.tag}: ${cmd} ${command.args.join(' ')}`,
    );

    let proc: ChildProcess;
    try {
      proc = spawn(cmd, command.args, {
        cwd: process.cwd(),
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      console.error(
        `[dev-launcher] ❌ Не удалось запустить ${command.tag}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    const child: RunningChild = {
      tag: command.tag,
      proc,
      prefix,
      stdoutPending: '',
      stderrPending: '',
      exited: false,
    };
    children.set(command.tag, child);
    pipeStreams(child);

    proc.on('error', (err) => {
      console.error(
        `[dev-launcher] ❌ Ошибка процесса ${command.tag}: ${err.message}`,
      );
      handleChildExit(command.tag, 1);
    });

    proc.on('exit', (code, signal) => {
      const exitCode = code ?? (signal !== null ? 1 : 0);
      handleChildExit(command.tag, exitCode);
    });
  }

  /** Вежливая остановка: SIGTERM всем детям, таймаут → SIGKILL */
  function requestStop(): void {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(
      '[dev-launcher] 🛑 Получен сигнал остановки — завершаю дочерние процессы (SIGTERM)...',
    );

    for (const child of children.values()) {
      try {
        child.proc.kill('SIGTERM');
      } catch {
        // процесс мог уже завершиться — игнорируем
      }
    }

    setTimeout(() => {
      for (const child of children.values()) {
        try {
          child.proc.kill('SIGKILL');
        } catch {
          // процесс мог уже завершиться — игнорируем
        }
      }
    }, SHUTDOWN_GRACE_MS);
  }

  /** Финальная сводка и выход */
  function finish(code: number): void {
    if (finished) {
      return;
    }
    finished = true;

    if (failures.length > 0) {
      const parts = failures.map(
        (failure) =>
          `${DISPLAY_NAMES[failure.tag] ?? failure.tag} остановился с кодом ${failure.code} (см. логи выше)`,
      );
      console.log(`[dev-launcher] ⚠️ Итог: ${parts.join('; ')}.`);
    }
    console.log(
      `[dev-launcher] ✅ Все процессы завершены. Итоговый код: ${code}.`,
    );

    process.exitCode = code;
    // Небольшая пауза, чтобы async-вывод (пайпы stdout на Windows) дописался.
    setTimeout(() => process.exit(code), 50);
  }

  // ─── Запуск и регистрация сигналов ──────────────────────────────────

  for (const command of commands) {
    startChild(command);
  }

  if (children.size === 0) {
    console.error('[dev-launcher] ❌ Не удалось запустить ни одного процесса.');
    process.exitCode = 1;
    return;
  }

  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);
}

main();
