/**
 * Сервис сбора фундаментальных данных.
 *
 * Роли источников:
 * - MOEX ISS — цены, дивидендный календарь, объёмы, отчётность (если доступна);
 * - smart-lab.ru — мультипликаторы P/E, ROE, долг/капитал, дивдоходность,
 *   история за 5–10 лет и медианы.
 *
 * Правила:
 * - каждое значение несёт источник и дату;
 * - при расхождении источников >20% приоритет у MOEX ISS, расхождение логируется;
 * - при недоступности источника поле помечается «недоступно», а не заполняется
 *   нулём или «похожим на правду» числом.
 */

import { getFundamentalsConfig } from './config.js';
import { getCached, setCached } from './cache.js';
import {
  fetchMoexDividends,
  fetchMoexQuote,
  fetchMoexReports,
  fetchMoexSecurityInfo,
} from './moex-iss-client.js';
import {
  fetchSmartLabDividends,
  fetchSmartLabFinancials,
} from './smart-lab-client.js';
import type {
  FundamentalMedians,
  FundamentalsSource,
  MoexDividendRecord,
  MoexReportRecord,
  PortfolioFundamentalsContext,
  SourcedValue,
  StockFundamentals,
} from './types.js';

const SOURCE_ISS: FundamentalsSource = 'MOEX ISS';
const SOURCE_SMARTLAB: FundamentalsSource = 'smart-lab.ru';

const BILLION = 1_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function formatDate(iso: string | null): string {
  if (!iso) return 'дата не указана';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('ru-RU');
}

/** Русское форматирование числа: 5,13. */
function formatNumber(value: number, digits = 2): string {
  return value.toFixed(digits).replace('.', ',');
}

function unavailableValue<T>(
  note: string,
  status: 'UNAVAILABLE' | 'PARSE_ERROR' = 'UNAVAILABLE',
): SourcedValue<T> {
  return {
    value: null,
    source: null,
    asOf: null,
    status,
    note,
  };
}

function valueFrom<T>(
  value: T,
  source: FundamentalsSource,
  asOf: string,
): SourcedValue<T> {
  return { value, source, asOf, status: 'VALUE' };
}

function relativeDiff(a: number, b: number): number {
  const denominator = Math.max(Math.abs(a), Math.abs(b));
  if (denominator === 0) return 0;
  return Math.abs(a - b) / denominator;
}

interface ChooseMetricParams {
  label: string;
  issValue: number | null;
  issAsOf: string | null;
  smartLabValue: number | null;
  smartLabAsOf: string | null;
  threshold: number;
  conflicts: string[];
  unavailableNote: string;
}

/**
 * Выбрать значение из двух источников.
 * Приоритет — MOEX ISS. Расхождение > threshold фиксируется как конфликт.
 */
function chooseMetric(params: ChooseMetricParams): SourcedValue {
  const {
    label,
    issValue,
    issAsOf,
    smartLabValue,
    smartLabAsOf,
    threshold,
    conflicts,
    unavailableNote,
  } = params;

  const hasIss = issValue !== null && Number.isFinite(issValue);
  const hasSmartLab = smartLabValue !== null && Number.isFinite(smartLabValue);

  if (!hasIss && !hasSmartLab) {
    return unavailableValue(unavailableNote);
  }

  if (hasIss && !hasSmartLab) {
    return valueFrom(issValue as number, SOURCE_ISS, issAsOf ?? nowIso());
  }

  if (!hasIss && hasSmartLab) {
    return valueFrom(
      smartLabValue as number,
      SOURCE_SMARTLAB,
      smartLabAsOf ?? nowIso(),
    );
  }

  if (
    hasIss &&
    hasSmartLab &&
    relativeDiff(issValue, smartLabValue) > threshold
  ) {
    const message =
      `${label}: MOEX ISS ${formatNumber(issValue)} vs ` +
      `smart-lab.ru ${formatNumber(smartLabValue)} — расхождение > ${Math.round(
        threshold * 100,
      )}%, приоритет у MOEX ISS`;
    conflicts.push(message);
    console.warn(`[Fundamentals] ${message}`);
    return {
      value: issValue,
      source: SOURCE_ISS,
      asOf: issAsOf ?? nowIso(),
      status: 'CONFLICT',
      note: `расхождение с ${SOURCE_SMARTLAB} > ${Math.round(threshold * 100)}%`,
      conflictValue: smartLabValue,
      conflictSource: SOURCE_SMARTLAB,
    };
  }

  return valueFrom(issValue as number, SOURCE_ISS, issAsOf ?? nowIso());
}

