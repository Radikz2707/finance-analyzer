/**
 * AutoRepairAgent Tests — диагностика и авто-ремонт проекта.
 *
 * Все тесты работают на temp-директориях (реальная ФС), терминал — DI-мок,
 * реальный npm/git не вызывается. Проверяются: диагностика deps/configs/
 * integrity/history, ремонт с autoFix (env из шаблона, data-json с бэкапом,
 * npm install, git checkout), health-агрегация и изоляция чекеров.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AutoRepairAgent, createFsFileOps } from './auto-repair-agent.js';
import type {
  AutoRepairAgentOptions,
  AutoRepairOutput,
  FileOpsLike,
  HealthCheckResult,
} from './auto-repair-agent.js';
import type { TerminalLike } from './package-agent.js';

// ─── Helpers ───────────────────────────────────────────────

/** Запись вызова терминала */
interface TerminalCall {
  command: string;
  args: string[];
}

/** Мок терминала: записывает вызовы, всегда успешен */
function createMockTerminal(calls: TerminalCall[]): TerminalLike {
  return {
    async execute(input: unknown) {
      const parsed = input as { command?: string; args?: string[] };
      calls.push({ command: parsed.command ?? '', args: parsed.args ?? [] });
      return {
        success: true,
        durationMs: 1,
        completedAt: new Date().toISOString(),
      };
    },
  };
}

function outputOf(result: { data?: unknown }): AutoRepairOutput {
  return result.data as AutoRepairOutput;
}

function findCheck(
  checks: readonly HealthCheckResult[],
  id: string,
): HealthCheckResult | undefined {
  return checks.find((check) => check.id === id);
}

function createAgent(
  root: string,
  options: AutoRepairAgentOptions = {},
): AutoRepairAgent {
  return new AutoRepairAgent(
    { name: 'AutoRepairAgent' },
    { roots: [root], ...options },
  );
}

/** Стандартный «здоровый» проект в temp-каталоге */
function writeHealthyProject(root: string): void {
  fs.mkdirSync(path.join(root, 'src', 'js'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    '{"name":"tmp","version":"1.0.0"}',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(root, 'package-lock.json'),
    '{"lockfileVersion":3,"packages":{}}',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(root, '.env.template'),
    'API_KEY=template-key\n',
    'utf-8',
  );
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=real-key\n', 'utf-8');
  fs.writeFileSync(
    path.join(root, 'src', 'js', 'app.ts'),
    'export const ok = true;\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'index.html'),
    '<html></html>',
    'utf-8',
  );
  fs.writeFileSync(path.join(root, 'gulpfile.js'), '// gulpfile\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'data', 'ok.json'), '{"a":1}', 'utf-8');
  fs.writeFileSync(path.join(root, 'node_modules', '.keep'), '', 'utf-8');
}

// ──────────────────────────────────────────────
// diagnose: deps
// ──────────────────────────────────────────────

describe('AutoRepairAgent — diagnose: deps', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autorepair-deps-'));
    writeHealthyProject(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('node_modules отсутствует → warning + fixable (npm install)', async () => {
    fs.rmSync(path.join(tmp, 'node_modules'), { recursive: true, force: true });

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'diagnose', scope: 'deps' });
    expect(result.success).toBe(true);

    const check = findCheck(outputOf(result).checks, 'deps.node-modules');
    expect(check?.severity).toBe('warning');
    expect(check?.fixable).toBe(true);
    expect(check?.fix?.kind).toBe('terminal');
    expect(check?.fix?.command).toBe('npm');
    expect(check?.fix?.args).toContain('install');
    expect(outputOf(result).overall).toBe('warnings');
  });

  it('node_modules пуст → warning + fixable', async () => {
    fs.rmSync(path.join(tmp, 'node_modules'), { recursive: true, force: true });
    fs.mkdirSync(path.join(tmp, 'node_modules'));

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'diagnose', scope: 'deps' });
    expect(result.success).toBe(true);
    expect(
      findCheck(outputOf(result).checks, 'deps.node-modules')?.severity,
    ).toBe('warning');
  });

  it('node_modules присутствует → ok', async () => {
    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'diagnose', scope: 'deps' });
    expect(result.success).toBe(true);

    const check = findCheck(outputOf(result).checks, 'deps.node-modules');
    expect(check?.severity).toBe('info');
    expect(check?.fixable).toBe(false);
    expect(outputOf(result).overall).toBe('ok');
  });

  it('package-lock.json отсутствует → warning + fixable (npm install)', async () => {
    fs.rmSync(path.join(tmp, 'package-lock.json'), { force: true });

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'diagnose', scope: 'deps' });
    expect(result.success).toBe(true);

    const check = findCheck(outputOf(result).checks, 'deps.lock-file');
    expect(check?.severity).toBe('warning');
    expect(check?.fixable).toBe(true);
    expect(check?.fix?.args).toContain('install');
  });
});

