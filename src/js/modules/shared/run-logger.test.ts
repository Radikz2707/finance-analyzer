import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockDataExecute } = vi.hoisted(() => ({
  mockDataExecute: vi.fn(),
}));

// Data Agent падает «пустым» результатом — run() завершается на Stage 1,
// но tee-логгер обязан быть установлен ДО первой диагностической строки.
vi.mock('../ai/pipeline/agents/data-agent.js', () => ({
  DataAgent: class {
    constructor(_config?: unknown) {}
    async execute(): Promise<null> {
      return mockDataExecute();
    }
    getSummary() {
      return {
        name: 'DataAgent',
        status: 'idle',
        totalRuns: 0,
        successRate: 0,
        lastDurationMs: 0,
      };
    }
    async stop(): Promise<void> {
      return undefined;
    }
  },
}));

import {
  getActiveRunLogPath,
  installRunLogger,
  isRunLoggerInstalled,
  resetRunLoggerForTests,
  resolveRunLogPath,
} from './run-logger.js';

describe('run-logger — tee в reports/last-run.log', () => {
  let logDir: string;
  let originalReportsDir: string | undefined;

  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-runlog-'));
    originalReportsDir = process.env.REPORTS_DIR;
    process.env.REPORTS_DIR = logDir;
    resetRunLoggerForTests();
  });

  afterEach(() => {
    resetRunLoggerForTests();
    if (originalReportsDir === undefined) {
      delete process.env.REPORTS_DIR;
    } else {
      process.env.REPORTS_DIR = originalReportsDir;
    }
    fs.rmSync(logDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('создаёт файл и дублирует log/warn/error', () => {
    const logPath = installRunLogger();

    expect(logPath).toBe(path.join(logDir, 'last-run.log'));
    expect(isRunLoggerInstalled()).toBe(true);
    expect(getActiveRunLogPath()).toBe(logPath);

    console.log('[DIVIDENDS_LTM_FETCH] ticker=PLZL status=OK');
    console.warn('[MOEX ISS] dividends/PLZL: таблица отсутствует');
    console.error(new Error('boom'));

    const content = fs.readFileSync(logPath!, 'utf8');
    expect(content).toContain('[PIPELINE] run started');
    expect(content).toContain(
      '[LOG] [DIVIDENDS_LTM_FETCH] ticker=PLZL status=OK',
    );
    expect(content).toContain('[WARN] [MOEX ISS] dividends/PLZL');
    expect(content).toContain('[ERROR] Error: boom');
  });

  it('идемпотентен: повторный вызов не затирает уже собранные строки', () => {
    const first = installRunLogger();
    console.log('[AI_VOTE] ticker=SBER aiVote=HOLD');
    const second = installRunLogger();

    expect(second).toBe(first);
    const content = fs.readFileSync(second!, 'utf8');
    expect(content).toContain('[AI_VOTE] ticker=SBER');
  });

  it('REPORTS_DIR переопределяет каталог лога', () => {
    expect(resolveRunLogPath()).toBe(path.join(logDir, 'last-run.log'));
    expect(resolveRunLogPath({ fileName: 'other.log' })).toBe(
      path.join(logDir, 'other.log'),
    );
  });

  it('альтернативный путь (прямой PipelineCoordinator.run) пишет last-run.log', async () => {
    mockDataExecute.mockResolvedValue(null);
    const { PipelineCoordinator } =
      await import('../ai/pipeline/pipeline-coordinator.js');

    const watchdogStub = {
      start: vi.fn(),
      stop: vi.fn(),
      registerAgent: vi.fn(),
      setAgentTask: vi.fn(),
      checkAgent: vi.fn(async () => ({
        status: 'healthy',
        responseTimeMs: 1,
      })),
      getHealthReport: vi.fn(() => ({ agents: [] })),
      onIncident: vi.fn(),
    };

    const coordinator = new PipelineCoordinator(
      { data: { name: 'DataAgent', verbose: false, retries: 0 } },
      { watchdog: watchdogStub as never },
    );

    await coordinator.run();

    const logPath = path.join(logDir, 'last-run.log');
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, 'utf8');
    expect(content).toContain('[Pipeline] 🚀 Конвейер запущен');
    expect(content).toContain(`[Pipeline] run log: ${logPath}`);
  });
});
