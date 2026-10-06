/**
 * ConfigAgent Tests — управление JSON-конфигами и файловой частью VS Code.
 *
 * Проверяются: чтение JSON (существующий/отсутствующий), запись
 * (создание/перезапись), глубокое слияние 2 уровней с приоритетом новых
 * ключей, атомарность записи (результат — валидный JSON), защита путей
 * (вне корня, deny-список .git/node_modules), dryRun без записи на диск,
 * add/remove-extension в `.vscode/extensions.json`, export нескольких
 * конфигов в один файл, import с резервной копией `.bak` и валидация
 * JSON-значений (не-JSON → ошибка).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigAgent } from './config-agent.js';
import type { ConfigAgentOutput } from './config-agent.js';

// ─── Helpers ───────────────────────────────────────────────

function outputOf(result: { data?: unknown }): ConfigAgentOutput {
  return result.data as ConfigAgentOutput;
}

function errorMessageOf(result: { error?: Error }): string {
  return result.error?.message ?? '';
}

function createAgent(root: string): ConfigAgent {
  return new ConfigAgent({ name: 'ConfigAgent' }, { roots: [root] });
}

function writeJson(root: string, rel: string, value: unknown): void {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value), 'utf-8');
}

function readJson(root: string, rel: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8')) as unknown;
}

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'config-agent-test-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── Чтение JSON ───────────────────────────────────────────

describe('ConfigAgent — read', () => {
  it('читает существующий JSON-конфиг', async () => {
    const cfg = { theme: 'dark', features: { charts: true } };
    writeJson(tmp, 'app-config.json', cfg);
    const result = await createAgent(tmp).execute({
      action: 'read',
      path: 'app-config.json',
    });
    expect(result.success).toBe(true);
    const out = outputOf(result);
    expect(out.action).toBe('read');
    expect(out.changed).toBe(false);
    expect(out.data).toEqual(cfg);
  });

  it('ошибка при чтении отсутствующего файла', async () => {
    const result = await createAgent(tmp).execute({
      action: 'read',
      path: 'missing.json',
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('не найден');
  });

  it('ошибка при чтении невалидного JSON', async () => {
    fs.writeFileSync(path.join(tmp, 'bad.json'), '{broken', 'utf-8');
    const result = await createAgent(tmp).execute({
      action: 'read',
      path: 'bad.json',
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('JSON');
  });
});

// ─── Запись JSON ───────────────────────────────────────────

describe('ConfigAgent — write', () => {
  it('создаёт новый конфиг (с автосозданием директорий)', async () => {
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: 'configs/nested/app.json',
      data: { a: 1 },
    });
    expect(result.success).toBe(true);
    const out = outputOf(result);
    expect(out.action).toBe('write');
    expect(out.changed).toBe(true);
    expect(out.path).toBe(path.join(tmp, 'configs', 'nested', 'app.json'));
    expect(readJson(tmp, 'configs/nested/app.json')).toEqual({ a: 1 });
  });

  it('перезаписывает существующий конфиг', async () => {
    writeJson(tmp, 'conf.json', { a: 1 });
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: 'conf.json',
      data: { b: 2 },
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(true);
    expect(readJson(tmp, 'conf.json')).toEqual({ b: 2 });
  });

  it('идемпотентен: повторная запись того же содержимого не меняет файл', async () => {
    writeJson(tmp, 'conf.json', { a: 1 });
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: 'conf.json',
      data: { a: 1 },
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(false);
  });

  it('merge:true выполняет глубокое слияние 2 уровней с приоритетом новых ключей', async () => {
    writeJson(tmp, 'conf.json', {
      a: 1,
      nested: { x: 1, y: 2 },
      deep: { l1: { l2: { old: true } } },
    });
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: 'conf.json',
      merge: true,
      data: {
        b: 2,
        nested: { x: 10 },
        deep: { l1: { l2: { fresh: true } } },
      },
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(true);
    // 1-й уровень объединяется; 2-й уровень объединяется;
    // вложенность глубже 2 уровней заменяется целиком (l2 устаревший ключ пропал)
    expect(readJson(tmp, 'conf.json')).toEqual({
      a: 1,
      b: 2,
      nested: { x: 10, y: 2 },
      deep: { l1: { l2: { fresh: true } } },
    });
  });

  it('merge:true для отсутствующего файла просто создаёт его', async () => {
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: 'new.json',
      merge: true,
      data: { only: 1 },
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(true);
    expect(readJson(tmp, 'new.json')).toEqual({ only: 1 });
  });

  it('атомарность: после записи файл — валидный JSON', async () => {
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: 'atomic.json',
      data: { k: 'v', arr: [1, 2, 3] },
    });
    expect(result.success).toBe(true);
    expect(() =>
      JSON.parse(fs.readFileSync(path.join(tmp, 'atomic.json'), 'utf-8')),
    ).not.toThrow();
  });

  it('dryRun не пишет на диск', async () => {
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: 'plan.json',
      data: { a: 1 },
      dryRun: true,
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'plan.json'))).toBe(false);
  });

  it('отклоняет не-JSON значения (функция в данных)', async () => {
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: 'bad.json',
      data: { cb: (): number => 1 } as unknown as Record<string, unknown>,
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('JSON');
    expect(fs.existsSync(path.join(tmp, 'bad.json'))).toBe(false);
  });

  it('отклоняет циклические структуры', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: 'bad.json',
      data: circular,
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('циклическ');
  });
});

// ─── Безопасность путей ────────────────────────────────────

describe('ConfigAgent — безопасность путей', () => {
  it('блокирует абсолютный путь вне корня', async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-out-'));
    try {
      const outside = path.join(outsideDir, 'x.json');
      const result = await createAgent(tmp).execute({
        action: 'write',
        path: outside,
        data: { a: 1 },
      });
      expect(result.success).toBe(false);
      expect(errorMessageOf(result)).toContain('вне');
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('блокирует выход за пределы корня через ../', async () => {
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: '../evil.json',
      data: { a: 1 },
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('выход за пределы');
  });

  it('deny-список: запрещает запись в .git', async () => {
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: '.git/config.json',
      data: { a: 1 },
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('запрещена');
    expect(errorMessageOf(result)).toContain('.git');
  });

  it('deny-список: запрещает запись в node_modules', async () => {
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: 'node_modules/pkg/config.json',
      data: { a: 1 },
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('запрещена');
  });
});

// ─── Расширения VS Code ────────────────────────────────────

describe('ConfigAgent — расширения VS Code', () => {
  it('add-extension создаёт .vscode/extensions.json с рекомендацией', async () => {
    const result = await createAgent(tmp).execute({
      action: 'add-extension',
      extensionId: 'dbaeumer.vscode-eslint',
    });
    expect(result.success).toBe(true);
    const out = outputOf(result);
    expect(out.changed).toBe(true);
    expect(out.path).toBe(path.join(tmp, '.vscode', 'extensions.json'));
    expect(readJson(tmp, '.vscode/extensions.json')).toEqual({
      recommendations: ['dbaeumer.vscode-eslint'],
    });
  });

  it('add-extension не дублирует уже имеющуюся рекомендацию', async () => {
    writeJson(tmp, '.vscode/extensions.json', {
      recommendations: ['dbaeumer.vscode-eslint'],
    });
    const result = await createAgent(tmp).execute({
      action: 'add-extension',
      extensionId: 'dbaeumer.vscode-eslint',
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(false);
    expect(readJson(tmp, '.vscode/extensions.json')).toEqual({
      recommendations: ['dbaeumer.vscode-eslint'],
    });
  });

  it('remove-extension удаляет расширение из рекомендаций', async () => {
    writeJson(tmp, '.vscode/extensions.json', {
      recommendations: ['dbaeumer.vscode-eslint', 'esbenp.prettier-vscode'],
    });
    const result = await createAgent(tmp).execute({
      action: 'remove-extension',
      extensionId: 'dbaeumer.vscode-eslint',
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(true);
    expect(readJson(tmp, '.vscode/extensions.json')).toEqual({
      recommendations: ['esbenp.prettier-vscode'],
    });
  });

  it('remove-extension отсутствующего расширения не меняет файл', async () => {
    writeJson(tmp, '.vscode/extensions.json', {
      recommendations: ['esbenp.prettier-vscode'],
    });
    const result = await createAgent(tmp).execute({
      action: 'remove-extension',
      extensionId: 'dbaeumer.vscode-eslint',
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(false);
    expect(readJson(tmp, '.vscode/extensions.json')).toEqual({
      recommendations: ['esbenp.prettier-vscode'],
    });
  });

  it('remove-extension при отсутствии файла возвращает changed:false', async () => {
    const result = await createAgent(tmp).execute({
      action: 'remove-extension',
      extensionId: 'dbaeumer.vscode-eslint',
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(false);
  });

  it('отклоняет некорректный идентификатор расширения', async () => {
    const result = await createAgent(tmp).execute({
      action: 'add-extension',
      extensionId: 'no-dot-here',
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('идентификатор');
  });

  it('add-extension с dryRun не пишет на диск', async () => {
    const result = await createAgent(tmp).execute({
      action: 'add-extension',
      extensionId: 'dbaeumer.vscode-eslint',
      dryRun: true,
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(false);
    expect(fs.existsSync(path.join(tmp, '.vscode', 'extensions.json'))).toBe(
      false,
    );
  });
});

// ─── Экспорт / импорт ──────────────────────────────────────

describe('ConfigAgent — export/import', () => {
  it('export объединяет несколько конфигов в один файл', async () => {
    writeJson(tmp, 'a.json', { a: 1, shared: { x: 1 } });
    writeJson(tmp, 'b.json', { b: 2, shared: { y: 2 } });
    const result = await createAgent(tmp).execute({
      action: 'export',
      path: 'bundle.json',
      data: ['a.json', 'b.json'],
    });
    expect(result.success).toBe(true);
    const out = outputOf(result);
    expect(out.changed).toBe(true);
    // глубокое слияние источников; последний источник приоритетнее
    expect(readJson(tmp, 'bundle.json')).toEqual({
      a: 1,
      b: 2,
      shared: { x: 1, y: 2 },
    });
    // исходники не тронуты
    expect(readJson(tmp, 'a.json')).toEqual({ a: 1, shared: { x: 1 } });
  });

  it('export принимает один путь строкой', async () => {
    writeJson(tmp, 'single.json', { s: 1 });
    const result = await createAgent(tmp).execute({
      action: 'export',
      path: 'copy.json',
      data: 'single.json',
    });
    expect(result.success).toBe(true);
    expect(readJson(tmp, 'copy.json')).toEqual({ s: 1 });
  });

  it('export с dryRun не создаёт файл назначения', async () => {
    writeJson(tmp, 'a.json', { a: 1 });
    const result = await createAgent(tmp).execute({
      action: 'export',
      path: 'bundle.json',
      data: ['a.json'],
      dryRun: true,
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'bundle.json'))).toBe(false);
  });

  it('export блокирует запись в deny-путь (.git)', async () => {
    writeJson(tmp, 'a.json', { a: 1 });
    const result = await createAgent(tmp).execute({
      action: 'export',
      path: '.git/bundle.json',
      data: ['a.json'],
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('запрещена');
  });

  it('import применяет данные и создаёт .bak перед изменением', async () => {
    writeJson(tmp, 'target.json', { a: 1, b: 1 });
    writeJson(tmp, 'source.json', { b: 2, c: 3 });
    const result = await createAgent(tmp).execute({
      action: 'import',
      path: 'source.json',
      toPath: 'target.json',
      merge: true,
    });
    expect(result.success).toBe(true);
    const out = outputOf(result);
    expect(out.changed).toBe(true);
    expect(out.backupPath).toBe(path.join(tmp, 'target.json.bak'));
    // бэкап хранит прежнее содержимое
    expect(readJson(tmp, 'target.json.bak')).toEqual({ a: 1, b: 1 });
    // целевой конфиг — результат merge (новые ключи приоритетнее)
    expect(readJson(tmp, 'target.json')).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('import без merge заменяет целевой конфиг целиком', async () => {
    writeJson(tmp, 'target.json', { old: true });
    writeJson(tmp, 'source.json', { fresh: true });
    const result = await createAgent(tmp).execute({
      action: 'import',
      path: 'source.json',
      toPath: 'target.json',
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(true);
    expect(readJson(tmp, 'target.json.bak')).toEqual({ old: true });
    expect(readJson(tmp, 'target.json')).toEqual({ fresh: true });
  });

  it('import при отсутствии целевого файла создаёт его без .bak', async () => {
    writeJson(tmp, 'source.json', { data: 1 });
    const result = await createAgent(tmp).execute({
      action: 'import',
      path: 'source.json',
      toPath: 'new-target.json',
    });
    expect(result.success).toBe(true);
    const out = outputOf(result);
    expect(out.changed).toBe(true);
    expect(out.backupPath).toBeUndefined();
    expect(readJson(tmp, 'new-target.json')).toEqual({ data: 1 });
  });

  it('import с dryRun не пишет и не создаёт .bak', async () => {
    writeJson(tmp, 'target.json', { a: 1 });
    writeJson(tmp, 'source.json', { b: 2 });
    const result = await createAgent(tmp).execute({
      action: 'import',
      path: 'source.json',
      toPath: 'target.json',
      merge: true,
      dryRun: true,
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'target.json.bak'))).toBe(false);
    expect(readJson(tmp, 'target.json')).toEqual({ a: 1 });
  });

  it('import требует toPath', async () => {
    writeJson(tmp, 'source.json', { a: 1 });
    const result = await createAgent(tmp).execute({
      action: 'import',
      path: 'source.json',
    });
    expect(result.success).toBe(false);
    expect(errorMessageOf(result)).toContain('toPath');
  });
});

// ─── Настройки VS Code (файловая часть) ────────────────────

describe('ConfigAgent — .vscode/settings.json', () => {
  it('write создаёт settings.json', async () => {
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: '.vscode/settings.json',
      data: { editor: { fontSize: 14 }, files: { encoding: 'utf8' } },
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).changed).toBe(true);
    expect(readJson(tmp, '.vscode/settings.json')).toEqual({
      editor: { fontSize: 14 },
      files: { encoding: 'utf8' },
    });
  });

  it('merge обновляет существующий settings.json', async () => {
    writeJson(tmp, '.vscode/settings.json', {
      editor: { fontSize: 14 },
      files: { encoding: 'utf8' },
    });
    const result = await createAgent(tmp).execute({
      action: 'write',
      path: '.vscode/settings.json',
      merge: true,
      data: { editor: { tabSize: 2 } },
    });
    expect(result.success).toBe(true);
    expect(readJson(tmp, '.vscode/settings.json')).toEqual({
      editor: { fontSize: 14, tabSize: 2 },
      files: { encoding: 'utf8' },
    });
  });

  it('read возвращает содержимое settings.json', async () => {
    writeJson(tmp, '.vscode/settings.json', { window: { zoomLevel: 1 } });
    const result = await createAgent(tmp).execute({
      action: 'read',
      path: '.vscode/settings.json',
    });
    expect(result.success).toBe(true);
    expect(outputOf(result).data).toEqual({ window: { zoomLevel: 1 } });
  });
});
