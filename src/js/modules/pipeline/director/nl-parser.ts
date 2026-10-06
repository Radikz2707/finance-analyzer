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
  'VKCO',
  'AFKON',
  'BSPB',
  'FEES',
];

/**
 * Маппинг русских названий компаний и их тикеров.
 * Включает полные названия, сокращения, популярные варианты.
 */
const RUSSIAN_NAME_TO_TICKER: Record<string, string> = {
  // Сбербанк
  сбер: 'SBER',
  сбербанк: 'SBER',
  сбера: 'SBER',
  сбербанку: 'SBER',
  сбербанке: 'SBER',
  сберп: 'SBERP',
  'сбербанк п': 'SBERP',
  сберпф: 'SBERP',

  // Полюс
  полюс: 'PLZL',
  полюсзолото: 'PLZL',
  поллюсзолото: 'PLZL',
  полюса: 'PLZL',
  полюсу: 'PLZL',
  полюсе: 'PLZL',
  plzl: 'PLZL',

  // Лукойл
  лукойл: 'LKOH',
  лукойла: 'LKOH',
  лукойлу: 'LKOH',
  лукойле: 'LKOH',
  lkoh: 'LKOH',

  // Газпром
  газпром: 'GAZP',
  газпрома: 'GAZP',
  газпрому: 'GAZP',
  газпроме: 'GAZP',
  gazp: 'GAZP',

  // Роснефть
  роснефть: 'ROSN',
  роснефти: 'ROSN',
  rosn: 'ROSN',

  // ВТБ
  втб: 'VTBR',
  vtbr: 'VTBR',

  // Аэрофлот
  аэрофлот: 'AFLT',
  аэрофлота: 'AFLT',
  аэрофлоту: 'AFLT',
  аэрофлоте: 'AFLT',
  aflt: 'AFLT',

  // Алроса
  алроса: 'ALRS',
  алросы: 'ALRS',
  алросе: 'ALRS',
  alrs: 'ALRS',

  // Яндекс
  яндекс: 'YNDX',
  яндексa: 'YNDX',
  яндексу: 'YNDX',
  яндексе: 'YNDX',
  yndx: 'YNDX',

  // Магнит
  магнит: 'MGNT',
  магнитa: 'MGNT',
  магнитy: 'MGNT',
  магнитe: 'MGNT',
  mgnt: 'MGNT',

  // МТЛР
  мтлр: 'MTLR',
  мтлра: 'MTLR',
  мтлру: 'MTLR',
  мтлре: 'MTLR',
  mtlr: 'MTLR',

  // Татнефть
  татнефть: 'TATN',
  татнефти: 'TATN',
  tatn: 'TATN',

  // Сургутнефтегаз
  сургутнефтегаз: 'SNGS',
  сургутнефтегаза: 'SNGS',
  sngs: 'SNGS',

  // Роснефть др
  'роснефть др': 'ROSNDR',
  rosndr: 'ROSNDR',

  // МТС
  мтс: 'MTSS',
  мтса: 'MTSS',
  мтсу: 'MTSS',
  мтсе: 'MTSS',
  mtss: 'MTSS',

  // Флот
  флот: 'FLOT',
  флота: 'FLOT',
  flot: 'FLOT',

  // Алрос
  алрос: 'ALRS',

  // Северный никель
  'северный никель': 'SKNG',
  скнг: 'SKNG',

  // Монеточка
  монеточка: 'SBERP',

  // ВК
  вк: 'VKCO',
  вкo: 'VKCO',
  vkco: 'VKCO',

  // БСПБ
  бспб: 'BSPB',
  bspb: 'BSPB',

  // ГМК
  гмк: 'GMKN',
  'гмк норникель': 'GMKN',
  норникель: 'GMKN',
  норникеля: 'GMKN',
  норникелю: 'GMKN',
  норникеле: 'GMKN',
  норникелем: 'GMKN',
  норникелях: 'GMKN',
  gmkn: 'GMKN',

  // Норильская никель
  norilnickel: 'GMKN',

  // Новолipецкая сталь
  'новолipецкая сталь': 'NLMK',
  nlmk: 'NLMK',

  // Полимерный
  полимерный: 'PHOR',
  phor: 'PHOR',

  // Сегер
  сегер: 'SENER',
  sener: 'SENER',

  // Магнитогорский
  магнитогорский: 'MAGN',
  magn: 'MAGN',

  // Кондратьев
  кондратьев: 'AFKON',
  afkon: 'AFKON',

  // Фэес
  фэес: 'FEES',
  fees: 'FEES',

  // Норникель (альтернативные)
  noril: 'GMKN',
  nickel: 'GMKN',
};

