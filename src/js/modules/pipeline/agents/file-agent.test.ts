/**
 * FileAgent Tests — безопасные файловые операции.
 *
 * Проверяются: чтение (текст/JSON/YAML), запись, удаление с защитой,
 * переименование, листинг, поиск и валидация путей (безопасность).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileAgent } from './file-agent.js';
import type { FileAgentOutput } from './file-agent.js';
import { parseYaml, buildGlobMatcher } from './file-agent.js';

// ─── Helpers ───────────────────────────────────────────────

function outputOf(result: { data?: unknown }): FileAgentOutput {
  return result.data as FileAgentOutput;
}

function createAgent(root: string): FileAgent {
  return new FileAgent({ name: 'FileAgent' }, { roots: [root] });
}

describe('FileAgent — чтение', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'file-agent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('читает текстовый файл', async () => {
    const file = path.join(tmp, 'note.txt');
    fs.writeFileSync(file, 'Привет, мир!', 'utf-8');

    const result = await createAgent(tmp).execute({
      action: 'read',
      path: 'note.txt',
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).content).toBe('Привет, мир!');
  });

  it('возвращает success=false для несуществующего файла', async () => {
    const result = await createAgent(tmp).execute({
      action: 'read',
      path: 'missing.txt',
    });
    expect(result.success).toBe(false);
  });

  it('парсит JSON-файл', async () => {
    const file = path.join(tmp, 'config.json');
    fs.writeFileSync(
      file,
      '{"target": {"stocks": 60}, "names": ["A", "B"]}',
      'utf-8',
    );

    const result = await createAgent(tmp).execute({
      action: 'readJson',
      path: 'config.json',
    });
    expect(result.success).toBe(true);
    const parsed = outputOf(result).parsed as {
      target: { stocks: number };
      names: string[];
    };
    expect(parsed.target.stocks).toBe(60);
    expect(parsed.names).toEqual(['A', 'B']);
  });

  it('возвращает ошибку при невалидном JSON', async () => {
    const file = path.join(tmp, 'bad.json');
    fs.writeFileSync(file, '{oops', 'utf-8');

    const result = await createAgent(tmp).execute({
      action: 'readJson',
      path: 'bad.json',
    });
    expect(result.success).toBe(false);
  });

  it('парсит YAML-подмножество (вложенные map и списки)', async () => {
    const file = path.join(tmp, 'conf.yaml');
    fs.writeFileSync(
      file,
      [
        '# Комментарий',
        'name: project',
        'enabled: true',
        'retries: 3',
        'targets:',
        '  stocks: 60',
        '  bonds: 40',
        'tags:',
        '  - alpha',
        '  - beta',
      ].join('\n'),
      'utf-8',
    );

    const result = await createAgent(tmp).execute({
      action: 'readYaml',
      path: 'conf.yaml',
    });
    expect(result.success).toBe(true);
    const parsed = outputOf(result).parsed as Record<string, unknown>;
    expect(parsed.name).toBe('project');
    expect(parsed.enabled).toBe(true);
    expect(parsed.retries).toBe(3);
    expect(parsed.targets).toEqual({ stocks: 60, bonds: 40 });
    expect(parsed.tags).toEqual(['alpha', 'beta']);
  });
});

describe('FileAgent — запись и удаление', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'file-agent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('создаёт файл с автосозданием вложенных директорий', async () => {
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: 'src/modules/new-file.ts',
      content: 'export const x = 1;',
    });
    expect(result.success).toBe(true);

    const created = path.join(tmp, 'src/modules/new-file.ts');
    expect(fs.existsSync(created)).toBe(true);
    expect(fs.readFileSync(created, 'utf-8')).toBe('export const x = 1;');
  });

  it('удаляет файл', async () => {
    const file = path.join(tmp, 'to-delete.txt');
    fs.writeFileSync(file, 'data', 'utf-8');

    const result = await createAgent(tmp).execute({
      action: 'delete',
      path: 'to-delete.txt',
    });
    expect(result.success).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('удаляет директорию рекурсивно', async () => {
    const dir = path.join(tmp, 'nested');
    fs.mkdirSync(path.join(dir, 'deep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'deep', 'a.txt'), 'x', 'utf-8');

    const result = await createAgent(tmp).execute({
      action: 'delete',
      path: 'nested',
    });
    expect(result.success).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('запрещает удаление корня агента', async () => {
    const result = await createAgent(tmp).execute({
      action: 'delete',
      path: '',
    });
    expect(result.success).toBe(false);
    expect(fs.existsSync(tmp)).toBe(true);
  });

  it('запрещает удаление служебных путей (.git)', async () => {
    const gitDir = path.join(tmp, '.git');
    fs.mkdirSync(gitDir);

    const result = await createAgent(tmp).execute({
      action: 'delete',
      path: '.git',
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Запрещено');
    expect(fs.existsSync(gitDir)).toBe(true);
  });
});

describe('FileAgent — перемещение, листинг и поиск', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'file-agent-test-'));
    fs.mkdirSync(path.join(tmp, 'src/utils'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/index.ts'), '// index', 'utf-8');
    fs.writeFileSync(
      path.join(tmp, 'src/utils/helper.ts'),
      '// helper',
      'utf-8',
    );
    fs.writeFileSync(path.join(tmp, 'README.md'), '# readme', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('перемещает файл в другую директорию', async () => {
    const result = await createAgent(tmp).execute({
      action: 'rename',
      path: 'src/index.ts',
      toPath: 'src/utils/index.ts',
    });
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/index.ts'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'src/utils/index.ts'))).toBe(true);
  });

  it('выводит содержимое директории рекурсивно', async () => {
    const result = await createAgent(tmp).execute({
      action: 'list',
      path: 'src',
      recursive: true,
    });
    expect(result.success).toBe(true);
    const relativePaths = outputOf(result)
      .entries!.map((entry) => entry.relativePath)
      .sort();
    expect(relativePaths).toEqual(
      ['index.ts', 'utils', 'utils/helper.ts'].sort(),
    );
  });

  it('ищет файлы по подстроке', async () => {
    const result = await createAgent(tmp).execute({
      action: 'search',
      path: '',
      pattern: 'helper',
    });
    expect(result.success).toBe(true);
    const files = outputOf(result).files!;
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('helper.ts');
  });

  it('ищет файлы по glob-паттерну (**/*.ts)', async () => {
    const result = await createAgent(tmp).execute({
      action: 'search',
      path: '',
      pattern: '**/*.ts',
    });
    expect(result.success).toBe(true);
    const files = outputOf(result)
      .files!.map((file) => path.relative(tmp, file).replace(/\\/g, '/'))
      .sort();
    expect(files).toEqual(['src/index.ts', 'src/utils/helper.ts'].sort());
  });
});

