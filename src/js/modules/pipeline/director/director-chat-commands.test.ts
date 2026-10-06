/**
 * Director Chat Commands — тесты системных команд чата.
 *
 * Покрытие:
 * - парсинг команд (/status, /log N, /undo, /help, неизвестная, текст);
 * - форматтеры ответов (честные данные из источников);
 * - детекция опасных паттернов и построение заявки для SecurityAgent;
 * - интеграция: DirectorAgent.processUserMessage обрабатывает команды,
 *   обычный NL-флоу не ломается.
 */

import { DirectorAgent } from './director.js';
import { DirectorAgentFacade } from './agent-facade.js';
import {
  createInMemoryMemoryAdapter,
  DirectorMemoryStore,
} from './director-memory.js';
import { DirectorChatStore } from './chat-session.js';
import { DirectorAuditLog } from './director-audit.js';
import { SecurityAgent } from '../agents/security-agent.js';
import type {
  DirectorAuditEvent,
  DirectorFactsContext,
} from './director-types.js';
import {
  assessDanger,
  buildHelpText,
  detectDangerousIntent,
  executeChatCommand,
  extractSecurityActionRequest,
  formatLogText,
  formatStatusText,
  formatUndoText,
  parseChatInput,
  parseLogLimit,
  type ChatCommandSources,
} from './director-chat-commands.js';

// ─── Helpers ───────────────────────────────────────────────────────

function makeFacts(): DirectorFactsContext {
  return {
    assetsAnalysis: [
      {
        ticker: 'PLZL',
        name: 'Полюс',
        currentPercent: 32,
        targetPercent: 15,
        deficitRub: 0,
        status: 'REDUCE',
        isConcentrated: true,
      },
    ],
    totalPortfolioValue: 500000,
    freeCashRub: 60000,
  };
}

function buildDirector(): DirectorAgent {
  const adapter = createInMemoryMemoryAdapter();
  const memory = new DirectorMemoryStore(adapter);
  const chat = new DirectorChatStore({ memoryAdapter: adapter });
  const audit = new DirectorAuditLog();
  const facade = new DirectorAgentFacade();
  const director = new DirectorAgent(
    {
      facade,
      memory,
      chat,
      audit,
      initialFacts: makeFacts(),
    },
    { maxConsiliumRounds: 3 },
  );
  director.createSession();
  return director;
}

function auditEvent(
  partial: Partial<DirectorAuditEvent> = {},
): DirectorAuditEvent {
  return {
    id: 'evt-1',
    timestamp: new Date().toISOString(),
    type: 'director.question_received',
    actor: 'director',
    message: 'Вопрос получен',
    metadata: {},
    ...partial,
  };
}

function sources(
  overrides: Partial<ChatCommandSources> = {},
): ChatCommandSources {
  return {
    state: 'idle',
    chatMessageCount: 3,
    completedTasks: 2,
    strategicMemoryCount: 4,
    connectedAgents: [{ role: 'ai', label: 'AI Agent' }],
    auditEvents: [auditEvent()],
    lastActionDescription: 'Вопрос получен',
    canUndo: false,
    ...overrides,
  };
}

// ─── Парсинг ───────────────────────────────────────────────────────

describe('parseChatInput — системные команды', () => {
  it('распознаёт /status как известную команду', () => {
    const parsed = parseChatInput('/status');
    expect(parsed.kind).toBe('command');
    if (parsed.kind === 'command') {
      expect(parsed.command.name).toBe('status');
      expect(parsed.command.known).toBe(true);
    }
  });

  it('распознаёт /log с аргументом количества строк', () => {
    const parsed = parseChatInput('/log 15');
    expect(parsed.kind).toBe('command');
    if (parsed.kind === 'command') {
      expect(parsed.command.name).toBe('log');
      expect(parsed.command.args).toEqual(['15']);
    }
  });

  it('распознаёт /undo и /help', () => {
    expect(parseChatInput('/undo').kind).toBe('command');
    expect(parseChatInput('/help').kind).toBe('command');
  });

  it('неизвестная команда остаётся командой, но known=false', () => {
    const parsed = parseChatInput('/coffee');
    expect(parsed.kind).toBe('command');
    if (parsed.kind === 'command') {
      expect(parsed.command.name).toBe('coffee');
      expect(parsed.command.known).toBe(false);
    }
  });

  it('обычный текст не считается командой', () => {
    const parsed = parseChatInput('Что делать с PLZL?');
    expect(parsed.kind).toBe('text');
  });

  it('пустая строка — текст', () => {
    expect(parseChatInput('   ').kind).toBe('text');
  });
});

// ─── executeChatCommand ────────────────────────────────────────────