// ──────────────────────────────────────────────
// diagnose: configs
// ──────────────────────────────────────────────

describe('AutoRepairAgent — diagnose: configs', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autorepair-configs-'));
    writeHealthyProject(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('битый package.json → error, fixable:false (авто-пересоздание запрещено)', async () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{oops', 'utf-8');

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'diagnose', scope: 'configs' });
    expect(result.success).toBe(true);

    const check = findCheck(outputOf(result).checks, 'configs.package-json');
    expect(check?.severity).toBe('error');
    expect(check?.fixable).toBe(false);
    expect(outputOf(result).overall).toBe('critical');
  });

  it('package.json отсутствует → error, fixable:false', async () => {
    fs.rmSync(path.join(tmp, 'package.json'), { force: true });

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'diagnose', scope: 'configs' });
    expect(result.success).toBe(true);

    const check = findCheck(outputOf(result).checks, 'configs.package-json');
    expect(check?.severity).toBe('error');
    expect(check?.fixable).toBe(false);
  });

  it('.env отсутствует при наличии .env.template → warning + fixable (copy)', async () => {
    fs.rmSync(path.join(tmp, '.env'), { force: true });

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'diagnose', scope: 'configs' });
    expect(result.success).toBe(true);

    const check = findCheck(outputOf(result).checks, 'configs.env-file');
    expect(check?.severity).toBe('warning');
    expect(check?.fixable).toBe(true);
    expect(check?.fix?.kind).toBe('file-copy');
    expect(check?.fix?.source).toBe('.env.template');
    expect(check?.fix?.target).toBe('.env');
  });

  it('конфиги валидны → ok', async () => {
    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'diagnose', scope: 'configs' });
    expect(result.success).toBe(true);

    const checks = outputOf(result).checks;
    expect(findCheck(checks, 'configs.package-json')?.severity).toBe('info');
    expect(findCheck(checks, 'configs.env-file')?.severity).toBe('info');
    expect(findCheck(checks, 'configs.data-json')?.severity).toBe('info');
    expect(outputOf(result).overall).toBe('ok');
  });

  it('невалидный data/*.json → error + fixable (рекреация)', async () => {
    fs.writeFileSync(path.join(tmp, 'data', 'broken.json'), '{bad', 'utf-8');

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'diagnose', scope: 'configs' });
    expect(result.success).toBe(true);

    const check = findCheck(outputOf(result).checks, 'configs.data-json');
    expect(check?.severity).toBe('error');
    expect(check?.fixable).toBe(true);
    expect(check?.fix?.kind).toBe('file-recreate');
    expect(check?.fix?.target).toBe('data/broken.json');
  });
});

// ──────────────────────────────────────────────
// diagnose: integrity
// ──────────────────────────────────────────────

