/**
 * HistoryAgent Tests — систематическое хранилище истории действий агентов.
 *
 * Проверяются: запись (record/append) и чтение, фильтры поиска
 * (агент/статус/время/подстрока), сортировка и лимит, цепочка выполнения
 * (startRun → record → trace/chain), экспорт JSON с защитой пути,
 * markdown-сводка и обёртка wrapAgentExecution (success/failed).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  HistoryAgent,
  createHistoryAgent,
  wrapAgentExecution,
} from './history-agent.js';
import type { AgentLike, HistoryEvent } from './history-agent.js';

// ─── Helpers ───────────────────────────────────────────────

function createAgent(options?: { roots?: string[] }): HistoryAgent {
  return new HistoryAgent({ roots: options?.roots ?? [process.cwd()] });
}

/** Fake-агент, возвращающий success=false с ошибкой */
const failingAgent: AgentLike = {
  name: 'FakeFailAgent',
  async execute(): Promise<never> {
    throw new Error('boom');
  },
};

/** Фиксированный набор событий для тестов фильтрации */
function seedEvents(agent: HistoryAgent): void {
  agent.append({
    id: 'e1',
    agentName: 'FileAgent',
    role: 'file',
    action: 'read',
    detail: 'Чтение конфига проекта',
    status: 'success',
    durationMs: 12,
    createdAt: '2026-10-01T10:00:00.000Z',
  });
  agent.append({
    id: 'e2',
    agentName: 'FileAgent',
    role: 'file',
    action: 'write',
    detail: 'Запись отчёта report.md',
    status: 'success',
    durationMs: 40,
    createdAt: '2026-10-01T10:05:00.000Z',
  });
  agent.append({
    id: 'e3',
    agentName: 'TerminalAgent',
    role: 'terminal',
    action: 'run',
    detail: 'npm run build — ошибка сборки',
    status: 'failed',
    durationMs: 500,
    createdAt: '2026-10-01T11:00:00.000Z',
  });
  agent.append({
    id: 'e4',
    agentName: 'SecurityAgent',
    role: 'security',
    action: 'check',
    detail: 'rm -rf заблокировано',
    status: 'blocked',
    createdAt: '2026-10-01T12:00:00.000Z',
  });
}

// ─── Запись и чтение ───────────────────────────────────────

describe('HistoryAgent — запись и чтение', () => {
  let tmp: string;
  let agent: HistoryAgent;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'history-agent-test-'));
    agent = createAgent({ roots: [tmp] });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('record() генерирует id и createdAt, привязывает активный runId', () => {
    const run = agent.startRun();
    const event = agent.record({
      agentName: 'FileAgent',
      role: 'file',
      action: 'read',
      detail: 'note.txt',
      status: 'success',
      durationMs: 5,
    });

    expect(event.id).toBeTruthy();
    expect(event.createdAt).toBeTruthy();
    expect(event.runId).toBe(run.runId);
    expect(agent.getAll()).toHaveLength(1);
  });

  it('append() сохраняет событие без изменений полей', () => {
    const raw: HistoryEvent = {
      id: 'custom-1',
      agentName: 'TestAgent',
      action: 'probe',
      status: 'blocked',
      createdAt: '2026-10-01T00:00:00.000Z',
    };
    const stored = agent.append(raw);
    expect(stored).toBe(raw);
    expect(agent.getAll()[0]).toEqual(raw);
  });

  it('recordFromResult() пишет событие из AgentResult', () => {
    const event = agent.recordFromResult(
      {
        success: false,
        error: new Error('timeout'),
        durationMs: 300,
        completedAt: '2026-10-01T00:00:00.000Z',
      },
      { agentName: 'TerminalAgent', action: 'run' },
    );
    expect(event.agentName).toBe('TerminalAgent');
    expect(event.status).toBe('failed');
    expect(event.detail).toContain('timeout');
    expect(event.durationMs).toBe(300);
  });

  it('ограничивает размер истории (maxEntries)', () => {
    const small = new HistoryAgent({ maxEntries: 3, roots: [tmp] });
    for (let i = 0; i < 5; i++) {
      small.record({
        agentName: 'A',
        action: `step-${i}`,
        status: 'success',
      });
    }
    expect(small.getAll()).toHaveLength(3);
    expect(small.find({ query: 'step-0' })).toHaveLength(0);
  });
});

// ─── Поиск: фильтры, сортировка, лимит ─────────────────────

