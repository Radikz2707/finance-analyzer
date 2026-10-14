/**
 * ContextTracker — отслеживание контекста диалога Director.
 *
 * Хранит: последние тикеры, тему, интент, эмоцию и хвост истории.
 * Умеет:
 * - update(): обновить контекст после анализа реплики;
 * - isFollowUp(): определить, является ли реплика follow-up
 *   («а если…», «а что…», «дальше», «он упал?» — без повторения тикера);
 * - applyFollowUp(): подтянуть тикеры/тему из контекста для follow-up;
 * - snapshot(): копия контекста (для LLM-промпта и аудита).
 *
 * Модуль чистый — без Node-зависимостей.
 */

import {
  emptyDialogueContext,
  type DialogueAnalysis,
  type DialogueContext,
} from './types.js';

// ──────────────────────────────────────────────
// 1. Follow-up связки
// ──────────────────────────────────────────────

/** Префиксы follow-up: реплика начинается с них и не содержит тикеров */
const FOLLOW_UP_PREFIXES: readonly string[] = [
  'а если',
  'а что',
  'а ещё',
  'если',
  'дальше',
  'ну а',
  'а когда',
  'а как',
  'а почему',
];

/** Анафоры-указатели на прошлый тикер («он», «эта акция», «та бумага») */
const ANAPHORA_PATTERNS: readonly RegExp[] = [
  /^он\b|^она\b|^они\b/i,
  /эта\s+акция|эта\s+бумага|та\s+бумага|та\s+позиция|эта\s+позиция/i,
  /этот\s+актив|тот\s+актив/i,
];

/** Максимум хранимых реплик истории */
const MAX_HISTORY_TAIL = 12;

// ──────────────────────────────────────────────
// 2. ContextTracker
// ──────────────────────────────────────────────

/**
 * Трекер контекста диалога.
 * Может быть создан пустым (новый диалог) или с начальным контекстом.
 */
export class ContextTracker {
  private context: DialogueContext;

  constructor(initial?: Partial<DialogueContext>) {
    this.context = {
      ...emptyDialogueContext(),
      ...initial,
    };
  }

  /** Текущий контекст (копия) */
  getContext(): DialogueContext {
    return {
      ...this.context,
      lastTickers: [...this.context.lastTickers],
      historyTail: this.context.historyTail.map((entry) => ({ ...entry })),
    };
  }

  /** Обновить контекст по результату анализа реплики */
  update(analysis: DialogueAnalysis, userText: string): void {
    this.context.lastTickers =
      analysis.tickers.length > 0
        ? [...analysis.tickers]
        : this.context.lastTickers;
    if (analysis.tickers.length > 0) {
      this.context.lastTopic = analysis.rawText;
    }
    if (analysis.intent !== 'unknown') {
      this.context.lastIntent = analysis.intent;
    }
    this.context.lastEmotion = analysis.emotion;
    this.pushHistory('user', userText);
  }

  /** Записать реплику Директора в историю */
  pushDirector(text: string): void {
    this.pushHistory('director', text);
  }

  /** Является ли реплика follow-up (связка + нет тикеров + есть контекст) */
  isFollowUp(text: string, tickers: string[]): boolean {
    if (tickers.length > 0) return false;
    if (this.context.lastTickers.length === 0) return false;
    const lower = (text ?? '').trim().toLowerCase();
    if (FOLLOW_UP_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      return true;
    }
    return ANAPHORA_PATTERNS.some((pattern) => pattern.test(lower));
  }

  /**
   * Применить контекст к follow-up: вернуть тикеры и contextReference.
   * Если реплика не follow-up — вернуть пустой результат.
   */
  applyFollowUp(
    text: string,
    tickers: string[],
  ): {
    tickers: string[];
    contextReference?: string;
  } {
    if (!this.isFollowUp(text, tickers)) {
      return { tickers };
    }
    const refTickers = [...this.context.lastTickers];
    return {
      tickers: refTickers,
      contextReference: 'продолжение обсуждения ' + refTickers.join(', '),
    };
  }

  /** Текстовый контекст для LLM (последние реплики) */
  toPromptContext(limit = 6): string {
    const tail = this.context.historyTail.slice(-limit);
    if (tail.length === 0) return '';
    return tail.map((entry) => `${entry.role}: ${entry.text}`).join('\n');
  }

  /** Сбросить контекст (новая тема) */
  reset(): void {
    this.context = emptyDialogueContext();
  }

  // ── Helpers ──

  private pushHistory(role: 'user' | 'director', text: string): void {
    const trimmed = (text ?? '').trim();
    if (trimmed === '') return;
    this.context.historyTail.push({ role, text: trimmed });
    if (this.context.historyTail.length > MAX_HISTORY_TAIL) {
      this.context.historyTail =
        this.context.historyTail.slice(-MAX_HISTORY_TAIL);
    }
  }
}
