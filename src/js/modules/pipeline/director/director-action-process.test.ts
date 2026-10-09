/**
 * Director + action-агенты (process/automation).
 *
 * Покрытие:
 * - роли process/automation маршрутизируются фасадом с security-gate
 *   (kind 'process' для start/stop/restart и запуска workflow);
 * - без подключённых агентов (браузерный контур) — человечный ответ
 *   про десктопный режим;
 * - парсеры buildProcessAgentInput / buildAutomationAgentInput.
 *
 * ВАЖНО: импорт { describe, it, expect } из 'vitest' НЕ используется —
 * он создаёт второй экземпляр @vitest/runner и ломает контекст тестов
 * (TypeError: Cannot read properties of undefined (reading 'config')).
 * Все тесты используют глобалы (globals: true).
 */

import {
  DirectorAgentFacade,
  type ActionSecurityGate,
} from './agent-facade.js';
import { DirectorAgent } from './director.js';
import type { DirectorFactsContext } from './director-types.js';
import type { AgentSummary, IAgent } from '../agent/types.js';
import type {
  ProcessAgentInput,
  ProcessAgentOutput,
} from '../agents/process-agent.js';
import type {
  AutomationAgentInput,
  AutomationAgentOutput,
} from '../agents/automation-agent/types.js';
import type { SecurityVerdict } from '../agents/security-agent.js';
import {
  buildAutomationAgentInput,
  buildProcessAgentInput,
} from './action-input-builder.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function emptyFacts(): DirectorFactsContext {
  return { assetsAnalysis: [], totalPortfolioValue: 0, freeCashRub: 0 };
}

/** Мок-агент, совместимый с IAgent, с журналом вызовов (без vi) */
interface MockAgent<TInput> extends IAgent<TInput> {
  readonly calls: TInput[];
}

function makeMockAgent<TInput, TOutput>(
  name: string,
  makeOutput: () => TOutput,
): MockAgent<TInput> {
  const calls: TInput[] = [];
  return {
    name,
    state: 'idle',
    calls,
    async execute(input: TInput) {
      calls.push(input);
      return {
        success: true,
        data: makeOutput(),
        durationMs: 1,
        completedAt: new Date().toISOString(),
      };
    },
    async stop() {},
    getSummary(): AgentSummary {
      return {
        name,
        state: 'idle',
        totalExecutions: 0,
        totalSuccesses: 0,
        totalFailures: 0,
      };
    },
  } as MockAgent<TInput>;
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
    { facade, initialFacts: emptyFacts(), random: () => 0 },
    { maxConsiliumRounds: 3 },
  );
  director.createSession();
  return director;
}

// ─── Tests: фасад (интеграция с Director) ────────────────────────────

