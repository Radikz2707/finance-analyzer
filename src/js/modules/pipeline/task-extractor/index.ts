/**
 * TaskExtractor — извлечение структурированных задач из свободной речи.
 *
 * Директор находит задачи в свободной речи и привлекает нужных агентов
 * (не только портфельных — file/terminal/code/browser/...).
 */

export { TaskExtractor, fallbackExtract } from './task-extractor.js';
export {
  resolveTaskAction,
  TASK_ACTION_LABELS,
  type ResolvedTaskAction,
} from './action-resolver.js';
export type {
  ExtractedTask,
  LlmChatLike,
  LlmMessage,
  TaskAction,
  TaskExtractionContext,
  TaskExtractionResult,
  TaskExtractorOptions,
} from './types.js';