/**
 * Fuzzy matching для поиска тикеров по частичному совпадению.
 * Используется для обработки опечаток и разговорных форм.
 */
function fuzzyMatchTicker(text: string): string | null {
  const lower = text.toLowerCase().trim();

  // Точное совпадение
  if (RUSSIAN_NAME_TO_TICKER[lower]) {
    return RUSSIAN_NAME_TO_TICKER[lower];
  }

  // Проверка по частям слова (для "полюс золот" → PLZL)
  for (const [name, ticker] of Object.entries(RUSSIAN_NAME_TO_TICKER)) {
    if (name.includes(lower) || lower.includes(name)) {
      return ticker;
    }
  }

  // Проверка первых символов (для "сбер" → SBER)
  const prefixMatches: Array<{
    name: string;
    ticker: string;
    matchLen: number;
  }> = [];
  for (const [name, ticker] of Object.entries(RUSSIAN_NAME_TO_TICKER)) {
    if (name.startsWith(lower) && lower.length >= 3) {
      prefixMatches.push({ name, ticker, matchLen: lower.length });
    }
  }

  if (prefixMatches.length > 0) {
    // Возвращаем самое длинное совпадение
    prefixMatches.sort((a, b) => b.matchLen - a.matchLen);
    return prefixMatches[0]?.ticker ?? '';
  }

  return null;
}

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
// 2.5. Операции: файлы и терминал
// ──────────────────────────────────────────────

/**
 * Паттерны, указывающие на файловую операцию (роль `file`).
 *
 * Покрывают:
 * - глагольные конструкции: «создай файл», «прочитай файл», «удали файл»,
 *   «переименуй», «найди файл», «что в файле», «покажи содержимое»,
 *   «запиши в файл», «сохрани в файл», «сделай отчёт» и т.д.;
 * - пути проекта вида `src/...`, `data/...`, относительные пути `./...`,
 *   файлы по расширению (`package.json`, `*.ts`, `*.yaml`).
 */
const FILE_REQUEST_PATTERNS: RegExp[] = [
  // ── Глагольные конструкции ──
  /создай файл/i,
  /создать файл/i,
  /создай модуль/i,
  /создать модуль/i,
  /прочитай файл/i,
  /прочитать файл/i,
  /открой файл/i,
  /открыть файл/i,
  /удали файл/i,
  /удалить файл/i,
  /переименуй/i,
  /переименовать/i,
  /найди файл/i,
  /найти файл/i,
  /что в файле/i,
  /что в файлах/i,
  /покажи содержимое/i,
  /показать содержимое/i,
  /запиши в файл/i,
  /записать в файл/i,
  /сохрани в файл/i,
  /сохранить в файл/i,
  /сделай отчёт/i,
  /сделай отчет/i,
  /создай отчёт/i,
  /создай отчет/i,
  /сформируй отчёт/i,
  /сформируй отчет/i,
  // ── Пути проекта (корни src/, data/, ...) ──
  /(?:^|\s)(?:src|data|docs|config|public|test|tests|scripts|gulp|quik|dist|archives)[\\/][a-zA-Z0-9_./\\-]+/i,
  // ── Относительные пути (./file.ts, ../file.json) ──
  /(?:^|\s)\.{1,2}[\\/][a-zA-Z0-9_./\\-]+/i,
  // ── Файлы по расширению (package.json, src/test.ts, *.yaml) ──
  /(?:^|\s)[a-zA-Z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|yaml|yml|md|markdown|txt|html|htm|css|scss|py|xml|csv|sql|env|sh|log)\b/i,
  /\*\.(?:ts|tsx|js|jsx|json|yaml|yml|md|txt|html|css|scss|py)\b/i,
];

