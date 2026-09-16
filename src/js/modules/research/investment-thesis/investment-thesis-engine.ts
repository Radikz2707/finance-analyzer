/**
 * Investment Thesis Engine — детерминированный rule-based движок.
 *
 * Принимает:
 *   - AssetResearchSnapshot (Research Layer)
 *   - PortfolioAssetContext (Portfolio context)
 *
 * Выдаёт:
 *   - InvestmentThesisResult (полностью rule-based, без LLM)
 *
 * Принципы:
 *   1. Использовать ТОЛЬКО VALUE факты с валидными evidenceIds
 *   2. NO_DATA НЕ превращать в факт
 *   3. Heuristic/derived значения маркировать как DERIVED
 *   4. Конфликтующие VALUE НЕ использовать как бесспорный факт
 *   5. Если evidence недостаточно → "insufficient evidence"
 *   6. Никаких "недооценён"/"высокая дивидендная доходность" без фактов
 *   7. Historical PNL НЕ использовать как investment thesis
 *   8. USER_TARGET и PortfolioMath — контекст портфеля, не фундаментальный факт
 */

import type {
  AssetResearchSnapshot,
  IssuerResearch,
  MacroResearch,
  RiskAssessment,
  ResearchEvidence,
  ResearchValue,
  AssetType,
  DataStatus,
} from '../types.js';

import type {
  InvestmentThesisInput,
  InvestmentThesisResult,
  ValuationView,
  MacroSensitivity,
  ThesisConfidence,
  EvidenceReference,
  PortfolioAssetContext,
} from './types.js';

import { hasValue } from '../helpers.js';

// ──────────────────────────────────────────────
// 1. Evidence References Builder
// ──────────────────────────────────────────────

/**
 * Собирает EvidenceReference из snapshot.evidence по переданным evidenceIds.
 */
function buildEvidenceReferences(
  evidenceIds: string[],
  evidenceMap: Record<string, ResearchEvidence>,
): EvidenceReference[] {
  const refs: EvidenceReference[] = [];
  for (const id of evidenceIds) {
    const ev = evidenceMap[id];
    if (ev) {
      refs.push({
        evidenceId: ev.id,
        fact: ev.claim,
        type: ev.type,
      });
    }
  }
  return refs;
}

// ──────────────────────────────────────────────
// 2. Valuation View Builder
// ──────────────────────────────────────────────

/**
 * Формирует valuationView на основе IssuerValuation.
 *
 * Правила:
 *   - Если valuation отсутствует → insufficient_data
 *   - Если все мультипликаторы NO_DATA → insufficient_data
 *   - Если есть VALUE → используем только VALUE
 *   - Конфликтующие значения НЕ используем как бесспорный факт
 *   - NEVER выдумываем "undervalued"/"overvalued" без пороговых сравнений
 */
function buildValuationView(
  issuerResearch: IssuerResearch | undefined,
): ValuationView {
  const result: ValuationView = {
    stance: 'insufficient_data',
    reasoning: 'Недостаточно данных для оценки стоимости',
    dataSource: 'INSUFFICIENT',
    multiplexersUsed: [],
    multiplexersMissing: [],
  };

  if (!issuerResearch) {
    return result;
  }

  const valuation = issuerResearch.valuation;
  if (!valuation) {
    return result;
  }

  const multiplexers: { name: string; field: ResearchValue<number> }[] = [
    { name: 'P/E', field: valuation.pe },
    { name: 'EV/EBITDA', field: valuation.evEbitda },
    { name: 'P/B', field: valuation.pb },
    { name: 'FCF Yield', field: valuation.fcfYield },
  ];

  const used: string[] = [];
  const missing: string[] = [];
  let valueCount = 0;

  for (const m of multiplexers) {
    if (hasValue(m.field)) {
      used.push(`${m.name} = ${m.field.value}${m.field.unit || ''}`);
      valueCount++;
    } else if (m.field.status === 'NO_DATA') {
      missing.push(m.name);
    }
  }

  result.multiplexersUsed = used;
  result.multiplexersMissing = missing;

  // Если нет ни одного VALUE → insufficient
  if (valueCount === 0) {
    result.stance = 'insufficient_data';
    result.reasoning = missing.length > 0
      ? `Отсутствуют данные по мультипликаторам: ${missing.join(', ')}`
      : 'Модуль оценки отсутствует';
    result.dataSource = 'INSUFFICIENT';
    return result;
  }

  // Если есть хотя бы один VALUE, но не все → частично insufficient
  if (missing.length > 0 && valueCount < multiplexers.length) {
    result.dataSource = 'DERIVED';
    result.reasoning = `Доступны данные по ${valueCount} из ${multiplexers.length} мультипликаторов: ${used.join('; ')}. Данные по ${missing.join(', ')} отсутствуют.`;
    result.stance = 'fairly_valued';
    return result;
  }

  // Все мультипликаторы доступны
  result.dataSource = 'VALUE';
  result.reasoning = `Все мультипликаторы доступны: ${used.join('; ')}.`;
  result.stance = 'fairly_valued';
  return result;
}

