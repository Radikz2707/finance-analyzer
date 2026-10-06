/**
 * Валидация переменных окружения (.env) при старте Node-входов.
 *
 * Модуль НАМЕРЕННО не имеет зависимостей и side-effect'ов:
 * - не импортирует dotenv (чтобы не тянуть fs/Node-зависимости в браузерный бандл);
 * - чтение process.env происходит только внутри validateEnv()/assertEnvValid();
 * - validateEnv() не бросает исключения — решение принимает вызывающий код.
 *
 * Схема ключей сверена с .env.template и фактическим чтением process.env.*
 * в коде (ai-config, ai-client, telegram-http-sender, finam-api, cbr-rate,
 * logger, harness-bootstrap, xlsx-parser и др.).
 */

/** Базовые форматы значений ключей окружения */
export type EnvValueFormat =
  'url' | 'token' | 'path' | 'boolean' | 'number' | 'csv' | 'string';

/** Описание одного ключа окружения */
export interface EnvKeySpec {
  /** Человекочитаемое описание (для ошибок и документации) */
  description: string;
  /** Обязательный ли ключ: отсутствие/пустая строка → error (по умолчанию false) */
  required?: boolean;
  /** Базовый формат значения (по умолчанию 'string') */
  format?: EnvValueFormat;
  /** Допустимые значения (для перечислений, напр. AI_MODEL_ID) */
  allowedValues?: readonly string[];
  /** Пример значения из .env.template */
  example?: string;
}

/**
 * Схема ключей окружения.
 *
 * Обязательный минимум — EXCEL_FILE_PATH: без данных портфеля QUIK
 * анализ бессмыслен. Остальное имеет fallback-режимы (MOEX без Finam-ключа,
 * Ollama локально без API-ключей, Telegram no-op без токена) и потому
 * помечено как опциональное — пустое значение даёт warning, а не error.
 */
export const ENV_SCHEMA: Readonly<Record<string, EnvKeySpec>> = {
  // ===== Пути к данным =====
  EXCEL_FILE_PATH: {
    description: 'Путь к Excel-файлу с данными портфеля QUIK',
    required: true,
    format: 'path',
    example: '/path/to/your/portfolio.xlsx',
  },
  QUIK_NEWS_DIR: {
    description:
      'Папка с экспортированными новостями QUIK (default: data/quik)',
    format: 'path',
    example: '<корень проекта>/data/quik',
  },
  QUIK_ORDERS_DIR: {
    description: 'Папка с экспортированными заявками QUIK (default: data/quik)',
    format: 'path',
    example: '<корень проекта>/data/quik',
  },

  // ===== Telegram-уведомления =====
  TELEGRAM_BOT_TOKEN: {
    description:
      'Токен Telegram-бота (BotFather); без него уведомления не отправляются (no-op)',
    format: 'token',
    example: '123456:ABC-DEF...',
  },
  TELEGRAM_CHAT_ID: {
    description: 'Chat ID для уведомлений (приоритет над TELEGRAM_ADMIN_IDS)',
    format: 'string',
    example: '123456789',
  },
  TELEGRAM_ADMIN_IDS: {
    description:
      'Fallback-список admin-чатов через запятую (используется первый)',
    format: 'csv',
    example: '123456789',
  },

  // ===== ИИ-модели =====
  AI_MODEL_ID: {
    description:
      'Выбранная модель: ollama | gigachat | gpt-4o-mini | yandexgpt (default: ollama)',
    allowedValues: ['ollama', 'gigachat', 'gpt-4o-mini', 'yandexgpt'],
    example: 'ollama',
  },
  OPENROUTER_API_KEY: {
    description: 'Ключ OpenRouter API (gpt-4o-mini и другие облачные модели)',
    format: 'token',
    example: 'sk-or-v1-...',
  },
  GIGACHAT_API_KEY: {
    description: 'Ключ GigaChat API (Сбер; работает в РФ без VPN)',
    format: 'token',
    example: 'ваш_gigachat_ключ',
  },
  YANDEXGPT_API_KEY: {
    description: 'Ключ YandexGPT API (Яндекс Cloud)',
    format: 'token',
    example: 'your-yandexgpt-api-key-here',
  },
  PROXYAPI_KEY: {
    description:
      'Ключ ProxyAPI — используется для GigaChat, если нет прямого GIGACHAT_API_KEY',
    format: 'token',
    example: 'ваш_proxy_api_key',
  },
  OLLAMA_BASE_URL: {
    description:
      'Базовый URL Ollama (переопределение; в коде дефолт http://localhost:11434)',
    format: 'url',
    example: 'http://localhost:11434',
  },
  AI_CACHE_ENABLED: {
    description: 'Включить кэш AI-ответов: true/false (default: true)',
    format: 'boolean',
    example: 'true',
  },

  // ===== Данные (MOEX / Finam / CBR) =====
  FINAM_API_KEY: {
    description: 'Ключ Finam API — при наличии используется вместо MOEX ISS',
    format: 'token',
    example: 'ваш_finam_ключ',
  },
  CBK_RATE_OVERRIDE: {
    description:
      'Ручная настройка ключевой ставки ЦБ (если API недоступен), напр. 14',
    format: 'number',
    example: '14',
  },

  // ===== Логирование =====
  LOG_TO_FILE: {
    description:
      'Писать логи в файл data/logs/app.log: true/false (default: off)',
    format: 'boolean',
    example: 'false',
  },
  LOG_LEVEL: {
    description: 'Уровень логов: debug | info | warn | error (default: info)',
    allowedValues: ['debug', 'info', 'warn', 'error'],
    example: 'info',
  },
};

