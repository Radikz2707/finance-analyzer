/**
 * DocumentLoader — загрузчик документов для RAG системы.
 *
 * Поддерживаемые источники:
 * - Текстовые файлы (.txt, .md)
 * - Excel/CSV файлы (отчёты)
 * - JSON файлы (стратегии, история сделок)
 * - Ручной ввод текста
 * - IndexedDB (история Director, новости)
 */

import type { DocumentVector } from './vector-store.js';

/** Тип загружаемого документа */
export type DocumentSourceType =
  | 'text'
  | 'excel'
  | 'csv'
  | 'json'
  | 'manual'
  | 'indexeddb'
  | 'url';

/** Результат загрузки документа */
export interface LoadedDocument {
  /** Уникальный ID */
  id: string;
  /** Заголовок */
  title: string;
  /** Полный текст */
  text: string;
  /** Тип документа */
  type: DocumentVector['type'];
  /** Метаданные */
  metadata: Record<string, unknown>;
  /** Источник */
  source: DocumentSourceType;
}

/** Конфигурация загрузчика */
export interface DocumentLoaderConfig {
  /** Максимальная длина текста в одном документе */
  maxTextLength?: number;
  /** Разбивать длинные документы на чанки */
  chunkSize?: number;
  /**_overlap при разбиении */
  chunkOverlap?: number;
}

/** Дефолтная конфигурация */
const DEFAULT_CONFIG: DocumentLoaderConfig = {
  maxTextLength: 50000,
  chunkSize: 1000,
  chunkOverlap: 200,
};

/**
 * Загрузить документ из текста.
 */
export function loadTextDocument(
  text: string,
  title: string,
  type: DocumentVector['type'] = 'note',
  metadata: Record<string, unknown> = {},
): LoadedDocument {
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  return {
    id: generateId(cleanText + title),
    title,
    text: cleanText.slice(0, 50000),
    type,
    metadata: {
      ...metadata,
      sourceType: 'text' as const,
      charCount: cleanText.length,
      wordCount: cleanText.split(/\s+/).length,
    },
    source: 'text',
  };
}

/**
 * Загрузить документ из JSON.
 */
export function loadJsonDocument(
  data: unknown,
  title: string,
  type: DocumentVector['type'] = 'report',
  metadata: Record<string, unknown> = {},
): LoadedDocument {
  const jsonText = JSON.stringify(data, null, 2);
  const cleanText = jsonText.replace(/\s+/g, ' ').trim();
  
  return {
    id: generateId(cleanText + title),
    title,
    text: cleanText.slice(0, 50000),
    type,
    metadata: {
      ...metadata,
      sourceType: 'json' as const,
      dataType: typeof data,
    },
    source: 'json',
  };
}

/**
 * Загрузить документ из Excel (предполагаем, что данные уже распаршены).
 */
export function loadExcelDocument(
  sheets: Record<string, string[][]>,
  title: string,
  type: DocumentVector['type'] = 'report',
  metadata: Record<string, unknown> = {},
): LoadedDocument {
  let text = '';
  
  for (const [sheetName, rows] of Object.entries(sheets)) {
    text += `\n=== ${sheetName} ===\n`;
    for (const row of rows) {
      text += row.join('\t') + '\n';
    }
  }
  
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  return {
    id: generateId(cleanText + title),
    title,
    text: cleanText.slice(0, 50000),
    type,
    metadata: {
      ...metadata,
      sourceType: 'excel' as const,
      sheetCount: Object.keys(sheets).length,
    },
    source: 'excel',
  };
}

/**
 * Загрузить историю сделок из IndexedDB.
 */
