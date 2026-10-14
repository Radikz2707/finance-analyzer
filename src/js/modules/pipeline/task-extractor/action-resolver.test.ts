/**
 * ActionResolver — тесты маппинга извлечённой задачи на роли и входы.
 */

import { resolveTaskAction } from './action-resolver.js';
import type { ExtractedTask } from './types.js';

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

// ─── Маппинг ролей ─────────────────────────────────────────────────

describe('resolveTaskAction: роли агентов', () => {
  it('file → FileAgent', () => {
    const resolved = resolveTaskAction(
      makeTask('file', 'src/test.ts', { action: 'write' }),
    );

    expect(resolved.roles).toEqual(['file']);
  });

  it('terminal → TerminalAgent', () => {
    const resolved = resolveTaskAction(
      makeTask('terminal', 'npm run test', {
        command: 'npm',
        args: ['run', 'test'],
      }),
    );

    expect(resolved.roles).toEqual(['terminal']);
  });

  it('code → CodingWorkflow', () => {
    const resolved = resolveTaskAction(
      makeTask('code', 'src/js/modules/x/y.ts', {
        files: ['src/js/modules/x/y.ts'],
      }),
    );

    expect(resolved.roles).toEqual(['code']);
  });

  it('package → PackageAgent', () => {
    const resolved = resolveTaskAction(
      makeTask('package', 'lodash', {
        action: 'install',
        manager: 'npm',
        packages: ['lodash'],
      }),
    );

    expect(resolved.roles).toEqual(['package']);
  });

  it('process → ProcessAgent', () => {
    const resolved = resolveTaskAction(
      makeTask('process', 'build', { action: 'restart', name: 'build' }),
    );

    expect(resolved.roles).toEqual(['process']);
  });

  it('process со scope=system → SystemResourceAgent', () => {
    const resolved = resolveTaskAction(
      makeTask('process', 'system', { action: 'status', scope: 'system' }),
    );

    expect(resolved.roles).toEqual(['system']);
  });

  it('automation → AutomationAgent', () => {
    const resolved = resolveTaskAction(
      makeTask('automation', 'nightly', {
        action: 'run-now',
        params: { templateId: 'nightly' },
      }),
    );

    expect(resolved.roles).toEqual(['automation']);
  });

  it('research → ResearchAgent + AI', () => {
    const resolved = resolveTaskAction(makeTask('research', 'SBER'));

    expect(resolved.roles).toEqual(['research', 'ai']);
  });

  it('portfolio → Analysis + AI + Strategist', () => {
    const resolved = resolveTaskAction(makeTask('portfolio', 'портфель'));

    expect(resolved.roles).toEqual(['analysis', 'ai', 'strategist']);
  });

  it('goal → без ролей (обрабатывается goalIntake)', () => {
    const resolved = resolveTaskAction(makeTask('goal', 'покрыть тестами'));

    expect(resolved.roles).toEqual([]);
  });
});

// ─── Входы для action-input-builder ────────────────────────────────

describe('resolveTaskAction: входы для action-input-builder', () => {
  it('file: FileAgentInput {action, path, toPath?}', () => {
    const resolved = resolveTaskAction(
      makeTask('file', 'src/a.ts', { action: 'rename', toPath: 'src/b.ts' }),
    );
    const input = resolved.input as {
      action: string;
      path: string;
      toPath?: string;
    };

    expect(input.action).toBe('rename');
    expect(input.path).toBe('src/a.ts');
    expect(input.toPath).toBe('src/b.ts');
  });

  it('terminal: TerminalAgentInput {command, args}', () => {
    const resolved = resolveTaskAction(
      makeTask('terminal', 'npm run test', {
        command: 'npm',
        args: ['run', 'test'],
      }),
    );
    const input = resolved.input as { command: string; args: string[] };

    expect(input.command).toBe('npm');
    expect(input.args).toEqual(['run', 'test']);
  });

  it('code: CodingWorkflowInput {task, files}', () => {
    const resolved = resolveTaskAction(
      makeTask('code', 'src/js/modules/x/y.ts', {
        files: ['src/js/modules/x/y.ts'],
      }),
    );
    const input = resolved.input as {
      task: string;
      files: Array<{ path: string; content: string }>;
    };

    expect(input.files).toHaveLength(1);
    expect(input.files[0]!.path).toBe('src/js/modules/x/y.ts');
    expect(input.task).toContain('тестовая задача');
  });

  it('package: PackageAgentInput {action, manager, packages, dryRun}', () => {
    const resolved = resolveTaskAction(
      makeTask('package', 'lodash', {
        action: 'install',
        manager: 'npm',
        packages: ['lodash'],
      }),
    );
    const input = resolved.input as {
      action: string;
      manager: string;
      packages: string[];
      dryRun: boolean;
    };

    expect(input.action).toBe('install');
    expect(input.manager).toBe('npm');
    expect(input.packages).toEqual(['lodash']);
    expect(input.dryRun).toBe(false);
  });

  it('process: ProcessAgentInput {action, name}', () => {
    const resolved = resolveTaskAction(
      makeTask('process', 'build', { action: 'restart', name: 'build' }),
    );
    const input = resolved.input as { action: string; name: string };

    expect(input.action).toBe('restart');
    expect(input.name).toBe('build');
  });

  it('system: SystemResourceInput {action: status}', () => {
    const resolved = resolveTaskAction(
      makeTask('process', 'system', { action: 'status', scope: 'system' }),
    );
    const input = resolved.input as { action: string };

    expect(input.action).toBe('status');
  });

  it('automation: AutomationAgentInput {action, params}', () => {
    const resolved = resolveTaskAction(
      makeTask('automation', 'nightly', {
        action: 'run-now',
        params: { templateId: 'nightly' },
      }),
    );
    const input = resolved.input as {
      action: string;
      params: { templateId: string };
    };

    expect(input.action).toBe('run-now');
    expect(input.params.templateId).toBe('nightly');
  });
});

// ─── Описания ──────────────────────────────────────────────────────

describe('resolveTaskAction: описания задач', () => {
  it('описание содержит действие и цель', () => {
    const resolved = resolveTaskAction(
      makeTask('file', 'src/test.ts', { action: 'write' }),
    );

    expect(resolved.description).toContain('Файловая операция');
    expect(resolved.description).toContain('src/test.ts');
  });

  it('описание research содержит цель', () => {
    const resolved = resolveTaskAction(makeTask('research', 'SBER'));

    expect(resolved.description).toContain('Исследование');
    expect(resolved.description).toContain('SBER');
  });
});
