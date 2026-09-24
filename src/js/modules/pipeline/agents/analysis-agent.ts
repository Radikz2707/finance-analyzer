import type { DataAgentOutput } from './data-agent.js';
import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import { PortfolioMathModule } from '../../portfolio-math/portfolio-math.js';
import { PortfolioValidator } from '../../portfolio-math/portfolio-validator.js';
import { calculatePortfolioIncome } from '../../ai-advisor/income-calculator.js';
import { PriceAlertsModule } from '../../ai-advisor/price-alerts.js';
import type { CurrentAsset } from '../../xlsx-parser/xlsx-parser.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';

// ──────────────────────────────────────────────
// 1. Analysis Agent output types
// ──────────────────────────────────────────────

/** Результат анализа портфеля (из PortfolioMath) */
export interface PortfolioAnalysisResult {
  /** Анализ по каждому активу */
  assetsAnalysis: AssetAnalysis[];
  /** Макро-данные */
  macro: {
    totalBalance: number;
    freeCash: number;
    stocksDeficitRub: number;
    bondsDeficitRub: number;
  };
}

/** Результат валидации рисков */
export interface RiskValidationResult {
  isValid: boolean;
  errors: string[];
}

/** Дивиденды и купоны */
export interface PortfolioIncome {
  stocks: Array<{
    name: string;
    ticker: string;
    quantity: number;
    rate: number;
    grossIncome: number;
    netIncome: number;
  }>;
  totalNkd: number;
  totalDivs: number;
  totalDivsNet: number;
}

/** Проверка ценовых алертов */
export interface PipelinePriceAlert {
  ticker: string;
  name: string;
  currentPrice: number;
  alertLevel: 'ABOVE_HIGH' | 'BELOW_LOW';
  threshold: number;
}

/**
 * Полные выходные данные Analysis Agent.
 * Передаются в AI Agent и Notification Agent.
 */
export interface AnalysisAgentOutput {
  /** Анализ портфеля */
  portfolioAnalysis: PortfolioAnalysisResult;
  /** Валидация рисков */
  riskValidation: RiskValidationResult;
  /** Доходы (дивиденды + купоны) */
  income: PortfolioIncome;
  /** Ценовые алерты */
  priceAlerts: PipelinePriceAlert[];
  /** Форматированные алерты для Markdown */
  priceAlertsMd: string;
}

// ──────────────────────────────────────────────
// 2. Analysis Agent
// ──────────────────────────────────────────────

/**
 * Analysis Agent — математический анализ портфеля.
 *
 * Задачи:
 * - Анализ отклонений текущих долей от целевых (PortfolioMath)
 * - Приоритеты покупок по дефициту
 * - Концентрация рисков
 * - Валидация лимитов (PortfolioValidator)
 * - Расчёт дивидендов и купонов (IncomeCalculator)
 * - Проверка ценовых алертов (PriceAlerts)
 *
 * Все вычисления выполняются синхронно (без I/O).
 */
export class AnalysisAgent extends AgentBase {
  constructor(config?: AgentConfig) {
    super(config ?? { name: 'AnalysisAgent' });
  }

  protected async executeInternal(
    input: DataAgentOutput,
  ): Promise<AnalysisAgentOutput> {
    console.log('[AnalysisAgent] >>> Начало математического анализа');

    const { assets, macroGoals } = input;

    if (assets.length === 0) {
      console.warn('[AnalysisAgent] Нет активов для анализа');
      return this.emptyResult();
    }

    // Шаг 1: Математический анализ портфеля
    const math = new PortfolioMathModule();
    const totalLiq = this.calculateTotalLiquidationValue(assets);

    const portfolioAnalysis = math.analyzePortfolio(
      macroGoals,
      assets,
      totalLiq,
    );

    // Шаг 2: Валидация рисков
    const validator = new PortfolioValidator();
    const riskValidation = validator.validateLimits(macroGoals, assets);

    // Шаг 3: Расчёт доходов (дивиденды + купоны)
    const income = await calculatePortfolioIncome(assets);

    // Шаг 4: Проверка ценовых алертов
    const alertsModule = new PriceAlertsModule();
    const priceAlerts = alertsModule.checkPriceAlerts(
      portfolioAnalysis.assetsAnalysis,
    );
    const priceAlertsMd = alertsModule.formatAlertsMarkdown(priceAlerts);

    console.log(
      '[AnalysisAgent] ✅ Анализ завершён: ' +
      `${portfolioAnalysis.assetsAnalysis.length} активов, ` +
      `рисков: ${riskValidation.errors.length}, ` +
      `алертов: ${priceAlerts.length}`,
    );

    return {
      portfolioAnalysis,
      riskValidation,
      income,
      priceAlerts: priceAlerts as unknown as PipelinePriceAlert[],
      priceAlertsMd,
    };
  }

  // ── Helpers ──

  private calculateTotalLiquidationValue(
    assets: CurrentAsset[],
  ): number {
    return assets.reduce((sum, asset) => {
      const liqValue = (asset.quantity ?? 0) * (asset.currentPrice ?? 0);
      return sum + liqValue;
    }, 0);
  }

  private emptyResult(): AnalysisAgentOutput {
    return {
      portfolioAnalysis: {
        assetsAnalysis: [],
        macro: {
          totalBalance: 0,
          freeCash: 0,
          stocksDeficitRub: 0,
          bondsDeficitRub: 0,
        },
      },
      riskValidation: {
        isValid: true,
        errors: [],
      },
      income: {
        stocks: [],
        totalNkd: 0,
        totalDivs: 0,
        totalDivsNet: 0,
      },
      priceAlerts: [],
      priceAlertsMd: '',
    };
  }
}
