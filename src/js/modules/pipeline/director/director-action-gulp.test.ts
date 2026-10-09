/**
 * Director + gulp-конструкторы ресурсов и обновление зависимостей.
 *
 * Покрытие:
 * - «создай блок/модуль/плагин <имя>» → роль terminal с npm run
 *   create|module|plugin -- --<имя>;
 * - «удали <вид> <имя>» → npm run remove -- --<имя> + require-confirmation;
 * - «обнови модули/зависимости» → неинтерактивный npm-сценарий
 *   npm run update-modules:auto (интерактивный -i агенту недоступен);
 * - «разверни базовую структуру» → npm run init;
 * - пути/расширения («создай модуль data/config.json») остаются файловыми
 *   операциями и НЕ захватываются конструктором;
 * - SecurityAgent: npm-мутации (install/uninstall/remove/update/init) —
 *   require-confirmation; безопасные команды (npm run build) — allow.
 *
 * ВАЖНО: импорт { describe, it, expect } из 'vitest' НЕ используется —
 * он создаёт второй экземпляр @vitest/runner и ломает контекст тестов
 * (TypeError: Cannot read properties of undefined (reading 'config')).
 * Все тесты используют глобалы (globals: true).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseUserMessage } from './nl-parser.js';
import { buildTerminalAgentInput } from './action-input-builder.js';
import {
  DirectorAgentFacade,
  type ActionSecurityGate,
} from './agent-facade.js';
import { DirectorAgent } from './director.js';
import type { DirectorFactsContext } from './director-types.js';
import type { AgentSummary, IAgent } from '../agent/types.js';
import type {
  TerminalAgentInput,
  TerminalAgentOutput,
} from '../agents/terminal-agent.js';
import { SecurityAgent } from '../agents/security-agent.js';
import type { SecurityVerdict } from '../agents/security-agent.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function emptyFacts(): DirectorFactsContext {
  return { assetsAnalysis: [], totalPortfolioValue: 0, freeCashRub: 0 };
}

function question(text: string) {
  return {
    category: 'general' as const,
    intent: 'general-inquiry' as const,
    tickers: [],
    topic: text,
    text,
    requiredAgents: [],
    needsConsilium: false,
    complexity: 1,
  };
}

/** Мок-агент, совместимый с IAgent, с журналом вызовов (без vi) */
interface MockAgent<TInput> extends IAgent<TInput> {
  readonly calls: TInput[];
}

function makeMockTerminalAgent(): MockAgent<TerminalAgentInput> {
  const calls: TerminalAgentInput[] = [];
  return {
    name: 'TerminalAgent',
    state: 'idle',
    calls,
    async execute(input: TerminalAgentInput) {
      calls.push(input);
      const output: TerminalAgentOutput = {
        command: `${input.command} ${(input.args ?? []).join(' ')}`.trim(),
        exitCode: 0,
        stdout: '',
        stderr: '',
        truncated: false,
        durationMs: 1,
      };
      return {
        success: true,
        data: output,
        durationMs: 1,
        completedAt: new Date().toISOString(),
      };
    },
    async stop() {},
    getSummary(): AgentSummary {
      return {
        name: 'TerminalAgent',
        state: 'idle',
        totalExecutions: 0,
        totalSuccesses: 0,
        totalFailures: 0,
      };
    },
  } as MockAgent<TerminalAgentInput>;
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
          ? 'мутация проекта — подтвердите вручную'
          : undefined,
      matchedRules: ['test.rule'],
    }),
  };
}

function buildDirector(facade: DirectorAgentFacade): DirectorAgent {
  const director = new DirectorAgent(
    { facade, initialFacts: emptyFacts(), random: () => 0 },
    { maxConsiliumRounds: 3 },
  );
  director.createSession();
  return director;
}

// ─── Tests: nl-parser + action-input-builder ─────────────────────────

describe('gulp-конструкторы: разбор запроса в команду', () => {
  it('1. «Создай модуль header» → npm run module -- --header', () => {
    const input = buildTerminalAgentInput(question('Создай модуль header'));
    expect(input).toEqual({
      command: 'npm',
      args: ['run', 'module', '--', '--header'],
    });
  });

  it('2. «Создай блок main-hero» → npm run create -- --main-hero', () => {
    const input = buildTerminalAgentInput(question('Создай блок main-hero'));
    expect(input).toEqual({
      command: 'npm',
      args: ['run', 'create', '--', '--main-hero'],
    });
  });

  it('3. «Создай плагин zoom» → npm run plugin -- --zoom', () => {
    const input = buildTerminalAgentInput(question('Создай плагин zoom'));
    expect(input).toEqual({
      command: 'npm',
      args: ['run', 'plugin', '--', '--zoom'],
    });
  });

  it('4. «Удали блок old-block» → npm run remove -- --old-block', () => {
    const input = buildTerminalAgentInput(question('Удали блок old-block'));
    expect(input).toEqual({
      command: 'npm',
      args: ['run', 'remove', '--', '--old-block'],
    });
  });

  it('5. «Обнови модули» → неинтерактивный npm-сценарий', () => {
    const input = buildTerminalAgentInput(question('Обнови модули'));
    expect(input).toEqual({
      command: 'npm',
      args: ['run', 'update-modules:auto'],
    });
  });

  it('6. «Обнови зависимости» → тот же сценарий', () => {
    const input = buildTerminalAgentInput(question('Обнови зависимости'));
    expect(input).toEqual({
      command: 'npm',
      args: ['run', 'update-modules:auto'],
    });
  });

  it('7. «Разверни базовую структуру» → npm run init', () => {
    const input = buildTerminalAgentInput(
      question('Разверни базовую структуру'),
    );
    expect(input).toEqual({ command: 'npm', args: ['run', 'init'] });
  });

  it('8. «Создай модуль» без имени → честный отказ (null)', () => {
    expect(buildTerminalAgentInput(question('Создай модуль'))).toBeNull();
  });

  it('9. Путь с расширением остаётся файловой операцией, а не конструктором', () => {
    expect(
      buildTerminalAgentInput(question('Создай модуль data/config.json')),
    ).toBeNull();
  });

  it('10. nl-parser добавляет роль terminal для конструктора и обновления', () => {
    expect(parseUserMessage('Создай модуль header').requiredAgents).toContain(
      'terminal',
    );
    expect(parseUserMessage('Обнови модули').requiredAgents).toContain(
      'terminal',
    );
    expect(parseUserMessage('Удали блок old-block').requiredAgents).toContain(
      'terminal',
    );
  });

  it('11. Чистый запрос конструктора не тянет финансовые агенты', () => {
    const parsed = parseUserMessage('Создай модуль header');
    expect(parsed.requiredAgents).toEqual(['terminal']);
  });
});

