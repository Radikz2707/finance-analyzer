/// <reference types="vitest/globals" />
/**
 * Тесты AutonomousBridge — автономный цикл внутри desktop-приложения.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AutonomousBridge, type DirectorLike } from './autonomous-bridge.js';
import { GoalAgent } from '../src/js/modules/pipeline/agents/goal-agent/goal-agent.js';

/** Фейковый Директор: успешный ответ с agent-результатами */
function fakeDirector(
  roles: Array<{ role: string; success: boolean }> = [],
): DirectorLike {
  return {
    async processUserMessage(question: string) {
      expect(question).toContain('[autonomous]');
      return {
        text: 'Готово',
        recommendation: { action: 'NONE', confidence: 0.9 },
        task: { agentResults: roles },
      };
    },
  };
}

function tmpGoalAgent(dir: string, name: string): GoalAgent {
  return new GoalAgent({
    name,
    persistence: { filePath: path.join(dir, `${name}.json`) },
  });
}

describe('AutonomousBridge: цели и цикл в desktop-приложении', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomous-bridge-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('1. addGoal добавляет и активирует цель; listGoals её видит', async () => {
    const bridge = new AutonomousBridge({
      director: fakeDirector(),
      goalAgent: tmpGoalAgent(tmpDir, 'bridge1'),
    });
    const goal = await bridge.addGoal('Проверить отчёты');
    expect(goal.status).toBe('active');

    const active = await bridge.listGoals('active');
    expect(active).toHaveLength(1);
    expect(active[0]?.name).toBe('Проверить отчёты');
  });

  it('2. addGoal с пустым текстом бросает ошибку', async () => {
    const bridge = new AutonomousBridge({
      director: fakeDirector(),
      goalAgent: tmpGoalAgent(tmpDir, 'bridge2'),
    });
    await expect(bridge.addGoal('   ')).rejects.toThrow('Текст цели пуст');
  });

  it('3. runOnce выполняет цель и помечает её завершённой', async () => {
    const bridge = new AutonomousBridge({
      director: fakeDirector([{ role: 'analysis', success: true }]),
      goalAgent: tmpGoalAgent(tmpDir, 'bridge3'),
    });
    await bridge.addGoal('Сделать анализ');

    const output = await bridge.runOnce();
    expect(output).not.toBeNull();
    expect(output?.iterations).toHaveLength(1);
    expect(output?.iterations?.[0]?.success).toBe(true);

    const active = await bridge.listGoals('active');
    expect(active).toHaveLength(0);
    const completed = await bridge.listGoals('completed');
    expect(completed).toHaveLength(1);
  });

  it('4. запрещённые роли (terminal/process) блокируются', async () => {
    const bridge = new AutonomousBridge({
      director: fakeDirector([{ role: 'terminal', success: true }]),
      goalAgent: tmpGoalAgent(tmpDir, 'bridge4'),
    });
    await bridge.addGoal('Опасная цель');

    const output = await bridge.runOnce();
    const iteration = output?.iterations?.[0];
    expect(iteration?.success).toBe(false);
    expect(iteration?.result?.recommendedAction).toBe('BLOCKED');

    // Проваленная цель не завершена (paused), не активна
    const active = await bridge.listGoals('active');
    expect(active).toHaveLength(0);
  });

  it('5. start/stop переключают фоновый таймер', async () => {
    const bridge = new AutonomousBridge({
      director: fakeDirector(),
      goalAgent: tmpGoalAgent(tmpDir, 'bridge5'),
    });

    const afterStart = await bridge.start(1);
    expect(afterStart.running).toBe(true);
    expect(afterStart.intervalSec).toBe(1);

    const afterStop = await bridge.stop();
    expect(afterStop.running).toBe(false);

    bridge.dispose();
  });

  it('6. onCycle вызывается с событиями после цикла (уведомления в UI)', async () => {
    const received: Array<{ goalName: string; success: boolean }> = [];
    const bridge = new AutonomousBridge({
      director: fakeDirector([{ role: 'analysis', success: true }]),
      goalAgent: tmpGoalAgent(tmpDir, 'bridge7'),
      onCycle: (events) => {
        for (const event of events) {
          received.push({ goalName: event.goalName, success: event.success });
        }
      },
    });
    await bridge.addGoal('Уведомляемая цель');
    await bridge.runOnce();

    expect(received).toHaveLength(1);
    expect(received[0]?.success).toBe(true);
    expect(received[0]?.goalName).toBe('Уведомляемая цель');
  });

  it('7. status показывает счётчик активных целей и итераций', async () => {
    const bridge = new AutonomousBridge({
      director: fakeDirector([{ role: 'analysis', success: true }]),
      goalAgent: tmpGoalAgent(tmpDir, 'bridge6'),
    });
    await bridge.addGoal('Цель для статуса');

    let st = await bridge.status();
    expect(st.activeGoals).toBe(1);
    expect(st.running).toBe(false);

    await bridge.runOnce();
    st = await bridge.status();
    expect(st.activeGoals).toBe(0);
    expect(st.loop.totalIterations).toBe(1);
  });
});
