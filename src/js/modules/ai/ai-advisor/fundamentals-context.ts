/**
 * Извлечение фундаментальных данных из research snapshot'ов.
 * Преобразует AssetResearchSnapshot в компактный текстовый контекст
 * для передачи в промпт ИИ-советника.
 */

import type { AssetResearchSnapshot } from '../../research/types.js';
import type { ResearchValue } from '../../research/types.js';

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
    ir.financials !== undefined ||
    ir.valuation !== undefined ||
    ir.earningsTrend !== undefined ||
    ir.dividend !== undefined;

  if (!hasAnyData) {
    return null;
  }

  const ctx: FundamentalsContext = { ticker, name: shortName };

  // Финансовые показатели
  if (ir.financials?.revenue && typeof ir.financials.revenue === 'object') {
    const val = (ir.financials.revenue as ResearchValue<number>).value;
    if (typeof val === 'number') ctx.revenue = val;
  }

  if (ir.financials?.netIncome && typeof ir.financials.netIncome === 'object') {
    const val = (ir.financials.netIncome as ResearchValue<number>).value;
    if (typeof val === 'number') ctx.netIncome = val;
  }

  if (ir.financials?.ebitda && typeof ir.financials.ebitda === 'object') {
    const val = (ir.financials.ebitda as ResearchValue<number>).value;
    if (typeof val === 'number') ctx.ebitda = val;
  }

  if (ir.financials?.debt && typeof ir.financials.debt === 'object') {
    const val = (ir.financials.debt as ResearchValue<number>).value;
    if (typeof val === 'number') ctx.debt = val;
  }

  if (ir.financials?.freeCashFlow && typeof ir.financials.freeCashFlow === 'object') {
    const val = (ir.financials.freeCashFlow as ResearchValue<number>).value;
    if (typeof val === 'number') ctx.freeCashFlow = val;
  }

  // Мультипликаторы
  if (ir.valuation?.pe && typeof ir.valuation.pe === 'object') {
    const val = (ir.valuation.pe as ResearchValue<number>).value;
    if (typeof val === 'number') ctx.pe = val;
  }

  if (ir.valuation?.evEbitda && typeof ir.valuation.evEbitda === 'object') {
    const val = (ir.valuation.evEbitda as ResearchValue<number>).value;
    if (typeof val === 'number') ctx.evEbitda = val;
  }

  if (ir.financials?.roe && typeof ir.financials.roe === 'object') {
    const val = (ir.financials.roe as ResearchValue<number>).value;
    if (typeof val === 'number') ctx.roe = val;
  }

  // Тренды
  if (ir.earningsTrend?.revenueGrowth && typeof ir.earningsTrend.revenueGrowth === 'object') {
    const val = (ir.earningsTrend.revenueGrowth as ResearchValue<number>).value;
    if (typeof val === 'number') ctx.revenueGrowth = val;
  }

  if (ir.earningsTrend?.netIncomeGrowth && typeof ir.earningsTrend.netIncomeGrowth === 'object') {
    const val = (ir.earningsTrend.netIncomeGrowth as ResearchValue<number>).value;
    if (typeof val === 'number') ctx.netIncomeGrowth = val;
  }

  // Дивиденды
  if (ir.dividend?.dividendYield && typeof ir.dividend.dividendYield === 'object') {
    const val = (ir.dividend.dividendYield as ResearchValue<number>).value;
    if (typeof val === 'number') ctx.dividendYield = val;
  }

  return ctx;
}
