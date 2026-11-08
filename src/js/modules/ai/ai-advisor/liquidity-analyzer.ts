/**
 * LiquidityAnalyzer — анализ ликвидности активов на основе дневного оборота.
 *
 * Определяет:
 * 1. Уровни ликвидности для каждого актива
 * 2. «Мёртвые» активы (критически низкий оборот)
 * 3. Долю низколиквидных активов в портфеле
 * 4. Подтверждение/опровержение трендов по обороту
 * 5. Риски ликвидации (насколько быстро можно продать позицию)
 *
 * Данные подаются из DataAgent через quotes[volumeTodayRub].
 */

// ──────────────────────────────────────────────
// 1. Типы
// ──────────────────────────────────────────────

/** Уровень ликвидности актива */
export type LiquidityLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'CRITICAL' | 'UNKNOWN';

/** Результат анализа ликвидности одного актива */
export interface AssetLiquidity {
  /** Тикер актива */
  ticker: string;
  /** Название актива */
  name: string;
  /** Рыночная стоимость позиции (руб) */
  marketValue: number;
  /** Дневной оборот (руб) или null если нет данных */
  dailyTurnover: number | null;
  /** Уровень ликвидности */
  liquidityLevel: LiquidityLevel;
  /** Отношение оборота к стоимости позиции (чем больше, тем лучше) */
  turnoverToValueRatio: number;
  /** Оценка времени ликвидации: сколько дней нужно чтобы продать без просадки */
  liquidationDays: number | null;
  /** Предупреждение (пусто если всё ок) */
  warning?: string;
  /** Рекомендация по управлению позицией */
  advice?: string;
}

/** Структурированный результат анализа ликвидности портфеля */
export interface LiquidityAnalysis {
  /** Результаты по каждому активу */
  assets: AssetLiquidity[];
  /** Сводка по портфелю */
  summary: PortfolioLiquiditySummary;
  /** Предупреждения (пусто если всё ок) */
  warnings: string[];
  /** Рекомендации (пусто если нечего рекомендовать) */
  recommendations: string[];
}

/** Сводка по ликвидности всего портфеля */
export interface PortfolioLiquiditySummary {
  /** Общая рыночная стоимость портфеля */
  totalMarketValue: number;
  /** Доля высоколиквидных активов (%) */
  highLiquidityPct: number;
  /** Доля среднеликвидных активов (%) */
  mediumLiquidityPct: number;
  /** Доля низколиквидных активов (%) */
  lowLiquidityPct: number;
  /** Доля критически низколиквидных активов (%) */
  criticalLiquidityPct: number;
  /** Количество активов без данных по обороту */
  unknownCount: number;
  /** Количество «мёртвых» активов (критическая ликвидность) */
  deadAssetsCount: number;
  /** Статус ликвидности портфеля */
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
}

// ──────────────────────────────────────────────
// 2. Конфигурация порогов
// ──────────────────────────────────────────────

/**
 * Пороги для оценки ликвидности.
 *
 * Логика:
 * - HIGH:   оборот > 1 млрд ₽/день ИЛИ оборот > 10% стоимости позиции
 * - MEDIUM: оборот > 100 млн ₽/день ИЛИ оборот > 1% стоимости позиции
 * - LOW:    оборот > 10 млн ₽/день ИЛИ оборот > 0.1% стоимости позиции
 * - CRITICAL: оборот <= 10 млн ₽/день ИЛИ оборот < 0.1% стоимости позиции
 */
export interface LiquidityThresholds {
  /** Минимальный дневной оборот для HIGH ликвидности (руб) */
  highTurnoverMin: number;
  /** Минимальный дневной оборот для MEDIUM ликвидности (руб) */
  mediumTurnoverMin: number;
  /** Минимальный дневной оборот для LOW ликвидности (руб) */
  lowTurnoverMin: number;
  /** Минимальное отношение оборота к стоимости позиции для HIGH */
  highRatioMin: number;
  /** Минимальное отношение оборота к стоимости позиции для MEDIUM */
  mediumRatioMin: number;
  /** Минимальное отношение оборота к стоимости позиции для LOW */
  lowRatioMin: number;
}

export const DEFAULT_THRESHOLDS: LiquidityThresholds = {
  highTurnoverMin: 1e9, // 1 млрд ₽/день
  mediumTurnoverMin: 1e8, // 100 млн ₽/день
  lowTurnoverMin: 1e7, // 10 млн ₽/день
  highRatioMin: 0.1, // 10%
  mediumRatioMin: 0.01, // 1%
  lowRatioMin: 0.001, // 0.1%
};

