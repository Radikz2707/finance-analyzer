/**
 * LearningAgent Tests — обучение на обратной связи.
 *
 * Проверяются: analyze (метрики успешности, среднее время, частые ошибки,
 * фильтры scope/windowMs), learn/feedback (сохранение урока в mock-память,
 * вес по умолчанию, паттерн), устаревание весов (полураспад, fake now),
 * predict (топ-1 по частоте, confidence 0..1, пустая история → null),
 * report (рекомендации из good/bad уроков и метрик), execute()-обёртка
 * и честное поведение при падении источников (warning, без выдумок).
 *
 * Все тесты используют mock-источники и fake now — без сети и БД.
 */

import {
  LearningAgent,
  LearningAgentError,
  buildLessonPattern,
  computeDecayedWeight,
  parseStoredLesson,
} from './learning-agent.js';
import type {
  LearningEvent,
  LearningMemorySource,
  Lesson,
} from './learning-agent.js';

// ─── Helpers ───────────────────────────────────────────────

/** Фиксированное «сейчас» (2026-01-15 12:00 UTC) */
const T0 = new Date('2026-01-15T12:00:00Z');

const DAY_MS = 24 * 60 * 60 * 1000;

interface MadeMemory {
  source: LearningMemorySource;
  saveLesson: ReturnType<typeof vi.fn>;
  getLessons: ReturnType<typeof vi.fn>;
  lessons: Lesson[];
}

/** In-memory mock источника уроков */
function makeMemorySource(initial: Lesson[] = []): MadeMemory {
  const lessons = [...initial];
  const saveLesson = vi.fn(async (lesson: Lesson): Promise<string> => {
    lessons.push(lesson);
    return lesson.id;
  });
  const getLessons = vi.fn(async (): Promise<Lesson[]> => [...lessons]);
  return {
    source: { saveLesson, getLessons },
    saveLesson,
    getLessons,
    lessons,
  };
}

/** Быстрое событие истории с дефолтами */
function ev(
  partial: Partial<LearningEvent> & { action: string },
): LearningEvent {
  return {
    action: partial.action,
    status: partial.status ?? 'success',
    createdAt: partial.createdAt ?? T0.toISOString(),
    agentName: partial.agentName,
    durationMs: partial.durationMs,
    detail: partial.detail,
  };
}

/** Урок в памяти */
function lesson(partial: Partial<Lesson> & { action: string }): Lesson {
  return {
    id: partial.id ?? `l-${partial.action}`,
    pattern: partial.pattern ?? `${partial.action}:good`,
    action: partial.action,
    outcome: partial.outcome ?? 'good',
    weight: partial.weight ?? 1,
    createdAt: partial.createdAt ?? T0.toISOString(),
    source: partial.source ?? 'feedback',
    agent: partial.agent,
    note: partial.note,
  };
}

// ─── analyze ───────────────────────────────────────────────

