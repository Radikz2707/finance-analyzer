import { describe, it, expect, beforeEach } from 'vitest';
import { AgentController } from './agent-controller.js';
import { AuditLog } from '../audit/audit-log.js';

describe('AgentController', () => {
  let controller: AgentController;
  let auditLog: AuditLog;

  beforeEach(() => {
    auditLog = new AuditLog();
    controller = new AgentController(auditLog);
  });

  it('should register agents', () => {
    controller.registerAgent('test-agent', {}, { name: 'test-agent' });
    const status = controller.getStatus('test-agent');
    expect(status).toBeDefined();
    expect(status?.name).toBe('test-agent');
    expect(status?.status).toBe('idle');
  });

  it('should return all statuses', () => {
    controller.registerAgent('agent-1', {}, { name: 'agent-1' });
    controller.registerAgent('agent-2', {}, { name: 'agent-2' });

    const statuses = controller.getAllStatuses();
    expect(statuses.length).toBe(2);
    expect(statuses.map((s) => s.name)).toContain('agent-1');
    expect(statuses.map((s) => s.name)).toContain('agent-2');
  });

  it('should stop an agent', async () => {
    controller.registerAgent('test-agent', {}, { name: 'test-agent' });
    const success = await controller.stopAgent('test-agent');
    expect(success).toBe(true);

    const status = controller.getStatus('test-agent');
    expect(status?.status).toBe('stopped');
  });

  it('should restart an agent', async () => {
    controller.registerAgent('test-agent', {}, { name: 'test-agent' });
    await controller.stopAgent('test-agent');

    const success = await controller.restartAgent('test-agent');
    expect(success).toBe(true);

    const status = controller.getStatus('test-agent');
    expect(status?.status).toBe('idle');
  });

  it('should update config', () => {
    controller.registerAgent('test-agent', {}, { name: 'test-agent', retries: 0 });
    const success = controller.updateConfig('test-agent', { retries: 5 });
    expect(success).toBe(true);

    const status = controller.getStatus('test-agent');
    expect(status?.config.retries).toBe(5);
  });

  it('should override result', () => {
    controller.registerAgent('test-agent', {}, { name: 'test-agent' });
    const success = controller.overrideResult('test-agent', 'test-command', { data: 'value' });
    expect(success).toBe(true);
  });

  it('should format agents report', () => {
    controller.registerAgent('agent-1', {}, { name: 'agent-1' });
    controller.registerAgent('agent-2', {}, { name: 'agent-2' });

    const report = controller.formatAgentsReport();
    expect(report).toContain('agent-1');
    expect(report).toContain('agent-2');
    expect(report).toContain('idle');
  });

  it('should format agent detail', () => {
    controller.registerAgent('test-agent', {}, { name: 'test-agent' });
    const detail = controller.formatAgentDetail('test-agent');
    expect(detail).toContain('test-agent');
    expect(detail).toContain('idle');
  });

  it('should return undefined for non-existent agent', () => {
    const status = controller.getStatus('non-existent');
    expect(status).toBeUndefined();
  });

  it('should fail to stop non-existent agent', async () => {
    const success = await controller.stopAgent('non-existent');
    expect(success).toBe(false);
  });
});