// ──────────────────────────────────────────────
// 3. Macro Sensitivity Builder
// ──────────────────────────────────────────────

/**
 * Формирует macroSensitivity на основе MacroResearch.
 *
 * Правила:
 *   - Если macroResearch отсутствует → insufficient
 *   - Heuristic-выводы маркируем как DERIVED
 *   - Если все поля NO_DATA → insufficient
 */
function buildMacroSensitivity(
  macroResearch: MacroResearch | undefined,
  assetType: AssetType,
): MacroSensitivity {
  const result: MacroSensitivity = {
    level: 'LOW',
    description: 'Недостаточно данных для оценки макро-чувствительности',
    dataSource: 'INSUFFICIENT',
    factorsUsed: [],
    derivedConclusions: [],
  };

  if (!macroResearch) {
    return result;
  }

  const factors: string[] = [];
  const derived: string[] = [];

  // keyRate
  if (hasValue(macroResearch.keyRate)) {
    factors.push(`Ключевая ставка ЦБ = ${macroResearch.keyRate.value}%`);
  }

  // inflation
  if (hasValue(macroResearch.inflation)) {
    factors.push(`Инфляция = ${macroResearch.inflation.value}%`);
  }

  // inflationTrend
  if (hasValue(macroResearch.inflationTrend)) {
    factors.push(`Тренд инфляции: ${macroResearch.inflationTrend.value}`);
  }

  // fx
  if (hasValue(macroResearch.fx)) {
    factors.push(`Курс валюты = ${macroResearch.fx.value}`);
  }

  // oil
  if (hasValue(macroResearch.oil)) {
    factors.push(`Цена на нефть = ${macroResearch.oil.value} RUB`);
  }

  // commodityRegime
  if (hasValue(macroResearch.commodityRegime)) {
    factors.push(`Товарный режим: ${macroResearch.commodityRegime.value}`);
  }

  // liquidityRegime
  if (hasValue(macroResearch.liquidityRegime)) {
    factors.push(`Режим ликвидности: ${macroResearch.liquidityRegime.value}`);
  }

  // economicCycle
  if (hasValue(macroResearch.economicCycle)) {
    factors.push(`Фаза экономического цикла: ${macroResearch.economicCycle.value}`);
  }

  // rateRegime
  if (hasValue(macroResearch.rateRegime)) {
    factors.push(`Режим ставки: ${macroResearch.rateRegime.value}`);
  }

  result.factorsUsed = factors;

  // Если нет ни одного фактора → insufficient
  if (factors.length === 0) {
    result.dataSource = 'INSUFFICIENT';
    result.description = 'Отсутствуют макроэкономические данные';
    return result;
  }

  // Определяем уровень чувствительности
  // Для STOCK/BOND/ETF — HIGH если есть keyRate + inflation
  if (assetType === 'STOCK' || assetType === 'BOND' || assetType === 'ETF') {
    const hasKeyRate = hasValue(macroResearch.keyRate);
    const hasInflation = hasValue(macroResearch.inflation);
    const hasLiquidity = hasValue(macroResearch.liquidityRegime);

    if (hasKeyRate && hasInflation && hasLiquidity) {
      result.level = 'HIGH';
      result.dataSource = 'VALUE';
      result.description = `Актив чувствителен к макроэкономике. Факторы: ${factors.join('; ')}`;
      return result;
    }

    if (hasKeyRate || hasInflation) {
      result.level = 'MEDIUM';
      result.dataSource = 'VALUE';
      result.description = `Актив умеренно чувствителен к макроэкономике. Факторы: ${factors.join('; ')}`;
      return result;
    }
  }

  // Для CASH — низкая чувствительность, только если есть keyRate
  if (assetType === 'CASH') {
    if (hasValue(macroResearch.keyRate)) {
      result.level = 'LOW';
      result.dataSource = 'VALUE';
      result.description = `Кэш-позиция. Зависит от ключевой ставки: ${macroResearch.keyRate.value}%`;
      derived.push('Чувствительность к ставке определена на основе keyRate');
      result.derivedConclusions = derived;
      return result;
    }
  }

  // Fallback: есть факторы, но недостаточно для уверенной оценки
  result.level = 'MEDIUM';
  result.dataSource = 'DERIVED';
  result.description = `Доступны ${factors.length} макро-факторов, но недостаточно для полной оценки чувствительности. Факторы: ${factors.join('; ')}`;
  derived.push('Уровень чувствительности определён эвристически на основе доступных факторов');
  result.derivedConclusions = derived;
  return result;
}