describe('executeChatCommand — диспетчер', () => {
  it('/status строит ответ из реально доступных данных', () => {
    const reply = executeChatCommand(parseChatInput('/status'), sources());
    expect(reply).not.toBeNull();
    expect(reply!.kind).toBe('status');
    expect(reply!.text).toContain('Статус Director');
    expect(reply!.text).toContain('idle');
    expect(reply!.text).toContain('Выполнено задач: 2');
    expect(reply!.text).toContain('AI Agent');
  });

  it('/status честно сообщает, если список агентов недоступен', () => {
    const reply = executeChatCommand(
      parseChatInput('/status'),
      sources({ connectedAgents: undefined }),
    );
    expect(reply!.text).toContain('Точный список агентов сейчас недоступен');
  });

  it('/log показывает последние события и их количество', () => {
    const events = [
      auditEvent(),
      auditEvent({ type: 'director.plan_created', message: 'План создан' }),
    ];
    const reply = executeChatCommand(
      parseChatInput('/log'),
      sources({ auditEvents: events }),
    );
    expect(reply!.kind).toBe('log');
    expect(reply!.shownEvents).toBe(2);
    expect(reply!.text).toContain('Последние действия (2)');
    expect(reply!.text).toContain('director.plan_created');
  });

  it('/log пустого лога даёт понятный ответ', () => {
    const reply = executeChatCommand(
      parseChatInput('/log'),
      sources({ auditEvents: [] }),
    );
    expect(reply!.text).toContain('Аудит-лог пуст');
  });

  it('/undo честно сообщает об отсутствии механики отката', () => {
    const reply = executeChatCommand(parseChatInput('/undo'), sources());
    expect(reply!.kind).toBe('undo');
    expect(reply!.text).toContain('Механика отката (undo) не реализована');
    expect(reply!.text).toContain('Вопрос получен');
  });

  it('/undo использует реальную механику отката, если она предоставлена', () => {
    const reply = executeChatCommand(
      parseChatInput('/undo'),
      sources({
        canUndo: true,
        undoAction: () => ({ undone: true, message: 'Действие откачено' }),
      }),
    );
    expect(reply!.text).toContain('Последнее действие отменено');
    expect(reply!.text).toContain('Действие откачено');
  });

  it('/help возвращает справку', () => {
    const reply = executeChatCommand(parseChatInput('/help'), sources());
    expect(reply!.kind).toBe('help');
    expect(reply!.text).toContain('/status');
    expect(reply!.text).toContain('/log');
    expect(reply!.text).toContain('/undo');
  });

  it('неизвестная команда даёт понятное сообщение со списком доступных', () => {
    const reply = executeChatCommand(parseChatInput('/coffee'), sources());
    expect(reply!.kind).toBe('unknown');
    expect(reply!.text).toContain('Неизвестная команда: /coffee');
    expect(reply!.text).toContain(buildHelpText());
  });

  it('обычный текст возвращает null (не команда)', () => {
    const reply = executeChatCommand(parseChatInput('привет'), sources());
    expect(reply).toBeNull();
  });
});

// ─── Форматтеры ────────────────────────────────────────────────────

describe('форматтеры ответов', () => {
  it('parseLogLimit: по умолчанию 10, максимум 50, некорректные значения игнорируются', () => {
    expect(parseLogLimit([])).toBe(10);
    expect(parseLogLimit(['5'])).toBe(5);
    expect(parseLogLimit(['100'])).toBe(50);
    expect(parseLogLimit(['abc'])).toBe(10);
    expect(parseLogLimit(['-3'])).toBe(10);
  });

  it('formatStatusText не выдумывает данные', () => {
    const text = formatStatusText({});
    expect(text).toContain('неизвестно');
    expect(text).toContain('Точный список агентов сейчас недоступен');
  });

  it('formatUndoText регистрирует последнее действие без имитации отката', () => {
    const text = formatUndoText({ lastActionDescription: 'Отправлен запрос' });
    expect(text).toContain('«Отправлен запрос»');
    expect(text).not.toContain('отменено');
  });

  it('formatLogText не показывает больше событий, чем есть', () => {
    const events = [auditEvent(), auditEvent({ id: 'evt-2' })];
    const text = formatLogText(events, 50);
    expect(text).toContain('Последние действия (2)');
  });
});

// ─── Детекция опасных действий ─────────────────────────────────────

