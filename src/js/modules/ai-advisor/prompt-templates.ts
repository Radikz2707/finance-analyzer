/**
 * Шаблон системного промпта для ИИ-советника.
 * Сжатая версия: 5 секций вместо 22, ~8K символов вместо ~25K.
 * Все критические правила сохранены, дублирование устранено.
 */

import { loadUserPolicy } from '../../config/user-policy.js';

/** Контекст макроэкономических данных */
export interface MacroDataContext {
  keyRate: number;
  source: string;
  asOf: string;
  isFresh: boolean;
  inflation?: number;
  currency?: number;
  oil?: number;
}

/** Контекст облигационных данных для конкретного актива */
export interface BondDataContext {
  /** ISIN облигации */
  isin: string;
  /** Номинал (RUB) */
  nominal: number;
  /**
   * Доходность из QUIK.
   * НЕ называть YTM без подтверждения семантики.
   * Единица: %.
   */
  yield: number;
  /**
   * Дюрация из QUIK.
   * НЕ называть модифицированной без подтверждения методики.
   */
  duration: number;
  /** Оборот (ликвидность) */
  turnover: number;
  /** Размер купона (RUB) */
  couponAmount: number;
  /** Длительность купонного периода (дни) */
  couponPeriodDays: number;
  /** Ближайшая дата выплаты купона */
  nextCouponDate: string;
  /** Дата погашения */
  maturityDate: string;
  /** НКД рыночный (RUB) */
  marketNkd: number;
  /** Эмитент облигации */
  issuer: string;
  /** Тип купона из MOEX (FIXED / FLOATER / MICROFIX) */
  couponType?: 'FIXED' | 'FLOATER' | 'MICROFIX' | 'ZERO_COUPON';
  /** Внутренний рейтинг МОEX (ICBRR) */
  creditRating?: string;
  /** Сектор экономики (banks, energy, metals и т.д.) */
  sector?: string;
  /** Есть опцион досрочного погашения (callable) */
  hasOption?: boolean;
  /** Спред к ключевой ставке в % (для флоатеров) */
  floatSpreadPct?: number;
  /** Базовый индекс для флоатера (RU SR, Key Rate) */
  floatIndex?: string;
}

/** Результат структурированного анализа облигации */
export interface BondAnalysisResult {
  isin: string;
  name: string;
  issuer: string;
  quantity: number;
  currentPrice: number;
  balanceValue: number;
  yieldAnalysis: {
    currentYield: number | null;
    ytm: number | null;
    effectiveYield: number | null;
    annualCouponIncome: number | null;
    couponType: string;
    dataQuality: string;
  };
  durationAnalysis: {
    duration: number | null;
    durationType: string;
    dv01: number | null;
    scenarios: Array<{ yieldChangePct: number; priceImpactPct: number; priceImpactRub: number }>;
    dataQuality: string;
  };
  creditAssessment: {
    quality: string;
    source: string;
    summary: string;
  };
  recommendation: string;
  rationale: string;
  moexData: {
    couponType?: string;
    icbrrRating?: string;
    sector?: string;
    floatSpreadPct?: number;
    floatIndex?: string;
    hasOption?: boolean;
  };
}

/** Контекст глубокого падения актива */
export interface DeepLossContext {
  /** Тикер актива */
  ticker: string;
  /** Название актива */
  name: string;
  /** Текущая просадка (%) */
  drawdownPercent: number;
  /** Уровень глубины падения */
  lossLevel: 'MODERATE' | 'SEVERE' | 'CRITICAL';
  /** Основная причина падения */
  primaryReason: string;
  /** Сравнение с рынком */
  vsMarket: {
    marketDrawdown: number;
    relativePerformance: number;
    isSystemic: boolean;
  };
  /** Оценка риска фиксации убытка */
  realizationRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Резюме */
  summary: string;
}

