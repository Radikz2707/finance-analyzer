/**
 * Готовые агенты конвейера.
 *
 * Экспортирует реализации агентов и их выходные типы:
 * DataAgent (данные/позиции), ResearchAgent (исследование),
 * AnalysisAgent (анализ портфеля), AiAgent (AI-рекомендации),
 * NotificationAgent (уведомления).
 */
export {
  DataAgent,
  type DataAgentOutput,
  type AccountInfo,
  type AssetQuote,
} from './data-agent.js';
export {
  ResearchAgent,
  type ResearchAgentOutput,
  type AssetResearchResult,
} from './research-agent.js';
export {
  AnalysisAgent,
  type AnalysisAgentOutput,
  type PortfolioAnalysisResult,
  type RiskValidationResult,
  type PortfolioIncome,
  type PipelinePriceAlert,
} from './analysis-agent.js';
export {
  AiAgent,
  type AiAgentOutput,
  type AssetThesisResult,
  type AiClientResult,
} from './ai-agent.js';
export {
  NotificationAgent,
  type NotificationAgentOutput,
} from './notification-agent.js';
export {
  StrategistAgent,
  type StrategistAgentInput,
  type StrategistAgentOutput,
  type StrategistDecision,
  type StrategistProposal,
} from './strategist-agent.js';
export {
  ScenarioAgent,
  type ScenarioAgentInput,
  type ScenarioAgentOutput,
  type ScenarioResult,
  type ScenarioChange,
} from './scenario-agent.js';
export {
  runConsilium,
  type ConsiliumInput,
  type ConsiliumOutput,
  type ConsiliumAssetDecision,
  type ConsiliumVote,
} from './consilium.js';