describe('LearningAgent.analyze', () => {
  it('считает successRate, среднее время и частые ошибки по mock-истории', async () => {
    const events: LearningEvent[] = [
      ev({
        agentName: 'FileAgent',
        action: 'read',
        status: 'success',
        durationMs: 10,
      }),
      ev({
        agentName: 'FileAgent',
        action: 'read',
        status: 'failed',
        durationMs: 50,
        detail: 'ENOENT',
      }),
      ev({
        agentName: 'FileAgent',
        action: 'read',
        status: 'failed',
        durationMs: 40,
        detail: 'EACCES',
      }),
      ev({
        agentName: 'TerminalAgent',
        action: 'execute',
        status: 'success',
        durationMs: 100,
      }),
      ev({
        agentName: 'TerminalAgent',
        action: 'execute',
        status: 'blocked',
        durationMs: 5,
      }),
    ];
    const agent = new LearningAgent({
      historySource: () => events,
      memorySource: makeMemorySource().source,
      now: () => T0,
    });

    const result = await agent.analyze();

    expect(result.metrics.totalEvents).toBe(5);
    expect(result.metrics.successRate).toBeCloseTo(2 / 5);
    expect(result.metrics.avgDurationMs).toBeCloseTo(
      (10 + 50 + 40 + 100 + 5) / 5,
    );

    const read = result.metrics.byAction.find((a) => a.action === 'read');
    expect(read).toBeDefined();
    expect(read!.total).toBe(3);
    expect(read!.success).toBe(1);
    expect(read!.failed).toBe(2);
    expect(read!.blocked).toBe(0);
    expect(read!.successRate).toBeCloseTo(1 / 3);
    expect(read!.avgDurationMs).toBeCloseTo(100 / 3);

    // Частые ошибки — только failed, сгруппированы по действию
    expect(result.metrics.commonFailures).toHaveLength(1);
    const failure = result.metrics.commonFailures[0];
    expect(failure).toMatchObject({
      action: 'read',
      count: 2,
      agentName: 'FileAgent',
    });

    const fileAgent = result.metrics.byAgent.find(
      (a) => a.agentName === 'FileAgent',
    );
    expect(fileAgent).toBeDefined();
    expect(fileAgent!.total).toBe(3);
    expect(fileAgent!.successRate).toBeCloseTo(1 / 3);

    expect(result.summary).toContain('успех 40%');
    expect(result.summary).toContain('Частая ошибка: «read» (2×)');
  });

  it('возвращает метрики без данных о длительности (avgDurationMs отсутствует)', async () => {
    const agent = new LearningAgent({
      historySource: () => [ev({ action: 'read', status: 'success' })],
      memorySource: makeMemorySource().source,
      now: () => T0,
    });
    const result = await agent.analyze();
    expect(result.metrics.avgDurationMs).toBeUndefined();
    expect(result.metrics.byAction[0]).toMatchObject({
      action: 'read',
      successRate: 1,
      total: 1,
    });
  });

  it('фильтрует по scope и windowMs', async () => {
    const old = new Date(T0.getTime() - 2 * DAY_MS).toISOString();
    const events: LearningEvent[] = [
      ev({ agentName: 'FileAgent', action: 'read', status: 'success' }),
      ev({ agentName: 'FileAgent', action: 'read', status: 'failed' }),
      ev({ agentName: 'OtherAgent', action: 'read', status: 'success' }),
      ev({
        agentName: 'FileAgent',
        action: 'old-run',
        status: 'success',
        createdAt: old,
      }),
    ];
    const agent = new LearningAgent({
      historySource: () => events,
      memorySource: makeMemorySource().source,
      now: () => T0,
    });

    const result = await agent.analyze({
      scope: 'FileAgent',
      windowMs: DAY_MS,
    });

    expect(result.metrics.totalEvents).toBe(2);
    expect(result.metrics.scope).toBe('FileAgent');
    expect(result.metrics.windowMs).toBe(DAY_MS);
    expect(result.metrics.byAction.some((a) => a.action === 'old-run')).toBe(
      false,
    );
  });

  it('независимо читает уроки из памяти (source фактов)', async () => {
    const mem = makeMemorySource([lesson({ action: 'read', outcome: 'good' })]);
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: mem.source,
      now: () => T0,
    });
    const result = await agent.analyze();
    expect(result.lessons).toHaveLength(1);
    expect(result.lessons[0]!.action).toBe('read');
    expect(mem.getLessons).toHaveBeenCalledTimes(1);
  });
});

// ─── learn / feedback ──────────────────────────────────────