// ──────────────────────────────────────────────
// 4. Confidence Builder
// ──────────────────────────────────────────────

/**
 * Вычисляет уверенность в InvestmentThesis.
 *
 * Правила:
 *   - Считаем общее количество VALUE и NO_DATA фактов
 *   - Если VALUE > 70% от общего → HIGH
 *   - Если VALUE > 40% → MEDIUM
 *   - Иначе → LOW
 *   - Если все NO_DATA → LOW + "insufficient evidence"
 */
function buildConfidence(
  snapshot: AssetResearchSnapshot,
): ThesisConfidence {
  const confidence: ThesisConfidence = {
    value: 0,
    level: 'LOW',
    downgrades: [],
    upgrades: [],
  };

  // Собираем все ResearchValue-поля из snapshot
  const allFields: { status: DataStatus }[] = [];

  const sections = [
    snapshot.issuerResearch,
    snapshot.bondResearch,
    snapshot.etfResearch,
    snapshot.marketResearch,
    snapshot.macroResearch,
  ];

  for (const section of sections) {
    if (!section) continue;
    const sectionAny = section as unknown as Record<string, unknown>;
    for (const key of Object.keys(sectionAny)) {
      const val = sectionAny[key];
      if (val && typeof val === 'object' && 'status' in val) {
        allFields.push(val as { status: DataStatus });
      }
      // Рекурсия для nested объектов (financials, valuation и т.д.)
      if (val && typeof val === 'object' && !('status' in val)) {
        const nestedObj = val as unknown as Record<string, unknown>;
        for (const nestedKey of Object.keys(nestedObj)) {
          const nested = nestedObj[nestedKey];
          if (nested && typeof nested === 'object' && 'status' in nested) {
            allFields.push(nested as { status: DataStatus });
          }
        }
      }
    }
  }

  const total = allFields.length;
  const valueCount = allFields.filter((f) => f.status === 'VALUE').length;
  const noDataCount = allFields.filter((f) => f.status === 'NO_DATA').length;

  // Если нет ни одного поля → LOW
  if (total === 0) {
    confidence.value = 0.1;
    confidence.level = 'LOW';
    confidence.downgrades.push('Отсутствуют любые research-данные');
    return confidence;
  }

  // Все NO_DATA → LOW + insufficient evidence
  if (valueCount === 0) {
    confidence.value = 0.1;
    confidence.level = 'LOW';
    confidence.downgrades.push('Все поля имеют статус NO_DATA');
    confidence.downgrades.push('insufficient evidence');
    return confidence;
  }

  const ratio = valueCount / total;

  if (ratio > 0.7) {
    confidence.value = Math.min(0.95, 0.6 + ratio * 0.35);
    confidence.level = 'HIGH';
    confidence.upgrades.push(`Высокое покрытие данных: ${valueCount}/${total} (${Math.round(ratio * 100)}%)`);
  } else if (ratio > 0.4) {
    confidence.value = Math.min(0.7, 0.3 + ratio * 0.5);
    confidence.level = 'MEDIUM';
    confidence.upgrades.push(`Умеренное покрытие данных: ${valueCount}/${total} (${Math.round(ratio * 100)}%)`);
    if (noDataCount > 0) {
      confidence.downgrades.push(`Отсутствуют данные по ${noDataCount} полям`);
    }
  } else {
    confidence.value = Math.min(0.4, 0.1 + ratio * 0.3);
    confidence.level = 'LOW';
        confidence.downgrades.push(`Низкое покрытие данных: ${valueCount}/${total} (${Math.round(ratio * 100)}%)`);
  }

  return confidence;
}

