/**
 * Agent Activity — типы стрима активности агентов в реальном времени.
 *
 * Назначение: пользователь видит, какие агенты запущены, что делают прямо
 * сейчас (шаги), что получили. События эмитятся фасадом агентов
 * (agent-facade) и CodingWorkflow, а подписчики (desktop renderer) получают
 * их через ActivityStream.
 */

/** Фаза жизненного цикла активности агента */
export type AgentActivityPhase = 'started' | 'step' | 'completed' | 'failed';

/** Событие активности агента */
export interface AgentActivityEvent {
  /** Уникальный ID события */
  id: string;
  /** ID задачи Director, в рамках которой работает агент */
  taskId: string;
  /** Роль агента (research/analysis/ai/code/...) */
  role: string;
  /** Фаза: старт / шаг / завершение / провал */
  phase: AgentActivityPhase;
  /** Человекочитаемое сообщение («собираю факты по SBER») */
  message: string;
  /** Дополнительные данные (например, длительность) */
  detail?: Record<string, unknown>;
  /** Время события (ISO-8601) */
  timestamp: string;
  /** Длительность фазы, мс (для completed/failed) */
  durationMs?: number;
}

/** Подписчик потока активности */
export type ActivitySubscriber = (event: AgentActivityEvent) => void;