/** Последний отчёт по дате окончания периода. */
function latestReport(
  records: MoexReportRecord[] | null,
): MoexReportRecord | null {
  if (!records || records.length === 0) return null;
  const sorted = [...records].sort((a, b) => {
    const aKey = a.endDate ?? `${a.periodYear ?? 0}-${a.periodQuarter ?? 0}`;
    const bKey = b.endDate ?? `${b.periodYear ?? 0}-${b.periodQuarter ?? 0}`;
    return aKey.localeCompare(bKey);
  });
  return sorted[sorted.length - 1] ?? null;
}

function sane(value: number | null, min: number, max: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value <= min || value > max) return null;
  return value;
}

/** Сумма дивидендов за последние 12 месяцев. */
function trailingDividendSum(records: MoexDividendRecord[] | null): {
  sum: number | null;
  asOf: string | null;
} {
  if (!records || records.length === 0) return { sum: null, asOf: null };
  const today = new Date();
  const cutoff = new Date(today.getTime() - 365 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const todayKey = today.toISOString().slice(0, 10);
  const values = records
    .filter(
      (record) =>
        record.registryDate !== null &&
        record.registryDate >= cutoff &&
        record.registryDate <= todayKey &&
        record.value !== null &&
        record.value > 0,
    )
    .map((record) => record.value as number);
  if (values.length === 0) return { sum: null, asOf: null };
  return { sum: values.reduce((acc, value) => acc + value, 0), asOf: nowIso() };
}

function nextDividendDate(records: MoexDividendRecord[] | null): string | null {
  if (!records || records.length === 0) return null;
  const todayKey = new Date().toISOString().slice(0, 10);
  const future = records
    .map((record) => record.registryDate)
    .filter(
      (date): date is string => typeof date === 'string' && date > todayKey,
    )
    .sort();
  return future[0] ?? null;
}

function buildMedians(
  financials: Awaited<ReturnType<typeof fetchSmartLabFinancials>>,
  asOf: string,
): FundamentalMedians | null {
  if (!financials || !financials.parseOk) return null;

  const debtSeries = financials.series['debt'] ?? [];
  const equitySeries =
    financials.series['book_value'] ?? financials.series['net_assets'] ?? [];
  const debtToEquitySeries: Array<number | null> = debtSeries.map(
    (debt, index) => {
      const equity = equitySeries[index] ?? null;
      if (debt === null || equity === null || equity === 0) return null;
      return debt / equity;
    },
  );

  const medianOf = (values: Array<number | null>): number | null => {
    const numbers = values
      .slice(-5)
      .filter(
        (value): value is number =>
          typeof value === 'number' && Number.isFinite(value),
      );
    if (numbers.length < 3) return null;
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle] ?? null;
    const left = sorted[middle - 1];
    const right = sorted[middle];
    return left !== undefined && right !== undefined
      ? (left + right) / 2
      : null;
  };

  const years = Math.min(5, financials.years.length);
  return {
    pe5y: medianOf(financials.series['p_e'] ?? []),
    roe5y: medianOf(financials.series['roe'] ?? []),
    dividendYield5y: medianOf(financials.series['div_yield'] ?? []),
    debtToEquity5y: medianOf(debtToEquitySeries),
    years,
    source: SOURCE_SMARTLAB,
    asOf,
  };
}

