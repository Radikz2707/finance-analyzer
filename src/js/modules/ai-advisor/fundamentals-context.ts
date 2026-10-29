/**
 * Извлечение фундаментальных данных из research snapshot'ов.
 * Преобразует AssetResearchSnapshot в компактный текстовый контекст
 * для передачи в промпт ИИ-советника.
 */

import type {
  AssetResearchSnapshot,
  ResearchValue,
} from '../research/types.js';

/** Фундаментальные данные одного актива для промпта */
export interface FundamentalsContext {
  ticker: string;
  name: string;
  revenue?: number;
  netIncome?: number;
  ebitda?: number;
  debt?: number;
  pe?: number;
  evEbitda?: number;
  roe?: number;
  revenueGrowth?: number;
  netIncomeGrowth?: number;
  dividendYield?: number;
  freeCashFlow?: number;
}

/**
 * Проверяет, является ли ResearchValue «нет данных».
 */
function isNoData<T>(rv: ResearchValue<T> | null | undefined): boolean {
  return rv === null || rv === undefined || rv.status !== 'VALUE';
}

/**
 * Извлекает числовое значение из ResearchValue.
 * Возвращает undefined если NO_DATA.
 */
function extractValue<T>(rv: ResearchValue<T>): T | undefined {
  return rv.status === 'VALUE' ? rv.value : undefined;
}

/**
 * Извлекает фундаментальные данные из research snapshot'а.
 * Возвращает null, если snapshot отсутствует или нет fundamentals.
 */
export function extractFundamentalsFromSnapshot(
  snapshot: AssetResearchSnapshot | null | undefined,
  ticker: string,
  shortName: string,
): FundamentalsContext | null {
  if (!snapshot?.issuerResearch) {
    return null;
  }

  const ir = snapshot.issuerResearch;

  // Проверяем, есть ли хоть какие-то данные
  const hasAnyData =
    !isNoData(ir.financials?.revenue) ||
    !isNoData(ir.financials?.netIncome) ||
    !isNoData(ir.financials?.ebitda) ||
    !isNoData(ir.financials?.debt) ||
    !isNoData(ir.valuation?.pe) ||
    !isNoData(ir.valuation?.evEbitda) ||
    !isNoData(ir.valuation?.pb) ||
    !isNoData(ir.valuation?.fcfYield) ||
    !isNoData(ir.financials?.roe) ||
    !isNoData(ir.financials?.roic) ||
    !isNoData(ir.earningsTrend?.revenueGrowth) ||
    !isNoData(ir.earningsTrend?.netIncomeGrowth) ||
    !isNoData(ir.dividend?.dividendYield) ||
    !isNoData(ir.financials?.freeCashFlow);

  if (!hasAnyData) {
    return null;
  }

  const ctx: FundamentalsContext = { ticker, name: shortName };

  // Финансовые показатели
  const revenueVal = extractValue(ir.financials?.revenue);
  if (revenueVal !== undefined) ctx.revenue = revenueVal;

  const netIncomeVal = extractValue(ir.financials?.netIncome);
  if (netIncomeVal !== undefined) ctx.netIncome = netIncomeVal;

  const ebitdaVal = extractValue(ir.financials?.ebitda);
  if (ebitdaVal !== undefined) ctx.ebitda = ebitdaVal;

  const debtVal = extractValue(ir.financials?.debt);
  if (debtVal !== undefined) ctx.debt = debtVal;

  const fcfVal = extractValue(ir.financials?.freeCashFlow);
  if (fcfVal !== undefined) ctx.freeCashFlow = fcfVal;

  // Мультипликаторы
  const peVal = extractValue(ir.valuation?.pe);
  if (peVal !== undefined) ctx.pe = peVal;

  const evEbitdaVal = extractValue(ir.valuation?.evEbitda);
  if (evEbitdaVal !== undefined) ctx.evEbitda = evEbitdaVal;

  const roeVal = extractValue(ir.financials?.roe);
  if (roeVal !== undefined) ctx.roe = roeVal;

  // Тренды
  const revGrowthVal = extractValue(ir.earningsTrend?.revenueGrowth);
  if (revGrowthVal !== undefined) ctx.revenueGrowth = revGrowthVal;

  const niGrowthVal = extractValue(ir.earningsTrend?.netIncomeGrowth);
  if (niGrowthVal !== undefined) ctx.netIncomeGrowth = niGrowthVal;

  // Дивиденды
  const divYieldVal = extractValue(ir.dividend?.dividendYield);
  if (divYieldVal !== undefined) ctx.dividendYield = divYieldVal;

  return ctx;
}

