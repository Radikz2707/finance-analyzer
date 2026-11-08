/**
 * Scenario Analyzer — моделирование влияния макро-сценариев на портфель.
 *
 * Сценарии:
 * 1. Ставка ЦБ → 16% (медвежий для акций, бычий для облигаций короткого плеча)
 * 2. Золото → $1800 (медвежий для золотодобывающих: Полюс, Алроса)
 * 3. Рубль → 80/$ (бычий для экспортеров, медвежий для импортеров)
 *
 * Метод:
 * - Для облигаций: duration-based расчёт вместо эвристики.
 *   Использует реальные данные дюрации из BondMarketData.
 * - Для акций: отраслевая чувствительность.
 *
 * P1: Заменена хардкод-эвристика "-3% для длинных облигаций" на
 *      расчёт через duration × yieldChange.
 */

import type { AssetAnalysis } from '../../portfolio/portfolio-math/portfolio-math.js';
import type { BondReferenceData } from '../../data/xlsx-parser/xlsx-parser.js';
import { priceImpact, determineDurationType } from '../../research/bond-analyzer/bond-duration-calculator.js';

/** Результат моделирования одного сценария */
export interface ScenarioResult {
  name: string;
  description: string;
  portfolioImpactPct: number;
  stocksImpactPct: number;
  bondsImpactPct: number;
  tickerImpact: Map<string, number>;
  keyRisks: string[];
  summaryText: string;
}

/** Все сценарии */
export interface ScenarioAnalysis {
  scenarios: ScenarioResult[];
  summaryText: string;
}

/** Сектор актива (эвристика по тикеру) */
function getAssetSector(ticker: string): string {
  const t = ticker.toUpperCase();
  if (t === 'GMKN' || t === 'NVTK' || t === 'ALRS') return 'gold';
  if (t === 'SBER' || t === 'TCSG' || t === 'MOEX' || t === 'VTBR')
    return 'banks';
  if (t === 'LKOH' || t === 'ROSN' || t === 'TATN' || t === 'ALRS')
    return 'oil_gas';
  if (t === 'GMKN') return 'metals';
  if (t === 'CHMF' || t === 'NLMK' || t === 'MGNT' || t === 'MAGN')
    return 'metals_minerals';
  return 'other';
}

/**
 * Оценка влияния сценария на один актив.
 * Возвращает ожидаемое изменение цены (%).
 *
 * P1: Для облигаций используется duration-based расчёт вместо эвристики.
 */
function estimateTickerImpact(
  ticker: string,
  scenarioType: 'rate_16' | 'gold_1800' | 'ruble_80',
  sector: string,
  assetType: string,
  bondData?: BondReferenceData,
): number {
  const t = ticker.toUpperCase();

  // ─── Облигации: duration-based расчёт ───
  const isBond = assetType === 'О' || assetType === 'Облигация' || sector === 'bonds';

  if (isBond && bondData) {
    switch (scenarioType) {
      case 'rate_16': {
        // Ставка 16%: предположим +2 п.п. к рыночной доходности
        const durationChange = 2; // +2% к доходности
        if (bondData.duration > 0) {
          const durationType = determineDurationType(); // UNKNOWN по умолчанию
          const impact = priceImpact(
            bondData.duration,
            durationType,
            bondData.yield || 0,
            durationChange,
          );
          return impact ?? -3; // fallback на эвристику если расчёт не удался
        }
        return -3; // fallback: длинные облигации падают
      }

      case 'gold_1800': {
        // Золото не влияет на облигации напрямую
        return 0;
      }

      case 'ruble_80': {
        // Укрепление рубля: минимальное влияние на рублевые облигации
        // Возможно +0.5% (снижение инфляционных ожиданий)
        return bondData.duration > 0 ? 0.5 : 0;
      }
    }
  }

  // ─── Акции: отраслевая чувствительность ───
  switch (scenarioType) {
    case 'rate_16': {
      // Ставка 16%
      if (sector === 'banks') return -8; // банки под давлением ставки
      if (sector === 'oil_gas') return -5; // удорожание добычи
      if (sector === 'gold') return +2; // золото — защитный актив
      if (sector === 'metals_minerals') return -6; // удорожание капитала
      return -5; // среднее по рынку
    }

    case 'gold_1800': {
      // Золото $1800
      if (t === 'GMKN' || t === 'NVTK') return -15; // Polymetal/Novatek
      if (t === 'ALRS') return -12; // Алроса
      if (sector === 'gold' || sector === 'metals') return -12;
      if (sector === 'banks') return +2;
      return -1;
    }

    case 'ruble_80': {
      // Рубль 80/$ (укрепление)
      if (sector === 'oil_gas') return +8; // экспортеры выигрывают
      if (sector === 'gold') return +5;
      if (sector === 'banks') return -3;
      if (t === 'MTLR' || t === 'CHMF' || t === 'NLMK') return -5; // импортеры
      return -2;
    }
  }
}