describe('HistoryAgent — поиск', () => {
  let agent: HistoryAgent;

  beforeEach(() => {
    agent = createAgent();
    seedEvents(agent);
  });

  it('находит события по имени агента', () => {
    const found = agent.find({ agentName: 'FileAgent' });
    expect(found).toHaveLength(2);
    expect(found.every((e) => e.agentName === 'FileAgent')).toBe(true);
  });

  it('находит события по статусу', () => {
    expect(agent.find({ status: 'failed' })).toHaveLength(1);
    expect(agent.find({ status: 'blocked' })[0]?.id).toBe('e4');
    expect(agent.find({ status: 'success' })).toHaveLength(2);
  });

  it('фильтрует по диапазону времени (from/to)', () => {
    const range = agent.find({
      from: '2026-10-01T10:00:00.000Z',
      to: '2026-10-01T11:00:00.000Z',
    });
    expect(range.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it('фильтрует по подстроке в detail (регистронезависимо)', () => {
    const found = agent.find({ query: 'ЗАБЛОКИРОВАНО' });
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe('e4');
  });

  it('ищет подстроку и в action', () => {
    const found = agent.find({ query: 'writ' });
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe('e2');
  });

  it('сортирует новые сверху по умолчанию и поддерживает asc', () => {
    const desc = agent.find();
    expect(desc[0]?.id).toBe('e4');
    const asc = agent.find({ sort: 'asc' });
    expect(asc[0]?.id).toBe('e1');
  });

  it('применяет лимит', () => {
    const limited = agent.find({ limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0]?.id).toBe('e4');
  });

  it('комбинирует несколько фильтров', () => {
    const found = agent.find({
      agentName: 'FileAgent',
      status: 'success',
      query: 'конфиг',
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe('e1');
  });
});

// ─── Цепочка выполнения (startRun → record → trace) ────────

describe('HistoryAgent — цепочка выполнения', () => {
  let agent: HistoryAgent;

  beforeEach(() => {
    agent = createAgent();
  });

  it('trace() собирает события одного runId по порядку', () => {
    const run = agent.startRun();
    agent.record({
      agentName: 'FileAgent',
      action: 'execute',
      detail: 'start',
      status: 'success',
      createdAt: '2026-10-01T10:00:00.000Z',
    });
    agent.record({
      agentName: 'FileAgent',
      action: 'execute',
      detail: 'ok',
      status: 'success',
      durationMs: 15,
      createdAt: '2026-10-01T10:00:00.015Z',
    });
    agent.endRun();

    const trace = agent.trace({ runId: run.runId });
    expect(trace).not.toBeNull();
    expect(trace?.events).toHaveLength(2);
    expect(trace?.events[0]?.detail).toBe('start');
    expect(trace?.events[1]?.detail).toBe('ok');
    expect(trace?.counts.success).toBe(2);
    expect(trace?.durationMs).toBe(15);
  });

  it('trace() без аргументов использует последний runId', () => {
    agent.record({
      agentName: 'A',
      action: 'x',
      detail: 'start',
      status: 'success',
      createdAt: '2026-10-01T10:00:00.000Z',
      runId: 'run-old',
    });
    agent.startRun();
    agent.record({
      agentName: 'B',
      action: 'y',
      detail: 'done',
      status: 'success',
      createdAt: '2026-10-01T11:00:00.000Z',
    });

    const trace = agent.trace();
    expect(trace?.events).toHaveLength(1);
    expect(trace?.events[0]?.agentName).toBe('B');
  });

  it('trace() по taskId группирует события задачи', () => {
    agent.record({
      agentName: 'A',
      action: 'execute',
      taskId: 'task-42',
      status: 'success',
      createdAt: '2026-10-01T10:00:00.000Z',
    });
    agent.record({
      agentName: 'B',
      action: 'execute',
      taskId: 'task-42',
      status: 'failed',
      createdAt: '2026-10-01T10:00:00.100Z',
    });
    agent.record({
      agentName: 'C',
      action: 'execute',
      taskId: 'task-99',
      status: 'success',
      createdAt: '2026-10-01T10:00:00.200Z',
    });

    const trace = agent.trace({ taskId: 'task-42' });
    expect(trace?.events).toHaveLength(2);
    expect(trace?.counts.failed).toBe(1);
    expect(trace?.taskId).toBe('task-42');
  });

  it('trace() возвращает null, если событий нет', () => {
    expect(agent.trace({ runId: 'missing' })).toBeNull();
  });

  it('chain() группирует все запуски по runId (новые сверху)', () => {
    agent.startRun();
    agent.record({
      agentName: 'A',
      action: 'a',
      status: 'success',
      createdAt: '2026-10-01T10:00:00.000Z',
    });
    agent.endRun();

    agent.startRun();
    agent.record({
      agentName: 'B',
      action: 'b',
      status: 'failed',
      createdAt: '2026-10-01T11:00:00.000Z',
    });
    agent.endRun();

    const chains = agent.chain();
    expect(chains).toHaveLength(2);
    expect(chains[0]?.events[0]?.agentName).toBe('B');
    expect(chains[1]?.events[0]?.agentName).toBe('A');
    expect(chains[0]?.counts.failed).toBe(1);
  });
});

// ─── Экспорт ────────────────────────────────────────────────

describe('HistoryAgent — экспорт', () => {
  let tmp: string;
  let agent: HistoryAgent;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'history-agent-export-'));
    agent = createAgent({ roots: [tmp] });
    seedEvents(agent);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('экспортирует историю в JSON-файл и возвращает путь', () => {
    const file = path.join(tmp, 'history', 'export.json');
    const written = agent.exportToJson(file);

    expect(written).toBe(file);
    expect(fs.existsSync(file)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as HistoryEvent[];
    expect(parsed).toHaveLength(4);
    expect(parsed[0]?.id).toBe('e1');
    expect(parsed[3]?.status).toBe('blocked');
  });

  it('принимает относительный путь относительно корня', () => {
    const written = agent.exportToJson('reports/history.json');
    expect(written).toBe(path.join(tmp, 'reports', 'history.json'));
    expect(fs.existsSync(written)).toBe(true);
  });

  it('блокирует выход за корень через ../', () => {
    expect(() => agent.exportToJson('../outside.json')).toThrow(
      'выход за пределы корня',
    );
  });

  it('блокирует абсолютный путь вне корня', () => {
    const outside = path.join(os.tmpdir(), 'history-outside-root.json');
    expect(() => agent.exportToJson(outside)).toThrow('вне разрешённых корней');
  });

  it('блокирует пустой путь', () => {
    expect(() => agent.exportToJson('')).toThrow('не указан путь');
  });

  it('exportSummary() возвращает markdown с ключевыми данными', () => {
    const summary = agent.exportSummary();
    expect(summary).toContain('# 📜 История действий агентов');
    expect(summary).toContain('Всего: **4**');
    expect(summary).toContain('**2**'); // success
    expect(summary).toContain('**1**'); // failed и blocked
    expect(summary).toContain('FileAgent');
    expect(summary).toContain('TerminalAgent');
    expect(summary).toContain('SecurityAgent');
    expect(summary).toContain('заблокировано');
    expect(summary).toContain('🚫');
  });

  it('exportSummary() для пустой истории сообщает «Нет записей»', () => {
    const empty = createAgent({ roots: [tmp] });
    const summary = empty.exportSummary();
    expect(summary).toContain('Нет записей.');
  });
});

// ─── Обёртка wrapAgentExecution ─────────────────────────────

describe('HistoryAgent — wrapAgentExecution', () => {
  let tmp: string;
  let agent: HistoryAgent;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'history-agent-wrap-'));
    agent = createAgent({ roots: [tmp] });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('фиксирует success: события запуска и результата в одной цепочке', async () => {
    const okAgent: AgentLike = {
      name: 'FakeOkAgent',
      async execute(input) {
        return {
          success: true,
          data: { echoed: input },
          durationMs: 7,
          completedAt: new Date().toISOString(),
        };
      },
    };

    const result = await wrapAgentExecution(okAgent, agent, { a: 1 });

    expect(result.success).toBe(true);
    const events = agent.find({ agentName: 'FakeOkAgent', sort: 'asc' });
    expect(events).toHaveLength(2);
    expect(events[0]?.detail).toBe('start');
    expect(events[1]?.status).toBe('success');
    expect(events[1]?.detail).toBe('ok');
    expect(events[1]?.durationMs).toBe(7);

    const trace = agent.trace({ runId: events[0]?.runId });
    expect(trace?.events).toHaveLength(2);
    expect(trace?.counts.success).toBe(2);
  });

  it('фиксирует failed при выброшенной ошибке и пробрасывает результат', async () => {
    const result = await wrapAgentExecution(failingAgent, agent, null);

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('boom');

    const events = agent.find({
      agentName: 'FakeFailAgent',
      sort: 'asc',
    });
    expect(events).toHaveLength(2);
    expect(events[1]?.status).toBe('failed');
    expect(events[1]?.detail).toContain('boom');
  });

  it('фиксирует failed при result.success=false без исключения', async () => {
    const softFail: AgentLike = {
      name: 'SoftFailAgent',
      async execute() {
        return {
          success: false,
          error: new Error('soft failure'),
          durationMs: 3,
          completedAt: new Date().toISOString(),
        };
      },
    };

    const result = await wrapAgentExecution(softFail, agent, undefined);

    expect(result.success).toBe(false);
    const failed = agent.find({ agentName: 'SoftFailAgent', status: 'failed' });
    expect(failed).toHaveLength(1);
    expect(failed[0]?.detail).toContain('soft failure');
  });

  it('уважает переданные role/taskId/action', async () => {
    const okAgent: AgentLike = {
      name: 'FakeOkAgent',
      async execute() {
        return {
          success: true,
          data: null,
          durationMs: 1,
          completedAt: new Date().toISOString(),
        };
      },
    };

    await wrapAgentExecution(okAgent, agent, null, {
      role: 'file',
      taskId: 'task-1',
      action: 'customAction',
    });

    const events = agent.find({ agentName: 'FakeOkAgent' });
    expect(events[0]?.role).toBe('file');
    expect(events[0]?.taskId).toBe('task-1');
    expect(events[0]?.action).toBe('customAction');
    expect(agent.trace({ taskId: 'task-1' })?.events).toHaveLength(2);
  });
});

// ─── Фабрика и интеграция ──────────────────────────────────

describe('HistoryAgent — фабрика', () => {
  it('createHistoryAgent() создаёт рабочий экземпляр', () => {
    const agent = createHistoryAgent();
    const event = agent.record({
      agentName: 'X',
      action: 'y',
      status: 'success',
    });
    expect(agent.find({ agentName: 'X' })[0]?.id).toBe(event.id);
  });
});
