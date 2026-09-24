/**
 * EnvironmentController — контроллер окружения проекта.
 *
 * Архитектура:
 *   [Director] → [EnvironmentController] → [npm/pip/vscode CLI]
 *
 * Функции:
 * 1. Проверка версий инструментов (Node.js, Python, npm, pip)
 * 2. Установка/обновление node_modules
 * 3. Установка/обновление pip-пакетов
 * 4. Управление VS Code расширениями
 * 5. CLI-интерфейс для Director
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import type {
  ControllerState,
  EnvironmentOperation,
  EnvironmentHealth,
  ToolVersion,
  DependenciesStatus,
  NpmDependency,
  PipDependency,
  VsCodeExtension,
  ExtensionsStatus,
  OperationResult,
  EnvironmentControllerConfig,
} from './types.js';
import { DEFAULT_REQUIRED_EXTENSIONS, DEFAULT_PACKAGE_MANAGER } from './types.js';

// ──────────────────────────────────────────────
// EnvironmentController
// ──────────────────────────────────────────────

/**
 * EnvironmentController — контроллер окружения.
 */
export class EnvironmentController {
  private _state: ControllerState = 'idle';
  private config: Required<EnvironmentControllerConfig>;
  private operationHistory: OperationResult[] = [];

  constructor(config?: EnvironmentControllerConfig) {
    this.config = {
      packageJsonPath: config?.packageJsonPath ?? 'package.json',
      requirementsTxtPath: config?.requirementsTxtPath ?? 'requirements.txt',
      vscodeCliPath: config?.vscodeCliPath ?? 'code',
      requiredExtensions: config?.requiredExtensions ?? DEFAULT_REQUIRED_EXTENSIONS,
      packageManager: config?.packageManager ?? DEFAULT_PACKAGE_MANAGER,
      verbose: config?.verbose ?? false,
    };
  }

  /**
   * Проверить здоровье окружения (версии инструментов).
   */
  async checkEnvironmentHealth(): Promise<EnvironmentHealth> {
    this._state = 'checking';
    const issues: string[] = [];

    const nodeVersion = await this.checkToolVersion('node', '--version', '>=18.0.0');
    const npmVersion = await this.checkToolVersion('npm', '--version', '>=9.0.0');
    const pythonVersion = await this.checkToolVersion('python', '--version', '>=3.10');
    const pipVersion = await this.checkToolVersion('pip', '--version', '>=23.0');

    const health: EnvironmentHealth = {
      node: nodeVersion ?? undefined,
      npm: npmVersion ?? undefined,
      python: pythonVersion ?? undefined,
      pip: pipVersion ?? undefined,
      allHealthy: true,
      issues,
    };

    const nodeOk = !nodeVersion || nodeVersion.matches;
    const npmOk = !npmVersion || npmVersion.matches;
    const pythonOk = !pythonVersion || pythonVersion.matches;
    const pipOk = !pipVersion || pipVersion.matches;
    health.allHealthy = nodeOk && npmOk && pythonOk && pipOk;

    if (!health.allHealthy) {
      issues.push('One or more tools do not meet version requirements');
    }

    this._state = 'idle';
    return health;
  }

