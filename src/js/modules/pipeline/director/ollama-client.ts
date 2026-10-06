/**
 * OllamaClient — клиент для общения с локальной LLM через Ollama.
 * 
 * Используется для генерации естественных ответов Director.
 */

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
}

/**
 * OllamaClient — клиент для общения с Ollama.
 */
export class OllamaClient {
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: OllamaConfig = {}) {
    this.model = config.model || 'qwen3:14b';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 2000;
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
      return ((data.models as Array<{ name: string }>) || []).map((m) => m.name);
    } catch {
      return [];
    }
  }

  /**
   * Отправить чат и получить ответ.
   * 
   * @param messages — история сообщений
   * @param onChunk — колбэк для потоковой передачи (опционально)
   */
  async chat(
    messages: OllamaMessage[],
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        stream: !!onChunk,
        options: {
          temperature: this.temperature,
          num_predict: this.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama error: ${error}`);
    }

    if (onChunk) {
      // Потоковая передача
      return await this.streamChat(response, onChunk);
    } else {
      // Обычный ответ
      const data: OllamaChatResponse = await response.json();
      return data.message?.content || '';
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

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              fullResponse += data.message.content;
              onChunk(data.message.content);
            }
          } catch {
            // Пропускаем не-JSON строки
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

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
      { role: 'user', content: context ? `${context}\n\nВопрос: ${userMessage}` : userMessage },
    ];

    return this.chat(messages, onChunk);
  }
}
