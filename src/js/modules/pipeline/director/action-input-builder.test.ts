import type { InterpretedQuestion } from './director-types.js';
import {
  buildFileAgentInput,
  buildTerminalAgentInput,
  detectFileAction,
  extractFilePath,
  extractRenameTarget,
  extractTerminalCommand,
  splitShellTokens,
} from './action-input-builder.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function question(text: string): InterpretedQuestion {
  return {
    category: 'general',
    intent: 'general-inquiry',
    tickers: [],
    topic: text,
    text,
    requiredAgents: [],
    needsConsilium: false,
    complexity: 1,
  };
}

// ─── File: извлечение пути/действия ──────────────────────────────────

describe('action-input-builder: файловые операции', () => {
  it('извлекает путь и write-действие из «Создай файл src/test.ts»', () => {
    const input = buildFileAgentInput(question('Создай файл src/test.ts'));
    expect(input).toEqual({ action: 'write', path: 'src/test.ts' });
  });

  it('извлекает read из «Прочитай файл package.json»', () => {
    const input = buildFileAgentInput(question('Прочитай файл package.json'));
    expect(input).toEqual({ action: 'read', path: 'package.json' });
  });

  it('извлекает delete из «Удали файл src/old.ts»', () => {
    const input = buildFileAgentInput(question('Удали файл src/old.ts'));
    expect(input).toEqual({ action: 'delete', path: 'src/old.ts' });
  });

  it('извлекает read из «Покажи содержимое src/a.ts»', () => {
    const input = buildFileAgentInput(question('Покажи содержимое src/a.ts'));
    expect(input).toEqual({ action: 'read', path: 'src/a.ts' });
  });

  it('извлекает rename с целевым путём', () => {
    const input = buildFileAgentInput(
      question('Переименуй src/a.ts в src/b.ts'),
    );
    expect(input).toEqual({
      action: 'rename',
      path: 'src/a.ts',
      toPath: 'src/b.ts',
    });
  });

  it('извлекает write из «Создай модуль data/config.json»', () => {
    const input = buildFileAgentInput(
      question('Создай модуль data/config.json'),
    );
    expect(input).toEqual({ action: 'write', path: 'data/config.json' });
  });

  it('извлекает относительный путь ./file.ts', () => {
    const input = buildFileAgentInput(question('Прочитай файл ./x.ts'));
    expect(input).toEqual({ action: 'read', path: './x.ts' });
  });

  it('возвращает null для не файлового вопроса', () => {
    expect(buildFileAgentInput(question('Сколько стоит золото?'))).toBeNull();
  });

  it('возвращает null если путь не извлечён', () => {
    // Глагол есть, но файла/пути в тексте нет
    expect(buildFileAgentInput(question('Создай файл'))).toBeNull();
  });

  it('детектирует действие по глаголу', () => {
    expect(detectFileAction('Найди файл с ошибками')).toBe('search');
    expect(detectFileAction('Сохрани в файл данные')).toBe('write');
    expect(detectFileAction('Сколько стоит золото?')).toBeNull();
  });

  it('извлекает путь без завершающих знаков препинания', () => {
    expect(extractFilePath('Открой файл src/a.ts.')).toBe('src/a.ts');
    expect(extractRenameTarget('Переименуй src/a.ts в src/b.ts')).toBe(
      'src/b.ts',
    );
  });
});

// ─── Terminal: извлечение команды ────────────────────────────────────

describe('action-input-builder: терминальные операции', () => {
  it('разбирает «Выполни команду npm run build»', () => {
    const input = buildTerminalAgentInput(
      question('Выполни команду npm run build'),
    );
    expect(input).toEqual({ command: 'npm', args: ['run', 'build'] });
  });

  it('разбирает «npm install lodash»', () => {
    const input = buildTerminalAgentInput(question('npm install lodash'));
    expect(input).toEqual({ command: 'npm', args: ['install', 'lodash'] });
  });

  it('разбирает «git commit -m "fix"»', () => {
    const input = buildTerminalAgentInput(question('git commit -m "fix"'));
    expect(input).toEqual({ command: 'git', args: ['commit', '-m', 'fix'] });
  });

  it('разбирает «Сделай коммит»', () => {
    const input = buildTerminalAgentInput(question('Сделай коммит'));
    expect(input).toEqual({ command: 'git', args: ['commit'] });
  });

  it('разбирает «Собери проект» как npm run build', () => {
    const input = buildTerminalAgentInput(question('Собери проект'));
    expect(input).toEqual({ command: 'npm', args: ['run', 'build'] });
  });

  it('возвращает null для не терминального вопроса', () => {
    expect(
      buildTerminalAgentInput(question('Расскажи про стратегию по SBER')),
    ).toBeNull();
  });

  it('возвращает null при абстрактном «запусти тесты»', () => {
    expect(buildTerminalAgentInput(question('Запусти тесты'))).toBeNull();
  });

  it('разбирает «запусти python main.py»', () => {
    const input = buildTerminalAgentInput(question('Запусти python main.py'));
    expect(input).toEqual({ command: 'python', args: ['main.py'] });
  });

  it('извлекает команду через extractTerminalCommand', () => {
    expect(extractTerminalCommand('Выполни команду git status')).toEqual({
      command: 'git',
      args: ['status'],
    });
    expect(extractTerminalCommand('какой-то обычный текст')).toBeNull();
  });

  it('разбирает кавычки в splitShellTokens', () => {
    expect(splitShellTokens('npm run \'a b\' "c d"')).toEqual([
      'npm',
      'run',
      'a b',
      'c d',
    ]);
  });
});
