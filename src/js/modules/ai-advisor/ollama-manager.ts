/**
 * Модуль управления моделями Ollama
 * Предоставляет функции для работы с локальными AI-моделями
 */

import axios from 'axios';

/** Информация о модели Ollama */
export interface OllamaModelInfo {
  /** Имя модели */
  name: string;
  /** ID модели */
  model: string;
  /** Размер в байтах */
  size: number;
  /** Дайджест модели */
  digest: string;
  /** Параметры модели */
  details?: {
    parentModel: string;
    format: string;
    family: string;
    families: string[];
    parameterSize: string;
    quantizationLevel: string;
  };
}

/** Ответ API Ollama на запрос /api/tags */
export interface OllamaTagsResponse {
  models: OllamaModelInfo[];
}

/** Ответ API Ollama на запрос /api/show */
export type OllamaShowResponse = Record<string, unknown>;

/** Параметры запроса к Ollama */
export interface OllamaChatOptions {
  /** Максимальное количество токенов в ответе */
  numPredict?: number;
  /** Температура генерации (0-1) */
  temperature?: number;
  /** Top-p для выборки */
  topP?: number;
  /** Top-k для выборки */
  topK?: number;
  /** Системный промпт */
  system?: string;
  /** Частота_penalty */
  frequencyPenalty?: number;
  /** Presence penalty */
  presencePenalty?: number;
}

/** Сообщение в чате */
export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Базовый URL API Ollama */
export const OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * Проверка доступности Ollama
 */
export async function isOllamaRunning(): Promise<boolean> {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, {
      timeout: 3000,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Получение списка установленных моделей
 */
export async function listModels(): Promise<OllamaModelInfo[]> {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, {
      timeout: 5000,
    });
    return response.data.models || [];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Ollama] Ошибка получения списка моделей:', errorMessage);
    return [];
  }
}

/**
 * Получение информации о конкретной модели
 */
export async function showModelInfo(modelName: string): Promise<OllamaShowResponse | null> {
  try {
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/show`, {
      model: modelName,
    }, {
      timeout: 5000,
    });
    return response.data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Ollama] Ошибка получения информации о модели ${modelName}:`, errorMessage);
    return null;
  }
}

/**
 * Проверка, установлена ли конкретная модель
 */
export async function isModelInstalled(modelName: string): Promise<boolean> {
  const models = await listModels();
  return models.some((m) => m.name.includes(modelName));
}

/**
 * Установка модели Ollama
 */
export async function pullModel(
  modelName: string,
  onProgress?: (status: string, completed: number, total: number) => void,
): Promise<boolean> {
  try {
    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/pull`,
      { name: modelName, stream: true },
      {
        timeout: 300000, // 5 минут на скачивание
        responseType: 'stream',
      },
    );

    return new Promise((resolve) => {
      let currentStatus = '';
      let total = 0;
      let completed = 0;

      response.data.on('data', (chunk: Buffer) => {
        try {
          const lines = chunk.toString().split('\n');
          lines.forEach((line) => {
            if (!line.trim()) return;
            
            try {
              const json = JSON.parse(line);
              const newStatus = json.status || '';
              
              // Обновляем прогресс
              if (json.total && json.completed) {
                total = json.total;
                completed = json.completed;
                const percent = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
                
                if (newStatus !== currentStatus) {
                  currentStatus = newStatus;
                  console.log(
                    `[Ollama] ${newStatus} ${modelName}: ${percent}%`,
                  );
                }
                
                if (onProgress) {
                  onProgress(newStatus, completed, total);
                }
              } else if (newStatus && newStatus !== currentStatus) {
                currentStatus = newStatus;
                console.log(`[Ollama] ${newStatus} ${modelName}`);
                
                if (onProgress) {
                  onProgress(newStatus, completed, total);
                }
              }
            } catch {
              // Игнорируем не-JSON данные
            }
          });
        } catch {
          // Игнорируем ошибки парсинга
        }
      });

      response.data.on('end', () => {
        console.log(`[Ollama] ✅ Модель ${modelName} успешно установлена`);
        resolve(true);
      });

      response.data.on('error', (err: Error) => {
        console.error(`[Ollama] ❌ Ошибка установки модели ${modelName}:`, err.message);
        resolve(false);
      });
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Ollama] ❌ Критическая ошибка при установке модели ${modelName}:`, errorMessage);
    return false;
  }
}

/**
 * Удаление модели Ollama
 */