function assessHealth(fundamentals: {
  pe: SourcedValue;
  roe: SourcedValue;
  debtToEquity: SourcedValue;
  dividendYield: SourcedValue;
}): {
  health: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  score: number;
  factors: number;
} {
  let score = 0;
  let factors = 0;

  if (fundamentals.pe.value !== null) {
    factors += 1;
    const pe = fundamentals.pe.value;
    if (pe < 10) score += 2;
    else if (pe < 15) score += 1;
    else if (pe < 25) score += 0;
    else score -= 1;
  }

  if (fundamentals.roe.value !== null) {
    factors += 1;
    const roe = fundamentals.roe.value;
    if (roe > 20) score += 2;
    else if (roe > 10) score += 1;
    else score -= 1;
  }

  if (fundamentals.debtToEquity.value !== null) {
    factors += 1;
    const debt = fundamentals.debtToEquity.value;
    if (debt < 0.5) score += 2;
    else if (debt < 1.5) score += 1;
    else score -= 1;
  }

  if (fundamentals.dividendYield.value !== null) {
    factors += 1;
    if (fundamentals.dividendYield.value > 5) score += 1;
  }

  const health = score >= 3 ? 'POSITIVE' : score >= 0 ? 'NEUTRAL' : 'NEGATIVE';
  return { health, score, factors };
}

interface MetricSummaryInput {
  label: string;
  metric: SourcedValue;
  median?: number | null;
  medianSource?: FundamentalsSource | null;
  medianAsOf?: string | null;
  digits?: number;
  suffix?: string;
}

function describeMetric(input: MetricSummaryInput): string {
  const {
    label,
    metric,
    median,
    medianSource,
    medianAsOf,
    digits = 2,
    suffix = '',
  } = input;
  if (metric.value === null) {
    return `${label}: недоступно (${metric.note ?? 'источник не отвечает'})`;
  }
  const source = metric.source ?? 'источник не указан';
  const asOf = formatDate(metric.asOf);
  let text = `${label} ${formatNumber(metric.value, digits)}${suffix} (${source}, ${asOf})`;
  if (metric.status === 'CONFLICT' && metric.conflictValue != null) {
    text +=
      ` ⚠️ расхождение: ${metric.conflictSource ?? 'второй источник'} ` +
      `${formatNumber(metric.conflictValue, digits)}${suffix}`;
  }
  if (median !== null && median !== undefined) {
    text +=
      `, медиана 5 лет ${formatNumber(median, digits)}${suffix}` +
      (medianSource
        ? ` (${medianSource}, ${formatDate(medianAsOf ?? null)})`
        : '');
  }
  return text;
}

function buildSummary(
  metrics: {
    pe: SourcedValue;
    roe: SourcedValue;
    debtToEquity: SourcedValue;
    dividendYield: SourcedValue;
  },
  medians: FundamentalMedians | null,
  health: { score: number; factors: number },
): string {
  const lines = [
    describeMetric({
      label: 'P/E',
      metric: metrics.pe,
      median: medians?.pe5y,
      medianSource: medians?.source,
      medianAsOf: medians?.asOf,
    }),
    describeMetric({
      label: 'ROE',
      metric: metrics.roe,
      median: medians?.roe5y,
      medianSource: medians?.source,
      medianAsOf: medians?.asOf,
      digits: 1,
      suffix: '%',
    }),
    describeMetric({
      label: 'Долг/Капитал',
      metric: metrics.debtToEquity,
      median: medians?.debtToEquity5y,
      medianSource: medians?.source,
      medianAsOf: medians?.asOf,
    }),
    describeMetric({
      label: 'Дивдоходность',
      metric: metrics.dividendYield,
      median: medians?.dividendYield5y,
      medianSource: medians?.source,
      medianAsOf: medians?.asOf,
      digits: 1,
      suffix: '%',
    }),
  ];

  if (health.factors === 0) {
    lines.push('Оценка: недостаточно данных для фундаментального вывода.');
  } else {
    lines.push(
      `Оценка: учтено показателей — ${health.factors}, балл ${health.score}.`,
    );
  }
  return lines.join('; ');
}

