/**
 * Шаблон системного промпта для ИИ-советника.
 * Сжатая версия: 5 секций вместо 22, ~8K символов вместо ~25K.
 * Все критические правила сохранены, дублирование устранено.
 */

import type {
  PortfolioFundamentalsContext as CanonicalPortfolioFundamentalsContext,
  SourcedValue,
  StockFundamentals,
} from '../../api/fundamentals/types.js';

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
    /** Причина UNKNOWN-классификации купона (конфликт/пробел источника). */
    couponTypeReason?:
      'excel_conflict' | 'ofz_no_coupon' | 'type_unconfirmed' | null;
    /** «Excel FIXED, ISS FLOATER (ОФЗ-ПК)» — конкретная причина. */
    couponTypeReasonDetail?: string | null;
    /** Источник подтверждения типа: ISS / SERIES / EXCEL. */
    couponTypeSource?: string | null;
    /** Методика YTM (обязательна к подписи в карточке). */
    ytmMethod?: string | null;
    dataQuality: string;
    /** Ближайшая купонная выплата (для карточки флоатера). */
    nextCouponDate?: string | null;
    /** Источник даты: EXCEL (дата файла) / MOEX_ISS / SMART_LAB. */
    nextCouponDateSource?: 'EXCEL' | 'MOEX_ISS' | 'SMART_LAB' | null;
  };
  durationAnalysis: {
    duration: number | null;
    durationType: string;
    dv01: number | null;
    originalDv01?: { value: number; unit: string; scope: string };
    scenarios: Array<{
      yieldChangePct: number;
      priceImpactPct: number;
      priceImpactRub: number;
    }>;
    dataQuality: string;
    derivedDataQuality: string;
  };
  creditAssessment: {
    quality: string;
    source: string;
    /** Дата отчётности/рейтинга — обязательна для пометки «(источник, дата)». */
    asOfDate?: string | null;
    /** Кредитный рейтинг с прогнозом (DEFAULT = дефолт). */
    rating?: { agency: string; rating: string; outlook: string } | null;
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
  /** Legacy: SMA(20), заполняется только если период есть в конфиге */
  sma20: number | null;
  /** Legacy: SMA(50), заполняется только если период есть в конфиге */
  sma50: number | null;
  /** Периоды SMA из PortfolioConfig.moexQuotes.smaPeriods */
  smaPeriods?: number[];
  /** Значения SMA по периодам (ключ — период) */
  smaValues?: Record<string, number | null>;
  /** 52-недельный максимум по истории MOEX ISS */
  high52w?: number | null;
  /** 52-недельный минимум по истории MOEX ISS */
  low52w?: number | null;
  /** Дата последнего бара истории (ISO) */
  technicalAsOf?: string | null;
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

/**
 * Фундаментальные данные для ВСЕХ активов портфеля.
 * Канонический тип — в api/fundamentals/types.ts: каждое значение
 * содержит источник, дату и статус (VALUE / UNAVAILABLE / PARSE_ERROR / CONFLICT).
 */
export type PortfolioFundamentalsContext =
  CanonicalPortfolioFundamentalsContext;

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

/** Форматирование суммы в рублях (компактный вид). */
function fmtRub(value: number): string {
  if (value >= 1e9)
    return (value / 1e9).toFixed(1).replace('.', ',') + ' млрд ₽';
  if (value >= 1e6)
    return (value / 1e6).toFixed(1).replace('.', ',') + ' млн ₽';
  if (value >= 1e3)
    return (value / 1e3).toFixed(1).replace('.', ',') + ' тыс ₽';
  return value.toLocaleString('ru-RU') + ' ₽';
}

/** Форматирование числа в русской нотации: 5,13. */
function fmtNumber(value: number, digits = 2): string {
  return value.toFixed(digits).replace('.', ',');
}

/** Дата источника: 17.11.2026. */
function fmtAsOf(iso: string | null): string {
  if (!iso) return 'дата не указана';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('ru-RU');
}

/** Значение метрики: «5,13» или «недоступно (причина)». */
function metricText(metric: SourcedValue, digits = 2, suffix = ''): string {
  if (metric.value === null) {
    return `недоступно (${metric.note ?? 'источник не отвечает'})`;
  }
  return `${fmtNumber(metric.value, digits)}${suffix}`;
}

/**
 * Тег «(источник, дата)» ТОЛЬКО для собственного значения метрики.
 *
 * Ранее сюда передавались source/asOf «первой доступной» метрики строки,
 * из-за чего показатель без своего источника получал чужую отметку и
 * выглядел подтверждённым. Подстановка запрещена: нет своего источника —
 * пишем «источник не указан / дата не указана», а не заимствуем доверие
 * у соседнего показателя.
 */
function metricSourceTag<T>(metric: SourcedValue<T>): string {
  if (metric.value === null) return '';
  const source = metric.source ?? 'источник не указан';
  return ` (${source}, ${fmtAsOf(metric.asOf)})`;
}

/** Описание показателя в компактной строке. */
interface FundamentalMetricSpec {
  label: string;
  metric: SourcedValue;
  digits?: number;
  suffix?: string;
}

/**
 * Компактный рендер фундаментального блока одного актива.
 * Одна строка на группу показателей; источник и дата — в конце строки.
 * Используется и в основном системном промпте, и в JSON-only повторе.
 */
function renderAssetFundamentalsCompact(asset: StockFundamentals): string {
  const lines: string[] = [`--- ${asset.ticker} (${asset.name}) ---`];

  const priceTag = metricSourceTag(asset.price);
  const capTag = metricSourceTag(asset.marketCap);
  const capText =
    asset.marketCap.value !== null
      ? fmtRub(asset.marketCap.value)
      : `недоступно (${asset.marketCap.note ?? 'источник не отвечает'})`;
  lines.push(
    `Цена ${metricText(asset.price, 2, ' ₽')}${priceTag} | ` +
      `Капитализация ${capText}${capTag}`,
  );

  const specs: FundamentalMetricSpec[] = [
    { label: 'P/E', metric: asset.pe },
    { label: 'P/S', metric: asset.ps },
    { label: 'P/B', metric: asset.pb },
    { label: 'ROE', metric: asset.roe, digits: 1, suffix: '%' },
    { label: 'ROA', metric: asset.roa, digits: 1, suffix: '%' },
    { label: 'Долг/Капитал', metric: asset.debtToEquity },
    {
      label: 'Дивидендная доходность',
      metric: asset.dividendYield,
      digits: 1,
      suffix: '%',
    },
    {
      label: 'Дивиденд на акцию',
      metric: asset.dividendPerShare,
      digits: 2,
      suffix: ' ₽',
    },
  ];

  const parts = specs.map(
    (spec) =>
      `${spec.label} ${metricText(spec.metric, spec.digits ?? 2, spec.suffix ?? '')}` +
      metricSourceTag(spec.metric),
  );
  // Источник и дата стоят у КАЖДОЙ метрики, а не один раз в конце строки:
  // общий тег строки создавал видимость подтверждения у неподтверждённых полей.
  lines.push(parts.join(' | '));

  const conflicts = specs
    .filter(
      (spec) =>
        spec.metric.status === 'CONFLICT' && spec.metric.conflictValue != null,
    )
    .map(
      (spec) =>
        `${spec.label} ${fmtNumber(spec.metric.conflictValue ?? 0, spec.digits ?? 2)}${spec.suffix ?? ''} ` +
        `(${spec.metric.conflictSource ?? 'второй источник'})`,
    );
  if (conflicts.length > 0) {
    lines.push(`⚠️ Расхождение источников: ${conflicts.join('; ')}`);
  }

  const medians = asset.medians;
  if (medians) {
    const medianParts: string[] = [];
    if (medians.pe5y != null)
      medianParts.push(`P/E ${fmtNumber(medians.pe5y, 2)}`);
    if (medians.roe5y != null)
      medianParts.push(`ROE ${fmtNumber(medians.roe5y, 1)}%`);
    if (medians.debtToEquity5y != null)
      medianParts.push(`Долг/Капитал ${fmtNumber(medians.debtToEquity5y, 2)}`);
    if (medians.dividendYield5y != null)
      medianParts.push(
        `Дивидендная доходность ${fmtNumber(medians.dividendYield5y, 1)}%`,
      );
    if (medianParts.length > 0) {
      lines.push(
        `Медиана ${medians.years ?? 5} лет (${medians.source ?? 'источник не указан'}, ` +
          `${fmtAsOf(medians.asOf)}): ${medianParts.join(' | ')}`,
      );
    }
  }

  lines.push(
    asset.nextDividendDate.value !== null
      ? `Следующая отсечка: ${asset.nextDividendDate.value}${metricSourceTag(asset.nextDividendDate)}`
      : `Следующая отсечка: недоступно (${asset.nextDividendDate.note ?? 'нет данных'})`,
  );

  if (asset.unavailable.length > 0) {
    lines.push(`Недоступно: ${asset.unavailable.join('; ')}`);
  }
  if (asset.conflicts.length > 0) {
    lines.push(`Конфликты источников: ${asset.conflicts.join('; ')}`);
  }

  lines.push(
    `Здоровье: ${
      asset.fundamentalHealth === 'POSITIVE'
        ? '✅ Позитивный'
        : asset.fundamentalHealth === 'NEGATIVE'
          ? '❌ Негативный'
          : '⚠️ Нейтральный'
    } (оценка по показателям выше)`,
  );

  return lines.join('\n');
}

/**
 * Компактная строка технических индикаторов для JSON-only промпта.
 *
 * Формат — одна строка на тикер: модель не должна терять привязку
 * «тикер → числа → дата». Недоступные значения пишутся словом
 * «недоступно», а не нулём (fail-closed).
 */
function renderTechnicalIndicatorsCompact(ind: TechnicalIndicators): string {
  const smaPeriods = ind.smaPeriods ?? [];
  const smaValues = ind.smaValues ?? {};
  const smaParts =
    smaPeriods.length > 0
      ? smaPeriods.map((period) => {
          const value = smaValues[String(period)] ?? null;
          return `SMA${period} ${value !== null ? value.toFixed(2) : 'недоступно'}`;
        })
      : [
          `SMA20 ${ind.sma20 !== null ? ind.sma20.toFixed(2) : 'недоступно'}`,
          `SMA50 ${ind.sma50 !== null ? ind.sma50.toFixed(2) : 'недоступно'}`,
        ];

  const range =
    ind.high52w != null && ind.low52w != null
      ? `52w ${ind.low52w.toFixed(2)}–${ind.high52w.toFixed(2)}`
      : '52w недоступно';

  const trend =
    ind.trend === 'up'
      ? 'восходящий'
      : ind.trend === 'down'
        ? 'нисходящий'
        : ind.trend === 'flat'
          ? 'боковик'
          : 'недоступно';

  const volatility =
    ind.volatilityAnnual !== null
      ? `${(ind.volatilityAnnual * 100).toFixed(1)}%`
      : 'недоступно';

  const asOf = ind.technicalAsOf ? `на ${ind.technicalAsOf}` : 'дата н/д';

  return (
    `• ${ind.ticker}: RSI ${ind.rsi !== null ? ind.rsi.toFixed(1) : 'недоступно'}; ` +
    `${smaParts.join('; ')}; ${range}; тренд ${trend}; ` +
    `волатильность ${volatility}; ${asOf}`
  );
}

/**
 * Компактный системный промпт для ПОВТОРНОГО запроса: только JSON-массив.
 * Используется, когда основной ответ модели не дал валидного JSON.
 *
 * Технические индикаторы передаются, чтобы повторный ответ не терял
 * 52w/SMA и не писал «технические индикаторы недоступны» при их наличии.
 */
export function buildJsonOnlySystemPrompt(
  assetTickers: string[],
  portfolioFundamentals?: CanonicalPortfolioFundamentalsContext,
  technicalIndicators?: TechnicalIndicators[],
): string {
  const fundamentals =
    portfolioFundamentals && portfolioFundamentals.assets.length > 0
      ? `\n=== ФУНДАМЕНТАЛЬНЫЕ ДАННЫЕ ===\n${portfolioFundamentals.assets
          .map(renderAssetFundamentalsCompact)
          .join('\n\n')}\n`
      : '';

  const technical =
    technicalIndicators && technicalIndicators.length > 0
      ? '\n=== ТЕХНИЧЕСКИЕ ИНДИКАТОРЫ (MOEX ISS) ===\n' +
        `${technicalIndicators.map(renderTechnicalIndicatorsCompact).join('\n')}\n` +
        'Используй только эти значения; недоступные показатели не заменяй нулём.\n'
      : '';

  return (
    'Ты — инвестиционный стратег. Верни ТОЛЬКО JSON-массив: без пояснений ' +
    'и без текста до/после. Оберни массив в ```json ... ```.\n' +
    'Один объект на каждый актив. Поля: ticker, recommendedAction ' +
    '(BUY|SELL|HOLD|REDUCE|EXIT|AVOID|AVERAGE), confidence (0–1 или null), ' +
    'rationale, targetReason, keyRisks, keyCatalysts, agreementWithPortfolioMath ' +
    '(AGREE|DISAGREE|UNCERTAIN), fundamentalAnalysis, technicalTiming, entryStrategy, ' +
    'issuerContext, dataSources.\n' +
    'Правила: используй только данные из сообщения; каждое число — с источником и датой; ' +
    'если данных нет — recommendedAction HOLD, agreementWithPortfolioMath UNCERTAIN, ' +
    'в rationale «нет данных». Не выдумывай P/E, ROE, дивиденды и суммы. ' +
    'Для активов из блока GUARDRAILS с пометкой no-sell ЗАПРЕЩЕНЫ директивы ' +
    'продажи/сокращения (продать, продавайте, сократить, снизить, зафиксировать, ' +
    'выйти из позиции) — разрешено только упоминание блокировки. ' +
    'Свободные числовые цели доли в директивных конструкциях («с 17,4% до ~12%») запрещены. ' +
    'ticker — только символы тикера (например TATN).\n' +
    `Активы (верни объект для каждого): ${assetTickers.join(', ')}.\n` +
    fundamentals +
    technical
  );
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
 * @param fundamentalMetrics — фундаментальные метрики одного актива (опционально)
 * @param portfolioFundamentals — фундаментальные метрики ВСЕХ активов (опционально, приоритет)
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
  portfolioFundamentals?: PortfolioFundamentalsContext,
  behavioralFactors?: BehavioralFactors,
  technicalIndicators?: TechnicalIndicators[],
  liquidityContext?: LiquidityContext,
  rebalanceData?: {
    freeCash: number;
    buyList: string;
    reduceList: string;
    totalBuyRub: number;
    totalReduceRub: number;
  },
): string {
  const currentMonth = new Date().toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  });

  /** Форматирование суммы в рублях */
  function formatRub(value: number): string {
    if (value >= 1e9)
      return (value / 1e9).toFixed(1).replace('.', ',') + ' млрд ₽';
    if (value >= 1e6)
      return (value / 1e6).toFixed(1).replace('.', ',') + ' млн ₽';
    if (value >= 1e3)
      return (value / 1e3).toFixed(1).replace('.', ',') + ' тыс ₽';
    return value.toLocaleString('ru-RU') + ' ₽';
  }

  /** Рендер фундаментального блока одного актива (компактный формат). */
  function renderAssetFundamentals(asset: StockFundamentals): string {
    return renderAssetFundamentalsCompact(asset);
  }

  // Макро-контекст
  const macroLines: string[] = [];
  if (macroData) {
    const hasData = macroData.keyRate > 0;
    if (hasData) {
      const freshnessLabel = macroData.isFresh
        ? 'актуально'
        : '⚠️ требует проверки (данные могут быть устаревшими)';
      macroLines.push(
        `Ставка ЦБ: ${macroData.keyRate}% (источник: ${macroData.source || 'CBR'}, ${freshnessLabel})`,
      );
    } else {
      macroLines.push('Ставка ЦБ: — (данные не получены)');
    }
    if (macroData.inflation !== undefined) {
      const inflationLabel =
        macroData.inflation > macroData.keyRate
          ? `⚠️ инфляция (${macroData.inflation}%) превышает ключевую ставку — реальная ставка отрицательная`
          : macroData.inflation > 7
            ? 'Инфляция выше целевого диапазона ЦБ (4±1%)'
            : 'Инфляция в пределах целевого диапазона ЦБ';
      macroLines.push(`Инфляция: ${macroData.inflation}% (${inflationLabel})`);
    }
    if (macroData.currency !== undefined)
      macroLines.push(
        `USD/RUB: ${macroData.currency} (⚠️ волатильность зависит от геополитики)`,
      );
    if (macroData.oil !== undefined)
      macroLines.push(
        `Нефть Brent: $${macroData.oil} (⚠️ зависит от санкций и спроса из Китая)`,
      );

    // Uncertainty level
    const hasUncertainty =
      !macroData.isFresh ||
      (macroData.inflation !== undefined && macroData.inflation > 7);
    if (hasUncertainty) {
      macroLines.push(
        '⚠️ Уровень неопределённости: ВЫСОКИЙ — макроэкономические данные требуют осторожной интерпретации',
      );
    } else {
      macroLines.push(
        'Уровень неопределённости: УМЕРЕННЫЙ — данные соответствуют ожиданиям',
      );
    }
  } else {
    macroLines.push('Ставка ЦБ: — (данные не получены)');
    macroLines.push(
      '⚠️ Макроэкономические данные недоступны — решения принимаются без учёта макроконтекста',
    );
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
    '• В рекомендациях ОБЯЗАТЕЛЬНО использовать SHORT NAME: "Сбербанк" вместо "RU000A109L49". В JSON: ticker — тикер, rationale — название.\n' +
    '  ✅ ПРАВИЛЬНО: "Полюс", "Сбербанк", "АЛРОСА1Р1"\n' +
    '  ❌ НЕПРАВИЛЬНО: "RU000A109L49", "A10EC22"\n' +
    '• Для облигаций используй name из Excel, а НЕ ISIN.\n' +
    '• При упоминании актива в тексте ИИ должен писать название ПЕРВЫМ, тикер в скобках: "АЛРОСА1Р1 (RU000A109L49)".\n' +
    '• ЗАПРЕЩЕНО: "гарантированная доходность", "безрисковый", "100% гарантия".\n' +
    '• ЗАПРЕЩЕНО: выдумывать отсутствующие данные и факты.\n' +
    '• ЗАПРЕЩЕНО: обобщать без числа: «обычно 15-20%», «как правило», «в среднем», «известен высокой рентабельностью», «традиционно». Только конкретное число с источником и датой: «P/E 5,3 (smart-lab.ru, 17.11.2026)».\n' +
    '• Если данных нет — писать «недоступно: источник не отвечает» или «недоступно: структура страницы не распознана». НЕ подставлять отраслевые средние и «обычные» значения.\n' +
    '• ЗАПРЕЩЕНО: выдумывать доходность облигаций. Если данные не переданы — пиши «нет данных».\n' +
    '• ЗАПРЕЩЕНО: выдумывать суммы дефицита/профицита в рублях. Используй ТОЛЬКО данные из раздела «ТОЧНЫЕ СУММЫ ДЛЯ РЕБАЛАНСИРОВКИ».\n' +
    '• Если в разделе «ТОЧНЫЕ СУММЫ» нет актива — пиши «сумма не указана» вместо выдумывания.\n' +
    '• ЗАПРЕТ НА ЛИШНЮЮ ПРОДАЖУ ОБЛИГАЦИЙ (STABLE + профицит ≤ 3.5 п.п.): ' +
    'Если у облигации mathAgreement=STABLE и профицит доли не превышает 3.5 процентных пункта, ' +
    'НЕ РЕКОМЕНДУЙ REDUCE или EXIT — ставь HOLD. Выравнивание происходит естественно за счёт ' +
    'ежемесячных пополнений и купонов без расходов на спред и налоги. ' +
    'Исключение для REDUCE/EXIT по STABLE-облигациям только при: ' +
    '(а) критическом кредитном риске (дефолт, рейтинг ниже A-), ' +
    '(б) экстремальном перевесе доли (> 12–15% портфеля).\n' +
    '• СТРОГАЯ СОГЛАСОВАННОСТЬ НАПРАВЛЕНИЙ (DIRECTION_CONFLICT): ' +
    'recommendedAction в JSON и текст в карточке актива (rationale) ' +
    'должны 100% совпадать по направлению (BUY, HOLD, REDUCE, EXIT). ' +
    'Если Math=REDUCE — запрещено ставить BUY ни в одном из полей. ' +
    'Если Math=STABLE — запрещено ставить REDUCE/EXIT без обоснования из правил выше.\n' +
    '• ПОЛИТИКА NO-SELL В ТЕКСТЕ: для актива из блока GUARDRAILS с пометкой ' +
    'no-sell ЗАПРЕЩЕНЫ любые директивы продажи/сокращения (продать, продавайте, ' +
    'сократить, снизить, зафиксировать, выйти из позиции), в том числе с суммой ' +
    'или процентом. Разрешено только упоминание самой блокировки: ' +
    '«продажа/сокращение заблокированы политикой no-sell».\n' +
    '• НЕ ПОВТОРЯЙ СТРОКИ ПОЛИТИКИ В rationale: служебный текст ' +
    '«продажа/сокращение заблокированы политикой no-sell» выводится ' +
    'конвейером один раз (баннер карточки). В rationale — только обоснование ' +
    'по активу, без повтора этой фразы и без её искажений ' +
    '(«поsell», «по-sell», «no sell»).\n' +
    '• ЗАПРЕТ СВОБОДНЫХ ЧИСЛОВЫХ ЦЕЛЕЙ ДОЛИ: в директивных конструкциях нельзя ' +
    'писать «с 17,4% до ~12%» или иные целевые проценты, которых нет в данных ' +
    'конвейера. Число в тексте либо совпадает с переданными данными (с источником ' +
    'и датой), либо отсутствует.\n' +
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
    (investorParams
      ? `
=== ПАРАМЕТРЫ ИНВЕСТОРА ===
• Горизонт: ${investorParams.horizon}
• Цель: ${investorParams.goal}
• Риск-профиль: ${investorParams.riskProfile}
• Максимальная просадка: ${investorParams.maxDrawdown}%

Учитывай эти параметры при формировании рекомендаций.
`
      : '') +
    (bondAnalyses && bondAnalyses.length > 0
      ? `
=== СТРУКТУРИРОВАННЫЙ АНАЛИЗ ОБЛИГАЦИЙ ===
В портфеле ${bondAnalyses.length} облигаций. Для каждой проведён полный анализ:

${bondAnalyses
  .map(
    (bond) => `
--- ${bond.isin} (${bond.name}) ---
• Эмитент: ${bond.issuer}
• Рыночная стоимость: ${formatRub(bond.balanceValue)} руб. (${(bond.balanceValue / 1000000).toFixed(2)} млн руб.), кол-во: ${bond.quantity}
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
`,
  )
  .join('\n')}
`
      : '') +
    (bondContext
      ? `
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
`
      : '') +
    (deepLossContext
      ? `
=== ГЛУБОКОЕ ПАДЕНИЕ ===
• ${deepLossContext.ticker}: ${deepLossContext.drawdownPercent.toFixed(1)}% просадка, уровень ${deepLossContext.lossLevel}, причина: ${deepLossContext.primaryReason}
`
      : '') +
    (portfolioFundamentals && portfolioFundamentals.assets.length > 0
      ? `
=== ФУНДАМЕНТАЛЬНЫЙ АНАЛИЗ ВСЕХ АКТИВОВ ===
Источники: MOEX ISS — цены и дивидендный календарь; smart-lab.ru — мультипликаторы и история.
Формат: «P/E 5,13 | ROE 19,0% | Долг/Капитал 0,01 (smart-lab.ru, 17.11.2026)» — источник и дата стоят в конце строки показателей.
⚠️ Каждая цифра ниже имеет источник и дату. Запрещено заменять «недоступно» отраслевыми средними или «обычными» значениями.

${portfolioFundamentals.assets.map(renderAssetFundamentals).join('\n\n')}

${portfolioFundamentals.warnings.length > 0 ? `Предупреждения источников:\n${portfolioFundamentals.warnings.map((warning) => '• ' + warning).join('\n')}\n` : ''}
ПРАВИЛА ИСПОЛЬЗОВАНИЯ:
• В fundamentalAnalysis и issuerContext используй ТОЛЬКО числа из этого раздела с пометкой источника и даты: «P/E 5,13 (smart-lab.ru, 17.11.2026)».
• Если поле помечено «недоступно» — пиши «P/E: недоступно (источник не отвечает)». Запрещены формулировки «обычно 15-20%», «как правило», «в среднем», «известен высокой рентабельностью» без конкретного числа.
• Сравнивай текущее значение с медианой 5 лет, если она указана.
• Названия источников не искажай: «MOEX ISS», «smart-lab.ru».
`
      : '') +
    (fundamentalMetrics
      ? `
=== ФУНДАМЕНТАЛЬНЫЙ АНАЛИЗ (legacy) ===
• ${fundamentalMetrics.ticker} (${fundamentalMetrics.name}):
${fundamentalMetrics.pe !== undefined ? `• P/E: ${(fundamentalMetrics.pe ?? 0).toFixed(1)}${fundamentalMetrics.ps !== undefined ? ', P/S: ' + (fundamentalMetrics.ps ?? 0).toFixed(1) : ''}${fundamentalMetrics.roe !== undefined ? ', ROE: ' + (fundamentalMetrics.roe ?? 0).toFixed(1) + '%' : ''}` : '• Оценка: нет данных'}
${fundamentalMetrics.profitMargin !== undefined ? `• Маржа прибыли: ${(fundamentalMetrics.profitMargin ?? 0).toFixed(1)}%` : ''}
${fundamentalMetrics.debtToEquity !== undefined ? `• Долг/Капитал: ${(fundamentalMetrics.debtToEquity ?? 0).toFixed(2)}` : ''}
${fundamentalMetrics.revenueGrowth !== undefined ? `• Рост выручки: ${(fundamentalMetrics.revenueGrowth ?? 0).toFixed(1)}%` : ''}
${fundamentalMetrics.earningsGrowth !== undefined ? `• Рост прибыли: ${(fundamentalMetrics.earningsGrowth ?? 0).toFixed(1)}%` : ''}
${fundamentalMetrics.dividendYield !== undefined ? `• Дивидендная доходность: ${(fundamentalMetrics.dividendYield ?? 0).toFixed(1)}%` : ''}
• Фундаментальное здоровье: ${fundamentalMetrics.fundamentalHealth === 'POSITIVE' ? '✅ Позитивный' : fundamentalMetrics.fundamentalHealth === 'NEGATIVE' ? '❌ Негативный' : '⚠️ Нейтральный'} — ${fundamentalMetrics.summary}
`
      : '') +
    (behavioralFactors
      ? `
=== ПОВЕДЕНИЕ ===
• ${behavioralFactors.ticker}: ${behavioralFactors.lossAversion} lossAversion, ${behavioralFactors.averagingTendency} averaging, ${behavioralFactors.panicTendency} panic — ${behavioralFactors.behavioralAdvice}
`
      : '') +
    (technicalIndicators && technicalIndicators.length > 0
      ? `
=== ТЕХНИЧЕСКИЕ ИНДИКАТОРЫ И ИСТОРИЧЕСКИЕ ДАННЫЕ ===
Для каждого актива рассчитаны индикаторы на основе дневной истории MOEX ISS:

${technicalIndicators
  .map((ind) => {
    const smaPeriods = ind.smaPeriods ?? [];
    const smaValues = ind.smaValues ?? {};
    const smaLines =
      smaPeriods.length > 0
        ? smaPeriods
            .map((period) => {
              const value = smaValues[String(period)] ?? null;
              return `• SMA${period}: ${
                value !== null ? value.toFixed(2) : 'недоступно'
              }`;
            })
            .join('\n')
        : `• SMA20: ${ind.sma20 !== null ? ind.sma20.toFixed(2) : 'недоступно'}\n• SMA50: ${
            ind.sma50 !== null ? ind.sma50.toFixed(2) : 'недоступно'
          }`;
    const rangeLine =
      ind.high52w != null && ind.low52w != null
        ? `• 52-недельный диапазон: ${ind.low52w.toFixed(2)}–${ind.high52w.toFixed(2)}${
            ind.technicalAsOf ? ` (MOEX ISS, ${ind.technicalAsOf})` : ''
          }`
        : '• 52-недельный диапазон: недоступно';

    return `
--- ${ind.ticker} ---
• RSI(14): ${ind.rsi !== null ? ind.rsi.toFixed(1) : 'нет данных'}${ind.rsi !== null ? (ind.rsi < 30 ? ' (перепроданность)' : ind.rsi > 70 ? ' (перекупленность)' : '') : ''}
${smaLines}
${rangeLine}
• Тренд: ${ind.trend !== null ? (ind.trend === 'up' ? 'восходящий' : ind.trend === 'down' ? 'нисходящий' : 'боковик') : 'нет данных'}
• Волатильность (годовая): ${ind.volatilityAnnual !== null ? (ind.volatilityAnnual * 100).toFixed(1) + '%' : 'нет данных'}
• Риск: ${ind.riskLevel !== null ? (ind.riskLevel === 'low' ? 'низкий' : ind.riskLevel === 'medium' ? 'средний' : 'высокий') : 'нет данных'}
• Z-score: ${ind.zScoreLast !== null ? ind.zScoreLast.toFixed(2) : 'нет данных'}${ind.zScoreLast !== null && Math.abs(ind.zScoreLast) > 2 ? ' (аномалия)' : ''}
${ind.isLastAnomaly ? '⚠️ Аномалия на последнем баре!' : ''}
`;
  })
  .join('\n')}

ИСПОЛЬЗУЙ эти данные для рекомендации оптимальных точек входа/выхода:
• RSI < 30 + цена ниже короткой/длинной SMA → потенциальная точка покупки (перепроданность)
• RSI > 70 + цена выше короткой/длинной SMA → потенциальная точка продажи (перекупленность)
• Восходящий тренд + низкая волатильность → благоприятная среда для покупки
• Нисходящий тренд + высокая волатильность → осторожность с покупками
• Z-score > 2 или < -2 → аномальное движение, требует внимания
• НЕ используй технические индикаторы как единственный аргумент — комбинируй с фундаменталом
`
      : '') +
    (rebalanceData
      ? `
=== ТОЧНЫЕ СУММЫ ДЛЯ РЕБАЛАНСИРОВКИ ===
⚠️ НЕ выдумывай суммы. Используй ТОЛЬКО эти данные:
• Свободный кэш: ${rebalanceData.freeCash.toLocaleString('ru-RU')} руб.
• Активы с дефицитом (КУПИТЬ):
${rebalanceData.buyList}
• Активы с профицитом (ПРОДАТЬ):
${rebalanceData.reduceList}
• Итого нужно купить: ${rebalanceData.totalBuyRub.toLocaleString('ru-RU')} руб.
• Итого можно продать: ${rebalanceData.totalReduceRub.toLocaleString('ru-RU')} руб.

Используй эти точные суммы в резюме. НЕ рассчитывай суммы самостоятельно.
`
      : '') +
    (liquidityContext
      ? `
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
${liquidityContext.assets
  .map(
    (asset) => `
--- ${asset.ticker} (${asset.name}) ---
• Стоимость позиции: ${formatRub(asset.marketValue)}
• Дневной оборот: ${asset.dailyTurnover !== null ? formatRub(asset.dailyTurnover) : 'нет данных'}
• Уровень: ${asset.liquidityLevel === 'HIGH' ? '✅ Высокий' : asset.liquidityLevel === 'MEDIUM' ? '⚠️ Средний' : asset.liquidityLevel === 'LOW' ? '⚠️ Низкий' : asset.liquidityLevel === 'CRITICAL' ? '🔴 Критический' : '❓ Нет данных'}
• Отношение оборот/позиция: ${asset.turnoverToValueRatio.toFixed(3)}
• Дней для ликвидации: ${asset.liquidationDays !== null ? asset.liquidationDays : 'н/д'}
${asset.warning ? '• ⚠️ ' + asset.warning : ''}
${asset.advice ? '• 💡 ' + asset.advice : ''}
`,
  )
  .join('\n')}

ВАЖНО ПРИ ФОРМИРОВАНИИ РЕКОМЕНДАЦИЙ:
• НЕ РЕКОМЕНДУЙ BUY для активов с CRITICAL ликвидностью без предупреждения о рисках выхода.
• При рекомендации BUY низколиквидного актива (LOW/CRITICAL): ОБЯЗАТЕЛЬНО укажи "наращивать частями".
• При рекомендации SELL низколиквидного актива: ОБЯЗАТЕЛЬНО укажи "продавать частями из-за низкого оборота".
• Активы с CRITICAL ликвидностью не должны составлять более 5% портфеля.
• Если портфель имеет статус WARNING/CRITICAL по ликвидности — приоритетом является снижение концентрации низколиквидных активов.
`
      : '') +
    '=== ЗАДАЧА ===\n' +
    '1. Макро: соответствие структуры портфеля ставке ' +
    cbrRate +
    '%.\n' +
    '2. Каждый актив: анализ по status (BUY/REDUCE/STABLE/EXIT/NO_TARGET).\n' +
    '3. Ребалансировка: приоритет BUY/REDUCE/EXIT, кэш. ' +
    'Если указан средний ежемесячный взнос — планируй покупки с его учётом: распредели дефицит долей на 1-3 месяца пополнений.\n' +
    '4. Мониторинг: котировки, макро.\n' +
    '5. Новые инструменты: НЕ добавлять.\n\n' +
    '=== ФОРМАТ ОТВЕТА ===\n' +
    '1. СНАЧАЛА выведи JSON-МАССИВ для ВСЕХ активов портфеля — он обязателен и идёт ПЕРВЫМ.\n' +
    '2. Затем развёрнутый текстовый ответ из 5 секций.\n\n' +
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
    '    "agreementWithPortfolioMath": "AGREE"|"DISAGREE"|"UNCERTAIN",\n' +
    '    "fundamentalAnalysis": "<P/E> (<источник>, <дата>) — <сравнение с медианой>. <ROE> (<источник>, <дата>). Долг/Капитал <D/E> (<источник>, <дата>) — долг <Debt> на капитал <Equity>.",\n' +
    '    "technicalTiming": "RSI 28 (MOEX ISS, 17.11.2026) — акция перепродана. Лучшая точка: нарастить частями при падении до 280 ₽.",\n' +
    '    "entryStrategy": "Покупайте в 2-3 партии по 50-60% от нужной суммы. Первая партия сейчас, вторая при падении на 5-10%. Это снижает риск покупки по неправильной цене.",\n' +
    '    "issuerContext": "<P/E> и <ROE> (<источник>, <дата>). Дивдоходность <DividendYield> (<источник>, <дата>).",\n' +
    '    "dataSources": ["MOEX ISS", "smart-lab.ru", "CBR", "QUIK"]\n' +
    '  },\n' +
    '  ...\n' +
    ']\n' +
    '```\n' +
    '⚠️ ticker: ТОЛЬКО символы тикера (например: "SBER", "GAZP"). НЕ "SBER (Сбербанк)", НЕ "SBER — Сбербанк", НЕ "IRAO — ИнтерРАОао".\n' +
    '⚠️ Если тикер содержит пробелы, скобки, тире — JSON будет отброшен.\n' +
    '⚠️ ОБЯЗАТЕЛЬНО верни JSON-объект ДЛЯ КАЖДОГО актива из списка активов. Не пропускай ни один.\n' +
    '⚠️ Если нет данных для актива — верни {"ticker":"ТИКЕР","recommendedAction":"HOLD","confidence":null,"rationale":"нет данных","targetReason":"нет данных","keyRisks":[],"keyCatalysts":[],"agreementWithPortfolioMath":"UNCERTAIN"}.\n' +
    '⚠️ НЕ включай в JSON: price, quantity, deficit, liquidationValue.\n' +
    '⚠️ Проценты: 47.7%, не 47.739999%.\n' +
    '⚠️ ОБЯЗАТЕЛЬНО заполни targetReason для КАЖДОГО актива. Если нет причины — напиши "целевая доля не меняется".\n' +
    '=== JSON-БЛОК ЦЕНОВЫХ ТРИГГЕРОВ (ОТДЕЛЬНЫМ БЛОКОМ) ===\n' +
    'Если по активу есть уровни цены — выведи РОВНО ОДИН ОТДЕЛЬНЫЙ блок такого вида ' +
    '(пример с реальными полями; значения — образец структуры, не данные):\n' +
    '```json\n' +
    '{"priceTriggers":[{"ticker":"SBER","levels":[{"price":280,"direction":"below"},{"price":320,"direction":"above"}],"action":"HOLD"}]}\n' +
    '```\n' +
    '⚠️ Схема неизменна: ticker — строка только из символов тикера; ' +
    'levels — непустой массив объектов ровно с полями price (положительное число) и ' +
    'direction ("above" | "below"); action — строка действия (BUY/SELL/HOLD/REDUCE/EXIT/AVOID).\n' +
    '⚠️ НЕ добавляй других полей, НЕ оборачивай каждый уровень в отдельный блок, ' +
    'НЕ выводи несколько блоков priceTriggers — только один блок на весь ответ.\n' +
    '⚠️ "above" — сигнал при росте до уровня или выше, "below" — при падении до уровня или ниже.\n' +
    '⚠️ Уровни задавай ТОЛЬКО числами в этом блоке; в свободном тексте уровни не описывай.\n' +
    '⚠️ Если подтверждённых уровней нет — НЕ выводи этот блок вообще: выдуманные цены запрещены.\n' +
    '⚠️ Для активов под no-sell политикой action не может быть SELL/REDUCE/EXIT — ставь HOLD.\n' +
    '=== ТЕКСТОВЫЙ ОТВЕТ (5 секций, ПОСЛЕ JSON) ===\n' +
    '1. Макро и структура\n' +
    '2. План ребалансировки\n' +
    '3. Динамический мониторинг\n' +
    '4. Новые инструменты\n' +
    '5. Краткое резюме (3-5 действий)\n\n' +
    '⚠️ НЕ генерируй блок «Инвестиционные стратегии»: он строится программно ' +
    'из валидированного JSON. Допустим только один итоговый абзац ' +
    '(3-4 предложения, без чисел) поверх готового рендера.\n' +
    '⚠️ ЗАПРЕЩЕНЫ любые прогнозы доходности в процентах за периоды: ' +
    '«+5-15% за 3 мес», «+20-40% за 12 мес», «+50-100% за 3+ лет», ' +
    '«ожидаемая доходность +20-40% годовых», «обычно 15-20%». ' +
    'Единственный допустимый доходностный якорь — купонно-дивидендный, ' +
    'вычисленный из данных.\n' +
    '⚠️ Опора только на переданные данные: ' +
    'Используй ТОЛЬКО цифры из входного контекста. ' +
    'При флагах NO_DATA или INSUFFICIENT_DATA прямо указывай «нет данных» — ' +
    'НЕ выдумывай мультипликаторы (P/E, ROE) или обороты.\n' +
    '⚠️ НЕ дублируй рекомендации по активам в тексте: ' +
    'НЕ выводи таблицу «Актив | Действие | Доля % | Целевая % | Дефицит/Профицит | Обоснование» ' +
    'и не пересказывай построчно числа из JSON. ' +
    'Эти данные пользователь видит в структурированных карточках, ' +
    'которые строятся из JSON и валидируются отдельно. ' +
    'В тексте — только макро-выводы, план ребалансировки, мониторинг и резюме.\n' +
    '⚠️ Отвечай на русском, развёрнуто, с аргументацией; числа — только из входного контекста.';

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
    '• ОБЯЗАТЕЛЬНО заполняй новые поля JSON для КАЖДОГО актива:\n' +
    '  - fundamentalAnalysis: ОБЪЯСНИ простыми словами, что каждый показатель значит для инвестора, но КАЖДОЕ число сопровождай источником и датой:\n' +
    '    • P/E: «P/E 5,13 (smart-lab.ru, 17.11.2026) — вы платите 5,13 ₽ за 1 ₽ годовой прибыли; медиана 5 лет 5,77».\n' +
    '    • ROE: «ROE <ROE> (<источник>, <дата>) — компания зарабатывает <ROE> на собственный капитал».\n' +
    '    • Долг/Капитал: «Долг/Капитал <D/E> (<источник>, <дата>) — долг <Debt> против капитала <Equity>».\n' +
    '    • Дивидендная доходность: «Дивдоходность <DividendYield> (<источник>, <дата>) — <DividendYield> годовых только от дивидендов».\n' +
    '    ⚠️ Это шаблон формата, а не данные. Числа из примера запрещено переносить в другой тикер: бери только из блока «--- TICKER ---».\n' +
    '    Если поле помечено «недоступно» — напиши «P/E: недоступно (источник не отвечает)». ЗАПРЕЩЕНО писать «обычно 15-20%», «как правило», «в среднем», «известен высокой рентабельностью» без числа.\n' +
    '  - technicalTiming: на основе RSI, SMA20/50, тренда — лучшая точка для сделки. ' +
    '    ОБЪЯСНИ простыми словами: "RSI 28 — акция сильно упала и может вырасти. Хорошее время для покупки."\n' +
    '    Если RSI недоступен — напиши "Технические индикаторы недоступны. Следите за ценой: если акция упадёт на 10-15% от текущей — это хорошая точка входа".\n' +
    '  - entryStrategy: как покупать/продавать — частями (сколько партий) или сразу. ' +
    '    ОБЪЯСНИ почему: "Покупайте в 2-3 партии — так вы снизите риск покупки по неправильной цене".\n' +
    '  - issuerContext: краткий контекст по эмитенту — ТОЛЬКО факты с числом, источником и датой: ' +
    '    «P/E 5,13, ROE 19,0% (smart-lab.ru, 17.11.2026); дивдоходность 9,0% (smart-lab.ru, 17.11.2026)». ' +
    '    Если данных нет — «недоступно: источник не отвечает». Не писать общие характеристики без чисел.\n' +
    '  - dataSources: массив источников — ["MOEX ISS", "smart-lab.ru", "CBR", "QUIK"] — только те, что реально использованы. Названия не искажать.\n' +
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
