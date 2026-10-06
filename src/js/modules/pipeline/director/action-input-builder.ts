/**
 * Action Input Builder — роутер входа для action-агентов Director.
 *
 * Превращает интерпретированный вопрос пользователя в конкретный вход
 * агента: `FileAgentInput` (путь + действие) или `TerminalAgentInput`
 * (команда + аргументы).
 *
 * ⚠️ Модуль чистый (без Node-зависимостей): работает и в браузере, и в Node.
 * Типы агентов импортируются как type-only (стираются при сборке).
 *
 * Принцип: честность. Если данные (путь/команда) не извлекаются — вернуть
 * `null`, а не выдумывать операцию. Парсеры переиспользуют
 * `looksLikeFileRequest` / `looksLikeTerminalRequest` из nl-parser.
 */

import type { FileAgentAction, FileAgentInput } from '../agents/file-agent.js';
import type { TerminalAgentInput } from '../agents/terminal-agent.js';
import type { InterpretedQuestion } from './director-types.js';
import { looksLikeFileRequest, looksLikeTerminalRequest } from './nl-parser.js';

// ──────────────────────────────────────────────
// 1. Файловые операции
// ──────────────────────────────────────────────

/** Действия FileAgent по глаголам запроса (в порядке приоритета) */
const FILE_ACTION_PATTERNS: ReadonlyArray<{
  action: FileAgentAction;
  patterns: ReadonlyArray<RegExp>;
}> = [
  {
    action: 'read',
    patterns: [
      /прочитай файл/i,
      /прочитать файл/i,
      /открой файл/i,
      /открыть файл/i,
      /что в файле/i,
      /что в файлах/i,
      /покажи содержимое/i,
      /показать содержимое/i,
    ],
  },
  {
    action: 'delete',
    patterns: [/удали файл/i, /удалить файл/i],
  },
  {
    action: 'rename',
    patterns: [/переименуй/i, /переименовать/i],
  },
  {
    action: 'search',
    patterns: [/найди файл/i, /найти файл/i],
  },
  {
    action: 'list',
    patterns: [
      /покажи файлы/i,
      /показать файлы/i,
      /список файлов/i,
      /листинг/i,
    ],
  },
  {
    action: 'write',
    patterns: [
      /создай файл/i,
      /создать файл/i,
      /создай модуль/i,
      /создать модуль/i,
      /запиши в файл/i,
      /записать в файл/i,
      /сохрани в файл/i,
      /сохранить в файл/i,
      /сделай отчёт/i,
      /сделай отчет/i,
      /создай отчёт/i,
      /создай отчет/i,
      /сформируй отчёт/i,
      /сформируй отчет/i,
    ],
  },
];

