/// <reference types="vitest/globals" />
/**
 * Unit-тесты IPC-ядра десктоп-приложения (desktop/ipc-core.ts).
 *
 * Ядро НЕ импортирует electron → тесты работают под обычным Node (vitest).
 * Директор собирается в детерминированном режиме (aiMode='off', без Excel),
 * как в scripts/director-chat-smoke.test.ts: без сети, без данных, быстро.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildDashboardHtml,
  buildDirectorState,
  buildHarnessState,
  handleAsk,
  handleHarnessExport,
  handleLog,
  handlePanel,
  handleStatus,
  subscribeEvents,
  type DirectorState,
} from './ipc-core.js';
import type { HarnessHandle } from '../src/js/modules/harness-integration/harness-bootstrap.js';
import type { HarnessDashboardPayload } from '../src/js/modules/harness-integration/types.js';

/** Умеренный таймаут: директор гоняет реальных агентов (детерминированных) */
const ASK_TIMEOUT_MS = 30_000;

describe('desktop/ipc-core', () => {
  let state: DirectorState;

  beforeAll(async () => {
    state = await buildDirectorState({
      // Без данных портфеля и без LLM: детерминированный офлайн-режим
      excelPath: '',
      aiMode: 'off',
      logger: () => {},
    });
  }, 60_000);

  afterAll(async () => {
    await state.director.stop();
  });

  it('buildDirectorState создаёт DirectorAgent с аудитом и action-агентами', () => {
    expect(state.director).toBeDefined();
    expect(state.director.name).toBe('DirectorAgent');
    expect(state.audit).toBeDefined();
    expect(state.actionAgents.file).toBeDefined();
    expect(state.actionAgents.terminal).toBeDefined();
    expect(state.sourceLabel).toContain('нет данных портфеля');
    expect(state.aiLabel).toContain('детерминированный');
    expect(state.director.currentSession).not.toBeNull();
  });

  it(
    'handleAsk «Сравни Сбер и Газпром» возвращает ответ + минимум 1 событие плана',
    async () => {
      const result = await handleAsk(state, 'Сравни Сбер и Газпром');

      expect(result.text).toBeTruthy();
      expect(typeof result.text).toBe('string');
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(result.events.length).toBeGreaterThanOrEqual(1);

      // В событиях есть план делегирования (стриминг аудита)
      const planEvent = result.events.find(
        (event) => event.type === 'director.plan_created',
      );
      expect(planEvent).toBeDefined();
      expect(planEvent?.message).toMatch(/подключены агенты/i);

      // Ответ — человечный текст (не исключение и не «[object Object]»)
      expect(result.text).not.toContain('[object');
    },
    ASK_TIMEOUT_MS,
  );

  it('handleStatus возвращает состояние Директора', () => {
    const status = handleStatus(state);
    expect(status.state).toMatch(/idle|running|stopped/);
    expect(status.sessionId).toBeTruthy();
    expect(status.sourceLabel).toContain('нет данных портфеля');
    expect(typeof status.chatMessagesCount).toBe('number');
    expect(Array.isArray(status.connectedAgents)).toBe(true);
  });

  it('handleLog возвращает последние N событий и общий счётчик', () => {
    const all = handleLog(state, 1000);
    expect(all.total).toBeGreaterThanOrEqual(1);
    expect(all.entries.length).toBeLessThanOrEqual(all.total);

    const limited = handleLog(state, 2);
    expect(limited.entries.length).toBeLessThanOrEqual(2);
    expect(limited.total).toBe(all.total);

    // Значения по умолчанию и за границами — безопасны
    const def = handleLog(state);
    expect(def.entries.length).toBeGreaterThanOrEqual(1);
    expect(() => handleLog(state, -5)).not.toThrow();
  });

  it('handlePanel строит панель агентов из action-агентов', () => {
    const panel = handlePanel(state);
    expect(panel.overall).toMatch(/ok|warnings|critical/);
    expect(panel.available.agents).toBe(true);
    const names = panel.agents.map((card) => card.name);
    expect(names).toContain('FileAgent');
    expect(names).toContain('TerminalAgent');
    for (const card of panel.agents) {
      expect(typeof card.totalExecutions).toBe('number');
      expect(typeof card.successes).toBe('number');
      expect(typeof card.failures).toBe('number');
    }
  });

  it(
    'subscribeEvents доставляет события и отписка работает',
    async () => {
      const received: string[] = [];
      const unsubscribe = subscribeEvents(state, (event) => {
        received.push(event.type);
      });

      await handleAsk(state, 'Оцени стратегию портфеля');
      expect(received.length).toBeGreaterThanOrEqual(1);
      expect(received).toContain('director.question_received');

      // Отписка — безопасный no-op при повторном вызове
      unsubscribe();
      unsubscribe();

      const beforeSecond = received.length;
      await handleAsk(state, 'Какие риски сейчас в портфеле?');
      expect(received.length).toBe(beforeSecond);
    },
    ASK_TIMEOUT_MS,
  );

  it(
    'file-запрос без EXCEL_FILE_PATH даёт человечный ответ (без падения)',
    async () => {
      const tmpDir = path.join('desktop', '.tmp-test');
      const target = path.join(tmpDir, `test-${Date.now()}.txt`);
      fs.mkdirSync(tmpDir, { recursive: true });

      try {
        const result = await handleAsk(state, `Создай файл ${target}`);
        expect(result.text).toBeTruthy();
        expect(result.text.length).toBeGreaterThan(10);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    ASK_TIMEOUT_MS,
  );
});

describe('desktop/ipc-core · Гибридный диспетчер', () => {
  it('buildHarnessState не падает и либо активирует диспетчер, либо честно возвращает null', async () => {
    const handle = await buildHarnessState({ autoStart: false });
    if (handle) {
      expect(handle.scheduler).toBeDefined();
      expect(handle.bridge).toBeDefined();
      handle.scheduler.stop();
    } else {
      // Диспетчер недоступен (нет конфигурации/данных) — приложение работает дальше
      expect(handle).toBeNull();
    }
  }, 60_000);
});

describe('desktop/ipc-core · Экспорт дашборда', () => {
  it('handleHarnessExport сохраняет полный HTML-дашборд в файл', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-export-'));
    try {
      const payload: HarnessDashboardPayload = {
        scheduler: {
          mode: 'active',
          lastRunAt: new Date().toISOString(),
          skippedCycles: 0,
          cpuUsagePct: 12,
          memoryUsagePct: 40,
        },
        anomalies: [],
        quikNews: [],
        activeOrdersCount: 0,
        generatedAt: new Date().toISOString(),
      };
      const harness = {
        bridge: { getDashboardPayload: async () => payload },
      } as unknown as HarnessHandle;
      const result = await handleHarnessExport(
        harness,
        new Date('2026-01-02T03:04:05.000Z'),
        tmp,
      );

      expect(result.ok).toBe(true);
      expect(result.filePath).toBeTruthy();
      expect(fs.existsSync(result.filePath!)).toBe(true);
      const html = fs.readFileSync(result.filePath!, 'utf-8');
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('дашборд диспетчера');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('handleHarnessExport без диспетчера → честная ошибка', async () => {
    const result = await handleHarnessExport(null);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('не активирован');
  });

  it('buildDashboardHtml формирует полный HTML-документ (для HTML/PDF-экспорта)', () => {
    const html = buildDashboardHtml(
      {
        scheduler: {
          mode: 'active',
          lastRunAt: new Date().toISOString(),
          skippedCycles: 0,
          cpuUsagePct: 8,
          memoryUsagePct: 35,
        },
        anomalies: [],
        quikNews: [],
        activeOrdersCount: 0,
        generatedAt: new Date().toISOString(),
      },
      new Date('2026-01-02T03:04:05.000Z'),
    );

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('дашборд диспетчера');
    expect(html).toContain('Сформирован:');
  });
});
