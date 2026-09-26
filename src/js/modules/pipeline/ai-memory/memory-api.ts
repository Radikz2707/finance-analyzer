/**
 * Memory API — удобный интерфейс для работы с памятью ИИ из других модулей.
 *
 * Это фасадный слой над ядром ai-memory.ts, предоставляющий:
 * - Простые функции для записи (savePipelineResult, saveDecision, saveRecommendation)
 * - Поиск по ключевым словам, типам и приоритету
 * - Формирование контекста для AI-агентов (buildAiContext)
 * - Статистику, очистку и экспорт
 *
 * @module memory-api
 * @author Finance Analyzer Team
 */

import {
  operationalMemory,
  strategicMemory,
  query as memoryQuery,
  getStats,
  cleanup,
  exportMemory,
} from './core.js';
import type {
  MemoryEntryType,
  MemoryPriority,
  OperationalMemoryEntry,
  PortfolioKpiSnapshot,
  StrategicMemoryEntry,
  MemoryQuery,
  MemoryQueryResult,
  AIMemoryStats,
} from './types.js';

// ──────────────────────────────────────────────
// 1. Запись в оперативную память
// ──────────────────────────────────────────────

/**
 * Сохранить запись в оперативную память.
 * @param params — параметры записи
 * @param params.type — тип записи
 * @param params.content — содержание
 * @param params.priority — приоритет (по умолчанию 'medium')
 * @param params.keywords — ключевые слова
 * @param params.metadata — метаданные
 * @returns ID сохранённой записи
 */
function saveOperational(params: {
  type: MemoryEntryType;
  content: string;
  priority?: MemoryPriority;
  keywords?: string[];
  metadata?: Record<string, unknown>;
}): string {
  return operationalMemory.save({
    type: params.type,
    content: params.content,
    priority: params.priority ?? 'medium',
    keywords: params.keywords ?? [],
    createdAt: new Date().toISOString(),
    metadata: params.metadata,
  });
}

/**
 * Сохранить результат pipeline.
 * @param stage — название этапа pipeline
 * @param data — данные результата
 * @returns ID сохранённой записи
 */
