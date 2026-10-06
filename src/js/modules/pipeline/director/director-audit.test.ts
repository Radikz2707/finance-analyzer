import { DirectorAuditLog } from './director-audit.js';
import type { DirectorAuditEventType } from './director-types.js';

// ─── Helpers ───────────────────────────────────────────────────────

function makeLog(maxEntries?: number): DirectorAuditLog {
  return new DirectorAuditLog(maxEntries);
}

function recordFew(
  log: DirectorAuditLog,
  types: DirectorAuditEventType[] = [
    'director.question_received',
    'director.plan_created',
    'director.consilium_started',
  ],
): void {
  for (const type of types) {
    log.record(type, 'message for ' + type);
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('DirectorAuditLog', () => {
  it('базовый API: record/getAll/getByTask/clear не изменены', () => {
    const log = makeLog();
    const event = log.record('director.plan_created', 'План создан', {
      taskId: 't-1',
      metadata: { agents: ['analysis'] },
    });

    expect(event.type).toBe('director.plan_created');
    expect(event.taskId).toBe('t-1');
    expect(event.metadata.agents).toEqual(['analysis']);
    expect(log.getAll()).toHaveLength(1);
    expect(log.getByTask('t-1')).toHaveLength(1);
    expect(log.getByTask('t-2')).toHaveLength(0);

    log.clear();
    expect(log.getAll()).toHaveLength(0);
  });

  it('onEvent: подписчик получает события в порядке записи', () => {
    const log = makeLog();
    const received: DirectorAuditEventType[] = [];
    log.onEvent((event) => received.push(event.type));

    recordFew(log);

    expect(received).toEqual([
      'director.question_received',
      'director.plan_created',
      'director.consilium_started',
    ]);
    // Событие содержит полные данные (сообщение + метаданные)
    const plan = log.getAll().find((e) => e.type === 'director.plan_created');
    expect(plan?.message).toBe('message for director.plan_created');
  });

  it('onEvent: несколько подписчиков получают каждое событие', () => {
    const log = makeLog();
    const first: DirectorAuditEventType[] = [];
    const second: DirectorAuditEventType[] = [];
    log.onEvent((e) => first.push(e.type));
    log.onEvent((e) => second.push(e.type));

    log.record('director.plan_created', 'План');

    expect(first).toEqual(['director.plan_created']);
    expect(second).toEqual(['director.plan_created']);
  });

  it('onEvent: отписка прекращает доставку, повторная отписка — no-op', () => {
    const log = makeLog();
    const received: DirectorAuditEventType[] = [];
    const unsubscribe = log.onEvent((event) => received.push(event.type));

    log.record('director.question_received', 'q1');
    unsubscribe();
    log.record('director.plan_created', 'план после отписки');
    unsubscribe(); // повторно — безопасно

    expect(received).toEqual(['director.question_received']);
  });

  it('onEvent: отписка одного подписчика не влияет на других', () => {
    const log = makeLog();
    const keep: DirectorAuditEventType[] = [];
    const drop: DirectorAuditEventType[] = [];
    log.onEvent((e) => keep.push(e.type));
    const unsubscribe = log.onEvent((e) => drop.push(e.type));

    log.record('director.question_received', 'q1');
    unsubscribe();
    log.record('director.synthesis_created', 's1');

    expect(keep).toEqual([
      'director.question_received',
      'director.synthesis_created',
    ]);
    expect(drop).toEqual(['director.question_received']);
  });

  it('onEvent: ошибка в слушателе не роняет запись и других слушателей', () => {
    const log = makeLog();
    const healthy: DirectorAuditEventType[] = [];
    log.onEvent(() => {
      throw new Error('listener crash');
    });
    log.onEvent((e) => healthy.push(e.type));

    expect(() => log.record('director.plan_created', 'план')).not.toThrow();
    expect(healthy).toEqual(['director.plan_created']);
    expect(log.getAll()).toHaveLength(1);
  });

  it('ограничение размера лога применяется к записям (не к подписчикам)', () => {
    const log = makeLog(2);
    recordFew(log, [
      'director.question_received',
      'director.plan_created',
      'director.synthesis_created',
    ]);

    expect(log.getAll()).toHaveLength(2);
    expect(log.getAll().map((e) => e.type)).toEqual([
      'director.plan_created',
      'director.synthesis_created',
    ]);
  });

  it('getRecent(minutes) возвращает только свежие события', () => {
    const log = makeLog();
    log.record('director.question_received', 'старое');
    // Подмена timestamp: прямиком мутируем запись, как если бы она устарела
    const stale = log.getAll()[0];
    if (stale) {
      stale.timestamp = new Date(Date.now() - 10 * 60_000).toISOString();
    }
    log.record('director.plan_created', 'свежее');

    const recent = log.getRecent(5);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.type).toBe('director.plan_created');
  });
});
