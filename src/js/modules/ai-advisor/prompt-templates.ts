/**
 * Шаблон системного промпта для ИИ-советника.
 * Сжатая версия: 5 секций вместо 22, ~8K символов вместо ~25K.
 * Все критические правила сохранены, дублирование устранено.
 */

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
  currentPrice: number | null;
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
    originalDv01?: { value: number; unit: string; scope: string };
    scenarios: Array<{ yieldChangePct: number; priceImpactPct: number; priceImpactRub: number }>;
    dataQuality: string;
    derivedDataQuality: string;
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
  /** Недостающие данные для анализа */
  missingData: string[];
  /** Согласованность с PortfolioMath: AGREE / DISAGREE / INSUFFICIENT_DATA */
  mathAgreement: string;
  /** Влияние на структуру портфеля */
  portfolioImpact: string;
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

  /** Технические индикаторы для актива */
  export interface TechnicalIndicators {
    /** Тикер актива */
    ticker: string;
    /** Индекс относительной силы (14 периодов) */
    rsi: number | null;
    /** Простое скользящее среднее 20 периодов */
    sma20: number | null;
    /** Простое скользящее среднее 50 периодов */
    sma50: number | null;
    /** Тренд: восходящий / нисходящий / боковик */
    trend: 'up' | 'down' | 'flat' | null;
    /** Годовая волатильность (доля, например 0.35 = 35%) */
    volatilityAnnual: number | null;
    /** Уровень риска: низкий / средний / высокий */
    riskLevel: 'low' | 'medium' | 'high' | null;
    /** Z-score последнего бара (статистическая аномалия) */
    zScoreLast: number | null;
    /** true если на последнем баре обнаружена аномалия */
    isLastAnomaly: boolean;
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

/** Результат анализа ликвидности одного актива */
export interface AssetLiquidityContext {
  /** Тикер актива */
  ticker: string;
  /** Название актива */
  name: string;
  /** Рыночная стоимость позиции (руб) */
  marketValue: number;
  /** Дневной оборот (руб) или null */
  dailyTurnover: number | null;
  /** Уровень ликвидности: HIGH/MEDIUM/LOW/CRITICAL/UNKNOWN */
  liquidityLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'CRITICAL' | 'UNKNOWN';
  /** Отношение оборота к стоимости позиции */
  turnoverToValueRatio: number;
  /** Оценка дней для ликвидации позиции */
  liquidationDays: number | null;
  /** Предупреждение (если есть) */
  warning?: string;
  /** Рекомендация */
  advice?: string;
}

/** Сводка по ликвидности всего портфеля */
export interface PortfolioLiquiditySummary {
  /** Общая рыночная стоимость портфеля */
  totalMarketValue: number;
  /** Доля высоколиквидных активов (%) */
  highLiquidityPct: number;
  /** Доля среднеликвидных активов (%) */
  mediumLiquidityPct: number;
  /** Доля низколиквидных активов (%) */
  lowLiquidityPct: number;
  /** Доля критически низколиквидных активов (%) */
  criticalLiquidityPct: number;
  /** Количество активов без данных по обороту */
  unknownCount: number;
  /** Количество «мёртвых» активов */
  deadAssetsCount: number;
  /** Статус: HEALTHY/WARNING/CRITICAL */
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
}

/** Полный контекст ликвидности портфеля */
export interface LiquidityContext {
  /** Сводка по портфелю */
  summary: PortfolioLiquiditySummary;
  /** Результаты по каждому активу */
  assets: AssetLiquidityContext[];
  /** Предупреждения */
  warnings: string[];
  /** Рекомендации */
  recommendations: string[];
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
      technicalIndicators?: TechnicalIndicators[],
      liquidityContext?: LiquidityContext,
    ): string {
  const currentMonth = new Date().toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  });

  /** Форматирование суммы в рублях */
  function formatRub(value: number): string {
    if (value >= 1e9) return (value / 1e9).toFixed(1) + ' млрд ₽';
    if (value >= 1e6) return (value / 1e6).toFixed(1) + ' млн ₽';
    if (value >= 1e3) return (value / 1e3).toFixed(1) + ' тыс ₽';
    return value.toLocaleString('ru-RU') + ' ₽';
  }

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
    buildDeepAnalysisRules() +
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
  - Качество данных: ${bond.yieldAnalysis.dataQuality}
