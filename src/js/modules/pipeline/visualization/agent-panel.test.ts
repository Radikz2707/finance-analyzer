/**
 * Agent Panel — тесты HTML-рендера панели управления агентами.
 *
 * Покрытие:
 * - renderAgentPanel содержит имена/статусы агентов и цепочки с подсветкой
 *   последнего шага;
 * - пустые источники → честное «данные недоступны»;
 * - escapeHtml экранирует HTML (XSS-safe), включая <script>;
 * - agentPanelStyles возвращает CSS строку;
 * - команда /panel возвращает непустой результат (интеграция).
 *
 * Примечание: ожидаемые сущности записаны через hex-escape амперсанда
 * (`\x26` = '&'), чтобы при записи файла они не декодировались в обычные
 * символы (иначе проверки стали бы тождественными и бессмысленными).
 */

import {
  agentPanelStyles,
  escapeHtml,
  formatDuration,
  renderAgentPanel,
} from './agent-panel.js';
import { buildPanelState } from './agent-panel-model.js';
import { createHistoryAgent } from '../agents/history-agent.js';
import {
  executeChatCommand,
  parseChatInput,
  type ChatCommandSources,
} from '../director/director-chat-commands.js';
import type { AgentSummary, AgentState } from '../agent/types.js';

// ─── Helpers ───────────────────────────────────────────────────────

function summary(
  name: string,
  state: AgentState,
  overrides: Partial<AgentSummary> = {},
): AgentSummary {
  return {
    name,
    state,
    totalExecutions: 1,
    totalSuccesses: 1,
    totalFailures: 0,
    ...overrides,
  };
}

function historyWithEvents() {
  const history = createHistoryAgent();
  history.startRun();
  history.record({ agentName: 'FileAgent', action: 'read', status: 'success' });
  history.record({
    agentName: 'AnalysisAgent',
    action: 'analyze',
    status: 'success',
  });
  return history;
}

// ─── escapeHtml ────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('экранирует <script> и кавычки', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '\x26lt;script\x26gt;alert(\x26quot;x\x26quot;)\x26lt;/script\x26gt;',
    );
  });

  it('экранирует амперсанд и одинарные кавычки', () => {
    expect(escapeHtml("a & b 'c'")).toBe('a \x26amp; b \x26#39;c\x26#39;');
  });

  it('null/undefined → пустая строка', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('обычный текст не ломается', () => {
    expect(escapeHtml('Простой текст 123')).toBe('Простой текст 123');
  });
});

// ─── renderAgentPanel ──────────────────────────────────────────────

describe('renderAgentPanel', () => {
  it('HTML содержит имена и статусы агентов', () => {
    const state = buildPanelState({
      agents: [
        { getSummary: () => summary('DataAgent', 'running') },
        {
          getSummary: () => summary('FileAgent', 'error', { totalFailures: 1 }),
        },
      ],
    });

    const html = renderAgentPanel(state);

    expect(html).toContain('DataAgent');
    expect(html).toContain('FileAgent');
    expect(html).toContain('выполняется');
    expect(html).toContain('ошибка');
    expect(html).toContain('ap-badge-running');
    expect(html).toContain('ap-badge-error');
    expect(html).toContain('Выполнено: 1');
  });

  it('пустые источники → честное «данные недоступны»', () => {
    const html = renderAgentPanel(buildPanelState());

    expect(html).toContain('Данные об агентах недоступны');
    expect(html).toContain('Цепочки недоступны');
    expect(html).toContain('История недоступна');
    // Панель при этом рендерится целиком
    expect(html).toContain('ap-panel');
  });

  it('цепи: шаги в вертикальной последовательности, последний подсвечен', () => {
    const state = buildPanelState({ history: historyWithEvents() });
    const html = renderAgentPanel(state);

    expect(html).toContain('Цепочка');
    expect(html).toContain('ap-chain-steps');
    expect(html).toContain('FileAgent');
    expect(html).toContain('AnalysisAgent');
    expect(html).toContain('ap-step-last');
    expect(html).toContain('ap-step-success');
  });

  it('таблица истории содержит время, агента, действие и статус', () => {
    const state = buildPanelState({ history: historyWithEvents() });
    const html = renderAgentPanel(state);

    expect(html).toContain('ap-history-table');
    expect(html).toContain('Агент');
    expect(html).toContain('Действие');
    expect(html).toContain('read');
    expect(html).toContain('analyze');
  });

  it('overall-бейдж отражает критическое состояние', () => {
    const state = buildPanelState({
      agents: [{ getSummary: () => summary('DataAgent', 'error') }],
    });
    const html = renderAgentPanel(state);

    expect(html).toContain('ap-overall-critical');
    expect(html).toContain('Критическое состояние');
  });

  it('XSS-безопасность: имя агента со скриптом экранируется', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const state = buildPanelState({
      agents: [{ getSummary: () => summary(evil, 'idle') }],
    });
    const html = renderAgentPanel(state);

    expect(html).not.toContain('<img');
    expect(html).toContain('\x26lt;img src=x onerror=alert(1)\x26gt;');
  });
});

// ─── Вспомогательные экспорты ──────────────────────────────────────

describe('agentPanelStyles', () => {
  it('возвращает CSS строку с корневым селектором панели', () => {
    const css = agentPanelStyles();
    expect(css).toContain('.ap-panel');
    expect(css).toContain('.ap-badge-running');
    expect(css).toContain('.ap-step-last');
  });
});

describe('formatDuration', () => {
  it('форматирует миллисекунды и секунды', () => {
    expect(formatDuration(500)).toBe('500 мс');
    expect(formatDuration(1500)).toBe('1.5 с');
  });

  it('отрицательные/нечисловые значения → тире', () => {
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

// ─── Интеграция: команда /panel ────────────────────────────────────

describe('/panel команда', () => {
  it('возвращает непустой HTML из доступных источников', () => {
    const sources: ChatCommandSources = {
      state: 'idle',
      agentPanelSources: {
        agents: [{ getSummary: () => summary('DataAgent', 'running') }],
        history: historyWithEvents(),
      },
    };

    const reply = executeChatCommand(parseChatInput('/panel'), sources);

    expect(reply).not.toBeNull();
    expect(reply?.kind).toBe('panel');
    expect(reply?.text.length).toBeGreaterThan(0);
    expect(reply?.text).toContain('DataAgent');
    expect(reply?.text).toContain('ap-panel');
  });

  it('без источников всё равно даёт непустой честный ответ', () => {
    const reply = executeChatCommand(
      parseChatInput('/panel'),
      {} satisfies ChatCommandSources,
    );

    expect(reply).not.toBeNull();
    expect(reply?.kind).toBe('panel');
    expect(reply?.text.length).toBeGreaterThan(0);
    expect(reply?.text).toContain('недоступн');
  });
});
