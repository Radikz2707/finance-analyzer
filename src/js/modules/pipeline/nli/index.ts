/**
 * NLI (Задача 3.2): интерфейс на естественном языке.
 */

export { NliEngine, type NliEngineOptions } from './nli-engine.js';
export {
  CATEGORY_KEYWORDS,
  INTENT_KEYWORDS,
  IntentParser,
  IntentParserError,
  type IntentParserOptions,
} from './intent-parser.js';
export type {
  NliEntities,
  NliIntent,
  NliParseResult,
  NliResponse,
} from './types.js';
