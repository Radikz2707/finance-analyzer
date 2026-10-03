import { DirectorDelegationPlanner } from './delegation-planner.js';
import { parseUserMessage } from './nl-parser.js';

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
