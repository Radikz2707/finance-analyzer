/**
 * Scenario Analyzer — моделирование влияния макро-сценариев на портфель.
 *
 * Сценарии:
 * 1. Ставка ЦБ → 16% (медвежий для акций, бычий для облигаций короткого плеча)
 * 2. Золото → $1800 (медвежий для золотодобывающих: Полюс, Алроса)
 * 3. Рубль → 80/$ (бычий для экспортеров, медвежий для импортеров)
 *
 * Метод: оценка impact на каждый актив на основе его sector + beta + exposure.
 */

import type { AssetAnalysis } from '../portfolio-math/portfolio-math.js';

/** Результат моделирования одного сценария */
export interface ScenarioResult {
  /** Название сценария */
  name: string;
  /** Описание сценария */
  description: string;
  /** Ожидаемое изменение портфеля (%) */
  portfolioImpactPct: number;
  /** Влияние на акции (%) */
  stocksImpactPct: number;
  /** Влияние на облигации (%) */
  bondsImpactPct: number;
  /** Влияние на конкретные тикеры */
  tickerImpact: Map<string, number>;
  /** Ключевые риски */
  keyRisks: string[];
  /** Краткое резюме для промпта */
  summaryText: string;
}

/** Все сценарии */
export interface ScenarioAnalysis {
  scenarios: ScenarioResult[];
  /** Текстовая сводка для промпта ИИ */
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
  if (
    t.includes('OFS') ||
    t.includes('Облигация') ||
    t.includes('БРУС') ||
    t.includes('ФОС')
  )
    return 'bonds';
  if (t === 'CHMF' || t === 'NLMK' || t === 'MGNT' || t === 'MAGN')
    return 'metals_minerals';
  return 'other';
}

/**
 * Оценивает влияние сценария на один актив.
 * Возвращает ожидаемое изменение цены (%).
 */
function estimateTickerImpact(
  ticker: string,
  scenarioType: 'rate_16' | 'gold_1800' | 'ruble_80',
  sector: string,
  assetType: string,
): number {
  const t = ticker.toUpperCase();

  switch (scenarioType) {
    case 'rate_16': {
      // Ставка 16%
      if (
        assetType === 'О' ||
        assetType === 'Облигация' ||
        sector === 'bonds'
      ) {
        // Облигации: короткие — выигрывают от переинвестирования, длинные — проигрывают
        if (t.includes('QRPT') || t.includes('LQDT')) return +1;
        return -3; // длинные облигации падают
      }
      // Акции: в целом негативный эффект (удорожание займов)
      if (sector === 'banks') return -8; // банки под давлением ставки
      if (sector === 'oil_gas') return -5; // удорожание добычи
      if (sector === 'gold') return +2; // золото — защитный актив
      if (sector === 'metals_minerals') return -6; // удорожание капитала
      return -5; // среднее по рынку
    }

    case 'gold_1800': {
      // Золото $1800
      if (t === 'GMKN' || t === 'NVTK') return -15; // Polymetal/Novatek — не золото, но metals
      if (t === 'ALRS') return -12; // Алроса — алмазы, коррелируют с золотом
      if (sector === 'gold' || sector === 'metals') return -12;
      if (sector === 'banks') return +2; // банки выигрывают от перетока в рубли
      return -1; // минимальное влияние
    }

    case 'ruble_80': {
      // Рубль 80/$ (укрепление)
      if (sector === 'oil_gas') return +8; // экспортеры выигрывают
      if (sector === 'gold') return +5; // золотодобытчики
      if (sector === 'banks') return -3; // банки под давлением
      if (t === 'MTLR' || t === 'CHMF' || t === 'NLMK') return -5; // импортеры
      if (assetType === 'О' || assetType === 'Облигация') return +2; // рублевые облигации
      return -2; // среднее
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

  // Определяем, какие активы наиболее уязвимы
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
      risks.push('Облигационный портфель: длинные ОФЗ могут упасть на 3-5%');
      risks.push('Ликвидность рынка снижается — спреды widen');
      break;

    case 'gold_1800':
      if (tickers.some((t) => t === 'GMKN' || t === 'ALRS')) {
        risks.push(
          'Полюс и/или Алроса — прямое влияние падения золота/алмазов',
        );
      }
      risks.push('Переток капитала из сырьевых товаров в защитные активы');
      risks.push(
        'RUB может ослабнуть, что частично компенсирует падение экспортеров',
      );
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
 * @returns ScenarioAnalysis с результатами всех сценариев
 */
export function analyzeScenarios(
  assets: AssetAnalysis[],
  totalValue: number,
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
      const sector = getAssetSector(asset.ticker);
      const impact = estimateTickerImpact(
        asset.ticker,
        scenarioType,
        sector,
        asset.assetType,
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

  // Ф'рмируем общую сводку'
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