describe('AutoRepairAgent — diagnose: integrity', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autorepair-integrity-'));
    writeHealthyProject(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('src/js/app.ts удалён → error; без git — fixable:false', async () => {
    fs.rmSync(path.join(tmp, 'src', 'js', 'app.ts'), { force: true });

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
      gitAvailable: false,
    }).execute({ action: 'diagnose', scope: 'integrity' });
    expect(result.success).toBe(true);

    const check = findCheck(outputOf(result).checks, 'integrity.required-path');
    expect(check?.severity).toBe('error');
    expect(check?.fixable).toBe(false);
    expect(outputOf(result).overall).toBe('critical');
  });

  it('src/js/app.ts удалён; с git — fixable:true + git-checkout план', async () => {
    fs.rmSync(path.join(tmp, 'src', 'js', 'app.ts'), { force: true });

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
      gitAvailable: true,
    }).execute({ action: 'diagnose', scope: 'integrity' });
    expect(result.success).toBe(true);

    const check = findCheck(outputOf(result).checks, 'integrity.required-path');
    expect(check?.severity).toBe('error');
    expect(check?.fixable).toBe(true);
    expect(check?.fix?.kind).toBe('git-checkout');
    expect(check?.fix?.args).toEqual(['checkout', '--', 'src/js/app.ts']);
  });

  it('все обязательные пути на месте → ok', async () => {
    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'diagnose', scope: 'integrity' });
    expect(result.success).toBe(true);

    const checks = outputOf(result).checks;
    expect(findCheck(checks, 'integrity.required-path')?.severity).toBe('info');
    expect(outputOf(result).overall).toBe('ok');
  });

  it('отчётные файлы report.html/report.md отсутствуют → info (необязательны)', async () => {
    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'diagnose', scope: 'integrity' });
    expect(result.success).toBe(true);

    const reportChecks = outputOf(result).checks.filter(
      (check) => check.id === 'integrity.report-files',
    );
    expect(reportChecks.length).toBeGreaterThan(0);
    for (const check of reportChecks) {
      expect(check.severity).toBe('info');
      expect(check.fixable).toBe(false);
    }
    expect(outputOf(result).overall).toBe('ok');
  });
});

// ──────────────────────────────────────────────
// repair (авто-ремонт)
// ──────────────────────────────────────────────

describe('AutoRepairAgent — repair', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autorepair-repair-'));
    writeHealthyProject(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('autoFix=false: ничего не выполняется, фиксы блокируются', async () => {
    fs.rmSync(path.join(tmp, '.env'), { force: true });
    const calls: TerminalCall[] = [];

    const result = await createAgent(tmp, {
      terminal: createMockTerminal(calls),
    }).execute({ action: 'repair', autoFix: false });
    expect(result.success).toBe(true);

    const out = outputOf(result);
    expect(out.blockedFixes.length).toBeGreaterThan(0);
    expect(out.blockedFixes[0]).toContain('autoFix');
    expect(out.appliedFixes).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(fs.existsSync(path.join(tmp, '.env'))).toBe(false);
  });

  it('autoFix=true: создаёт .env из .env.template', async () => {
    fs.rmSync(path.join(tmp, '.env'), { force: true });

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'repair', autoFix: true });
    expect(result.success).toBe(true);

    const out = outputOf(result);
    expect(out.appliedFixes).toContain('Создать .env из .env.template');
    expect(fs.readFileSync(path.join(tmp, '.env'), 'utf-8')).toBe(
      'API_KEY=template-key\n',
    );
  });

  it('autoFix=true: пересоздаёт битый data/*.json с бэкапом .bak', async () => {
    fs.writeFileSync(path.join(tmp, 'data', 'broken.json'), '{bad', 'utf-8');

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'repair', autoFix: true });
    expect(result.success).toBe(true);

    const out = outputOf(result);
    expect(
      out.appliedFixes.some((label) => label.includes('data/broken.json')),
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(tmp, 'data', 'broken.json'), 'utf-8'),
    ).toBe('{}');
    // Бэкап исходного (битого) содержимого создан до перезаписи
    expect(
      fs.readFileSync(path.join(tmp, 'data', 'broken.json.bak'), 'utf-8'),
    ).toBe('{bad');
  });

  it('autoFix=true: npm install выполняется при отсутствии node_modules', async () => {
    fs.rmSync(path.join(tmp, 'node_modules'), { recursive: true, force: true });
    const calls: TerminalCall[] = [];

    const result = await createAgent(tmp, {
      terminal: createMockTerminal(calls),
    }).execute({ action: 'repair', scope: 'deps', autoFix: true });
    expect(result.success).toBe(true);

    const install = calls.find(
      (call) => call.command === 'npm' && call.args.includes('install'),
    );
    expect(install).toBeDefined();
    expect(outputOf(result).appliedFixes).toContain(
      'npm install (установка зависимостей)',
    );
  });

  it('git-восстановление: удалённый файл восстанавливается через git checkout (мок terminal)', async () => {
    fs.rmSync(path.join(tmp, 'src', 'js', 'app.ts'), { force: true });
    const calls: TerminalCall[] = [];

    const result = await createAgent(tmp, {
      terminal: createMockTerminal(calls),
      gitAvailable: true,
    }).execute({ action: 'repair', autoFix: true });
    expect(result.success).toBe(true);

    const checkout = calls.find(
      (call) =>
        call.command === 'git' &&
        call.args[0] === 'checkout' &&
        call.args.includes('src/js/app.ts'),
    );
    expect(checkout).toBeDefined();
    expect(outputOf(result).appliedFixes).toContain(
      'git checkout -- src/js/app.ts',
    );
  });

  it('fileOps DI: операции копирования/записи идут через инжектированный fileOps', async () => {
    fs.rmSync(path.join(tmp, '.env'), { force: true });
    const copies: string[] = [];
    const base = createFsFileOps();
    const fileOps: FileOpsLike = {
      ...base,
      copy(source, target) {
        copies.push(target);
        base.copy(source, target);
      },
    };

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
      fileOps,
    }).execute({ action: 'repair', autoFix: true });
    expect(result.success).toBe(true);
    // .env создаётся копированием из шаблона через инжектированный fileOps
    expect(copies).toContain(path.join(tmp, '.env'));
  });
});