/** Паттерны извлечения пути из запроса (в порядке приоритета) */
const PATH_EXTRACTION_PATTERNS: ReadonlyArray<RegExp> = [
  // «файл src/test.ts», «в файл data.json», «файла package.json»
  /(?:файл|файла|в файл|в файле|в папку|в директорию)\s*[:：]?\s*([^\s,;"']+)/i,
  // «путь: src/a.ts», «по пути ./b.ts»
  /(?:по пути|путь)\s*[:：]?\s*([^\s,;"']+)/i,
  // Пути проекта (корни src/, data/, ...)
  /(?:^|\s)((?:src|data|docs|config|public|test|tests|scripts|gulp|quik|dist|archives)[\\/][a-zA-Z0-9_./-]+)/i,
  // Относительные пути (./file.ts, ../file.json)
  /(?:^|\s)(\.{1,2}[\\/][a-zA-Z0-9_./-]+)/i,
  // Файлы по расширению (package.json, src/test.ts)
  /(?:^|\s)([a-zA-Z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|yaml|yml|md|markdown|txt|html|htm|css|scss|py|xml|csv|sql|env|sh|log)\b)/i,
];

/**
 * Извлечь путь файла/директории из текста запроса.
 * Возвращает null, если путь не найден.
 */
export function extractFilePath(text: string): string | null {
  for (const pattern of PATH_EXTRACTION_PATTERNS) {
    const match = text.match(pattern);
    const candidate = match?.[1];
    if (candidate) {
      return trimTrailingPunctuation(candidate);
    }
  }
  return null;
}

/** Определить действие FileAgent по формулировке запроса */
export function detectFileAction(text: string): FileAgentAction | null {
  const lower = text.toLowerCase();
  for (const entry of FILE_ACTION_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(lower)) {
        return entry.action;
      }
    }
  }
  return null;
}

/** Извлечь целевой путь для rename («в src/b.ts», «на src/b.ts») */
export function extractRenameTarget(text: string): string | null {
  const match = text.match(/\s(?:в|на)\s+([^\s,;"']+)\s*$/i);
  const candidate = match?.[1];
  return candidate ? trimTrailingPunctuation(candidate) : null;
}

/**
 * Построить вход FileAgent из интерпретированного вопроса.
 * Возвращает null, если операция не распознана или путь не извлечён
 * (честный отказ — не выдумываем действие).
 */
export function buildFileAgentInput(
  question: InterpretedQuestion,
): FileAgentInput | null {
  if (!looksLikeFileRequest(question.text)) {
    return null;
  }
  const action = detectFileAction(question.text);
  if (!action) {
    return null;
  }
  const target = extractFilePath(question.text);
  if (!target) {
    return null;
  }

  if (action === 'rename') {
    const toPath = extractRenameTarget(question.text);
    if (toPath) {
      return { action, path: target, toPath };
    }
  }
  return { action, path: target };
}

// ──────────────────────────────────────────────
// 2. Терминальные операции
// ──────────────────────────────────────────────

/**
 * Разобрать строку команды на command + args.
 * Поддерживает простые кавычки ('...' и "...").
 */
export function splitShellTokens(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current !== '') {
    tokens.push(current);
  }
  return tokens;
}

/** Разобрать строку команды: { command, args } | null (пустая строка) */
function parseCommandString(commandLine: string): TerminalAgentInput | null {
  const tokens = splitShellTokens(commandLine.trim());
  const command = tokens[0];
  if (!command) {
    return null;
  }
  return { command, args: tokens.slice(1) };
}

/** Правила распознавания команд (в порядке приоритета) */
const COMMAND_RULES: ReadonlyArray<{
  pattern: RegExp;
  build: (match: RegExpMatchArray) => TerminalAgentInput | null;
}> = [
  {
    // «выполни команду npm run build»
    pattern: /выполни\s+команду\s*[:：]?\s*(.+)/i,
    build: (match) => parseCommandString(match[1] ?? ''),
  },
  {
    // «выполни ls -la» / «выполнить git status»
    pattern: /выполни(?:ть)?\s+(.+)/i,
    build: (match) => parseCommandString(match[1] ?? ''),
  },
  {
    // «npm install lodash», «npm run build», «npm ci»
    pattern: /\bnpm\s+(install|ci|run|update|uninstall|build)(?:\s+(.+))?$/i,
    build: (match) =>
      parseCommandString(
        `npm ${match[1] ?? ''}${match[2] ? ` ${match[2]}` : ''}`,
      ),
  },
  {
    // «npx tsc --noEmit»
    pattern: /\bnpx\s+(.+)$/i,
    build: (match) => parseCommandString(`npx ${match[1] ?? ''}`),
  },
  {
    // «pip install requests»
    pattern: /\bpip\s+install\s+(.+)$/i,
    build: (match) => parseCommandString(`pip install ${match[1] ?? ''}`),
  },
  {
    // «git commit -m "fix"», «git push origin main»
    pattern:
      /\bgit\s+(commit|push|pull|add|status|clone|branch|log)(?:\s+(.+))?$/i,
    build: (match) =>
      parseCommandString(
        `git ${match[1] ?? ''}${match[2] ? ` ${match[2]}` : ''}`,
      ),
  },
  {
    // «сделай коммит» / «сделать коммит»
    pattern: /(?:сделай|сделать)\s+коммит/i,
    build: () => parseCommandString('git commit'),
  },
  {
    // «закоммить изменения»
    pattern: /закоммит/i,
    build: () => parseCommandString('git commit'),
  },
  {
    // «собери проект» / «собрать проект»
    pattern: /(?:собери|собрать)\s+проект/i,
    build: () => parseCommandString('npm run build'),
  },
  {
    // «запусти скрипт deploy.sh» / «запусти python main.py»
    pattern: /(?:запусти|запустить)\s+(?:скрипт\s+)?(.+)/i,
    build: (match) => {
      const rest = (match[1] ?? '').trim();
      // «запусти тесты» — абстрактно, без команды: честный отказ.
      // Точное совпадение: \b не работает с кириллицей (JS \w — только ASCII).
      if (
        /^(тесты|тест|проект|сборка|скрипт|приложение|всё|все)$/i.test(rest)
      ) {
        return null;
      }
      return parseCommandString(rest);
    },
  },
];

/**
 * Извлечь команду терминала из текста запроса.
 * Возвращает null, если команда не извлекается.
 */
export function extractTerminalCommand(
  text: string,
): TerminalAgentInput | null {
  for (const rule of COMMAND_RULES) {
    const match = text.match(rule.pattern);
    if (match) {
      const parsed = rule.build(match);
      if (parsed && parsed.command !== '') {
        return parsed;
      }
    }
  }
  return null;
}

/**
 * Построить вход TerminalAgent из интерпретированного вопроса.
 * Возвращает null, если запрос не терминальный или команда не извлекается.
 */
export function buildTerminalAgentInput(
  question: InterpretedQuestion,
): TerminalAgentInput | null {
  if (!looksLikeTerminalRequest(question.text)) {
    return null;
  }
  return extractTerminalCommand(question.text);
}

// ──────────────────────────────────────────────
// 3. Хелперы
// ──────────────────────────────────────────────

/** Обрезать завершающие знаки препинания из извлечённого пути */
function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?»"')\]]+$/u, '').trim();
}
