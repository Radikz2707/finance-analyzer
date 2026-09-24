import { describe, it, expect, beforeEach } from 'vitest';
import { AgentBase } from './agent-base.js';

// ── Mock agent для тестов ──

class MockAgent extends AgentBase {
  private mockDelay = 0;
  private mockError: Error | null = null;
  private mockData: unknown = { success: true };

  setDelay(ms: number): void {
    this.mockDelay = ms;
  }

  setError(err: Error): void {
    this.mockError = err;
  }

  setData(data: unknown): void {
    this.mockData = data;
  }

  protected async executeInternal(_input: unknown): Promise<unknown> {
    // Минимальная задержка для стабильности durationMs
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (this.mockDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.mockDelay));
    }
    if (this.mockError) {
      throw this.mockError;
    }
    return this.mockData;
  }
}

describe('AgentBase', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = new MockAgent({ name: 'TestAgent', verbose: false, retries: 0 });
  });

  it('should start in idle state', () => {
    expect(agent.state).toBe('idle');
  });

  it('should execute successfully and return result', async () => {
    agent.setData({ value: 42 });
    const result = await agent.execute(null);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ value: 42 });
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.completedAt).toBeDefined();
    expect(agent.state).toBe('idle');
  });

  it('should track execution statistics', () => {
    expect(agent.totalExecutions).toBe(0);
    expect(agent.totalSuccesses).toBe(0);
    expect(agent.totalFailures).toBe(0);
  });

  it('should increment counters on successful execution', async () => {
    await agent.execute(null);

    const summary = agent.getSummary();
    expect(summary.totalExecutions).toBe(1);
    expect(summary.totalSuccesses).toBe(1);
    expect(summary.totalFailures).toBe(0);
  });

  it('should handle errors and increment failure counter', async () => {
    agent.setError(new Error('Test error'));
    const result = await agent.execute(null);

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Test error');
    expect(agent.state).toBe('error');

    const summary = agent.getSummary();
    expect(summary.totalExecutions).toBe(1);
    expect(summary.totalSuccesses).toBe(0);
    expect(summary.totalFailures).toBe(1);
  });

  it('should retry on failure', async () => {
    let attemptCount = 0;

    class RetryAgent extends AgentBase {
      protected async executeInternal(_input: unknown): Promise<unknown> {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Transient error');
        }
        return { success: true };
      }
    }

    const retryAgent = new RetryAgent({
      name: 'RetryAgent',
      retries: 3,
      retryDelayMs: 10,
      verbose: false,
    });

    const result = await retryAgent.execute(null);

    expect(result.success).toBe(true);
    expect(attemptCount).toBe(3);
    expect(retryAgent.state).toBe('idle');
  });

  it('should exhaust retries and return error', async () => {
    class FailingAgent extends AgentBase {
      protected async executeInternal(_input: unknown): Promise<unknown> {
        throw new Error('Persistent error');
      }
    }

    const failingAgent = new FailingAgent({
      name: 'FailingAgent',
      retries: 2,
      retryDelayMs: 10,
      verbose: false,
    });

    const result = await failingAgent.execute(null);

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Persistent error');
    expect(failingAgent.state).toBe('error');
  });

  it('should respect timeout between retries', async () => {
    let attemptCount = 0;

    class FailingSlowAgent extends AgentBase {
      protected async executeInternal(_input: unknown): Promise<unknown> {
        attemptCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw new Error('Always fails');
      }
    }

    const failingAgent = new FailingSlowAgent({
      name: 'FailingSlowAgent',
      timeoutMs: 120,
      retries: 5,
      retryDelayMs: 20,
      verbose: false,
    });

    const result = await failingAgent.execute(null);

    // Таймаут должен сработать до завершения всех попыток
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('timed out');
    expect(attemptCount).toBeGreaterThan(1);
  });

  it('should not execute when stopped', async () => {
    await agent.stop();
    const result = await agent.execute(null);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('stopped');
  });

  it('should return correct summary', async () => {
    agent.setData({ value: 1 });
    await agent.execute(null);

    agent.setData({ value: 2 });
    await agent.execute(null);

    const summary = agent.getSummary();
    expect(summary.name).toBe('TestAgent');
    expect(summary.state).toBe('idle');
    expect(summary.totalExecutions).toBe(2);
    expect(summary.totalSuccesses).toBe(2);
    expect(summary.totalFailures).toBe(0);
    expect(summary.lastExecution).toBeDefined();
    expect(summary.lastExecution?.success).toBe(true);
  });
});