/** Фундаментальные метрики актива */
export interface FundamentalMetrics {
  /** Тикер актива */
  ticker: string;
  /** Название актива */
  name: string;
  /** P/E (Price to Earnings) */
  pe?: number | null;
  /** P/S (Price to Sales) */
  ps?: number | null;
  /** P/B (Price to Book) */
  pb?: number | null;
  /** Дивидендная доходность (%) */
  dividendYield?: number | null;
  /** ROE (Return on Equity) (%) */
  roe?: number | null;
  /** Долг/Капитал */
  debtToEquity?: number | null;
  /** Маржа прибыли (%) */
  profitMargin?: number | null;
  /** Рост выручки (%) */
  revenueGrowth?: number | null;
  /** Рост прибыли (%) */
  earningsGrowth?: number | null;
  /** Оценка фундаментала: POSITIVE/NEUTRAL/NEGATIVE */
  fundamentalHealth: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  /** Краткое описание фундаментала */
  summary: string;
}

/** Поведенческие факторы актива */
export interface BehavioralFactors {
  /** Тикер актива */
  ticker: string;
  /** Название актива */
  name: string;
  /** Психологический барьер убытка: HIGH/MEDIUM/LOW */
  lossAversion: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Склонность к усреднению: HIGH/MEDIUM/LOW */
  averagingTendency: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Склонность к панике: HIGH/MEDIUM/LOW */
  panicTendency: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Рекомендация по поведению */
  behavioralAdvice: string;
  /** Резюме */
  summary: string;
}

