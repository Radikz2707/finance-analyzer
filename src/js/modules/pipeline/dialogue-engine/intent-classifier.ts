/**
 * IntentClassifier — классификация интента реплики пользователя.
 *
 * Двухконтурная архитектура:
 * 1. LLM-классификация (OllamaClient.chat, JSON-схема ответа) — понимает
 *    свободную речь, follow-up, эмоции;
 * 2. Детерминированный fallback на nl-parser (существующие regex/словари) —
 *    работает офлайн, покрывает все прежние ветки BrowserDirector/DirectorAgent.
 *
 * LLM-результат принимается только при confidence >= порога и валидном
 * интенте; иначе — fallback (честность: не выдумываем интент).
 *
 * Модуль чистый: нет Node-зависимостей, LLM-клиент — DI (type-only импорт).
 */

import {
  looksLikeAutomationRequest,
  looksLikeCodeRequest,
  looksLikeCorrection,
  looksLikeFileRequest,
  looksLikeGulpResourceRequest,
  looksLikeGreeting,
  looksLikeOffTopic,
  looksLikePackageRequest,
  looksLikeProcessRequest,
  looksLikeReportRequest,
  looksLikeSimpleChat,
  looksLikeStatusQuestion,
  looksLikeSystemStatusRequest,
  looksLikeTaskIntent,
  looksLikeTerminalRequest,
  parseUserMessage,
} from '../director/nl-parser.js';
import type {
  UserQuestionCategory,
  UserIntent,
} from '../director/director-types.js';
import type {
  DialogueActionKind,
  DialogueAnalysis,
  DialogueContext,
  DialogueIntent,
  IntentClassifierOptions,
  LlmChatLike,
} from './types.js';

// ──────────────────────────────────────────────
// 1. Константы
// ──────────────────────────────────────────────

/** Валидные интенты диалога */
const VALID_INTENTS: ReadonlySet<string> = new Set([
  'greeting',
  'farewell',
  'status',
  'off-topic',
  'correction',
  'report',
  'smalltalk',
  'courtesy',
  'task',
  'action',
  'portfolio',
  'asset',
  'comparison',
  'scenario',
  'market',
  'news',
  'strategy',
  'plan',
  'past-decision',
  'system-quality',
  'unknown',
]);

/** Интенты, не требующие агентов */
const NO_AGENTS_INTENTS: ReadonlySet<DialogueIntent> = new Set([
  'greeting',
  'farewell',
  'status',
  'off-topic',
  'correction',
  'report',
  'smalltalk',
  'courtesy',
  'task',
  'unknown',
]);

/** Системный промпт LLM-классификации */
const DEFAULT_SYSTEM_PROMPT = `Ты — классификатор реплик финансового ассистента.
Определи интент, эмоцию и тикеры (тикеры MOEX: SBER, GAZP, LKOH, PLZL, GMKN, ROSN, VTBR, YNDX, MGNT, AFLT, MTLR, TATN, SNGS, MTSS, FLOT, ALRS, CHMF, NLMK, PHOR, MAGN, VKCO и др.).

Интенты:
- greeting — приветствие («привет», «добрый день»);
- farewell — прощание («пока», «до свидания»);
- status — «как дела», «что нового»;
- off-topic — тема вне финансов (погода, спорт, еда);
- correction — поправка к данным портфеля («доля PLZL 19%»);
- report — запрос отчёта/анализа («покажи отчёт», «видишь мой отчёт?»);
- smalltalk — бытовой разговор («расскажи о себе»);
- courtesy — благодарность/вежливость («спасибо», «ок»);
- task — задача/идея («давай добавим экспорт в PDF»);
- action — операция с компьютером (файл, терминал, код);
- portfolio — вопрос о портфеле в целом;
- asset — вопрос по конкретному активу;
- comparison — сравнение («что лучше: SBER или VTBR?»);
- scenario — «что если», сценарий;
- market — рынок, макро, ставка ЦБ;
- news — новости;
- strategy — стратегия, цели;
- plan — план на будущее;
- past-decision — пересмотр прошлого решения;
- system-quality — качество работы системы;
- unknown — не распознано.

Эмоции: positive, negative, concerned, urgent, neutral.

Ответь СТРОГО одним JSON-объектом без markdown:
{"intent":"...","emotion":"...","tickers":["SBER"],"confidence":0.9,"needsAgents":true,"actionKind":"file|terminal|code|null","summary":"одно предложение"}`;

