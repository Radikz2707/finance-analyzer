/**
 * FundamentalsApi — фасад над сервисом фундаментальных данных.
 *
 * Раньше модуль отдавал только цену и капитализацию, а P/E, ROE и
 * дивидендную доходность помечал как «нет данных». Теперь:
 * - MOEX ISS даёт цены, дивидендный календарь и (если доступна) отчётность;
 * - smart-lab.ru даёт мультипликаторы и историю для медиан;
 * - каждое значение несёт источник и дату, а недоступные поля явно
 *   помечаются, а не заполняются догадками.
 */

import {
  buildPortfolioFundamentals,
  collectStockFundamentals,
} from './fundamentals/fundamentals-service.js';
import { getFundamentalsConfig } from './fundamentals/config.js';
import type {
  PortfolioFundamentalsContext,
  StockFundamentals as DetailedStockFundamentals,
} from './fundamentals/types.js';

export type {
  PortfolioFundamentalsContext,
  SourcedValue,
  FundamentalMedians,
} from './fundamentals/types.js';

// ──────────────────────────────────────────────
// 1. Legacy-типы (для обратной совместимости)
// ──────────────────────────────────────────────

/** Упрощённые фундаментальные метрики одной акции (numeric view). */
export interface StockFundamentals {
  ticker: string;
  name: string;
  pe?: number;
  ps?: number;
  pb?: number;
  roe?: number;
  roa?: number;
  debtToEquity?: number;
  profitMargin?: number;
  operatingMargin?: number;
  revenueGrowth?: number;
  earningsGrowth?: number;
  dividendYield?: number;
  marketCap?: number;
  bookValuePerShare?: number;
  eps?: number;
  annualRevenue?: number;
  netIncome?: number;
  totalDebt?: number;
  totalAssets?: number;
  dataSource: string;
  lastUpdated?: string;
  fundamentalHealth?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  summary?: string;
}

// ──────────────────────────────────────────────
// 2. Преобразование нового формата в legacy
// ──────────────────────────────────────────────

function toLegacyStockFundamentals(
  detailed: DetailedStockFundamentals,
): StockFundamentals {
  return {
    ticker: detailed.ticker,
    name: detailed.name,
    pe: detailed.pe.value ?? undefined,
    ps: detailed.ps.value ?? undefined,
    pb: detailed.pb.value ?? undefined,
    roe: detailed.roe.value ?? undefined,
    roa: detailed.roa.value ?? undefined,
    debtToEquity: detailed.debtToEquity.value ?? undefined,
    dividendYield: detailed.dividendYield.value ?? undefined,
    marketCap: detailed.marketCap.value ?? undefined,
    annualRevenue: detailed.revenue.value ?? undefined,
    netIncome: detailed.netIncome.value ?? undefined,
    totalDebt: detailed.debt.value ?? undefined,
    dataSource:
      detailed.sourcesUsed.length > 0
        ? detailed.sourcesUsed.join(' + ')
        : 'недоступно',
    lastUpdated: detailed.price.asOf ?? new Date().toISOString(),
    fundamentalHealth: detailed.fundamentalHealth,
    summary: detailed.summary,
  };
}

// ──────────────────────────────────────────────
// 3. Публичные функции
// ──────────────────────────────────────────────

/**
 * Общий контекст фундаментала в рамках одного прогона.
 *
 * Карточки (AI-промпт) и стратег (дивидендный якорь) должны видеть ОДИН
 * и тот же объект, иначе возможна ситуация «в карточке дивдоходность есть,
 * в якоре — нет данных». Кэш живёт ограниченное время и сбрасывается
 * в начале нового прогона.
 */
let sharedPortfolioFundamentals: {
  key: string;
  promise: Promise<PortfolioFundamentalsContext>;
  createdAt: number;
} | null = null;

const SHARED_FUNDAMENTALS_TTL_MS = 5 * 60 * 1000;

/** Сбросить общий контекст (вызывать в начале нового прогона/в тестах). */
export function resetPortfolioFundamentalsOnce(): void {
  sharedPortfolioFundamentals = null;
}

