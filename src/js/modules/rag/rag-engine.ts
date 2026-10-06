/**
 * RAG Engine — Retrieval-Augmented Generation для Finance Analyzer.
 *
 * Система, которая:
 * 1. Ищет релевантные документы по вопросу пользователя
 * 2. Формирует контекст из найденных документов
 * 3. Подаёт контекст в LLM (Ollama) для формирования ответа
 * 
 * Преимущества:
 * - ИИ отвечает на основе ваших документов, а не выдумывает
 * - Можно цитировать источники
 * - Легко обновлять базу знаний
 */

import { VectorStore } from './vector-store.js';
import type { SearchDocument, DocumentVector } from './vector-store.js';
import type { OllamaMessage } from '../pipeline/director/ollama-client.js';

/** Результат RAG запроса */
export interface RAGResult {
  /** Ответ LLM */
  answer: string;
  /** Найденные документы */
  sources: Array<{
    id: string;
    title: string;
    text: string;
    score: number;
    type: string;
  }>;
  /** Флаг: найдены ли релевантные документы */
  hasRelevantDocuments: boolean;
  /** Сколько документов найдено */
  documentCount: number;
  /** Время обработки в мс */
  processingTimeMs: number;
}

/** Конфигурация RAG Engine */
export interface RAGEngineConfig {
  /** VectorStore для поиска */
  vectorStore: VectorStore;
  /** Модель Ollama для генерации ответов */
  ollamaModel?: string;
  /** Максимальное количество документов для контекста */
  maxContextDocuments?: number;
  /** Максимальная длина контекста в символах */
  maxContextLength?: number;
  /** Промпт для генерации ответа */
  promptTemplate?: string;
}

/** Дефолтный промпт для RAG */
const DEFAULT_PROMPT_TEMPLATE = `Ты — инвестиционный советник Finance Analyzer. Отвечай на основе следующих документов.

## ДОКУМЕНТЫ (контекст):
{{context}}

## ВОПРОС ПОЛЬЗОВАТЕЛЯ:
{{question}}

## ИНСТРУКЦИИ:
1. Отвечай ТОЛЬКО на основе предоставленных документов
2. Если в документах нет ответа — скажи "В моих документах нет информации по этому вопросу"
3. Цитируй источники, когда это возможно
4. Отвечай на русском языке
5. Будь краток, но информативен
6. Если вопрос не связан с финансами — скажи об этом

⚠️ Это рекомендация, а не совет. Решение всегда за тобой.`;

/**
 * RAG Engine — основной класс системы.
 */
export class RAGEngine {
  private vectorStore: VectorStore;
  private maxContextDocuments: number;
  private maxContextLength: number;
  private promptTemplate: string;
  private ollama: import('../pipeline/director/ollama-client.js').OllamaClient | null = null;

  constructor(config: RAGEngineConfig) {
    this.vectorStore = config.vectorStore;
    this.maxContextDocuments = config.maxContextDocuments || 5;
    this.maxContextLength = config.maxContextLength || 8000;
    this.promptTemplate = config.promptTemplate || DEFAULT_PROMPT_TEMPLATE;
  }

  /**
   * Установить Ollama клиент.
   */
  setOllamaClient(ollama: import('../pipeline/director/ollama-client.js').OllamaClient): void {
    this.ollama = ollama;
  }

  /**
   * Выполнить RAG запрос.
   */
  async query(question: string): Promise<RAGResult> {
    const startTime = Date.now();
    
    // 1. Поиск релевантных документов
    const documents = this.vectorStore.search(question, {
      topK: this.maxContextDocuments,
      minSimilarity: 0.05,
    });
    
    // 2. Формирование контекста
    const context = this.buildContext(documents);
    
    // 3. Генерация ответа через LLM
    let answer: string;
    
    if (this.ollama && documents.length > 0) {
      answer = await this.generateAnswerWithLLM(question, context);
    } else if (documents.length > 0) {
      // Fallback: возвращаем документы без LLM
      answer = this.generateAnswerWithoutLLM(question, documents);
    } else {
      answer = 'По вашему вопросу не найдено релевантных документов в базе знаний. Попробуйте переформулировать или загрузите дополнительные документы.';
    }
    
    const processingTime = Date.now() - startTime;
    
    return {
      answer,
      sources: documents.map(doc => ({
        id: doc.id,
        title: doc.title,
        text: doc.text.slice(0, 200),
        score: doc.score,
        type: doc.type,
      })),
      hasRelevantDocuments: documents.length > 0,
      documentCount: documents.length,
      processingTimeMs: processingTime,
    };
  }

  /**
   * Построить контекст из документов.
   */
  private buildContext(documents: SearchDocument[]): string {
    if (documents.length === 0) return 'Нет релевантных документов.';
    
    let context = '';
    let totalLength = 0;
    
    for (let i = 0; i < documents.length && totalLength < this.maxContextLength; i++) {
      const doc = documents[i];
      if (!doc) continue;
      
      const docText = doc.text.slice(0, this.maxContextLength - totalLength);
      
      context += `--- Документ ${i + 1} [${doc.type}] "${doc.title}" ---\n`;
      context += docText + '\n\n';
      totalLength += docText.length + 100;
    }
    
    return context || 'Нет релевантных документов.';
  }

  /**
   * Сгенерировать ответ с помощью LLM.
   */
  private async generateAnswerWithLLM(question: string, context: string): Promise<string> {
    if (!this.ollama) {
      return 'LLM недоступен. Использую fallback-ответ.';
    }
    
    const prompt = this.promptTemplate
      .replace('{{context}}', context)
      .replace('{{question}}', question);
    
    try {
      const messages: OllamaMessage[] = [
        {
          role: 'system',
          content: 'Ты — инвестиционный советник Finance Analyzer. Отвечай на русском языке, кратко и по делу.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ];
      
      const answer = await this.ollama.chat(messages);
      return answer;
    } catch (error) {
      console.warn('[RAGEngine] Ошибка генерации ответа через LLM:', error);
      return this.generateAnswerWithoutLLM(question, []);
    }
  }

  /**
   * Сгенерировать ответ без LLM (fallback).
   */
  private generateAnswerWithoutLLM(_question: string, documents: SearchDocument[]): string {
    if (documents.length === 0) {
      return 'Документы не найдены.';
    }
    
    let answer = `Найдено ${documents.length} релевантных документов:\n\n`;
    
    for (const doc of documents.slice(0, 3)) {
      answer += `📄 **${doc.title}** (релевантность: ${(doc.score * 100).toFixed(0)}%)\n`;
      answer += `${doc.text.slice(0, 150)}...\n\n`;
    }
    
    answer += '\n💡 Для детального ответа подключите Ollama.';
    
    return answer;
  }

  /**
   * Добавить документ в базу знаний.
   */
  addDocument(
    id: string,
    text: string,
    title: string,
    type: DocumentVector['type'] = 'note',
    metadata: Record<string, unknown> = {},
  ): void {
    this.vectorStore.add(id, text, title, type, metadata);
  }

  /**
   * Удалить документ из базы знаний.
   */
  removeDocument(id: string): boolean {
    return this.vectorStore.remove(id);
  }

  /**
   * Получить статистику базы знаний.
   */
  getStats(): Record<string, unknown> {
    const stats = this.vectorStore.getStats();
    return {
      totalDocuments: stats.totalDocuments,
      byType: stats.byType,
      totalTerms: stats.totalTerms,
      vocabularySize: stats.vocabularySize,
    };
  }

  /**
   * Очистить базу знаний.
   */
  clear(): void {
    this.vectorStore.clear();
  }
}
