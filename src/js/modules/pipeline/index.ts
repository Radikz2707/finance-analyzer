/**
 * Публичный API мультиагентного конвейера.
 *
 * Собирает в единую точку входа: базовые типы агентов и фабрики состояний,
 * готовые агенты (Data/Research/Analysis/AI/Notification), оркестратор
 * PipelineCoordinator, планировщик PipelineScheduler с cron-утилитами.
 */
export * from './agent/index.js';
export * from './agents/index.js';
export * from './director/index.js';
export { PipelineCoordinator } from './pipeline-coordinator.js';
export type {
  PipelineResult,
  PipelineStage,
  PipelineStageResult,
} from './pipeline-coordinator.js';
export { PipelineScheduler, type ScheduleEntry } from './pipeline-scheduler.js';
export {
  parseCron,
  matchesCron,
  nextCronRun,
  type CronFields,
} from './pipeline-scheduler.js';
