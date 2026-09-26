/**
 * AI Advisor Module — модуль AI-советника для анализа портфеля.
 *
 * Содержит:
 * - AI-клиент для работы с LLM
 * - Генерацию отчётов и рекомендаций
 * - Валидацию и кэширование
 * - Интеграцию с исследованиями
 *
 * @module ai-advisor
 */

export * from './ai-advisor.js';
export { AiClient } from './ai-client.js';
export { postProcessAiText } from './ai-validation.js';
export { sanitizeAiNarrative, assertFinalAiDisplaySafe, assertFinalReportSafe } from './ollama-manager.js';
export { buildStructuredAIRecommendation, type StructuredAIAssetRecommendation } from './structured-ai-recommendation.js';
export { buildAssetResearchSnapshot, buildPortfolioAssetContext } from './snapshot-builder.js';
export { suggestAllAutoTargets } from './auto-target-allocator.js';
export { PriceAlertsModule } from './price-alerts.js';
export { calculatePortfolioIncome } from './income-calculator.js';
export { buildOrdersHtmlAndMd } from './report-builders.js';
export { getMarkdownTemplate } from './report-templates.js';
export { NEWS_SOURCES, RELEVANCE_KEYWORDS, USER_AGENT } from './news-config.js';
export { NewsFetcherModule, type NewsArticle } from './news-fetcher.js';
export { localCache, getCachedResponse, type CachedResponse, type CacheConfig } from './ollama-cache.js';
export { isOllamaRunning, listModels, showModelInfo, isModelInstalled, pullModel, deleteModel, copyModel, cleanAiResponse, validateAiOutput, formatFileSize, formatModelList, OLLAMA_BASE_URL, type OllamaModelInfo, type OllamaTagsResponse, type OllamaShowResponse, type OllamaChatOptions, type OllamaMessage, type DeterministicAmounts, type ArithmeticValidationResult } from './ollama-manager.js';
export { streamChat, chatWithoutStream, createLoadingIndicator, formatStreamStats, type StreamChunkCallback, type StreamStatusCallback, type StreamOptions, type StreamResult } from './ollama-stream.js';
export { PortfolioConfig } from '../../config/portfolio-config.js';
export { getCbrKeyRate, clearCbrRateCache, formatCbrRateDisplay, getCachedRate, type CbrRateData } from './cbr-rate.js';
export { buildFallbackReport } from './fallback-report-builder.js';
export { AI_MODELS, CURRENT_AI_MODEL, getAvailableModels, isOllamaAvailable, getOllamaStatus, getNextModel, type AiModelConfig } from './ai-config.js';

export type * from './types.js';
