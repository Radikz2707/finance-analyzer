/**
 * AI-Memory — БРАУЗЕРНАЯ ЗАГЛУШКА (index.browser.ts).
 *
 * Подменяется в webpack-сборке (gulp/scripts.js) вместо Node/SQLite-реализации
 * (core.ts → better-sqlite3 + node:fs/node:path). В браузере база данных
 * недоступна, поэтому все операции — честные no-op: страница не падает,
 * а Director продолжает отвечать по фактам портфеля.
 *
 * Node-контур (tsx / vitest / gulp вне scripts) НЕ использует этот файл —
 * там остаётся настоящий модуль ai-memory.
 */

// ── Функции, используемые DirectorMemoryStore (директор) ──

export function saveDecision(_content: string, _keywords?: string[]): string {
  return '';
}

export function saveConversation(
  _content: string,
  _keywords?: string[],
): string {
  return '';
}

export function saveRecommendation(_content: string, _ticker?: string): string {
  return '';
}

export function searchByKeywords(
  _keywords: string[],
  _limit?: number,
): unknown[] {
  return [];
}

export function getByType(_type: string, _limit?: number): unknown[] {
  return [];
}

export function getRecent(_limit?: number): unknown[] {
  return [];
}

export function saveOperational(..._args: unknown[]): string {
  return '';
}

export function savePipelineResult(..._args: unknown[]): string {
  return '';
}

export function saveKpiSnapshot(..._args: unknown[]): string {
  return '';
}

export function saveTrend(..._args: unknown[]): string {
  return '';
}

export function saveAnomaly(..._args: unknown[]): string {
  return '';
}

export function getByPriority(_priority: string, _limit?: number): unknown[] {
  return [];
}

export function executeQuery(_sql: string, ..._params: unknown[]): unknown[] {
  return [];
}

export function getKpiTrend(_period?: string): unknown[] {
  return [];
}

export function buildAiContext(..._args: unknown[]): string {
  return '';
}

export function getMemoryStats(): Record<string, number> {
  return {
    operational: 0,
    strategic: 0,
    total: 0,
  };
}

export async function performCleanup(): Promise<number> {
  return 0;
}

export async function exportData(
  _format?: string,
  _limit?: number,
): Promise<string> {
  return JSON.stringify([]);
}

export function deleteEntry(_id: string): boolean {
  return false;
}

export function getEntryById(_id: string): unknown {
  return null;
}

// ── Функции, используемые Dashboard-модулем ──

/** Репозиторий оперативной памяти (no-op) */
export const operationalMemory = {
  getRecent: (): unknown[] => [],
  getAll: (): unknown[] => [],
  add: (): string => '',
  clear: (): void => {},
};

/** Репозиторий стратегической памяти (no-op) */
export const strategicMemory = {
  getAll: (): unknown[] => [],
  add: (): string => '',
  clear: (): void => {},
};

export function getStats(): Record<string, unknown> {
  return {
    operational: 0,
    strategic: 0,
    total: 0,
    byType: {},
  };
}

export async function cleanup(): Promise<void> {
  // no-op в браузере
}

export async function exportMemory(_format?: string): Promise<string> {
  return JSON.stringify([]);
}

export function clearAll(): boolean {
  return false;
}

export function resetDatabase(): boolean {
  return false;
}

export function init(..._args: unknown[]): boolean {
  return true;
}

export function getState(): string {
  return 'browser-stub';
}

/** Совместимый с aiMemoryImpl объект (полностью no-op) */
export const aiMemoryImpl = {
  saveOperational: saveOperational,
  getOperationalRecent: getRecent,
  saveStrategic: saveKpiSnapshot,
  getAllStrategic: (): unknown[] => [],
  query: searchByKeywords,
  getStats: getMemoryStats,
  cleanup: performCleanup,
  exportData: exportData,
  init: (): boolean => true,
  getState: (): string => 'browser-stub',
};