/**
 * Собрать фундаментальные данные по одной акции.
 *
 * Результат кэшируется на TTL (по умолчанию 24 ч), поэтому smart-lab.ru
 * не опрашивается чаще одного раза в сутки на тикер.
 */
export async function collectStockFundamentals(
  ticker: string,
  name: string,
): Promise<StockFundamentals> {
  const config = getFundamentalsConfig();
  const normalized = ticker.trim().toUpperCase();
  const cacheKey = `fundamentals:v2:${normalized}:sl=${config.smartLabEnabled ? 1 : 0}`;

  const cached = await getCached<StockFundamentals>(cacheKey);
  if (cached) return cached;

  const [
    securityInfo,
    quote,
    moexDividends,
    moexReports,
    smartLabFinancials,
    smartLabDividends,
  ] = await Promise.all([
    fetchMoexSecurityInfo(normalized),
    fetchMoexQuote(normalized),
    fetchMoexDividends(normalized),
    fetchMoexReports(normalized),
    config.smartLabEnabled
      ? fetchSmartLabFinancials(normalized)
      : Promise.resolve(null),
    config.smartLabEnabled
      ? fetchSmartLabDividends(normalized)
      : Promise.resolve(null),
  ]);

  const issAsOf = quote?.asOf ?? nowIso();
  const smartLabAsOf =
    smartLabFinancials?.asOf ?? smartLabDividends?.asOf ?? nowIso();
  const conflicts: string[] = [];
  const unavailable: string[] = [];
  const sourcesUsed = new Set<FundamentalsSource>();

  // ─── Цена и капитализация ───
  const priceValue = quote?.price ?? null;
  const price: SourcedValue =
    priceValue !== null
      ? valueFrom(priceValue, SOURCE_ISS, issAsOf)
      : unavailableValue('MOEX ISS: котировка недоступна');
  if (priceValue !== null) sourcesUsed.add(SOURCE_ISS);

  const smartLabMarketCap =
    smartLabFinancials?.current['market_cap'] != null
      ? smartLabFinancials.current['market_cap'] * BILLION
      : null;
  const marketCapValue =
    quote?.marketCap ??
    (quote && securityInfo?.issueSize
      ? quote.price * securityInfo.issueSize
      : null) ??
    smartLabMarketCap;
  const marketCap: SourcedValue =
    marketCapValue !== null && marketCapValue > 0
      ? valueFrom(
          marketCapValue,
          quote?.marketCap != null || securityInfo?.issueSize != null
            ? SOURCE_ISS
            : SOURCE_SMARTLAB,
          quote?.marketCap != null || securityInfo?.issueSize != null
            ? issAsOf
            : smartLabAsOf,
        )
      : unavailableValue('капитализация недоступна');

  // ─── Отчётность MOEX ISS (если endpoint отдал финансовые поля) ───
  const report = latestReport(moexReports);
  const reportNetIncome = report?.netIncome ?? null;
  const reportRevenue = report?.revenue ?? null;
  const reportEquity = report?.equity ?? null;
  const reportDebt = report?.debt ?? null;
  const reportAsOf = nowIso();

  const peIss = sane(
    marketCapValue !== null && reportNetIncome !== null && reportNetIncome !== 0
      ? marketCapValue / reportNetIncome
      : null,
    0.1,
    200,
  );
  const roeIss = sane(
    reportNetIncome !== null && reportEquity !== null && reportEquity !== 0
      ? (reportNetIncome / reportEquity) * 100
      : null,
    -200,
    200,
  );
  const debtToEquityIss = sane(
    reportDebt !== null && reportEquity !== null && reportEquity !== 0
      ? reportDebt / reportEquity
      : null,
    0,
    50,
  );
  const psIss = sane(
    marketCapValue !== null && reportRevenue !== null && reportRevenue !== 0
      ? marketCapValue / reportRevenue
      : null,
    0.01,
    100,
  );
  const pbIss = sane(
    marketCapValue !== null && reportEquity !== null && reportEquity !== 0
      ? marketCapValue / reportEquity
      : null,
    0.01,
    100,
  );

  // ─── Дивиденды MOEX ISS ───
  const trailing = trailingDividendSum(moexDividends);
  const dividendPerShareIss = trailing.sum;
  const dividendYieldIss = sane(
    trailing.sum !== null && priceValue !== null && priceValue > 0
      ? (trailing.sum / priceValue) * 100
      : null,
    0,
    100,
  );
  const nextDividendDateIss = nextDividendDate(moexDividends);

  // ─── smart-lab.ru ───
  const slCurrent = smartLabFinancials?.current ?? {};
  const slDividendYield =
    smartLabDividends?.currentYield ??
    (slCurrent['div_yield'] != null ? slCurrent['div_yield'] : null);
  const slDividendPerShare =
    smartLabDividends?.annualDividend ??
    (slCurrent['dividend'] != null ? slCurrent['dividend'] : null);
  const slNextDividendDate = smartLabDividends?.nextRegistryDate ?? null;

  const slPe = slCurrent['p_e'] ?? null;
  const slRoe = slCurrent['roe'] ?? null;
  const slRoa = slCurrent['roa'] ?? null;
  const slPs = slCurrent['p_s'] ?? null;
  const slPb = slCurrent['p_bv'] ?? null;
  const slEquityBillions =
    slCurrent['book_value'] ?? slCurrent['net_assets'] ?? null;
  const slDebtBillions = slCurrent['debt'] ?? null;
  const slDebtToEquity =
    slDebtBillions !== null &&
    slEquityBillions !== null &&
    slEquityBillions !== 0
      ? slDebtBillions / slEquityBillions
      : null;

  const unavailableNote = !config.smartLabEnabled
    ? 'smart-lab.ru отключён настройкой FUNDAMENTALS_SMARTLAB_ENABLED=false'
    : smartLabFinancials === null
      ? 'smart-lab.ru не отвечает'
      : smartLabFinancials.parseOk
        ? 'smart-lab.ru: показатель отсутствует на странице'
        : `smart-lab.ru: ${smartLabFinancials.parseError ?? 'структура страницы не распознана'}`;

  const pe = chooseMetric({
    label: 'P/E',
    issValue: peIss,
    issAsOf: reportAsOf,
    smartLabValue: slPe,
    smartLabAsOf,
    threshold: config.conflictThreshold,
    conflicts,
    unavailableNote,
  });
  const roe = chooseMetric({
    label: 'ROE',
    issValue: roeIss,
    issAsOf: reportAsOf,
    smartLabValue: slRoe,
    smartLabAsOf,
    threshold: config.conflictThreshold,
    conflicts,
    unavailableNote,
  });
  const debtToEquity = chooseMetric({
    label: 'Долг/Капитал',
    issValue: debtToEquityIss,
    issAsOf: reportAsOf,
    smartLabValue: slDebtToEquity,
    smartLabAsOf,
    threshold: config.conflictThreshold,
    conflicts,
    unavailableNote,
  });
  const dividendYield = chooseMetric({
    label: 'Дивдоходность',
    issValue: dividendYieldIss,
    issAsOf: trailing.asOf,
    smartLabValue: slDividendYield,
    smartLabAsOf,
    threshold: config.conflictThreshold,
    conflicts,
    unavailableNote,
  });
  const ps = chooseMetric({
    label: 'P/S',
    issValue: psIss,
    issAsOf: reportAsOf,
    smartLabValue: slPs,
    smartLabAsOf,
    threshold: config.conflictThreshold,
    conflicts,
    unavailableNote,
  });
  const pb = chooseMetric({
    label: 'P/B',
    issValue: pbIss,
    issAsOf: reportAsOf,
    smartLabValue: slPb,
    smartLabAsOf,
    threshold: config.conflictThreshold,
    conflicts,
    unavailableNote,
  });

  const roa: SourcedValue =
    slRoa !== null
      ? valueFrom(slRoa, SOURCE_SMARTLAB, smartLabAsOf)
      : unavailableValue(unavailableNote);

  const dividendPerShare = chooseMetric({
    label: 'Дивиденд на акцию',
    issValue: dividendPerShareIss,
    issAsOf: trailing.asOf,
    smartLabValue: slDividendPerShare,
    smartLabAsOf,
    threshold: config.conflictThreshold,
    conflicts,
    unavailableNote,
  });

  const nextDividendDateValue: SourcedValue<string> =
    nextDividendDateIss !== null
      ? valueFrom(nextDividendDateIss, SOURCE_ISS, issAsOf)
      : slNextDividendDate !== null
        ? valueFrom(slNextDividendDate, SOURCE_SMARTLAB, smartLabAsOf)
        : unavailableValue(
            config.smartLabEnabled
              ? 'дата следующей отсечки не найдена в источниках'
              : 'smart-lab.ru отключён, MOEX ISS не отдал дивидендный календарь',
          );

  const revenueValue =
    reportRevenue !== null
      ? reportRevenue
      : slCurrent['revenue'] != null
        ? slCurrent['revenue'] * BILLION
        : null;
  const netIncomeValue =
    reportNetIncome !== null
      ? reportNetIncome
      : slCurrent['net_income'] != null
        ? slCurrent['net_income'] * BILLION
        : null;
  const equityValue =
    reportEquity !== null
      ? reportEquity
      : slEquityBillions !== null
        ? slEquityBillions * BILLION
        : null;
  const debtValue =
    reportDebt !== null
      ? reportDebt
      : slDebtBillions !== null
        ? slDebtBillions * BILLION
        : null;

  const makeAbsolute = (
    value: number | null,
    source: FundamentalsSource,
    asOf: string,
  ): SourcedValue => {
    if (value === null || !Number.isFinite(value)) {
      return unavailableValue(unavailableNote);
    }
    sourcesUsed.add(source);
    return valueFrom(value, source, asOf);
  };

  const revenue = makeAbsolute(
    revenueValue,
    reportRevenue !== null ? SOURCE_ISS : SOURCE_SMARTLAB,
    reportRevenue !== null ? reportAsOf : smartLabAsOf,
  );
  const netIncome = makeAbsolute(
    netIncomeValue,
    reportNetIncome !== null ? SOURCE_ISS : SOURCE_SMARTLAB,
    reportNetIncome !== null ? reportAsOf : smartLabAsOf,
  );
  const equity = makeAbsolute(
    equityValue,
    reportEquity !== null ? SOURCE_ISS : SOURCE_SMARTLAB,
    reportEquity !== null ? reportAsOf : smartLabAsOf,
  );
  const debt = makeAbsolute(
    debtValue,
    reportDebt !== null ? SOURCE_ISS : SOURCE_SMARTLAB,
    reportDebt !== null ? reportAsOf : smartLabAsOf,
  );

  for (const metric of [pe, roe, debtToEquity, dividendYield, ps, pb, roa]) {
    if (metric.source) sourcesUsed.add(metric.source);
  }
  if (nextDividendDateValue.source)
    sourcesUsed.add(nextDividendDateValue.source);

  const medians = buildMedians(smartLabFinancials, smartLabAsOf);
  if (medians) sourcesUsed.add(SOURCE_SMARTLAB);

  const health = assessHealth({ pe, roe, debtToEquity, dividendYield });

  const summary = buildSummary(
    { pe, roe, debtToEquity, dividendYield },
    medians,
    health,
  );

  const metricLabels: Array<[string, SourcedValue]> = [
    ['P/E', pe],
    ['ROE', roe],
    ['Долг/Капитал', debtToEquity],
    ['Дивдоходность', dividendYield],
    ['P/S', ps],
    ['P/B', pb],
  ];
  for (const [label, metric] of metricLabels) {
    if (metric.value === null) {
      unavailable.push(`${label} — ${metric.note ?? 'недоступно'}`);
    }
  }

  if (config.smartLabEnabled && !smartLabFinancials) {
    unavailable.push(
      'smart-lab.ru — источник не отвечает (использованы только данные MOEX ISS)',
    );
  } else if (smartLabFinancials && !smartLabFinancials.parseOk) {
    unavailable.push(
      `smart-lab.ru — структура страницы не распознана: ${smartLabFinancials.parseError ?? 'нет данных'}`,
    );
  }
  if (!moexReports) {
    unavailable.push(
      'MOEX ISS — отчётность недоступна (P/E, ROE, долг/капитал рассчитаны по smart-lab.ru)',
    );
  }
  if (!moexDividends) {
    unavailable.push(
      'MOEX ISS — дивидендный endpoint недоступен (дивиденды взяты из smart-lab.ru)',
    );
  }

  const result: StockFundamentals = {
    ticker: normalized,
    name: name || securityInfo?.shortName || normalized,
    price,
    marketCap,
    pe,
    ps,
    pb,
    roe,
    roa,
    debtToEquity,
    dividendYield,
    dividendPerShare,
    nextDividendDate: nextDividendDateValue,
    revenue,
    netIncome,
    equity,
    debt,
    medians,
    fundamentalHealth: health.health,
    summary,
    unavailable,
    conflicts,
    sourcesUsed: [...sourcesUsed],
  };

  // Успешный сбор кэшируем на TTL (по умолчанию сутки). Если smart-lab
  // не ответил/сломался — короткий TTL, чтобы повторить позже, а не
  // показывать «недоступно» целые сутки.
  const smartLabOk =
    !config.smartLabEnabled || (smartLabFinancials?.parseOk ?? false);
  const ttl = smartLabOk
    ? config.cacheTtlMs
    : Math.min(60 * 60 * 1000, config.cacheTtlMs);
  await setCached(cacheKey, result, ttl);
  return result;
}

