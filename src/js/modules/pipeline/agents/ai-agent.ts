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
import { positionsRepo } from '../../db-manager/db-manager.js';
import {
  getRecoveryOnlyTickers,
  buildGuardrailsContext,
} from '../guardrails/guardrails.js';
import { getLogger } from '../../logger/index.js';
import {
  agreeMathAndAi,
  isExecutionAllowed,
  type MathAiAgreement,
} from '../../ai-advisor/math-ai-agreement.js';

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
  /** Результаты согласования PortfolioMath и ИИ по каждому активу */
  mathAiAgreements: Map<string, MathAiAgreement>;
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
  private readonly log = getLogger('ai-agent');

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

      this.log.info('[AiAgent] Контекст из памяти загружен');
      return context;
    } catch (err) {
      this.log.warn('[AiAgent] Ошибка загрузки контекста из памяти:', err);
      return '';
    }
  }

  protected async executeInternal(input: {
    data: DataAgentOutput;
    research: ResearchAgentOutput;
    analysis: AnalysisAgentOutput;
  }): Promise<AiAgentOutput> {
    this.log.info('[AiAgent] >>> Начало AI-анализа');

    // Загружаем контекст из памяти ИИ
    const memoryContext = await this.loadMemoryContext();
    if (memoryContext) {
      this.log.info(
        '[AiAgent] Контекст из памяти:',
        memoryContext.substring(0, 200),
      );
    }

    const { data, research, analysis } = input;
    const { macroGoals } = data;
    const { snapshots } = research;
    const { portfolioAnalysis, riskValidation, income } = analysis;

    if (portfolioAnalysis.assetsAnalysis.length === 0) {
      this.log.warn('[AiAgent] Нет активов для AI-анализа');
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
        this.log.warn(`[AiAgent] Нет research snapshot для ${asset.ticker}`);
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
        this.log.error(
          `[AiAgent] Ошибка thesis для ${asset.ticker}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    this.log.info(
      '[AiAgent] Сформировано thesis для ' +
        thesisResults.size +
        ' из ' +
        portfolioAnalysis.assetsAnalysis.length +
        ' активов',
    );

    // Шаг 3: Guardrails — проверка RECOVERY_ONLY
    const recoveryTickers = getRecoveryOnlyTickers(positionsRepo);
    const guardrailsContext = buildGuardrailsContext(
      recoveryTickers,
      positionsRepo,
    );
    if (recoveryTickers.length > 0) {
      this.log.warn(
        '[GUARDRAILS] ⚠️ Активы в режиме RECOVERY_ONLY:',
        recoveryTickers.join(', '),
      );
    }

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
          .filter((a) => a.assetType === 'А' || a.assetType === 'Акция')
          .reduce((sum, a) => sum + a.currentPercent, 0) * 100,
      ) / 100;
    const actualBondsPct =
      Math.round(
        portfolioAnalysis.assetsAnalysis
          .filter((a) => a.assetType === 'О' || a.assetType === 'Облигация')
          .reduce((sum, a) => sum + a.currentPercent, 0) * 100,
      ) / 100;

    // Вызов AiClient с retry-логикой (до 3 попыток)
    let aiClientResult: Awaited<ReturnType<typeof this.callAiClient>> = {
      text: '',
      modelUsed: 'PENDING',
      success: false,
    };
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        aiClientResult = await this.callAiClient(
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
          guardrailsContext,
        );

        if (aiClientResult.success) {
          this.log.info(`[AiAgent] ✅ AiClient успешен с попытки ${attempt}`);
          break;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.log.warn(
          `[AiAgent] ⚠️ Попытка ${attempt}/${maxRetries} неудачна: ${lastError.message}`,
        );
      }

      // Пауза перед retry (экспоненциальная: 1с, 2с, 4с)
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        this.log.info(`[AiAgent] ⏳ Пауза ${delayMs}мс перед retry...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Если все попытки неудачны — используем пустой результат
    if (!aiClientResult || !aiClientResult.success) {
      this.log.error(
        `[AiAgent] ❌ AiClient не успешен после ${maxRetries} попыток: ${lastError?.message}`,
      );
      aiClientResult = {
        text: '',
        modelUsed: 'FAILED',
        success: false,
        error: lastError?.message ?? 'Unknown error',
      };
    }

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

    // Шаг 5: Структурированные рекомендации с изоляцией по тикерам
    const structuredRecommendations = new Map<
      string,
      StructuredAIAssetRecommendation
    >();
    const mathAiAgreements = new Map<string, MathAiAgreement>();

    // Извлекаем тикер из AI JSON (если есть)
    const rawAiJson = aiClientResult.structuredJson as RawAIJson | null;
    const aiJsonTicker = rawAiJson?.ticker?.toUpperCase() ?? null;

    for (const asset of portfolioAnalysis.assetsAnalysis) {
      const assetTicker = asset.ticker.toUpperCase();

      // ─── Изоляция по тикеру ───
      // Если AI вернул JSON, проверяем, что тикер совпадает с текущим активом
      let aiJsonForAsset: RawAIJson | null = null;

      if (rawAiJson) {
        // Проверяем точное совпадение тикера
        if (aiJsonTicker === assetTicker) {
          aiJsonForAsset = rawAiJson;
        } else {
          // Тикер не совпадает — используем детерминированные данные
          // для генерации рекомендации (fallback)
          this.log.debug(
            `[AiAgent] [TIKER_ISOLATION] AI recommendation ticker=${aiJsonTicker} ` +
              `does not match asset ticker=${assetTicker}, using deterministic fallback`,
          );
        }
      }

      const det = buildDeterministicAssetData(asset, []);
      const structured = buildStructuredAIRecommendation(
        det,
        aiJsonForAsset,
        aiClientResult.structuredValidation as ValidationResult | null,
      );

      // Если AI не вернул рекомендацию для актива, используем детерминированную
      if (!structured.recommendedAction) {
        this.log.info(
          `[AiAgent] [FALLBACK] ${asset.ticker}: AI не вернул рекомендацию, ` +
            `используем PortfolioMath: ${asset.status}`,
        );
        structured.recommendedAction =
          asset.status as StructuredAIAssetRecommendation['recommendedAction'];
        structured.confidence = 0.5;
        structured.rationale = 'Рекомендация на основе PortfolioMath (AI не вернул рекомендацию)';
      }

      structuredRecommendations.set(asset.ticker, structured);

      // ─── Согласование PortfolioMath и ИИ ───
      const mathAction = asset.status; // PortfolioMathStatus
      const aiAction = structured.recommendedAction; // AiAction | null
      const mathAgreement = structured.agreementWithPortfolioMath;

      const agreement = agreeMathAndAi(
        asset.ticker,
        mathAction,
        aiAction,
        mathAgreement,
      );

      // Проверяем исполнение с учётом защитных ограничений
      const executionAllowed = isExecutionAllowed(
        agreement,
        asset.holdOnly || false,
        det.marketDataValid,
        det.executionBlocked,
      );

      agreement.executionAllowed = executionAllowed;

      // Логируем результат согласования
      if (agreement.conflict) {
        this.log.warn(
          `[AiAgent] [CONFLICT] ${asset.ticker}: ` +
            `math=${agreement.conflictDetails?.mathDescription}, ` +
            `ai=${agreement.conflictDetails?.aiDescription}, ` +
            `severity=${agreement.conflictDetails?.severity}, ` +
            'executionAllowed=false',
        );
      } else {
        this.log.info(
          `[AiAgent] [AGREEMENT] ${asset.ticker}: ` +
            `math=${agreement.mathAction}, ai=${agreement.aiAction}, ` +
            `final=${agreement.finalAction}, status=${agreement.status}, ` +
            `executionAllowed=${executionAllowed}`,
        );
      }

      mathAiAgreements.set(asset.ticker, agreement);
    }

    this.log.info(
      `[AiAgent] ✅ AI-анализ завершён: модель=${aiClientResult.modelUsed}, ` +
        `успех=${aiClientResult.success}, thesis=${thesisResults.size}`,
    );

    return {
      thesisResults,
      aiNarrative,
      aiClientResult,
      structuredRecommendations,
      mathAiAgreements,
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
    guardrailsContext: string,
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
        guardrailsContext,
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
      this.log.error(`[AiAgent] Ошибка AiClient: ${errorMsg}`);

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
      mathAiAgreements: new Map(),
      validationWarnings: [],
    };
  }
}
