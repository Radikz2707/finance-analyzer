/**
 * TaskExtractor — тесты извлечения задач из свободной речи.
 *
 * Покрывают:
 * - детерминированный fallback (nl-parser + action-input-builder);
 * - LLM-контур (JSON-схема {tasks: [{action, target, params}]});
 * - падение LLM → fallback (честность).
 */

import { TaskExtractor, fallbackExtract } from './task-extractor.js';
import type { LlmChatLike } from './types.js';

// ─── Helpers ───────────────────────────────────────────────────────

function stubLlm(response: string | (() => string)): LlmChatLike {
  return {
    async chat() {
      return typeof response === 'function' ? response() : response;
    },
  };
}

function stubLlmThrow(): LlmChatLike {
  return {
    async chat() {
      throw new Error('Ollama недоступен');
    },
  };
}

// ─── Fallback ──────────────────────────────────────────────────────

describe('TaskExtractor: fallback (nl-parser + action-input-builder)', () => {
  it('«Создай файл src/test.ts с тестом» → file-задача с путём', async () => {
    const extractor = new TaskExtractor();
    const result = await extractor.extract('Создай файл src/test.ts с тестом');

    expect(result.source).toBe('fallback');
    expect(result.tasks.length).toBeGreaterThan(0);

    const fileTask = result.tasks.find((t) => t.action === 'file');
    expect(fileTask).toBeDefined();
    expect(fileTask!.target).toBe('src/test.ts');
    expect(fileTask!.params.action).toBe('write');
    expect(fileTask!.confidence).toBeGreaterThanOrEqual(0.7);
    expect(fileTask!.rawText).toBe('Создай файл src/test.ts с тестом');
  });

  it('«Запусти тесты и покажи результат» → terminal-задача npm run test', async () => {
    const extractor = new TaskExtractor();
    const result = await extractor.extract('Запусти тесты и покажи результат');

    const terminalTask = result.tasks.find((t) => t.action === 'terminal');
    expect(terminalTask).toBeDefined();
    expect(terminalTask!.params.command).toBe('npm');
    expect(terminalTask!.params.args).toEqual(['run', 'test']);
    expect(terminalTask!.target).toBe('npm run test');
  });

  it('«Реализуй функцию в src/js/modules/x/y.ts» → code-задача с файлом', async () => {
    const extractor = new TaskExtractor();
    const result = await extractor.extract(
      'Реализуй функцию в src/js/modules/x/y.ts',
    );

    const codeTask = result.tasks.find((t) => t.action === 'code');
    expect(codeTask).toBeDefined();
    const files = codeTask!.params.files as string[];
    expect(files).toContain('src/js/modules/x/y.ts');
  });

  it('«Добавь в план: покрыть модуль тестами» → goal-задача', async () => {
    const extractor = new TaskExtractor();
    const result = await extractor.extract(
      'Добавь в план: покрыть модуль тестами',
    );

    const goalTask = result.tasks.find((t) => t.action === 'goal');
    expect(goalTask).toBeDefined();
    expect(goalTask!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('«Установи пакет lodash» → package-задача', async () => {
    const extractor = new TaskExtractor();
    const result = await extractor.extract('Установи пакет lodash');

    const packageTask = result.tasks.find((t) => t.action === 'package');
    expect(packageTask).toBeDefined();
    expect(packageTask!.params.action).toBe('install');
    expect(packageTask!.params.packages).toContain('lodash');
  });

  it('«Запусти процесс python main.py» → process-задача', async () => {
    const extractor = new TaskExtractor();
    const result = await extractor.extract('Запусти процесс python main.py');

    const processTask = result.tasks.find((t) => t.action === 'process');
    expect(processTask).toBeDefined();
    expect(processTask!.params.action).toBe('start');
  });

  it('«Запусти workflow nightly» → automation-задача', async () => {
    const extractor = new TaskExtractor();
    const result = await extractor.extract('Запусти workflow nightly');

    const automationTask = result.tasks.find((t) => t.action === 'automation');
    expect(automationTask).toBeDefined();
    expect(automationTask!.params.action).toBe('run-now');
  });

  it('финансовый вопрос → research-задача с низкой уверенностью', async () => {
    const extractor = new TaskExtractor();
    const result = await extractor.extract('Что с SBER?');

    const researchTask = result.tasks.find((t) => t.action === 'research');
    expect(researchTask).toBeDefined();
    expect(researchTask!.target).toContain('SBER');
    // Ниже порога Director (0.7): категорийная маршрутизация остаётся основным путём
    expect(researchTask!.confidence).toBeLessThan(0.7);
  });

  it('приветствие не извлекается как задача', async () => {
    const extractor = new TaskExtractor();
    const result = await extractor.extract('Привет');

    expect(result.tasks).toHaveLength(0);
  });

  it('пустой текст → пустой результат', async () => {
    const extractor = new TaskExtractor();
    const result = await extractor.extract('   ');

    expect(result.tasks).toHaveLength(0);
    expect(result.rawText).toBe('');
  });
});

// ─── LLM-контур ────────────────────────────────────────────────────

describe('TaskExtractor: LLM-контур', () => {
  it('валидный JSON → задачи с source=llm', async () => {
    const extractor = new TaskExtractor({
      llm: stubLlm(
        '{"tasks":[{"action":"file","target":"src/test.ts","params":{"action":"write"}}]}',
      ),
    });

    expect(extractor.hasLlm()).toBe(true);
    const result = await extractor.extract('Создай файл src/test.ts с тестом');

    expect(result.source).toBe('llm');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.action).toBe('file');
    expect(result.tasks[0]!.target).toBe('src/test.ts');
    expect(result.tasks[0]!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('несколько задач из одной реплики', async () => {
    const extractor = new TaskExtractor({
      llm: stubLlm(
        '{"tasks":[{"action":"terminal","target":"npm run test","params":{"command":"npm","args":["run","test"]}},{"action":"file","target":"src/test.ts","params":{"action":"write"}}]}',
      ),
    });
    const result = await extractor.extract('Запусти тесты и создай файл');

    expect(result.source).toBe('llm');
    expect(result.tasks).toHaveLength(2);
  });

  it('невалидный action отбрасывается', async () => {
    const extractor = new TaskExtractor({
      llm: stubLlm(
        '{"tasks":[{"action":"hack","target":"x","params":{}},{"action":"file","target":"src/a.ts","params":{"action":"write"}}]}',
      ),
    });
    const result = await extractor.extract('Создай файл');

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.action).toBe('file');
  });

  it('пустой tasks → fallback', async () => {
    const extractor = new TaskExtractor({
      llm: stubLlm('{"tasks":[]}'),
    });
    const result = await extractor.extract('Создай файл src/test.ts');

    expect(result.source).toBe('fallback');
    expect(result.tasks.length).toBeGreaterThan(0);
  });

  it('невалидный JSON → fallback', async () => {
    const extractor = new TaskExtractor({
      llm: stubLlm('не JSON вообще'),
    });
    const result = await extractor.extract('Создай файл src/test.ts');

    expect(result.source).toBe('fallback');
  });

  it('падение LLM → fallback (никогда не бросает)', async () => {
    const extractor = new TaskExtractor({ llm: stubLlmThrow() });
    const result = await extractor.extract('Создай файл src/test.ts');

    expect(result.source).toBe('fallback');
    expect(result.tasks.length).toBeGreaterThan(0);
  });

  it('таймаут LLM → fallback', async () => {
    const slowLlm: LlmChatLike = {
      chat() {
        return new Promise<string>((resolve) => {
          setTimeout(() => resolve('{"tasks":[]}'), 200);
        });
      },
    };
    const extractor = new TaskExtractor({ llm: slowLlm, timeoutMs: 20 });
    const result = await extractor.extract('Создай файл src/test.ts');

    expect(result.source).toBe('fallback');
  });
});

// ─── fallbackExtract (чистая функция) ──────────────────────────────

describe('fallbackExtract (чистая функция)', () => {
  it('возвращает детерминированный результат без LLM', () => {
    const result = fallbackExtract('Создай файл data/config.json');

    expect(result.source).toBe('fallback');
    const fileTask = result.tasks.find((t) => t.action === 'file');
    expect(fileTask!.target).toBe('data/config.json');
  });
});