/**
 * Собрать фундаментальные данные по портфелю.
 */
export async function buildPortfolioFundamentals(
  tickers: string[],
  names: Record<string, string>,
): Promise<PortfolioFundamentalsContext> {
  const config = getFundamentalsConfig();
  const normalized = Array.from(
    new Set(
      tickers
        .map((ticker) => ticker.trim().toUpperCase())
        .filter((ticker) => ticker.length > 0),
    ),
  );

  const assets: StockFundamentals[] = [];
  for (const ticker of normalized) {
    assets.push(
      await collectStockFundamentals(ticker, names[ticker] ?? ticker),
    );
  }

  const warnings: string[] = [];
  if (!config.smartLabEnabled) {
    warnings.push(
      'smart-lab.ru отключён настройкой FUNDAMENTALS_SMARTLAB_ENABLED=false: ' +
        'мультипликаторы недоступны, используются только данные MOEX ISS.',
    );
  } else {
    const noSmartLab = assets.filter(
      (asset) => !asset.sourcesUsed.includes(SOURCE_SMARTLAB),
    );
    if (noSmartLab.length > 0) {
      warnings.push(
        `smart-lab.ru не дал данных по ${noSmartLab.length} тикер(ам): ` +
          `${noSmartLab.map((asset) => asset.ticker).join(', ')}. ` +
          'Недостающие поля помечены как недоступные.',
      );
    }
    for (const asset of assets) {
      if (
        asset.unavailable.some((note) =>
          note.includes('структура страницы не распознана'),
        )
      ) {
        warnings.push(
          `${asset.ticker}: структура smart-lab.ru изменилась — значения не распознаны, ` +
            'нули не подставлялись.',
        );
      }
    }
  }

  return {
    assets,
    warnings,
    asOf: nowIso(),
    smartLabEnabled: config.smartLabEnabled,
  };
}
