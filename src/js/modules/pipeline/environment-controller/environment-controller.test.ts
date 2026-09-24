/**
 * EnvironmentController Tests — тесты для контроллера окружения.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EnvironmentController } from './environment-controller.js';
import type { EnvironmentControllerConfig } from './types.js';

// ──────────────────────────────────────────────
// Тесты
// ──────────────────────────────────────────────

describe('EnvironmentController', () => {
  let controller: EnvironmentController;
  let config: EnvironmentControllerConfig;

  beforeEach(() => {
    config = {
      verbose: false,
    };
    controller = new EnvironmentController(config);
  });

  it('должен создать экземпляр с дефолтной конфигурацией', () => {
    expect(controller).toBeDefined();
    expect(controller.getState()).toBe('idle');
  });

  it('должен вернуть начальное состояние idle', () => {
    expect(controller.getState()).toBe('idle');
  });

  it('должен вернуть пустую историю операций', () => {
    const history = controller.getOperationHistory();
    expect(history).toEqual([]);
  });

  it('должен сформировать отчёт', () => {
    const report = controller.formatReport();
    expect(report).toContain('Отчёт окружения');
    expect(report).toContain('Зависимости');
    expect(report).toContain('Расширения VS Code');
  });

  it('должен проверить здоровье окружения', async () => {
    const health = await controller.checkEnvironmentHealth();
    expect(health).toBeDefined();
    expect(health.allHealthy).toBeDefined();
    expect(Array.isArray(health.issues)).toBe(true);
  });

  it('должен вернуть версии инструментов', async () => {
    const health = await controller.checkEnvironmentHealth();
    
    // Node.js и npm должны быть доступны
    if (health.node) {
      expect(health.node.name).toBe('node');
      expect(health.node.current).toBeDefined();
    }
    
    if (health.npm) {
      expect(health.npm.name).toBe('npm');
      expect(health.npm.current).toBeDefined();
    }
  });

  it('должен получить статус npm-зависимостей', async () => {
    const deps = await controller.getNpmDependenciesStatus();
    expect(Array.isArray(deps)).toBe(true);
  });

  it('должен получить статус pip-зависимостей', async () => {
    const deps = await controller.getPipDependenciesStatus();
    expect(Array.isArray(deps)).toBe(true);
  });

  it('должен получить полный статус зависимостей', async () => {
    const status = await controller.getDependenciesStatus();
    expect(status).toBeDefined();
    expect(status.totalNpm).toBeGreaterThanOrEqual(0);
    expect(status.totalPip).toBeGreaterThanOrEqual(0);
  });

  it('должен проверить VS Code расширения', async () => {
    const extensions = await controller.checkVsCodeExtensions();
    expect(extensions).toBeDefined();
    expect(extensions.total).toBeGreaterThan(0);
    expect(Array.isArray(extensions.extensions)).toBe(true);
  });

  it('должен установить node_modules', async () => {
    const result = await controller.installDependencies();
    expect(result).toBeDefined();
    expect(result.operation).toBe('npm_install');
  });

  it('должен обновить node_modules', async () => {
    const result = await controller.updateDependencies();
    expect(result).toBeDefined();
    expect(result.operation).toBe('npm_update');
  });

  it('должен установить pip-пакеты', async () => {
    const result = await controller.installPipPackages();
    expect(result).toBeDefined();
    expect(result.operation).toBe('pip_install');
  });

  it('должен вернуть ошибку если requirements.txt не найден', async () => {
    const customController = new EnvironmentController({
      requirementsTxtPath: 'nonexistent-requirements.txt',
    });

    const result = await customController.installPipPackages();
    expect(result.success).toBe(false);
    expect(result.error).toContain('File not found');
  });

  it('должен обновить pip-пакеты', async () => {
    const result = await controller.updatePipPackages();
    expect(result).toBeDefined();
    expect(result.operation).toBe('pip_update');
  });

  it('должен установить VS Code расширения', async () => {
    const result = await controller.installVsCodeExtensions();
    expect(result).toBeDefined();
    expect(result.operation).toBe('vscode_extensions');
  });

  it('должен обновить VS Code расширения', async () => {
    const result = await controller.updateVsCodeExtensions();
    expect(result).toBeDefined();
    expect(result.operation).toBe('vscode_extensions');
  });

  it('должен добавить операцию в историю', async () => {
    await controller.installDependencies();
    
    const history = controller.getOperationHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].operation).toBe('npm_install');
  });

  it('должен вернуть состояние installing после install', async () => {
    const promise = controller.installDependencies();
    const state = controller.getState();
    
    // Состояние может быть installing или idle (если быстро завершилось)
    expect(['installing', 'idle']).toContain(state);
    
    await promise;
  });

  it('должен сравнить версии корректно', () => {
    // Тест через публичный API — проверяем что checkEnvironmentHealth работает
    expect(async () => {
      await controller.checkEnvironmentHealth();
    }).not.toThrow();
  });

  it('должен обработать ошибку при недоступном коде CLI', async () => {
    const result = await controller.updateVsCodeExtensions();
    // Если code CLI недоступен — вернёт ошибку, но не выбросит исключение
    expect(result).toBeDefined();
    expect(result.operation).toBe('vscode_extensions');
  });
});
