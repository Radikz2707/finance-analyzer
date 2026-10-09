/**
 * OutcomeTracker — отслеживание результатов решений (подзадача 1.1.1).
 *
 * Отвечает на вопрос: «что было рекомендовано → что произошло на самом деле».
 *
 * Хранит DecisionRecord (рекомендации) и OutcomeRecord (фактические
 * результаты), связывает их в DecisionOutcomePair.
 *
 * Хранилище: DI-источники (DecisionSource / OutcomeSource). Если не заданы —
 * используется встроенное in-memory хранилище (для тестов и лёгких сценариев).
 *
 * Инварианты:
 * - Ошибка источника пробрасывается честно (данные НЕ выдумываются).
 * - OutcomeRecord может быть записан только для существующего решения,
 *   иначе бросается OutcomeTrackerError (защита от «осиротевших» результатов).
 * - Ограничение памяти maxRecords (LRU-вытеснение самых старых по createdAt)
 *   применяется только к встроенному in-memory хранилищу.
 */

import { randomUUID } from 'node:crypto';
import type {
  DecisionRecord,
  OutcomeRecord,
  DecisionOutcomePair,
  DecisionSource,
  OutcomeSource,
} from './types.js';

// ──────────────────────────────────────────────
// Ошибки
// ──────────────────────────────────────────────

/** Ошибка OutcomeTracker */
export class OutcomeTrackerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OutcomeTrackerError';
  }
}

// ──────────────────────────────────────────────
// In-memory источники по умолчанию
// ──────────────────────────────────────────────

/** LRU-вытеснение: оставить только maxRecords самых новых записей */
function evictOldest<T extends { createdAt?: string; recordedAt?: string }>(
  map: Map<string, T>,
  maxRecords: number,
): void {
  if (map.size <= maxRecords) return;
  const sorted = [...map.entries()].sort((a, b) => {
    const ta = a[1].createdAt ?? a[1].recordedAt ?? '';
    const tb = b[1].createdAt ?? b[1].recordedAt ?? '';
    return ta.localeCompare(tb); // старые первыми
  });
  const toEvict = sorted.slice(0, map.size - maxRecords);
  for (const [id] of toEvict) {
    map.delete(id);
  }
}

/** In-memory DecisionSource по умолчанию */
export class InMemoryDecisionSource implements DecisionSource {
  private readonly store = new Map<string, DecisionRecord>();

  constructor(maxRecords = 10_000) {
    this.maxRecords = maxRecords;
  }

  private readonly maxRecords: number;

  async getAll(): Promise<DecisionRecord[]> {
    return [...this.store.values()];
  }

  async getById(id: string): Promise<DecisionRecord | undefined> {
    return this.store.get(id);
  }

  async save(record: DecisionRecord): Promise<string> {
    const id = record.id || randomUUID();
    this.store.set(id, { ...record, id });
    evictOldest(this.store, this.maxRecords);
    return id;
  }

  async getByCategory(category: string): Promise<DecisionRecord[]> {
    return (await this.getAll()).filter((d) => d.category === category);
  }

  async getByTicker(ticker: string): Promise<DecisionRecord[]> {
    const upper = ticker.toUpperCase();
    return (await this.getAll()).filter((d) =>
      d.tickers.some((t) => t.toUpperCase() === upper),
    );
  }
}

/** In-memory OutcomeSource по умолчанию */
export class InMemoryOutcomeSource implements OutcomeSource {
  private readonly store = new Map<string, OutcomeRecord>();

  constructor(maxRecords = 10_000) {
    this.maxRecords = maxRecords;
  }

  private readonly maxRecords: number;

  async getAll(): Promise<OutcomeRecord[]> {
    return [...this.store.values()];
  }

  async getByDecisionId(
    decisionId: string,
  ): Promise<OutcomeRecord | undefined> {
    return this.store.get(decisionId);
  }

  async save(record: OutcomeRecord): Promise<string> {
    this.store.set(record.decisionId, { ...record });
    evictOldest(this.store, this.maxRecords);
    return record.decisionId;
  }

  async getByDecisionIdList(decisionId: string): Promise<OutcomeRecord[]> {
    const record = this.store.get(decisionId);
    return record ? [record] : [];
  }
}

// ──────────────────────────────────────────────
// Валидация входных данных
// ──────────────────────────────────────────────

/** Валидация DecisionRecord. Возвращает список ошибок (пустой — валидно). */
export function validateDecision(record: DecisionRecord): string[] {
  const errors: string[] = [];
  if (!record.userQuestion || record.userQuestion.trim() === '') {
    errors.push('userQuestion обязателен');
  }
  if (!record.category || record.category.trim() === '') {
    errors.push('category обязательна');
  }
  if (!record.recommendedAction || record.recommendedAction.trim() === '') {
    errors.push('recommendedAction обязателен');
  }
  if (
    typeof record.confidence !== 'number' ||
    Number.isNaN(record.confidence) ||
    record.confidence < 0 ||
    record.confidence > 1
  ) {
    errors.push('confidence должен быть числом 0..1');
  }
  return errors;
}