// ──────────────────────────────────────────────
// 5. Thesis Text Builder
// ──────────────────────────────────────────────

/**
 * Формирует основной инвестиционный тезис.
 *
 * Правила:
 *   - Только VALUE факты
 *   - NO_DATA не превращаем в факт
 *   - Historical PNL не используем
 *   - Portfolio context — только контекст, не фундаментальный факт
 */
function buildThesisText(
  snapshot: AssetResearchSnapshot,
  portfolioContext: PortfolioAssetContext | undefined,
): string {
  const parts: string[] = [];
  const ticker = snapshot.identity.ticker;
  const name = snapshot.identity.name;
  const assetType = snapshot.identity.assetType;

  parts.push(`Инвестиционный тезис для ${ticker} (${name}), тип актива: ${assetType}.`);

  // Issuer fundamentals — ТОЛЬКО VALUE
  if (snapshot.issuerResearch) {
    const ir = snapshot.issuerResearch;
    const fundamentals: string[] = [];

    if (hasValue(ir.financials.revenue)) {
      fundamentals.push(`выручка ${ir.financials.revenue.value}${ir.financials.revenue.unit || ''}`);
    }
    if (hasValue(ir.financials.netIncome)) {
      fundamentals.push(`чистая прибыль ${ir.financials.netIncome.value}${ir.financials.netIncome.unit || ''}`);
    }
    if (hasValue(ir.financials.roe)) {
      fundamentals.push(`ROE ${ir.financials.roe.value}${ir.financials.roe.unit || ''}`);
    }
    if (hasValue(ir.financials.roic)) {
      fundamentals.push(`ROIC ${ir.financials.roic.value}${ir.financials.roic.unit || ''}`);
    }
    if (hasValue(ir.businessDescription)) {
      fundamentals.push(`бизнес: ${ir.businessDescription.value}`);
    }
    if (hasValue(ir.sector)) {
      fundamentals.push(`сектор: ${ir.sector.value}`);
    }

    if (fundamentals.length > 0) {
      parts.push(`Фундаментальные показатели: ${fundamentals.join('; ')}.`);
    } else {
      parts.push('Фундаментальные данные отсутствуют (NO_DATA).');
    }
  } else {
    parts.push('Данные по эмитенту отсутствуют.');
  }

  // Bond fundamentals
  if (snapshot.bondResearch) {
    const br = snapshot.bondResearch;
    const bondParts: string[] = [];

    if (hasValue(br.couponRate)) {
      bondParts.push(`купон ${br.couponRate.value}%`);
    }
    if (hasValue(br.yieldToMaturity)) {
      bondParts.push(`YTM ${br.yieldToMaturity.value}%`);
    }
    if (hasValue(br.creditRating)) {
      bondParts.push(`рейтинг ${br.creditRating.value}`);
    }
    if (hasValue(br.duration)) {
      bondParts.push(`длительность ${br.duration.value}`);
    }

    if (bondParts.length > 0) {
      parts.push(`Облигационные показатели: ${bondParts.join('; ')}.`);
    } else {
      parts.push('Облигационные данные отсутствуют (NO_DATA).');
    }
  }

  // Market research
  if (snapshot.marketResearch) {
    const mr = snapshot.marketResearch;
    const marketParts: string[] = [];

    if (hasValue(mr.currentPrice)) {
      marketParts.push(`текущая цена ${mr.currentPrice.value}${mr.currentPrice.unit || ''}`);
    }
    if (hasValue(mr.liquidity)) {
      marketParts.push(`ликвидность: ${mr.liquidity.value}`);
    }
    if (hasValue(mr.marketRegime)) {
      marketParts.push(`режим рынка: ${mr.marketRegime.value}`);
    }

    if (marketParts.length > 0) {
      parts.push(`Рыночные данные: ${marketParts.join('; ')}.`);
    }
  }

  // Portfolio context — ТОЛЬКО как контекст
  if (portfolioContext) {
    const ctx = portfolioContext;
    const contextParts: string[] = [];

    contextParts.push(`текущая доля: ${ctx.currentPercent}%`);
    if (ctx.targetPercent !== undefined) {
      contextParts.push(`целевая доля: ${ctx.targetPercent}%`);
    }
    contextParts.push(`статус PortfolioMath: ${ctx.portfolioMathStatus}`);

    parts.push(`Контекст портфеля: ${contextParts.join('; ')}.`);
  }

  return parts.join(' ');
}

