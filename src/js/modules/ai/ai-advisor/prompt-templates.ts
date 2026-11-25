/**
 * Шаблон системного промпта для ИИ-советника.
 * Сжатая версия: ~6K символов вместо ~45K.
 * Структура: P0 (запреты) → P1 (политика) → P2 (методика) → Справочник → Данные → Задача.
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
    /** Источник доходности: EXCEL_COLUMN / EXCEL_COMPUTED / SMART_LAB_PROBE. */
    yieldSource?: 'EXCEL_COLUMN' | 'EXCEL_COMPUTED' | 'SMART_LAB_PROBE' | null;
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
    /** Объём оборота (млн руб.) из Smart-Lab probe, если пуст в Excel. */
    turnoverFromSmartLab?: number | null;
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
      ? '\n=== ТЕХНИЧЕСКИЕ ИНДИКАТОРЫ ===\n' +
        `${technicalIndicators.map(renderTechnicalIndicatorsCompact).join('\n')}\n`
      : '';

  return (
    'Ты — инвестиционный стратег. Ответ строго по схеме JSON: portfolioSummary (5-8 абзацев: структура, P&L, ликвидность, риски, макро, выводы), recommendations (массив). Не добавляй ничего вне JSON.\n' +
    'Поля: ticker (строка), recommendedAction (BUY|SELL|HOLD|REDUCE|EXIT|AVOID|AVERAGE), confidence (0..1), rationale (1-2 предложения), keyRisks/keyCatalysts (массив строк или null), recommendedTargetPercent (число 0-100 или null), agreementWithPortfolioMath (AGREE|DISAGREE|UNCERTAIN), dataSources (null).\n' +
    'Правила: числа с источником и датой; нет данных → HOLD. no-sell → строго HOLD.\n' +
    `Активы: ${assetTickers.join(', ')}.\n` +
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
  _bondContext?: BondDataContext,
  bondAnalyses?: BondAnalysisResult[],
  deepLossContext?: DeepLossContext,
  _fundamentalMetrics?: FundamentalMetrics,
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

  // Макро-контекст (компактный)
  const macroLines: string[] = [];
  if (macroData) {
    const hasData = macroData.keyRate > 0;
    if (hasData) {
      const freshnessLabel = macroData.isFresh
        ? 'актуально'
        : '⚠️ требует проверки';
      macroLines.push(
        `Ставка ЦБ: ${macroData.keyRate}% (${macroData.source || 'CBR'}, ${freshnessLabel})`,
      );
    } else {
      macroLines.push('Ставка ЦБ: —');
    }
    if (macroData.inflation !== undefined) {
      macroLines.push(
        macroData.inflation > macroData.keyRate
          ? `Инфляция: ${macroData.inflation}% (выше ставки)`
          : `Инфляция: ${macroData.inflation}%`,
      );
    }
    if (macroData.currency !== undefined)
      macroLines.push(`USD/RUB: ${macroData.currency}`);
    if (macroData.oil !== undefined)
      macroLines.push(`Нефть Brent: $${macroData.oil}`);

    if (!macroData.isFresh) {
      macroLines.push(
        '⚠️ Ставка ЦБ устарела — уверенность не выше 0,5.',
      );
      macroLines.push(
        '🚫 ЗАПРЕТ: при isFresh=false НИКОГДА не пиши «актуально», «текущая», «на данный момент». ' +
        'Вместо этого пиши: «данные устарели, источник: [source], по состоянию на [asOf]».',
      );
    }
  } else {
    macroLines.push('Ставка ЦБ: — (нет данных)');
  }

  const prompt =
    '=== РОЛЬ ===\n' +
    'Ты — инвестиционный стратег. Анализируешь портфель на Московской бирже:\n' +
    'структуру, P&L, фундаментал, оценку, новости, макро и сценарии. Дата: ' +
    currentMonth + '.\n\n' +

    // === P0: ЖЁСТКИЕ ПРАВИЛА ===
    '=== P0: ЖЁСТКИЕ ПРАВИЛА ===\n' +
    '1. ДАННЫЕ: любая цифра/дата/факт — только из переданных. Нет данных → «нет данных». ' +
    'Запрещено: подставлять отраслевые средние, выдумывать доходность/суммы/котировки.\n' +
    '2. NO-SELL: тикер в no-sell списке → строго HOLD. Формулировка: «заблокировано политикой no-sell». ' +
    'STABLE + профицит ≤ 3.5 п.п. → HOLD (REDUCE/EXIT запрещены).\n' +
    '3. ЗАПРЕЩЁННЫЕ ФОРМУЛИРОВКИ: «гарантированная доходность», «безрисковый», «100% гарантия»; ' +
    'обобщения без числа («обычно 15–20%»). Числа — конкретные с источником и датой.\n' +
    '4. recommendedTargetPercent — ВСЕГДА число 0–100 или null. НЕ строка, без %. Пример: 17.4.\n' +
    '5. НЕ ПОВТОРЯЙ строки политики в rationale.\n\n' +

    // === P1: ПОЛИТИКА РЕШЕНИЙ ===
    '=== P1: ПОЛИТИКА РЕШЕНИЙ ===\n' +
    'targetPercent — факт пользователя (AI НЕ изменяет). PortfolioMath status — детерминированная математика (AI НЕ изменяет). ' +
    'AI вправе НЕ соглашаться — несогласие выражается ТОЛЬКО в targetReason и recommendedTargetPercent.\n' +
    'Направление: дефицит → BUY/AVERAGE; профицит → REDUCE/EXIT; совпадение → HOLD.\n' +
    'Действия: BUY=дефицит+привлекателен; AVERAGE=усреднение; HOLD=доля в норме/no-sell; ' +
    'REDUCE=профицит+продать часть; EXIT=профицит+закрыть; SELL=фундаментальная причина; AVOID=не покупать.\n' +
    'Ограничения: кэш ограничивает покупки; monthlyContribution учитывай при дефиците. ' +
    'INVALID_MARKET_DATA (currentPrice=0) → HOLD. Спутники ≤ 30% портфеля.\n' +
    'Именование: короткое название ПЕРВЫМ, тикер в скобках. Облигации — по name из Excel, НЕ по ISIN.\n\n' +

    // === P2: МЕТОДИКА ===
    '=== P2: МЕТОДИКА ===\n' +
    'CONFIDENCE: 0.85–1.00 высокая (≥3 фактора); 0.65–0.84 средняя (2 фактора); ' +
    '0.50–0.64 низкая (1 фактор); 0.30–0.49 догадка; 0.00–0.29 данные отсутствуют/противоречивы.\n' +
    '⚠ Если макро-данные устарели (fresh=false) — ceiling confidence = 0.50.\n' +
    'Ядро (Core) — защита капитала, ликвидность; Спутники (Satellite) — доходность, риск.\n' +
    'Техническая потребность в ребалансировке ≠ фундаментальная привлекательность.\n\n' +

    // === P3: СТИЛЬ АНАЛИЗА ===
    '=== P3: СТИЛЬ АНАЛИЗА ===\n' +
    'Пиши как старший аналитик УК. Каждое утверждение с цифрой. Тон: профессиональный.\n\n' +

    // === СПИСОК АКТИВОВ ===
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
    buildDeepAnalysisRules() +
    '\n\n' +
    (bondAnalyses && bondAnalyses.length > 0
      ? `
=== СТРУКТУРИРОВАННЫЙ АНАЛИЗ ОБЛИГАЦИЙ ===
В портфеле ${bondAnalyses.length} облигаций.

${bondAnalyses
  .map(
    (bond) => {
      // Извлекаем deviation из строки portfolioImpact или используем current/target
      const deviationMatch = bond.portfolioImpact.match(/deviation[-:\s]+([-\d.]+)/);
      const deviationPct = deviationMatch ? Math.abs(parseFloat(deviationMatch[1] ?? '0')) : 0;
      const isStableLowPriority =
        bond.recommendation === 'STABLE' && deviationPct <= 3;

      if (isStableLowPriority) {
        // Минимальный блок для STABLE облигаций с малым отклонением
        return `• ${bond.isin}: YTM=${bond.yieldAnalysis.ytm?.toFixed(1) || 'N/A'}%, ${bond.recommendation}`;
      }

      // Полный блок для проблемных облигаций (STABLE+профицит>3, REDUCE, EXIT)
      return `
--- ${bond.isin} (${bond.name}) ---
• Эмитент: ${bond.issuer}
• Рыночная стоимость: ${formatRub(bond.balanceValue)} руб., кол-во: ${bond.quantity}
• Доходность: Current Yield=${bond.yieldAnalysis.currentYield?.toFixed(2) || 'N/A'}%, YTM=${bond.yieldAnalysis.ytm?.toFixed(2) || 'N/A'}%
• Тип купона: ${bond.yieldAnalysis.couponType}, Данные: ${bond.yieldAnalysis.dataQuality}
• Дюрация: ${bond.durationAnalysis.duration?.toFixed(2) || 'N/A'} лет (${bond.durationAnalysis.durationType})
• Кредитное качество: ${bond.creditAssessment.quality} (источник: ${bond.creditAssessment.source})
• MOEX: рейтинг=${bond.moexData.icbrrRating || 'N/A'}, сектор=${bond.moexData.sector || 'N/A'}
• Рекомендация: ${bond.recommendation} — ${bond.rationale}
• Deviation: ${deviationPct.toFixed(2)} п.п.
${bond.missingData && bond.missingData.length > 0 ? `• Недостающие данные: ${bond.missingData.join(', ')}` : ''}`;
    },
  )
  .join('\n')}
`
      : '') +
    // legacy bondContext удалён — используется bondAnalyses
    '' +
    (deepLossContext
      ? `
=== ГЛУБОКОЕ ПАДЕНИЕ ===
• ${deepLossContext.ticker}: ${deepLossContext.drawdownPercent.toFixed(1)}% просадка, уровень ${deepLossContext.lossLevel}, причина: ${deepLossContext.primaryReason}
`
      : '') +
    (portfolioFundamentals && portfolioFundamentals.assets.length > 0
      ? `
=== ФУНДАМЕНТАЛЬНЫЙ АНАЛИЗ ВСЕХ АКТИВОВ ===
Источники: MOEX ISS — цены и дивидендный календарь; smart-lab.ru — мультипликаторы.
Формат: «P/E 5,13 | ROE 19,0% | Долг/Капитал 0,01 (smart-lab.ru, 17.11.2026)».

${portfolioFundamentals.assets.map(renderAssetFundamentals).join('\n\n')}

${portfolioFundamentals.warnings.length > 0 ? `Предупреждения источников:\n${portfolioFundamentals.warnings.map((warning) => '• ' + warning).join('\n')}\n` : ''}
`
      : '') +
    // legacy fundamentalMetrics удалён — используется portfolioFundamentals
    '' +
    (behavioralFactors
      ? `
=== ПОВЕДЕНИЕ ===
• ${behavioralFactors.ticker}: ${behavioralFactors.lossAversion} lossAversion, ${behavioralFactors.averagingTendency} averaging, ${behavioralFactors.panicTendency} panic — ${behavioralFactors.behavioralAdvice}
`
      : '') +
    (technicalIndicators && technicalIndicators.length > 0
      ? `
=== ТЕХНИЧЕСКИЕ ИНДИКАТОРЫ ===
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
        ? `• 52-недельный диапазон: ${ind.low52w.toFixed(2)}–${ind.high52w.toFixed(2)}`
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

Используй для точек входа/выхода. НЕ используй как единственный аргумент.
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
=== ЛИКВИДНОСТЬ ПОРТФЕЛЯ ===
Статус: ${liquidityContext.summary.status === 'HEALTHY' ? 'Здоровый' : liquidityContext.summary.status === 'WARNING' ? 'ВНИМАНИЕ' : 'КРИТИЧЕСКИЙ'}
Высокая: ${liquidityContext.summary.highLiquidityPct.toFixed(1)}% | Средняя: ${liquidityContext.summary.mediumLiquidityPct.toFixed(1)}% | Низкая: ${liquidityContext.summary.lowLiquidityPct.toFixed(1)}% | Критическая: ${liquidityContext.summary.criticalLiquidityPct.toFixed(1)}% (${liquidityContext.summary.deadAssetsCount} активов)

${liquidityContext.warnings.length > 0 ? 'Предупреждения:\n' + liquidityContext.warnings.map((w: string) => '• ' + w).join('\n') : ''}
${liquidityContext.recommendations.length > 0 ? 'Рекомендации:\n' + liquidityContext.recommendations.map((r: string) => '• ' + r).join('\n') : ''}

${liquidityContext.assets
  .map(
    (asset) => `
--- ${asset.ticker} ---
• Стоимость: ${formatRub(asset.marketValue)} | Оборот: ${asset.dailyTurnover !== null ? formatRub(asset.dailyTurnover) : 'н/д'} | Уровень: ${asset.liquidityLevel}
• Отношение оборот/позиция: ${asset.turnoverToValueRatio.toFixed(3)} | Дней ликвидации: ${asset.liquidationDays ?? 'н/д'}
`,
  )
  .join('\n')}

BUY низколиквидным → наращивать частями. CRITICAL ликвидность ≤ 5% портфеля.
`
      : '') +
    // H: Классы инструментов — запрет упоминать несуществующие
    (assetTickers && assetTickers.length > 0
      ? `=== КЛАССЫ ИНСТРУМЕНТОВ ===
В портфеле есть только: акции (${assetTickers.join(', ')}), облигации, кэш. Не упоминай классы инструментов, которых нет в списке.
`
      : '') +
    `=== ЗАДАЧА ===
Ключевая ставка ЦБ: ${cbrRate}%. На основе переданных данных: проанализируй портфель и верни ответ строго по схеме JSON: сначала portfolioSummary (ПОЛНЫЙ АНАЛИЗ: 5-8 абзацев — структура портфеля, P&L, ликвидность, ключевые риски, макро-контекст, стратегические выводы), затем recommendations (массив рекомендаций по каждому активу). Не добавляй ничего вне JSON.
`;

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
    'КРИТЕРИИ: BUY — дефицит > 5% + ROE > 15% + RSI < 70. ' +
    'AVERAGE — дефицит + цена ниже SMA50 > 10%. ' +
    'HOLD — доля ±3.5 п.п. ИЛИ no-sell ИЛИ данных мало. ' +
    'REDUCE — профицит > 3.5 п.п. EXIT — профицит > 10 п.п. ' +
    'SELL — фундаментальный сбой. AVOID — не по стратегии.\n' +

    'ОБЛИГАЦИИ: STABLE = "вес в диапазоне". Используй bondAnalyses. ' +
    'При INSUFFICIENT_DATA → HOLD. Флоатеры при 14% — привлекательны.\n' +

    'КОНЦЕНТРАЦИЯ: один актив ≤ 20%. При профиците > 20% → REDUCE.\n' +

    'РЕЗЮМЕ: 3-5 конкретных действий.\n'
  );
}
