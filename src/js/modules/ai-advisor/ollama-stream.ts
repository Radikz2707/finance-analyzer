/**
 * Модуль стриминга ответов от Ollama
 * Поддерживает потоковую передачу ответов в реальном времени
 */

import axios from 'axios';
import {
  OllamaMessage,
  OllamaChatOptions,
  OLLAMA_BASE_URL,
} from './ollama-manager.js';

/** Колбэк для получения частей ответа */
export type StreamChunkCallback = (chunk: string) => void;

/** Колбэк для получения статуса */
export type StreamStatusCallback = (status: string) => void;

/** Параметры стриминга */
export interface StreamOptions {
  /** Колбэк для получения частей ответа */
  onChunk?: StreamChunkCallback;
  /** Колбэк для получения статуса */
  onStatus?: StreamStatusCallback;
  /** Таймаут в миллисекундах */
  timeout?: number;
  /** Флаг использования стриминга */
  stream?: boolean;
}

/** Результат стриминга */
export interface StreamResult {
  /** Полный ответ */
  content: string;
  /** Использованная модель */
  model: string;
  /** Количество сгенерированных токенов */
  totalTokens: number;
  /** Время генерации в миллисекундах */
  totalDuration: number;
  /** Загрузка модели в миллисекундах */
  loadDuration: number;
  /** Успешность */
  success: boolean;
  /** Сообщение об ошибке (если success = false) */
  error?: string;
}

/**
 * Отправка запроса к Ollama со стримингом
 */
export async function streamChat(
  messages: OllamaMessage[],
  modelName: string,
  options: OllamaChatOptions = {},
  streamOptions: StreamOptions = {},
): Promise<StreamResult> {
  const {
    onChunk,
    onStatus,
    timeout = 300000, // 5 минут
    stream = true,
  } = streamOptions;

  const startTime = Date.now();
  let fullContent = '';
  let totalTokens = 0;
  let totalDuration = 0;
  let loadDuration = 0;

  try {
    if (onStatus) {
      onStatus('Отправка запроса...');
    }

    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/chat`,
      {
        model: modelName,
        messages,
        stream,
        options: {
          num_predict: options.numPredict || 4096,
          temperature: options.temperature || 0.3,
          top_p: options.topP || 0.9,
          top_k: options.topK || 40,
          frequency_penalty: options.frequencyPenalty || 0,
          presence_penalty: options.presencePenalty || 0,
        },
      },
      {
        timeout,
        responseType: stream ? 'stream' : 'json',
      },
    );

    if (stream && response.data) {
      if (onStatus) {
        onStatus('Получение ответа от модели...');
      }

      return new Promise((resolve) => {
        response.data.on('data', (chunk: Buffer) => {
          try {
            const lines = chunk.toString().split('\n');
            
            lines.forEach((line) => {
              if (!line.trim()) return;

              try {
                const json = JSON.parse(line);
                
                // Добавляем контент к полному ответу
                if (json.message?.content) {
                  fullContent += json.message.content;
                  
                  if (onChunk) {
                    onChunk(json.message.content);
                  }
                }

                // Собираем статистику из последнего сообщения
                if (json.done) {
                  totalTokens = json.total_tokens || 0;
                  totalDuration = json.total_duration || 0;
                  loadDuration = json.load_duration || 0;
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
          const elapsed = Date.now() - startTime;
          console.log(
            `[Ollama Stream] ✅ Ответ получен за ${elapsed}мс (${fullContent.length} символов, ${totalTokens} токенов)`,
          );

          resolve({
            content: fullContent,
            model: modelName,
            totalTokens,
            totalDuration,
            loadDuration,
            success: true,
          });
        });

        response.data.on('error', (err: Error) => {
          console.error('[Ollama Stream] ❌ Ошибка потока:', err.message);
          resolve({
            content: fullContent || 'Ошибка получения ответа',
            model: modelName,
            totalTokens: 0,
            totalDuration: 0,
            loadDuration: 0,
            success: false,
            error: err.message,
          });
        });
      });
    } else if (!stream && response.data) {
      // Нестриминговый режим
      const content = response.data.message?.content || '';
      totalTokens = response.data.total_tokens || 0;
      totalDuration = response.data.total_duration || 0;
      loadDuration = response.data.load_duration || 0;

      fullContent = content;

      if (onChunk) {
        onChunk(content);
      }

      return {
        content,
        model: modelName,
        totalTokens,
        totalDuration,
        loadDuration,
        success: true,
      };
    }

    return {
      content: '',
      model: modelName,
      totalTokens: 0,
      totalDuration: 0,
      loadDuration: 0,
      success: false,
      error: 'Нет данных в ответе',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Ollama Stream] ❌ Критическая ошибка:', errorMessage);

    if (onStatus) {
      onStatus('Ошибка: ' + errorMessage);
    }

    return {
      content: fullContent || 'Ошибка получения ответа',
      model: modelName,
      totalTokens: 0,
      totalDuration: 0,
      loadDuration: 0,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Отправка запроса к Ollama без стриминга (синхронный режим)
 */
export async function chatWithoutStream(
  messages: OllamaMessage[],
  modelName: string,
  options: OllamaChatOptions = {},
): Promise<StreamResult> {
  return streamChat(messages, modelName, options, { stream: false });
}

/**
 * Создание индикатора загрузки для стриминга
 */
export function createLoadingIndicator(onStatus: StreamStatusCallback) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let interval: NodeJS.Timeout;

  const showLoading = () => {
    interval = setInterval(() => {
      const frame = frames[frameIndex % frames.length];
      frameIndex++;
      onStatus(`${frame} генерация ответа...`);
    }, 100);
  };

  const stopLoading = () => {
    clearInterval(interval);
  };

  return { showLoading, stopLoading };
}

/**
 * Форматирование статистики стриминга
 */
export function formatStreamStats(result: StreamResult): string {
  if (!result.success) {
    return '❌ Ошибка генерации ответа';
  }

  const timeSeconds = (result.totalDuration / 1_000_000_000).toFixed(2);
  const tokensPerSecond = result.totalDuration > 0
    ? (result.totalTokens / (result.totalDuration / 1_000_000_000)).toFixed(1)
    : '0';

  return [
    '✅ Ответ сгенерирован',
    '📝 Токенов: ' + result.totalTokens,
    '⏱️ Время: ' + timeSeconds + 'с',
    '🚀 Скорость: ' + tokensPerSecond + ' токенов/с',
    '📊 Загрузка модели: ' + (result.loadDuration / 1_000_000_000).toFixed(2) + 'с',
  ].join('\n');
}
