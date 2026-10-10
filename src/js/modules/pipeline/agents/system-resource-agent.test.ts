/**
 * SystemResourceAgent — мониторинг системных ресурсов (CPU/RAM).
 *
 * Покрытие:
 * - { action: 'status' } → снимок с корректными полями;
 * - неизвестное действие → честная ошибка (success=false);
 * - message человекочитаем и содержит CPU и память.
 *
 * Тесты используют глобалы (globals: true) — как остальные тесты проекта.
 */

import { SystemResourceAgent } from './system-resource-agent.js';

function dataOf(result: { data?: unknown }): {
  cpuUsagePct: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  memoryUsagePct: number;
  isBusy: boolean;
  cores: number;
  platform: string;
  uptimeSec: number;
  message: string;
} {
  return result.data as {
    cpuUsagePct: number;
    memoryUsedMb: number;
    memoryTotalMb: number;
    memoryUsagePct: number;
    isBusy: boolean;
    cores: number;
    platform: string;
    uptimeSec: number;
    message: string;
  };
}

describe('SystemResourceAgent — мониторинг ресурсов', () => {
  it('1. status возвращает снимок с корректными полями', async () => {
    const agent = new SystemResourceAgent({ name: 'SystemResourceAgent' });
    const result = await agent.execute({ action: 'status' });
    expect(result.success).toBe(true);
    const output = dataOf(result);
    expect(output.cpuUsagePct).toBeGreaterThanOrEqual(0);
    expect(output.cpuUsagePct).toBeLessThanOrEqual(100);
    expect(output.memoryTotalMb).toBeGreaterThan(0);
    expect(output.memoryUsedMb).toBeLessThanOrEqual(output.memoryTotalMb);
    expect(output.memoryUsagePct).toBeGreaterThanOrEqual(0);
    expect(output.memoryUsagePct).toBeLessThanOrEqual(100);
    expect(output.cores).toBeGreaterThan(0);
    expect(output.platform.length).toBeGreaterThan(0);
    expect(output.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(typeof output.isBusy).toBe('boolean');
  });

  it('2. message человекочитаем: CPU и память присутствуют', async () => {
    const agent = new SystemResourceAgent();
    const result = await agent.execute({ action: 'status' });
    const output = dataOf(result);
    expect(output.message).toContain('CPU');
    expect(output.message).toContain('память');
  });

  it('3. Неизвестное действие → честная ошибка', async () => {
    const agent = new SystemResourceAgent();
    const result = await agent.execute({ action: 'kill-all' });
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('неизвестное действие');
  });

  it('4. Пустой вход → честная ошибка', async () => {
    const agent = new SystemResourceAgent();
    const result = await agent.execute(undefined);
    expect(result.success).toBe(false);
  });
});
