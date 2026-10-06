import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ActionAgentRegistry,
  createActionAgentFactory,
  createDefaultActionAgents,
  type ActionAgentRole,
} from './agent-factory.js';
import { FileAgent } from './file-agent.js';
import { TerminalAgent } from './terminal-agent.js';

// ─── Реестр: роли, lazy-создание, кэш ────────────────────────────────

describe('agent-factory: реестр action-агентов', () => {
  let registry: ActionAgentRegistry;

  beforeEach(() => {
    registry = createActionAgentFactory();
  });

  it('создаёт базовый набор { file, terminal } для Director', () => {
    const agents = createDefaultActionAgents();
    expect(agents.file).toBeInstanceOf(FileAgent);
    expect(agents.terminal).toBeInstanceOf(TerminalAgent);
  });

  it('регистрирует базовые и инфраструктурные роли', () => {
    const roles: ActionAgentRole[] = registry.listRoles();
    expect(roles).toContain('file');
    expect(roles).toContain('terminal');
    expect(roles).toContain('package');
    expect(roles).toContain('browser');
    expect(roles).toContain('config');
    expect(roles).toContain('process');
    expect(roles).toContain('scheduler');
    expect(roles).toContain('learning');
    expect(roles).toContain('auto-repair');
    expect(registry.has('file')).toBe(true);
  });

  it('lazy-создание: экземпляр строится один раз и кэшируется', () => {
    const first = registry.get<FileAgent>('file');
    const second = registry.get<FileAgent>('file');
    expect(first).toBe(second);
  });

  it('выбрасывает ошибку для неизвестной роли', () => {
    expect(() => registry.get('unknown' as ActionAgentRole)).toThrowError(
      /Неизвестная роль action-агента/,
    );
  });

  it('создаёт инфраструктурных агентов по ролям', () => {
    expect(registry.get('package')).toBeDefined();
    expect(registry.get('browser')).toBeDefined();
    expect(registry.get('config')).toBeDefined();
    expect(registry.get('process')).toBeDefined();
    expect(registry.get('auto-repair')).toBeDefined();
  });
});

// ─── Корни и таймауты по умолчанию ───────────────────────────────────

describe('agent-factory: безопасные корни по умолчанию', () => {
  it('по умолчанию использует process.cwd() как корень', () => {
    const { terminal } = createDefaultActionAgents();
    const agent = terminal as TerminalAgent;
    expect(agent.getWorkingDirectory()).toBe(path.resolve(process.cwd()));
  });

  it('учитывает переданные корни', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-roots-'));
    try {
      const { terminal } = createDefaultActionAgents({ roots: [tmp] });
      const agent = terminal as TerminalAgent;
      expect(agent.getWorkingDirectory()).toBe(path.resolve(tmp));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('FileAgent читает файл внутри корня (реальная операция)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-file-'));
    try {
      const target = path.join(tmp, 'hello.txt');
      fs.writeFileSync(target, 'привет', 'utf-8');

      const { file } = createDefaultActionAgents({ roots: [tmp] });
      const result = await file!.execute({
        action: 'read',
        path: 'hello.txt',
      });
      expect(result.success).toBe(true);
      const output = result.data as { message?: string };
      expect(output.message).toContain('Прочитано');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