// ─── Tests: SecurityAgent — npm-мутации ──────────────────────────────

describe('SecurityAgent: npm-мутации требуют подтверждения', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'director-gulp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function createAgent(): SecurityAgent {
    return new SecurityAgent({ name: 'SecurityAgent' }, { roots: [tmp] });
  }

  it('12. npm run remove — require-confirmation с высоким риском', () => {
    const decision = createAgent().validate({
      kind: 'terminal',
      command: 'npm',
      args: ['run', 'remove', '--', '--old-block'],
    });
    expect(decision.verdict).toBe('require-confirmation');
    expect(decision.matchedRules).toContain('command.mutation');
    expect(decision.dangerLevel).toBe('high');
  });

  it('13. npm install и npm run update-modules:auto — require-confirmation', () => {
    const agent = createAgent();
    const install = agent.validate({
      kind: 'terminal',
      command: 'npm',
      args: ['install', 'lodash'],
    });
    expect(install.verdict).toBe('require-confirmation');
    expect(install.dangerLevel).toBe('medium');

    const updateAll = agent.validate({
      kind: 'terminal',
      command: 'npm',
      args: ['run', 'update-modules:auto'],
    });
    expect(updateAll.verdict).toBe('require-confirmation');
  });

  it('14. Безопасные команды не задеты: npm run build и npm run test — allow', () => {
    const agent = createAgent();
    expect(
      agent.validate({
        kind: 'terminal',
        command: 'npm',
        args: ['run', 'build'],
      }).verdict,
    ).toBe('allow');
    expect(
      agent.validate({
        kind: 'terminal',
        command: 'npm',
        args: ['run', 'test'],
      }).verdict,
    ).toBe('allow');
  });
});

// ─── Tests: Director + terminal (интеграция) ─────────────────────────

describe('Director + gulp-конструкторы (интеграция)', () => {
  it('15. «Создай модуль header» доходит до терминала как npm run module', async () => {
    const terminal = makeMockTerminalAgent();
    const facade = new DirectorAgentFacade({
      actionAgents: { terminal },
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage('Создай модуль header');

    const entry = response.task!.agentResults.find(
      (r) => r.role === 'terminal',
    );
    expect(entry).toBeDefined();
    expect(entry!.success).toBe(true);
    expect(terminal.calls.length).toBe(1);
    expect(terminal.calls[0]).toEqual({
      command: 'npm',
      args: ['run', 'module', '--', '--header'],
    });
  });

  it('16. «Обнови модули» доходит до терминала как update-modules:auto', async () => {
    const terminal = makeMockTerminalAgent();
    const facade = new DirectorAgentFacade({
      actionAgents: { terminal },
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage('Обнови модули');

    const entry = response.task!.agentResults.find(
      (r) => r.role === 'terminal',
    );
    expect(entry).toBeDefined();
    expect(terminal.calls[0]).toEqual({
      command: 'npm',
      args: ['run', 'update-modules:auto'],
    });
  });

  it('17. require-confirmation: удаление блока не выполняется без подтверждения', async () => {
    const terminal = makeMockTerminalAgent();
    const facade = new DirectorAgentFacade({
      actionAgents: { terminal },
      security: mockSecurityGate('require-confirmation'),
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage('Удали блок old-block');

    const entry = response.task!.agentResults.find(
      (r) => r.role === 'terminal',
    );
    expect(entry).toBeDefined();
    // AgentResult.success остаётся true (payload вернулся, а не упал);
    // признак подтверждения — текст summary и отсутствие вызова агента.
    expect((entry!.data as { summary?: string }).summary).toContain(
      'Требуется подтверждение',
    );
    expect(terminal.calls.length).toBe(0);
  });

  it('18. Без терминального агента — человечный ответ про десктопный режим', async () => {
    const facade = new DirectorAgentFacade({});
    const director = buildDirector(facade);

    const response = await director.processUserMessage('Создай модуль header');

    const entry = response.task!.agentResults.find(
      (r) => r.role === 'terminal',
    );
    expect(entry).toBeDefined();
    expect((entry!.data as { summary?: string }).summary).toContain(
      'десктопном режиме',
    );
  });
});