/**
 * Паттерны, указывающие на терминальную операцию (роль `terminal`).
 *
 * Покрывают: «выполни команду», «запусти тесты/скрипт», «установи пакет»,
 * npm/pnpm/yarn/npx/pip, git-операции (commit/push/pull/add/status/clone),
 * «сделай коммит», «собери проект», python.
 */
const TERMINAL_REQUEST_PATTERNS: RegExp[] = [
  /выполни команду/i,
  /выполнить команду/i,
  /запусти/i,
  /установи пакет/i,
  /установить пакет/i,
  /npm install/i,
  /npm run/i,
  /npm ci/i,
  /npx /i,
  /pnpm/i,
  /yarn /i,
  /pip install/i,
  /git commit/i,
  /git push/i,
  /git pull/i,
  /git add/i,
  /git status/i,
  /git clone/i,
  /сделай коммит/i,
  /сделать коммит/i,
  /закоммит/i,
  /собери проект/i,
  /собрать проект/i,
  /запусти скрипт/i,
  /python/i,
  /терминал/i,
];

/**
 * Определить, запрашивает ли пользователь файловую операцию.
 */
export function looksLikeFileRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return FILE_REQUEST_PATTERNS.some((pattern) => pattern.test(lower));
}

/**
 * Определить, запрашивает ли пользователь терминальную операцию.
 */
export function looksLikeTerminalRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return TERMINAL_REQUEST_PATTERNS.some((pattern) => pattern.test(lower));
}

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
 * Ищет как прямые упоминания тикеров (SBER, PLZL),
 * так и русские названия компаний (сбер, полюс, гапзпром и т.д.).
 */
function extractTickers(text: string): string[] {
  const lower = text.toLowerCase();
  const found: Set<string> = new Set();

  // 1. Ищем прямые упоминания тикеров (SBER, PLZL, GMKN)
  for (const ticker of KNOWN_TICKERS) {
    if (lower.includes(ticker.toLowerCase())) {
      found.add(ticker.toUpperCase());
    }
  }

  // 2. Ищем русские названия компаний
  for (const [name, ticker] of Object.entries(RUSSIAN_NAME_TO_TICKER)) {
    if (lower.includes(name.toLowerCase())) {
      found.add(ticker);
    }
  }

  // 3. Fuzzy matching для коротких упоминаний
  const words = lower.split(/\s+/);
  for (const word of words) {
    if (word.length >= 3 && word.length <= 15) {
      const matched = fuzzyMatchTicker(word);
      if (matched) {
        found.add(matched);
      }
    }
  }

  // 4. Ищем составные слова (например, "полюс золото")
  const phrases = lower.match(/[а-яёa-z]{4,}/g) || [];
  for (let i = 0; i < phrases.length - 1; i++) {
    const phrase = phrases[i] + ' ' + phrases[i + 1];
    const matched = fuzzyMatchTicker(phrase);
    if (matched) {
      found.add(matched);
    }
  }

  return [...found];
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
  text: string,
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

  // ── Файловые операции (FileAgent) ──
  // Отдельный проход: файловая операция должна попасть в requiredAgents
  // даже если категория не тянет analysis/ai (чистая операция = ['file']).
  if (looksLikeFileRequest(text)) {
    agents.push('file');
  }

  // ── Терминальные операции (TerminalAgent) ──
  if (looksLikeTerminalRequest(text)) {
    agents.push('terminal');
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
  const requiredAgents = determineRequiredAgents(
    category,
    tickers,
    complexity,
    text,
  );
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
