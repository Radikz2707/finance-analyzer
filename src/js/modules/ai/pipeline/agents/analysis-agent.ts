import type { DataAgentOutput } from './data-agent.js';
import type { AssetAnalysis } from '../../../portfolio/portfolio-math/portfolio-math.js';
import { PortfolioMathModule } from '../../../portfolio/portfolio-math/portfolio-math.js';
import { PortfolioValidator } from '../../../portfolio/portfolio-math/portfolio-validator.js';
import { calculatePortfolioIncome } from '../../../ai/ai-advisor/income-calculator.js';
import { PriceAlertsModule } from '../../../ai/ai-advisor/price-alerts.js';
import type { CurrentAsset } from '../../../data/xlsx-parser/xlsx-parser.js';
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
    totalLiquidationValue: number;
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
    kind?: 'LTM' | 'DECLARED' | 'UNKNOWN';
    source?:
      'BROKER' | 'MOEX_ISS' | 'SMARTLAB' | 'EXCEL_DIVIDENDS' | 'EXCEL_DECLARED';
    asOf?: string;
  }>;
  totalNkd: number;
  totalDivs: number;
  totalDivsNet: number;
  declaredDivs?: number;
  declaredDivsNet?: number;
  declaredStocks?: Array<{
    name: string;
    ticker: string;
    quantity: number;
    rate: number;
    grossIncome: number;
    netIncome: number;
    kind?: 'LTM' | 'DECLARED' | 'UNKNOWN';
    source?:
      'BROKER' | 'MOEX_ISS' | 'SMARTLAB' | 'EXCEL_DIVIDENDS' | 'EXCEL_DECLARED';
    asOf?: string;
  }>;
  dividendKind?: 'LTM' | 'DECLARED' | 'UNKNOWN' | 'MIXED';
  dividendSource?:
    | 'BROKER'
    | 'MOEX_ISS'
    | 'SMARTLAB'
    | 'EXCEL_DIVIDENDS'
    | 'EXCEL_DECLARED'
    | 'MIXED'
    | null;
  excelAsOf?: string | null;
  dividendWarnings?: string[];
  /** OK / EMPTY / UNAVAILABLE / MIXED — статус подтверждения LTM-дивидендов. */
  dividendDataStatus?: 'OK' | 'EMPTY' | 'UNAVAILABLE' | 'MIXED' | null;

  // ─── Купоны LTM (облигации, по графику MOEX ISS) ───
  totalCouponsGross?: number;
  totalCouponsNet?: number;
  couponBonds?: Array<{
    ticker: string;
    ltmPerBond: number | null;
    count: number;
    asOf: string | null;
    source: string;
    status: string;
    isFloaterEstimate: boolean;
  }>;
  couponStatus?: 'OK' | 'EMPTY' | 'UNAVAILABLE' | 'MIXED' | null;
  couponWarnings?: string[];
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
    const freeCash = macroGoals.freeCash ?? 0;
    const totalLiq = this.calculateTotalLiquidationValue(assets, freeCash);

    // ─── Пересчёт liquidationPercent от allocationBaseValue ───
    // liquidationPercent должен считаться от полной базы (рыночная + кэш + НКД),
    // чтобы быть сопоставимым с targetPercent из Excel.
    const marketValueOnly = assets.reduce(
      (sum, a) => sum + (a.quantity ?? 0) * (a.currentPrice ?? 0),
      0,
    );
    for (const asset of assets) {
      const assetValue = (asset.quantity ?? 0) * (asset.currentPrice ?? 0);
      asset.liquidationPercent =
        totalLiq > 0 ? (assetValue / totalLiq) * 100 : 0;
    }

    // ─── Диагностика: liquidation vs balance ───
    const excelTotalBalance = macroGoals.totalBalance ?? 0;
    const liqBalanceDiff = excelTotalBalance - totalLiq;
    if (excelTotalBalance > 0 && Math.abs(liqBalanceDiff) > 1000) {
      console.warn(
        `[DIAGNOSTIC] allocationBaseValue=${Math.round(totalLiq).toLocaleString('ru-RU')}₽ (рыночная ${Math.round(marketValueOnly).toLocaleString('ru-RU')}₽ + кэш ${Math.round(freeCash).toLocaleString('ru-RU')}₽ + НКД), ` +
          `Excel totalBalance=${Math.round(excelTotalBalance).toLocaleString('ru-RU')}₽, ` +
          `расхождение=${Math.round(liqBalanceDiff).toLocaleString('ru-RU')}₽ (${((liqBalanceDiff / excelTotalBalance) * 100).toFixed(1)}%)`,
      );
      // Активы с currentPrice = 0
      const zeroPriceAssets = assets.filter(
        (a) => (a.currentPrice ?? 0) === 0 && (a.quantity ?? 0) > 0,
      );
      if (zeroPriceAssets.length > 0) {
        console.warn(
          `[DIAGNOSTIC] Активы с currentPrice=0 (${zeroPriceAssets.length} шт.):`,
          zeroPriceAssets
            .map((a) => `${a.ticker} (qty=${a.quantity}, type=${a.assetType})`)
            .join(', '),
        );
      }
      // Активы с наибольшим вкладом в расхождение
      const sortedByValue = [...assets]
        .map((a) => ({
          ticker: a.ticker,
          quantity: a.quantity ?? 0,
          currentPrice: a.currentPrice ?? 0,
          value: (a.quantity ?? 0) * (a.currentPrice ?? 0),
        }))
        .sort((a, b) => b.value - a.value);
      console.warn(
        '[DIAGNOSTIC] Топ-5 активов по стоимости:',
        sortedByValue
          .slice(0, 5)
          .map(
            (a) =>
              `${a.ticker}: ${a.quantity}×${a.currentPrice}=${Math.round(a.value).toLocaleString('ru-RU')}₽`,
          )
          .join(', '),
      );
    }

    const portfolioAnalysis = math.analyzePortfolio(
      macroGoals,
      assets,
      totalLiq,
    );

    // Шаг 2: Валидация рисков
    const validator = new PortfolioValidator();
    const riskValidation = validator.validateLimits(macroGoals, assets);

    // Шаг 3: Расчёт доходов (дивиденды + купоны).
    // LTM-дивиденды из MOEX ISS догружаются только там, где Excel пуст.
    const income = await calculatePortfolioIncome(assets, { moexLtm: true });

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
    freeCash: number,
  ): number {
    // Рыночная стоимость бумаг
    const marketValue = assets.reduce((sum, asset) => {
      const liqValue = (asset.quantity ?? 0) * (asset.currentPrice ?? 0);
      return sum + liqValue;
    }, 0);
    // НКД по всем активам
    const totalNkd = assets.reduce((sum, asset) => {
      return sum + (asset.nkdRub ?? 0);
    }, 0);
    // Allocation base = рыночная стоимость + кэш + НКД
    // (кэш и НКД добавляются, т.к. они часть ликвидной базы для ребалансировки)
    return marketValue + freeCash + totalNkd;
  }

  private emptyResult(): AnalysisAgentOutput {
    return {
      portfolioAnalysis: {
        assetsAnalysis: [],
        macro: {
          totalBalance: 0,
          totalLiquidationValue: 0,
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
