/**
 * Watchdog Tests — тесты для модуля мониторинга процессов.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Watchdog } from './watchdog.js';
import type { WatchdogConfig, IncidentRecord } from './types.js';

// ──────────────────────────────────────────────
// Тесты
// ──────────────────────────────────────────────

describe('Watchdog', () => {
  let watchdog: Watchdog;
  let config: WatchdogConfig;

  beforeEach(() => {
    config = {
      checkIntervalMs: 1000,
      verbose: false,
    };
    watchdog = new Watchdog(config);
  });

  it('должен начать мониторинг', () => {
    watchdog.start();
    expect(watchdog.getState()).toBe('monitoring');
  });

  it('должен остановить мониторинг', async () => {
    watchdog.start();
    await watchdog.stop();
    expect(watchdog.getState()).toBe('stopped');
  });

  it('должен зарегистрировать агента', () => {
    watchdog.registerAgent('DataAgent');
    const report = watchdog.getHealthReport();
    expect(report.agents.length).toBe(1);
    expect(report.agents[0].agentName).toBe('DataAgent');
  });

  it('должен проверить здоровье агента', async () => {
    watchdog.registerAgent('DataAgent');
    const check = await watchdog.checkAgent('DataAgent');
    expect(check.agentName).toBe('DataAgent');
    expect(check.status).toBeDefined();
    expect(check.responseTimeMs).toBeGreaterThan(0);
  });

  it('должен определить healthy статус', async () => {
    watchdog.registerAgent('DataAgent');
    
    watchdog['getRandomResponseTime'] = () => 1000; // healthy
    
    const check = await watchdog.checkAgent('DataAgent');
    expect(check.status).toBe('healthy');
  });

  it('должен определить slow статус', async () => {
    watchdog.registerAgent('DataAgent');
    
    watchdog['getRandomResponseTime'] = () => 8000; // slow
    
    const check = await watchdog.checkAgent('DataAgent');
    expect(check.status).toBe('slow');
  });

  it('должен определить timeout статус', async () => {
    watchdog.registerAgent('DataAgent');
    
    watchdog['getRandomResponseTime'] = () => 50000; // timeout
    
    const check = await watchdog.checkAgent('DataAgent');
    expect(check.status).toBe('timeout');
  });

  it('должен создать инцидент при timeout', async () => {
    watchdog.registerAgent('DataAgent');
    
    watchdog['getRandomResponseTime'] = () => 50000; // timeout
    
    let incident: IncidentRecord | null = null;
    watchdog.onIncident((inc) => {
      incident = inc;
    });

    await watchdog.checkAgent('DataAgent');
    
    expect(incident).not.toBeNull();
    expect(incident!.type).toBe('timeout');
    expect(incident!.agentName).toBe('DataAgent');
    expect(watchdog.getIncidents().length).toBe(1);
  });

  it('должен обработать callback при перезапуске агента', async () => {
    watchdog.registerAgent('DataAgent');
    
    watchdog['getRandomResponseTime'] = () => 50000; // timeout
    
    let restartedAgent: string | null = null;
    watchdog.onAgentRestarted((agentName: string) => {
      restartedAgent = agentName;
    });

    await watchdog.checkAgent('DataAgent');
    
    expect(restartedAgent).toBe('DataAgent');
  });

  it('должен установить задание агента', () => {
    watchdog.registerAgent('DataAgent');
    watchdog.setAgentTask('DataAgent', 'task-123', 30000);
    
    const check = watchdog.getHealthReport().agents[0];
    expect(check.currentTask).toBeDefined();
    expect(check.currentTask!.taskId).toBe('task-123');
    expect(check.currentTask!.deadlineMs).toBe(30000);
  });

  it('должен удалить агента из мониторинга', () => {
    watchdog.registerAgent('DataAgent');
    watchdog.unregisterAgent('DataAgent');
    
    const report = watchdog.getHealthReport();
    expect(report.agents.length).toBe(0);
  });

  it('должен вернуть статистику', async () => {
    watchdog.registerAgent('DataAgent');
    watchdog['getRandomResponseTime'] = () => 1000; // healthy
    
    await watchdog.checkAgent('DataAgent');
    
    const stats = watchdog.getStats();
    expect(stats.totalChecks).toBe(1);
    expect(stats.healthyChecks).toBe(1);
  });

  it('должен вернуть отчёт по здоровью', async () => {
    watchdog.registerAgent('DataAgent');
    watchdog.registerAgent('ResearchAgent');
    
    watchdog['getRandomResponseTime'] = () => 1000; // healthy
    
    await watchdog.checkAgent('DataAgent');
    await watchdog.checkAgent('ResearchAgent');
    
    const report = watchdog.getHealthReport();
    expect(report.agents.length).toBe(2);
    expect(report.unhealthyAgents.length).toBe(0);
  });

  it('должен обработать несколько попыток восстановления', async () => {
    watchdog.registerAgent('DataAgent');
    
    watchdog['getRandomResponseTime'] = () => 50000; // timeout
    
    await watchdog.checkAgent('DataAgent');
    
    const incidents = watchdog.getIncidents();
    expect(incidents.length).toBeGreaterThan(0);
    expect(incidents[0].recoveryAttempts).toBeGreaterThan(0);
  });

  it('должен ограничить попытки восстановления', async () => {
    watchdog.registerAgent('DataAgent');
    
    // Максимум 1 попытка
    const limitedWatchdog = new Watchdog({
      ...config,
      maxRecoveryAttempts: 1,
    });
    
    limitedWatchdog.registerAgent('DataAgent');
    limitedWatchdog['getRandomResponseTime'] = () => 50000; // timeout
    
    await limitedWatchdog.checkAgent('DataAgent');
    
    const incidents = limitedWatchdog.getIncidents();
    expect(incidents[0].recoveryAttempts).toBeLessThanOrEqual(1);
  });
});