/** Валидация OutcomeRecord. Возвращает список ошибок (пустой — валидно). */
export function validateOutcome(record: OutcomeRecord): string[] {
  const errors: string[] = [];
  if (!record.decisionId) {
    errors.push('decisionId обязателен');
  }
  if (
    typeof record.satisfaction === 'number' &&
    (record.satisfaction < 1 || record.satisfaction > 5)
  ) {
    errors.push('satisfaction должен быть числом 1..5');
  }
  return errors;
}

// ──────────────────────────────────────────────
// OutcomeTracker
// ──────────────────────────────────────────────

/** Опции OutcomeTracker */
export interface OutcomeTrackerOptions {
  /** DI: источник решений (по умолчанию — in-memory) */
  decisionSource?: DecisionSource;
  /** DI: источник результатов (по умолчанию — in-memory) */
  outcomeSource?: OutcomeSource;
  /** DI: часы для детерминированных тестов (по умолчанию new Date()) */
  now?: () => Date;
}

/**
 * OutcomeTracker — связывает «рекомендацию» и «фактический результат».
 *
 * Пример:
 * ```ts
 * const tracker = new OutcomeTracker();
 * const id = await tracker.trackDecision(decisionRecord);
 * await tracker.recordOutcome({
 *   decisionId: id,
 *   outcome: 'positive',
 *   roiPercent: 12.5,
 *   implemented: true,
 * });
 * const pairs = await tracker.getPairs();
 * ```
 */
export class OutcomeTracker {
  private readonly decisions: DecisionSource;
  private readonly outcomes: OutcomeSource;
  private readonly now: () => Date;

  constructor(options: OutcomeTrackerOptions = {}) {
    this.decisions = options.decisionSource ?? new InMemoryDecisionSource();
    this.outcomes = options.outcomeSource ?? new InMemoryOutcomeSource();
    this.now = options.now ?? (() => new Date());
  }

  /** Зарегистрировать решение (рекомендацию). Возвращает ID. */
  async trackDecision(record: DecisionRecord): Promise<string> {
    const errors = validateDecision(record);
    if (errors.length > 0) {
      throw new OutcomeTrackerError(`Невалидное решение: ${errors.join('; ')}`);
    }
    const id = record.id || randomUUID();
    return this.decisions.save({
      ...record,
      id,
      createdAt: record.createdAt || this.now().toISOString(),
    });
  }

  /** Зафиксировать результат решения. */
  async recordOutcome(
    record: Omit<OutcomeRecord, 'recordedAt'> &
      Partial<Pick<OutcomeRecord, 'recordedAt'>>,
  ): Promise<string> {
    const errors = validateOutcome(record as OutcomeRecord);
    if (errors.length > 0) {
      throw new OutcomeTrackerError(
        `Невалидный результат: ${errors.join('; ')}`,
      );
    }
    const decision = await this.decisions.getById(record.decisionId);
    if (!decision) {
      throw new OutcomeTrackerError(
        `Решение "${record.decisionId}" не найдено — результат не может быть записан`,
      );
    }
    return this.outcomes.save({
      ...record,
      decisionId: record.decisionId,
      recordedAt: record.recordedAt || this.now().toISOString(),
    });
  }

  /** Получить решение по ID. */
  async getDecision(id: string): Promise<DecisionRecord | undefined> {
    return this.decisions.getById(id);
  }

  /** Получить результат по decisionId. */
  async getOutcome(decisionId: string): Promise<OutcomeRecord | undefined> {
    return this.outcomes.getByDecisionId(decisionId);
  }

  /** Получить все связки «решение → результат» (matched = есть результат). */
  async getPairs(): Promise<DecisionOutcomePair[]> {
    const [decisions, outcomes] = await Promise.all([
      this.decisions.getAll(),
      this.outcomes.getAll(),
    ]);
    const outcomeByDecisionId = new Map(outcomes.map((o) => [o.decisionId, o]));
    return decisions.map((decision) => {
      const outcome = outcomeByDecisionId.get(decision.id) ?? null;
      return { decision, outcome, matched: outcome !== null };
    });
  }

  /** Решения без результатов (ожидают наблюдения). */
  async getPendingDecisions(): Promise<DecisionRecord[]> {
    const pairs = await this.getPairs();
    return pairs.filter((p) => !p.matched).map((p) => p.decision);
  }

  /** Решения по категории. */
  async getDecisionsByCategory(category: string): Promise<DecisionRecord[]> {
    return this.decisions.getByCategory(category);
  }

  /** Решения по тикеру. */
  async getDecisionsByTicker(ticker: string): Promise<DecisionRecord[]> {
    return this.decisions.getByTicker(ticker);
  }

  /** Количество решений и результатов. */
  async getStats(): Promise<{ decisions: number; outcomes: number }> {
    const [decisions, outcomes] = await Promise.all([
      this.decisions.getAll(),
      this.outcomes.getAll(),
    ]);
    return { decisions: decisions.length, outcomes: outcomes.length };
  }
}
