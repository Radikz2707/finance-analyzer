import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileAgent } from '../agents/file-agent.js';
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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'director-action-'));
  return tempRoot;
}

function emptyFacts(): DirectorFactsContext {
  return { assetsAnalysis: [], totalPortfolioValue: 0, freeCashRub: 0 };
}

/** Мок шлюза безопасности с фиксированным вердиктом */
function mockSecurityGate(verdict: SecurityVerdict): ActionSecurityGate {
  return {
    check: async (request) => ({
      id: 'sec-mock',
      timestamp: new Date().toISOString(),
      request,
      verdict,
      reason: verdict === 'deny' ? 'запрещено тестовым шлюзом' : undefined,
      description:
        verdict === 'require-confirmation'
          ? 'требует ручного подтверждения'
          : undefined,
      matchedRules: ['test.rule'],
    }),
  };
}

function buildDirector(facade: DirectorAgentFacade): DirectorAgent {
  const director = new DirectorAgent(
    { facade, initialFacts: emptyFacts() },
    { maxConsiliumRounds: 3 },
  );
  director.createSession();
  return director;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Director + action-агенты (file/terminal)', () => {
  beforeEach(() => {
    tempRoot = null;
  });

  afterEach(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('1. Создаёт файл через FileAgent (Node-режим)', async () => {
    const root = makeTempRoot();
    const facade = new DirectorAgentFacade({
      actionAgents: {
        file: new FileAgent({ name: 'FileAgent' }, { roots: [root] }),
      },
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Создай файл src/test.ts',
    );

    const fileResult = response.task!.agentResults.find(
      (r) => r.role === 'file',
    );
    expect(fileResult).toBeDefined();
    expect(fileResult!.success).toBe(true);

    const created = path.join(root, 'src', 'test.ts');
    expect(fs.existsSync(created)).toBe(true);

    const payload = fileResult!.data as { summary?: string };
    expect(payload.summary).toContain('Файл записан');
    // Результат доходит до пользователя
    expect(response.text).toContain('Файл записан');
  });

  it('2. Без actionAgents — человечный ответ про десктопный режим', async () => {
    const facade = new DirectorAgentFacade();
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Создай файл src/test.ts',
    );

    const fileResult = response.task!.agentResults.find(
      (r) => r.role === 'file',
    );
    // Фасад не бросил исключение: результат успешен
    expect(fileResult).toBeDefined();
    expect(fileResult!.success).toBe(true);

    const payload = fileResult!.data as { summary?: string };
    expect(payload.summary).toBe(
      'Файловые операции доступны в десктопном режиме',
    );
    expect(response.text).toContain('доступны в десктопном режиме');
    expect(response.text).not.toContain('Неизвестная роль агента');
  });

  it('3. Security deny — отказ без создания файла', async () => {
    const root = makeTempRoot();
    const facade = new DirectorAgentFacade({
      actionAgents: {
        file: new FileAgent({ name: 'FileAgent' }, { roots: [root] }),
      },
      security: mockSecurityGate('deny'),
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Создай файл src/test.ts',
    );

    const fileResult = response.task!.agentResults.find(
      (r) => r.role === 'file',
    );
    expect(fileResult!.success).toBe(true);
    const payload = fileResult!.data as { summary?: string };
    expect(payload.summary).toContain('Операция отклонена');

    // Файл не создан
    expect(fs.existsSync(path.join(root, 'src', 'test.ts'))).toBe(false);
    expect(response.text).toContain('Операция отклонена');
  });

  it('4. Security require-confirmation — подтверждение без выполнения', async () => {
    const root = makeTempRoot();
    const facade = new DirectorAgentFacade({
      actionAgents: {
        file: new FileAgent({ name: 'FileAgent' }, { roots: [root] }),
      },
      security: mockSecurityGate('require-confirmation'),
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Создай файл src/test.ts',
    );

    const fileResult = response.task!.agentResults.find(
      (r) => r.role === 'file',
    );
    const payload = fileResult!.data as { summary?: string };
    expect(payload.summary).toContain('Требуется подтверждение');
    expect(fs.existsSync(path.join(root, 'src', 'test.ts'))).toBe(false);
    expect(response.text).toContain('Требуется подтверждение');
  });

  it('5. Terminal без агента — человечный ответ про десктопный режим', async () => {
    const facade = new DirectorAgentFacade();
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Выполни команду npm run build',
    );

    const termResult = response.task!.agentResults.find(
      (r) => r.role === 'terminal',
    );
    expect(termResult).toBeDefined();
    expect(termResult!.success).toBe(true);
    const payload = termResult!.data as { summary?: string };
    expect(payload.summary).toBe(
      'Терминальные операции доступны в десктопном режиме',
    );
    expect(response.text).toContain('доступны в десктопном режиме');
  });

  it('6. Роль file попадает в connectedAgents', async () => {
    const facade = new DirectorAgentFacade();
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Создай файл src/test.ts',
    );

    expect(response.connectedAgents).toContain('file');
    expect(response.task!.agents.map((a) => a.role)).toContain('file');
  });
});
