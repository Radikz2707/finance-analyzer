/**
 * Agent Activity — стриминг шагов агентов в реальном времени.
 *
 * Barrel-экспорт: типы, ActivityStream (EventEmitter + буфер) и
 * форматирование событий в строки чата.
 */

export type {
  AgentActivityEvent,
  AgentActivityPhase,
  ActivitySubscriber,
} from './types.js';
export { ActivityStream } from './activity-stream.js';
export type { ActivityStreamOptions } from './activity-stream.js';
export { formatActivityEvent, roleLabel } from './activity-renderer.js';