// ──────────────────────────────────────────────
// 6. Bull/Base/Bear Case Builder
// ──────────────────────────────────────────────

/**
 * Формирует бычий, базовый и медвежий сценарии.
 *
 * Правила:
 *   - Только VALUE факты
 *   - NO_DATA не превращаем в сценарий
 *   - Каждая версия строится из одних и тех же факторов
 */
function buildScenarios(
  snapshot: AssetResearchSnapshot,
): { bullCase: string; baseCase: string; bearCase: string } {
  const ticker = snapshot.identity.ticker;

  // Собираем позитивные, нейтральные и негативные сигналы из VALUE фактов
  const bullishSignals: string[] = [];
  const bearishSignals: string[] = [];
  const neutralSignals: string[] = [];

  // Financials
  if (snapshot.issuerResearch) {
    const ir = snapshot.issuerResearch;

    if (hasValue(ir.financials.revenue) && ir.financials.revenue.value > 0) {
      bullishSignals.push(`выручка ${ir.financials.revenue.value}${ir.financials.revenue.unit || ''}`);
    }
    if (hasValue(ir.financials.netIncome) && ir.financials.netIncome.value > 0) {
      bullishSignals.push(`чистая прибыль ${ir.financials.netIncome.value}${ir.financials.netIncome.unit || ''}`);
    }
    if (hasValue(ir.financials.roe) && ir.financials.roe.value > 10) {
      bullishSignals.push(`ROE ${ir.financials.roe.value}% (высокая рентабельность)`);
    }
    if (hasValue(ir.financials.roe) && ir.financials.roe.value <= 10 && ir.financials.roe.value > 0) {
      neutralSignals.push(`ROE ${ir.financials.roe.value}%`);
    }
    if (hasValue(ir.financials.roe) && ir.financials.roe.value <= 0) {
      bearishSignals.push(`ROE ${ir.financials.roe.value}% (отрицательная рентабельность)`);
    }
    if (hasValue(ir.financials.freeCashFlow) && ir.financials.freeCashFlow.value > 0) {
      bullishSignals.push(`FCF ${ir.financials.freeCashFlow.value}${ir.financials.freeCashFlow.unit || ''}`);
    }
    if (hasValue(ir.financials.debt)) {
      neutralSignals.push(`долг ${ir.financials.debt.value}${ir.financials.debt.unit || ''}`);
    }

    // Earnings trend
    if (hasValue(ir.earningsTrend.revenueGrowth) && ir.earningsTrend.revenueGrowth.value > 5) {
      bullishSignals.push(`рост выручки ${ir.earningsTrend.revenueGrowth.value}%`);
    }
    if (hasValue(ir.earningsTrend.revenueGrowth) && ir.earningsTrend.revenueGrowth.value <= 5) {
      neutralSignals.push(`рост выручки ${ir.earningsTrend.revenueGrowth.value}%`);
    }
    if (hasValue(ir.earningsTrend.netIncomeGrowth) && ir.earningsTrend.netIncomeGrowth.value > 5) {
      bullishSignals.push(`рост прибыли ${ir.earningsTrend.netIncomeGrowth.value}%`);
    }
  }

  // Market regime
  if (snapshot.marketResearch) {
    const mr = snapshot.marketResearch;
    if (hasValue(mr.marketRegime)) {
      if (mr.marketRegime.value === 'BULL') {
        bullishSignals.push('режим рынка: BULL');
      } else if (mr.marketRegime.value === 'BEAR') {
        bearishSignals.push('режим рынка: BEAR');
      } else {
        neutralSignals.push(`режим рынка: ${mr.marketRegime.value}`);
      }
    }
  }

  // Macro
  if (snapshot.macroResearch) {
    const mr = snapshot.macroResearch;
    if (hasValue(mr.economicCycle)) {
      if (mr.economicCycle.value === 'EXPANSION') {
        bullishSignals.push('экономический цикл: EXPANSION');
      } else if (mr.economicCycle.value === 'RECESSION') {
        bearishSignals.push('экономический цикл: RECESSION');
      } else {
        neutralSignals.push(`экономический цикл: ${mr.economicCycle.value}`);
      }
    }
  }

  // News sentiment
  if (snapshot.newsResearch) {
    const positiveNews = snapshot.newsResearch.items.filter(
      (n) => n.sentiment === 'POSITIVE',
    );
    const negativeNews = snapshot.newsResearch.items.filter(
      (n) => n.sentiment === 'NEGATIVE',
    );

    if (positiveNews.length > 0) {
      bullishSignals.push(`${positiveNews.length} позитивных новостей`);
    }
    if (negativeNews.length > 0) {
      bearishSignals.push(`${negativeNews.length} негативных новостей`);
    }
  }

  // Risks
  if (snapshot.riskAssessment) {
    const criticalRisks = snapshot.riskAssessment.risks.filter(
      (r) => r.severity === 'CRITICAL' || r.severity === 'HIGH',
    );
    if (criticalRisks.length > 0) {
      bearishSignals.push(`${criticalRisks.length} высоких/критических рисков`);
    }
  }

  // Формируем сценарии
  const bullCase = bullishSignals.length > 0
    ? `Бычий сценарий для ${ticker}: ${bullishSignals.join('; ')}.`
    : `Бычий сценарий для ${ticker}: недостаточно позитивных VALUE фактов для формирования сценария.`;

  const baseCase = neutralSignals.length > 0
    ? `Базовый сценарий для ${ticker}: ${neutralSignals.join('; ')}.`
    : `Базовый сценарий для ${ticker}: отсутствуют нейтральные данные, используется текущее состояние.`;

  const bearCase = bearishSignals.length > 0
    ? `Медвежий сценарий для ${ticker}: ${bearishSignals.join('; ')}.`
    : `Медвежий сценарий для ${ticker}: недостаточно негативных VALUE фактов для формирования сценария.`;

  return { bullCase, baseCase, bearCase };
}

