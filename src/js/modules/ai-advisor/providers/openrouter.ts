/**
 * OpenRouter provider — запросы к моделям через OpenRouter API.
 *
 * Поддерживаемые модели: Claude, GPT и другие через统一 endpoint.
 *
 * @module ai-advisor/providers/openrouter
 */

import axios from 'axios';
import https from 'https';
import type { AiModelConfig } from '../ai-config.js';
import { getLogger } from '../../logger/index.js';

const log = getLogger('openrouter');

/**
 * Выполнить запрос к OpenRouter API.
 */
export async function queryOpenRouter(
  modelConfig: AiModelConfig,
  openRouterKey: string,
  systemPrompt: string,
  userPrompt: string,
  httpsAgent?: https.Agent,
): Promise<string> {
  if (!openRouterKey) {
    throw new Error('OPENROUTER_API_KEY не настроен');
  }

  const agent = httpsAgent ?? new https.Agent({ rejectUnauthorized: false });

  log.debug('[OPENROUTER] Sending request to:', modelConfig.baseUrl);
  log.debug('[OPENROUTER] Model:', modelConfig.modelName);
  log.debug(
    '[OPENROUTER] Key prefix:',
    openRouterKey.substring(0, 15) + '...',
  );

  const response = await axios.post(
    modelConfig.baseUrl,
    {
      model: modelConfig.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature,
    },
    {
      headers: {
        Authorization: 'Bearer ' + openRouterKey,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/finance-analyzer',
        'X-Title': 'Finance Analyzer',
      },
      httpsAgent: agent,
      timeout: 120000,
    },
  );

  log.info('[OPENROUTER] ✅ Response received, status:', response.status);
  return response.data.choices[0].message.content;
}