/**
 * Рассчитывает взвешенное влияние сценария на портфель.
 */
function calculatePortfolioImpact(
  assets: AssetAnalysis[],
  tickerImpacts: Map<string, number>,
): {
  portfolioImpactPct: number;
  stocksImpactPct: number;
  bondsImpactPct: number;
} {
  let totalWeightedImpact = 0;
  let totalWeight = 0;
  let stocksWeighted = 0;
  let stocksWeight = 0;
  let bondsWeighted = 0;
  let bondsWeight = 0;

  for (const asset of assets) {
    const impact = tickerImpacts.get(asset.ticker) ?? 0;
    const weight = asset.currentPercent;
    if (weight === 0) continue;

    totalWeightedImpact += impact * weight;
    totalWeight += weight;

    const type = asset.assetType.toUpperCase();
    if (type === 'А' || type === 'АКЦИЯ' || type === 'STOCK') {
      stocksWeighted += impact * weight;
      stocksWeight += weight;
    }
    if (type === 'О' || type === 'ОБЛИГАЦИЯ' || type === 'BOND') {
      bondsWeighted += impact * weight;
      bondsWeight += weight;
    }
  }

  return {
    portfolioImpactPct: totalWeight > 0 ? totalWeightedImpact / totalWeight : 0,
    stocksImpactPct: stocksWeight > 0 ? stocksWeighted / stocksWeight : 0,
    bondsImpactPct: bondsWeight > 0 ? bondsWeighted / bondsWeight : 0,
  };
}

/**
 * Формирует ключевые риски для сценария.
 */
function getKeyRisks(scenarioType: string, assets: AssetAnalysis[]): string[] {
  const risks: string[] = [];
  const tickers = assets.map((a) => a.ticker.toUpperCase());

  switch (scenarioType) {
    case 'rate_16':
      if (tickers.some((t) => t === 'SBER' || t === 'TCSG' || t === 'VTBR')) {
        risks.push(
          'Банковский сектор (Сбер, ТКС, ВТБ) — давление маржинальности',
        );
      }
      if (tickers.some((t) => t === 'TATN' || t === 'GMKN')) {
        risks.push('Металлурги — удорожание капитала снижает рентабельность');
      }
      risks.push('Облигационный портфель: оценка через duration × 2%');
      risks.push('Ликвидность рынка снижается — спреды widen');
      break;

    case 'gold_1800':
      if (tickers.some((t) => t === 'GMKN' || t === 'ALRS')) {
        risks.push(
          'Полюс и/или Алроса — прямое влияние падения золота/алмазов',
        );
      }
      risks.push('Переток капитала из сырьевых товаров в защитные активы');
      break;

    case 'ruble_80':
      if (tickers.some((t) => t === 'LKOH' || t === 'ROSN' || t === 'TATN')) {
        risks.push(
          'Экспортеры (Лукойл, Роснефть, Татнефть) — выигрывают от укрепления рубля',
        );
      }
      if (tickers.some((t) => t === 'MTLR' || t === 'CHMF')) {
        risks.push(
          'Импортеры (Металлоинвест, Северный никель) — давление на маржу',
        );
      }
      risks.push(
        'Налоговая политика: бюджет зависит от курса, возможен рост налога',
      );
      break;
  }

  return risks;
}

/**
 * Формирует текстовое резюме сценария.
 */
function formatScenarioSummary(scenario: ScenarioResult): string {
  const impactSign = scenario.portfolioImpactPct >= 0 ? '+' : '';
  return (
    `СЦЕНАРИЙ: ${scenario.name}\n` +
    `${scenario.description}\n` +
    `Ожидаемое влияние на портфель: ${impactSign}${scenario.portfolioImpactPct.toFixed(1)}%\n` +
    `  Акции: ${scenario.stocksImpactPct >= 0 ? '+' : ''}${scenario.stocksImpactPct.toFixed(1)}%\n` +
    `  Облигации: ${scenario.bondsImpactPct >= 0 ? '+' : ''}${scenario.bondsImpactPct.toFixed(1)}%\n`
  );
}

