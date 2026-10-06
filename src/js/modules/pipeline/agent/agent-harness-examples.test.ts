/**
 * Примеры применения тестового фреймворка к реальным action-агентам.
 *
 * Демонстрирует `createAgentHarness` и `collectExamples` на FileAgent
 * и ConfigAgent (входы которых расширяют единый стандарт
 * `AgentActionInput`). Файл НЕ заменяет полноценные тесты агентов —
 * только показывает работоспособность harness на реальном коде.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectExamples, createAgentHarness } from './agent-testing.js';
import { FileAgent } from '../agents/file-agent.js';
import { ConfigAgent } from '../agents/config-agent.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-harness-examples-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('FileAgent через harness', () => {
  it('expectOk: запись и чтение файла', async () => {
    const agent = new FileAgent({ name: 'FileAgent' }, { roots: [tmp] });
    const harness = await createAgentHarness(agent);

    const write = await harness.expectOk({
      action: 'write',
      path: 'note.txt',
      content: 'hello',
    });
    expect(write.success).toBe(true);
    expect(write.data).toMatchObject({ action: 'write', success: true });

    await harness.expectOk({ action: 'read', path: 'note.txt' }, (result) => {
      const out = result.data as { content?: string };
      expect(out.content).toBe('hello');
    });
  });

  it('expectError: отсутствующий файл и путь вне корня', async () => {
    const agent = new FileAgent({ name: 'FileAgent' }, { roots: [tmp] });
    const harness = await createAgentHarness(agent);

    await harness.expectError(
      { action: 'read', path: 'missing.txt' },
      'не найден',
    );

    await harness.expectError(
      { action: 'read', path: path.join(os.tmpdir(), 'outside.txt') },
      'вне разрешённых корней',
    );
  });
});

describe('ConfigAgent через collectExamples', () => {
  it('прогон набора примеров даёт отчёт passed/failed', async () => {
    const agent = new ConfigAgent({ name: 'ConfigAgent' }, { roots: [tmp] });

    const report = await collectExamples(agent, [
      {
        name: 'запись конфига',
        input: {
          action: 'write',
          path: 'app-config.json',
          data: { theme: 'dark' },
        },
      },
      {
        name: 'чтение конфига',
        input: { action: 'read', path: 'app-config.json' },
        check: (result) => {
          const out = result.data as { data?: unknown; changed?: boolean };
          expect(out.data).toEqual({ theme: 'dark' });
          expect(out.changed).toBe(false);
        },
      },
      {
        name: 'чтение отсутствующего файла — ожидаемая ошибка',
        input: { action: 'read', path: 'missing.json' },
        expect: 'error',
      },
    ]);

    expect(report.total).toBe(3);
    expect(report.passed).toBe(3);
    expect(report.failed).toEqual([]);
  });
});
