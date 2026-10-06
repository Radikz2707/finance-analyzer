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
export {
  FileAgent,
  type FileAgentAction,
  type FileAgentInput,
  type FileAgentOutput,
  type FileAgentOptions,
  type FileEntryInfo,
  isInside,
  buildGlobMatcher,
  parseYaml,
} from './file-agent.js';
export {
  ConfigAgent,
  deepMergeConfig,
  assertJsonValue,
  isPlainObject,
  VSCodeSettingsPath,
  VSCodeExtensionsPath,
  type ConfigAgentAction,
  type ConfigAgentInput,
  type ConfigAgentOutput,
  type ConfigAgentOptions,
} from './config-agent.js';
export {
  TerminalAgent,
  TerminalCommandError,
  type TerminalAgentInput,
  type TerminalAgentOutput,
  type TerminalAgentOptions,
  type TerminalLogEntry,
  TERMINAL_ALLOWED_COMMANDS,
  TERMINAL_DENY_PATTERNS,
  TERMINAL_INJECTION_CHARS,
} from './terminal-agent.js';
export {
  SecurityAgent,
  type DangerLevel,
  type SecurityActionKind,
  type SecurityActionRequest,
  type SecurityAgentOptions,
  type SecurityDecision,
  type SecurityVerdict,
} from './security-agent.js';
export {
  ProcessAgent,
  type ManagedProcessInfo,
  type ManagedProcessStatus,
  type ProcessAgentAction,
  type ProcessAgentInput,
  type ProcessAgentOptions,
  type ProcessAgentOutput,
} from './process-agent.js';
export {
  PackageAgent,
  type PackageAction,
  type PackageAgentInput,
  type PackageAgentOutput,
  type PackageAgentOptions,
  type PackageConflict,
  type PackageManager,
  type TerminalLike,
} from './package-agent.js';
export {
  HistoryAgent,
  createHistoryAgent,
  wrapAgentExecution,
  type AgentLike,
  type HistoryAgentOptions,
  type HistoryEvent,
  type HistoryEventInput,
  type HistoryFindQuery,
  type HistoryStats,
  type HistoryStatus,
  type HistoryTrace,
  type RunSession,
  type WrapAgentExecutionOptions,
} from './history-agent.js';
export {
  BrowserAgent,
  DefaultNewsProvider,
  DefaultPriceProvider,
  createBrowserAgent,
  isUrlAllowed,
  DEFAULT_ALLOWED_DOMAINS,
  type BrowserAgentAction,
  type BrowserAgentInput,
  type BrowserAgentOutput,
  type BrowserAgentOptions,
  type BrowserGatewayLike,
  type NavigateOptions,
  type NavigateResult,
  type NewsCacheLike,
  type NewsProviderLike,
  type PriceProviderLike,
  type UrlCheckResult,
  type WebResult,
} from './browser-agent.js';
export {
  SchedulerAgent,
  DEFAULT_TICK_MS,
  type SchedulerAgentAction,
  type SchedulerAgentEvent,
  type SchedulerAgentInput,
  type SchedulerAgentOptions,
  type SchedulerAgentOutput,
  type SchedulerEventFilter,
  type SchedulerEventType,
  type SchedulerJobStatus,
  type SchedulerJobTask,
  type SchedulerNotifyConfig,
  type SchedulerTriggerResult,
  type ScheduledJobInfo,
} from './scheduler-agent.js';
export {
  LearningAgent,
  LearningAgentError,
  computeDecayedWeight,
  buildLessonPattern,
  parseStoredLesson,
  DEFAULT_HALF_LIFE_DAYS,
  DEFAULT_LESSON_WEIGHT,
  type ActionMetrics,
  type AgentMetrics,
  type AnalyzeResult,
  type CommonFailure,
  type FeedbackEntry,
  type LearningAction,
  type LearningAgentInput,
  type LearningAgentOptions,
  type LearningAgentOutput,
  type LearningEvent,
  type LearningMemorySource,
  type LearningMetrics,
  type LearningOutcome,
  type LearningStatus,
  type Lesson,
  type LessonSource,
  type PredictResult,
  type ReportResult,
} from './learning-agent.js';
export {
  AutoRepairAgent,
  createFsFileOps,
  type AutoRepairAction,
  type AutoRepairAgentOptions,
  type AutoRepairContext,
  type AutoRepairInput,
  type AutoRepairOutput,
  type AutoRepairScope,
  type FileOpsLike,
  type HealthCheckResult,
  type HealthChecker,
  type HealthStatus,
  type RepairFix,
  type RepairFixKind,
  type RepairSeverity,
} from './auto-repair-agent.js';