describe('FileAgent — безопасность путей', () => {
  let tmp: string;
  let outside: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'file-agent-test-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'file-agent-outside-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('блокирует выход за пределы корня через ../', async () => {
    const result = await createAgent(tmp).execute({
      action: 'read',
      path: '../file-agent-outside-' + path.basename(outside) + '/secret.txt',
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('выход за пределы корня');
  });

  it('блокирует абсолютный путь вне разрешённых корней', async () => {
    const secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, 'top secret', 'utf-8');

    const result = await createAgent(tmp).execute({
      action: 'read',
      path: secret,
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('вне разрешённых корней');
  });

  it('блокирует запись за пределы корня', async () => {
    const target = path.join(outside, 'hacked.txt');
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: target,
      content: 'x',
    });
    expect(result.success).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe('parseYaml / buildGlobMatcher (утилиты)', () => {
  it('parseYaml: игнорирует комментарии и пустые строки', () => {
    const parsed = parseYaml('# top\n\nkey: value\n') as Record<
      string,
      unknown
    >;
    expect(parsed.key).toBe('value');
  });

  it('parseYaml: парсит список inline-объектов', () => {
    const parsed = parseYaml(
      '- name: alpha\n  weight: 1\n- name: beta\n  weight: 2\n',
    ) as unknown[];
    expect(parsed).toEqual([
      { name: 'alpha', weight: 1 },
      { name: 'beta', weight: 2 },
    ]);
  });

  it('parseYaml: парсит числа и boolean', () => {
    const parsed = parseYaml('a: -5\nb: 3.14\nc: true\nd: false\n') as Record<
      string,
      unknown
    >;
    expect(parsed.a).toBe(-5);
    expect(parsed.b).toBe(3.14);
    expect(parsed.c).toBe(true);
    expect(parsed.d).toBe(false);
  });

  it('buildGlobMatcher: подстрока без glob-символов', () => {
    const matcher = buildGlobMatcher('helper');
    expect(matcher('src/utils/helper.ts')).toBe(true);
    expect(matcher('src/index.ts')).toBe(false);
  });

  it('buildGlobMatcher: паттерн **/*.ts', () => {
    const matcher = buildGlobMatcher('**/*.ts');
    expect(matcher('src/utils/helper.ts')).toBe(true);
    expect(matcher('README.md')).toBe(false);
  });
});