/**
 * Нормализованный ключ кэша: порядок и регистр тикеров не важны.
 * Вынесен отдельно, чтобы тестировать без сетевых вызовов.
 */
export function buildPortfolioFundamentalsCacheKey(tickers: string[]): string {
  return Array.from(
    new Set(tickers.map((ticker) => ticker.trim().toUpperCase())),
  )
    .sort()
    .join(',');
}

/**
 * Получить фундаментальный контекст один раз на набор тикеров.
 * Параллельные вызовы с тем же набором тикеров получают один promise.
 */
export async function getPortfolioFundamentalsOnce(
  tickers: string[],
  names: Record<string, string>,
): Promise<PortfolioFundamentalsContext> {
  const key = buildPortfolioFundamentalsCacheKey(tickers);

  const now = Date.now();
  if (
    sharedPortfolioFundamentals &&
    sharedPortfolioFundamentals.key === key &&
    now - sharedPortfolioFundamentals.createdAt < SHARED_FUNDAMENTALS_TTL_MS
  ) {
    return sharedPortfolioFundamentals.promise;
  }

  const promise = fetchPortfolioFundamentals(tickers, names);
  sharedPortfolioFundamentals = { key, promise, createdAt: now };

  try {
    return await promise;
  } catch (error) {
    if (sharedPortfolioFundamentals?.promise === promise) {
      sharedPortfolioFundamentals = null;
    }
    throw error;
  }
}

/**
 * Получить фундаментальные данные для всех акций портфеля.
 *
 * @param tickers — тикеры акций (например: ['SBER', 'TATN', 'IRAO'])
 * @param names — мапа тикер → название (из Excel)
 */
export async function fetchPortfolioFundamentals(
  tickers: string[],
  names: Record<string, string>,
): Promise<PortfolioFundamentalsContext> {
  if (tickers.length === 0) {
    return {
      assets: [],
      warnings: [],
      asOf: new Date().toISOString(),
      smartLabEnabled: getFundamentalsConfig().smartLabEnabled,
    };
  }

  console.log(
    `[FundamentalsApi] Загрузка фундаментальных данных для ${tickers.length} акций...`,
  );

  const context = await buildPortfolioFundamentals(tickers, names);

  console.log(
    `[FundamentalsApi] ✅ Загружены данные для ${context.assets.length} акций ` +
      `(источники: ${[...new Set(context.assets.flatMap((asset) => asset.sourcesUsed))].join(', ') || 'нет'})`,
  );
  if (context.warnings.length > 0) {
    console.warn(
      `[FundamentalsApi] Предупреждения: ${context.warnings.join(' | ')}`,
    );
  }

  return context;
}

/**
 * Получить фундаментальные данные для одной акции (legacy numeric view).
 */
export async function fetchStockFundamentals(
  ticker: string,
  name: string,
): Promise<StockFundamentals | null> {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized) return null;

  const detailed = await collectStockFundamentals(normalized, name);
  return toLegacyStockFundamentals(detailed);
}

/**
 * Получить только данные MOEX ISS (без smart-lab.ru).
 * Используется как fallback и для диагностики.
 */
