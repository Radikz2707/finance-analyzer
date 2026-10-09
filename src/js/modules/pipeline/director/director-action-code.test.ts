/**
 * Director + CodingWorkflow (роль `code`).
 *
 * Покрытие:
 * - запрос разработки в чате → Director выбирает роль code → CodingWorkflow
 *   пишет файлы и запускает проверку (моки вместо реальных npm test);
 * - без code-агента — человечный ответ про десктопный режим;
 * - security deny — разработка не выполняется;
 * - запрос без путей → честный отказ с подсказкой;
 * - роль code попадает в connectedAgents.
 *
 * ВАЖНО: импорт { describe, it, expect } из 'vitest' НЕ используется —
 * он создаёт второй экземпляр @vitest/runner и ломает контекст тестов
 * (TypeError: Cannot read properties of undefined (reading 'config')).
 * Все тесты используют глобалы (globals: true).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodingWorkflow } from '../coding-workflow/coding-workflow.js';
import type { SecurityVerdict } from '../agents/security-agent.js';
import {
  DirectorAgentFacade,
  type ActionSecurityGate,
} from './agent-facade.js';
import { DirectorAgent } from './director.js';
import type { DirectorFactsContext } from './director-types.js';

// ─── Helpers ─────────────────────────────────────────────────────────

let tempRoot: string | null = null;

function makeTempRoot(): string {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'director-code-'));
  return tempRoot;
}

function emptyFacts(): DirectorFactsContext {
  return { assetsAnalysis: [], totalPortfolioValue: 0, freeCashRub: 0 };
}

function mockSecurityGate(verdict: SecurityVerdict): ActionSecurityGate {
  return {
    check: async (request) => ({
      id: 'sec-mock',
      timestamp: new Date().toISOString(),
      request,
      verdict,
      reason: verdict === 'deny' ? 'запрещено тестовым шлюзом' : undefined,
      matchedRules: ['test.rule'],
    }),
  };
}

/** Мок FileAgent: успешная запись */
function makeMockFileAgent(): {
  execute(input: unknown): Promise<{ success: boolean; data?: unknown }>;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    async execute(input: unknown) {
      calls.push(input);
      return { success: true, data: { success: true, message: 'ok' } };
    },
  };
}

/** Мок TerminalAgent: всегда exit 0 (проверка пройдена) */
function makeMockTerminalAgent(): {
  execute(input: unknown): Promise<{ success: boolean; data?: unknown }>;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    async execute(input: unknown) {
      calls.push(input);
      return {
        success: true,
        data: {
          command: 'npm run test',
          stdout: '',
          stderr: '',
          exitCode: 0,
          durationMs: 1,
          truncated: false,
        },
      };
    },
  };
}

function makeCodeWorkflow(root: string): {
  workflow: CodingWorkflow;
  file: ReturnType<typeof makeMockFileAgent>;
} {
  const file = makeMockFileAgent();
  const workflow = new CodingWorkflow(
    { name: 'CodingWorkflow' },
    {
      roots: [root],
      fileAgent: file as never,
      terminalAgent: makeMockTerminalAgent() as never,
    },
  );
  return { workflow, file };
}

function buildDirector(facade: DirectorAgentFacade): DirectorAgent {
  const director = new DirectorAgent(
    { facade, initialFacts: emptyFacts(), random: () => 0 },
    { maxConsiliumRounds: 3 },
  );
  director.createSession();
  return director;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Director + CodingWorkflow (роль code)', () => {
  beforeEach(() => {
    tempRoot = null;
  });

  afterEach(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('1. Задача разработки в чате → Director делегирует CodingWorkflow', async () => {
    const root = makeTempRoot();
    const { workflow, file } = makeCodeWorkflow(root);
    const facade = new DirectorAgentFacade({
      actionAgents: { code: workflow },
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Реализуй функционал в src/js/modules/new/feature.ts',
    );

    const entry = response.task!.agentResults.find((r) => r.role === 'code');
    expect(entry).toBeDefined();
    expect(entry!.success).toBe(true);

    const payload = entry!.data as { summary?: string };
    expect(payload.summary).toContain('Разработка завершена');
    expect(response.text).toContain('Разработка завершена');

    // FileAgent внутри CodingWorkflow записал файл-заготовку
    expect(file.calls).toEqual([
      {
        action: 'write',
        path: 'src/js/modules/new/feature.ts',
        content: '',
      },
    ]);
  });

  it('2. Без code-агента — человечный ответ про десктопный режим', async () => {
    const facade = new DirectorAgentFacade();
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Реализуй функционал в src/js/modules/new/feature.ts',
    );

    const entry = response.task!.agentResults.find((r) => r.role === 'code');
    expect(entry).toBeDefined();
    expect(entry!.success).toBe(true);

    const payload = entry!.data as { summary?: string };
    expect(payload.summary).toBe(
      'Разработка кода доступна в десктопном режиме',
    );
    expect(response.text).toContain('в десктопном режиме');
  });

  it('3. Security deny — разработка не выполняется', async () => {
    const root = makeTempRoot();
    const facade = new DirectorAgentFacade({
      actionAgents: { code: makeCodeWorkflow(root).workflow },
      security: mockSecurityGate('deny'),
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Реализуй функционал в src/js/modules/new/feature.ts',
    );

    const entry = response.task!.agentResults.find((r) => r.role === 'code');
    const payload = entry!.data as { summary?: string };
    expect(payload.summary).toContain('Операция отклонена');
    // Файл не создан
    expect(
      fs.existsSync(
        path.join(root, 'src', 'js', 'modules', 'new', 'feature.ts'),
      ),
    ).toBe(false);
    expect(response.text).toContain('Операция отклонена');
  });

  it('4. Запрос разработки без путей → честный отказ с подсказкой', async () => {
    const root = makeTempRoot();
    const facade = new DirectorAgentFacade({
      actionAgents: { code: makeCodeWorkflow(root).workflow },
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Реализуй функционал для портфеля',
    );

    const entry = response.task!.agentResults.find((r) => r.role === 'code');
    const payload = entry!.data as { summary?: string };
    expect(payload.summary).toContain('Не удалось определить файлы');
    expect(response.text).toContain('Не удалось определить файлы');
  });

  it('5. Роль code попадает в connectedAgents', async () => {
    const root = makeTempRoot();
    const facade = new DirectorAgentFacade({
      actionAgents: { code: makeCodeWorkflow(root).workflow },
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Реализуй функционал в src/js/modules/new/feature.ts',
    );

    expect(response.connectedAgents).toContain('code');
    expect(response.task!.agents.map((a) => a.role)).toContain('code');
  });
});
