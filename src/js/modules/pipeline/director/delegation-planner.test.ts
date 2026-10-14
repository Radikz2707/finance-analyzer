import { DirectorDelegationPlanner } from './delegation-planner.js';
import { parseUserMessage } from './nl-parser.js';
import type { ExtractedTask } from '../task-extractor/types.js';

// ─── Helpers ───────────────────────────────────────────────────────

function makeTask(
  action: ExtractedTask['action'],
  target: string,
  params: Record<string, unknown> = {},
): ExtractedTask {
  return {
    id: 'task-test-1',
    action,
    target,
    params,
    confidence: 0.9,
    rawText: `тестовая задача: ${target}`,
  };
}

describe('DirectorDelegationPlanner', () => {
  it('строит план с обоснованием подключения каждого агента', () => {
    const planner = new DirectorDelegationPlanner();
    const question = parseUserMessage('Что делать с PLZL?');
    const plan = planner.buildPlan(question);

    expect(plan.connectedAgents.length).toBeGreaterThan(0);
    for (const assignment of plan.agentAssignments) {
      expect(assignment.rationale.length).toBeGreaterThan(10);
      expect(assignment.task.length).toBeGreaterThan(5);
      expect(assignment.inputData).toContain('Вопрос:');
    }
  });

  it('созывает Consilium для стратегических вопросов', () => {
    const planner = new DirectorDelegationPlanner();
    const question = parseUserMessage('Какая стратегия по PLZL лучше?');
    const plan = planner.buildPlan(question);

    expect(plan.needsConsilium).toBe(true);
    expect(plan.discussionTopics.length).toBeGreaterThan(0);
  });

  it('не созывает Consilium для простого вопроса', () => {
    const planner = new DirectorDelegationPlanner();
    const question = parseUserMessage('Что делать с PLZL?');
    const plan = planner.buildPlan(question);

    expect(plan.needsConsilium).toBe(false);
  });

  it('уважает ограничение maxAgents', () => {
    const planner = new DirectorDelegationPlanner({ maxAgents: 2 });
    const question = parseUserMessage('Что происходит с моим портфелем?');
    const plan = planner.buildPlan(question);

    expect(plan.connectedAgents.length).toBeLessThanOrEqual(2);
  });

  it('формирует DirectorTask.agents с ожидаемыми результатами', () => {
    const planner = new DirectorDelegationPlanner();
    const question = parseUserMessage('Что делать с PLZL?');
    const tasks = planner.buildAgentTasks(question);

    expect(tasks.length).toBe(
      planner.buildPlan(question).connectedAgents.length,
    );
    for (const task of tasks) {
      expect(task.taskId).toBeTruthy();
      expect(task.expectedOutput.length).toBeGreaterThan(0);
      expect(task.priority).toMatch(/high|normal|low/);
    }
  });
});

describe('DirectorDelegationPlanner: buildPlanFromTask (TaskExtractor)', () => {
  it('file-задача → план с FileAgent без Consilium', () => {
    const planner = new DirectorDelegationPlanner();
    const plan = planner.buildPlanFromTask(
      makeTask('file', 'src/test.ts', { action: 'write' }),
    );

    expect(plan.connectedAgents).toEqual(['file']);
    expect(plan.needsConsilium).toBe(false);
    expect(plan.goal).toContain('Файловая операция');
    expect(plan.userQuestion).toContain('тестовая задача');
    expect(plan.agentAssignments).toHaveLength(1);
    expect(plan.agentAssignments[0]!.rationale.length).toBeGreaterThan(10);
    expect(plan.agentAssignments[0]!.inputData).toContain('Действие: file');
  });

  it('terminal-задача → план с TerminalAgent', () => {
    const planner = new DirectorDelegationPlanner();
    const plan = planner.buildPlanFromTask(
      makeTask('terminal', 'npm run test', {
        command: 'npm',
        args: ['run', 'test'],
      }),
    );

    expect(plan.connectedAgents).toEqual(['terminal']);
    expect(plan.goal).toContain('Выполнить команду');
  });

  it('code-задача → план с CodingWorkflow', () => {
    const planner = new DirectorDelegationPlanner();
    const plan = planner.buildPlanFromTask(
      makeTask('code', 'src/js/modules/x/y.ts', {
        files: ['src/js/modules/x/y.ts'],
      }),
    );

    expect(plan.connectedAgents).toEqual(['code']);
    expect(plan.goal).toContain('Разработать функционал');
  });

  it('research-задача → план с ResearchAgent + AI', () => {
    const planner = new DirectorDelegationPlanner();
    const plan = planner.buildPlanFromTask(makeTask('research', 'SBER'));

    expect(plan.connectedAgents).toEqual(['research', 'ai']);
  });

  it('goal-задача → план без ролей (обрабатывается goalIntake)', () => {
    const planner = new DirectorDelegationPlanner();
    const plan = planner.buildPlanFromTask(makeTask('goal', 'покрыть тестами'));

    expect(plan.connectedAgents).toEqual([]);
    expect(plan.goal).toContain('Цель автономного цикла');
  });

  it('buildAgentTasksFromTask → задачи соответствуют ролям плана', () => {
    const planner = new DirectorDelegationPlanner();
    const task = makeTask('file', 'src/test.ts', { action: 'write' });
    const plan = planner.buildPlanFromTask(task);
    const agentTasks = planner.buildAgentTasksFromTask(task);

    expect(agentTasks).toHaveLength(plan.connectedAgents.length);
    for (const agentTask of agentTasks) {
      expect(agentTask.taskId).toBeTruthy();
      expect(agentTask.expectedOutput.length).toBeGreaterThan(0);
      expect(agentTask.priority).toMatch(/high|normal|low/);
      expect(agentTask.inputData.action).toBe('file');
    }
  });
});
