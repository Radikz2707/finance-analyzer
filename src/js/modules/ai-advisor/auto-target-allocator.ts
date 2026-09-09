import { CurrentAsset } from '../xlsx-parser/xlsx-parser.js';

export interface AutoTargetResult {
  ticker: string;
  name: string;
  suggestedTargetPercent: number;
  reason: string;
}

/**
 * Автоматическое предложение целевой доли для новых активов
 * на основе макро-структуры портфеля
 */
export function suggestAutoTargetPercent(
  asset: CurrentAsset,
  macroStocksPct: number,
  macroBondsPct: number,
): AutoTargetResult {
  const ticker = asset.ticker.toUpperCase();
  const name = asset.name;
  const assetType = asset.assetType.toUpperCase();

  let suggestedPercent = 0;
  let reason = '';

  // Определяем тип актива
  const isStock = assetType === 'А';
  const isBond = assetType === 'О' || assetType === 'ОБЛ';
  const isFund = assetType === 'Ф' || assetType === 'ETF';

  if (isStock) {
    // Акции: распределяем поровну между всеми акциями портфеля
    const stockCount = 8; // среднее количество акций в диверсифицированном портфеле
    const stockAllocation = macroStocksPct / stockCount;
    suggestedPercent = Math.round(stockAllocation * 10) / 10;
    reason = `Рекомендуемая доля акций в портфеле: ${macroStocksPct}%. При ${stockCount} акциях — примерно ${suggestedPercent}% на каждую.`;
  } else if (isBond) {
    // Облигации: распределяем поровну между всеми облигациями портфеля
    const bondCount = 6; // среднее количество облигаций
    const bondAllocation = macroBondsPct / bondCount;
    suggestedPercent = Math.round(bondAllocation * 10) / 10;
    reason = `Рекомендуемая доля облигаций в портфеле: ${macroBondsPct}%. При ${bondCount} облигациях — примерно ${suggestedPercent}% на каждую.`;
  } else if (isFund) {
    // Фонды/ETF: небольшая доля для диверсификации
    suggestedPercent = 3;
    reason = 'Рекомендуемая базовая доля для ETF/фондов: 3% для диверсификации.';
  }

  // Минимальный порог — 1%, ниже не имеет смысла
  if (suggestedPercent < 1) {
    suggestedPercent = 1;
    reason += ' Минимальная рекомендуемая доля: 1%.';
  }

  return {
    ticker,
    name,
    suggestedTargetPercent: suggestedPercent,
    reason,
  };
}

/**
 * Предложить целевые доли для всех новых активов
 */
export function suggestAllAutoTargets(
  assets: CurrentAsset[],
  macroStocksPct: number,
  macroBondsPct: number,
): AutoTargetResult[] {
  return assets
    .filter((a) => a.targetPercent === 0 && (a.quantity || 0) > 0)
    .map((asset) => suggestAutoTargetPercent(asset, macroStocksPct, macroBondsPct));
}
