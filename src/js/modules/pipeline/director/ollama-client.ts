/**
 * OllamaClient — клиент для общения с локальной LLM через Ollama.
 *
 * Используется для генерации естественных ответов Director.
 */

import { OLLAMA_MODEL_NAME } from '../../ai-advisor/ollama-model.js';

const OLLAMA_HOST = 'http://localhost:11434';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

export interface OllamaConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  /**
   * Режим «размышлений» thinking-моделей (qwen3.5 и т.п.).
   * По умолчанию ВЫКЛЮЧЕН: thinking тратит сотни токенов на рассуждения
   * перед ответом — на CPU это минуты вместо секунд. Для сложных решений
   * можно включить (think: true).
   */
  think?: boolean;
  /**
   * Сколько Ollama держит модель в памяти после запроса (keep_alive).
   * По умолчанию «30m»: без этого модель выгружается и каждый холодный
   * запрос платит 15–20 с за загрузку с диска (замер: load_duration).
   * «-1» — держать всегда.
   */
  keepAlive?: string;
}

/**
 * OllamaClient — клиент для общения с Ollama.
 */
export class OllamaClient {
  private model: string;
  private temperature: number;
  private maxTokens: number;

  private think: boolean;
  private keepAlive: string;

  constructor(config: OllamaConfig = {}) {
    // Модель из единой точки (env OLLAMA_MODEL) — см. ollama-model.ts
    this.model = config.model || OLLAMA_MODEL_NAME;
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 4000;
    this.think = config.think ?? false;
    // ⚠️ keep_alive: 5 минут вместо 30m — экономит ~20 ГБ RAM.
    // Модель выгружается быстрее, но холодный запуск добавляет ~15-20с.
    // Для частых запросов (чат с Director) можно увеличить до 10m.
    this.keepAlive = OllamaClient.normalizeKeepAlive(
      config.keepAlive ?? process.env.OLLAMA_KEEP_ALIVE ?? '5m',
    );
  }

  /**
   * Нормализовать keep_alive к формату, который принимает Ollama.
   * Ollama ждёт duration-строку С единицей («30m», «-1s»): значение «-1»
   * из env/конфига без единицы приводит к 400
   * «time: missing unit in duration "-1"». Голое число (например «-1»
   * = держать всегда, «300» = 5 минут) трактуем как секунды.
   */
  static normalizeKeepAlive(value: string): string {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) {
      return `${trimmed}s`;
    }
    return trimmed;
  }

  /** Проверить, запущен ли Ollama */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${OLLAMA_HOST}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Получить список доступных моделей */
  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${OLLAMA_HOST}/api/tags`);
      const data = await response.json();
      return ((data.models as Array<{ name: string }>) || []).map(
        (m) => m.name,
      );
    } catch {
      return [];
    }
  }

  /** Отправить чат и получить ответ. */
  async chat(
    messages: OllamaMessage[],
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    const stream = !!onChunk;
    console.log(
      `[OllamaClient.chat] model=${this.model}, stream=${stream}, messages=${messages.length}`,
    );

    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream,
        think: this.think,
        keep_alive: this.keepAlive,
        options: {
          temperature: this.temperature,
          num_predict: this.maxTokens,
          // Контекстное окно: 32768 для qwen3.6:35b-a3b (32 ГБ RAM)
          // Позволяет хранить полную историю чата + данные агентов + контекст
          num_ctx: 32768,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(
        `[OllamaClient.chat] HTTP error: ${response.status}`,
        error,
      );
      throw new Error(`Ollama error: ${error}`);
    }

    if (onChunk) {
      // Потоковая передача
      return await this.streamChat(response, onChunk);
    } else {
      // Обычный ответ
      const data: OllamaChatResponse = await response.json();
      const content = data.message?.content || '';
      console.log(
        `[OllamaClient.chat] non-stream response: ${content.slice(0, 100)}...`,
      );
      return content;
    }
  }

  /** Отправить запрос и получить ответ через /api/generate (надёжнее для стриминга) */
  async generate(
    systemPrompt: string,
    userPrompt: string,
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    const stream = !!onChunk;
    console.log(
      `[OllamaClient.generate] model=${this.model}, stream=${stream}`,
    );

    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        stream,
        think: this.think,
        keep_alive: this.keepAlive,
        options: {
          temperature: this.temperature,
          num_predict: this.maxTokens,
          // Контекстное окно: 32768 для qwen3.6:35b-a3b (32 ГБ RAM)
          num_ctx: 32768,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(
        `[OllamaClient.generate] HTTP error: ${response.status}`,
        error,
      );
      throw new Error(`Ollama error: ${error}`);
    }

    if (onChunk) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullResponse = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter((l) => l.trim());

          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              if (data.response && data.response !== '') {
                fullResponse += data.response;
                onChunk(data.response);
              }
              if (data.done) break;
            } catch {
              // skip
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      console.log(
        `[OllamaClient.generate] stream DONE: ${fullResponse.slice(0, 200)}`,
      );
      return fullResponse;
    } else {
      const data = await response.json();
      const content = data.response || '';
      console.log(
        `[OllamaClient.generate] non-stream: ${content.slice(0, 100)}...`,
      );
      return content;
    }
  }

  /** Потоковая передача ответа */
  private async streamChat(
    response: Response,
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let fullResponse = '';
    let lineCount = 0;
    let parseErrors = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        console.log(
          `[OllamaClient.streamChat] raw chunk length: ${chunk.length}`,
        );

        const lines = chunk.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          lineCount++;
          try {
            const data = JSON.parse(line);
            console.log(
              `[OllamaClient.streamChat] line ${lineCount}: done=${data.done}, hasMessage=${!!data.message}, content=${(data.message?.content || '').slice(0, 50)}`,
            );
            if (data.message?.content) {
              fullResponse += data.message.content;
              onChunk(data.message.content);
            }
          } catch {
            parseErrors++;
            console.warn(
              `[OllamaClient.streamChat] parse error line ${lineCount}:`,
              line.slice(0, 100),
            );
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    console.log(
      `[OllamaClient.streamChat] DONE: lines=${lineCount}, parseErrors=${parseErrors}, fullResponse=${fullResponse.slice(0, 200)}`,
    );
    return fullResponse;
  }

  /** Сгенерировать ответ на вопрос */
  async generateResponse(
    systemPrompt: string,
    userMessage: string,
    context?: string,
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: context ? `${context}\n\nВопрос: ${userMessage}` : userMessage,
      },
    ];

    return this.chat(messages, onChunk);
  }
}
