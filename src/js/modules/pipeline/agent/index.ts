/**
 * Базовая модель агента конвейера.
 *
 * Экспортирует типы состояния/результата/конфигурации агента, состояние
 * конвейера PipelineState, фабрику createPipelineState и абстрактный
 * базовый класс AgentBase (жизненный цикл агента).
 */
export type {
  AgentState,
  AgentResult,
  AgentConfig,
  AgentSummary,
  PipelineState,
} from './types.js';

export { createPipelineState } from './types.js';

export { AgentBase } from './agent-base.js';