describe('Director + process/automation-агенты', () => {
  it('1. Запускает процесс через ProcessAgent (Node-режим)', async () => {
    const processAgent = makeMockAgent<ProcessAgentInput, ProcessAgentOutput>(
      'ProcessAgent',
      () => ({
        action: 'start',
        processes: [],
        message: 'Процесс запущен: python (pid 123)',
      }),
    );
    const facade = new DirectorAgentFacade({
      actionAgents: { process: processAgent },
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Запусти процесс python main.py',
    );

    const entry = response.task!.agentResults.find((r) => r.role === 'process');
    expect(entry).toBeDefined();
    expect(entry!.success).toBe(true);

    const payload = entry!.data as { summary?: string };
    expect(payload.summary).toContain('Процесс запущен');
    expect(response.text).toContain('Процесс запущен');

    expect(processAgent.calls.length).toBe(1);
    expect(processAgent.calls[0]).toEqual({
      action: 'start',
      command: 'python',
      args: ['main.py'],
      restartOnExit: true,
    });
  });

  it('2. Без process-агента — человечный ответ про десктопный режим', async () => {
    const facade = new DirectorAgentFacade();
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Запусти процесс python main.py',
    );

    const entry = response.task!.agentResults.find((r) => r.role === 'process');
    expect(entry).toBeDefined();
    expect(entry!.success).toBe(true);

    const payload = entry!.data as { summary?: string };
    expect(payload.summary).toBe(
      'Управление процессами доступно в десктопном режиме',
    );
    expect(response.text).toContain('доступно в десктопном режиме');
  });

  it('3. Security deny на старт процесса — отказ без вызова агента', async () => {
    const processAgent = makeMockAgent<ProcessAgentInput, ProcessAgentOutput>(
      'ProcessAgent',
      () => ({
        action: 'start',
        processes: [],
        message: 'не должен вызваться',
      }),
    );
    const facade = new DirectorAgentFacade({
      actionAgents: { process: processAgent },
      security: mockSecurityGate('deny'),
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Запусти процесс python main.py',
    );

    const entry = response.task!.agentResults.find((r) => r.role === 'process');
    const payload = entry!.data as { summary?: string };
    expect(payload.summary).toContain('Операция отклонена');
    expect(processAgent.calls.length).toBe(0);
    expect(response.text).toContain('Операция отклонена');
  });

  it('4. Security require-confirmation на перезапуск — подтверждение без выполнения', async () => {
    const processAgent = makeMockAgent<ProcessAgentInput, ProcessAgentOutput>(
      'ProcessAgent',
      () => ({
        action: 'restart',
        processes: [],
        message: 'не должен вызваться',
      }),
    );
    const facade = new DirectorAgentFacade({
      actionAgents: { process: processAgent },
      security: mockSecurityGate('require-confirmation'),
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Перезапусти процесс build',
    );

    const entry = response.task!.agentResults.find((r) => r.role === 'process');
    const payload = entry!.data as { summary?: string };
    expect(payload.summary).toContain('Требуется подтверждение');
    expect(processAgent.calls.length).toBe(0);
    expect(response.text).toContain('Требуется подтверждение');
  });

  it('5. Automation без агента — человечный ответ про десктопный режим', async () => {
    const facade = new DirectorAgentFacade();
    const director = buildDirector(facade);

    const response = await director.processUserMessage('Покажи workflow');

    const entry = response.task!.agentResults.find(
      (r) => r.role === 'automation',
    );
    expect(entry).toBeDefined();
    expect(entry!.success).toBe(true);

    const payload = entry!.data as { summary?: string };
    expect(payload.summary).toBe(
      'Автоматизация workflow доступна в десктопном режиме',
    );
    expect(response.text).toContain('в десктопном режиме');
  });

  it('6. Запускает workflow через AutomationAgent (security allow)', async () => {
    const automationAgent = makeMockAgent<
      AutomationAgentInput,
      AutomationAgentOutput
    >('AutomationAgent', () => ({
      success: true,
      message: 'Workflow «nightly» запущен',
    }));
    const facade = new DirectorAgentFacade({
      actionAgents: { automation: automationAgent },
      security: mockSecurityGate('allow'),
    });
    const director = buildDirector(facade);

    const response = await director.processUserMessage(
      'Запусти workflow nightly',
    );

    const entry = response.task!.agentResults.find(
      (r) => r.role === 'automation',
    );
    expect(entry).toBeDefined();
    expect(entry!.success).toBe(true);

    const payload = entry!.data as { summary?: string };
    expect(payload.summary).toContain('Workflow «nightly» запущен');
    expect(response.text).toContain('Workflow «nightly» запущен');
    expect(automationAgent.calls.length).toBe(1);
    expect(automationAgent.calls[0]).toEqual({
      action: 'run-now',
      params: { templateId: 'nightly' },
    });
  });

  it('7. Роли process и automation попадают в connectedAgents', async () => {
    const facade = new DirectorAgentFacade();
    const director = buildDirector(facade);

    const processResponse =
      await director.processUserMessage('Статус процессов');
    expect(processResponse.connectedAgents).toContain('process');
    expect(processResponse.task!.agents.map((a) => a.role)).toContain(
      'process',
    );

    const automationResponse =
      await director.processUserMessage('Покажи workflow');
    expect(automationResponse.connectedAgents).toContain('automation');
    expect(automationResponse.task!.agents.map((a) => a.role)).toContain(
      'automation',
    );
  });
});

// ─── Tests: парсеры action-input-builder ─────────────────────────────

describe('buildProcessAgentInput', () => {
  function question(text: string): {
    text: string;
    tickers: string[];
    category: string;
  } {
    return { text, tickers: [], category: 'general' };
  }

  it('разбирает «Запусти процесс python main.py» как start с auto-restart', () => {
    const input = buildProcessAgentInput(
      question('Запусти процесс python main.py') as never,
    );
    expect(input).toEqual({
      action: 'start',
      command: 'python',
      args: ['main.py'],
      restartOnExit: true,
    });
  });

  it('разбирает «Запусти сервер node server.js» как start', () => {
    const input = buildProcessAgentInput(
      question('Запусти сервер node server.js') as never,
    );
    expect(input).toEqual({
      action: 'start',
      command: 'node',
      args: ['server.js'],
      restartOnExit: true,
    });
  });

  it('разбирает «Останови процесс build» как stop', () => {
    const input = buildProcessAgentInput(
      question('Останови процесс build') as never,
    );
    expect(input).toEqual({ action: 'stop', name: 'build' });
  });

  it('разбирает «Перезапусти процесс build» как restart', () => {
    const input = buildProcessAgentInput(
      question('Перезапусти процесс build') as never,
    );
    expect(input).toEqual({ action: 'restart', name: 'build' });
  });

  it('разбирает «Статус процессов» как status без имени', () => {
    const input = buildProcessAgentInput(question('Статус процессов') as never);
    expect(input).toEqual({ action: 'status' });
  });

  it('возвращает null для не процессного вопроса', () => {
    expect(
      buildProcessAgentInput(question('Сколько стоит золото?') as never),
    ).toBeNull();
  });
});

describe('buildAutomationAgentInput', () => {
  function question(text: string): {
    text: string;
    tickers: string[];
    category: string;
  } {
    return { text, tickers: [], category: 'general' };
  }

  it('разбирает «Запусти workflow nightly» как run-now', () => {
    const input = buildAutomationAgentInput(
      question('Запусти workflow nightly') as never,
    );
    expect(input).toEqual({
      action: 'run-now',
      params: { templateId: 'nightly' },
    });
  });

  it('разбирает «Покажи workflow» как get-templates', () => {
    const input = buildAutomationAgentInput(
      question('Покажи workflow') as never,
    );
    expect(input).toEqual({ action: 'get-templates', params: {} });
  });

  it('разбирает «Статистика workflow» как get-stats', () => {
    const input = buildAutomationAgentInput(
      question('Статистика workflow') as never,
    );
    expect(input).toEqual({ action: 'get-stats', params: {} });
  });

  it('возвращает null для постороннего вопроса (даже с «запусти»)', () => {
    expect(
      buildAutomationAgentInput(question('Запусти тесты проекта') as never),
    ).toBeNull();
  });
});