/** Порог доверия LLM-ответу по умолчанию */
const DEFAULT_MIN_CONFIDENCE = 0.55;

/** Таймаут LLM-запроса по умолчанию, мс */
const DEFAULT_TIMEOUT_MS = 5000;

/** Маппинг категории nl-parser → интент диалога */
const CATEGORY_TO_INTENT: Readonly<
  Record<UserQuestionCategory, DialogueIntent>
> = {
  asset: 'asset',
  portfolio: 'portfolio',
  comparison: 'comparison',
  scenario: 'scenario',
  market: 'market',
  news: 'news',
  strategy: 'strategy',
  plan: 'plan',
  'past-decision': 'past-decision',
  'system-quality': 'system-quality',
  general: 'unknown',
};

/** Маппинг интента диалога → интенция Director (для delegation-planner) */
const INTENT_TO_DIRECTOR_INTENT: Readonly<Record<DialogueIntent, UserIntent>> =
  {
    greeting: 'general-inquiry',
    farewell: 'general-inquiry',
    status: 'general-inquiry',
    'off-topic': 'general-inquiry',
    correction: 'understand',
    report: 'understand',
    smalltalk: 'general-inquiry',
    courtesy: 'general-inquiry',
    task: 'plan-future',
    action: 'decide-action',
    portfolio: 'understand',
    asset: 'understand',
    comparison: 'compare-options',
    scenario: 'explore-scenario',
    market: 'understand',
    news: 'understand',
    strategy: 'plan-future',
    plan: 'plan-future',
    'past-decision': 'review-past',
    'system-quality': 'critique-system',
    unknown: 'general-inquiry',
  };

// ──────────────────────────────────────────────
// 2. Классификатор
// ──────────────────────────────────────────────

/**
 * Классификатор интентов: LLM с fallback на nl-parser.
 */
export class IntentClassifier {
  private readonly llm?: LlmChatLike;
  private readonly systemPrompt: string;
  private readonly minConfidence: number;
  private readonly timeoutMs: number;

  constructor(options?: IntentClassifierOptions) {
    this.llm = options?.llm;
    this.systemPrompt = options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.minConfidence = options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Есть ли подключённый LLM */
  hasLlm(): boolean {
    return this.llm !== undefined;
  }

  /**
   * Классифицировать реплику: LLM → fallback.
   * Никогда не бросает: падение LLM даёт fallback-анализ.
   */
  async classify(
    text: string,
    context: DialogueContext,
  ): Promise<DialogueAnalysis> {
    const trimmed = (text ?? '').trim();
    if (trimmed === '') {
      return fallbackClassify('', context);
    }

    if (this.llm) {
      const llmResult = await this.tryLlm(trimmed, context);
      if (llmResult) {
        return { ...llmResult, source: 'llm' as const };
      }
    }

    return fallbackClassify(trimmed, context);
  }

  // ── LLM-контур ──

  private async tryLlm(
    text: string,
    context: DialogueContext,
  ): Promise<DialogueAnalysis | null> {
    try {
      const historyText = context.historyTail
        .slice(-4)
        .map((entry) => `${entry.role}: ${entry.text}`)
        .join('\n');
      const userPrompt = [
        'Реплика пользователя:',
        text,
        historyText ? '\nПоследние реплики диалога:\n' + historyText : '',
        '\nВерни JSON-объект классификации.',
      ]
        .filter(Boolean)
        .join('\n');

      const raw = await this.withTimeout(
        this.llm!.chat([
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: userPrompt },
        ]),
        this.timeoutMs,
      );
      if (raw === null) return null;

      const parsed = parseLlmJson(raw);
      if (!parsed) return null;

      const intent = parsed.intent;
      if (typeof intent !== 'string' || !VALID_INTENTS.has(intent)) return null;

      const confidence = clamp01(parsed.confidence ?? 0);
      if (confidence < this.minConfidence) return null;

      return buildAnalysis(
        text,
        intent as DialogueIntent,
        emotionFromString(parsed.emotion),
        confidence,
        tickersFromUnknown(parsed.tickers),
        {
          actionKind: actionKindFromString(parsed.actionKind),
          summary: parsed.summary,
        },
        context,
        'llm',
      );
    } catch {
      return null;
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
      );
    });
  }
}

// ──────────────────────────────────────────────
// 3. Fallback-классификация (nl-parser)
// ──────────────────────────────────────────────