/** Паттерны placeholder-значений из .env.template (шаблон не заполнен реальными данными) */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^\/path\/to\//,
  /^(ваш|your)\b/i,
  /ваш_/,
];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

/** Проверка формата значения. Возвращает текст ошибки или null. */
function checkFormat(spec: EnvKeySpec, value: string): string | null {
  switch (spec.format ?? 'string') {
    case 'url': {
      if (!/^https?:\/\//i.test(value)) {
        return 'должен начинаться с http:// или https://';
      }
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return 'поддерживаются только http/https';
        }
      } catch {
        return 'не является корректным URL';
      }
      return null;
    }
    case 'token':
      if (/\s/.test(value)) {
        return 'не должен содержать пробелов';
      }
      if (value.length < 8) {
        return 'слишком короткий (минимум 8 символов)';
      }
      return null;
    case 'path':
      if (/^https?:\/\//i.test(value)) {
        return 'должен быть локальным путём, а не URL';
      }
      return null;
    case 'boolean':
      if (!['true', 'false', '1', '0'].includes(value.toLowerCase())) {
        return 'должен быть true/false или 1/0';
      }
      return null;
    case 'number':
      if (!/^-?\d+(\.\d+)?$/.test(value.trim())) {
        return 'должен быть числом';
      }
      return null;
    case 'csv': {
      if (value.split(',').some((item) => item.trim() === '')) {
        return 'не должен содержать пустых элементов (разделитель — запятая)';
      }
      return null;
    }
    default:
      return null;
  }
}

/** Одна проблема конфигурации (ошибка или предупреждение) */
export interface EnvValidationIssue {
  /** Имя переменной окружения */
  key: string;
  /** Причина проблемы */
  message: string;
}

/** Результат валидации окружения */
export interface EnvValidationResult {
  /** true — критичных ошибок нет (могут быть предупреждения) */
  ok: boolean;
  /** Критичные ошибки: отсутствие обязательных ключей, невалидный формат */
  errors: EnvValidationIssue[];
  /** Некритичные замечания: пустые опциональные ключи, placeholder-значения */
  warnings: EnvValidationIssue[];
  /** Обязательные ключи, которые не заданы */
  missingKeys: string[];
}

/**
 * Проверить конфигурацию окружения против ENV_SCHEMA.
 *
 * @param env — карта переменных; если не передана, читается process.env
 *              (в среде без Node — пустой объект). Без side-effect'ов,
 *              исключений не бросает.
 */
export function validateEnv(
  env?: Record<string, string | undefined>,
): EnvValidationResult {
  const source: Record<string, string | undefined> =
    env ?? (typeof process !== 'undefined' ? process.env : {});

  const errors: EnvValidationIssue[] = [];
  const warnings: EnvValidationIssue[] = [];
  const missingKeys: string[] = [];

  for (const [key, spec] of Object.entries(ENV_SCHEMA)) {
    const raw = source[key];
    const trimmed = raw?.trim() ?? '';
    const isEmpty = trimmed === '';

    if (spec.required && isEmpty) {
      missingKeys.push(key);
      errors.push({ key, message: 'обязательный ключ не задан' });
      continue;
    }

    if (isEmpty) {
      if (raw !== undefined) {
        warnings.push({
          key,
          message: 'указан пустым — будет использован fallback/default',
        });
      }
      continue;
    }

    const formatError = checkFormat(spec, trimmed);
    if (formatError !== null) {
      errors.push({ key, message: formatError });
      continue;
    }

    if (spec.allowedValues && !spec.allowedValues.includes(trimmed)) {
      errors.push({
        key,
        message: `недопустимое значение "${trimmed}"; допустимые: ${spec.allowedValues.join(', ')}`,
      });
      continue;
    }

    if (isPlaceholder(trimmed)) {
      warnings.push({
        key,
        message:
          'значение похоже на placeholder из .env.template — замените на реальное',
      });
    }
  }

  return { ok: errors.length === 0, errors, warnings, missingKeys };
}

/** Подсказка для сообщений об ошибке */
export const ENV_FIX_HINT =
  'Скопируйте .env.template → .env и заполните обязательные ключи.';

/**
 * Проверить окружение и бросить понятную ошибку со списком проблем.
 * Используется в Node-входах (CLI, скрипты). В браузерном коде НЕ вызывается.
 */
export function assertEnvValid(env?: Record<string, string | undefined>): void {
  const result = validateEnv(env);
  if (result.ok) {
    return;
  }

  const lines = result.errors.map(
    (issue) => `  • ${issue.key}: ${issue.message}`,
  );
  const missing = result.missingKeys.length
    ? `\nНе заданы обязательные ключи: ${result.missingKeys.join(', ')}`
    : '';
  const hint = `\n\n${ENV_FIX_HINT}`;

  throw new Error(
    `Неверная конфигурация окружения (${result.errors.length} ошиб.):\n${lines.join('\n')}${missing}${hint}`,
  );
}