describe('LearningAgent.learn / feedback', () => {
  it('сохраняет урок в mock-память с весом по умолчанию и паттерном', async () => {
    const mem = makeMemorySource();
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: mem.source,
      now: () => T0,
    });

    const saved = await agent.feedback({
      outcome: 'good',
      action: 'execute',
      agent: 'TerminalAgent',
      note: 'работает',
    });

    expect(mem.saveLesson).toHaveBeenCalledTimes(1);
    expect(saved.id).toBeTruthy();
    expect(saved.pattern).toBe('TerminalAgent:execute:good');
    expect(saved.action).toBe('execute');
    expect(saved.outcome).toBe('good');
    expect(saved.weight).toBe(1); // defaultWeight
    expect(saved.source).toBe('feedback');
    expect(saved.createdAt).toBe(T0.toISOString());
    expect(saved.note).toBe('работает');

    const persisted = mem.lessons[0];
    expect(persisted).toBeDefined();
    expect(persisted!.pattern).toBe('TerminalAgent:execute:good');
  });

  it('learn() — alias для feedback, паттерн без агента', async () => {
    const mem = makeMemorySource();
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: mem.source,
      now: () => T0,
    });
    const saved = await agent.learn({
      feedback: { outcome: 'bad', action: 'delete' },
    });
    expect(saved.pattern).toBe('delete:bad');
    expect(saved.outcome).toBe('bad');
  });

  it('execute({action:"learn"}) без feedback → честная ошибка', async () => {
    const mem = makeMemorySource();
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: mem.source,
      now: () => T0,
    });
    const result = await agent.execute({ action: 'learn' });
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(LearningAgentError);
  });

  it('падение memorySource при записи → LearningAgentError (честная ошибка)', async () => {
    const failing: LearningMemorySource = {
      saveLesson: async () => {
        throw new Error('db down');
      },
      getLessons: async () => [],
    };
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: failing,
      now: () => T0,
    });
    await expect(
      agent.feedback({ outcome: 'good', action: 'x' }),
    ).rejects.toThrow('Не удалось сохранить урок');
  });

  it('поддерживает явный вес обратной связи', async () => {
    const mem = makeMemorySource();
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: mem.source,
      now: () => T0,
    });
    const saved = await agent.feedback({
      outcome: 'good',
      action: 'x',
      weight: 3,
    });
    expect(saved.weight).toBe(3);
  });
});

// ─── устаревание весов ─────────────────────────────────────

describe('устаревание весов уроков (полураспад)', () => {
  it('computeDecayedWeight: 30 дней → 0.5, 60 дней → 0.25', () => {
    const now = new Date('2026-03-15T00:00:00Z');
    const createdAt30 = '2026-02-13T00:00:00Z';
    const createdAt60 = '2026-01-14T00:00:00Z';
    expect(computeDecayedWeight(1, createdAt30, now, 30)).toBeCloseTo(0.5);
    expect(computeDecayedWeight(1, createdAt60, now, 30)).toBeCloseTo(0.25);
    // halfLifeDays <= 0 → без устаревания
    expect(computeDecayedWeight(1, createdAt60, now, 0)).toBe(1);
  });

  it('getLessons() и analyze() отдают уроки с устаревшим весом (fake now)', async () => {
    const createdAt = new Date(T0.getTime() - 30 * DAY_MS).toISOString();
    const stored = lesson({
      id: 'old-1',
      action: 'read',
      weight: 1,
      createdAt,
    });
    const mem = makeMemorySource([stored]);
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: mem.source,
      halfLifeDays: 30,
      now: () => T0,
    });

    const lessons = await agent.getLessons();
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.weight).toBeCloseTo(0.5);
    expect(lessons[0]!.createdAt).toBe(createdAt); // копия, оригинал не мутирован

    const analysis = await agent.analyze();
    expect(analysis.lessons[0]!.weight).toBeCloseTo(0.5);
  });

  it('очень старый урок почти не влияет (вес → ~0)', async () => {
    const createdAt = new Date(T0.getTime() - 10 * 30 * DAY_MS).toISOString();
    const stored = lesson({
      id: 'ancient',
      action: 'read',
      weight: 1,
      createdAt,
    });
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: makeMemorySource([stored]).source,
      halfLifeDays: 30,
      now: () => T0,
    });
    const lessons = await agent.getLessons();
    expect(lessons[0]!.weight).toBeLessThan(0.002);
  });
});

// ─── predict ───────────────────────────────────────────────