// ──────────────────────────────────────────────
// 7. Key Drivers Builder
// ──────────────────────────────────────────────

/**
 * Извлекает ключевые драйверы из VALUE фактов.
 */
function buildKeyDrivers(
  snapshot: AssetResearchSnapshot,
): string[] {
  const drivers: string[] = [];

  // Financial drivers
  if (snapshot.issuerResearch) {
    const ir = snapshot.issuerResearch;

    if (hasValue(ir.financials.revenue)) {
      drivers.push(`Выручка: ${ir.financials.revenue.value}${ir.financials.revenue.unit || ''}`);
    }
    if (hasValue(ir.financials.netIncome)) {
      drivers.push(`Чистая прибыль: ${ir.financials.netIncome.value}${ir.financials.netIncome.unit || ''}`);
    }
    if (hasValue(ir.financials.roe)) {
      drivers.push(`ROE: ${ir.financials.roe.value}%`);
    }
    if (hasValue(ir.financials.roic)) {
      drivers.push(`ROIC: ${ir.financials.roic.value}%`);
    }
    if (hasValue(ir.financials.freeCashFlow)) {
      drivers.push(`FCF: ${ir.financials.freeCashFlow.value}${ir.financials.freeCashFlow.unit || ''}`);
    }
    if (hasValue(ir.earningsTrend.revenueGrowth)) {
      drivers.push(`Рост выручки: ${ir.earningsTrend.revenueGrowth.value}%`);
    }
    if (hasValue(ir.earningsTrend.netIncomeGrowth)) {
      drivers.push(`Рост прибыли: ${ir.earningsTrend.netIncomeGrowth.value}%`);
    }
    if (hasValue(ir.dividend.dividendYield)) {
      drivers.push(`Дивидендная доходность: ${ir.dividend.dividendYield.value}%`);
    }
  }

  // Market drivers
  if (snapshot.marketResearch) {
    const mr = snapshot.marketResearch;
    if (hasValue(mr.currentPrice)) {
      drivers.push(`Цена: ${mr.currentPrice.value}${mr.currentPrice.unit || ''}`);
    }
    if (hasValue(mr.volatility)) {
      drivers.push(`Волатильность: ${mr.volatility.value}%`);
    }
    if (hasValue(mr.marketRegime)) {
      drivers.push(`Режим рынка: ${mr.marketRegime.value}`);
    }
  }

  // Macro drivers
  if (snapshot.macroResearch) {
    const mr = snapshot.macroResearch;
    if (hasValue(mr.keyRate)) {
      drivers.push(`Ключевая ставка: ${mr.keyRate.value}%`);
    }
    if (hasValue(mr.inflation)) {
      drivers.push(`Инфляция: ${mr.inflation.value}%`);
    }
    if (hasValue(mr.fx)) {
      drivers.push(`Курс: ${mr.fx.value}`);
    }
  }

  return drivers;
}