function savePipelineResult(stage: string, data: unknown): string {
  return saveOperational({
    type: 'pipeline_result',
    content: JSON.stringify(data, null, 2).substring(0, 2000),
    priority: 'high',
    keywords: ['pipeline', stage],
    metadata: {
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Сохранить решение Director.
 * @param content — содержание решения
 * @param keywords — ключевые слова (по умолчанию ['decision'])
 * @returns ID сохранённой записи
 */
function saveDecision(content: string, keywords?: string[]): string {
  return saveOperational({
    type: 'decision',
    content,
    priority: 'critical',
    keywords: keywords ?? ['decision'],
  });
}

/**
 * Сохранить рекомендацию AI.
 * @param content — содержание рекомендации
 * @param ticker — тикер актива (опционально)
 * @returns ID сохранённой записи
 */
function saveRecommendation(content: string, ticker?: string): string {
  return saveOperational({
    type: 'recommendation',
    content,
    priority: 'high',
    keywords: ticker ? ['recommendation', ticker] : ['recommendation'],
    metadata: {
      ticker,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Сохранить запись о переписке.
 * @param content — содержание переписки
 * @param keywords — ключевые слова (по умолчанию [])
 * @returns ID сохранённой записи
 */
function saveConversation(content: string, keywords?: string[]): string {
  return saveOperational({
    type: 'conversation',
    content,
    priority: 'medium',
    keywords: keywords ?? [],
  });
}

// ──────────────────────────────────────────────
// 2. Запись в стратегическую память
// ──────────────────────────────────────────────

/**
 * Сохранить KPI-снимок.
 * @param snapshot — данные снимка KPI
 * @param snapshot.date — дата снимка (по умолчанию текущая)
 * @returns ID сохранённой записи
 */
function saveKpiSnapshot(
  snapshot: Omit<PortfolioKpiSnapshot, 'date'> & { date?: string },
): string {
  const fullSnapshot: PortfolioKpiSnapshot = {
    ...snapshot,
    date: snapshot.date ?? new Date().toISOString(),
  };
  return strategicMemory.saveKpi(fullSnapshot);
}

/**
 * Сохранить тренд.
 * @param params — параметры тренда
 * @param params.direction — направление тренда
 * @param params.strength — сила тренда (0-1)
 * @param params.periodDays — период в днях
 * @param params.description — описание
 * @returns ID сохранённой записи
 */
function saveTrend(params: {
  direction: 'up' | 'down' | 'stable';
  strength: number;
  periodDays: number;
  description: string;
}): string {
  return strategicMemory.saveTrend(params);
}

/**
 * Сохранить аномалию.
 * @param params — параметры аномалии
 * @param params.type — тип аномалии
 * @param params.severity — серьёзность (0-1)
 * @param params.description — описание
 * @param params.relatedKpiId — ID связанного KPI-снимка (опционально)
 * @returns ID сохранённой записи
 */
function saveAnomaly(params: {
  type: string;
  severity: number;
  description: string;
  relatedKpiId?: string;
}): string {
  return strategicMemory.saveAnomaly(params);
}

// ──────────────────────────────────────────────
// 3. Поиск и запросы
// ──────────────────────────────────────────────

/**
 * Найти записи по ключевым словам.
 * @param keywords — массив ключевых слов
 * @param limit — максимум результатов (по умолчанию 50)
 * @returns массив найденных записей
 */
function searchByKeywords(
  keywords: string[],
  limit = 50,
): OperationalMemoryEntry[] {
  return operationalMemory.searchByKeywords(keywords, limit);
}

/**
 * Получить записи по типу.
 * @param type — тип записи для фильтрации
 * @param limit — максимум результатов (по умолчанию 50)
 * @returns массив найденных записей
 */
function getByType(
  type: MemoryEntryType,
  limit = 50,
): OperationalMemoryEntry[] {
  return operationalMemory.getByType(type, limit);
}

/**
 * Получить записи по приоритету.
 * @param priority — приоритет для фильтрации
 * @param limit — максимум результатов (по умолчанию 50)
 * @returns массив найденных записей
 */
function getByPriority(
  priority: MemoryPriority,
  limit = 50,
): OperationalMemoryEntry[] {
  return operationalMemory.getByPriority(priority, limit);
}

/**
 * Выполнить запрос к памяти.
 * @param params — параметры запроса
 * @returns результат запроса
 */
function executeQuery(params: MemoryQuery): Promise<MemoryQueryResult> {
  return memoryQuery(params);
}

/**
 * Получить последние N записей.
 * @param limit — максимум записей (по умолчанию 50)
 * @returns массив последних записей
 */
function getRecent(limit = 50): OperationalMemoryEntry[] {
  return operationalMemory.getRecent(limit);
}

/**
 * Получить KPI-тренд.
 * @param count — количество снимков (по умолчанию 12)
 * @returns массив KPI-снимков с динамикой
 */
function getKpiTrend(count = 12): Array<{
  date: string;
  totalValue: number;
  returnPercent: number;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
}> {
  return strategicMemory.getKpiTrend(count);
}

// ──────────────────────────────────────────────
// 4. Контекст для AI
// ──────────────────────────────────────────────

/**
 * Сформировать контекст для AI-агента.
 * Возвращает строку с последними записями из памяти.
 *
 * @param options — опции контекста
 * @param options.maxOperational — максимум записей из оперативной памяти (по умолчанию 5)
 * @param options.maxKpi — максимум KPI-снимков (по умолчанию 3)
 * @returns строка контекста в формате Markdown
 */
async function buildAiContext(options?: {
  /** Максимум записей из оперативной памяти */
  maxOperational?: number;
  /** Максимум KPI-снимков */
  maxKpi?: number;
}): Promise<string> {
  const opts = {
    maxOperational: 5,
    maxKpi: 3,
    ...options,
  };

  const stats = getStats();
  let context = '# Контекст из памяти ИИ\n\n';
  context += '## Статистика\n\n';
  context += `- Оперативная память: ${stats.operationalCount} записей\n`;
  context += `- Стратегическая память: ${stats.strategicCount} записей\n`;
  context += `- Аномалий за 7 дней: ${stats.recentAnomalies}\n\n`;

  // Последние результаты pipeline
  const pipelineEntries = getByType('pipeline_result', opts.maxOperational);
  if (pipelineEntries.length > 0) {
    context += '## Последние результаты pipeline\n\n';
    for (const entry of pipelineEntries) {
      context += `### ${entry.createdAt}\n\n`;
      context += `${entry.content.substring(0, 1000)}\n\n`;
    }
  }

  // Последние KPI-снимки
  const kpiTrend = getKpiTrend(opts.maxKpi);
  if (kpiTrend.length > 0) {
    context += '## Последние KPI-снимки\n\n';
    for (const kpi of kpiTrend) {
      context += `- **${kpi.date}**: стоимость=${kpi.totalValue.toLocaleString('ru-RU')} ₽, доходность=${kpi.returnPercent}%\n`;
    }
  }

  // Последние решения
  const decisions = getByType('decision', 3);
  if (decisions.length > 0) {
    context += '## Последние решения\n\n';
    for (const decision of decisions) {
      context += `- **${decision.createdAt}**: ${decision.content.substring(0, 200)}\n`;
    }
  }

  return context;
}

// ──────────────────────────────────────────────
// 5. Статистика и управление
// ──────────────────────────────────────────────

/**
 * Получить статистику памяти.
 * @returns объект со статистикой памяти
 */
function getMemoryStats(): AIMemoryStats {
  return getStats();
}

/**
 * Очистить старые записи.
 * Удаляет записи старше TTL, архивирует старые записи.
 * @returns промис, разрешающийся при завершении очистки
 */
function performCleanup(): Promise<void> {
  return cleanup();
}

/**
 * Экспортировать память.
 * @param format — формат экспорта: 'json' или 'markdown'
 * @returns экспортированные данные
 */
function exportData(format: 'json' | 'markdown'): Promise<string> {
  return exportMemory(format);
}

/**
 * Удалить запись.
 * @param id — ID записи
 * @param type — тип памяти: 'operational' или 'strategic'
 * @returns true если запись найдена и удалена
 */
function deleteEntry(id: string, type: 'operational' | 'strategic'): boolean {
  if (type === 'operational') {
    return operationalMemory.delete(id);
  }
  return strategicMemory.delete(id);
}

/**
 * Получить запись по ID.
 * @param id — ID записи
 * @returns запись или undefined если не найдена
 */
function getEntryById(
  id: string,
): OperationalMemoryEntry | StrategicMemoryEntry | undefined {
  const opEntry = operationalMemory.getById(id);
  if (opEntry) return opEntry;

  // Для стратегической нужно искать по всем записям
  const allStrategic = strategicMemory.getAll(100);
  return allStrategic.find((e) => e.id === id);
}

// ──────────────────────────────────────────────
// 6. Экспорт
// ──────────────────────────────────────────────

export {
  // Запись
  saveOperational,
  savePipelineResult,
  saveDecision,
  saveRecommendation,
  saveConversation,
  saveKpiSnapshot,
  saveTrend,
  saveAnomaly,

  // Поиск
  searchByKeywords,
  getByType,
  getByPriority,
  executeQuery,
  getRecent,
  getKpiTrend,

  // Контекст
  buildAiContext,

  // Управление
  getMemoryStats,
  performCleanup,
  exportData,
  deleteEntry,
  getEntryById,
};

export type {
  MemoryEntryType,
  MemoryPriority,
  OperationalMemoryEntry,
  PortfolioKpiSnapshot,
  StrategicMemoryEntry,
  MemoryQuery,
  MemoryQueryResult,
  AIMemoryStats,
};