/**
  * Формирует системный промпт для ИИ-модели.
  * @param cbrRate — ключевая ставка ЦБ
  * @param newsContext — новостной фон (опционально)
  * @param assetTickers — список тикеров портфеля
  * @param macroData — макроэкономические данные
  * @param memoryContext — контекст из памяти ИИ (опционально)
  * @param guardrailsContext — защитные правила (опционально)
   * @param investorParams — параметры инвестора (опционально)
   * @param bondContext — облигационные данные для текущего актива (устарело, использовать bondAnalyses)
   * @param bondAnalyses — структурированный анализ ВСЕХ облигаций портфеля (приоритет)
   * @param deepLossContext — контекст глубокого падения актива (опционально)
   * @param fundamentalMetrics — фундаментальные метрики актива (опционально)
   * @param behavioralFactors — поведенческие факторы (опционально)
   */
  export function buildSystemPrompt(
    cbrRate: number,
    newsContext?: string,
    assetTickers?: string[],
    macroData?: MacroDataContext,
    memoryContext?: string,
    guardrailsContext?: string,
    investorParams?: {
      horizon: string;
      goal: string;
      riskProfile: string;
      maxDrawdown: number;
    },
    bondContext?: BondDataContext,
    bondAnalyses?: BondAnalysisResult[],
    deepLossContext?: DeepLossContext,
    fundamentalMetrics?: FundamentalMetrics,
    behavioralFactors?: BehavioralFactors,
  ): string {
  const currentMonth = new Date().toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  });

  // Макро-контекст
  const macroLines: string[] = [];
  if (macroData) {
    const hasData = macroData.keyRate > 0;
    if (hasData) {
      macroLines.push(
        'Ставка ЦБ: ' +
          macroData.keyRate +
          '% (источник: ' +
          (macroData.source || 'CBR') +
          ', ' +
          (macroData.isFresh ? 'актуально' : '⚠️ требует проверки') +
          ')',
      );
    } else {
      macroLines.push('Ставка ЦБ: — (данные не получены)');
    }
    if (macroData.inflation !== undefined)
      macroLines.push('Инфляция: ' + macroData.inflation + '%');
    if (macroData.currency !== undefined)
      macroLines.push('USD/RUB: ' + macroData.currency);
    if (macroData.oil !== undefined)
      macroLines.push('Нефть Brent: $' + macroData.oil);
  } else {
    macroLines.push('Ставка ЦБ: — (данные не получены)');
  }

  const prompt =
    '=== РОЛЬ ===\n' +
    'Ты — инвестиционный стратег. Твоя задача — выбрать наиболее обоснованное действие, ' +
    'которое повышает потенциальную доходность портфеля, способствует выходу портфеля в зелёную зону ' +
    'и одновременно поддерживает его надёжность. Для этого самостоятельно анализируй активы, ' +
    'фундаментал, оценку, новости, макроэкономику, рынок Московской биржи и сценарии развития событий. ' +
    'Дата: ' +
    currentMonth +
    '.\n\n' +
    '=== ГЛАВНЫЕ ПРАВИЛА ===\n' +
    '• Целевые доли (targetPercent) — факт пользователя. AI НЕ изменяет.\n' +
    '• PortfolioMath status — результат детерминированной математики. AI НЕ изменяет.\n' +
    '• AI может НЕ соглашаться с PortfolioMath и USER_TARGET.\n' +
    '• AI самостоятельно определяет: BUY, SELL, HOLD, REDUCE, EXIT, AVOID, AVERAGE.\n' +
    '• Глубокий убыток НЕ блокирует SELL/EXIT/REDUCE.\n' +
    '• Свободный кэш — ограничение покупок.\n' +
    '• Если указан «Средний ежемесячный взнос» — учитывай при рекомендациях: покупай активы с дефицитом доли.\n' +
    '• INVALID_MARKET_DATA (currentPrice=0): HOLD. НЕ давать BUY/SELL.\n' +
    '• НЕ выводить суммы сделок в тексте. Вместо этого: "закрыть позицию полностью".\n' +
    '• НЕ рассчитывать собственную доходность (C10/C11/C12). Используй ТОЛЬКО P&L из раздела "ДАННЫЕ ПОРТФЕЛЯ".\n' +
    '• Бенчмарк (+X% за год) — сравнение с рынком, а НЕ твой реальный P&L.\n' +
    '• В рекомендациях ОБЯЗАТЕЛЬНО использовать SHORT NAME: "Сбербанк" вместо "RU000A109L49". В таблице: "SBER (Сбербанк)". В JSON: ticker — тикер, rationale — название.\n' +
    '  ✅ ПРАВИЛЬНО: "Полюс", "Сбербанк", "АЛРОСА1Р1"\n' +
    '  ❌ НЕПРАВИЛЬНО: "RU000A109L49", "A10EC22"\n' +
    '• Для облигаций используй name из Excel, а НЕ ISIN.\n' +
    '• В таблице ИИ должен писать название ПЕРВЫМ, тикер в скобках: "АЛРОСА1Р1 (RU000A109L49)".\n' +
    '• ЗАПРЕЩЕНО: "гарантированная доходность", "безрисковый", "100% гарантия".\n' +
    '• ЗАПРЕЩЕНО: выдумывать отсутствующие данные и факты.\n' +
    '• ЗАПРЕЩЕНО: выдумывать доходность облигаций. Если данные не переданы — пиши «нет данных».\n' +
    buildNoSellPolicyRules() +
    '\n' +
    '=== ИНВЕСТИЦИОННЫЙ REASONING ===\n' +
    '• USER_TARGET_PERCENT — факт пользователя. AI может дать AI_RECOMMENDED_TARGET_PERCENT как рекомендацию.\n' +
    '• AI ОБЯЗАН анализировать: структуру портфеля, P&L, просадки, фундаментал, дивиденды, новости, макро, риски.\n' +
    '• NO_DATA → «нет данных», НЕ писать "недооценен".\n' +
    '• ИСПРАВЛЕНИЕ P1: различай: техническую потребность в ребалансировке, оценку бизнеса, финансовые показатели, рыночные риски, макро-факторы, неизвестные данные.\n' +
    '• Если данных для фундаментального вывода нет — явно указывай "нет данных".\n' +
    '• НЕ утверждай, что акция "недооценена" или "является лидером рынка" исключительно потому, что её доля меньше целевой.\n' +
    '• Техническая потребность в ребалансировке ≠ фундаментальная привлекательность актива.\n\n' +
    '=== ШКАЛА УВЕРЕННОСТИ (confidence 0–1) ===\n' +
    '• 0.85–1.00 — ВЫСОКАЯ: ≥3 фактора (дефицит доли + недооценка + позитивный фундаментал + дивиденды). Или: PortfolioMath=BUY И rationale содержит цифры.\n' +
    '• 0.65–0.84 — СРЕДНЯЯ: 2 фактора (дефицит доли + позитивные новости).\n' +
    '• 0.50–0.64 — НИЗКАЯ: 1 фактор или данные неполные.\n' +
    '• 0.30–0.49 — ОЧЕНЬ НИЗКАЯ: рекомендация на догадке без данных.\n' +
    '• 0.00–0.29 — НЕУВЕРЕННОСТЬ: данные отсутствуют или противоречивы. Поставь null.\n' +
    'Правила:\n' +
    '• HOLD/STABLE → confidence 0.70–0.90. BUY → 0.55–0.85. SELL/EXIT → 0.60–0.90.\n' +
    '• NO_TARGET или данные не переданы → confidence ≤0.40 или null.\n' +
    '• НИКОГДА не ставь 0.50 «просто так». Короткий rationale без цифр → confidence ≤0.50.\n' +
    '• Rationale с цифрами (P/E, дивиденды, дефицит %, C10) → confidence ≥0.70.\n\n' +
    '=== СТРУКТУРА ПОРТФЕЛЯ ===\n' +
    'Портфель разделён на две части:\n' +
    '• ЯДРО (Core): стабильные, ликвидные активы (ОФЗ, Сбер, Газпром и др.). Цель — защита капитала.\n' +
    '• СПУТНИКИ (Satellite): рискованные активы (Полюс, малые акции). Цель — высокая доходность.\n' +
    'Правило: Спутники не должны превышать 30% портфеля для консервативного профиля.\n\n' +
    '=== СПИСОК АКТИВОВ ===' +
    (assetTickers && assetTickers.length > 0
      ? '\nТикеры: ' + assetTickers.join(', ') + '\n⚠️ ТОЛЬКО эти тикеры.'
      : '') +
    '\n\n=== МАКРО ===\n• ' +
    macroLines.join('\n• ') +
    '\n\n' +
    (memoryContext ? memoryContext + '\n' : '') +
    (newsContext ? '=== НОВОСТИ ===\n' + newsContext + '\n\n' : '') +
    (guardrailsContext || '') +
    (investorParams ? `
=== ПАРАМЕТРЫ ИНВЕСТОРА ===
• Горизонт: ${investorParams.horizon}
• Цель: ${investorParams.goal}
• Риск-профиль: ${investorParams.riskProfile}
• Максимальная просадка: ${investorParams.maxDrawdown}%

Учитывай эти параметры при формировании рекомендаций.
` : '') +
    (bondAnalyses && bondAnalyses.length > 0 ? `
=== СТРУКТУРИРОВАННЫЙ АНАЛИЗ ОБЛИГАЦИЙ ===
В портфеле ${bondAnalyses.length} облигаций. Для каждой проведён полный анализ:

${bondAnalyses.map(bond => `
--- ${bond.isin} (${bond.name}) ---
• Эмитент: ${bond.issuer}
• Доля в портфеле: ${(bond.balanceValue / 1000000).toFixed(2)} млн руб., кол-во: ${bond.quantity}
• Доходность:
  - Current Yield: ${bond.yieldAnalysis.currentYield?.toFixed(2) || 'N/A'}%
  - YTM: ${bond.yieldAnalysis.ytm?.toFixed(2) || 'N/A'}%
  - Effective Yield: ${bond.yieldAnalysis.effectiveYield?.toFixed(2) || 'N/A'}%
  - Годовой купон: ${bond.yieldAnalysis.annualCouponIncome?.toLocaleString('ru-RU') || 'N/A'} руб.
  - Тип купона: ${bond.yieldAnalysis.couponType}
• Процентный риск:
  - Дюрация: ${bond.durationAnalysis.duration?.toFixed(2) || 'N/A'} лет (${bond.durationAnalysis.durationType})
  - DV01: ${bond.durationAnalysis.dv01?.toFixed(2) || 'N/A'} руб.
  - Данные: ${bond.durationAnalysis.dataQuality}
• Кредитное качество:
  - Оценка: ${bond.creditAssessment.quality}
  - Источник: ${bond.creditAssessment.source}
  - Резюме: ${bond.creditAssessment.summary}
• MOEX данные:
  - Рейтинг ICBRR: ${bond.moexData.icbrrRating || 'N/A'}
  - Сектор: ${bond.moexData.sector || 'N/A'}
  - Спред к КС: ${bond.moexData.floatSpreadPct ? bond.moexData.floatSpreadPct + '%' : 'N/A'}
  - Callable: ${bond.moexData.hasOption ? 'да' : 'нет'}
• Рекомендация анализатора: ${bond.recommendation}
• Обоснование: ${bond.rationale}
`).join('\n')}
` : '') +
    (bondContext ? `
=== ОБЛИГАЦИЯ (legacy context) ===
• ISIN: ${bondContext.isin}
• Эмитент: ${bondContext.issuer}
• Номинал: ${bondContext.nominal} руб.
• Доходность (QUIK): ${bondContext.yield}% — НЕ называть YTM без подтверждения
• Дюрация (QUIK): ${bondContext.duration} — НЕ называть модифицированной без подтверждения
• Оборот: ${bondContext.turnover} руб. — оценка ликвидности
• Размер купона: ${bondContext.couponAmount} руб.
• Длительность купона: ${bondContext.couponPeriodDays} дней
• Следующая выплата: ${bondContext.nextCouponDate}
• Погашение: ${bondContext.maturityDate}
• НКД рыночный: ${bondContext.marketNkd} руб.
${bondContext.couponType ? `• Тип купона: ${bondContext.couponType} (из MOEX)` : ''}
${bondContext.creditRating ? `• Рейтинг МОEX (ICBRR): ${bondContext.creditRating}` : ''}
${bondContext.sector ? `• Сектор: ${bondContext.sector}` : ''}
${bondContext.hasOption ? '• Callable: да (опцион досрочного погашения)' : ''}
${bondContext.floatSpreadPct ? `• Спред к КС: ${bondContext.floatSpreadPct}%` : ''}
${bondContext.floatIndex ? `• Базовый индекс: ${bondContext.floatIndex}` : ''}
` : '') +
    (deepLossContext ? `
=== ГЛУБОКОЕ ПАДЕНИЕ ===
• ${deepLossContext.ticker}: ${deepLossContext.drawdownPercent.toFixed(1)}% просадка, уровень ${deepLossContext.lossLevel}, причина: ${deepLossContext.primaryReason}
` : '') +
    (fundamentalMetrics ? `
=== ФУНДАМЕНТАЛ ===
• ${fundamentalMetrics.ticker}: ${fundamentalMetrics.fundamentalHealth === 'POSITIVE' ? 'позитивный' : fundamentalMetrics.fundamentalHealth === 'NEGATIVE' ? 'негативный' : 'нейтральный'} — ${fundamentalMetrics.summary}
` : '') +
    (behavioralFactors ? `
=== ПОВЕДЕНИЕ ===
• ${behavioralFactors.ticker}: ${behavioralFactors.lossAversion} lossAversion, ${behavioralFactors.averagingTendency} averaging, ${behavioralFactors.panicTendency} panic — ${behavioralFactors.behavioralAdvice}
` : '') +
    '=== ЗАДАЧА ===\n' +
    '1. Макро: соответствие структуры портфеля ставке ' +
    cbrRate +
    '%.\n' +
    '2. Каждый актив: анализ по status (BUY/REDUCE/STABLE/EXIT/NO_TARGET).\n' +
    '3. Ребалансировка: приоритет BUY/REDUCE/EXIT, кэш. ' +
    'Если указан средний ежемесячный взнос — планируй покупки с его учётом: распредели дефицит долей на 1-3 месяца пополнений.\n' +
    '4. Выход в прибыль: шаги 1-3 мес / 3-12 мес / 1+ лет.\n' +
    '5. Мониторинг: котировки, макро.\n' +
    '6. Новые инструменты: НЕ добавлять.\n\n' +
    '=== ФОРМАТ ОТВЕТА ===\n' +
    '1. СНАЧАЛА выведи JSON-МАССИВ для ВСЕХ активов портфеля — он обязателен и идёт ПЕРВЫМ.\n' +
    '2. Затем развёрнутый текстовый ответ из 7 секций.\n\n' +
    '=== JSON-МАССИВ (ОБЯЗАТЕЛЬНО ПЕРВЫМ) ===\n' +
    '```json\n' +
    '[\n' +
    '  {\n' +
    '    "ticker": "ТИКЕР_ТОЛЬКО_СИМВОЛЫ",\n' +
    '    "recommendedTargetPercent": ЧИСЛО_ИЛИ_NULL,\n' +
    '    "recommendedAction": "BUY"|"SELL"|"HOLD"|"REDUCE"|"EXIT"|"AVOID"|"AVERAGE",\n' +
    '    "confidence": ЧИСЛО_0_1,\n' +
    '    "rationale": "Текст",\n' +
    '    "targetReason": "Текст",\n' +
    '    "keyRisks": ["риск 1"],\n' +
    '    "keyCatalysts": ["катализатор 1"],\n' +
    '    "agreementWithPortfolioMath": "AGREE"|"DISAGREE"|"UNCERTAIN"\n' +
    '  },\n' +
    '  ...\n' +
    ']\n' +
    '```\n' +
    '⚠️ ticker: ТОЛЬКО символы тикера (например: "PLZL", "SBER"). НЕ "PLZL (Полюс)", НЕ "PLZL — Полюс", НЕ "IRAO — ИнтерРАОао".\n' +
    '⚠️ Если тикер содержит пробелы, скобки, тире — JSON будет отброшен.\n' +
    '⚠️ ОБЯЗАТЕЛЬНО верни JSON-объект ДЛЯ КАЖДОГО актива из списка активов. Не пропускай ни один.\n' +
    '⚠️ Если нет данных для актива — верни {"ticker":"ТИКЕР","recommendedAction":"HOLD","confidence":null,"rationale":"нет данных","keyRisks":[],"keyCatalysts":[],"agreementWithPortfolioMath":"UNCERTAIN"}.\n' +
    '⚠️ НЕ включай в JSON: price, quantity, deficit, liquidationValue.\n' +
    '⚠️ Проценты: 47.7%, не 47.739999%.\n' +
    '=== ТЕКСТОВЫЙ ОТВЕТ (7 секций, ПОСЛЕ JSON) ===\n' +
    '1. Макро и структура\n' +
    '2. Рекомендации по каждому активу (таблица)\n' +
    '3. План ребалансировки\n' +
    '4. Стратегия выхода в прибыль\n' +
    '5. Динамический мониторинг\n' +
    '6. Новые инструменты\n' +
    '7. Краткое резюме (3-5 действий)\n\n' +
    '⚠️ Отвечай на русском, развёрнуто, с аргументацией и цифрами.';

  return prompt;
}

/**
 * Правила политики пользователя: тикеры, которые НЕ продаются.
 * Снижение их доли — только размыванием (увеличением долей других активов).
 * Пустая строка, если список пуст.
 */
function buildNoSellPolicyRules(): string {
  const tickers = loadUserPolicy().noSellTickers;
  if (tickers.length === 0) return '';
  return (
    '• ПОЛИТИКА ПОЛЬЗОВАТЕЛЯ: тикеры [' +
    tickers.join(', ') +
    '] пользователь ДЕРЖИТ и продавать не планирует.\n' +
    '  По умолчанию рекомендуй для них HOLD.\n' +
    '  SELL/EXIT/REDUCE допустимы ТОЛЬКО с убедительным обоснованием:\n' +
    '  конкретные фундаментальные факторы, катализаторы падения, альтернативная\n' +
    '  доходность. Общая доля/концентрация — НЕ аргумент для продажи: доля\n' +
    '  снижается покупками других активов. Нет убедительных аргументов → HOLD.\n'
  );
}
