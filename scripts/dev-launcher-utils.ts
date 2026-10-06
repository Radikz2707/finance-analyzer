/// <reference types="node" />
/**
 * Чистые утилиты dev-launcher (единый запуск `npm run dev`):
 *  - построение цветных префиксов строк;
 *  - буферизация потока по `\n` (без разрыва ANSI и смешивания строк);
 *  - построение команд дочерних процессов с env-переопределениями
 *    DEV_CMD_DASHBOARD / DEV_CMD_HARNESS (для тестов — фиктивные команды);
 *  - логика итогового кода выхода.
 *
 * Модуль не имеет побочных эффектов при импорте; единственное чтение
 * окружения — внутри buildChildCommands() (осознанный DI для тестов).
 */

/** Команда дочернего процесса */
export interface ChildCommand {
  /** Метка процесса: 'dashboard' | 'harness' */
  tag: string;
  /** Исполняемый файл */
  cmd: string;
  /** Аргументы команды */
  args: string[];
}

/** Настройки префикса строки */
export interface LinePrefixOptions {
  /** Текст тега внутри префикса, например '📊 дашборд' */
  tag: string;
  /** ANSI SGR-код цвета (номер), например '36' — голубой */
  color: string;
}

/**
 * Функция префикса: `(line, isStderr?) => prefixedLine`.
 * Для пустой/пробельной строки возвращает '' (строка пропускается).
 */
export type LinePrefixer = (line: string, isStderr?: boolean) => string;

/** Результат буферизации чанка потока */
export interface SplitResult {
  /** Полные строки без `\n` (уже обработаны как минимум один раз) */
  lines: string[];
  /** Неполный хвост, ожидающий следующих чанков */
  rest: string;
}

const DEFAULT_DASHBOARD: Readonly<ChildCommand> = {
  tag: 'dashboard',
  cmd: 'node',
  args: ['node_modules/gulp/bin/gulp.js', 'start'],
};

const DEFAULT_HARNESS: Readonly<ChildCommand> = {
  tag: 'harness',
  cmd: 'node',
  args: ['--import', 'tsx', 'scripts/harness-start.ts'],
};

/**
 * Разбор строки команды вида `cmd arg "quoted arg" 'quoted'` в токены.
 * Поддержаны одинарные/двойные кавычки и экранирование `\"`/`\\` внутри
 * двойных — достаточно для env-переопределений вида
 * `node -e "console.log(\"up\"); setTimeout(()=>{},60000)"`.
 */
export function parseCommandLine(input: string): {
  cmd: string;
  args: string[];
} {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let hasContent = false;

  const pushToken = (): void => {
    tokens.push(current);
    current = '';
    hasContent = false;
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] as string;

    if (quote === '"') {
      if (ch === '\\') {
        const next = input[i + 1];
        if (next === '"' || next === '\\') {
          current += next as string;
          i += 1;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        quote = null;
      } else {
        current += ch;
      }
      hasContent = true;
    } else if (quote === "'") {
      if (ch === "'") {
        quote = null;
      } else {
        current += ch;
      }
      hasContent = true;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasContent = true;
    } else if (ch === ' ' || ch === '\t') {
      if (hasContent) {
        pushToken();
      }
    } else {
      current += ch;
      hasContent = true;
    }
  }

  if (hasContent) {
    pushToken();
  }

  return { cmd: tokens[0] ?? '', args: tokens.slice(1) };
}

/**
 * Построить функцию-префиксер: добавляет ANSI-цветной `[tag]` перед строкой,
 * а для stderr — дополнительный красный маркер `[ERR]`.
 * Пустые строки игнорируются (возвращается '').
 */
export function buildLinePrefixer(options: LinePrefixOptions): LinePrefixer {
  const { tag, color } = options;
  const tagPrefix = `\x1b[${color}m[${tag}]\x1b[0m`;

  return (line, isStderr = false): string => {
    if (line.trim() === '') {
      return '';
    }
    if (isStderr) {
      return `${tagPrefix} \x1b[31m[ERR]\x1b[0m ${line}`;
    }
    return `${tagPrefix} ${line}`;
  };
}

/**
 * Буферизация потока: склеивает `pending` с чанком, режет по `\n`.
 * Возвращает полные строки (без переводов строк) и неполный хвост.
 * Завершающие `\r` (CRLF из Windows) срезаются.
 */
export function splitStream(
  chunk: Buffer | string,
  pending: string,
): SplitResult {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  const combined = pending + text;
  const segments = combined.split('\n');
  const rest = segments.pop() ?? '';
  const lines = segments.map((segment) =>
    segment.endsWith('\r') ? segment.slice(0, -1) : segment,
  );
  return { lines, rest };
}

/**
 * Собрать команды дочерних процессов:
 *   dashboard → `node node_modules/gulp/bin/gulp.js start`;
 *   harness   → `node --import tsx scripts/harness-start.ts`.
 *
 * Переопределения из окружения:
 *   DEV_CMD_DASHBOARD / DEV_CMD_HARNESS — строка вида `cmd arg "quoted arg"`,
 *   позволяющая подставить фиктивные короткие команды в тестах.
 */
export function buildChildCommands(): ChildCommand[] {
  const dashboardOverride = process.env.DEV_CMD_DASHBOARD;
  const harnessOverride = process.env.DEV_CMD_HARNESS;

  return [
    dashboardOverride
      ? { tag: 'dashboard', ...parseCommandLine(dashboardOverride) }
      : { ...DEFAULT_DASHBOARD },
    harnessOverride
      ? { tag: 'harness', ...parseCommandLine(harnessOverride) }
      : { ...DEFAULT_HARNESS },
  ];
}

/**
 * Итоговый код выхода: код первого дочернего процесса, завершившегося сам
 * (в порядке событий exit), либо 0, если таких не было (остановка пользователем).
 */
export function computeExitCode(codes: number[]): number {
  return codes[0] ?? 0;
}
