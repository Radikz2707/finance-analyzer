/**
 * RAG (Retrieval Augmented Generation) модуль.
 *
 * Позволяет локальной LLM получать доступ к свежим данным из интернета
 * через поиск по векторному хранилищу новостей.
 */

export { VectorStore } from './vector-store.js';
export type { VectorEntry, SearchResult, VectorStoreOptions } from './vector-store.js';

export { RAGService } from './rag-service.js';
export type { RAGResult, RAGNewsItem, RAGServiceOptions } from './rag-service.js';