export async function loadTradeHistoryFromIndexedDB(): Promise<LoadedDocument[]> {
  const documents: LoadedDocument[] = [];
  
  try {
    // Загружаем историю из Director memory
    const response = await fetch('/api/director/chat-history');
    if (response.ok) {
      const history = await response.json();
      
      for (const entry of history) {
        if (entry.role === 'user' && entry.text) {
          const doc = loadTextDocument(
            entry.text,
            `Вопрос от ${new Date(entry.date).toLocaleDateString('ru-RU')}`,
            'trade',
            {
              messageId: entry.id,
              date: entry.date,
            },
          );
          documents.push(doc);
        }
      }
    }
  } catch (error) {
    console.warn('[DocumentLoader] Ошибка загрузки истории из IndexedDB:', error);
  }
  
  return documents;
}

/**
 * Загрузить новости из NewsCache.
 */
export function loadNewsFromCache(
  newsItems: Array<{
    title: string;
    description: string;
    url: string;
    date: string;
    source: string;
    tickers: string[];
    sentiment: string;
    importance: string;
  }>,
): LoadedDocument[] {
  const documents: LoadedDocument[] = [];
  
  for (const news of newsItems) {
    const text = `${news.title}\n${news.description}\nИсточник: ${news.source}\nДата: ${news.date}\nТикеры: ${news.tickers.join(', ')}\nСентимент: ${news.sentiment}\nВажность: ${news.importance}`;
    
    const doc = loadTextDocument(
      text,
      news.title,
      'news',
      {
        url: news.url,
        date: news.date,
        source: news.source,
        tickers: news.tickers,
        sentiment: news.sentiment,
        importance: news.importance,
      },
    );
    documents.push(doc);
  }
  
  return documents;
}

/**
 * Разбить длинный текст на чанки.
 */
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }
  
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunkEnd = end;
    
    // Ищем конец предложения
    if (end < text.length) {
      const periodIndex = text.lastIndexOf('.', end + 200);
      if (periodIndex > start) {
        chunkEnd = periodIndex + 1;
      }
    }
    
    chunks.push(text.slice(start, chunkEnd).trim());
    start = chunkEnd - overlap;
  }
  
  return chunks;
}

/**
 * Загрузить документ с разбиением на чанки.
 */
export function loadDocumentWithChunks(
  text: string,
  title: string,
  type: DocumentVector['type'] = 'other',
  metadata: Record<string, unknown> = {},
  config?: Partial<DocumentLoaderConfig>,
): LoadedDocument[] {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  const chunks = chunkText(cleanText, mergedConfig.chunkSize!, mergedConfig.chunkOverlap!);
  
  return chunks.map((chunk, index) => ({
    id: `${generateId(chunk + title)}-${index}`,
    title: chunks.length > 1 ? `${title} (часть ${index + 1}/${chunks.length})` : title,
    text: chunk,
    type,
    metadata: {
      ...metadata,
      totalChunks: chunks.length,
      chunkIndex: index,
      sourceType: 'chunked' as const,
    },
    source: 'text',
  }));
}

/**
 * Сгенерировать уникальный ID.
 */
function generateId(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `doc-${Math.abs(hash).toString(36)}-${Date.now().toString(36)}`;
}

/**
 * Загрузить документ из URL (текст).
 */
export async function loadDocumentFromUrl(url: string): Promise<LoadedDocument> {
  try {
    const response = await fetch(url);
    const text = await response.text();
    
    return loadTextDocument(
      text,
      url,
      'note',
      { url, sourceType: 'url' as const },
    );
  } catch (error) {
    console.error('[DocumentLoader] Ошибка загрузки из URL:', error);
    throw error;
  }
}

/**
 * Загрузить файл (File API).
 */
export function loadFileDocument(file: File): Promise<LoadedDocument> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const text = e.target?.result as string;
      
      if (file.name.endsWith('.json')) {
        try {
          const data = JSON.parse(text);
          resolve(loadJsonDocument(data, file.name, 'report', { fileName: file.name }));
        } catch {
          resolve(loadTextDocument(text, file.name, 'note', { fileName: file.name }));
        }
      } else {
        resolve(loadTextDocument(text, file.name, 'note', { fileName: file.name }));
      }
    };
    
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