/**
 * Основной анализ сценариев.
 *
 * @param assets — текущие активы портфеля
 * @param totalValue — текущая стоимость портфеля (₽)
 * @param bondMarketData — Map<ISIN, BondReferenceData> для duration-based расчёта облигаций
 * @returns ScenarioAnalysis с результатами всех сценариев
 */
export function analyzeScenarios(
  assets: AssetAnalysis[],
  totalValue: number,
  bondMarketData?: Map<string, BondReferenceData>,
): ScenarioAnalysis {
  const scenarioTypes: Array<'rate_16' | 'gold_1800' | 'ruble_80'> = [
    'rate_16',
    'gold_1800',
    'ruble_80',
  ];

  const scenarioConfigs = {
    rate_16: {
      name: 'Ставка ЦБ → 16%',
      description:
        'ЦБ повышает ставку до 16%. Денежная политика жёсткая. ' +
        'Акции под давлением (удорожание капитала), облигации короткого плеча выигрывают.',
    },
    gold_1800: {
      name: 'Золото → $1800',
      description:
        'Цена золота падает до $1800/oz. Медвежий сценарий для золотодобытчиков. ' +
        'Возможно ослабление рубля, что частично компенсирует.',
    },
    ruble_80: {
      name: 'Рубль → 80/$',
      description:
        'Рубль укрепляется до 80 за доллар. Бычий для импортеров, медвежий для экспортеров. ' +
        'Налоговая база бюджета сжимается.',
    },
  };

  const scenarios: ScenarioResult[] = [];

  for (const scenarioType of scenarioTypes) {
    const config = scenarioConfigs[scenarioType];
    const tickerImpact = new Map<string, number>();

    // Расчёт влияния на каждый актив
    for (const asset of assets) {
      // Ищем bondData для облигаций
      const bondData = bondMarketData?.get(asset.ticker.toUpperCase());
      const sector = getAssetSector(asset.ticker);

      const impact = estimateTickerImpact(
        asset.ticker,
        scenarioType,
        sector,
        asset.assetType,
        bondData,
      );
      tickerImpact.set(asset.ticker, impact);
    }

    // Взвешенное влияние на портфель
    const portfolioImpact = calculatePortfolioImpact(assets, tickerImpact);
    const keyRisks = getKeyRisks(scenarioType, assets);

    const scenario: ScenarioResult = {
      name: config.name,
      description: config.description,
      portfolioImpactPct: portfolioImpact.portfolioImpactPct,
      stocksImpactPct: portfolioImpact.stocksImpactPct,
      bondsImpactPct: portfolioImpact.bondsImpactPct,
      tickerImpact,
      keyRisks,
      summaryText: '',
    };

    scenario.summaryText = formatScenarioSummary(scenario);
    scenarios.push(scenario);
  }

  // Формируем общую сводку
  const worstCase = scenarios.reduce((worst, s) =>
    s.portfolioImpactPct < worst.portfolioImpactPct ? s : worst,
  );
  const bestCase = scenarios.reduce((best, s) =>
    s.portfolioImpactPct > best.portfolioImpactPct ? s : best,
  );

  const rubValue = (pct: number) =>
    ((Math.abs(pct) / 100) * totalValue).toLocaleString('ru-RU');

  const summaryLines: string[] = [
    '=== СЦЕНАРНОЕ МОДЕЛИРОВАНИЕ ===',
    'Анализ влияния макро-сценариев на портфель на основе текущей структуры.\n',
  ];

  for (const scenario of scenarios) {
    summaryLines.push(scenario.summaryText);
    summaryLines.push('');
  }

  summaryLines.push(
    `Наихудший сценарий: ${worstCase.name} (${worstCase.portfolioImpactPct.toFixed(1)}%, ~${rubValue(worstCase.portfolioImpactPct)} ₽)`,
  );
  summaryLines.push(
    `Лучший сценарий: ${bestCase.name} (${bestCase.portfolioImpactPct.toFixed(1)}%, ~${rubValue(bestCase.portfolioImpactPct)} ₽)`,
  );

  if (Math.abs(worstCase.portfolioImpactPct) > 5) {
    summaryLines.push(
      '\n⚠️ Портфель чувствителен к макро-шокам. Проверь концентрацию в «спутниках» и диверсификацию.',
    );
  }

  const summary: ScenarioAnalysis = {
    scenarios,
    summaryText: summaryLines.join('\n'),
  };

  return summary;
}

/**
 * Форматирует результаты сценариев для включения в промпт ИИ.
 */
export function formatScenariosForPrompt(analysis: ScenarioAnalysis): string {
  return analysis.summaryText;
}