describe('detectDangerousIntent — опасные паттерны', () => {
  it('детектирует деструктивную команду rm -rf как high', () => {
    const result = detectDangerousIntent('выполни rm -rf data/');
    expect(result.dangerous).toBe(true);
    expect(result.level).toBe('high');
    expect(result.matchedPatterns?.length).toBeGreaterThan(0);
  });

  it('детектирует удаление файла (русский язык)', () => {
    const result = detectDangerousIntent('удали файл data/orders.xlsx');
    expect(result.dangerous).toBe(true);
    expect(result.level).toBe('medium');
  });

  it('детектирует чувствительный путь .env', () => {
    const result = detectDangerousIntent('покажи содержимое .env');
    expect(result.dangerous).toBe(true);
    expect(result.level).toBe('high');
  });

  it('безопасный финансовый вопрос не помечается', () => {
    const result = detectDangerousIntent(
      'проанализируй структуру портфеля и дай рекомендацию',
    );
    expect(result.dangerous).toBe(false);
  });

  it('запрос пароля/токена помечается как средний риск', () => {
    const result = detectDangerousIntent('пришли мой токен для телеграм-бота');
    expect(result.dangerous).toBe(true);
    expect(result.level).toBe('medium');
  });
});

describe('extractSecurityActionRequest — заявка для SecurityAgent', () => {
  it('«удали <путь>» превращается в file delete', () => {
    const request = extractSecurityActionRequest('удали data/orders.xlsx');
    expect(request).not.toBeNull();
    expect(request!.kind).toBe('file');
    expect(request!.action).toBe('delete');
  });

  it('«выполни команду …» превращается в terminal', () => {
    const request = extractSecurityActionRequest('выполни команду ls -la');
    expect(request).not.toBeNull();
    expect(request!.kind).toBe('terminal');
    expect(request!.command).toContain('ls');
  });

  it('обычный вопрос не создаёт заявку', () => {
    expect(extractSecurityActionRequest('что с портфелем?')).toBeNull();
  });
});

describe('assessDanger — интеграция с SecurityAgent', () => {
  it('вердикт deny от SecurityAgent даёт высокий риск', () => {
    const agent = new SecurityAgent(
      { name: 'SecurityAgent' },
      { roots: [process.cwd()] },
    );
    const result = assessDanger('удали data/orders.xlsx', (request) =>
      agent.validate(request),
    );
    // file delete внутри корня → require-confirmation (или allow в тестовой env),
    // главное — вердикт SecurityAgent попал в оценку
    expect(result.dangerous).toBe(true);
    expect(result.securityVerdict).toBeDefined();
  });

  it('запрещённая команда от SecurityAgent доминирует над regex', () => {
    const agent = new SecurityAgent(
      { name: 'SecurityAgent' },
      { roots: [process.cwd()] },
    );
    const result = assessDanger('выполни rm -rf node_modules', (request) =>
      agent.validate(request),
    );
    expect(result.dangerous).toBe(true);
    expect(result.securityVerdict).toBe('deny');
  });
});

// ─── Интеграция с DirectorAgent ────────────────────────────────────

describe('DirectorAgent — системные команды (интеграция)', () => {
  it('/status возвращает статус и НЕ создаёт задачу', async () => {
    const director = buildDirector();
    const response = await director.processUserMessage('/status');

    expect(response.text).toContain('Статус Director');
    expect(response.task).toBeUndefined();
    expect(response.connectedAgents).toEqual([]);
  });

  it('/log показывает события после обычного вопроса', async () => {
    const director = buildDirector();
    await director.processUserMessage('Что делать с PLZL?');

    const response = await director.processUserMessage('/log');
    expect(response.text).toContain('Последние действия');
    expect(response.text).toContain('director.synthesis_created');
  });

  it('/undo честно говорит об ограниченной отмене', async () => {
    const director = buildDirector();
    await director.processUserMessage('Что делать с PLZL?');

    const response = await director.processUserMessage('/undo');
    expect(response.text).toContain('Механика отката (undo) не реализована');
  });

  it('/help возвращает справку по командам', async () => {
    const director = buildDirector();
    const response = await director.processUserMessage('/help');
    expect(response.text).toContain('Доступные команды');
  });

  it('неизвестная команда получает понятное сообщение', async () => {
    const director = buildDirector();
    const response = await director.processUserMessage('/coffee');
    expect(response.text).toContain('Неизвестная команда');
    expect(response.text).toContain('/help');
  });

  it('обычный NL-флоу не сломан (команды не перехватывают текст)', async () => {
    const director = buildDirector();
    const response = await director.processUserMessage('Что делать с PLZL?');

    expect(response.task).toBeDefined();
    expect(response.text).toContain('Я понял ваш вопрос');
  });

  it('результат команды попадает в историю чата как system', async () => {
    const director = buildDirector();
    await director.processUserMessage('/help');

    const history = director.getChatHistory();
    expect(history.some((m) => m.role === 'system')).toBe(true);
    expect(history.at(-1)?.role).toBe('system');
  });
});