• Процентный риск:
  - Дюрация: ${bond.durationAnalysis.duration?.toFixed(2) || 'N/A'} лет (${bond.durationAnalysis.durationType})
  - DV01: ${bond.durationAnalysis.dv01?.toFixed(2) || 'N/A'} руб.
  - Данные: ${bond.durationAnalysis.dataQuality}, Производные: ${bond.durationAnalysis.derivedDataQuality}
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
• Влияние на портфель: ${bond.portfolioImpact}
• Согласованность с PortfolioMath: ${bond.mathAgreement}
${bond.missingData && bond.missingData.length > 0 ? `• Недостающие данные:\n${bond.missingData.map((m: string) => '  - ' + m).join('\n')}` : ''}
${bond.creditAssessment.quality === 'INSUFFICIENT_DATA' ? '\n⚠️ ВАЖНО: Кредитное качество НЕ ПОДТВЕРЖДЕНО.\nНЕ писать высокий рейтинг если quality = INSUFFICIENT_DATA.\nЕсли нет данных — писать нет данных по кредитному качеству.\n' : ''}
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
    (technicalIndicators && technicalIndicators.length > 0 ? `
=== ТЕХНИЧЕСКИЕ ИНДИКАТОРЫ И ИСТОРИЧЕСКИЕ ДАННЫЕ ===
Для каждого актива рассчитаны индикаторы на основе 180 дней исторических котировок:

${technicalIndicators.map(ind => `
--- ${ind.ticker} ---
• RSI(14): ${ind.rsi !== null ? ind.rsi.toFixed(1) : 'нет данных'}${ind.rsi !== null ? (ind.rsi < 30 ? ' (перепроданность)' : ind.rsi > 70 ? ' (перекупленность)' : '') : ''}
• SMA20: ${ind.sma20 !== null ? ind.sma20.toFixed(2) : 'нет данных'}
• SMA50: ${ind.sma50 !== null ? ind.sma50.toFixed(2) : 'нет данных'}
• Тренд: ${ind.trend !== null ? (ind.trend === 'up' ? 'восходящий' : ind.trend === 'down' ? 'нисходящий' : 'боковик') : 'нет данных'}
• Волатильность (годовая): ${ind.volatilityAnnual !== null ? (ind.volatilityAnnual * 100).toFixed(1) + '%' : 'нет данных'}
• Риск: ${ind.riskLevel !== null ? (ind.riskLevel === 'low' ? 'низкий' : ind.riskLevel === 'medium' ? 'средний' : 'высокий') : 'нет данных'}
• Z-score: ${ind.zScoreLast !== null ? ind.zScoreLast.toFixed(2) : 'нет данных'}${ind.zScoreLast !== null && Math.abs(ind.zScoreLast) > 2 ? ' (аномалия)' : ''}
${ind.isLastAnomaly ? '⚠️ Аномалия на последнем баре!' : ''}
`).join('\n')}

ИСПОЛЬЗУЙ эти данные для рекомендации оптимальных точек входа/выхода:
• RSI < 30 + цена ниже SMA20/SMA50 → потенциальная точка покупки (перепроданность)
• RSI > 70 + цена выше SMA20/SMA50 → потенциальная точка продажи (перекупленность)
• Восходящий тренд + низкая волатильность → благоприятная среда для покупки
• Нисходящий тренд + высокая волатильность → осторожность с покупками
• Z-score > 2 или < -2 → аномальное движение, требует внимания
• НЕ используй технические индикаторы как единственный аргумент — комбинируй с фундаменталом
` : '') +
    (liquidityContext ? `
=== АНАЛИЗ ЛИКВИДНОСТИ ПОРТФЕЛЯ ===
Статус портфеля: ${liquidityContext.summary.status === 'HEALTHY' ? '✅ Здоровый' : liquidityContext.summary.status === 'WARNING' ? '⚠️ ВНИМАНИЕ' : '🔴 КРИТИЧЕСКИЙ'}
├── Высокая ликвидность: ${liquidityContext.summary.highLiquidityPct.toFixed(1)}%
├── Средняя ликвидность: ${liquidityContext.summary.mediumLiquidityPct.toFixed(1)}%
├── Низкая ликвидность: ${liquidityContext.summary.lowLiquidityPct.toFixed(1)}%
└── Критическая ликвидность: ${liquidityContext.summary.criticalLiquidityPct.toFixed(1)}% (${liquidityContext.summary.deadAssetsCount} активов)

Предупреждения:
${liquidityContext.warnings.length > 0 ? liquidityContext.warnings.map((w: string) => '  • ' + w).join('\n') : '  (нет)'}

Рекомендации по ликвидности:
${liquidityContext.recommendations.length > 0 ? liquidityContext.recommendations.map((r: string) => '  • ' + r).join('\n') : '  (нет)'}

Данные по активам:
${liquidityContext.assets.map(asset => `
--- ${asset.ticker} (${asset.name}) ---
• Стоимость позиции: ${formatRub(asset.marketValue)}
• Дневной оборот: ${asset.dailyTurnover !== null ? formatRub(asset.dailyTurnover) : 'нет данных'}
• Уровень: ${asset.liquidityLevel === 'HIGH' ? '✅ Высокий' : asset.liquidityLevel === 'MEDIUM' ? '⚠️ Средний' : asset.liquidityLevel === 'LOW' ? '⚠️ Низкий' : asset.liquidityLevel === 'CRITICAL' ? '🔴 Критический' : '❓ Нет данных'}
• Отношение оборот/позиция: ${asset.turnoverToValueRatio.toFixed(3)}
• Дней для ликвидации: ${asset.liquidationDays !== null ? asset.liquidationDays : 'н/д'}
${asset.warning ? '• ⚠️ ' + asset.warning : ''}
${asset.advice ? '• 💡 ' + asset.advice : ''}
`).join('\n')}

ВАЖНО ПРИ ФОРМИРОВАНИИ РЕКОМЕНДАЦИЙ:
• НЕ РЕКОМЕНДУЙ BUY для активов с CRITICAL ликвидностью без предупреждения о рисках выхода.
• При рекомендации BUY низколиквидного актива (LOW/CRITICAL): ОБЯЗАТЕЛЬНО укажи "наращивать частями".
• При рекомендации SELL низколиквидного актива: ОБЯЗАТЕЛЬНО укажи "продавать частями из-за низкого оборота".
• Активы с CRITICAL ликвидностью не должны составлять более 5% портфеля.
• Если портфель имеет статус WARNING/CRITICAL по ликвидности — приоритетом является снижение концентрации низколиквидных активов.
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
    '    "targetReason": "Причина изменения целевой доли",\n' +
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
    '⚠️ Если нет данных для актива — верни {"ticker":"ТИКЕР","recommendedAction":"HOLD","confidence":null,"rationale":"нет данных","targetReason":"нет данных","keyRisks":[],"keyCatalysts":[],"agreementWithPortfolioMath":"UNCERTAIN"}.\n' +
    '⚠️ НЕ включай в JSON: price, quantity, deficit, liquidationValue.\n' +
    '⚠️ Проценты: 47.7%, не 47.739999%.\n' +
    '⚠️ ОБЯЗАТЕЛЬНО заполни targetReason для КАЖДОГО актива. Если нет причины — напиши "целевая доля не меняется".\n' +
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
 * Правила глубокого анализа для каждого актива.
 * Заменяют жёсткие noBuy/noSell правила.
 * AI должен принимать решения на основе комплексного анализа,
 * а не хардкодных ограничений.
 */
function buildDeepAnalysisRules(): string {
  return (
    '• ГЛУБОКИЙ АНАЛИЗ перед рекомендацией BUY/SELL:\n' +
    '  Для каждого актива ОБЯЗАТЕЛЬНО оцени:\n' +
    '  1. Фундаментал: финансовые показатели, динамика выручки/прибыли, долг/капитал\n' +
    '  2. Технический анализ: RSI, SMA20/50, тренд, волатильность, Z-score\n' +
    '  3. Новостной фон: последние новости по компании и отрасли\n' +
    '  4. Кредитный риск (для облигаций): рейтинг эмитента, качество активов\n' +
    '  5. Макроэкономика: влияние ключевой ставки, курса валют, цен на сырьё\n' +
    '  6. Историческая доходность: как актив вёл себя при схожих макроусловиях\n' +
    '  7. Концентрация: не превышает ли позиция допустимый риск\n' +
    '  8. Целевая доля: текущая vs целевая из Excel\n' +
    '  РЕКОМЕНДАЦИЯ должна включать хотя бы 3 из 8 факторов с конкретными цифрами.\n' +
    '  Если данных для какого-то фактора нет — явно указывай "нет данных".\n' +
    '  НЕ принимай решения на основе одного фактора (только дефицит доли или только RSI).\n' +
    '• РЕШЕНИЕ О ПРОДАЖЕ/ПОКУПКЕ принимается на основе совокупности факторов:\n' +
    '  - BUY: дефицит доли + позитивный фундаментал + технически не перекуплен + новостной фон позитивный\n' +
    '  - SELL: профицит доли + негативный фундаментал + технически перекуплен или тренд сломлен + новостной фон негативный\n' +
    '  - HOLD: нет убедительных аргументов за BUY или SELL, данные неоднозначны\n' +
    '  - REDUCE: частичное снижение при умеренном профиците доли\n' +
    '• НЕ ЗАПРЕЩАЙ покупки/продажи по тикеру без анализа.\n' +
    '  Каждый актив должен быть оценён индивидуально.\n' +
    '  Даже актив с высокой концентрацией может быть куплен, если фундаментал сильный.\n' +
    '  Даже актив с дефицитом доли может быть продан, если фундаментал слабый.\n' +
    '\n' +
    '• ВАЖНО: ОБЛИГАЦИИ — разделение portfolioSignal и bondAssessment:\n' +
    '  PortfolioMath возвращает статус для облигаций:\n' +
    '  - STABLE = "позиция в пределах целевой доли, нет необходимости менять вес"\n' +
    '  - BUY = "есть дефицит доли, портфельная математика рекомендует покупку"\n' +
    '  - REDUCE = "профицит доли, портфельная математика рекомендует снижение"\n' +
    '  - EXIT = "целевая доля 0%, плановый выход"\n' +
    '  - NO_TARGET = "целевая доля не установлена"\n' +
    '  ЭТО НЕ оценка надёжности или привлекательности!\n' +
    '  STABLE НЕ означает "надёжный эмитент" и НЕ означает "нет критических проблем".\n' +
    '  STABLE означает только: "текущий вес облигации соответствует целевому диапазону".\n' +
    '  Облигация со статусом STABLE может иметь:\n' +
    '  - Кредитное качество LOW (высокий риск дефолта)\n' +
    '  - Отсутствующую доходность (нет данных)\n' +
    '  - Низкую ликвидность (невозможно продать без дисконта)\n' +
    '  - Негативный новостной фон по эмитенту\n' +
    '  Для оценки привлекательности облигации ИСПОЛЬЗУЙ bondAnalyses:\n' +
    '  - yieldAnalysis.dataQuality = "MISSING" → доходность не подтверждена\n' +
    '  - creditAssessment.quality = "INSUFFICIENT_DATA" → кредитное качество не подтверждено\n' +
    '  - bondFinalAssessment.recommendation = "INSUFFICIENT_DATA" → недостаточно данных\n' +
    '  При INSUFFICIENT_DATA: рекомендуй HOLD с явным указанием "нет данных по доходности/кредиту"\n' +
    '  НЕ интерпретируй HOLD/STABLE как подтверждение качества облигации.\n'
  );
}
