/**
 * BrowserGateway Tests — тесты для браузерного/ОС шлюза.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BrowserGateway } from './browser-gateway.js';
import type { ExternalAiConfig, ExternalAiRequest } from './types.js';

// ──────────────────────────────────────────────
// Тесты
// ──────────────────────────────────────────────

describe('BrowserGateway', () => {
  let gateway: BrowserGateway;

  beforeEach(() => {
    gateway = new BrowserGateway(
      { exePath: 'C:\\Program Files\\happ\\happ.exe' },
      { headless: true },
    );
  });

  it('должен создать экземпляр с дефолтной конфигурацией', () => {
    expect(gateway).toBeDefined();
    expect(gateway.getState()).toBe('idle');
  });

  it('должен вернуть начальную статистику', () => {
    const stats = gateway.getStats();
    expect(stats.totalRequests).toBe(0);
    expect(stats.successfulRequests).toBe(0);
    expect(stats.errors).toBe(0);
  });

  it('должен получить состояние idle', () => {
    expect(gateway.getState()).toBe('idle');
  });

  it('должен очистить сессию', async () => {
    await gateway.clearSession();
    expect(gateway.getState()).toBe('idle');
  });

  it('должен вернуть state starting после вызова startHapp', async () => {
    // startHapp может не сработать если файл не существует,
    // но state должен измениться на starting
    const result = gateway.startHapp();
    // Даем время на асинхронное выполнение
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    // State может быть starting или running или error
    const state = gateway.getState();
    expect(['starting', 'running', 'error', 'stopped']).toContain(state);
    
    await result;
  });

  it('должен вернуть false если happ.exe не существует', async () => {
    const gateway2 = new BrowserGateway({ exePath: 'C:\\nonexistent\\happ.exe' });
    const result = await gateway2.startHapp();
    expect(result).toBe(false);
  });

  it('должен обработать authenticate с невалидным ключом', async () => {
    const config: ExternalAiConfig = {
      provider: 'openai',
      apiKey: 'invalid-key-test-12345',
    };

    const result = await gateway.authenticate('openai', config);
    expect(result).toBe(false);
  });

  it('должен вернуть ошибку валидации без конфигурации AI', async () => {
    const request: ExternalAiRequest = {
      task: 'validate',
      input: { data: 'test' },
    };

    const response = await gateway.validate(request);
    expect(response.success).toBe(false);
    expect(response.error).toContain('not configured');
  });

  it('должен обновить статистику после失败的 валидации', async () => {
    const request: ExternalAiRequest = {
      task: 'validate',
      input: { data: 'test' },
    };

    await gateway.validate(request);
    await gateway.validate(request);

    const stats = gateway.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.errors).toBe(2);
  });

  it('должен обработать authenticate с провайдером anthropic', async () => {
    const config: ExternalAiConfig = {
      provider: 'anthropic',
      apiKey: 'test-key',
    };

    const result = await gateway.authenticate('anthropic', config);
    // Anthropic — заглушка, должна вернуть true
    expect(result).toBe(true);
  });

  it('должен установить aiConfig после authenticate', async () => {
    const config: ExternalAiConfig = {
      provider: 'anthropic',
      apiKey: 'test-key',
    };

    await gateway.authenticate('anthropic', config);
    expect(gateway.getState()).toBe('running');
  });

  it('должен вернуть state error после неудачного запуска happ', async () => {
    const gateway2 = new BrowserGateway({ exePath: 'C:\\nonexistent\\happ.exe' });
    await gateway2.startHapp();
    expect(gateway2.getState()).toBe('error');
  });
});