/**
 * Детерминированная классификация через nl-parser.
 * Порядок проверок сохраняет поведение прежних веток BrowserDirector/DirectorAgent.
 */
export function fallbackClassify(
  text: string,
  context: DialogueContext,
): DialogueAnalysis {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') {
    return buildAnalysis(
      '',
      'unknown',
      'neutral',
      0,
      [],
      {},
      context,
      'fallback',
    );
  }

  // 1. Приветствие (короткие сообщения)
  if (looksLikeGreeting(trimmed)) {
    return buildAnalysis(
      trimmed,
      'greeting',
      'positive',
      0.95,
      [],
      {},
      context,
      'fallback',
    );
  }

  // 2. Прощание (явные границы: «покажи…» не считается прощанием,
  // т.к. \b не работает с кириллицей — кириллица не входит в \w)
  if (
    /(?:^|[\s,.!?])(пока|до свидания|до встречи|прощай)(?:[\s,.!?]|$)/i.test(
      trimmed,
    ) ||
    /\b(bye|see\s+you)\b/i.test(trimmed)
  ) {
    return buildAnalysis(
      trimmed,
      'farewell',
      'neutral',
      0.95,
      [],
      {},
      context,
      'fallback',
    );
  }

  // 3. Вежливость (короткие)
  if (
    /^(спасибо|благодарю|понятно|ок|окей|ага|да|нет|ладно|отлично)$/i.test(
      trimmed,
    )
  ) {
    return buildAnalysis(
      trimmed,
      'courtesy',
      'positive',
      0.9,
      [],
      {},
      context,
      'fallback',
    );
  }

  // 3.5 Запрос возможностей/помощи («что ты умеешь», «помощь», «help») —
  // smalltalk-ответ о возможностях БЕЗ запуска агентов
  if (
    /что (ты )?(умеешь|можешь)|помощь|help|функции|какие (у тебя )?(возможности|команды)/i.test(
      trimmed,
    )
  ) {
    return buildAnalysis(
      trimmed,
      'smalltalk',
      'neutral',
      0.85,
      [],
      {},
      context,
      'fallback',
    );
  }

  // 4. Статус («как дела», «что нового») — без тикеров и не портфельный
  const parsedQuick = parseUserMessage(trimmed);
  const isStatus =
    looksLikeStatusQuestion(trimmed) &&
    parsedQuick.category === 'general' &&
    parsedQuick.tickers.length === 0;
  if (isStatus) {
    return buildAnalysis(
      trimmed,
      'status',
      'neutral',
      0.85,
      [],
      {},
      context,
      'fallback',
    );
  }

  // 5. Поправка к данным портфеля
  if (looksLikeCorrection(trimmed)) {
    const entities: Record<string, unknown> = {};
    return buildAnalysis(
      trimmed,
      'correction',
      'neutral',
      0.9,
      parsedQuick.tickers,
      entities,
      context,
      'fallback',
    );
  }

  // 6. Запрос отчёта/анализа (до off-topic: «покажи отчёт» — не погода)
  if (looksLikeReportRequest(trimmed)) {
    return buildAnalysis(
      trimmed,
      'report',
      'neutral',
      0.85,
      [],
      {},
      context,
      'fallback',
    );
  }

  // 7. Задача/идея → цель автономного цикла
  if (looksLikeTaskIntent(trimmed)) {
    return buildAnalysis(
      trimmed,
      'task',
      'positive',
      0.8,
      [],
      {},
      context,
      'fallback',
    );
  }

  // 8. Action-запрос (file/terminal/code/…) — до off-topic
  const actionKind = detectActionKind(trimmed);
  if (actionKind) {
    return buildAnalysis(
      trimmed,
      'action',
      'neutral',
      0.9,
      parsedQuick.tickers,
      { actionKind },
      context,
      'fallback',
    );
  }

  // 9. Оффтопик (вне финансов) — не перехватываем реплики с тикерами
  if (parsedQuick.tickers.length === 0 && looksLikeOffTopic(trimmed)) {
    return buildAnalysis(
      trimmed,
      'off-topic',
      'neutral',
      0.8,
      [],
      {},
      context,
      'fallback',
    );
  }

  // 10. Бытовой разговор
  if (looksLikeSimpleChat(trimmed)) {
    return buildAnalysis(
      trimmed,
      'smalltalk',
      'neutral',
      0.75,
      [],
      {},
      context,
      'fallback',
    );
  }

  // 11. Категорийная маршрутизация nl-parser
  const category = parsedQuick.category;
  const intent = CATEGORY_TO_INTENT[category] ?? 'unknown';
  const needsAgents = category !== 'general';
  return buildAnalysis(
    trimmed,
    intent,
    'neutral',
    0.7,
    parsedQuick.tickers,
    {},
    context,
    'fallback',
    needsAgents,
  );
}