  /**
   * Проверить версию инструмента.
   */
  private checkToolVersion(
    name: string,
    versionFlag: string,
    minVersion: string,
  ): ToolVersion | null {
    try {
      const result = execSync(`${name} ${versionFlag}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const current = result.replace(/[vV]/, '');
      const matches = this.compareVersions(current, minVersion.slice(2));

      return {
        name,
        current,
        matches,
      };
    } catch {
      return null;
    }
  }

  /**
   * Сравнить версии (простая реализация).
   */
  private compareVersions(current: string, required: string): boolean {
    const currentParts = current.split('.').map(Number);
    const requiredParts = required.split('.').map(Number);

    for (let i = 0; i < Math.max(currentParts.length, requiredParts.length); i++) {
      const curr = currentParts[i] ?? 0;
      const req = requiredParts[i] ?? 0;

      if (curr > req) return true;
      if (curr < req) return false;
    }

    return true;
  }

  /**
   * Установить node_modules.
   */
  async installDependencies(): Promise<OperationResult> {
    return this.runOperation('npm_install', async () => {
      const pm = this.config.packageManager;
      const command = pm === 'yarn' ? 'yarn' : pm === 'pnpm' ? 'pnpm install' : 'npm install';

      return await this.executeCommand(command, {
        success: true,
        operation: 'npm_install',
        message: `${pm} install completed successfully`,
      });
    });
  }

  /**
   * Обновить node_modules.
   */
  async updateDependencies(): Promise<OperationResult> {
    return this.runOperation('npm_update', async () => {
      const pm = this.config.packageManager;
      const command = pm === 'yarn' ? 'yarn upgrade' : pm === 'pnpm' ? 'pnpm update' : 'npm update';

      return await this.executeCommand(command, {
        success: true,
        operation: 'npm_update',
        message: `${pm} update completed successfully`,
      });
    });
  }

  /**
   * Получить статус npm-зависимостей.
   */
  async getNpmDependenciesStatus(): Promise<NpmDependency[]> {
    try {
      const result = execSync('npm outdated --json', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const data = JSON.parse(result);
      const deps: NpmDependency[] = [];

      for (const [name, info] of Object.entries(data)) {
        const typedInfo = info as { current: string; wanted: string; latest: string };
        deps.push({
          name,
          current: typedInfo.current,
          latest: typedInfo.latest,
          needsUpdate: typedInfo.wanted !== typedInfo.latest,
        });
      }

      return deps;
    } catch {
      return [];
    }
  }

  /**
   * Установить pip-пакеты.
   */
  async installPipPackages(): Promise<OperationResult> {
    return this.runOperation('pip_install', async () => {
      const reqFile = this.config.requirementsTxtPath;

      if (!existsSync(reqFile)) {
        return {
          success: false,
          operation: 'pip_install',
          message: `Requirements file not found: ${reqFile}`,
          durationMs: 0,
          error: `File not found: ${reqFile}`,
        };
      }

      return await this.executeCommand(`pip install -r ${reqFile}`, {
        success: true,
        operation: 'pip_install',
        message: 'pip install completed successfully',
      });
    });
  }

  /**
   * Обновить pip-пакеты.
   */
  async updatePipPackages(): Promise<OperationResult> {
    return this.runOperation('pip_update', async () => {
      return await this.executeCommand('pip list --outdated --format=json', {
        success: true,
        operation: 'pip_update',
        message: 'pip list outdated completed',
      });
    });
  }

  /**
   * Получить статус pip-зависимостей.
   */
  async getPipDependenciesStatus(): Promise<PipDependency[]> {
    try {
      const result = execSync('pip list --outdated --format=json', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const data = JSON.parse(result);
      const deps: PipDependency[] = [];

      for (const item of data as Array<{ package: string; version: string; latestVersion: string }>) {
        deps.push({
          name: item.package,
          current: item.version,
          latest: item.latestVersion,
          needsUpdate: item.version !== item.latestVersion,
        });
      }

      return deps;
    } catch {
      return [];
    }
  }

  /**
   * Получить полный статус зависимостей.
   */
  async getDependenciesStatus(): Promise<DependenciesStatus> {
    const [npmDeps, pipDeps] = await Promise.all([
      this.getNpmDependenciesStatus(),
      this.getPipDependenciesStatus(),
    ]);

    return {
      npm: npmDeps,
      pip: pipDeps,
      totalNpm: npmDeps.length,
      totalPip: pipDeps.length,
      npmUpdatesNeeded: npmDeps.filter((d) => d.needsUpdate).length,
      pipUpdatesNeeded: pipDeps.filter((d) => d.needsUpdate).length,
    };
  }

  /**
   * Проверить VS Code расширения.
   */
  async checkVsCodeExtensions(): Promise<ExtensionsStatus> {
    const extensions: VsCodeExtension[] = [];
    let installed = 0;
    const outdated = 0;
    let missing = 0;

    for (const extId of this.config.requiredExtensions) {
      try {
        const result = execSync('code --list-extensions --show-versions 2>/dev/null', {
          encoding: 'utf-8',
        });

        const installedExts = result.split('\n').map((line) => line.trim());
        const isInstalled = installedExts.includes(extId);

        if (isInstalled) {
          installed++;

          // Проверить версию (упрощённо)
          extensions.push({
            id: extId,
            name: extId.split('.').pop() ?? extId,
            currentVersion: 'installed',
            latestVersion: 'latest',
            needsUpdate: false,
            installed: true,
          });
        } else {
          missing++;
          extensions.push({
            id: extId,
            name: extId.split('.').pop() ?? extId,
            currentVersion: 'not-installed',
            latestVersion: 'latest',
            needsUpdate: false,
            installed: false,
          });
        }
      } catch {
        missing++;
        extensions.push({
          id: extId,
          name: extId.split('.').pop() ?? extId,
          currentVersion: 'unknown',
          latestVersion: 'latest',
          needsUpdate: false,
          installed: false,
        });
      }
    }

    return {
      extensions,
      total: this.config.requiredExtensions.length,
      installed,
      outdated,
      missing,
    };
  }

  /**
   * Установить VS Code расширения.
   */
  async installVsCodeExtensions(): Promise<OperationResult> {
    return this.runOperation('vscode_extensions', async () => {
      let installedCount = 0;
      let failedCount = 0;

      for (const extId of this.config.requiredExtensions) {
        try {
          execSync(`code --install-extension ${extId}`, {
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          installedCount++;

          if (this.config.verbose) {
            console.log(`[EnvController] Installed extension: ${extId}`);
          }
        } catch {
          failedCount++;
          if (this.config.verbose) {
            console.warn(`[EnvController] Failed to install extension: ${extId}`);
          }
        }
      }

      return {
        success: failedCount === 0,
        operation: 'vscode_extensions',
        message: `Installed ${installedCount}/${this.config.requiredExtensions.length} extensions`,
        durationMs: 0,
      };
    });
  }

  /**
   * Обновить VS Code расширения.
   */
  async updateVsCodeExtensions(): Promise<OperationResult> {
    return this.runOperation('vscode_extensions', async () => {
      try {
        execSync('code --update-extensions', {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        return {
          success: true,
          operation: 'vscode_extensions',
          message: 'VS Code extensions updated',
          durationMs: 0,
        };
      } catch {
        return {
          success: false,
          operation: 'vscode_extensions',
          message: 'Failed to update VS Code extensions',
          durationMs: 0,
          error: 'code CLI not available or update failed',
        };
      }
    });
  }

  /**
   * Получить состояние.
   */
  getState(): ControllerState {
    return this._state;
  }

  /**
   * Получить историю операций.
   */
  getOperationHistory(): OperationResult[] {
    return [...this.operationHistory];
  }

  /**
   * Сформировать отчёт для Director.
   */
  formatReport(): string {
    let text = '<b>🔧 Отчёт окружения:</b>\n\n';

    text += '<b>📦 Зависимости:</b>\n';
    text += `  npm: ${this.operationHistory.filter((o) => o.operation === 'npm_install' || o.operation === 'npm_update').length} операций\n`;
    text += `  pip: ${this.operationHistory.filter((o) => o.operation === 'pip_install' || o.operation === 'pip_update').length} операций\n`;

    text += '\n<b>🔌 Расширения VS Code:</b>\n';
    text += `  Установлено: ${this.operationHistory.filter((o) => o.operation === 'vscode_extensions' && o.success).length} успешно\n`;

    text += '\n<b>📊 Статус:</b>\n';
    text += `  Состояние: ${this._state}\n`;

    return text;
  }

  // ── Helpers ──

  /**
   * Выполнить операцию с таймингом.
   */
  private async runOperation(
    operation: EnvironmentOperation,
    execute: () => Promise<OperationResult>,
  ): Promise<OperationResult> {
    this._state = operation === 'vscode_extensions' ? 'checking' : 'installing';
    const startTime = Date.now();

    try {
      const result = await execute();
      result.durationMs = Date.now() - startTime;

      this.operationHistory.push(result);

      if (this.config.verbose) {
        console.log(`[EnvController] ${operation}: ${result.message}`);
      }

      this._state = 'idle';
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const result: OperationResult = {
        success: false,
        operation,
        message: `Operation failed: ${errorMsg}`,
        durationMs: Date.now() - startTime,
        error: errorMsg,
      };

      this.operationHistory.push(result);
      this._state = 'error';
      return result;
    }
  }

  /**
   * Выполнить команду.
   */
  private executeCommand(
    command: string,
    successResult: Omit<OperationResult, 'durationMs' | 'stdout'>,
  ): Promise<OperationResult> {
    return new Promise((resolve) => {
      try {
        const stdout = execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        resolve({
          ...successResult,
          durationMs: 0,
          stdout: stdout.trim(),
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        resolve({
          ...successResult,
          success: false,
          durationMs: 0,
          error: errorMsg,
        });
      }
    });
  }
}
