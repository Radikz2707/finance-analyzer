import { MacroGoals, CurrentAsset } from '../xlsx-parser/xlsx-parser.js';

export interface AssetAnalysis {
  name: string;
  currentPercent: number;
  targetPercent: number;
  deficitRub: number;
  status: 'HOLD' | 'BUY' | 'STABLE' | 'REDUCE';
  dynamicsPercent: number;
}

export interface PortfolioReportData {
  macro: MacroGoals;
  assetsAnalysis: AssetAnalysis[];
  freeStocksPoolPercent: number;
}

/**
 * Модуль инвестиционной математики и жестких лимитов стратегии
 */
export class PortfolioMathModule {
  // Жесткие целевые лимиты по вашей стратегии
  private targetLimits: Record<string, { target: number; holdOnly?: boolean }> =
    {
      Полюс: { target: 20.0, holdOnly: true }, // Жесткий лимит до 20%, hold_only
      Сбербанк: { target: 15.0 },
      'Татнфт Зао': { target: 15.0 },
      ИнтерРАОао: { target: 15.0 },
      'КЦ ИКС 5': { target: 15.0 },
      'ѕГТЛК2P-14': { target: 10.0 }, // Облигации ГТЛК Выпуск 14
    };

  /**
   * Адаптивный расчет отклонений по конкретным инструментам
   */
  public analyzePortfolio(
    macro: MacroGoals,
    assets: CurrentAsset[],
  ): PortfolioReportData {
    const assetsAnalysis: AssetAnalysis[] = [];
    let allocatedStocksPercent = 0;

    // Считаем, сколько процентов из общего макро-лимита акций мы УЖЕ жестко распределили руками
    Object.keys(this.targetLimits).forEach((name) => {
      if (name !== 'ѕГТЛК2P-14') {
        // Исключаем облигацию
        allocatedStocksPercent += this.targetLimits[name].target;
      }
    });

    // Вычисляем адаптивный свободный остаток лимита акций для ИИ-помощника
    // Например, если макро-цель акций 55%, а жестких целей 4 по 15% (60%) — пул уйдет в 0,
    // но если вы измените макро-цель на 70%, у ИИ появится 10% свободного пула на новые инструменты.
    const freeStocksPoolPercent = Math.max(
      0,
      macro.stocksPercent - allocatedStocksPercent,
    );

    assets.forEach((asset) => {
      // Ищем, задан ли для этого инструмента ручной лимит
      const limitConfig = this.targetLimits[asset.name];
      const targetPercent = limitConfig ? limitConfig.target : 0;

      // Считаем дефицит в рублях на основе общей стоимости портфеля
      // (Целевая доля % - Фактическая доля %) * Общий баланс
      const deviationPercent = targetPercent - asset.liquidationPercent;
      const deficitRub = Math.round(
        (deviationPercent / 100) * macro.totalBalance,
      );

      // Опеределяем статус и режим удержания (Предохранители для Полюса и просадок)
      let status: 'HOLD' | 'BUY' | 'STABLE' | 'REDUCE' = 'STABLE';

      if (limitConfig?.holdOnly) {
        status = 'HOLD'; // Полюсу принудительно ставим "Только удерживать"
      } else if (deficitRub > 1000) {
        status = 'BUY'; // Если дефицит существенный — сигнал на покупку
      } else if (deficitRub < -2000) {
        status = 'REDUCE'; // Профицит — сигнал на сокращение (если это не замороженный актив)
      }

      // Дополнительная умная проверка: если актив сильно упал ниже балансовой цены (как Полюс),
      // даже без флага holdOnly код принудительно запретит его продавать
      if (
        asset.liquidationPercent < asset.balancePercent &&
        status === 'REDUCE'
      ) {
        status = 'HOLD';
      }

      assetsAnalysis.push({
        name: asset.name,
        currentPercent: asset.liquidationPercent,
        targetPercent: targetPercent,
        deficitRub: deficitRub,
        status: status,
        dynamicsPercent: asset.dynamicsPercent,
      });
    });

    return {
      macro,
      assetsAnalysis,
      freeStocksPoolPercent,
    };
  }
}