// ──────────────────────────────────────────────
// 3. Основной анализатор
// ──────────────────────────────────────────────

export class LiquidityAnalyzer {
  private thresholds: LiquidityThresholds;

  constructor(thresholds?: LiquidityThresholds) {
    this.thresholds = thresholds ?? DEFAULT_THRESHOLDS;
  }

  /**
   * Проанализировать ликвидность всего портфеля.
   *
   * @param assets — массив активов с marketValue и dailyTurnover
   * @returns LiquidityAnalysis
   */
  analyze(
    assets: Array<{
      ticker: string;
      name: string;
      marketValue: number;
      dailyTurnover: number | null;
    }>,
  ): LiquidityAnalysis {
    const assetResults: AssetLiquidity[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    let totalMarketValue = 0;
    let highValue = 0;
    let mediumValue = 0;
    let lowValue = 0;
    let criticalValue = 0;
    let unknownCount = 0;
    let deadAssetsCount = 0;

    for (const asset of assets) {
      totalMarketValue += asset.marketValue;

      const result = this.analyzeAsset(asset);
      assetResults.push(result);

      // Суммируем по уровням
      switch (result.liquidityLevel) {
        case 'HIGH':
          highValue += asset.marketValue;
          break;
        case 'MEDIUM':
          mediumValue += asset.marketValue;
          break;
        case 'LOW':
          lowValue += asset.marketValue;
          break;
        case 'CRITICAL':
          criticalValue += asset.marketValue;
          deadAssetsCount++;
          break;
        case 'UNKNOWN':
          unknownCount++;
          break;
      }

      // Предупреждения для актива
      if (result.warning) {
        warnings.push(result.warning);
      }

      // Рекомендации для актива
      if (result.advice) {
        recommendations.push(result.advice);
      }
    }

    // Сводка по портфелю
    const summary: PortfolioLiquiditySummary = {
      totalMarketValue,
      highLiquidityPct:
        totalMarketValue > 0
          ? Math.round((highValue / totalMarketValue) * 100 * 100) / 100
          : 0,
      mediumLiquidityPct:
        totalMarketValue > 0
          ? Math.round((mediumValue / totalMarketValue) * 100 * 100) / 100
          : 0,
      lowLiquidityPct:
        totalMarketValue > 0
          ? Math.round((lowValue / totalMarketValue) * 100 * 100) / 100
          : 0,
      criticalLiquidityPct:
        totalMarketValue > 0
          ? Math.round((criticalValue / totalMarketValue) * 100 * 100) / 100
          : 0,
      unknownCount,
      deadAssetsCount,
      status: this.determinePortfolioStatus(
        criticalValue,
        lowValue,
        totalMarketValue,
        deadAssetsCount,
      ),
    };

    // Портфельные предупреждения
    if (summary.unknownCount > 0) {
      warnings.push(
        `ℹ️ Нет данных по обороту для ${summary.unknownCount} активов. ` +
          'Анализ ликвидности неполный — проверьте наличие столбца "Оборот" в листе "Акции" Excel.',
      );
    }

    if (summary.criticalLiquidityPct > 5) {
      warnings.push(
        `⚠️ Критическая ликвидность: ${summary.criticalLiquidityPct.toFixed(1)}% портфеля (${deadAssetsCount} активов) ` +
          'имеют оборот ниже 10 млн ₽/день. В кризис их невозможно продать без дисконта 5-15%.',
      );
    }

    if (summary.lowLiquidityPct > 20) {
      warnings.push(
        `⚠️ Низкая ликвидность: ${summary.lowLiquidityPct.toFixed(1)}% портфеля — оборот ниже 100 млн ₽/день. ` +
          'Рекомендуется диверсифицировать в более ликвидные активы.',
      );
    }

    // Портфельные рекомендации
    if (deadAssetsCount > 0) {
      recommendations.push(
        `Рассмотрите замену ${deadAssetsCount} низколиквидных активов на аналоги с оборотом > 50 млн ₽/день. ` +
          'Это снизит риск невозможности выхода из позиции.',
      );
    }

    return {
      assets: assetResults,
      summary,
      warnings,
      recommendations,
    };
  }

  /**
   * Проанализировать ликвидность одного актива.
   */
  private analyzeAsset(asset: {
    ticker: string;
    name: string;
    marketValue: number;
    dailyTurnover: number | null;
  }): AssetLiquidity {
    const { ticker, name, marketValue, dailyTurnover } = asset;

    // Нет данных по обороту
    if (dailyTurnover === null || dailyTurnover <= 0) {
      return {
        ticker,
        name,
        marketValue,
        dailyTurnover: null,
        liquidityLevel: 'UNKNOWN',
        turnoverToValueRatio: 0,
        liquidationDays: null,
        // Предупреждение только на уровне портфеля, не для каждого актива
        advice: 'Проверьте наличие данных по обороту в Excel.',
      };
    }

    // Отношение оборота к стоимости позиции
    const ratio = dailyTurnover / (marketValue || 1);

    // Оценка времени ликвидации (сколько дней нужно чтобы продать позицию без просадки)
    // Логика: если оборот = 100% позиции, то 1 день. Если оборот = 10%, то ~10 дней.
    const liquidationDays = ratio > 0 ? Math.ceil(1 / ratio) : null;

    // Определение уровня ликвидности
    const liquidityLevel = this.determineLiquidityLevel(dailyTurnover, ratio);

    // Предупреждения
    let warning: string | undefined;
    let advice: string | undefined;

    if (liquidityLevel === 'CRITICAL') {
      warning =
        `Критическая ликвидность: ${name} оборот ${this.formatRub(dailyTurnover)}/день. ` +
        `Позиция ${this.formatRub(marketValue)} — оборот составляет ${ratio.toFixed(2)}% от стоимости. ` +
        'Возможен выход только с дисконтом 5-15%.';
      advice =
        'Не наращивать позицию. При необходимости выхода — продавать частями.';
    } else if (liquidityLevel === 'LOW') {
      warning =
        `Низкая ликвидность: ${name} оборот ${this.formatRub(dailyTurnover)}/день. ` +
        `Позиция ${this.formatRub(marketValue)} — оборот ${ratio.toFixed(2)}% от стоимости.`;
      advice = 'Ограничить наращивание позиции. Продавать частями.';
    } else if (liquidityLevel === 'MEDIUM') {
      advice =
        'Ликвидность умеренная. Позицию можно продать за 1-3 дня без значительной просадки.';
    }
    // HIGH — без предупреждений
    // UNKNOWN — предупреждение только на уровне портфеля (см. ниже)

    return {
      ticker,
      name,
      marketValue,
      dailyTurnover,
      liquidityLevel,
      turnoverToValueRatio: ratio,
      liquidationDays,
      warning,
      advice,
    };
  }

  /**
   * Определить уровень ликвидности на основе порогов.
   */
  private determineLiquidityLevel(
    dailyTurnover: number,
    ratio: number,
  ): LiquidityLevel {
    // HIGH: оборот > 1 млрд ИЛИ > 10% позиции
    if (
      dailyTurnover >= this.thresholds.highTurnoverMin ||
      ratio >= this.thresholds.highRatioMin
    ) {
      return 'HIGH';
    }

    // MEDIUM: оборот > 100 млн ИЛИ > 1% позиции
    if (
      dailyTurnover >= this.thresholds.mediumTurnoverMin ||
      ratio >= this.thresholds.mediumRatioMin
    ) {
      return 'MEDIUM';
    }

    // LOW: оборот > 10 млн ИЛИ > 0.1% позиции
    if (
      dailyTurnover >= this.thresholds.lowTurnoverMin ||
      ratio >= this.thresholds.lowRatioMin
    ) {
      return 'LOW';
    }

    // CRITICAL: всё остальное
    return 'CRITICAL';
  }

  /**
   * Определить статус ликвидности портфеля.
   */
  private determinePortfolioStatus(
    criticalValue: number,
    lowValue: number,
    totalValue: number,
    deadAssetsCount: number,
  ): 'HEALTHY' | 'WARNING' | 'CRITICAL' {
    if (totalValue === 0) return 'HEALTHY';

    const criticalPct = (criticalValue / totalValue) * 100;
    const lowPct = (lowValue / totalValue) * 100;

    if (criticalPct > 10 || deadAssetsCount >= 3) {
      return 'CRITICAL';
    }

    if (criticalPct > 5 || lowPct > 30 || deadAssetsCount >= 1) {
      return 'WARNING';
    }

    return 'HEALTHY';
  }

  /**
   * Форматирование суммы в рублях.
   */
  private formatRub(value: number): string {
    if (value >= 1e9) return (value / 1e9).toFixed(1) + ' млрд ₽';
    if (value >= 1e6) return (value / 1e6).toFixed(1) + ' млн ₽';
    if (value >= 1e3) return (value / 1e3).toFixed(1) + ' тыс ₽';
    return value.toLocaleString('ru-RU') + ' ₽';
  }
}
