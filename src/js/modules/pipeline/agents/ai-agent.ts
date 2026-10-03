import type { DataAgentOutput } from './data-agent.js';
import type { ResearchAgentOutput } from './research-agent.js';
import type { AnalysisAgentOutput } from './analysis-agent.js';
import type {
  AssetAnalysis,
  PortfolioReportData,
} from '../../portfolio-math/portfolio-math.js';
import type { MacroResearch } from '../../research/types.js';
import type {
  RawAIJson,
  ValidationResult,
} from '../../ai-advisor/structured-ai-recommendation.js';
import { InvestmentThesisEngine } from '../../research/investment-thesis/investment-thesis-engine.js';
import type { InvestmentThesisResult } from '../../research/investment-thesis/types.js';
import { AiClient } from '../../ai-advisor/ai-client.js';
import {
  buildDeterministicAssetData,
  buildStructuredAIRecommendation,
  type StructuredAIAssetRecommendation,
} from '../../ai-advisor/structured-ai-recommendation.js';
import { sanitizeAiNarrative } from '../../ai-advisor/ollama-manager.js';
import { postProcessAiText } from '../../ai-advisor/ai-validation.js';
import { stripJsonBlockFromAiText } from '../../ai-advisor/json-sanitizer.js';
import { buildPortfolioAssetContext } from '../../ai-advisor/snapshot-builder.js';
import { hasValue } from '../../research/helpers.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import { query as memoryQuery, getStats } from '../ai-memory/index.js';

// ──────────────────────────────────────────────
// 1. AI Agent output types
// ──────────────────────────────────────────────

/** Результат генерации thesis для одного актива */
export interface AssetThesisResult {
  ticker: string;
  result: InvestmentThesisResult;
}

/** Результат AI-клиента */
export interface AiClientResult {
  /** Текст рекомендации */
  text: string;
  /** Использованная модель */
  modelUsed: string;
  /** Успешно ли */
  success: boolean;
  /** Ошибка (если success=false) */
  error?: string;
  /** Структурированный JSON (если модель вернула) */
  structuredJson?: unknown;
  /** Валидация структурированного JSON */
  structuredValidation?: unknown;
}

/**
 * Полные выходные данные AI Agent.
 * Передаются в Notification Agent.
 */
export interface AiAgentOutput {
  /** Инвестиционные тезисы по каждому активу */
  thesisResults: Map<string, InvestmentThesisResult>;
  /** AI-рекомендация (текст) */
  aiNarrative: string;
  /** Результат AI-клиента */
  aiClientResult: AiClientResult;
  /** Структурированные рекомендации по каждому активу */
  structuredRecommendations: Map<string, StructuredAIAssetRecommendation>;
  /** Предупреждения валидации */
  validationWarnings: string[];
}

// ──────────────────────────────────────────────
// 2. AI Agent
// ──────────────────────────────────────────────

/**
 * AI Agent — генерация AI-анализа и рекомендаций.
 *
 * Задачи:
 * - Генерация InvestmentThesis для каждого актива
 * - Вызов AiClient (GigaChat via ProxyAPI) для динамического отчёта
 * - Пост-обработка AI-текста (санитизация, валидация)
 * - Построение структурированных рекомендаций
 *
 * AI-запрос выполняется асинхронно — не блокирует основной поток.
 */
export class AiAgent extends AgentBase {
  constructor(config?: AgentConfig) {
    super(config ?? { name: 'AiAgent' });
  }

  /**
   * Загрузить контекст из памяти ИИ.
   * Возвращает строку с последними записями из оперативной и стратегической памяти.
   */
  private async loadMemoryContext(): Promise<string> {
    try {
      const memoryStats = getStats();
      let context = '## Память ИИ\n';
      context += `Записей: ${memoryStats.operationalCount} оперативных, ${memoryStats.strategicCount} стратегических\n`;

      // КРАТКИЕ KPI-снимки — только последние 2
      const kpiResult = await memoryQuery({
        types: ['kpi_snapshot'],
        maxResults: 2,
      });

      if (kpiResult.strategicEntries.length > 0) {
        context += '\nKPI:\n';
        for (const entry of kpiResult.strategicEntries.slice(0, 2)) {
          if (entry.raw) {
            context += `- ${entry.date}: ${entry.raw.totalValue}₽, ${entry.raw.returnPercent}%\n`;
          }
        }
      }

      // КРАТКАЯ сводка по прошлым pipeline — без полного контента
      const result = await memoryQuery({
        types: ['pipeline_result'],
        maxResults: 1,
      });

      if (result.operationalEntries.length > 0) {
        // Только дата (без полного текста)
        context += `\nПоследний pipeline: ${result.operationalEntries[0]!.createdAt}\n`;
      }

      console.log('[AiAgent] Контекст из памяти загружен');
      return context;
    } catch (err) {
      console.warn('[AiAgent] Ошибка загрузки контекста из памяти:', err);
      return '';
    }
  }

