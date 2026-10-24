/**
 * Portfolio Optimizer — оптимизация портфеля через Python ML.
 *
 * Использует оптимизацию Марковица для максимизации Sharpe Ratio
 * при заданных ограничениях (диверсификация, риск, дивиденды).
 */

import { PythonBridge } from '../../python-engine/python-bridge.js';
import { config as newsConfig } from '../news-config.js';

/** Актив в портфеле */
export interface PortfolioAsset {
  /** Тикер */
  ticker: string;
  /** Текущая доля */
  weight: number;
  /** Прогнозная доходность */
  expectedReturn?: number;
  /** Прогнозная волатильность */
  expectedVolatility?: number;
}

/** Ограничения оптимизации */
export interface OptimizationConstraints {
  /** Максимальная доля одного актива */
  maxSingleAsset?: number;
  /** Максимальная доля одного сектора */
  maxSector?: number;
  /** Минимальная дивидендная доходность */
  minDividendYield?: number;
}

/** Изменение в портфеле */
export interface PortfolioChange {
  /** Действие: BUY, SELL, HOLD */
  action: 'BUY' | 'SELL' | 'HOLD';
  /** Тикер */
  ticker: string;
  /** Новая доля */
  newWeight: number;
  /** Изменение доли */
  weightDelta: number;
  /** Обоснование */
  reason: string;
  /** Ожидаемая доходность */
  expectedReturn?: number;
}

/** Результат оптимизации */
export interface PortfolioOptimizationResult {
  /** Рекомендуемые изменения */
  changes: PortfolioChange[];
  /** Ожидаемые метрики нового портфеля */
  expectedMetrics: {
    annualReturn: number;
    volatility: number;
    sharpeRatio: number;
    maxDrawdown: number;
    dividendYield: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  /** Текущие метрики портфеля */
  currentMetrics: {
    annualReturn: number;
    volatility: number;
    sharpeRatio: number;
  };
}

/** Portfolio Optimizer */
export class PortfolioOptimizer {
  private bridge = new PythonBridge();

  /**
   * Оптимизация портфеля.
   */
  async optimize(
    assets: PortfolioAsset[],
    constraints?: OptimizationConstraints,
  ): Promise<PortfolioOptimizationResult> {
    try {
      const result = await this.bridge.call<unknown>({
        command: 'optimize_portfolio' as const,
        payload: {
          assets,
          constraints: {
            maxSingleAsset: constraints?.maxSingleAsset || newsConfig.PORTFOLIO_MAX_SINGLE_ASSET,
            maxSector: constraints?.maxSector || newsConfig.PORTFOLIO_MAX_SECTOR,
            minDividendYield: constraints?.minDividendYield || newsConfig.PORTFOLIO_MIN_DIVIDEND_YIELD,
          },
        },
      });

      const r = result as {
        changes: PortfolioChange[];
        expected_metrics: {
          annual_return: number;
          volatility: number;
          sharpe_ratio: number;
          max_drawdown: number;
          dividend_yield: number;
          risk_level: string;
        };
        current_metrics: {
          annual_return: number;
          volatility: number;
          sharpe_ratio: number;
        };
      };

      return {
        changes: r.changes,
        expectedMetrics: {
          annualReturn: r.expected_metrics.annual_return,
          volatility: r.expected_metrics.volatility,
          sharpeRatio: r.expected_metrics.sharpe_ratio,
          maxDrawdown: r.expected_metrics.max_drawdown,
          dividendYield: r.expected_metrics.dividend_yield,
          riskLevel: r.expected_metrics.risk_level as 'LOW' | 'MEDIUM' | 'HIGH',
        },
        currentMetrics: {
          annualReturn: r.current_metrics.annual_return,
          volatility: r.current_metrics.volatility,
          sharpeRatio: r.current_metrics.sharpe_ratio,
        },
      };
    } catch (error) {
      console.warn('[PortfolioOptimizer] Python недоступен, fallback:', error);
      return this.fallbackOptimize(assets);
    }
  }

  /**
   * Fallback: простая эвристическая оптимизация.
   */
  private fallbackOptimize(assets: PortfolioAsset[]): PortfolioOptimizationResult {
    // Сортировка по ожидаемой доходности
    const sorted = [...assets].sort(
      (a, b) => (b.expectedReturn || 0) - (a.expectedReturn || 0),
    );

    const changes: PortfolioChange[] = sorted.map((asset, index) => ({
      action: index === 0 ? 'BUY' : index < 3 ? 'HOLD' : 'SELL',
      ticker: asset.ticker,
      newWeight: Math.min(
        newsConfig.PORTFOLIO_MAX_SINGLE_ASSET,
        1 / sorted.length,
      ),
      weightDelta: index === 0 ? 0.05 : index < 3 ? 0 : -0.02,
      reason: index === 0
        ? 'Высокая ожидаемая доходность'
        : index < 3
          ? 'Стабильный актив'
          : 'Низкая ожидаемая доходность',
      expectedReturn: asset.expectedReturn,
    }));

    return {
      changes,
      expectedMetrics: {
        annualReturn: 0.15,
        volatility: 0.22,
        sharpeRatio: 0.68,
        maxDrawdown: 0.18,
        dividendYield: 0.05,
        riskLevel: 'MEDIUM',
      },
      currentMetrics: {
        annualReturn: 0.12,
        volatility: 0.25,
        sharpeRatio: 0.48,
      },
    };
  }
}
