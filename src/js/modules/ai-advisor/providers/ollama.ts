/**
 * Ollama provider — запросы к локальной модели Ollama.
 *
 * Поддержка: стриминг, кэширование, fallback на обычный запрос.
 *
 * @module ai-advisor/providers/ollama
 */

import type { AiModelConfig } from '../ai-config.js';
import type { OllamaMessage } from '../ollama-manager.js';
import {
  isOllamaRunning,
  cleanAiResponse,
} from '../ollama-manager.js';
import { getCachedResponse } from '../ollama-cache.js';
import {
  streamChat,
  chatWithoutStream,
} from '../ollama-stream.js';
import { getLogger } from '../../logger/index.js';

const log = getLogger('ollama-provider');

/** Является ли ошибка Ollama транзиентной (стоит повторить запрос). */
function isTransientOllamaError(message?: string): boolean {
  if (!message) return false;
  return /50[0-9]|52[0-9]|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|socket hang up|EPIPE|keep-alive/i.test(
    message,
  );
}

/**
 * Выполнить запрос к Ollama (с кэшированием).
 */
export async function queryOllama(
  modelConfig: AiModelConfig,
  systemPrompt: string,
  userPrompt: string,
  assetTickers?: string[],
): Promise<string> {
  log.debug('[Ollama] Проверка подключения к localhost:11434...');

  const isRunning = await isOllamaRunning();
  log.debug('[Ollama] isOllamaRunning:', isRunning);
  if (!isRunning) {
    throw new Error('Ollama не запущен. Запустите Ollama на localhost:11434');
  }

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
  log.debug('[Ollama] fullPrompt length:', fullPrompt.length);

  log.debug('[Ollama] calling getCachedResponse...');
  const cachedResult = await getCachedResponse(
    fullPrompt,
    modelConfig.modelName,
    async () => {
      return await executeOllamaQuery(
        modelConfig,
        systemPrompt,
        userPrompt,
        assetTickers,
      );
    },
  );
  log.debug('[Ollama] getCachedResponse returned');

  return cachedResult.content;
}

/**
 * Выполнить запрос к Ollama (без кэширования).
 */
async function executeOllamaQuery(
  modelConfig: AiModelConfig,
  systemPrompt: string,
  userPrompt: string,
  assetTickers?: string[],
): Promise<string> {
  log.info(`[Ollama] Запрос к модели ${modelConfig.modelName}...`);

  const messages: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    log.debug('[Ollama] calling streamChat...');

    let streamResult = await streamChat(
      messages,
      modelConfig.modelName,
      {
        numPredict: modelConfig.maxTokens,
        temperature: modelConfig.temperature,
      },
      {
        timeout: 300000, // 5 минут
        stream: true,
      },
    );

    // Один ретрай на транзиентные сбои
    if (!streamResult.success && isTransientOllamaError(streamResult.error)) {
      log.warn(
        '[Ollama] ⚠️ Транзиентный сбой стриминга (' +
          (streamResult.error || 'ошибка') +
          '), повтор через 2 сек...',
      );
      await sleep(2000);
      streamResult = await streamChat(
        messages,
        modelConfig.modelName,
        {
          numPredict: modelConfig.maxTokens,
          temperature: modelConfig.temperature,
        },
        {
          timeout: 300000,
          stream: true,
        },
      );
    }

    log.info(
      '[Ollama] streamChat returned, success:',
      streamResult.success,
    );

    if (!streamResult.success) {
      throw new Error(streamResult.error || 'Ошибка стриминга');
    }

    log.debug('[Ollama] calling cleanAiResponse...');
    const cleanedResponse = cleanAiResponse(
      streamResult.content,
      assetTickers,
    );
    log.debug('[Ollama] cleanAiResponse returned');

    log.debug(
      '[Ollama] about to format stream stats, totalDuration:',
      streamResult.totalDuration,
    );

    log.info(
      `[Ollama] ✅ Ответ получен: ${streamResult.content.length} символов, ` +
        `duration=${formatDuration(streamResult.totalDuration)}`,
    );

    return cleanedResponse;
  } catch (error) {
    log.warn('[Ollama] ⚠️ Стриминг не удался, пробуем обычный запрос...');

    try {
      const result = await chatWithoutStream(
        messages,
        modelConfig.modelName,
        {
          numPredict: modelConfig.maxTokens,
          temperature: modelConfig.temperature,
        },
      );

      if (!result.success) {
        throw new Error(result.error || 'Ошибка запроса', { cause: error });
      }

      const cleanedResponse = cleanAiResponse(result.content, assetTickers);

      log.info(
        `[Ollama] ✅ Ответ получен: ${result.content.length} символов`,
      );

      return cleanedResponse;
    } catch (thrown: unknown) {
      if (thrown instanceof Error) {
        throw new Error(`Ollama не отвечает: ${thrown.message}`, {
          cause: thrown,
        });
      }
      throw new Error(`Ollama не отвечает: ${String(thrown)}`, {
        cause: thrown,
      });
    }
  }
}

function formatDuration(ns: number): string {
  const ms = ns / 1_000_000;
  if (ms < 1000) return `${ms.toFixed(0)}мс`;
  return `${(ms / 1000).toFixed(1)}с`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