// ──────────────────────────────────────────────
// health (агрегированный отчёт)
// ──────────────────────────────────────────────

describe('AutoRepairAgent — health', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autorepair-health-'));
    writeHealthyProject(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('всё здорово → overall=ok', async () => {
    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'health', scope: 'project' });
    expect(result.success).toBe(true);
    expect(outputOf(result).overall).toBe('ok');
    expect(outputOf(result).checks.length).toBeGreaterThan(0);
  });

  it('есть warning (нет .env) → overall=warnings', async () => {
    fs.rmSync(path.join(tmp, '.env'), { force: true });

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
    }).execute({ action: 'health', scope: 'project' });
    expect(result.success).toBe(true);
    expect(outputOf(result).overall).toBe('warnings');
  });

  it('есть error (нет src/js/app.ts) → overall=critical', async () => {
    fs.rmSync(path.join(tmp, 'src', 'js', 'app.ts'), { force: true });

    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
      gitAvailable: false,
    }).execute({ action: 'health', scope: 'project' });
    expect(result.success).toBe(true);
    expect(outputOf(result).overall).toBe('critical');
  });
});

// ──────────────────────────────────────────────
// изоляция чекеров
// ──────────────────────────────────────────────

describe('AutoRepairAgent — изоляция чекеров', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autorepair-isolation-'));
    writeHealthyProject(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('падение одного чекера не роняет остальные', async () => {
    const result = await createAgent(tmp, {
      terminal: createMockTerminal([]),
      checkers: [
        {
          id: 'custom.bad',
          run: () => {
            throw new Error('boom');
          },
        },
        {
          id: 'custom.good',
          run: () => [
            {
              id: 'custom.good',
              severity: 'info',
              title: 'пользовательский чекер ок',
              fixable: false,
            },
          ],
        },
      ],
    }).execute({ action: 'diagnose', scope: 'deps' });
    expect(result.success).toBe(true);

    const checks = outputOf(result).checks;
    // Встроенные чекеры deps отработали
    expect(findCheck(checks, 'deps.node-modules')).toBeDefined();
    expect(findCheck(checks, 'deps.lock-file')).toBeDefined();
    // Полезный пользовательский чекер отработал
    expect(findCheck(checks, 'custom.good')?.severity).toBe('info');
    // Упавший чекер превратился в отдельную проверку error, а не исключение
    const failed = findCheck(checks, 'custom.bad.failed');
    expect(failed).toBeDefined();
    expect(failed?.severity).toBe('error');
    expect(failed?.detail).toContain('boom');
    expect(outputOf(result).overall).toBe('critical');
  });
});
