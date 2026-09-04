import { CurrentAsset, MacroGoals } from '../xlsx-parser/xlsx-parser';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class PortfolioValidator {
  constructor() {}

  /**
   * Метод сквозной цифровой валидации без хардкода имён активов.
   * Проверяет ручные значения из столбца S на соответствие лимитам из "Целей".
   */
  public validateLimits(
    macro: MacroGoals,
    assets: CurrentAsset[],
  ): ValidationResult {
    const errors: string[] = [];
    let totalStocksPercent = 0;
    let totalBondsPercent = 0;

    assets.forEach((asset) => {
      // Автоматически определяем тип инструмента по наличию НКД
      const isBond = asset.nkdRub !== undefined && asset.nkdRub > 0;

      if (isBond) {
        totalBondsPercent += asset.targetPercent;
      } else {
        totalStocksPercent += asset.targetPercent;
      }

      // 🛡️ Цифровое правило риск-менеджмента портфеля: лимит на один актив не более 20%
      if (asset.targetPercent > 20.0) {
        errors.push(
          "Критическое превышение лимита: Инструмент '" +
            asset.name +
            "' имеет целевую долю " +
            asset.targetPercent +
            '%, что выше разрешенных риск-менеджментом 20%!',
        );
      }
    });

    // 🛡️ Контроль соответствия суммарных долей макро-сплиту с листа "Цели"
    if (totalStocksPercent > macro.stocksPercent) {
      errors.push(
        'Превышение лимита группы АКЦИИ: Сумма долей в столбце S составляет ' +
          totalStocksPercent +
          '%, что превышает глобальную цель стратегии в ' +
          macro.stocksPercent +
          '%!',
      );
    }

    if (totalBondsPercent > macro.bondsPercent) {
      errors.push(
        'Превышение лимита группы ОБЛИГАЦИИ: Сумма долей в столбце S составляет ' +
          totalBondsPercent +
          '%, что превышает глобальную цель стратегии в ' +
          macro.bondsPercent +
          '%!',
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
