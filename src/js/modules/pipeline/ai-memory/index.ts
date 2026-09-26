/**
 * AI Memory Module — двухслойная система памяти для ИИ-агентов.
 *
 * Подмодули:
 * - types.ts — типы и интерфейсы
 * - core.ts — ядро: оперативная и стратегическая память (SQLite)
 * - memory-api.ts — удобный фасадный API для других модулей
 * - memory-cleaner.ts — автоматическая очистка по расписанию
 * - memory-rest-api.ts — REST-подобный интерфейс
 * - vector-search.ts — TF-IDF векторный поиск
 *
 * @module ai-memory
 */

export * from './types.js';
export {
  operationalMemory,
  strategicMemory,
  query,
  getStats,
  cleanup,
  exportMemory,
  clearAll,
  resetDatabase,
  init as initMemory,
  getState as getMemoryState,
} from './core.js';
export { aiMemoryImpl } from './core.js';

// memory-cleaner.ts
export * from './memory-cleaner.js';

// memory-api.ts — getMemoryStats
export {
  saveOperational,
  savePipelineResult,
  saveDecision,
  saveRecommendation,
  saveConversation,
  saveKpiSnapshot,
  saveTrend,
  saveAnomaly,
  searchByKeywords,
  getByType,
  getByPriority,
  executeQuery,
  getRecent,
  getKpiTrend,
  buildAiContext,
  getMemoryStats,
  performCleanup,
  exportData,
  deleteEntry,
  getEntryById,
} from './memory-api.js';

export type {
  MemoryEntryType,
  MemoryPriority,
  OperationalMemoryEntry,
  PortfolioKpiSnapshot,
  StrategicMemoryEntry,
  MemoryQuery,
  MemoryQueryResult,
  AIMemoryStats,
} from './memory-api.js';

// memory-rest-api.ts — переименовываем конфликтующие экспорты
export {
  getMemoryStats as getMemoryStatsRest,
  getOperationalMemory,
  getStrategicMemory,
  queryMemory,
  saveMemory,
  cleanupMemory,
  success,
  error,
  timed,
} from './memory-rest-api.js';

export type {
  ApiResponse,
  ListResponse,
  SaveMemoryParams,
  SaveResult,
  CleanupParams,
  CleanupResult as RestCleanupResult,
} from './memory-rest-api.js';

export * from './vector-search.js';
