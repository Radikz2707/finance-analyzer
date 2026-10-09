/**
 * Command Tokens — единственный токенизатор командных строк конвейера.
 *
 * Раньше логика дублировалась трижды (terminal-agent.tokenize,
 * action-input-builder.splitShellTokens, coding-workflow.splitCommand) —
 * теперь все импортируют отсюда (чистый модуль, без Node-зависимостей,
 * безопасен для браузерного бандла).
 *
 * Поддержка: одинарные/двойные кавычки, пробелы/табы как разделители.
 * НЕ поддерживает shell-метасимволы (|, ;, &&) — они не интерпретируются
 * и остаются частью токена (инъекции отсекаются whitelist'ами агентов).
 */

/** Разбить командную строку на токены (простые кавычки, пробелы) */
export function splitCommandTokens(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (const char of line) {
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

/** Разбить команду на { command, args } (null для пустой строки) */
export function splitCommandWithArgs(
  line: string,
): { command: string; args?: string[] } | null {
  const tokens = splitCommandTokens(line.trim());
  const command = tokens[0];
  if (!command) {
    return null;
  }
  const args = tokens.slice(1);
  return { command, args: args.length > 0 ? args : undefined };
}