describe('LearningAgent.predict', () => {
  it('топ-1 по частоте, confidence 0..1, причины-эвристика', async () => {
    const events: LearningEvent[] = [
      ev({ agentName: 'pipeline', action: 'analyze-portfolio' }),
      ev({ agentName: 'pipeline', action: 'analyze-portfolio' }),
      ev({ agentName: 'pipeline', action: 'analyze-portfolio' }),
      ev({ agentName: 'pipeline', action: 'fetch-data' }),
      ev({ agentName: 'pipeline', action: 'fetch-data' }),
    ];
    const agent = new LearningAgent({
      historySource: () => events,
      memorySource: makeMemorySource().source,
      now: () => T0,
    });

    const result = await agent.predict();

    expect(result.nextActionLikely).toBe('analyze-portfolio');
    expect(result.confidence).toBeCloseTo(3 / 5);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.heuristic).toBe(true);
    expect(result.reasons.some((r) => r.includes('эвристика'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('analyze-portfolio'))).toBe(
      true,
    );
    expect(result.reasons.some((r) => r.includes('Пик активности'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('Чаще всего запуски'))).toBe(
      true,
    );
  });

  it('детерминированный выбор при равенстве частот (лексикографически)', async () => {
    const events: LearningEvent[] = [
      ev({ action: 'bb' }),
      ev({ action: 'aa' }),
    ];
    const agent = new LearningAgent({
      historySource: () => events,
      memorySource: makeMemorySource().source,
      now: () => T0,
    });
    const result = await agent.predict();
    expect(result.nextActionLikely).toBe('aa');
    expect(result.confidence).toBeCloseTo(0.5);
  });

  it('пустая история → null + честная причина', async () => {
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: makeMemorySource().source,
    });
    const result = await agent.predict();
    expect(result.nextActionLikely).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reasons.some((r) => r.includes('пуста'))).toBe(true);
  });
});

// ─── report ────────────────────────────────────────────────

describe('LearningAgent.report', () => {
  it('содержит рекомендации «повторять X» и «избегать Y» из уроков', async () => {
    const stored: Lesson[] = [
      lesson({ id: 'g1', action: 'analyze', outcome: 'good' }),
      lesson({ id: 'g2', action: 'analyze', outcome: 'good' }),
      lesson({ id: 'b1', action: 'delete', outcome: 'bad' }),
    ];
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: makeMemorySource(stored).source,
      now: () => T0,
    });

    const result = await agent.report();

    expect(
      result.recommendations.some((r) =>
        r.startsWith('Повторять «analyze» чаще'),
      ),
    ).toBe(true);
    expect(
      result.recommendations.some((r) => r.startsWith('Избегать «delete»')),
    ).toBe(true);
    // вес good-уроков суммируется (1 + 1)
    const goodRec = result.recommendations.find((r) =>
      r.startsWith('Повторять'),
    );
    expect(goodRec).toBeDefined();
    expect(goodRec!).toContain('вес 2');
    expect(result.summary).toContain('2 рекомендаций');
  });

  it('рекомендация из метрик: действие с низкой успешностью', async () => {
    const events: LearningEvent[] = [
      ev({ action: 'risky-cmd', status: 'failed' }),
      ev({ action: 'risky-cmd', status: 'failed' }),
      ev({ action: 'risky-cmd', status: 'success' }),
    ];
    const agent = new LearningAgent({
      historySource: () => events,
      memorySource: makeMemorySource().source,
      now: () => T0,
    });

    const result = await agent.report();

    expect(
      result.recommendations.some((r) => r.includes('Проверить «risky-cmd»')),
    ).toBe(true);
    expect(result.recommendations.some((r) => r.includes('успех 33%'))).toBe(
      true,
    );
  });

  it('без уроков и событий → честная пустая сводка без выдумок', async () => {
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: makeMemorySource().source,
      now: () => T0,
    });
    const result = await agent.report();
    expect(result.recommendations).toHaveLength(0);
    expect(result.summary).toContain('рекомендаций пока нет');
  });
});

// ─── падение источников ────────────────────────────────────