  protected async executeInternal(input: {
    data: DataAgentOutput;
    research: ResearchAgentOutput;
    analysis: AnalysisAgentOutput;
  }): Promise<AiAgentOutput> {
    console.log('[AiAgent] >>> Начало AI-анализа');

    // Загружаем контекст из памяти ИИ
    const memoryContext = await this.loadMemoryContext();
    if (memoryContext) {
      console.log(
        '[AiAgent] Контекст из памяти:',
        memoryContext.substring(0, 200),
      );
    }

    const { data, research, analysis } = input;
    const { macroGoals } = data;
    const { snapshots } = research;
    const { portfolioAnalysis, riskValidation, income } = analysis;

    if (portfolioAnalysis.assetsAnalysis.length === 0) {
      console.warn('[AiAgent] Нет активов для AI-анализа');
      return this.emptyResult();
    }

    // Шаг 2: Генерация InvestmentThesis для каждого актива
    const thesisEngine = new InvestmentThesisEngine();
    const thesisResults = new Map<string, InvestmentThesisResult>();
    let freshMacroData: {
      keyRate: number;
      source: string;
      asOf: string;
      isFresh: boolean;
    } | null = null;

    for (const asset of portfolioAnalysis.assetsAnalysis) {
      const snapshot = snapshots.get(asset.ticker);
      if (!snapshot) {
        console.warn(`[AiAgent] Нет research snapshot для ${asset.ticker}`);
        continue;
      }

      const portfolioCtx = buildPortfolioAssetContext(asset, {
        totalPortfolioValue: macroGoals.totalBalance,
      });

      try {
        // InvestmentThesisEngine работает синхронно
        const result = thesisEngine.generate({
          snapshot: snapshot.snapshot,
          portfolioContext: portfolioCtx,
        });
        thesisResults.set(asset.ticker, result);

        // Извлекаем свежие макро-данные из первого snapshot
        if (!freshMacroData && snapshot.snapshot.macroResearch) {
          freshMacroData = this.extractMacroDataContext(
            snapshot.snapshot.macroResearch,
          );
        }
      } catch (err) {
        console.error(
          `[AiAgent] Ошибка thesis для ${asset.ticker}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    console.log(
      '[AiAgent] Сформировано thesis для ' +
        thesisResults.size +
        ' из ' +
        portfolioAnalysis.assetsAnalysis.length +
        ' активов',
    );

    // Шаг 3: Вызов AiClient (GigaChat)
    const portfolioReportData: PortfolioReportData = {
      macro: data.macroGoals,
      assetsAnalysis: portfolioAnalysis.assetsAnalysis,
      freeStocksPoolPercent: 0,
    };

    // Реальные доли акций и облигаций из анализа портфеля
    const actualStocksPct =
      Math.round(
        portfolioAnalysis.assetsAnalysis
          .filter(
            (a) => a.assetType === 'А' || a.assetType === 'Акция',
          )
          .reduce((sum, a) => sum + a.currentPercent, 0) * 100,
      ) / 100;
    const actualBondsPct =
      Math.round(
        portfolioAnalysis.assetsAnalysis
          .filter(
            (a) => a.assetType === 'О' || a.assetType === 'Облигация',
          )
          .reduce((sum, a) => sum + a.currentPercent, 0) * 100,
      ) / 100;

    const aiClientResult = await this.callAiClient(
      portfolioReportData,
      income,
      riskValidation,
      new Date().toISOString(),
      freshMacroData,
      thesisResults,
      portfolioAnalysis.assetsAnalysis,
      data.historicalTrades,
      data.investedFunds,
      data.accounts,
      memoryContext,
      { stocks: actualStocksPct, bonds: actualBondsPct },
    );

    // Шаг 4: Пост-обработка AI-текста
    let aiNarrative = aiClientResult.text || '';
    const validationWarnings: string[] = [];

    if (aiClientResult.success && aiNarrative) {
      // Санитизация
      const sanitized = sanitizeAiNarrative(aiNarrative);

      // Пост-обработка (валидация направлений, исключённых активов)
      const postProcessResult = postProcessAiText(
        sanitized,
        portfolioAnalysis.assetsAnalysis,
      );

      // Финальная очистка от raw structured JSON (```json, {"ticker": ...})
      // перед передачей narrative в дашборд/Markdown/Telegram
      aiNarrative = stripJsonBlockFromAiText(postProcessResult.cleanedText);
      validationWarnings.push(...postProcessResult.warnings);
    }

    // Шаг 5: Структурированные рекомендации
    const structuredRecommendations = new Map<
      string,
      StructuredAIAssetRecommendation
    >();

    for (const asset of portfolioAnalysis.assetsAnalysis) {
      const det = buildDeterministicAssetData(asset, []);
      const structured = buildStructuredAIRecommendation(
        det,
        aiClientResult.structuredJson as RawAIJson | null,
        aiClientResult.structuredValidation as ValidationResult | null,
      );
      structuredRecommendations.set(asset.ticker, structured);
    }

    console.log(
      `[AiAgent] ✅ AI-анализ завершён: модель=${aiClientResult.modelUsed}, ` +
        `успех=${aiClientResult.success}, thesis=${thesisResults.size}`,
    );

    return {
      thesisResults,
      aiNarrative,
      aiClientResult,
      structuredRecommendations,
      validationWarnings,
    };
  }

  // ── Helpers ──

  private async callAiClient(
    portfolioReportData: PortfolioReportData,
    income: AnalysisAgentOutput['income'],
    riskValidation: AnalysisAgentOutput['riskValidation'],
    _researchTimestamp: string,
    macroData: {
      keyRate: number;
      source: string;
      asOf: string;
      isFresh: boolean;
    } | null,
    thesisResults: Map<string, InvestmentThesisResult>,
    _assetsAnalysis: AssetAnalysis[],
    historicalTrades: DataAgentOutput['historicalTrades'],
    investedFunds: DataAgentOutput['investedFunds'],
    accounts: DataAgentOutput['accounts'],
    memoryContext: string,
    assetClassPercents: { stocks: number; bonds: number },
  ): Promise<AiClientResult> {
    const aiClient = new AiClient();

    // Строим MacroDataContext
    const aiMacroData = macroData ?? {
      keyRate: 0,
      source: 'NO_DATA',
      asOf: 'N/A',
      isFresh: false,
    };

    try {
      const result = await aiClient.generateDynamicReport(
        portfolioReportData,
        income,
        riskValidation,
        { md: '' }, // ordersData — не используется напрямую
        {
          financial: {
            currentAssets: 0,
            freeCash: 0,
            contributedCapital: 0,
            currentEquityGap: 0,
            currentEquityGapPct: 0,
            historicalMarketResult: 0,
            snapshotTimestamp: new Date().toISOString(),
          },
          totalLiquidationValue: 0,
          totalBalanceValue: 0,
          accounts: [],
          assets: [],
        }, // portfolioSnapshot — placeholder
        aiMacroData,
        thesisResults,
        undefined, // newsContext
        assetClassPercents, // assetClassPercents
        {
          profitC10: historicalTrades.profitC10,
          profitC11: historicalTrades.profitC11,
          investedNet: investedFunds.totalNet,
          totalPurchases: historicalTrades.totalPurchasesSum,
          totalSales: historicalTrades.totalSalesSum,
          commission: historicalTrades.totalHistoricalCommission,
        },
        accounts.map((a) => ({ name: a.name, value: a.value })),
        memoryContext,
      );

      return {
        text: result.text,
        modelUsed: result.modelUsed,
        success: result.success,
        error: result.error,
        structuredJson: result.structuredJson,
        structuredValidation: result.structuredValidation,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[AiAgent] Ошибка AiClient: ${errorMsg}`);

      return {
        text: '',
        modelUsed: 'ERROR',
        success: false,
        error: errorMsg,
      };
    }
  }

  private extractMacroDataContext(macroResearch: MacroResearch): {
    keyRate: number;
    source: string;
    asOf: string;
    isFresh: boolean;
  } {
    const keyRate = hasValue(macroResearch.keyRate)
      ? macroResearch.keyRate.value
      : 0;

    return {
      keyRate,
      source: 'Bank of Russia (официальный источник)',
      asOf: new Date().toLocaleDateString('ru-RU'),
      isFresh: true,
    };
  }

  private emptyResult(): AiAgentOutput {
    return {
      thesisResults: new Map(),
      aiNarrative: '',
      aiClientResult: {
        text: '',
        modelUsed: 'NONE',
        success: false,
        error: 'No assets to analyze',
      },
      structuredRecommendations: new Map(),
      validationWarnings: [],
    };
  }
}