export async function fetchFundamentalsFromMoex(
  tickers: string[],
): Promise<Record<string, Partial<StockFundamentals>>> {
  const result: Record<string, Partial<StockFundamentals>> = {};

  for (const ticker of tickers) {
    const normalized = ticker.trim().toUpperCase();
    if (!normalized) continue;

    const detailed = await collectStockFundamentals(normalized, normalized);
    const legacy = toLegacyStockFundamentals(detailed);

    const moexOnly: Partial<StockFundamentals> = {
      ticker: normalized,
      name: legacy.name,
      dataSource: 'MOEX ISS',
      lastUpdated: legacy.lastUpdated,
      fundamentalHealth: legacy.fundamentalHealth,
      summary: legacy.summary,
    };

    // Оставляем только значения, у которых источник — MOEX ISS.
    if (detailed.pe.source === 'MOEX ISS')
      moexOnly.pe = detailed.pe.value ?? undefined;
    if (detailed.ps.source === 'MOEX ISS')
      moexOnly.ps = detailed.ps.value ?? undefined;
    if (detailed.pb.source === 'MOEX ISS')
      moexOnly.pb = detailed.pb.value ?? undefined;
    if (detailed.roe.source === 'MOEX ISS')
      moexOnly.roe = detailed.roe.value ?? undefined;
    if (detailed.debtToEquity.source === 'MOEX ISS') {
      moexOnly.debtToEquity = detailed.debtToEquity.value ?? undefined;
    }
    if (detailed.dividendYield.source === 'MOEX ISS') {
      moexOnly.dividendYield = detailed.dividendYield.value ?? undefined;
    }
    if (detailed.marketCap.source === 'MOEX ISS') {
      moexOnly.marketCap = detailed.marketCap.value ?? undefined;
    }

    result[normalized] = moexOnly;
  }

  return result;
}

/**
 * Оценка фундаментального здоровья по доступным числовым метрикам.
 * Сохранено для обратной совместимости; в новом сервисе используется
 * более точная оценка с учётом медиан и источников.
 */
export function assessFundamentalHealth(
  fundamentals: Partial<StockFundamentals>,
): {
  health: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  summary: string;
} {
  let score = 0;
  const reasons: string[] = [];

  if (fundamentals.pe !== undefined) {
    if (fundamentals.pe < 10) {
      score += 2;
      reasons.push(`P/E ${fundamentals.pe.toFixed(1)} — ниже 10`);
    } else if (fundamentals.pe < 15) {
      score += 1;
      reasons.push(`P/E ${fundamentals.pe.toFixed(1)} — 10–15`);
    } else if (fundamentals.pe < 25) {
      reasons.push(`P/E ${fundamentals.pe.toFixed(1)} — 15–25`);
    } else {
      score -= 1;
      reasons.push(`P/E ${fundamentals.pe.toFixed(1)} — выше 25`);
    }
  }

  if (fundamentals.roe !== undefined) {
    if (fundamentals.roe > 20) {
      score += 2;
      reasons.push(`ROE ${fundamentals.roe.toFixed(1)}% — выше 20%`);
    } else if (fundamentals.roe > 10) {
      score += 1;
      reasons.push(`ROE ${fundamentals.roe.toFixed(1)}% — 10–20%`);
    } else {
      score -= 1;
      reasons.push(`ROE ${fundamentals.roe.toFixed(1)}% — ниже 10%`);
    }
  }

  if (fundamentals.debtToEquity !== undefined) {
    if (fundamentals.debtToEquity < 0.5) {
      score += 2;
      reasons.push(
        `Долг/Капитал ${fundamentals.debtToEquity.toFixed(2)} — ниже 0,5`,
      );
    } else if (fundamentals.debtToEquity < 1.5) {
      score += 1;
      reasons.push(
        `Долг/Капитал ${fundamentals.debtToEquity.toFixed(2)} — 0,5–1,5`,
      );
    } else {
      score -= 1;
      reasons.push(
        `Долг/Капитал ${fundamentals.debtToEquity.toFixed(2)} — выше 1,5`,
      );
    }
  }

  if (reasons.length === 0) {
    return {
      health: 'NEUTRAL',
      summary:
        'Недостаточно данных для фундаментального вывода: P/E, ROE и Долг/Капитал недоступны.',
    };
  }

  const health = score >= 3 ? 'POSITIVE' : score >= 0 ? 'NEUTRAL' : 'NEGATIVE';
  return { health, summary: reasons.join('; ') + '.' };
}

export default {
  fetchPortfolioFundamentals,
  getPortfolioFundamentalsOnce,
  resetPortfolioFundamentalsOnce,
  buildPortfolioFundamentalsCacheKey,
  fetchStockFundamentals,
  fetchFundamentalsFromMoex,
  assessFundamentalHealth,
};
