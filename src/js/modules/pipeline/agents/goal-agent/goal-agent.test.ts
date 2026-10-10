/**
 * Тесты персистентности GoalAgent (JSON-файл в data/).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GoalAgent } from './goal-agent.js';
import { GoalStore } from './goal-store.js';
import type { Goal } from './types.js';

describe('GoalAgent: персистентность целей', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-agent-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('1. Сохраняет цели в файл и загружает их в новом экземпляре', async () => {
    const filePath = path.join(tmpDir, 'round-trip.json');

    // Первый агент: добавить и активировать цель
    const first = new GoalAgent({ name: 'A1', persistence: { filePath } });
    const added = await first.execute({
      action: 'add',
      params: {
        name: 'Проверить здоровье проекта',
        description: 'Полная проверка проекта',
        type: 'analysis',
        priority: 'high',
      },
    });
    expect(added.success).toBe(true);
    const goalId = (added.data as { goal: Goal }).goal.id;
    await first.execute({
      action: 'update',
      params: { id: goalId, status: 'active' },
    });

    // Файл существует и валиден
    expect(fs.existsSync(filePath)).toBe(true);
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Goal[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe(goalId);
    expect(stored[0]!.status).toBe('active');

    // Второй агент: цель пережила «перезапуск»
    const second = new GoalAgent({ name: 'A2', persistence: { filePath } });
    const listed = await second.execute({
      action: 'list',
      params: { status: 'active' },
    });
    expect(listed.success).toBe(true);
    const goals = (listed.data as { goals: Goal[] }).goals;
    expect(goals).toHaveLength(1);
    expect(goals[0]!.id).toBe(goalId);
    expect(goals[0]!.priority).toBe('high');
  });

  it('2. Отсутствующий файл означает пустой список (без ошибки)', async () => {
    const filePath = path.join(tmpDir, 'does-not-exist.json');
    const agent = new GoalAgent({ name: 'A3', persistence: { filePath } });

    const listed = await agent.execute({ action: 'list' });
    expect(listed.success).toBe(true);
    expect((listed.data as { goals: Goal[] }).goals).toHaveLength(0);
    // Файл не должен создаваться до первой мутации
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('3. Битый JSON не роняет агент — старт с пустого списка', async () => {
    const filePath = path.join(tmpDir, 'corrupted.json');
    fs.writeFileSync(filePath, '{not a valid json', 'utf-8');

    const agent = new GoalAgent({ name: 'A4', persistence: { filePath } });
    const listed = await agent.execute({ action: 'list' });
    expect(listed.success).toBe(true);
    expect((listed.data as { goals: Goal[] }).goals).toHaveLength(0);
  });

  it('4. Сохраняет и восстанавливает все поля цели (deadline, tags, metrics)', async () => {
    const filePath = path.join(tmpDir, 'full-fields.json');
    const agent = new GoalAgent({ name: 'A5', persistence: { filePath } });

    const added = await agent.execute({
      action: 'add',
      params: {
        name: 'Ребалансировка портфеля',
        description: 'Проверить отклонения',
        type: 'action',
        priority: 'critical',
        deadline: '2030-01-01T00:00:00.000Z',
        tags: ['portfolio', 'rebalance'],
        metrics: { targetDrift: 5 },
      },
    });
    expect(added.success).toBe(true);

    const restored = new GoalAgent({ name: 'A6', persistence: { filePath } });
    const listed = await restored.execute({ action: 'list' });
    const goals = (listed.data as { goals: Goal[] }).goals;
    expect(goals).toHaveLength(1);

    const goal = goals[0]!;
    expect(goal.type).toBe('action');
    expect(goal.priority).toBe('critical');
    expect(goal.deadline).toBe('2030-01-01T00:00:00.000Z');
    expect(goal.tags).toEqual(['portfolio', 'rebalance']);
    expect(goal.metrics).toEqual({ targetDrift: 5 });
  });

  it('5. Обновления и удаление тоже персистентны', async () => {
    const filePath = path.join(tmpDir, 'mutations.json');
    const agent = new GoalAgent({ name: 'A7', persistence: { filePath } });

    const added = await agent.execute({
      action: 'add',
      params: {
        name: 'Временная цель',
        description: 'Для удаления',
        type: 'tracking',
      },
    });
    const goalId = (added.data as { goal: Goal }).goal.id;

    await agent.execute({
      action: 'update',
      params: { id: goalId, progress: 50, status: 'active' },
    });

    const restored = new GoalAgent({ name: 'A8', persistence: { filePath } });
    const got = await restored.execute({
      action: 'get',
      params: { id: goalId },
    });
    const goal = (got.data as { goal: Goal }).goal;
    expect(goal.progress).toBe(50);
    expect(goal.status).toBe('active');

    await restored.execute({ action: 'delete', params: { id: goalId } });
    const afterDelete = new GoalAgent({
      name: 'A9',
      persistence: { filePath },
    });
    const listed = await afterDelete.execute({ action: 'list' });
    expect((listed.data as { goals: Goal[] }).goals).toHaveLength(0);
  });

  it('6. persistence.enabled=false отключает файл (только в памяти)', async () => {
    const filePath = path.join(tmpDir, 'disabled.json');
    const agent = new GoalAgent({
      name: 'A10',
      persistence: { enabled: false, filePath },
    });

    const added = await agent.execute({
      action: 'add',
      params: {
        name: 'Неперсистентная цель',
        description: 'Только в памяти',
        type: 'research',
      },
    });
    expect(added.success).toBe(true);
    expect(agent.getGoalCount()).toBe(1);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('7. GoalStore отбрасывает записи без id/name', async () => {
    const filePath = path.join(tmpDir, 'garbage-entries.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        {
          id: 'ok-1',
          name: 'Валидная цель',
          type: 'analysis',
          status: 'active',
        },
        { name: 'Без id' },
        { id: 'ok-2' },
        'просто строка',
        null,
      ]),
      'utf-8',
    );

    const store = new GoalStore({ filePath });
    const goals = await store.load();
    expect(goals).toHaveLength(1);
    expect(goals[0]!.id).toBe('ok-1');
    // Значения по умолчанию для отсутствующих полей
    expect(goals[0]!.priority).toBe('medium');
    expect(goals[0]!.status).toBe('active');
    expect(goals[0]!.tags).toEqual([]);
  });

  it('8. reload() подхватывает цели, добавленные извне (watch-режим)', async () => {
    const filePath = path.join(tmpDir, 'reload.json');
    const agent = new GoalAgent({ name: 'A11', persistence: { filePath } });

    // Основной агент добавляет первую цель (сохраняется в файл)
    await agent.execute({
      action: 'add',
      params: {
        name: 'Цель №1',
        description: 'От основного агента',
        type: 'analysis',
      },
    });

    // «Внешний процесс» добавляет вторую цель в то же хранилище
    const external = new GoalAgent({
      name: 'External',
      persistence: { filePath },
    });
    await external.execute({
      action: 'add',
      params: {
        name: 'Цель №2',
        description: 'От внешнего процесса',
        type: 'action',
        priority: 'high',
      },
    });

    // До reload основной агент видит только свою цель
    const before = await agent.execute({ action: 'list' });
    expect((before.data as { goals: Goal[] }).goals).toHaveLength(1);

    // reload перечитывает файл
    await agent.reload();
    const after = await agent.execute({ action: 'list' });
    const goals = (after.data as { goals: Goal[] }).goals;
    expect(goals).toHaveLength(2);
    expect(goals.map((g) => g.name).sort()).toEqual(['Цель №1', 'Цель №2']);
  });

  it('9. reload() при отключённой персистентности — no-op без ошибки', async () => {
    const agent = new GoalAgent({
      name: 'A12',
      persistence: { enabled: false },
    });
    await expect(agent.reload()).resolves.toBeUndefined();
  });
});
