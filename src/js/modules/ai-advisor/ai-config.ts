/**
 * Конфигурация ИИ-агентов для финансового анализа
 * Приоритет: Ollama (локально, без VPN) → GigaChat → OpenRouter → Fallback
 */

import axios from 'axios';
import type { OllamaModelInfo } from './ollama-manager';

export interface AiModelConfig {
  /** Уникальный идентификатор модели */
  id: string;
  /** Отображаемое имя */
  name: string;
  /** Базовый URL API */
  baseUrl: string;
  /** Имя модели в API */
  modelName: string;
  /** Максимальное количество токенов в ответе */
  maxTokens: number;
  /** Температура генерации (0-1) */
  temperature: number;
  /** Приоритет (меньше = выше) */
  priority: number;
  /** Требуется ли API-ключ */
  requiresKey: boolean;
  /** Ключ переменной окружения */
  envKey: string;
  /** Описание модели */
  description: string;
}

/** Список доступных моделей в порядке приоритета */
export const AI_MODELS: AiModelConfig[] = [
  {
    id: 'ollama',
    name: 'Ollama (локально)',
    baseUrl: 'http://localhost:11434/api/chat',
    modelName: 'qwen2.5:14b',
    maxTokens: 8192,
    temperature: 0.2,
    priority: 1,
    requiresKey: false,
    envKey: '',
    description:
      'Локальная модель, работает без VPN и ключей, полностью бесплатно. Усиленная версия 14B для более точного анализа.',
  },
  {
    id: 'gigachat',
    name: 'GigaChat (Сбер)',
    baseUrl: 'https://api.giga.chat/v1/chat/completions',
    modelName: 'GigaChat',
    maxTokens: 8192,
    temperature: 0.3,
    priority: 2,
    requiresKey: true,
    envKey: 'GIGACHAT_API_KEY',
    description:
      'Бесплатная модель от Сбера, работает в РФ без VPN',
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4 (OpenRouter)',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    modelName: 'anthropic/claude-sonnet-4',
    maxTokens: 8192,
    temperature: 0.3,
    priority: 3,
    requiresKey: true,
    envKey: 'OPENROUTER_API_KEY',
    description:
      'Лучшая модель для анализа (нужен VPN)',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o (OpenRouter)',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    modelName: 'openai/gpt-4o',
    maxTokens: 4096,
    temperature: 0.3,
    priority: 4,
    requiresKey: true,
    envKey: 'OPENROUTER_API_KEY',
    description:
      'Отличная модель для анализа (нужен VPN)',
  },
  {
    id: 'yandexgpt',
    name: 'YandexGPT (Яндекс Cloud)',
    baseUrl: 'https://llm.api.cloud.yandex.net/ai/v1/chatCompletions',
    modelName: 'yandexgpt-lite',
    maxTokens: 8192,
    temperature: 0.3,
    priority: 5,
    requiresKey: true,
    envKey: 'YANDEXGPT_API_KEY',
    description:
      'Бесплатный баланс 5000₽ в Yandex Cloud, работает в РФ',
  },
];

/** Текущая выбранная модель (можно переопределить через переменную окружения) */
const MODEL_OVERRIDE =
  process.env.AI_MODEL_ID ||
  AI_MODELS.find((m) => m.priority === 1)?.id ||
  'gigachat';

/** Настройка текущей модели */
export const CURRENT_AI_MODEL: AiModelConfig =
  AI_MODELS.find((m) => m.id === MODEL_OVERRIDE) || AI_MODELS[0];

/** Получить все доступные модели, отфильтровав те, для которых нет ключей */
export function getAvailableModels(): AiModelConfig[] {
  return AI_MODELS.filter((model) => {
    if (!model.requiresKey) return true;
    const key = process.env[model.envKey];
    return key && key.length > 0;
  });
}

/** Проверка, запущен ли Ollama */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const ollamaModel = AI_MODELS.find((m) => m.id === 'ollama');
    if (!ollamaModel) return false;
    
    const response = await axios.get(
      'http://localhost:11434/api/tags',
      { timeout: 3000 },
    );
    
    // Проверяем, что нужная модель установлена
    const models = response.data.models || [];
    return models.some((m: OllamaModelInfo) => m.name.includes(ollamaModel.modelName));
  } catch {
    return false;
  }
}

/**
 * Проверка доступности Ollama с расширенной информацией
 */
export async function getOllamaStatus(): Promise<{
  available: boolean;
  models: string[];
  recommendedModelInstalled: boolean;
}> {
  try {
    const response = await axios.get(
      'http://localhost:11434/api/tags',
      { timeout: 3000 },
    );
    
    const models = response.data.models || [];
    const modelNames = models.map((m: OllamaModelInfo) => m.name);
    
    const ollamaModel = AI_MODELS.find((m) => m.id === 'ollama');
    const recommendedModelInstalled = models.some(
      (m: OllamaModelInfo) => m.name.includes(ollamaModel?.modelName || ''),
    );
    
    return {
      available: true,
      models: modelNames,
      recommendedModelInstalled,
    };
  } catch {
    return {
      available: false,
      models: [],
      recommendedModelInstalled: false,
    };
  }
}

/** Получить следующую модель в очереди */
export function getNextModel(currentId: string): AiModelConfig | undefined {
  const available = getAvailableModels();
  const currentIndex = available.findIndex((m) => m.id === currentId);
  if (currentIndex < available.length - 1) {
    return available[currentIndex + 1];
  }
  return undefined;
}
