/**
 * PackageAgent Tests — управление зависимостями npm/pip.
 *
 * Проверяются: формирование команд (install/update/uninstall), dry-run
 * (ничего не меняется и не выполняется), статический анализ конфликтов
 * package.json (dependencies/devDependencies/peerDependencies) и
 * requirements.txt, детерминированное авто-решение конфликтов, безопасность
 * путей манифеста, блокировка мутаций при error-конфликтах и делегирование
 * команд инжектированному TerminalAgent (реальный npm НЕ запускается).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AgentResult } from '../agent/types.js';
import { PackageAgent } from './package-agent.js';
import type { PackageAgentOutput, TerminalLike } from './package-agent.js';

// ─── Helpers ───────────────────────────────────────────────

function outputOf(result: { data?: unknown }): PackageAgentOutput {
  return result.data as PackageAgentOutput;
}

function errorMessageOf(result: { error?: Error }): string {
  return result.error?.message ?? '';
}

function createMockTerminal(): { terminal: TerminalLike; calls: string[] } {
  const calls: string[] = [];
  const terminal: TerminalLike = {
    async execute(input: unknown): Promise<AgentResult> {
      calls.push(typeof input === 'string' ? input : JSON.stringify(input));
      return {
        success: true,
        durationMs: 1,
        completedAt: new Date().toISOString(),
      };
    },
  };
  return { terminal, calls };
}

function createAgent(root: string, terminal?: TerminalLike): PackageAgent {
  return new PackageAgent(
    { name: 'PackageAgent' },
    { roots: [root], terminal },
  );
}

const BASE_MANIFEST: Record<string, unknown> = {
  name: 'test-proj',
  version: '1.0.0',
  private: true,
  dependencies: { lodash: '^4.17.21' },
  devDependencies: { typescript: '^5.0.0' },
};

function writeManifest(dir: string, manifest: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf-8',
  );
}

function readManifestRaw(dir: string): string {
  return fs.readFileSync(path.join(dir, 'package.json'), 'utf-8');
}

function readManifest(dir: string): Record<string, unknown> {
  return JSON.parse(readManifestRaw(dir)) as Record<string, unknown>;
}

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'package-agent-test-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── Формирование команд (dryRun) ─────────────────────────

describe('PackageAgent — команды (dryRun)', () => {
  it('install генерирует корректную npm-команду', async () => {
    writeManifest(tmp, BASE_MANIFEST);
    const { terminal, calls } = createMockTerminal();
    const result = await createAgent(tmp, terminal).execute({
      action: 'install',
      packages: ['lodash'],
      dryRun: true,
    });
    expect(result.success).toBe(true);
    const out = outputOf(result);
    expect(out.action).toBe('install');
    expect(out.manager).toBe('npm');
    expect(out.commands).toEqual(['npm install lodash']);
    expect(out.changed).toBe(false);
    expect(out.conflicts).toEqual([]);
    expect(calls).toEqual([]); // dry-run ничего не выполняет
  });

  it('install с dev: true добавляет --save-dev', async () => {
    writeManifest(tmp, BASE_MANIFEST);
    const result = await createAgent(tmp).execute({
      action: 'install',
      packages: ['vitest'],
      dev: true,
      dryRun: true,
    });
    expect(outputOf(result).commands).toEqual([
      'npm install vitest --save-dev',
    ]);
  });

  it('install pip формирует pip-команду', async () => {
    const result = await createAgent(tmp).execute({
      action: 'install',
      packages: ['numpy'],
      manager: 'pip',
      dryRun: true,
    });
    const out = outputOf(result);
    expect(out.manager).toBe('pip');
    expect(out.commands).toEqual(['pip install numpy']);
  });

  it('install pip без пакетов использует -r requirements.txt', async () => {
    const result = await createAgent(tmp).execute({
      action: 'install',
      manager: 'pip',
      dryRun: true,
    });
    expect(outputOf(result).commands).toEqual([
      'pip install -r requirements.txt',
    ]);
  });

  it('update формирует npm update / pip install --upgrade', async () => {
    const npmResult = await createAgent(tmp).execute({
      action: 'update',
      packages: ['lodash'],
      dryRun: true,
    });
    expect(outputOf(npmResult).commands).toEqual(['npm update lodash']);

    const pipResult = await createAgent(tmp).execute({
      action: 'update',
      packages: ['numpy'],
      manager: 'pip',
      dryRun: true,
    });
    expect(outputOf(pipResult).commands).toEqual([
      'pip install --upgrade numpy',
    ]);
  });

  it('uninstall формирует npm uninstall / pip uninstall -y', async () => {
    const npmResult = await createAgent(tmp).execute({
      action: 'uninstall',
      packages: ['lodash'],
      dryRun: true,
    });
    expect(outputOf(npmResult).commands).toEqual(['npm uninstall lodash']);

    const pipResult = await createAgent(tmp).execute({
      action: 'uninstall',
      packages: ['numpy'],
      manager: 'pip',
      dryRun: true,
    });
    expect(outputOf(pipResult).commands).toEqual(['pip uninstall -y numpy']);
  });

  it('uninstall без пакетов — ошибка', async () => {
    const result = await createAgent(tmp).execute({
      action: 'uninstall',
      dryRun: true,
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('хотя бы один пакет');
  });

  it('по умолчанию dryRun = true: план без изменений', async () => {
    writeManifest(tmp, BASE_MANIFEST);
    const { terminal, calls } = createMockTerminal();
    const result = await createAgent(tmp, terminal).execute({
      action: 'install',
      packages: ['lodash'],
    });
    expect(result.success).toBe(true);
    const out = outputOf(result);
    expect(out.changed).toBe(false);
    expect(calls).toEqual([]);
    expect(out.message).toContain('dry-run');
  });

  it('отклоняет имя пакета, похожее на флаг', async () => {
    const result = await createAgent(tmp).execute({
      action: 'install',
      packages: ['--force'],
      dryRun: true,
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('флаг');
  });
});

// ─── dryRun ничего не меняет ───────────────────────────────

describe('PackageAgent — dryRun ничего не меняет', () => {
  it('resolve-conflicts в dry-run не трогает файл и не вызывает терминал', async () => {
    const manifest: Record<string, unknown> = {
      name: 'test-proj',
      version: '1.0.0',
      dependencies: { react: '^18.2.0' },
      devDependencies: { react: '^19.0.0' },
    };
    writeManifest(tmp, manifest);
    const before = readManifestRaw(tmp);
    const { terminal, calls } = createMockTerminal();
    const result = await createAgent(tmp, terminal).execute({
      action: 'resolve-conflicts',
      dryRun: true,
    });
    expect(result.success).toBe(true);
    const out = outputOf(result);
    expect(out.changed).toBe(false);
    expect(out.resolved?.length).toBe(1);
    expect(readManifestRaw(tmp)).toBe(before);
    expect(calls).toEqual([]);
  });
});

// ─── Статическая проверка конфликтов ───────────────────────

describe('PackageAgent — проверка конфликтов (статически, без сети)', () => {
  it('пакет в dependencies и devDependencies с разными диапазонами → error', async () => {
    writeManifest(tmp, {
      name: 'test-proj',
      version: '1.0.0',
      dependencies: { react: '^18.2.0' },
      devDependencies: { react: '^19.0.0' },
    });
    const result = await createAgent(tmp).execute({
      action: 'check-conflicts',
    });
    expect(result.success).toBe(true);
    const out = outputOf(result);
    expect(out.conflicts).toHaveLength(1);
    const conflict = out.conflicts[0]!;
    expect(conflict.name).toBe('react');
    expect(conflict.sectionA).toBe('dependencies');
    expect(conflict.sectionB).toBe('devDependencies');
    expect(conflict.rangeA).toBe('^18.2.0');
    expect(conflict.rangeB).toBe('^19.0.0');
    expect(conflict.severity).toBe('error');
  });

  it('одинаковые диапазоны → warning (дублирование секций)', async () => {
    writeManifest(tmp, {
      name: 'test-proj',
      version: '1.0.0',
      dependencies: { react: '^18.2.0' },
      devDependencies: { react: '^18.2.0' },
    });
    const result = await createAgent(tmp).execute({
      action: 'check-conflicts',
    });
    const out = outputOf(result);
    expect(out.conflicts).toHaveLength(1);
    // Выбранный контракт: идентичные диапазоны = предупреждение о дублировании
    expect(out.conflicts[0]!.severity).toBe('warning');
    expect(out.conflicts[0]!.resolution).toContain('Дублирование');
  });

  it('несоответствие peerDependencies → warning (ограничение статики)', async () => {
    writeManifest(tmp, {
      name: 'test-proj',
      version: '1.0.0',
      dependencies: { react: '^18.2.0' },
      peerDependencies: { react: '^19.0.0' },
    });
    const result = await createAgent(tmp).execute({
      action: 'check-conflicts',
    });
    const out = outputOf(result);
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0]!.sectionA).toBe('peerDependencies');
    expect(out.conflicts[0]!.severity).toBe('warning');
    expect(out.conflicts[0]!.resolution).toContain('Статическая');
  });

  it('совпадающий peer-диапазон → конфликта нет', async () => {
    writeManifest(tmp, {
      name: 'test-proj',
      version: '1.0.0',
      dependencies: { react: '^18.2.0' },
      peerDependencies: { react: '^18.2.0' },
    });
    const result = await createAgent(tmp).execute({
      action: 'check-conflicts',
    });
    expect(outputOf(result).conflicts).toEqual([]);
  });

  it('без конфликтов возвращает пустой список', async () => {
    writeManifest(tmp, BASE_MANIFEST);
    const result = await createAgent(tmp).execute({
      action: 'check-conflicts',
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).conflicts).toEqual([]);
    expect(outputOf(result).message).toContain('не обнаружены');
  });

  it('pip: дубликат с разными спецификаторами → error', async () => {
    fs.writeFileSync(
      path.join(tmp, 'requirements.txt'),
      'numpy>=2.2,<3.0\nnumpy>=1.26\n',
      'utf-8',
    );
    const result = await createAgent(tmp).execute({
      action: 'check-conflicts',
      manager: 'pip',
    });
    const out = outputOf(result);
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0]!.name).toBe('numpy');
    expect(out.conflicts[0]!.severity).toBe('error');
    expect(out.conflicts[0]!.rangeA).toBe('>=2.2,<3.0');
    expect(out.conflicts[0]!.rangeB).toBe('>=1.26');
  });

  it('pip: одинаковые записи → warning', async () => {
    fs.writeFileSync(
      path.join(tmp, 'requirements.txt'),
      'requests>=2.31,<3.0\nrequests>=2.31,<3.0\n',
      'utf-8',
    );
    const result = await createAgent(tmp).execute({
      action: 'check-conflicts',
      manager: 'pip',
    });
    expect(outputOf(result).conflicts[0]!.severity).toBe('warning');
  });
});

// ─── Авто-решение конфликтов ───────────────────────────────

describe('PackageAgent — resolve-conflicts (детерминированное слияние)', () => {
  it('объединяет в секцию с новейшим диапазоном (dryRun)', async () => {
    writeManifest(tmp, {
      name: 'test-proj',
      version: '1.0.0',
      dependencies: { react: '^18.0.0' },
      devDependencies: { react: '^19.0.0' },
    });
    const result = await createAgent(tmp).execute({
      action: 'resolve-conflicts',
      dryRun: true,
    });
    expect(result.success).toBe(true);
    const out = outputOf(result);
    expect(out.conflicts[0]!.severity).toBe('error');
    expect(out.resolved).toHaveLength(1);
    const resolution = out.resolved![0]!.resolution ?? '';
    expect(resolution).toContain('devDependencies'); // новейший диапазон ^19
    expect(resolution).toContain('^19.0.0');
    expect(out.commands).toEqual(['npm install']); // предложение, не запуск
    expect(out.changed).toBe(false);
  });

  it('применяет слияние при dryRun: false и пишет package.json', async () => {
    writeManifest(tmp, {
      name: 'test-proj',
      version: '1.0.0',
      dependencies: { react: '^18.0.0', lodash: '^4.17.21' },
      devDependencies: { react: '^19.0.0', typescript: '^5.0.0' },
    });
    const { terminal, calls } = createMockTerminal();
    const result = await createAgent(tmp, terminal).execute({
      action: 'resolve-conflicts',
      dryRun: false,
    });
    expect(result.success).toBe(true);
    const out = outputOf(result);
    expect(out.changed).toBe(true);
    expect(calls).toEqual([]); // npm install только предложен, НЕ запущен

    const merged = readManifest(tmp);
    const deps = merged['dependencies'] as Record<string, unknown>;
    const devDeps = merged['devDependencies'] as Record<string, unknown>;
    expect(deps['react']).toBeUndefined();
    expect(devDeps['react']).toBe('^19.0.0');
    expect(deps['lodash']).toBe('^4.17.21');
    expect(devDeps['typescript']).toBe('^5.0.0');
  });

  it('одинаковые диапазоны: оставляет пакет в dependencies', async () => {
    writeManifest(tmp, {
      name: 'test-proj',
      version: '1.0.0',
      dependencies: { react: '^18.2.0' },
      devDependencies: { react: '^18.2.0' },
    });
    const result = await createAgent(tmp).execute({
      action: 'resolve-conflicts',
      dryRun: false,
    });
    const out = outputOf(result);
    const resolution = out.resolved?.[0]?.resolution ?? '';
    expect(resolution).toContain('dependencies');

    const merged = readManifest(tmp);
    const deps = merged['dependencies'] as Record<string, unknown>;
    // Секция devDependencies опустела после слияния и была удалена целиком
    expect(merged['devDependencies']).toBeUndefined();
    expect(deps['react']).toBe('^18.2.0');
  });

  it('результат детерминирован для одинаковых входов', async () => {
    const fixture: Record<string, unknown> = {
      name: 'test-proj',
      version: '1.0.0',
      dependencies: { react: '^18.0.0', vue: '^3.3.0' },
      devDependencies: { react: '^19.0.0', vue: '^3.4.0' },
    };
    writeManifest(tmp, fixture);
    const first = await createAgent(tmp).execute({
      action: 'resolve-conflicts',
      dryRun: true,
    });
    const second = await createAgent(tmp).execute({
      action: 'resolve-conflicts',
      dryRun: true,
    });
    expect(JSON.stringify(outputOf(first).resolved)).toBe(
      JSON.stringify(outputOf(second).resolved),
    );
  });
});

// ─── Безопасность и ошибки ─────────────────────────────────

describe('PackageAgent — безопасность и ошибки', () => {
  it('отсутствующий package.json → понятная ошибка', async () => {
    const result = await createAgent(tmp).execute({
      action: 'check-conflicts',
    });
    expect(result.success).toBe(false);
    const message = errorMessageOf(result);
    expect(message).toContain('package.json');
    expect(message).toContain('не найден');
  });

  it('resolve-conflicts без package.json → ошибка', async () => {
    const result = await createAgent(tmp).execute({
      action: 'resolve-conflicts',
      dryRun: true,
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('не найден');
  });

  it('cwd вне разрешённых корней → ошибка', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-roots-'));
    try {
      const result = await createAgent(tmp).execute({
        action: 'check-conflicts',
        cwd: outside,
      });
      expect(result.success).toBe(false);
      expect(errorMessageOf(result)).toContain('вне разрешённых корней');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('npm install (не dry-run) при error-конфликтах блокируется', async () => {
    writeManifest(tmp, {
      name: 'test-proj',
      version: '1.0.0',
      dependencies: { react: '^18.2.0' },
      devDependencies: { react: '^19.0.0' },
    });
    const { terminal, calls } = createMockTerminal();
    const result = await createAgent(tmp, terminal).execute({
      action: 'install',
      packages: ['lodash'],
      dryRun: false,
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('resolve-conflicts');
    expect(calls).toEqual([]);
  });

  it('npm install (dryRun) при error-конфликтах возвращает план', async () => {
    writeManifest(tmp, {
      name: 'test-proj',
      version: '1.0.0',
      dependencies: { react: '^18.2.0' },
      devDependencies: { react: '^19.0.0' },
    });
    const result = await createAgent(tmp).execute({
      action: 'install',
      packages: ['lodash'],
      dryRun: true,
    });
    expect(result.success).toBe(true);
    const out = outputOf(result);
    expect(out.commands).toEqual(['npm install lodash']);
    expect(out.conflicts[0]!.severity).toBe('error');
  });
});

// ─── Выполнение через TerminalAgent ─────────────────────────

describe('PackageAgent — выполнение через TerminalAgent', () => {
  it('не запускает npm напрямую: команда уходит в инжектированный терминал', async () => {
    writeManifest(tmp, BASE_MANIFEST);
    const { terminal, calls } = createMockTerminal();
    const result = await createAgent(tmp, terminal).execute({
      action: 'install',
      packages: ['lodash'],
      dryRun: false,
    });
    expect(result.success).toBe(true);
    expect(calls).toEqual(['npm install lodash']);
    expect(outputOf(result).changed).toBe(true);
  });

  it('неуспешная команда терминала → ошибка агента', async () => {
    writeManifest(tmp, BASE_MANIFEST);
    const failingTerminal: TerminalLike = {
      async execute(): Promise<AgentResult> {
        return {
          success: false,
          error: new Error('exit code 1'),
          durationMs: 1,
          completedAt: new Date().toISOString(),
        };
      },
    };
    const result = await createAgent(tmp, failingTerminal).execute({
      action: 'install',
      packages: ['lodash'],
      dryRun: false,
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('не выполнена');
  });
});
