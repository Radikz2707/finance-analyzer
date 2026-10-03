/**
 * Natural Language Parser для Director Agent.
 *
 * Парсит естественный язык пользователя, определяет:
 * - категорию вопроса
 * - упомянутые тикеры
 * - интенцию
 * - какие агенты нужны
 * - сложность вопроса
 * - нужен ли Consilium
 */

import type {
  InterpretedQuestion,
  UserQuestionCategory,
  UserIntent,
  AgentRole,
} from './director-types.js';

// ──────────────────────────────────────────────
// 1. Словари тикеров
// ──────────────────────────────────────────────

/** Известные тикеры в портфеле */
const KNOWN_TICKERS: string[] = [
  'SBER',
  'GMKN',
  'LKOH',
  'PLZL',
  'ROSN',
  'VTBR',
  'SBERP',
  'GAZP',
  'MGNT',
  'YNDX',
  'AFLT',
  'MTLR',
  'TATN',
  'SNGS',
  'ROSNDR',
  'MTSS',
  'FLOT',
  'ALRS',
  'CHMF',
  'NLMK',
  'PHOR',
  'SENER',
  'MAGN',
  'SKNG',
  'SBER',
  'VKCO',
  'AFKON',
  'BSPB',
  'FEES',
];

// ──────────────────────────────────────────────
// 2. Словари ключевых слов
// ──────────────────────────────────────────────

/**
 * Ключевые слова для категорий вопросов.
 *
 * Порядок в массиве важен: более специфичные категории (comparison, scenario,
 * strategy) идут ПЕРЕД общими (asset, market), чтобы точные совпадения
 * срабатывали раньше.
 */
const CATEGORY_KEYWORDS: Record<UserQuestionCategory, string[]> = {
  // ── Сравнение ── (высокий приоритет)
  comparison: [
    'сравни',
    'сравнение',
    'vs',
    'чем отличается',
    'лучше',
    'хуже',
    'предпочтительнее',
    'вариант',
    'варианта',
    'варианты',
    'держать',
    'удерживать',
    'сократить',
    'усреднить',
    'или',
    'либо',
  ],
  // ── Сценарий ── (высокий приоритет)
  scenario: [
    'что если',
    'что-если',
    'предположим',
    'допустим',
    'если вырастет',
    'если упадёт',
    'сценарий',
    'сценария',
    'сценарии',
    'вырастет на',
    'упадёт на',
    'поднимется на',
    'на 20%',
    'на 10%',
    'на 50%',
    'на 100%',
  ],
  // ── Стратегия ── (высокий приоритет)
  strategy: [
    'стратегия',
    'стратегии',
    'стратегическ',
    'цель',
    'цели',
    'целевой',
    'горизонт',
    'горизонта',
    'инвестировать',
    'инвестирование',
    'дивидендная стратегия',
  ],
  // ── Портфель ──
  portfolio: [
    'портфель',
    'портфеля',
    'портфелю',
    'портфеле',
    'структура',
    'структуру',
    'структуре',
    'концентрация',
    'диверсификация',
    'диверсификации',
  ],
  // ── Актив ── (средний приоритет — ниже сравнения/сценария)
  asset: [
    'актив',
    'акция',
    'облигация',
    'бумага',
    'позиция',
    'полюс',
    'сбер',
    'газпром',
    'лукойл',
    'роснефть',
    'втб',
    'аэрофлот',
    'алроса',
    'мгнц',
    'яндекс',
    'вк',
    'aplra',
    'plzl',
    'gmkn',
    'lkoh',
    'sber',
    'rosn',
    'gazp',
    'vtbr',
    'купить',
    'продать',
    'сделать',
    'что делать',
  ],
  // ── Рынок ──
  market: [
    'рынок',
    'рынка',
    'рынку',
    'рынке',
    'мосбиржа',
    'москвы',
    'биржа',
    'индекс',
    'индекса',
    'монетарная',
    'ставка',
    'ключевая',
    'цб',
    'центробанк',
    'макро',
    'макроэкономика',
    'инфляция',
  ],
  // ── Новости ──
  news: [
    'новость',
    'новости',
    'новостях',
    'отчёт',
    'отчёта',
    'отчёте',
    'дивиденд',
    'дивидендов',
    'дивидендная',
    'купон',
    'купонный',
    'анализ',
    'анализа',
    'событие',
    'события',
  ],
  // ── План ──
  plan: [
    'план',
    'плана',
    'планирую',
    'планироват',
    'месяц',
    'месяца',
    'месяцев',
    'год',
    'года',
    'лет',
    'будущее',
    'перспектив',
    'через полгода',
    'через год',
    'через три месяца',
  ],
  // ── Прошлое решение ──
  'past-decision': [
    'в прошлый раз',
    'раньше',
    'прежде',
    'до этого',
    'почему ты решил',
    'почему ты сказал',
    'что изменилось',
    'какие ошибки',
    'ошибки',
    'ошибку',
    'ошибкой',
    'решение',
    'решения',
    'решением',
    'рекомендация',
    'рекомендации',
  ],
  // ── Качество системы ──
  'system-quality': [
    'как работает',
    'насколько хорошо',
    'качество',
    'ошибк',
    'баг',
    'проблем',
    'агент',
    'агентов',
    'pipeline',
    'конвейер',
    'улучшить',
    'улучшение',
    'нужен новый',
    'добавить',
  ],
  // ── Общий ── (самый низкий приоритет)
  general: [
    'помощь',
    'help',
    'что ты умеешь',
    'что можешь',
    'расскажи',
    'объясни',
    'что такое',
  ],
};