describe('падение источников (честность)', () => {
  it('analyze: падение historySource → warning + пустые метрики', async () => {
    const agent = new LearningAgent({
      historySource: () => {
        throw new Error('history down');
      },
      memorySource: makeMemorySource().source,
      now: () => T0,
    });

    const result = await agent.analyze();

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('history source failed');
    expect(result.metrics.totalEvents).toBe(0);
    expect(result.metrics.successRate).toBe(0);
    expect(result.metrics.commonFailures).toHaveLength(0);
    expect(result.summary).toContain('данных нет');
    expect(result.summary).toContain('Предупреждения');
  });

  it('analyze: падение memorySource → warning + пустые уроки', async () => {
    const failing: LearningMemorySource = {
      saveLesson: async () => 'id',
      getLessons: async () => {
        throw new Error('memory down');
      },
    };
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: failing,
      now: () => T0,
    });

    const result = await agent.analyze();

    expect(
      result.warnings.some((w) => w.includes('memory source failed')),
    ).toBe(true);
    expect(result.lessons).toHaveLength(0);
  });

  it('report: оба источника упали → рекомендаций нет, только warning', async () => {
    const agent = new LearningAgent({
      historySource: () => {
        throw new Error('boom');
      },
      memorySource: {
        saveLesson: async () => 'id',
        getLessons: async () => {
          throw new Error('db');
        },
      },
      now: () => T0,
    });

    const result = await agent.report();

    expect(result.recommendations).toHaveLength(0);
    expect(result.lessons).toHaveLength(0);
    expect(result.metrics.totalEvents).toBe(0);
    expect(result.warnings).toHaveLength(2);
    expect(result.summary).toContain('Предупреждения');
  });

  it('predict: падение источника → null + причина про недоступность', async () => {
    const agent = new LearningAgent({
      historySource: () => {
        throw new Error('down');
      },
      memorySource: makeMemorySource().source,
      now: () => T0,
    });

    const result = await agent.predict();

    expect(result.nextActionLikely).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reasons.some((r) => r.includes('недоступна'))).toBe(true);
  });
});

// ─── execute() ─────────────────────────────────────────────

describe('execute() — контракт AgentResult', () => {
  it('dispatch по action: learn/analyze/predict/report', async () => {
    const mem = makeMemorySource();
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: mem.source,
      now: () => T0,
    });

    const learned = await agent.execute({
      action: 'learn',
      feedback: { outcome: 'good', action: 'x' },
    });
    expect(learned.success).toBe(true);
    if (learned.data?.kind === 'learn') {
      expect(learned.data.value.pattern).toBe('x:good');
    } else {
      throw new Error('ожидался kind: learn');
    }

    const analyzed = await agent.execute({ action: 'analyze' });
    expect(analyzed.success).toBe(true);
    if (analyzed.data?.kind === 'analyze') {
      expect(analyzed.data.value.metrics.totalEvents).toBe(0);
    } else {
      throw new Error('ожидался kind: analyze');
    }

    const predicted = await agent.execute({ action: 'predict' });
    expect(predicted.success).toBe(true);
    if (predicted.data?.kind === 'predict') {
      expect(predicted.data.value.nextActionLikely).toBeNull();
    } else {
      throw new Error('ожидался kind: predict');
    }

    // после learn урок «x:good» уже в памяти → report даёт рекомендацию
    const reported = await agent.execute({ action: 'report' });
    expect(reported.success).toBe(true);
    if (reported.data?.kind === 'report') {
      expect(
        reported.data.value.recommendations.some((r) =>
          r.startsWith('Повторять «x» чаще'),
        ),
      ).toBe(true);
    } else {
      throw new Error('ожидался kind: report');
    }
  });

  it('learn без feedback через execute → failure с честной ошибкой', async () => {
    const agent = new LearningAgent({
      historySource: () => [],
      memorySource: makeMemorySource().source,
      now: () => T0,
    });
    const result = await agent.execute({ action: 'learn' });
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(LearningAgentError);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.completedAt).toBeTruthy();
  });
});

// ─── чистые функции ────────────────────────────────────────

describe('чистые хелперы', () => {
  it('buildLessonPattern: с агентом и без', () => {
    expect(buildLessonPattern('execute', 'good', 'TerminalAgent')).toBe(
      'TerminalAgent:execute:good',
    );
    expect(buildLessonPattern('delete', 'bad')).toBe('delete:bad');
    expect(buildLessonPattern('read', 'good', '  ')).toBe('read:good');
  });

  it('parseStoredLesson: валидный JSON → Lesson, мусор → null', () => {
    const valid = lesson({ id: 'l1', action: 'read', outcome: 'good' });
    expect(parseStoredLesson(JSON.stringify(valid))).toEqual(valid);
    expect(parseStoredLesson('not json')).toBeNull();
    expect(parseStoredLesson(JSON.stringify({ id: 1 }))).toBeNull();
    expect(
      parseStoredLesson(JSON.stringify({ ...valid, outcome: 'meh' })),
    ).toBeNull();
  });
});