// ──────────────────────────────────────────────
// 8. Key Risks Builder
// ──────────────────────────────────────────────

/**
 * Извлекает ключевые риски из RiskAssessment.
 */
function buildKeyRisks(
  riskAssessment: RiskAssessment | undefined,
): string[] {
  if (!riskAssessment) {
    return ['Риски не оценены'];
  }

  if (riskAssessment.risks.length === 0) {
    return ['Критические риски не выявлены'];
  }

  return riskAssessment.risks.map((risk) => {
    let severityLabel = '';
    switch (risk.severity) {
      case 'CRITICAL':
        severityLabel = 'КРИТИЧЕСКИЙ';
        break;
      case 'HIGH':
        severityLabel = 'ВЫСОКИЙ';
        break;
      case 'MEDIUM':
        severityLabel = 'СРЕДНИЙ';
        break;
      case 'LOW':
        severityLabel = 'НИЗКИЙ';
        break;
    }
    return `[${severityLabel}] ${risk.type}: ${risk.description}`;
  });
}

// ──────────────────────────────────────────────
// 9. Key Catalysts Builder
// ──────────────────────────────────────────────

/**
 * Извлекает ключевые катализаторы из RiskAssessment.
 */
function buildKeyCatalysts(
  riskAssessment: RiskAssessment | undefined,
): string[] {
  if (!riskAssessment) {
    return ['Катализаторы не оценены'];
  }

  if (riskAssessment.catalysts.length === 0) {
    return ['Катализаторы не выявлены'];
  }

  return riskAssessment.catalysts.map((catalyst) => {
    const timeline = hasValue(catalyst.timeline)
      ? ` (время: ${catalyst.timeline.value})`
      : '';
    return `${catalyst.description}${timeline}`;
  });
}