/** Определить вид action-запроса (приоритет: специфичные → общие) */
export function detectActionKind(text: string): DialogueActionKind | undefined {
  if (looksLikeGulpResourceRequest(text)) return 'terminal';
  if (looksLikeCodeRequest(text)) return 'code';
  if (looksLikeFileRequest(text)) return 'file';
  if (looksLikePackageRequest(text)) return 'package';
  if (looksLikeProcessRequest(text)) return 'process';
  if (looksLikeAutomationRequest(text)) return 'automation';
  if (looksLikeSystemStatusRequest(text)) return 'system';
  if (looksLikeTerminalRequest(text)) return 'terminal';
  return undefined;
}

// ──────────────────────────────────────────────
// 4. Helpers
// ──────────────────────────────────────────────

/** Построить DialogueAnalysis из параметров */
function buildAnalysis(
  text: string,
  intent: DialogueIntent,
  emotion: DialogueAnalysis['emotion'],
  confidence: number,
  tickers: string[],
  entities: Record<string, unknown>,
  context: DialogueContext,
  source: 'llm' | 'fallback',
  needsAgentsOverride?: boolean,
): DialogueAnalysis {
  const category = intentToCategory(intent);
  const needsAgents = needsAgentsOverride ?? !NO_AGENTS_INTENTS.has(intent);
  return {
    intent,
    emotion,
    confidence: clamp01(confidence),
    tickers: unique(tickers),
    entities,
    needsAgents,
    isFollowUp: context.lastTickers.length > 0 && tickers.length === 0,
    rawText: text,
    category,
    directorIntent: INTENT_TO_DIRECTOR_INTENT[intent] ?? 'general-inquiry',
    actionKind: entities.actionKind as DialogueActionKind | undefined,
    source,
  };
}

/** Маппинг интента → категория nl-parser (обратный) */
function intentToCategory(intent: DialogueIntent): UserQuestionCategory {
  switch (intent) {
    case 'portfolio':
      return 'portfolio';
    case 'asset':
      return 'asset';
    case 'comparison':
      return 'comparison';
    case 'scenario':
      return 'scenario';
    case 'market':
      return 'market';
    case 'news':
      return 'news';
    case 'strategy':
      return 'strategy';
    case 'plan':
      return 'plan';
    case 'past-decision':
      return 'past-decision';
    case 'system-quality':
      return 'system-quality';
    default:
      return 'general';
  }
}

/** Распарсить JSON из ответа LLM (ленивый парсинг JSON-блока) */
function parseLlmJson(raw: string): {
  intent?: string;
  emotion?: string;
  tickers?: unknown;
  confidence?: number;
  actionKind?: string;
  summary?: string;
} | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    return {
      intent: typeof data.intent === 'string' ? data.intent : undefined,
      emotion: typeof data.emotion === 'string' ? data.emotion : undefined,
      tickers: data.tickers,
      confidence:
        typeof data.confidence === 'number' ? data.confidence : undefined,
      actionKind:
        typeof data.actionKind === 'string' ? data.actionKind : undefined,
      summary: typeof data.summary === 'string' ? data.summary : undefined,
    };
  } catch {
    return null;
  }
}

/** Нормализовать эмоцию из строки LLM */
function emotionFromString(
  value: string | undefined,
): DialogueAnalysis['emotion'] {
  switch (value) {
    case 'positive':
    case 'negative':
    case 'concerned':
    case 'urgent':
      return value;
    default:
      return 'neutral';
  }
}

/** Нормализовать actionKind из строки LLM */
function actionKindFromString(
  value: string | undefined,
): DialogueActionKind | undefined {
  switch (value) {
    case 'file':
    case 'terminal':
    case 'package':
    case 'process':
    case 'automation':
    case 'system':
    case 'code':
    case 'self-improve':
      return value;
    default:
      return undefined;
  }
}

/** Нормализовать тикеры из LLM (валидные строки, uppercase) */
function tickersFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim() !== '') {
      result.push(item.trim().toUpperCase());
    }
  }
  return unique(result);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
