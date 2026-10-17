/**
 * GigaChat provider — запросы к GigaChat API (Сбер).
 *
 * Поддержка: Authorization Key + OAuth (ClientID:Secret).
 * Circuit breaker: SynGX (WAF Сбера) отвечает 429 на параллельные запросы.
 *
 * @module ai-advisor/providers/gigachat
 */

import axios from 'axios';
import { randomUUID } from 'node:crypto';
import https from 'https';
import type { AiModelConfig } from '../ai-config.js';
import { getLogger } from '../../logger/index.js';

const log = getLogger('gigachat');

/** Задержка для retry 429 (мс) */
const retryDelaysMs = [1000, 3000, 6000, 12000, 24000];

/**
 * Выполнить запрос к GigaChat API.
 * Сериализует запросы (один за раз) из-за SynGX WAF.
 */
export async function queryGigaChat(
  modelConfig: AiModelConfig,
  gigaChatKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  // Определяем тип ключа
  if (isAuthorizationKey(gigaChatKey)) {
    return queryGigaChatWithAuthKey(
      modelConfig,
      gigaChatKey,
      systemPrompt,
      userPrompt,
      httpsAgent,
    );
  }

  // Сериализуем запросы через очередь
  return executeWithQueue(async () => {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
      try {
        const token = await getGigaChatToken(gigaChatKey, httpsAgent);
        return await queryGigaChatCompletions(
          modelConfig,
          token,
          systemPrompt,
          userPrompt,
          httpsAgent,
        );
      } catch (error) {
        lastError = error;
        const err = error as Error & {
          response?: { status?: number; data?: unknown };
        };
        const status = err.response?.status;
        const isRateLimit = status === 429;
        if (!isRateLimit || attempt >= retryDelaysMs.length - 1) {
          log.error(
            '[GigaChat] chat/completions не удался: ' +
              `status=${status ?? '?'} body=${formatErrorBody(err.response?.data) || (error instanceof Error ? error.message : String(error))}`,
          );
          throw error;
        }
        const delayMs = retryDelaysMs[attempt]!;
        log.warn(
          `[GigaChat] 429 Too Many Requests — повтор через ${delayMs}мс (попытка ${attempt + 1}/${retryDelaysMs.length})`,
        );
        await sleep(delayMs);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('GigaChat не удался (все попытки)');
  });
}

/**
 * Выполнить запрос с Authorization Key.
 */
async function queryGigaChatWithAuthKey(
  modelConfig: AiModelConfig,
  gigaChatKey: string,
  systemPrompt: string,
  userPrompt: string,
  httpsAgent: https.Agent,
): Promise<string> {
  log.info('[GigaChat] Использование Authorization Key...');

  try {
    const response = await axios.post(
      'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
      {
        model: 'GigaChat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: modelConfig.maxTokens,
        temperature: modelConfig.temperature,
        stream: false,
      },
      {
        headers: {
          Authorization: 'Bearer ' + gigaChatKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          RqUID: Date.now().toString(),
        },
        httpsAgent,
        timeout: 60000,
      },
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    const err = error as Error & {
      response?: { status?: number; data?: unknown };
    };
    log.error(
      '[GigaChat] Authorization Key запрос не удался: ' +
        `status=${err.response?.status ?? '?'} body=${formatErrorBody(err.response?.data) || (error instanceof Error ? error.message : String(error))}`,
    );
    throw error;
  }
}

/**
 * Выполнить /chat/completions с OAuth токеном.
 */
async function queryGigaChatCompletions(
  modelConfig: AiModelConfig,
  accessToken: string,
  systemPrompt: string,
  userPrompt: string,
  httpsAgent: https.Agent,
): Promise<string> {
  const response = await axios.post(
    'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
    {
      model: modelConfig.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature,
      stream: false,
    },
    {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        RqUID: randomUUID(),
      },
      httpsAgent,
      timeout: 60000,
    },
  );

  return response.data.choices[0].message.content;
}

/**
 * Получить OAuth токен (с кэшированием на 90 секунд).
 */
let gigaChatToken: string | null = null;
let gigaChatTokenExpiry = 0;
let gigaChatTokenPromise: Promise<string> | null = null;

async function getGigaChatToken(
  gigaChatKey: string,
  httpsAgent: https.Agent,
): Promise<string> {
  // Возвращаем кэш если ещё действителен
  if (gigaChatToken && Date.now() < gigaChatTokenExpiry) {
    return gigaChatToken;
  }

  // Если уже идёт запрос — ждём
  if (gigaChatTokenPromise) {
    return gigaChatTokenPromise;
  }

  gigaChatTokenPromise = fetchGigaChatToken(gigaChatKey, httpsAgent).finally(
    () => {
      gigaChatTokenPromise = null;
    },
  );

  return gigaChatTokenPromise;
}

async function fetchGigaChatToken(
  gigaChatKey: string,
  httpsAgent: https.Agent,
): Promise<string> {
  const decodedKey = Buffer.from(gigaChatKey, 'base64').toString('utf-8');
  if (!decodedKey.includes(':')) {
    throw new Error(
      'GIGACHAT_API_KEY не похож на ClientID:Secret (base64). ' +
        'Проверьте формат ключа в кабинете developers.sber.ru',
    );
  }
  const [clientId, clientSecret] = decodedKey.split(':');
  const auth = Buffer.from(clientId + ':' + clientSecret).toString('base64');

  log.info(
    `[GigaChat] Ключ: OAuth (ClientID:Secret), длина=${gigaChatKey.length}, ` +
      `префикс=${gigaChatKey.slice(0, 4)}...`,
  );

  const scopes: string[] = process.env.GIGACHAT_SCOPE
    ? [process.env.GIGACHAT_SCOPE]
    : ['GIGACHAT_API_PERS', 'GIGACHAT_API_CORP'];

  let lastError: unknown = null;
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i]!;
    if (i > 0) await sleep(1500);
    try {
      log.debug(`[GigaChat] Получение OAuth токена (scope=${scope})...`);

      const oauthResponse = await axios.post(
        'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
        `scope=${scope}`,
        {
          headers: {
            Authorization: 'Basic ' + auth,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            RqUID: randomUUID(),
          },
          httpsAgent,
          timeout: 30000,
        },
      );

      const accessToken = oauthResponse.data.access_token;
      if (!accessToken) {
        throw new Error('OAuth токен не получен');
      }

      // Кэшируем токен на 90 секунд
      gigaChatToken = accessToken;
      gigaChatTokenExpiry = Date.now() + 90000;

      log.info(
        `[GigaChat] ✅ Токен получен (scope=${scope}, действует 90 сек)`,
      );
      return accessToken;
    } catch (error) {
      lastError = error;
      const err = error as Error & {
        response?: { status?: number; data?: unknown };
      };
      log.error(
        `[GigaChat] OAuth scope=${scope} не удался: ` +
          `status=${err.response?.status ?? '?'} body=${formatErrorBody(err.response?.data) || (error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('OAuth GigaChat не удался (все scope)');
}

/**
 * Выполнить функцию с очередью (один запрос за раз).
 */
let gigaChatChatQueue: Promise<unknown> = Promise.resolve();

async function executeWithQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = (): Promise<T> => fn();
  gigaChatChatQueue = gigaChatChatQueue.then(() => run(), () => run());
  return gigaChatChatQueue as Promise<T>;
}

/**
 * Проверить, является ли ключ Authorization Key (не base64 ClientID:Secret).
 */
function isAuthorizationKey(key: string): boolean {
  try {
    const decoded = Buffer.from(key, 'base64').toString('utf-8');
    return !decoded.includes(':');
  } catch {
    return true;
  }
}

/**
 * Форматировать тело ошибки.
 */
function formatErrorBody(data: unknown): string {
  if (typeof data === 'string') return data;
  if (typeof data === 'object' && data !== null) {
    try {
      return JSON.stringify(data);
    } catch {
      return String(data);
    }
  }
  return String(data);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