/** Ключевые слова для интенций */
const INTENT_KEYWORDS: Record<UserIntent, string[]> = {
  understand: [
    'почему',
    'как',
    'расскажи',
    'объясни',
    'понять',
    'ситуация',
    'ситуации',
    'происходит',
    'произошло',
    'что сейчас',
    'что происходит',
  ],
  'decide-action': [
    'что делать',
    'сделать',
    'купить',
    'продать',
    'увеличить',
    'уменьшить',
    'сократить',
    'выйти',
    'усреднить',
    'стоит ли',
    'нужно ли',
    'следует',
  ],
  'compare-options': [
    'сравни',
    'сравнение',
    'вариант',
    'лучше',
    'хуже',
    'сократить',
    'усреднить',
  ],
  'explore-scenario': [
    'что если',
    'что-если',
    'предположим',
    'допустим',
    'если вырастет',
    'если упадёт',
    'сценарий',
    'а если',
  ],
  'review-past': [
    'в прошлый раз',
    'раньше',
    'почему ты решил',
    'что изменилось',
    'ошибки',
    'решение',
    'рекомендация',
  ],
  'plan-future': [
    'планирую',
    'горизонт',
    'цель',
    'на год',
    'через полгода',
    'через год',
  ],
  'critique-system': [
    'насколько хорошо',
    'качество',
    'ошибки',
    'агент',
    'pipeline',
    'конвейер',
  ],
  'general-inquiry': ['расскажи', 'объясни', 'что такое', 'помощь'],
};

// ──────────────────────────────────────────────
// 3. Парсер
// ──────────────────────────────────────────────

/**
 * Порядок проверки категорий (от более специфичных к более общим).
 * Это гарантирует, что «стратегия» сработает раньше «лучше»,
 * а «сценарий» — раньше «рынок».
 */
const CATEGORY_CHECK_ORDER: UserQuestionCategory[] = [
  'strategy',
  'scenario',
  'comparison',
  'portfolio',
  'asset',
  'market',
  'news',
  'plan',
  'past-decision',
  'system-quality',
];

/**
 * Определить категорию вопроса по тексту.
 */
function detectCategory(text: string): UserQuestionCategory {
  const lower = text.toLowerCase();

  // Проверяем в строгом порядке приоритета
  for (const category of CATEGORY_CHECK_ORDER) {
    const keywords = CATEGORY_KEYWORDS[category];
    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return category;
      }
    }
  }

  return 'general';
}

/**
 * Порядок проверки интенций (от более специфичных к более общим).
 */
const INTENT_CHECK_ORDER: UserIntent[] = [
  'decide-action',
  'compare-options',
  'explore-scenario',
  'review-past',
  'plan-future',
  'critique-system',
  'understand',
  'general-inquiry',
];

/**
 * Определить интенцию пользователя по тексту.
 */
function detectIntent(text: string): UserIntent {
  const lower = text.toLowerCase();

  for (const intent of INTENT_CHECK_ORDER) {
    const keywords = INTENT_KEYWORDS[intent];
    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return intent;
      }
    }
  }

  return 'general-inquiry';
}

/**
 * Извлечь тикеры из текста.
 */
function extractTickers(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];

  for (const ticker of KNOWN_TICKERS) {
    if (lower.includes(ticker.toLowerCase())) {
      found.push(ticker.toUpperCase());
    }
  }

  return found;
}

/**
 * Определить сложность вопроса (1-5).
 */
function estimateComplexity(
  text: string,
  category: UserQuestionCategory,
): number {
  const wordCount = text.split(/\s+/).length;
  let complexity = 1;

  // Длина вопроса
  if (wordCount > 30) complexity++;
  if (wordCount > 50) complexity++;

  // Категория
  if (category === 'comparison' || category === 'scenario') complexity++;
  if (category === 'strategy' || category === 'plan') complexity++;
  if (category === 'system-quality') complexity++;

  // Несколько тикеров
  const tickers = extractTickers(text);
  if (tickers.length > 1) complexity++;

  return Math.min(complexity, 5);
}

