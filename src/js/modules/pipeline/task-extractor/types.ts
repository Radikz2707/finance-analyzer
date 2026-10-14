/**
 * TaskExtractor — типы извлечения задач из свободной речи.
 *
 * Директор находит задачи в свободной речи и привлекает нужных агентов
 * (не только портфельных — file/terminal/code/browser/...). Модуль
 * извлекает структурированные задачи: действие + цель + параметры.
 *
 * Модуль чистый (без Node-зависимостей): работает и в браузере, и в Node.
 * LLM-клиент — DI (type-only импорт), как в dialogue-engine.
 */

import type { DirectorFactsContext } from '../director/director-types.js';

// ──────────────────────────────────────────────
// 1. Действия задач
// ──────────────────────────────────────────────

/** Действие извлечённой задачи */
export type TaskAction =
  | 'file' // файловая операция (создать/прочитать/изменить/удалить/поиск)
  | 'terminal' // команда терминала (npm run test, git status, ...)
  | 'code' // разработка кода (CodingWorkflow: write → test → repair)
  | 'package' // управление зависимостями (npm/pip)
  | 'process' // управление процессами (запуск/остановка/перезапуск)
  | 'automation' // автоматизация (workflow)
  | 'research' // исследование: факты, фундаментал, новости
  | 'portfolio' // анализ портфеля в целом
  | 'goal'; // цель автономного цикла (GoalAgent)

// ──────────────────────────────────────────────
// 2. Извлечённая задача
// ──────────────────────────────────────────────

/** Извлечённая задача из свободной речи */
export interface ExtractedTask {
  /** Уникальный ID задачи */
  id: string;
  /** Действие */
  action: TaskAction;
  /** Цель действия (путь файла, команда, тикер, тема) */
  target: string;
  /** Параметры действия (структура зависит от action) */
  params: Record<string, unknown>;
  /** Уверенность извлечения 0..1 */
  confidence: number;
  /** Исходный текст, из которого извлечена задача */
  rawText: string;
}

/** Результат извлечения задач */
export interface TaskExtractionResult {
  /** Извлечённые задачи (0..N) */
  tasks: ExtractedTask[];
  /** Источник: LLM или детерминированный fallback */
  source: 'llm' | 'fallback';
  /** Исходный текст */
  rawText: string;
}

// ──────────────────────────────────────────────
// 3. Контекст и опции (DI)
// ──────────────────────────────────────────────

/** Контекст извлечения (DI) */
export interface TaskExtractionContext {
  /** Факты портфеля (для тикеров/контекста) */
  facts?: DirectorFactsContext;
}

/** Минимальный контракт LLM-чата (OllamaClient.chat совместим структурно) */
export interface LlmChatLike {
  chat(messages: LlmMessage[]): Promise<string>;
}

/** Сообщение для LLM */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Опции TaskExtractor (DI) */
export interface TaskExtractorOptions {
  /** LLM-клиент (OllamaClient); без него — fallback на nl-parser */
  llm?: LlmChatLike;
  /** Системный промпт извлечения (по умолчанию — встроенный) */
  systemPrompt?: string;
  /**
   * Порог доверия LLM-ответу (ниже — fallback), по умолчанию 0.55.
   * Применяется к необязательному полю confidence в ответе LLM.
   */
  minConfidence?: number;
  /** Таймаут LLM-запроса, мс (по умолчанию 5000) */
  timeoutMs?: number;
}
