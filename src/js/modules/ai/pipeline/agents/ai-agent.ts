import type { DataAgentOutput } from './data-agent.js';
// research-agent.ts удалён — используем research-agent-v2
import type { ResearchV1Output } from './research-agent-v2/types.js';
import type { AnalysisAgentOutput } from './analysis-agent.js';
import { PortfolioConfig } from '../../../../config/portfolio-config.js';
import type {
  AssetAnalysis,
  PortfolioReportData,
} from '../../../portfolio/portfolio-math/portfolio-math.js';
import type { MacroResearch } from '../../../research/types.js';
import type {
  RawAIJson,
  ValidationResult,
} from '../../../ai/ai-advisor/structured-ai-recommendation.js';
import {
  InvestmentThesisEngine,
  type InvestmentThesisResult,
} from '../../../research/types.js';
import { AiClient } from '../../../ai/ai-advisor/ai-client.js';
import type { BondAnalysisResult } from '../../../ai/ai-advisor/prompt-templates.js';
import {
  buildBondCardInfo,
  buildDeterministicAssetData,
  buildStructuredAIRecommendation,
  validateStructuredAIJson,
  type StructuredAIAssetRecommendation,
} from '../../../ai/ai-advisor/structured-ai-recommendation.js';
import {
  detectForeignMetricMentions,
  validateNarrativeFundamentals,
  type FundamentalSibling,
} from '../../../ai/ai-advisor/fundamentals-guard.js';
import { sanitizeAiNarrative } from '../../../ai/ai-advisor/ollama-manager.js';
import {
  findCardDirectionConflicts,
  postProcessAiText,
} from '../../../ai/ai-advisor/ai-validation.js';
import { stripJsonBlockFromAiText } from '../../../ai/ai-advisor/json-sanitizer.js';
import { stripRecommendationsTableFromNarrative } from '../../../ai/ai-advisor/narrative-sanitizer.js';
import { restoreLostPercentRanges } from '../../../ai/ai-advisor/text-fixes.js';
import { buildPortfolioAssetContext } from '../../../ai/ai-advisor/snapshot-builder.js';
import { buildFinalConclusion } from '../../../ai/ai-advisor/report-builders.js';
import { hasValue } from '../../../research/types.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import { query as memoryQuery, getStats } from '../ai-memory/index.js';
import { positionsRepo } from '../../../db/db-manager/db-manager.js';
import {
  getRecoveryOnlyTickers,
  buildGuardrailsContext,
  checkGuardrails,
} from '../guardrails/guardrails.js';
import { getLogger } from '../../../shared/logger/index.js';
import type { PortfolioFundamentalsContext } from '../../../api/fundamentals/types.js';
import {
  agreeMathAndAi,
  formatAiVoteDiagnostic,
  isExecutionAllowed,
  type MathAiAgreement,
} from '../../../ai/ai-advisor/math-ai-agreement.js';
import {
  applyPolicyToNarrative,
  applyPolicyToRecommendation,
  isSellBlockedByPolicy,
  sanitizePolicyCardText,
  sanitizeBuyDirectivesForAction,
} from '../../../ai/ai-advisor/policy-text-guard.js';
import {
  parsePriceTriggers,
  evaluatePriceTriggers,
  type PriceTriggerEvaluation,
} from '../../../api/moex-quotes/price-triggers.js';
import { loadUserPolicy } from '../../../../config/user-policy.js';

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
  /** Дивидендные доходности акций из уже загруженного фундаментала */
  fundamentalsDividendYields?: Record<string, number>;
  /** Тот же fundamentals-контекст, что использовался для промпта карточек */
  portfolioFundamentals?: PortfolioFundamentalsContext;
  /** Структурированный анализ облигаций (тип купона, кредитный статус) */
  bondAnalyses?: BondAnalysisResult[];
  /** Структурированный JSON (если модель вернула) */
  structuredJson?: unknown;
  /** Массив структурированных JSON (один на каждый актив) */
  structuredJsonArray?: unknown[];
  /** Общий анализ портфеля из JSON-схемы */
  portfolioSummary?: string;
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
  /** Общий анализ портфеля из JSON-схемы (portfolioSummary) */
  portfolioSummary?: string;
  /** Результат AI-клиента */
  aiClientResult: AiClientResult;
  /** Структурированные рекомендации по каждому активу */
  structuredRecommendations: Map<string, StructuredAIAssetRecommendation>;
  /** Результаты согласования PortfolioMath и ИИ по каждому активу */
  mathAiAgreements: Map<string, MathAiAgreement>;
  /** Предупреждения валидации */
  validationWarnings: string[];
  /** Сводка новостей из Gatekeeper (передаётся в LLM) */
  newsContext: string;
  /**
   * Дивидендные доходности акций, уже загруженные AiClient.
   * Используются StrategistAgent для купонно-дивидендного якоря.
   */
  dividendYields?: Record<string, number>;
  /** Тот же fundamentals-контекст, что использовался для промпта карточек */
  portfolioFundamentals?: PortfolioFundamentalsContext;
  /**
   * Ценовые триггеры из машинного JSON-блока AI, сверенные с котировками
   * и no-sell политикой. Нет блока → пустой массив (лог structure=absent).
   */
  priceTriggers?: PriceTriggerEvaluation[];
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
    research: ResearchV1Output;
    analysis: AnalysisAgentOutput;
  }): Promise<AiAgentOutput> {
    this.log.info('[AiAgent] >>> Начало AI-анализа');

    // Загружаем контекст из памяти ИИ
    console.log('[AiAgent] >>> Начало AI-анализа');
    const memoryContext = await this.loadMemoryContext();
    if (memoryContext) {
      console.log(
        '[AiAgent] Контекст из памяти:',
        memoryContext.substring(0, 200),
      );
    }

    const { data, research, analysis } = input;
    const {
      macroGoals,
      historicalTrades,
      investedFunds,
      accounts,
      anomalies,
      liquidityAnalysis,
      quotes,
      news,
    } = data;
    const { snapshots = new Map() } = research;
    const { portfolioAnalysis, riskValidation, income } = analysis;
    const userPolicy = loadUserPolicy();

    // Строим lookup-карту ликвидности по тикеру
    const liquidityMap = new Map<
      string,
      {
        ticker: string;
        liquidityLevel: string;
        dailyTurnover: number | null;
        liquidationDays: number | null;
      }
    >();
    if (liquidityAnalysis && liquidityAnalysis.assets) {
      for (const asset of liquidityAnalysis.assets) {
        liquidityMap.set(asset.ticker.toUpperCase(), {
          ticker: asset.ticker,
          liquidityLevel: asset.liquidityLevel,
          dailyTurnover: asset.dailyTurnover,
          liquidationDays: asset.liquidationDays,
        });
      }
    }

    // Строим lookup-карту расширенных данных из Excel по тикеру
    const extendedDataMap = new Map<
      string,
      {
        minPrice?: number | null;
        maxPrice?: number | null;
        ratingDynamic?: number | null;
        ratingVolume?: number | null;
        ratingTotal?: number | null;
        rangePosition?: number | null;
        entrySignal?: string | null;
      }
    >();
    if (quotes) {
      for (const [ticker, quote] of Object.entries(quotes)) {
        extendedDataMap.set(ticker.toUpperCase(), {
          minPrice: quote.minPrice,
          maxPrice: quote.maxPrice,
          ratingDynamic: quote.ratingDynamic,
          ratingVolume: quote.ratingVolume,
          ratingTotal: quote.ratingTotal,
          rangePosition: quote.rangePosition,
          entrySignal: quote.entrySignal,
        });
      }
    }

    // Формируем структурированную сводку новостей для AI
    const newsContext = this.buildNewsContext(news);

    if (portfolioAnalysis.assetsAnalysis.length === 0) {
      console.warn('[AiAgent] Нет активов для AI-анализа');
      return this.emptyResult();
    }

    // Ключевая ставка: приоритет — data-agent (надёжный источник), fallback — research snapshot
    const dataKeyRate = data.keyRate ?? 0;
    let freshMacroData: {
      keyRate: number;
      source: string;
      asOf: string;
      isFresh: boolean;
    } | null = null;

    if (dataKeyRate > 0 && data.cbrRateData != null) {
      freshMacroData = {
        keyRate: dataKeyRate,
        source: data.cbrRateData.source,
        asOf: data.cbrRateData.date,
        isFresh: data.cbrRateData.isFresh,
      };
      console.log(
        '[CBR_FETCH] rate=' +
          dataKeyRate +
          '% ' +
          'source=' +
          freshMacroData.source +
          ' ' +
          'asOf=' +
          freshMacroData.asOf +
          ' ' +
          'isFresh=' +
          freshMacroData.isFresh,
      );
    }

    // Шаг 2: Генерация InvestmentThesis для каждого актива
    // InvestmentThesisEngine — заглушка, не влияет на решения;
    // по умолчанию отключён через thesisEnabled=false в pipelineConfig
    const thesisEnabled = PortfolioConfig.pipelineConfig.thesisEnabled;
    const thesisResults = new Map<string, InvestmentThesisResult>();

    if (thesisEnabled) {
      const thesisEngine = new InvestmentThesisEngine();

      for (const asset of portfolioAnalysis.assetsAnalysis) {
        const snapshot = snapshots.get(asset.ticker);
        if (!snapshot) {
          continue;
        }

        const portfolioCtx = buildPortfolioAssetContext(asset, {
          totalPortfolioValue: macroGoals.totalBalance,
        });

        try {
          const result = thesisEngine.generateFromSnapshot({
            snapshot: snapshot.snapshot,
            portfolioContext: portfolioCtx,
          });
          thesisResults.set(asset.ticker, result);
        } catch (err) {
          this.log.error(
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
    }

    // Извлекаем свежие макро-данные из первого snapshot (не зависит от thesis)
    if (!freshMacroData) {
      for (const asset of portfolioAnalysis.assetsAnalysis) {
        const snapshot = snapshots.get(asset.ticker);
        if (snapshot?.snapshot.macroResearch) {
          freshMacroData = this.extractMacroDataContext(
            snapshot.snapshot.macroResearch,
          );
          if (freshMacroData) break;
        }
      }
    }

    console.log('[AiAgent] DEBUG: thesis готово, Guardrails');

    // Шаг 3: Guardrails — проверка RECOVERY_ONLY + политика no-sell в тексте
    const recoveryTickers = getRecoveryOnlyTickers(positionsRepo);
    const guardrailsContext = buildGuardrailsContext(
      recoveryTickers,
      positionsRepo,
      undefined,
      userPolicy.noSellTickers,
    );
    if (recoveryTickers.length > 0) {
      this.log.warn(
        '[GUARDRAILS] ⚠️ Активы в режиме RECOVERY_ONLY:',
        recoveryTickers.join(', '),
      );
    }
    // Фиксируем, что превентивный слой реально включён: если в прогоне
    // появится [POLICY_TEXT] layer=sanator, значит промпт-правило не удержало.
    this.log.info(
      '[POLICY_TEXT] layer=prompt rule=no-sell ' +
        `tickers=${userPolicy.noSellTickers.join(',') || 'none'} ` +
        `types=${userPolicy.noSellAssetTypes.join(',') || 'none'}`,
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
          historicalTrades,
          investedFunds,
          accounts,
          memoryContext,
          { stocks: actualStocksPct, bonds: actualBondsPct },
          guardrailsContext,
          data.investorParams, // ← параметры инвестора из листа «Параметры»
          data.bondMarketData as unknown as Map<
            string,
            Record<string, unknown>
          >, // ← передаём bondMarketData
          anomalies.map((a) => {
            const facts = data.technicalFacts?.find(
              (item) => item.ticker === a.ticker.trim().toUpperCase(),
            );
            return {
              ticker: a.ticker,
              rsi: a.rsi,
              sma20: a.sma20,
              sma50: a.sma50,
              smaPeriods: a.smaPeriods ?? facts?.sma.map((item) => item.period),
              smaValues:
                a.smaValues ??
                (facts
                  ? Object.fromEntries(
                      facts.sma.map((item) => [
                        String(item.period),
                        item.value,
                      ]),
                    )
                  : undefined),
              high52w: facts?.high52w ?? null,
              low52w: facts?.low52w ?? null,
              technicalAsOf: facts?.asOf ?? null,
              trend: a.trend,
              volatilityAnnual: a.volatilityAnnual,
              riskLevel: a.riskLevel,
              zScoreLast: a.zScoreLast,
              isLastAnomaly: a.isLastAnomaly,
            };
          }),
          liquidityAnalysis,
          newsContext, // ← новостной контекст
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

    // Если все попытки неудачны — используем пустой результат.
    // ВАЖНО: сохраняем fundamentalsDividendYields, если AiClient успел их
    // собрать до fallback — иначе StrategistAgent теряет дивидендную часть якоря.
    if (!aiClientResult || !aiClientResult.success) {
      this.log.error(
        `[AiAgent] ❌ AiClient не успешен после ${maxRetries} попыток: ${lastError?.message}`,
      );
      const preservedDividendYields =
        aiClientResult?.fundamentalsDividendYields ?? {};
      const preservedFundamentals = aiClientResult?.portfolioFundamentals;
      this.log.info(
        `[AI_FALLBACK] reason=${lastError?.message ?? 'unknown'} ` +
          `dividendYieldsPreserved=${Object.keys(preservedDividendYields).length > 0} ` +
          `fundamentalsPreserved=${Boolean(preservedFundamentals)}`,
      );
      aiClientResult = {
        text: '',
        modelUsed: 'FAILED',
        success: false,
        error: lastError?.message ?? 'Unknown error',
        fundamentalsDividendYields: preservedDividendYields,
        portfolioFundamentals: preservedFundamentals,
      };
    }

    // Шаг 4: Пост-обработка AI-текста
    let aiNarrative = aiClientResult.text || '';
    const validationWarnings: string[] = [];

    if (aiClientResult.success && aiNarrative) {
      // Санитизация — передаём noSellTickers для точечного применения no-sell
      const sanitized = sanitizeAiNarrative(
        aiNarrative,
        userPolicy.noSellTickers,
      );

      // Пост-обработка (валидация направлений, исключённых активов)
      const postProcessResult = postProcessAiText(
        sanitized,
        portfolioAnalysis.assetsAnalysis,
        userPolicy,
      );

      // Финальная очистка от raw structured JSON (```json, {"ticker": ...})
      // и от раздела «Рекомендации по каждому активу» (таблица дублирует
      // структурированные карточки, которые рендерятся из валидированного JSON).
      // Контракт метрик должен проходить и по narrative-секции: иначе
      // «P/E 7,18, ROE 80,3%» остаются в тексте без источника и даты.
      const narrativeFundamentals =
        aiClientResult.portfolioFundamentals?.assets.map((fundamental) => ({
          ticker: fundamental.ticker,
          name: portfolioAnalysis.assetsAnalysis.find(
            (asset) =>
              asset.ticker.toUpperCase() === fundamental.ticker.toUpperCase(),
          )?.name,
          fundamentals: fundamental,
        })) ?? [];

      aiNarrative =
        restoreLostPercentRanges(
          applyPolicyToNarrative(
            validateNarrativeFundamentals(
              stripRecommendationsTableFromNarrative(
                stripJsonBlockFromAiText(postProcessResult.cleanedText),
              ),
              narrativeFundamentals,
            ) ?? '',
            portfolioAnalysis.assetsAnalysis,
            userPolicy,
          ),
        ) ?? '';
      validationWarnings.push(...postProcessResult.warnings);
    }

    // Шаг 5: Структурированные рекомендации с изоляцией по тикерам
    const structuredRecommendations = new Map<
      string,
      StructuredAIAssetRecommendation
    >();
    const mathAiAgreements = new Map<string, MathAiAgreement>();

    // Извлекаем массив JSON от AI (один объект на каждый актив)
    const aiJsonArray =
      (aiClientResult.structuredJsonArray as RawAIJson[]) ?? [];
    const aiJsonMap = new Map<string, RawAIJson>();
    for (const item of aiJsonArray) {
      aiJsonMap.set(item.ticker?.toUpperCase() ?? '', item);
    }

    // Создаём список тикеров для валидации
    const assetTickers = portfolioAnalysis.assetsAnalysis.map((a) =>
      a.ticker.toUpperCase(),
    );

    for (const asset of portfolioAnalysis.assetsAnalysis) {
      const assetTicker = asset.ticker.toUpperCase();

      // ─── Изоляция по тикеру ───
      // Ищем JSON для конкретного тикера в массиве
      const aiJsonForAsset: RawAIJson | null =
        aiJsonMap.get(assetTicker) ?? null;

      const det = buildDeterministicAssetData(asset, []);

      // Фундаментал ИМЕННО своего тикера + набор соседей прогона.
      // Без этого guard не мог проверить цифры и молча пропускал текст,
      // а контаминация соседним активом (TATN ← IRAO) выглядела как факт.
      const fundamentalsForAsset =
        aiClientResult.portfolioFundamentals?.assets.find(
          (fundamental) => fundamental.ticker.toUpperCase() === assetTicker,
        );
      const fundamentalSiblings: FundamentalSibling[] =
        aiClientResult.portfolioFundamentals?.assets
          .filter(
            (fundamental) => fundamental.ticker.toUpperCase() !== assetTicker,
          )
          .map((fundamental) => ({
            ticker: fundamental.ticker,
            fundamentals: fundamental,
          })) ?? [];

      // Диагностика контаминации: фиксируем в журнал даже те случаи,
      // когда цифра совпала со своим значением, но встречается у соседа.
      const foreignMentions = detectForeignMetricMentions(
        [aiJsonForAsset?.fundamentalAnalysis, aiJsonForAsset?.issuerContext]
          .filter((value): value is string => Boolean(value))
          .join(' '),
        assetTicker,
        fundamentalsForAsset,
        fundamentalSiblings,
      );
      if (foreignMentions.length > 0) {
        this.log.warn(
          `[FUNDAMENTAL_CONTAMINATION] ${asset.ticker}: ` +
            foreignMentions
              .map(
                (mention) =>
                  `${mention.label}=${mention.value} (${mention.foreignTicker})`,
              )
              .join(', '),
        );
      }

      // ─── Валидируем JSON для КАЖДОГО тикера отдельно ───
      let assetValidation: ValidationResult | null = null;
      if (aiJsonForAsset) {
        assetValidation = validateStructuredAIJson(
          aiJsonForAsset,
          assetTickers,
          freshMacroData ?? { isFresh: true },
        );
      }

      // Определяем причину fallback
      let fallbackReason:
        'NO_AI_JSON' | 'INVALID_JSON_PARSE' | 'MISSING_REQUIRED_FIELDS' =
        'NO_AI_JSON';
      if (aiJsonForAsset) {
        if (
          assetValidation &&
          !assetValidation.valid &&
          assetValidation.errors.length > 0
        ) {
          const missingFields = assetValidation.errors.map((e) => e.field);
          if (
            missingFields.includes('recommendedAction') ||
            missingFields.includes('confidence')
          ) {
            fallbackReason = 'MISSING_REQUIRED_FIELDS';
          } else {
            fallbackReason = 'INVALID_JSON_PARSE';
          }
        }
      } else {
        fallbackReason = 'NO_AI_JSON';
      }

      // Прокладываем данные ликвидности из LiquidityAnalyzer
      const liq = liquidityMap.get(assetTicker);
      const liquidityForAsset = liq
        ? {
            liquidityLevel: liq.liquidityLevel as
              'HIGH' | 'MEDIUM' | 'LOW' | 'CRITICAL' | 'UNKNOWN',
            dailyTurnover: liq.dailyTurnover,
            liquidationDays: liq.liquidationDays,
          }
        : undefined;

      // Прокладываем расширенные данные из Excel
      const extData = extendedDataMap.get(assetTicker);
      const extendedDataForAsset =
        extData &&
        (extData.minPrice ||
          extData.maxPrice ||
          extData.ratingTotal ||
          extData.entrySignal)
          ? extData
          : undefined;

      const structured = buildStructuredAIRecommendation(
        det,
        aiJsonForAsset,
        assetValidation,
        fallbackReason,
        fundamentalsForAsset,
        fundamentalSiblings,
        liquidityForAsset,
        extendedDataForAsset,
      );

      // ИСПРАВЛЕНИЕ Этап 2: НЕ подставляем Math Recommendation вместо отсутствующего AI Recommendation.
      // structured.recommendedAction остаётся null, когда AI не вернул рекомендацию.
      // agreeMathAndAi() корректно определит статус MATH_ONLY при aiAction=null.
      // buildFinalConclusion() корректно определит source='MATH_ONLY' при !aiAction.
      if (!structured.recommendedAction) {
        this.log.info(
          `[AiAgent] [MATH_ONLY] ${asset.ticker}: AI не вернул рекомендацию, ` +
            `используем PortfolioMath: ${asset.status} (источник=MATH_ONLY), причина=${fallbackReason}`,
        );
        // confidence=null когда AI не вернул рекомендацию (не 0 и не null из fallback)
        structured.confidence = null;
        // rationale уже содержит fallback-объяснение из buildFallbackStructuredRecommendation
        // НЕ перезаписываем его, если там уже есть подробное объяснение
        if (
          !structured.rationale ||
          structured.rationale === 'AI analysis unavailable'
        ) {
          structured.rationale =
            'Рекомендация на основе PortfolioMath (AI не вернул рекомендацию)';
        }
      }

      // Bond-блок карточки — из структурированного анализа, а не из текста AI.
      // Тип купона и кредитный статус обязаны иметь источник и дату.
      const bondAnalysis = aiClientResult.bondAnalyses?.find(
        (bond) => bond.isin.trim().toUpperCase() === assetTicker,
      );
      if (bondAnalysis) {
        structured.bondCard = buildBondCardInfo(bondAnalysis);
      }

      // Внутренние противоречия карточки: «Держать», а в тексте — покупка.
      // technicalTiming тоже участвует: «первая часть — немедленно» в карточке
      // HOLD — такая же торговая директива, как и в entryStrategy.
      // Если BUY отложен до пополнения (deferred), текст карточки намеренно
      // содержит «докупать из ежемесячного взноса» при action=HOLD — это не
      // расхождение направлений, а объяснение constraint'а.
      const directionConflicts =
        structured.deferredBuyRub != null
          ? []
          : findCardDirectionConflicts(structured.recommendedAction, [
              structured.rationale,
              structured.fundamentalAnalysis,
              structured.issuerContext,
              structured.entryStrategy,
              structured.technicalTiming,
            ]);
      if (directionConflicts.length > 0) {
        this.log.warn(
          `[CARD_ACTION_MISMATCH] ${asset.ticker}: action=${structured.recommendedAction ?? 'null'} ` +
            `${directionConflicts.join('; ')}`,
        );
      }

      structuredRecommendations.set(asset.ticker, structured);

      // ─── Этап 5: User constraints — BUY не превышает доступный капитал ───
      if (
        structured.recommendedAction === 'BUY' &&
        macroGoals.freeCash !== undefined &&
        structured.currentPrice !== null &&
        structured.currentPrice > 0 &&
        structured.recommendedTargetPercent !== null
      ) {
        const deficit = asset.deficitRub ?? 0;
        if (deficit > 0 && deficit > macroGoals.freeCash) {
          // BUY не помещается в свободный кэш. Это не «Держать»: дефицит
          // закрывается ежемесячным взносом, поэтому карточка получает
          // отдельный deferred-флаг и не считается расхождением направлений.
          const monthlyContribution = Math.max(
            0,
            investedFunds?.averageMonthlyDeposit ?? 0,
          );
          const monthlyLabel =
            monthlyContribution > 0 ? monthlyContribution : deficit;
          this.log.warn(
            `[AiAgent] [CONSTRAINT] ${asset.ticker}: BUY требует ${deficit.toFixed(0)} ₽, ` +
              `доступно ${macroGoals.freeCash.toFixed(0)} ₽ → ` +
              `докупать из ежемесячного взноса (${monthlyLabel.toFixed(0)} ₽/мес)`,
          );
          structured.recommendedAction = 'HOLD';
          structured.deferredBuyRub = deficit;
          structured.monthlyContributionRub =
            monthlyContribution > 0 ? monthlyContribution : null;

          // Финансовый контекст для отображения
          const financialPrefix =
            `BUY отложен: требуется ${deficit.toFixed(0)} ₽, доступно ${macroGoals.freeCash.toFixed(0)} ₽. ` +
            `Докупать из ежемесячного взноса (${monthlyLabel.toFixed(0)} ₽/мес). `;

          // Сохраняем AI-анализ, добавляем финансовый контекст в начало
          if (
            structured.rationale &&
            !structured.rationale.startsWith('BUY отложен:')
          ) {
            structured.rationale = financialPrefix + structured.rationale;
          } else if (!structured.rationale) {
            structured.rationale =
              financialPrefix + 'Рекомендация на основе анализа данных.';
          }

          // Аналогично для entryStrategy — не перезаписываем AI-текст
          if (
            structured.entryStrategy &&
            !structured.entryStrategy.startsWith(
              'Докупать из ежемесячного взноса',
            )
          ) {
            structured.entryStrategy =
              financialPrefix.slice(0, -2) + '. ' + structured.entryStrategy;
          } else if (!structured.entryStrategy) {
            structured.entryStrategy =
              `Докупать из ежемесячного взноса (${monthlyLabel.toFixed(0)} ₽/мес): ` +
              `дефицит ${deficit.toFixed(0)} ₽, свободный кэш ${macroGoals.freeCash.toFixed(0)} ₽.`;
          }

          // Аналогично для technicalTiming — не перезаписываем AI-анализ
          if (
            structured.technicalTiming &&
            !structured.technicalTiming.startsWith('Покупка отложена')
          ) {
            // Добавляем финансовый контекст перед AI-анализом
            structured.technicalTiming =
              'Покупка отложена до пополнения: свободного кэша недостаточно. ' +
              structured.technicalTiming;
          } else if (!structured.technicalTiming) {
            structured.technicalTiming =
              'Покупка отложена до пополнения: свободного кэша недостаточно, ' +
              'докупать из ежемесячного взноса.';
          }

          // ─── Выравнивание текста карточки с действием HOLD ───
          // При downgrade BUY→HOLD AI-текст может содержать buy-директивы.
          // Санитизируем per-asset поля, чтобы текст карточки соответствовал
          // действию HOLD (нейтральный, без торговых директив).
          const rationaleClean = sanitizePolicyCardText(
            structured.rationale,
            asset.ticker,
          );
          const entryStrategyClean = sanitizePolicyCardText(
            structured.entryStrategy,
            asset.ticker,
          );
          const technicalTimingClean = sanitizePolicyCardText(
            structured.technicalTiming,
            asset.ticker,
          );
          if (rationaleClean.changed) {
            structured.rationale = rationaleClean.text;
          }
          if (entryStrategyClean.changed) {
            structured.entryStrategy = entryStrategyClean.text;
          }
          if (technicalTimingClean.changed) {
            structured.technicalTiming = technicalTimingClean.text;
          }
        }
      }

      // ─── Guardrails — проверка на опасные действия ───
      const guardrailResult = checkGuardrails(
        structured.recommendedAction ?? 'HOLD',
        asset.ticker,
        positionsRepo,
        portfolioAnalysis.assetsAnalysis,
      );

      if (guardrailResult.blockedActions.length > 0) {
        for (const blocked of guardrailResult.blockedActions) {
          this.log.warn(
            `[AiAgent] [GUARDRAIL-BLOCK] ${asset.ticker}: ` +
              `AI recommendation "${blocked.action}" blocked — ${blocked.reason}`,
          );
          // Заменяем опасную рекомендацию на HOLD
          structured.recommendedAction = 'HOLD';
          structured.confidence = 0.85;
          structured.rationale = `Действие "${blocked.action}" заблокировано guardrails: ${blocked.reason}. Заменено на HOLD.`;
        }
      }

      if (guardrailResult.warnings.length > 0) {
        for (const warning of guardrailResult.warnings) {
          this.log.info(
            `[AiAgent] [GUARDRAIL-WARN] ${asset.ticker}: ${warning.message}`,
          );
        }
      }

      // ─── Пользовательская политика no-sell: действия И тексты ───
      // aiVote сохраняем для диагностики: подавление конфликта не должно
      // скрывать исходное направление голоса AI.
      const aiVote = structured.recommendedAction;
      Object.assign(
        structured,
        applyPolicyToRecommendation(structured, asset, userPolicy),
      );
      const policyBlocksMathSell =
        isSellBlockedByPolicy(asset, userPolicy) &&
        (asset.status === 'REDUCE' || asset.status === 'EXIT');

      // ─── Согласование PortfolioMath и ИИ ───
      const mathAction = policyBlocksMathSell ? 'HOLD' : asset.status;
      const aiAction = structured.recommendedAction; // AiAction | null
      const mathAgreement = structured.agreementWithPortfolioMath;
      const aiConfidence = structured.confidence ?? 0;

      const agreement = agreeMathAndAi(
        asset.ticker,
        mathAction,
        aiAction,
        mathAgreement,
        aiConfidence,
      );

      if (policyBlocksMathSell) {
        // PortfolioMath предлагал REDUCE/EXIT, но политика запрещает продажу.
        // Это не DIRECTION_CONFLICT: действие неисполнимо по политике.
        agreement.policyBlocked = true;
        agreement.policyNote =
          'Продажа/сокращение заблокированы политикой no-sell';
        agreement.conflict = false;
        agreement.requiresReview = false;
        agreement.executionAllowed = false;
        agreement.finalAction = 'HOLD';
        agreement.status = 'POLICY_BLOCKED';
        this.log.info(
          `[POLICY_OVERRIDE_AI] ${asset.ticker} aiVote=${aiVote ?? 'HOLD'} ` +
            `mathAction=${asset.status} effectiveAction=HOLD`,
        );
      }

      // ─── Stale macro guard: AI override отключён при устаревших макро-данных ───
      // Если CBR rate fetched с fallback (isFresh=false), confidence модели
      // искусственно занижен ceiling=0.50. Override при confidence < 0.70
      // не должен происходить — решение на stale-данных ненадёжно.
      const macroStale =
        freshMacroData !== null && freshMacroData.isFresh === false;
      if (agreement.status === 'AI_OVERRIDE' && macroStale) {
        agreement.finalAction = agreement.mathAction;
        agreement.conflict = true;
        agreement.conflictReason = `AI override отключён: макро-данные устарели (CBR ${freshMacroData?.asOf ?? 'n/a'}), confidence=${aiConfidence.toFixed(2)} < порога 0.70`;
        agreement.requiresReview = true;
        agreement.executionAllowed = false;
        agreement.status = 'CONFLICT';
        this.log.warn(
          `[STALE_MACRO] ${asset.ticker} AI_OVERRIDE→CONFLICT macroStale=true ` +
            `mathAction=${agreement.mathAction} aiAction=${agreement.aiAction} ` +
            `confidence=${aiConfidence.toFixed(2)} finalAction=${agreement.finalAction}`,
        );
      }

      // Проверяем исполнение с учётом защитных ограничений
      const executionAllowed = isExecutionAllowed(
        agreement,
        asset.holdOnly || false,
        det.marketDataValid,
        det.executionBlocked,
      );

      agreement.executionAllowed = executionAllowed;

      // [AI_VOTE] логируется ВСЕГДА — и при согласии, и при конфликте,
      // чтобы голос модели по каждому тикеру попадал в last-run.log.
      const aiVoteLine = formatAiVoteDiagnostic({
        ticker: asset.ticker,
        aiVote,
        mathAction: asset.status,
        finalAction: agreement.finalAction,
        confidence: aiConfidence,
        deviationPp: asset.deficitDeviationPct,
        deficitRub: asset.deficitRub,
        severity: agreement.conflictDetails?.severity,
      });
      if (agreement.conflict) {
        this.log.warn(aiVoteLine);
      } else {
        this.log.info(aiVoteLine);
      }

      // Логируем результат согласования
      if (agreement.conflict) {
        this.log.warn(
          `[AiAgent] [CONFLICT] ${asset.ticker}: ` +
            `math=${agreement.conflictDetails?.mathDescription}, ` +
            `ai=${agreement.conflictDetails?.aiDescription}, ` +
            `aiVote=${aiVote ?? 'HOLD'}, ` +
            `confidence=${aiConfidence.toFixed(2)}, ` +
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

      // ─── Нейтрализация buy-директив при HOLD/STABLE (CARD_ACTION_MISMATCH) ───
      // Финальное действие определено в agreement.finalAction (включая AI_OVERRIDE).
      // Санитайзер выполняется ПОСЛЕ finalAction — карточка согласована с действием.
      // Все 3 поля санитайзятся независимо — нет дедупликации через rationale.
      // При finalAction=BUY — заглушка «ядро: HOLD» НЕ вставляется, поля нейтральны.
      const finalAction =
        agreement.finalAction ?? structured.recommendedAction ?? 'HOLD';
      const rationaleBuyClean = sanitizeBuyDirectivesForAction(
        structured.rationale,
        asset.ticker,
        finalAction,
        aiVote,
        userPolicy.noSellTickers,
      );
      if (rationaleBuyClean.changed) {
        structured.rationale = rationaleBuyClean.text;
      }
      const entryStrategyBuyClean = sanitizeBuyDirectivesForAction(
        structured.entryStrategy,
        asset.ticker,
        finalAction,
        aiVote,
        userPolicy.noSellTickers,
      );
      if (entryStrategyBuyClean.changed) {
        structured.entryStrategy = entryStrategyBuyClean.text;
      }
      const technicalTimingBuyClean = sanitizeBuyDirectivesForAction(
        structured.technicalTiming,
        asset.ticker,
        finalAction,
        aiVote,
        userPolicy.noSellTickers,
      );
      if (technicalTimingBuyClean.changed) {
        structured.technicalTiming = technicalTimingBuyClean.text;
      }

      // ─── P1-3: Итоговое заключение (7 элементов) ───
      const conclusion = buildFinalConclusion(
        {
          ticker: asset.ticker,
          name: asset.name,
          status: asset.status,
          targetPercent: asset.targetPercent,
          currentPercent: asset.currentPercent,
          deficitRub: asset.deficitRub,
          unrealizedProfitRub: asset.unrealizedProfitRub,
          balancePrice: asset.balancePrice,
          currentPrice: asset.currentPrice,
          holdOnly: asset.holdOnly,
          isConcentrated: asset.isConcentrated,
          quantity: asset.quantity,
        },
        structured,
      );

      // Сохраняем заключение в structured recommendation
      (
        structured as StructuredAIAssetRecommendation & {
          finalConclusion?: unknown;
        }
      ).finalConclusion = conclusion;
    }

    // Ценовые триггеры: только машинный JSON-блок, сверка с котировками
    // и policy-check (sell-действие для no-sell → blocked_by_policy).
    const parsedPriceTriggers = parsePriceTriggers(aiClientResult.text);
    const priceTriggers = evaluatePriceTriggers(parsedPriceTriggers.triggers, {
      quotes: Object.fromEntries(
        Object.entries(data.quotes).map(([ticker, quote]) => [
          ticker.toUpperCase(),
          {
            last: quote.currentPrice > 0 ? quote.currentPrice : null,
            asOf: quote.asOf ?? null,
          },
        ]),
      ),
      assets: portfolioAnalysis.assetsAnalysis,
      policy: userPolicy,
    });

    this.log.info(
      `[AiAgent] ✅ AI-анализ завершён: модель=${aiClientResult.modelUsed}, ` +
        `успех=${aiClientResult.success}, thesis=${thesisResults.size}`,
    );

    // Извлекаем portfolioSummary из aiClientResult
    const portfolioSummary = aiClientResult.portfolioSummary;
    console.log(
      '[AiAgent] aiClientResult.portfolioSummary type:',
      typeof portfolioSummary,
    );
    console.log(
      '[AiAgent] aiClientResult.portfolioSummary === undefined:',
      portfolioSummary === undefined,
    );
    console.log(
      '[AiAgent] aiClientResult.portfolioSummary === "":',
      portfolioSummary === '',
    );
    console.log(
      '[AiAgent] portfolioSummary length:',
      portfolioSummary?.length ?? 0,
    );
    console.log(
      '[AiAgent] portfolioSummary preview:',
      portfolioSummary?.substring(0, 100) ?? 'NULL',
    );

    // portfolioSummary — это narrative в новой схеме (JSON-схема).
    // aiNarrative делаем пустым, чтобы sanitizeNarrativeForDisplay не рендерил
    // сырой JSON из aiClientResult.text. portfolioSummary рендерится отдельно
    // в notification-agent.ts со стилями.
    const aiNarrativeForDisplay = portfolioSummary ? '' : aiNarrative;

    return {
      thesisResults,
      aiNarrative: aiNarrativeForDisplay,
      portfolioSummary,
      aiClientResult,
      structuredRecommendations,
      mathAiAgreements,
      validationWarnings,
      newsContext,
      dividendYields: aiClientResult.fundamentalsDividendYields ?? {},
      portfolioFundamentals: aiClientResult.portfolioFundamentals,
      priceTriggers,
    };
  }

  // ── Helpers ──

  /** Формирует структурированную сводку новостей из данных Gatekeeper */
  private buildNewsContext(
    news: import('../gatekeeper/types.js').GatekeeperResult | null,
  ): string {
    this.log.info(
      `[AiAgent] buildNewsContext: news=${news !== null}, approved=${news?.approvedNews.length ?? 0}, filtered=${news?.filteredOut.total ?? 0}`,
    );
    if (!news || news.approvedNews.length === 0) {
      // Новости были, но все отфильтрованы — покажем только релевантные (с тикерами портфеля)
      if (news && news.filteredOut.total > 0) {
        let context = `Новостной фон: собрано ${news.filteredOut.total} новостей, 0 одобрено.\n`;
        context += 'Причины фильтрации:\n';
        for (const [reason, count] of Object.entries(
          news.filteredOut.byReason,
        )) {
          context += `- ${reason}: ${count}\n`;
        }

        // Фильтруем примеры: только те, что содержат тикеры портфеля
        const examples = news.filteredOut.examples;
        const relevantExamples: Array<{
          reason: string;
          item: {
            title: string;
            description: string;
            url: string;
            source: string;
            relevantTickers: string[];
          };
        }> = [];
        if (examples) {
          for (const [reason, items] of Object.entries(examples)) {
            for (const item of items) {
              if (item.relevantTickers.length > 0) {
                relevantExamples.push({ reason, item });
              }
            }
          }
        }

        if (relevantExamples.length > 0) {
          // Группируем по тикеру
          const byTicker = new Map<
            string,
            Array<{
              reason: string;
              title: string;
              description: string;
              url: string;
              source: string;
            }>
          >();
          for (const { reason, item } of relevantExamples) {
            for (const ticker of item.relevantTickers) {
              if (!byTicker.has(ticker)) byTicker.set(ticker, []);
              byTicker.get(ticker)!.push({
                reason,
                title: item.title,
                description: item.description,
                url: item.url,
                source: item.source,
              });
            }
          }

          context += '\nРелевантные новости (по тикерам портфеля):\n';
          for (const [ticker, newsList] of byTicker) {
            context += `\n### ${ticker} (${newsList.length} новостей)\n`;
            for (const n of newsList) {
              context += `- [${n.reason}] ${n.title}\n`;
              if (n.description)
                context += `  Описание: ${n.description.slice(0, 200)}\n`;
              context += `  Источник: ${n.source} | ${n.url}\n`;
            }
          }
        } else {
          context +=
            '\nОтфильтрованные новости не содержат тикеров из портфеля.\n';
        }
        return context;
      }
      return 'Новостной фон: нет релевантных новостей.';
    }

    // Подсчёт по приоритетам
    const byPriority = { critical: 0, high: 0, medium: 0, low: 0 };
    const bySentiment = { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 };

    for (const item of news.approvedNews) {
      if (item.priority in byPriority) {
        byPriority[item.priority as keyof typeof byPriority]++;
      }
      // Определяем сентимент по приоритету
      if (item.priority === 'critical') {
        bySentiment.NEGATIVE++;
      } else if (item.priority === 'high') {
        // Определяем по ключевым словам
        const text = `${item.title} ${item.summary}`.toLowerCase();
        const positiveWords = [
          'рост',
          'прибыль',
          'покупк',
          'одобр',
          'контракт',
        ];
        const negativeWords = ['паден', 'убыт', 'санкц', 'штраф', 'риск'];
        const hasPos = positiveWords.some((w) => text.includes(w));
        const hasNeg = negativeWords.some((w) => text.includes(w));
        if (hasNeg && !hasPos) bySentiment.NEGATIVE++;
        else if (hasPos && !hasNeg) bySentiment.POSITIVE++;
        else bySentiment.NEUTRAL++;
      } else {
        bySentiment.NEUTRAL++;
      }
    }

    // Общий сентимент
    let overallSentiment = 'НЕЙТРАЛЬНЫЙ';
    if (bySentiment.POSITIVE > bySentiment.NEGATIVE + 1)
      overallSentiment = 'ПОЗИТИВНЫЙ';
    else if (bySentiment.NEGATIVE > bySentiment.POSITIVE + 1)
      overallSentiment = 'НЕГАТИВНЫЙ';

    // Формируем сводку
    let context = `Новостной фон (${news.approvedNews.length} новостей):\n`;
    context += `- Критических: ${byPriority.critical}, высокой важности: ${byPriority.high}, средней: ${byPriority.medium}, низкой: ${byPriority.low}\n`;
    context += `Сентимент: ${overallSentiment} (Позитив: ${bySentiment.POSITIVE}, Нейтрально: ${bySentiment.NEUTRAL}, Негатив: ${bySentiment.NEGATIVE})\n\n`;

    // Топ-новости (максимум 5)
    const topNews = news.approvedNews
      .filter((n) => n.priority === 'critical' || n.priority === 'high')
      .slice(0, 5);

    if (topNews.length > 0) {
      context += 'Топ-новости:\n';
      for (const item of topNews) {
        context += `- [${item.priority.toUpperCase()}] ${item.title}\n`;
      }
    } else {
      context += 'Значимых новостей нет.\n';
    }

    return context;
  }

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
    investorParams?: {
      horizon: string;
      goal: string;
      riskProfile: string;
      maxDrawdown: number;
    },
    _bondMarketData?: Map<string, Record<string, unknown>>,
    anomalyData?: Array<{
      ticker: string;
      rsi: number | null;
      sma20: number | null;
      sma50: number | null;
      smaPeriods?: number[];
      smaValues?: Record<string, number | null>;
      high52w?: number | null;
      low52w?: number | null;
      technicalAsOf?: string | null;
      trend: 'up' | 'down' | 'flat' | null;
      volatilityAnnual: number | null;
      riskLevel: 'low' | 'medium' | 'high' | null;
      zScoreLast: number | null;
      isLastAnomaly: boolean;
    }>,
    _liquidityAnalysis?: import('../../../ai/ai-advisor/liquidity-analyzer.js').LiquidityAnalysis,
    newsContext?: string,
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
        newsContext, // ← новостной контекст
        assetClassPercents, // assetClassPercents
        {
          profitC10: historicalTrades.profitC10,
          profitC11: historicalTrades.profitC11,
          investedNet: investedFunds.totalNet,
          totalPurchases: historicalTrades.totalPurchasesSum,
          totalSales: historicalTrades.totalSalesSum,
          commission: historicalTrades.totalHistoricalCommission,
          averageMonthlyDeposit: historicalTrades.averageMonthlyDeposit ?? 0,
          anomalousDepositsTotal: historicalTrades.anomalousDepositsTotal ?? 0,
        },
        accounts.map((a) => ({ name: a.name, value: a.value })),
        memoryContext,
        guardrailsContext,
        investorParams, // ← параметры инвестора из листа «Параметры»
        _bondMarketData,
        anomalyData,
        _liquidityAnalysis, // ← анализ ликвидности
      );

      return {
        text: result.text,
        modelUsed: result.modelUsed,
        success: result.success,
        error: result.error,
        structuredJson: result.structuredJson,
        structuredJsonArray: result.structuredJsonArray,
        structuredValidation: result.structuredValidation,
        portfolioSummary: result.portfolioSummary,
        // Без этих двух полей StrategistAgent теряет дивидендный якорь,
        // хотя AiClient уже загрузил fundamentals и посчитал yields.
        fundamentalsDividendYields: result.fundamentalsDividendYields,
        portfolioFundamentals: result.portfolioFundamentals,
        // Bond-блок карточек: тип купона и кредитный статус с источником/датой.
        bondAnalyses: result.bondAnalyses,
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
      ? macroResearch.keyRate.status === 'VALUE'
        ? (macroResearch.keyRate.value ?? 0)
        : 0
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
      newsContext: 'Новостной фон: нет релевантных новостей.',
      dividendYields: {},
      priceTriggers: [],
    };
  }
}