/**
 * Форматирует фундаментальные данные одного актива в компактную строку
 * для включения в промпт ИИ.
 *
 * Формат:
 *   [ТИКЕР (Название)]
 *   Выручка: X млрд ₽ | Чистая прибыль: Y млрд ₽ (+Z%)
 *   P/E: X.X | EV/EBITDA: Y.Y | ROE: Z%
 *   Долг: X млрд ₽ | FCF: Y млрд ₽
 */
export function formatFundamentalsForPrompt(
  fundamentals: FundamentalsContext,
): string {
  const lines: string[] = [];
  const { ticker, name } = fundamentals;

  lines.push(`[${ticker} (${name})]`);

  // Финансовые показатели
  const finParts: string[] = [];
  if (fundamentals.revenue !== undefined) {
    finParts.push(`Выручка: ${formatValue(fundamentals.revenue)} ₽`);
  }
  if (fundamentals.netIncome !== undefined) {
    const growthPart = fundamentals.netIncomeGrowth
      ? ` (+${formatPct(fundamentals.netIncomeGrowth)})`
      : '';
    finParts.push(
      `Чистая прибыль: ${formatValue(fundamentals.netIncome)} ₽${growthPart}`,
    );
  }
  if (fundamentals.ebitda !== undefined) {
    finParts.push(`EBITDA: ${formatValue(fundamentals.ebitda)} ₽`);
  }
  if (finParts.length > 0) {
    lines.push(finParts.join(' | '));
  }

  // Мультипликаторы
  const valParts: string[] = [];
  if (fundamentals.pe !== undefined) {
    valParts.push(`P/E: ${fundamentals.pe.toFixed(1)}`);
  }
  if (fundamentals.evEbitda !== undefined) {
    valParts.push(`EV/EBITDA: ${fundamentals.evEbitda.toFixed(1)}`);
  }
  if (fundamentals.roe !== undefined) {
    valParts.push(`ROE: ${fundamentals.roe.toFixed(1)}%`);
  }
  if (valParts.length > 0) {
    lines.push(valParts.join(' | '));
  }

  // Тренды
  const growthParts: string[] = [];
  if (fundamentals.revenueGrowth !== undefined) {
    growthParts.push(`Рост выручки: ${formatPct(fundamentals.revenueGrowth)}`);
  }
  if (fundamentals.netIncomeGrowth !== undefined && fundamentals.netIncome === undefined) {
    growthParts.push(
      `Рост прибыли: ${formatPct(fundamentals.netIncomeGrowth)}`,
    );
  }
  if (growthParts.length > 0) {
    lines.push(growthParts.join(' | '));
  }

  // Долг и денежный поток
  const balParts: string[] = [];
  if (fundamentals.debt !== undefined) {
    balParts.push(`Долг: ${formatValue(fundamentals.debt)} ₽`);
  }
  if (fundamentals.freeCashFlow !== undefined) {
    balParts.push(
      `FCF: ${formatValue(fundamentals.freeCashFlow)} ₽`,
    );
  }
  if (fundamentals.dividendYield !== undefined) {
    balParts.push(
      `Див. доходность: ${formatPct(fundamentals.dividendYield)}`,
    );
  }
  if (balParts.length > 0) {
    lines.push(balParts.join(' | '));
  }

  return lines.join('\n');
}

/**
 * Форматирует значение в млрд/млн с единицами.
 */
function formatValue(value: number): string {
  const absVal = Math.abs(value);
  if (absVal >= 1e12) {
    return (value / 1e12).toFixed(1) + ' трлн';
  }
  if (absVal >= 1e9) {
    return (value / 1e9).toFixed(1) + ' млрд';
  }
  if (absVal >= 1e6) {
    return (value / 1e6).toFixed(1) + ' млн';
  }
  return value.toFixed(0);
}

/**
 * Форматирует процентное значение.
 */
function formatPct(value: number): string {
  return (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
}

/**
 * Формирует блок фундаментальных данных для всех активов портфеля.
 * Возвращает компактную строку для включения в промпт.
 */
export function buildFundamentalsBlock(
  fundamentalsMap: Map<string, FundamentalsContext>,
): string {
  if (fundamentalsMap.size === 0) {
    return '';
  }

  const lines: string[] = ['=== ФУНДАМЕНТАЛЬНЫЕ ДАННЫЕ АКТИВОВ ==='];
  lines.push(
    'Финансовые показатели эмитентов из открытых источников (Finam). ' +
      'Используй эти данные для фундаментального анализа, а не только по цене.\n',
  );

  for (const [, fundamentals] of fundamentalsMap) {
    lines.push(formatFundamentalsForPrompt(fundamentals));
    lines.push('');
  }

  return lines.join('\n');
}