/**
 * Определить, какие агенты нужны для ответа.
 */
function determineRequiredAgents(
  category: UserQuestionCategory,
  tickers: string[],
  complexity: number,
): AgentRole[] {
  const agents: AgentRole[] = [];

  // Несколько тикеров — нужны факты по каждому активу
  if (tickers.length > 1) {
    agents.push('research');
  }

  // AnalysisAgent нужен для любого вопроса о портфеле/активах
  if (
    category === 'asset' ||
    category === 'portfolio' ||
    category === 'comparison' ||
    category === 'past-decision'
  ) {
    agents.push('analysis');
  }

  // ResearchAgent нужен для вопросов о новостях/фундаментале
  if (category === 'news' || category === 'market' || category === 'asset') {
    agents.push('research');
  }

  // AI Agent нужен для инвестиционных решений
  if (
    category === 'asset' ||
    category === 'portfolio' ||
    category === 'comparison' ||
    category === 'strategy'
  ) {
    agents.push('ai');
  }

  // StrategistAgent нужен для стратегических вопросов
  if (
    category === 'strategy' ||
    category === 'portfolio' ||
    category === 'plan'
  ) {
    agents.push('strategist');
  }

  // ScenarioAgent нужен для сценарных вопросов
  if (category === 'scenario' || category === 'comparison') {
    agents.push('scenario');
  }

  // ReviewAgent нужен для сложных/критичных вопросов
  if (complexity >= 4) {
    agents.push('review');
  }

  // Для вопросов о качестве системы
  if (category === 'system-quality') {
    agents.push('review');
    agents.push('analysis');
  }

  // Уникальность
  return [...new Set(agents)];
}

/**
 * Определить, нужен ли Consilium.
 */
function needsConsilium(
  category: UserQuestionCategory,
  complexity: number,
  tickers: string[],
): boolean {
  // Consilium нужен для сложных инвестиционных вопросов
  if (complexity >= 4) return true;
  if (category === 'comparison' && tickers.length > 1) return true;
  if (category === 'scenario' && tickers.length > 0) return true;
  if (category === 'strategy') return true;
  if (category === 'portfolio' && complexity >= 3) return true;

  return false;
}

/**
 * Сформировать topic (тему) вопроса.
 */
function formulateTopic(text: string, category: UserQuestionCategory): string {
  const tickers = extractTickers(text);

  if (tickers.length > 0) {
    return `Вопрос по ${tickers.join(', ')}`;
  }

  switch (category) {
    case 'portfolio':
      return 'Вопрос о портфеле';
    case 'market':
      return 'Вопрос о рынке';
    case 'news':
      return 'Вопрос о новостях';
    case 'strategy':
      return 'Вопрос о стратегии';
    case 'plan':
      return 'Вопрос о плане';
    case 'scenario':
      return 'Сценарный вопрос';
    case 'comparison':
      return 'Сравнение вариантов';
    case 'past-decision':
      return 'Пересмотр прошлого решения';
    case 'system-quality':
      return 'Вопрос о качестве системы';
    default:
      return 'Общий вопрос';
  }
}

// ──────────────────────────────────────────────
// 4. Основной парсер
// ──────────────────────────────────────────────

/**
 * Парсить естественный язык пользователя в InterpretedQuestion.
 */
export function parseUserMessage(text: string): InterpretedQuestion {
  if (!text || text.trim().length === 0) {
    return {
      category: 'general',
      tickers: [],
      topic: 'Пустой вопрос',
      text: '',
      requiredAgents: [],
      needsConsilium: false,
      complexity: 1,
      intent: 'general-inquiry',
    };
  }

  const category = detectCategory(text);
  const intent = detectIntent(text);
  const tickers = extractTickers(text);
  const complexity = estimateComplexity(text, category);
  const requiredAgents = determineRequiredAgents(category, tickers, complexity);
  const needsConsiliumFlag = needsConsilium(category, complexity, tickers);
  const topic = formulateTopic(text, category);

  return {
    category,
    tickers,
    topic,
    text: text.trim(),
    requiredAgents,
    needsConsilium: needsConsiliumFlag,
    complexity,
    intent,
  };
}

/**
 * Быстро определить, содержит ли текст тикер.
 */
export function hasTicker(text: string): boolean {
  return extractTickers(text).length > 0;
}

/**
 * Быстро определить категорию вопроса.
 */
export function quickCategory(text: string): UserQuestionCategory {
  return detectCategory(text);
}
