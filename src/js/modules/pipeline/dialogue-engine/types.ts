/**
 * DialogueEngine — типы естественного диалога Director.
 *
 * Модуль чистый (без Node-зависимостей): работает и в браузере, и в Node.
 * Заменяет regex-маршрутизацию BrowserDirector/DirectorAgent на LLM-центричную
 * классификацию с детерминированным fallback на nl-parser.
 */

import type {
  DirectorFactsContext,
  UserQuestionCategory,
  UserIntent,
} from '../director/director-types.js';

// ──────────────────────────────────────────────
// 1. Интенты диалога
// ──────────────────────────────────────────────

/** Интент реплики пользователя (обобщённый, «человеческий») */
export type DialogueIntent =
  | 'greeting' // «привет», «добрый день»
  | 'farewell' // «пока», «до свидания»
  | 'status' // «как дела», «что нового»
  | 'off-topic' // тема вне компетенции (погода, спорт…)
  | 'correction' // поправка к данным портфеля («доля PLZL 19%»)
  | 'report' // запрос отчёта/анализа («покажи отчёт»)
  | 'smalltalk' // бытовой разговор («расскажи о себе»)
  | 'courtesy' // благодарности, вежливость («спасибо», «ок»)
  | 'task' // задача/идея → цель автономного цикла («давай добавим…»)
  | 'action' // действие с компьютером (file/terminal/code/…)
  | 'portfolio' // вопрос по портфелю в целом
  | 'asset' // вопрос по конкретному активу
  | 'comparison' // сравнение активов/вариантов
  | 'scenario' // сценарий «что если»
  | 'market' // рынок/макро
  | 'news' // новости
  | 'strategy' // стратегия/план
  | 'plan' // план на будущее
  | 'past-decision' // пересмотр прошлого решения
  | 'system-quality' // качество работы системы
  | 'unknown'; // не распознано

/** Эмоция реплики пользователя */
export type DialogueEmotion =
  'positive' | 'negative' | 'concerned' | 'urgent' | 'neutral';

/** Вид action-запроса (для интента 'action') */
export type DialogueActionKind =
  | 'file'
  | 'terminal'
  | 'package'
  | 'process'
  | 'automation'
  | 'system'
  | 'code'
  | 'self-improve';

// ──────────────────────────────────────────────
// 2. Контекст диалога
// ──────────────────────────────────────────────

/** Контекст предыдущего диалога (для follow-up и анафор) */
export interface DialogueContext {
  /** Тикеры последнего обсуждённого вопроса */
  lastTickers: string[];
  /** Тема последнего обсуждения */
  lastTopic: string;
  /** Последний интент */
  lastIntent: DialogueIntent;
  /** Последняя эмоция */
  lastEmotion: DialogueEmotion;
  /** Хвост истории (роль: текст), последние N реплик */
  historyTail: Array<{ role: 'user' | 'director'; text: string }>;
}

/** Пустой контекст */
export function emptyDialogueContext(): DialogueContext {
  return {
    lastTickers: [],
    lastTopic: '',
    lastIntent: 'unknown',
    lastEmotion: 'neutral',
    historyTail: [],
  };
}

// ──────────────────────────────────────────────
// 3. Анализ реплики
// ──────────────────────────────────────────────

/**
 * Результат анализа реплики пользователя.
 * Совместим с InterpretedQuestion через поля category/directorIntent/tickers —
 * Director может строить план делегирования без потери данных.
 */
export interface DialogueAnalysis {
  /** Интент диалога */
  intent: DialogueIntent;
  /** Эмоция реплики */
  emotion: DialogueEmotion;
  /** Уверенность классификации 0..1 */
  confidence: number;
  /** Тикеры, упомянутые в реплике */
  tickers: string[];
  /** Извлечённые сущности (процент поправки, путь файла, команда…) */
  entities: Record<string, unknown>;
  /** Требуются ли агенты для ответа */
  needsAgents: boolean;
  /** Является ли реплика follow-up к прошлому обсуждению */
  isFollowUp: boolean;
  /** Полный текст реплики */
  rawText: string;
  /** Категория вопроса (совместимость с delegation-planner) */
  category: UserQuestionCategory;
  /** Интенция Director (совместимость с delegation-planner) */
  directorIntent: UserIntent;
  /** Вид action-запроса (для интента 'action') */
  actionKind?: DialogueActionKind;
  /** Источник классификации: 'llm' | 'fallback' */
  source: 'llm' | 'fallback';
}

// ──────────────────────────────────────────────
// 4. Контракты классификатора и движка
// ──────────────────────────────────────────────

/** Минимальный контракт LLM-чата (OllamaClient.chat совместим структурно) */
export interface LlmChatLike {
  chat(messages: LlmMessage[]): Promise<string>;
}

/** Сообщение для LLM */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Классификатор реплики: LLM или детерминированный fallback */
export type IntentClassifierFn = (
  text: string,
  context: DialogueContext,
) => Promise<DialogueAnalysis>;

/** Опции классификатора (DI) */
export interface IntentClassifierOptions {
  /** LLM-клиент (OllamaClient); без него — fallback на nl-parser */
  llm?: LlmChatLike;
  /** Системный промпт классификации (по умолчанию — встроенный) */
  systemPrompt?: string;
  /** Порог доверия LLM-ответу (ниже — fallback) */
  minConfidence?: number;
  /** Таймаут LLM-запроса, мс (по умолчанию 5000) */
  timeoutMs?: number;
}

/** Результат «живого» ответа на smalltalk (без агентов) */
export interface SmallTalkResponse {
  text: string;
}

/** Вход анализа диалога */
export interface DialogueAnalysisInput {
  text: string;
  context: DialogueContext;
  /** Факты портфеля (для коррекций/тикеров) */
  facts?: DirectorFactsContext;
}
