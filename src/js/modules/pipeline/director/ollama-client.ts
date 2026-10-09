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
    this.model = config.model || 'qwen3.5:9b';
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

  /** Отправить чат и получить ответ. */
  async chat(
    messages: OllamaMessage[],
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    const stream = !!onChunk;
    console.log(`[OllamaClient.chat] model=${this.model}, stream=${stream}, messages=${messages.length}`);
    
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        stream,
        options: {
          temperature: this.temperature,
          num_predict: this.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[OllamaClient.chat] HTTP error: ${response.status}`, error);
      throw new Error(`Ollama error: ${error}`);
    }

    if (onChunk) {
      // Потоковая передача
      return await this.streamChat(response, onChunk);
    } else {
      // Обычный ответ
      const data: OllamaChatResponse = await response.json();
      const content = data.message?.content || '';
      console.log(`[OllamaClient.chat] non-stream response: ${content.slice(0, 100)}...`);
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
    console.log(`[OllamaClient.generate] model=${this.model}, stream=${stream}`);
    
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        stream,
        options: {
          temperature: this.temperature,
          num_predict: this.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[OllamaClient.generate] HTTP error: ${response.status}`, error);
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
          const lines = chunk.split('\n').filter(l => l.trim());
          
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
      
      console.log(`[OllamaClient.generate] stream DONE: ${fullResponse.slice(0, 200)}`);
      return fullResponse;
    } else {
      const data = await response.json();
      const content = data.response || '';
      console.log(`[OllamaClient.generate] non-stream: ${content.slice(0, 100)}...`);
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
        console.log(`[OllamaClient.streamChat] raw chunk length: ${chunk.length}`);
        
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          lineCount++;
          try {
            const data = JSON.parse(line);
            console.log(`[OllamaClient.streamChat] line ${lineCount}: done=${data.done}, hasMessage=${!!data.message}, content=${(data.message?.content || '').slice(0, 50)}`);
            if (data.message?.content) {
              fullResponse += data.message.content;
              onChunk(data.message.content);
            }
          } catch {
            parseErrors++;
            console.warn(`[OllamaClient.streamChat] parse error line ${lineCount}:`, line.slice(0, 100));
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    console.log(`[OllamaClient.streamChat] DONE: lines=${lineCount}, parseErrors=${parseErrors}, fullResponse=${fullResponse.slice(0, 200)}`);
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
