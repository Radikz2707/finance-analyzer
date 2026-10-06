/**
 * Тесты валидации переменных окружения (этап 1.3, P2).
 *
 * Валидатор принимает env как аргумент, поэтому тесты не трогают
 * глобальный process.env и не зависят от окружения CI.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENV_SCHEMA, assertEnvValid, validateEnv } from './env-validation.js';

/** Корректная конфигурация: все ключи схемы заполнены валидными значениями */
function validEnv(): Record<string, string> {
  return {
    EXCEL_FILE_PATH: 'C:/dev/finance-analyzer/data/portfolio.xlsx',
    QUIK_NEWS_DIR: 'C:/dev/finance-analyzer/data/quik',
    QUIK_ORDERS_DIR: 'C:/dev/finance-analyzer/data/quik',
    TELEGRAM_BOT_TOKEN: '123456789:AA-BB-CC-DD-EE',
    TELEGRAM_CHAT_ID: '123456789',
    TELEGRAM_ADMIN_IDS: '123456789, 987654321',
    AI_MODEL_ID: 'ollama',
    OPENROUTER_API_KEY: 'sk-or-v1-abcdefghijklmnop',
    GIGACHAT_API_KEY: 'giga-client-secret-12345678',
    YANDEXGPT_API_KEY: 'yandex-iam-token-12345678',
    PROXYAPI_KEY: 'proxy-login-password-12345678',
    OLLAMA_BASE_URL: 'http://localhost:11434',
    AI_CACHE_ENABLED: 'true',
    FINAM_API_KEY: 'finam-secret-token-123456',
    CBK_RATE_OVERRIDE: '14',
    LOG_TO_FILE: 'false',
    LOG_LEVEL: 'info',
  };
}

describe('validateEnv', () => {
  it('валидный env → ok: true, нет ошибок и предупреждений', () => {
    const result = validateEnv(validEnv());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.missingKeys).toEqual([]);
  });

  it('отсутствие обязательного ключа → ошибка с именем ключа', () => {
    const result = validateEnv({});

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      key: 'EXCEL_FILE_PATH',
      message: 'обязательный ключ не задан',
    });
    expect(result.missingKeys).toContain('EXCEL_FILE_PATH');
  });

  it('пустая строка в обязательном ключе → ошибка', () => {
    const result = validateEnv({ EXCEL_FILE_PATH: '' });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.key === 'EXCEL_FILE_PATH')).toBe(true);
  });

  it('строка из пробелов в обязательном ключе → ошибка', () => {
    const result = validateEnv({ EXCEL_FILE_PATH: '   ' });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.key === 'EXCEL_FILE_PATH')).toBe(true);
  });

  it('неверный URL → ошибка (без протокола)', () => {
    const result = validateEnv({
      EXCEL_FILE_PATH: validEnv().EXCEL_FILE_PATH!,
      OLLAMA_BASE_URL: 'localhost:11434',
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      key: 'OLLAMA_BASE_URL',
      message: 'должен начинаться с http:// или https://',
    });
  });

  it('неверный URL → ошибка (невалидная строка)', () => {
    const result = validateEnv({
      EXCEL_FILE_PATH: validEnv().EXCEL_FILE_PATH!,
      OLLAMA_BASE_URL: 'https://',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.key === 'OLLAMA_BASE_URL')).toBe(true);
  });

  it('корректный URL → без ошибок', () => {
    const env = validEnv();
    env.OLLAMA_BASE_URL = 'https://ollama.example.com:11434';

    const result = validateEnv(env);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('опциональный ключ, указанный пустым → warning, но НЕ error', () => {
    const env = validEnv();
    env.TELEGRAM_BOT_TOKEN = '';
    env.TELEGRAM_CHAT_ID = '';

    const result = validateEnv(env);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.key)).toContain('TELEGRAM_BOT_TOKEN');
    expect(result.warnings.map((w) => w.key)).toContain('TELEGRAM_CHAT_ID');
  });

  it('отсутствующий опциональный ключ → не error и не warning (fallback допустим)', () => {
    const env = validEnv();
    delete env.OPENROUTER_API_KEY;
    delete env.GIGACHAT_API_KEY;

    const result = validateEnv(env);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('placeholder-значение из .env.template → warning', () => {
    const result = validateEnv({
      EXCEL_FILE_PATH: '/path/to/your/portfolio.xlsx',
      TELEGRAM_BOT_TOKEN: 'ваш_токен_от_BotFather',
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.key)).toEqual(
      expect.arrayContaining(['EXCEL_FILE_PATH', 'TELEGRAM_BOT_TOKEN']),
    );
  });

  it('недопустимое значение AI_MODEL_ID → ошибка', () => {
    const env = validEnv();
    env.AI_MODEL_ID = 'chatgpt-4';

    const result = validateEnv(env);

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.key === 'AI_MODEL_ID')).toBe(true);
  });

  it('недопустимый LOG_LEVEL → ошибка', () => {
    const env = validEnv();
    env.LOG_LEVEL = 'verbose';

    const result = validateEnv(env);

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.key === 'LOG_LEVEL')).toBe(true);
  });

  it('нечисловой CBK_RATE_OVERRIDE → ошибка', () => {
    const env = validEnv();
    env.CBK_RATE_OVERRIDE = 'fourteen';

    const result = validateEnv(env);

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.key === 'CBK_RATE_OVERRIDE')).toBe(true);
  });
});

describe('assertEnvValid', () => {
  it('не бросает для валидного env', () => {
    expect(() => assertEnvValid(validEnv())).not.toThrow();
  });

  it('бросает с понятным сообщением: имя ключа + подсказка .env.template', () => {
    expect(() => assertEnvValid({})).toThrow(/EXCEL_FILE_PATH/);
    expect(() => assertEnvValid({})).toThrow(/обязательн/);
    expect(() => assertEnvValid({})).toThrow(/\.env\.template/);
  });
});

describe('сверка с .env.template', () => {
  it('все ключи из .env.template присутствуют в ENV_SCHEMA', () => {
    const templatePath = resolve(process.cwd(), '.env.template');
    const content = readFileSync(templatePath, 'utf8');

    // Собираем имена переменных вида KEY= из шаблона (игнорируем комментарии).
    const templateKeys = [
      ...content.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm),
    ].map((match) => match[1]!);

    expect(templateKeys.length).toBeGreaterThan(0);
    for (const key of templateKeys) {
      expect(Object.keys(ENV_SCHEMA), `ключ ${key} из .env.template`).toContain(
        key,
      );
    }
  });
});
