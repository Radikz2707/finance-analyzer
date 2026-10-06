/**
 * Agent Contract — единый стандарт контрактов action-агентов.
 *
 * Action-агент — это агент, который принимает `{ action, ...params }`
 * и возвращает результат с полем `action`. До унификации контракты
 * разъезжались («у кого success в данных, у кого нет»): этот модуль задаёт
 * единую форму входа и результата плюс лёгкие хелперы.
 *
 * ⚠️ Модуль лёгкий и БЕЗ импортов агентов/инфраструктуры: используется
 * типами action-агентов, тестовым фреймворком и потребителями (Director).
 * Аналитические агенты (Data/Research/Analysis/AI и др.) НЕ трогаются —
 * у них своя специфика.
 */

// ──────────────────────────────────────────────
// 1. Единая форма входа
// ──────────────────────────────────────────────

/**
 * Единая форма входа action-агента: `{ action, ...params }`.
 *
 * @typeParam A — конкретное действие (union строк, например `FileAgentAction`);
 * @typeParam P — параметры действия (остальные поля входа).
 */
export type AgentActionInput<
  A extends string = string,
  P extends object = Record<string, unknown>,
> = { action: A } & P;

// ──────────────────────────────────────────────
// 2. Единая форма результата
// ──────────────────────────────────────────────

/**
 * Единая форма результата action-агента: `{ action, success, message, data? }`.
 *
 * Нормализует разнобой выходных контрактов: все action-агенты возвращают
 * `action` + `success` + `message`, а специфичные данные — в `data`.
 *
 * @typeParam A — конкретное действие;
 * @typeParam D — тип специфичных данных действия.
 */
export interface AgentActionResult<A extends string = string, D = unknown> {
  /** Выполненное действие */
  action: A;
  /** Успешно ли выполнено действие */
  success: boolean;
  /** Человекочитаемое описание результата */
  message: string;
  /** Специфичные данные действия */
  data?: D;
}

// ──────────────────────────────────────────────
// 3. Хелперы создания результатов
// ──────────────────────────────────────────────

/**
 * Создать успешный результат action-агента.
 *
 * @param action — выполненное действие;
 * @param data — специфичные данные (опционально);
 * @param message — человекочитаемое описание (по умолчанию 'OK').
 */
export function createActionResult<A extends string, D>(
  action: A,
  data?: D,
  message = 'OK',
): AgentActionResult<A, D> {
  return { action, success: true, message, data };
}

/**
 * Создать ошибочный результат action-агента.
 *
 * @param action — действие, завершившееся ошибкой;
 * @param error — причина (Error или произвольное значение);
 * @param message — переопределённое сообщение (опционально).
 */
export function failActionResult<A extends string>(
  action: A,
  error: unknown,
  message?: string,
): AgentActionResult<A, never> {
  const text =
    message ??
    (error instanceof Error ? error.message : String(error ?? 'Unknown error'));
  return { action, success: false, message: text };
}

// ──────────────────────────────────────────────
// 4. Type guard
// ──────────────────────────────────────────────

/**
 * Проверяет, является ли значение входом action-агента —
 * объектом со строковым полем `action`.
 */
export function isActionInput(value: unknown): value is AgentActionInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { action?: unknown }).action === 'string'
  );
}
