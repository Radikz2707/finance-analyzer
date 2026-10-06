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

// ── Единый стандарт контрактов action-агентов ──

export type { AgentActionInput, AgentActionResult } from './agent-contract.js';

export {
  createActionResult,
  failActionResult,
  isActionInput,
} from './agent-contract.js';

// ── Тестовый фреймворк для агентов ──

export {
  AgentHarnessAssertionError,
  AgentHarnessTimeoutError,
  collectExamples,
  createAgentHarness,
  mockAgentLike,
  type AgentExample,
  type AgentExamplesReport,
  type AgentHarness,
  type AgentHarnessEvent,
  type AgentHarnessOptions,
  type AgentHarnessTarget,
  type MockAgentOptions,
} from './agent-testing.js';