// ──────────────────────────────────────────────
// 10. Main Engine
// ──────────────────────────────────────────────

/**
 * Investment Thesis Engine — главный класс.
 *
 * Детерминированный rule-based движок для формирования InvestmentThesis
 * на основе AssetResearchSnapshot и PortfolioAssetContext.
 *
 * НЕ использует:
 *   - LLM/Ollama
 *   - Выдуманные факты
 *   - Historical PNL как инвестиционный тезис
 *   - PortfolioMath как фундаментальный факт
 */
export class InvestmentThesisEngine {
  /**
   * Генерирует InvestmentThesisResult из входных данных.
   *
   * @param input - AssetResearchSnapshot + PortfolioAssetContext
   * @returns InvestmentThesisResult — полностью rule-based вывод
   */
  generate(input: InvestmentThesisInput): InvestmentThesisResult {
    const { snapshot, portfolioContext } = input;
    const evidenceMap = snapshot.evidence || {};

    // Собираем все evidenceIds из VALUE полей
    const allEvidenceIds = this.collectAllEvidenceIds(snapshot);

    // Формируем evidence references
    const evidenceReferences = buildEvidenceReferences(
      allEvidenceIds,
      evidenceMap,
    );

    // Формируем каждый компонент
    const thesis = buildThesisText(snapshot, portfolioContext);
    const { bullCase, baseCase, bearCase } = buildScenarios(
      snapshot,
    );
    const keyDrivers = buildKeyDrivers(snapshot);
    const keyRisks = buildKeyRisks(snapshot.riskAssessment);
    const keyCatalysts = buildKeyCatalysts(snapshot.riskAssessment);
    const valuationView = buildValuationView(
      snapshot.issuerResearch,
    );
    const macroSensitivity = buildMacroSensitivity(
      snapshot.macroResearch,
      snapshot.identity.assetType,
    );
    const confidence = buildConfidence(snapshot);

    return {
      thesis,
      bullCase,
      baseCase,
      bearCase,
      keyDrivers,
      keyRisks,
      keyCatalysts,
      valuationView,
      macroSensitivity,
      confidence,
      evidenceReferences,
      assetType: snapshot.identity.assetType,
      ticker: snapshot.identity.ticker,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Собирает все evidenceIds из VALUE полей snapshot.
   */
  private collectAllEvidenceIds(
    snapshot: AssetResearchSnapshot,
  ): string[] {
    const ids: string[] = [];

    // Собираем из всех секций
    const sections = [
      snapshot.issuerResearch,
      snapshot.bondResearch,
      snapshot.etfResearch,
      snapshot.marketResearch,
      snapshot.macroResearch,
    ];

    for (const section of sections) {
      if (!section) continue;
      this.collectEvidenceIdsFromObject(section as unknown as Record<string, unknown>, ids);
    }

    // Также из newsResearch
    if (snapshot.newsResearch) {
      for (const item of snapshot.newsResearch.items) {
        // Новости не имеют evidenceIds напрямую, но можно добавить URL
        if (item.url) {
          ids.push(`news-${item.url}`);
        }
      }
    }

    // Уникальные
    return [...new Set(ids)];
  }

  /**
   * Рекурсивно собирает evidenceIds из объекта.
   */
  private collectEvidenceIdsFromObject(
    obj: unknown,
    ids: string[],
  ): void {
    const objAny = obj as Record<string, unknown>;
    for (const key of Object.keys(objAny)) {
      const val = objAny[key];
      if (val && typeof val === 'object' && 'status' in val) {
        const rv = val as ResearchValue<unknown>;
        if (rv.status === 'VALUE' && rv.evidenceIds) {
          ids.push(...rv.evidenceIds);
        }
      }
      // Рекурсия для nested объектов
      if (val && typeof val === 'object' && !('status' in val)) {
        this.collectEvidenceIdsFromObject(
          val,
          ids,
        );
      }
    }
  }
}
