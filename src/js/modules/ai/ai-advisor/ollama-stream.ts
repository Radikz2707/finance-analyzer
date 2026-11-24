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
  /** Таймаут в миллисекундах (применяется к установке соединения) */
  timeout?: number;
  /**
   * Таймаут на ОБЩУЮ длительность чтения стрима (мс).
   * axios timeout не применяется к чтению потока — без этого лимита
   * медленная модель может генерировать ответ бесконечно долго.
   * По умолчанию 10 минут.
   */
  streamTimeout?: number;
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
  /** Количество токенов во входном промпте (prompt_eval_count) */
  promptTokens?: number;
  /** Время генерации в миллисекундах */
  totalDuration: number;
  /** Загрузка модели в миллисекундах */
  loadDuration: number;
  /** Успешность */
  success: boolean;
  /** Сообщение об ошибке (если success = false) */
  error?: string;
  /** Причина завершения генерации: stop / length / abort */
  doneReason?: string;
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
    timeout = 1800000, // 30 минут (соединение; для не-стрима — весь запрос)
    streamTimeout = 1800000, // 30 минут (общая длительность чтения стрима)
    stream = true,
  } = streamOptions;

  const startTime = Date.now();
  let fullContent = '';
  let totalTokens = 0;
  let promptTokens = 0;
  let totalDuration = 0;
  let loadDuration = 0;
  let chunksReceived = 0;
  let doneReason: string | undefined;
  let thinkingChars = 0;

  // ─── Line buffer: Node.js stream буферизует данные произвольными чанками.
  //     JSON-объекты могут быть разорваны между чанками или объединены в один.
  //     Надёжный подход: аккумулируем сырые байты, делим по '\n',
  //     последний (неполный) фрагмент оставляем для следующего чанка.
  let lineBuffer = '';

  try {
    if (onStatus) {
      onStatus('Отправка запроса...');
    }

    let response;
    try {
      console.log('[STREAM] calling axios.post...');
      const requestBody = {
        model: modelName,
        messages,
        stream,
        format: options.jsonSchema,
        think: false,
        keep_alive: options.keepAlive ?? '60m',
        options: {
          num_predict: options.numPredict || 8192,
          // Явное контекстное окно: без него Ollama берёт полный контекст
          // модели (у qwen3.6:35b-a3b это 262144) → огромный KV-cache → OOM.
          // 32768 согласовано с num_predict 32768 и объёмом
          // промпта (~16k после чистки мусора):
          // 16k + 8k = 24k, запас ~8k. При ошибке нехватки VRAM — fallback на 16384.
          num_ctx: options.numCtx || 20480,
          temperature: options.temperature ?? 0.2,
          top_p: options.topP || 0.9,
          top_k: options.topK || 40,
          seed: options.seed ?? 42,
          frequency_penalty: options.frequencyPenalty || 0,
          presence_penalty: options.presencePenalty || 0,
        },
      };
      // Лог для отладки: фактические параметры запроса
      console.log(
        `[OLLAMA_OPTIONS] temperature=${requestBody.options.temperature} ` +
          `seed=${requestBody.options.seed} ` +
          `num_ctx=${requestBody.options.num_ctx} ` +
          `num_predict=${requestBody.options.num_predict}`,
      );
      // Лог requestBody.options перед axios.post — для детерминизма
      console.log(
        `[OLLAMA_REQUEST] options=${JSON.stringify({
          temperature: requestBody.options.temperature,
          seed: requestBody.options.seed,
          num_ctx: requestBody.options.num_ctx,
          num_predict: requestBody.options.num_predict,
          top_p: requestBody.options.top_p,
          top_k: requestBody.options.top_k,
        })}`,
      );
      // Лог для отладки: format и think должны быть на верхнем уровне
      // console.log('[STREAM] Request body:', JSON.stringify(requestBody, null, 2));
      response = await axios.post(
        `${OLLAMA_BASE_URL}/api/chat`,
        requestBody,
        {
          timeout,
          responseType: stream ? 'stream' : 'json',
        },
      );
      console.log('[STREAM] axios.post returned');
    } catch (axiosError) {
      // Логируем тело ответа — там реальная причина 4xx/5xx от Ollama
      // (например «context length exceeded» или «model not found»).
      // Без body диагностировать сбой невозможно.
      const err = axiosError as Error & {
        response?: { status?: number; data?: unknown };
        code?: string;
      };
      if (err.response) {
        let body = '';
        try {
          body =
            typeof err.response.data === 'string'
              ? err.response.data.slice(0, 500)
              : JSON.stringify(err.response.data, null, 2).slice(0, 500);
        } catch {
          body = '<не удалось сериализовать body>';
        }
        console.error(
          `[AXIOS_ERROR] status=${err.response.status ?? '?'} code=${err.code ?? '-'} body=${body || '<пусто>'}`,
        );
      } else {
        console.error(
          '[AXIOS_ERROR] MESSAGE:',
          axiosError instanceof Error ? axiosError.message : String(axiosError),
        );
      }
      throw axiosError;
    }

    if (stream && response.data) {
      if (onStatus) {
        onStatus('Получение ответа от модели...');
      }

      return new Promise((resolve) => {
        // ─── Debug: первый чанк ───
        let firstChunkLogged = false;

        // Защита от двойного resolve (таймаут + end/error)
        let settled = false;
        const settle = (result: StreamResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(streamTimer);
          resolve(result);
        };

        // ─── Таймаут общей длительности стрима ───
        // axios timeout применяется только к установке соединения; чтение
        // потока без лимита может длиться бесконечно на медленной модели.
        const streamTimer = setTimeout(() => {
          console.error(
            `[Ollama Stream] ❌ Таймаут стрима: ${streamTimeout}мс превышен ` +
              `(чанков=${chunksReceived}, fullContent=${fullContent.length}, thinking=${thinkingChars})`,
          );
          response.data.destroy();
          settle({
            content: fullContent || 'Ошибка получения ответа',
            model: modelName,
            totalTokens,
            totalDuration,
            loadDuration,
            success: false,
            error: `Stream timeout after ${streamTimeout}ms`,
          });
        }, streamTimeout);

        response.data.on('data', (chunk: Buffer) => {
          chunksReceived++;

          // Debug: ПЕРВЫЙ полученный chunk
          if (!firstChunkLogged) {
            firstChunkLogged = true;
            console.debug('[OLLAMA_DEBUG] first chunk type:', typeof chunk);
            console.debug(
              '[OLLAMA_DEBUG] first chunk:',
              String(chunk).slice(0, 1000),
            );
          }

          // Аккумулируем в line buffer
          lineBuffer += chunk.toString();

          // Делим по '\n'
          const lines = lineBuffer.split('\n');
          // Последний элемент может быть неполной строкой — оставляем в буфере
          lineBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const json = JSON.parse(line);

              // Debug: логируем первый распаршенный JSON
              if (chunksReceived === 1 && !firstChunkLogged) {
                console.debug(
                  '[OLLAMA_DEBUG] first parsed JSON keys:',
                  Object.keys(json),
                );
              }

              // Добавляем контент к полному ответу
              if (json.message?.content) {
                fullContent += json.message.content;

                if (onChunk) {
                  try {
                    onChunk(json.message.content);
                  } catch {
                    // Убран verbose-лог
                  }
                }
              }

              // Считаем символы в буфере рассуждений (thinking)
              if (json.message?.thinking) {
                thinkingChars += json.message.thinking.length;
              }

              // Сохраняем done_reason из финального чанка
              if (json.done && json.done_reason != null) {
                doneReason = String(json.done_reason);
              }

              // Собираем статистику из последнего сообщения.
              // Ollama в финальном чанке возвращает eval_count (число
              // сгенерированных токенов), а не total_tokens — иначе 0.
              // total_duration и load_duration — в наносекундах от Ollama,
              // сохраняем сразу в миллисекундах для единообразия.
              if (json.done) {
                totalTokens = json.eval_count ?? json.total_tokens ?? 0;
                promptTokens = json.prompt_eval_count ?? promptTokens;
                totalDuration = (json.total_duration || 0) / 1e6; // нс → мс
                loadDuration = (json.load_duration || 0) / 1e6; // нс → мс
              }
            } catch {
              // Игнорируем не-JSON данные
            }
          }

          // Прогресс-лог каждые 500 чанков
          if (chunksReceived % 500 === 0) {
            const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
            const elapsedNum = parseFloat(elapsedSec);
            const speed =
              elapsedNum > 0 ? (chunksReceived / elapsedNum).toFixed(1) : '0';
            console.log(
              `[Ollama Stream] 📊 Прогресс: чанков=${chunksReceived}, ` +
                `время=${elapsedSec}с, скорость=${speed} чанков/с, ` +
                `fullContent=${fullContent.length} символов, ` +
                `thinking=${thinkingChars} символов`,
            );
          }
        });

        response.data.on('end', () => {
          // Обрабатываем оставшийся буфер (последняя строка без '\n')
          if (lineBuffer.trim()) {
            try {
              const json = JSON.parse(lineBuffer);
              if (json.message?.content) {
                fullContent += json.message.content;
              }
              if (json.done) {
                totalTokens = json.eval_count ?? json.total_tokens ?? 0;
                promptTokens = json.prompt_eval_count ?? promptTokens;
                totalDuration = (json.total_duration || 0) / 1e6; // нс → мс
                loadDuration = (json.load_duration || 0) / 1e6; // нс → мс
              }
            } catch {
              // Игнорируем
            }
          }

          const elapsed = Date.now() - startTime;
          console.log(
            `[Ollama Stream] ✅ Ответ получен за ${elapsed}мс | ` +
              `fullContent=${fullContent.length} символов | ` +
              `prompt_eval_count=${promptTokens} токенов | ` +
              `eval_count=${totalTokens} токенов | ` +
              `done_reason=${doneReason || 'no_done_chunk'} | ` +
              `${chunksReceived} чанков | ` +
              `total_duration=${totalDuration.toFixed(1)}мс`,
          );

          settle({
            content: fullContent,
            model: modelName,
            totalTokens,
            promptTokens,
            totalDuration,
            loadDuration,
            success: true,
            doneReason: doneReason || undefined,
          });
        });

        response.data.on('error', (err: Error) => {
          // Убран verbose-лог
          // console.error('[STREAM_ERROR_EVENT] FULL:', err);
          // console.error('[STREAM_ERROR_EVENT] STACK:', err.stack);
          console.error('[Ollama Stream] ❌ Ошибка потока:', err.message);
          settle({
            content: fullContent || 'Ошибка получения ответа',
            model: modelName,
            totalTokens,
            totalDuration,
            loadDuration,
            success: false,
            error: err.message,
          });
        });
      });
    } else if (!stream && response.data) {
      // Нестриминговый режим — total_duration/ load_duration в нс → мс.
      const content = response.data.message?.content || '';
      totalTokens = response.data.eval_count ?? response.data.total_tokens ?? 0;
      promptTokens = response.data.prompt_eval_count ?? 0;
      totalDuration = (response.data.total_duration || 0) / 1e6; // нс → мс
      loadDuration = (response.data.load_duration || 0) / 1e6; // нс → мс

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

  const timeSeconds = (result.totalDuration / 1_000).toFixed(2);
  const tokensPerSecond =
    result.totalDuration > 0
      ? (result.totalTokens / (result.totalDuration / 1_000)).toFixed(1)
      : '0';

  return [
    '✅ Ответ сгенерирован',
    '📝 Токенов: ' + result.totalTokens,
    '⏱️ Время: ' + timeSeconds + 'с',
    '🚀 Скорость: ' + tokensPerSecond + ' токенов/с',
    '📊 Загрузка модели: ' +
      (result.loadDuration / 1_000).toFixed(2) +
      'с',
  ].join('\n');
}