export async function deleteModel(modelName: string): Promise<boolean> {
  try {
    await axios.delete(`${OLLAMA_BASE_URL}/api/delete`, {
      data: { model: modelName },
      timeout: 5000,
    });
    console.log(`[Ollama] ✅ Модель ${modelName} удалена`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Ollama] ❌ Ошибка удаления модели ${modelName}:`, errorMessage);
    return false;
  }
}

/**
 * Создание копии модели
 */
export async function copyModel(
  sourceName: string,
  destinationName: string,
): Promise<boolean> {
  try {
    await axios.post(`${OLLAMA_BASE_URL}/api/copy`, {
      source: sourceName,
      destination: destinationName,
    }, {
      timeout: 10000,
    });
    console.log(`[Ollama] ✅ Модель ${sourceName} скопирована в ${destinationName}`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      '[Ollama] ❌ Ошибка копирования модели:',
      errorMessage,
    );
    return false;
  }
}

/**
 * Генерация чистого текста из сообщения (без markdown-форматирования)
 * Усиленная версия: удаление артефактов, валидация структуры
 */
export function cleanAiResponse(text: string, assetTickers?: string[]): string {
  let cleaned = text;

  // Удаляем артефакты типа "$1.", "$2." и т.д. — в начале строки или после переноса
  cleaned = cleaned.replace(/\$[\d]+\. /g, '');
  cleaned = cleaned.replace(/\$[\d]+.\n/g, '\n');
  cleaned = cleaned.replace(/\$\d+\./g, '');

  // Удаляем markdown заголовки
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

  // Удаляем markdown жирный текст, оставляем текст
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');

  // Удаляем markdown курсив
  cleaned = cleaned.replace(/\*(.*?)\*/g, '$1');

  // Удаляем markdown код
  cleaned = cleaned.replace(/`(.*?)`/g, '$1');

  // Удаляем markdown ссылки, оставляем текст
  cleaned = cleaned.replace(/\[(.*?)\]\(.*?\)/g, '$1');

  // Удаляем markdown цитаты
  cleaned = cleaned.replace(/^>\s*/gm, '');

  // Удаляем markdown списки
  cleaned = cleaned.replace(/^[\s]*[-*+]\s/gm, '• ');
  cleaned = cleaned.replace(/^[\s]*\d+\.\s/gm, (match) => {
    // Сохраняем нумерацию для секций
    return match;
  });

  // Удаляем подозрительные артефакты в тексте
  cleaned = cleaned.replace(/\$\d+/g, '');

  // Удаляем лишние пустые строки
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  cleaned = cleaned.trim();

  // Валидация: проверяем что модель не упоминает неизвестные тикеры
  if (assetTickers && assetTickers.length > 0) {
    cleaned = validateAssetReferences(cleaned, assetTickers);
  }

  return cleaned;
}

/**
 * Валидация: проверяем что модель не упоминает компании извне портфеля
 * Удаляем или помечаем рекомендации по неизвестным тикерам
 */
function validateAssetReferences(
  text: string,
  knownTickers: string[],
): string {
  const lines = text.split('\n');
  const validatedLines: string[] = [];

  for (const line of lines) {
    // Проверяем строки с тикерами в таблицах
    const tickerMatch = line.match(/\|\s*([A-Z]{2,6})\s*\|/);
    if (tickerMatch) {
      const ticker = tickerMatch[1];
      const isKnown = knownTickers.some(
        (kt) => kt.toUpperCase() === ticker.toUpperCase(),
      );
      if (!isKnown) {
        // Помечаем строку как подозрительную
        validatedLines.push(`⚠️ [НЕ ПОДТВЕРЖДЕНО] ${line}`);
        continue;
      }
    }
    validatedLines.push(line);
  }

  return validatedLines.join('\n');
}

/**
 * Форматирование размера в читаемом виде
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Форматирование информации о моделях для вывода
 */
export function formatModelList(models: OllamaModelInfo[]): string {
  if (models.length === 0) {
    return 'Установлено 0 моделей Ollama';
  }

  const lines = [`Установлено моделей Ollama: ${models.length}`];
  lines.push('─'.repeat(60));

  models.forEach((model, index) => {
    const sizeStr = formatFileSize(model.size);
    const params = model.details?.parameterSize || 'N/A';
    const quant = model.details?.quantizationLevel || 'N/A';
    
    lines.push(
      `${index + 1}. ${model.name} (${sizeStr}, ${params}, ${quant})`,
    );
  });

  return lines.join('\n');
}
