/**
 * DialogueEngine — модуль естественного диалога Director.
 *
 * Заменяет regex-маршрутизацию на LLM-центричную классификацию
 * (с fallback на nl-parser) и даёт живые smalltalk-ответы без агентов.
 */

export { DialogueEngine, createDialogueEngine } from './dialogue-engine.js';
export type { DialogueEngineOptions } from './dialogue-engine.js';
export {
  IntentClassifier,
  fallbackClassify,
  detectActionKind,
} from './intent-classifier.js';
export { ContextTracker } from './context-tracker.js';
export {
  detectEmotion,
  emotionLabel,
  emotionToneInstruction,
} from './emotion-detector.js';
export { emptyDialogueContext } from './types.js';
export type {
  DialogueAnalysis,
  DialogueAnalysisInput,
  DialogueActionKind,
  DialogueContext,
  DialogueEmotion,
  DialogueIntent,
  IntentClassifierFn,
  IntentClassifierOptions,
  LlmChatLike,
  LlmMessage,
  SmallTalkResponse,
} from './types.js';
