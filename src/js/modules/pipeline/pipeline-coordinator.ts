import type {
  PipelineState,
  AgentResult,
  AgentSummary,
  AgentConfig,
} from './agent/types.js';
import { createPipelineState } from './agent/types.js';
import { DataAgent, type DataAgentOutput } from './agents/data-agent.js';
import { ResearchAgentV2 } from './agents/research-agent-v2/research-agent-v2.js';
import type { ResearchV1Output } from './agents/research-agent-v2/types.js';
import {
  AnalysisAgent,
  type AnalysisAgentOutput,
} from './agents/analysis-agent.js';
import { AiAgent, type AiAgentOutput } from './agents/ai-agent.js';
import {
  NotificationAgent,
  type NotificationAgentOutput,
} from './agents/notification-agent.js';
// ReviewAgent удалён — используем заглушку
export interface ReviewResult {
  agreement: number;
  agreementPercent: number;
  discrepancies: string[];
  hasDisagreement: boolean;
  timeMs: number;
  successful: number;
  timeouts: number;
  finalRecommendation?: string;
}

import {
  ScenarioAgent,
  type ScenarioAgentOutput,
} from './agents/scenario-agent.js';
import {
  StrategistAgent,
  type StrategistAgentOutput,
  type StrategistProposal,
} from './agents/strategist-agent.js';
import { runConsilium, type ConsiliumOutput } from './agents/consilium.js';
import { aiMemoryImpl, getByType } from './ai-memory/index.js';
import { Watchdog } from './watchdog/watchdog.js';
import type { AgentHealthReport } from './watchdog/types.js';
import { DEFAULT_THRESHOLDS } from './watchdog/types.js';
import {
  createGuardrailPolicy,
  type GuardrailPolicy,
} from './guardrail-policy.js';
import type { AssetAnalysis } from '../portfolio-math/portfolio-math.js';
import { SelfImprovementLoop } from './self-improvement/self-improvement-loop.js';
import { LearningAgent } from './agents/learning-agent.js';
import { fetchHistoricalBatch } from '../data-fetcher/index.js';

// ──────────────────────────────────────────────
// 1. Pipeline stage definitions
// ──────────────────────────────────────────────

/** Этап конвейера (consilium не отдельный этап — работает синхронно) */
export type PipelineStage =
  | 'data'
  | 'research'
  | 'analysis'
  | 'ai'
  | 'review'
  | 'scenario'
  | 'strategist'
  | 'notification';

/** Результат выполнения одного этапа */
export interface PipelineStageResult<T = unknown> {
  stage: PipelineStage;
  result: AgentResult<T>;
  durationMs: number;
}

/** Полный результат конвейера */
export interface PipelineResult {
  /** ID запуска */
  pipelineId: string;
  /** Начало и конец */
  startedAt: string;
  completedAt: string;
  /** Общее время выполнения */
  totalDurationMs: number;
  /** Результаты каждого этапа */
  stages: Record<PipelineStage, PipelineStageResult | null>;
  /** Результаты review */
  reviewResult?: ReviewResult;
  /** Результаты Scenario Agent */
  scenarioResult?: ScenarioAgentOutput;
  /** Результаты Strategist Agent */
  strategistResult?: StrategistAgentOutput;
  /** Результаты Consilium */
  consiliumResult?: ConsiliumOutput;
  /** Интерактивные ордера от Notification Agent */
  interactiveOrders?: Array<{ ticker: string; action: string; id: string }>;
  /** Сводки по всем агентам */
  agentSummaries: Record<string, AgentSummary>;
  /** Отчёт Watchdog о здоровье агентов (если были проверки) */
  watchdogHealth?: AgentHealthReport;
  /** Успешен ли весь конвейер */
  success: boolean;
  /** Ошибка (если была) */
  error?: Error;
}

// ──────────────────────────────────────────────
// 2. Pipeline Coordinator
// ──────────────────────────────────────────────

/** Конфигурация PipelineCoordinator */
export interface PipelineConfig {
  data?: AgentConfig;
  research?: AgentConfig;
  analysis?: AgentConfig;
  ai?: AgentConfig;
  review?: AgentConfig;
  scenario?: AgentConfig;
  strategist?: AgentConfig;
  notification?: AgentConfig;
  /** Guardrail-политика (по умолчанию moderate) */
  guardrailPolicy?: GuardrailPolicy;
}

/**
 * Runtime-опции PipelineCoordinator (DI).
 * Обе опции опциональны — без них поведение прежнее.
 */
export interface PipelineRuntimeOptions {
  /** Watchdog для мониторинга агентов (по умолчанию создаётся новый) */
  watchdog?: Watchdog;
  /**
   * Колбэк авто-архивации KPI после успешного run().
   * Например: (result) => savePortfolioKpi(aiMemoryImpl, result).
   */
  memorySink?: (result: PipelineResult) => Promise<void> | void;
}

/** Имя агента для каждого этапа (используется Watchdog'ом) */
const STAGE_AGENT_NAMES: Record<PipelineStage, string> = {
  data: 'DataAgent',
  research: 'ResearchAgent',
  analysis: 'AnalysisAgent',
  ai: 'AiAgent',
  review: 'ReviewAgent',
  scenario: 'ScenarioAgent',
  strategist: 'StrategistAgent',
  notification: 'NotificationAgent',
};

/**
 * PipelineCoordinator — оркестратор мультиагентного конвейера.
 *
 * Диаграмма зависимостей:
 *
 *   [Data Agent] ──────────────────────────────────────┐
 *       │                                                │
 *       ├─→ [Research Agent] ──→ [AI Agent] ──→ [Notification Agent]
 *       │          │                     │
 *       └─→ [Analysis Agent] ────┘        │
 *                                         │
 *   (Research и Analysis запускаются параллельно)
 *   (AI ждёт оба)
 *   (Notification ждёт AI)
 *
 * Каждый агент работает автономно с собственной retry-логикой.
 * Coordinator управляет порядком и передачей данных между этапами.
 */
export class PipelineCoordinator {
  private _state: PipelineState;
  private dataAgent: DataAgent;
  private researchAgent: ResearchAgentV2;
  private analysisAgent: AnalysisAgent;
  private aiAgent: AiAgent;
  // private reviewAgent: ReviewAgent; // Удалён
  private scenarioAgent: ScenarioAgent;
  private strategistAgent: StrategistAgent;
  private notificationAgent: NotificationAgent;
  private selfImprovementLoop: SelfImprovementLoop;
  private learningAgent: LearningAgent;

  /** Guardrail-политика (по умолчанию moderate) */
  private guardrailPolicy: GuardrailPolicy;

  private stageResults: Record<PipelineStage, PipelineStageResult | null> = {
    data: null,
    research: null,
    analysis: null,
    ai: null,
    review: null,
    scenario: null,
    strategist: null,
    notification: null,
  };

  /** Event-система для стриминга прогресса */
  private stageListeners: Array<
    (stage: PipelineStage, durationMs: number) => void
  > = [];

  private agentSummaries: Record<string, AgentSummary> = {};
  private reviewResultData: ReviewResult | null = null;
  private scenarioResultData: ScenarioAgentOutput | null = null;
  private strategistResultData: StrategistAgentOutput | null = null;
  private consiliumResultData: ConsiliumOutput | null = null;
  private interactiveOrdersData: Array<{
    ticker: string;
    action: string;
    id: string;
  }> = [];

  /** Результаты AI-рекомендаций для обучения */
  private aiRecommendations: Array<{
    pipelineId: string;
    ticker: string;
    recommendedAction: string;
    /** Субъективная оценка пользователя (👍/👎) — только для статистики */
    userFeedback?: 'good' | 'bad';
    /** Фактический результат (проверяется PostFactumCheck через 30 дней) */
    factualResult?: 'correct' | 'incorrect' | 'pending';
    recordedAt: string;
    checkedAt?: string;
  }> = [];
  private readonly maxAiRecommendations = 5000;

  /** Подписаться на завершение стадии конвейера */
  onStageComplete(
    callback: (stage: PipelineStage, durationMs: number) => void,
  ): () => void {
    this.stageListeners.push(callback);
    return () => {
      this.stageListeners = this.stageListeners.filter((cb) => cb !== callback);
    };
  }

  /**
   * Сохранить результат этапа в оперативную память ИИ.
   */
  private saveToMemory(stage: PipelineStage, data: unknown): void {
    try {
      if (data == null) {
        console.warn(
          `[Pipeline] saveToMemory: data is null for stage ${stage}`,
        );
        return;
      }
      const content = JSON.stringify(data, null, 2).substring(0, 2000);
      aiMemoryImpl.saveOperational({
        type: stage === 'ai' ? 'pipeline_result' : 'pipeline_result',
        content,
        priority: 'high',
        keywords: [stage, 'pipeline'],
        createdAt: new Date().toISOString(),
        metadata: {
          pipelineId: this._state.pipelineId,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.warn('[Pipeline] Ошибка записи в память:', err);
    }
  }

  /** Очистить старые AI-рекомендации (старше 30 дней) */
  private cleanupAiRecommendations(): void {
    const cutoff = Date.now() - 30 * 24 * 3600_000;
    this.aiRecommendations = this.aiRecommendations.filter(
      (r) => new Date(r.recordedAt).getTime() >= cutoff,
    );
    // Дополнительная защита: обрезаем по лимиту
    while (this.aiRecommendations.length > this.maxAiRecommendations) {
      this.aiRecommendations.shift();
    }
  }

  private readonly watchdog: Watchdog;
  private readonly memorySink?: (
    result: PipelineResult,
  ) => Promise<void> | void;

  constructor(
    private config: PipelineConfig = {},
    options: PipelineRuntimeOptions = {},
  ) {
    this._state = createPipelineState();
    // Инициализация guardrail-политики (по умолчанию moderate)
    this.guardrailPolicy =
      config.guardrailPolicy ??
      createGuardrailPolicy('moderate', { PLZL: 50 });
    this.dataAgent = new DataAgent(this.config.data);
    this.researchAgent = new ResearchAgentV2({
      name: 'ResearchAgentV2',
      timeoutMs: 60000,
    });
    this.analysisAgent = new AnalysisAgent(this.config.analysis);
    this.aiAgent = new AiAgent(this.config.ai);
    // this.reviewAgent = new ReviewAgent(this.config.review); // Удалён
    this.scenarioAgent = new ScenarioAgent(this.config.scenario);
    this.strategistAgent = new StrategistAgent(this.config.strategist);
    this.notificationAgent = new NotificationAgent(this.config.notification);
    this.selfImprovementLoop = new SelfImprovementLoop({ name: 'SelfImprovementLoop' });
    this.learningAgent = new LearningAgent({
      historySource: () => [],
    });

    this.watchdog = options.watchdog ?? new Watchdog({ verbose: false });
    this.memorySink = options.memorySink;

    // Инциденты только логируются — автоперезапуск VS Code остаётся
    // ручным режимом (enableVsCodeRestart=false по умолчанию).
    this.watchdog.onIncident((incident) => {
      console.warn(
        `[Pipeline][Watchdog] Инцидент: ${incident.agentName} — ` +
          `${incident.message} (severity=${incident.severity})`,
      );
    });
  }

  get state(): PipelineState {
    return this._state;
  }

  get isRunning(): boolean {
    return this._state.stopped === false;
  }

  /**
   * Запустить полный конвейер.
   * @param sharedData — начальные данные, передаваемые между агентами
   */
  async run(sharedData: Record<string, unknown> = {}): Promise<PipelineResult> {
    this._state = createPipelineState();
    this._state.stopped = false;
    this._state.sharedData = sharedData ?? {};
    this.stageResults = {
      data: null,
      research: null,
      analysis: null,
      ai: null,
      review: null,
      scenario: null,
      strategist: null,
      notification: null,
    };
    this.agentSummaries = {};

    console.log('[Pipeline] 🚀 Конвейер запущен');

    // Живой мониторинг агентов: сторож стартует на каждый run().
    this.watchdog.start();

    const totalStart = Date.now();
    let error: Error | undefined;

    try {
      // ── Stage 1: Data Agent (обязательный, первый) ──
      const dataResult = await this.runStage<'data', DataAgentOutput>(
        'data',
        async () => {
          const result = await this.dataAgent.execute(null);
          return result.data as DataAgentOutput;
        },
      );

      if (!dataResult.result.success) {
        error = new Error(
          `Data Agent failed: ${dataResult.result.error?.message}`,
        );
        return this.buildResult(totalStart, error);
      }

      const dataOutput = dataResult.result.data!;

      // Сохраняем результат в оперативную память
      this.saveToMemory('data', dataOutput);

      // ── Stage 2: Research Agent V2 + Analysis Agent (параллельно) ──
      const [researchResult, analysisResult] = await Promise.all([
        this.runStage<'research', ResearchV1Output>('research', async () => {
          const result = await this.researchAgent.execute({
            action: 'facts',
            params: {
              tickers: [],
              facts: dataOutput,
            },
          });
          return result.data as ResearchV1Output;
        }),
        this.runStage<'analysis', AnalysisAgentOutput>('analysis', async () => {
          const result = await this.analysisAgent.execute(dataOutput);
          return result.data as AnalysisAgentOutput;
        }),
      ]);

      // Проверяем результаты параллельных этапов
      if (!researchResult.result.success) {
        console.warn(
          `[Pipeline] Research Agent warning: ${researchResult.result.error?.message}`,
        );
      }
      if (!analysisResult.result.success) {
        error = new Error(
          `Analysis Agent failed: ${analysisResult.result.error?.message}`,
        );
        return this.buildResult(totalStart, error);
      }

      const researchOutput = researchResult.result.success
        ? (researchResult.result.data as ResearchV1Output)
        : {
            action: 'facts' as const,
            success: true,
            message: 'ResearchAgentV2: fallback',
            newsSummary: '',
          };
      const analysisOutput = analysisResult.result.data;
      if (!analysisOutput) {
        error = new Error(
          'Analysis Agent returned no data (success=' +
            analysisResult.result.success +
            ', error=' +
            (analysisResult.result.error?.message ?? 'none') +
            ')',
        );
        console.error('[Pipeline] ❌ Analysis Agent: output is undefined', {
          success: analysisResult.result.success,
          error: analysisResult.result.error?.message,
        });
        return this.buildResult(totalStart, error);
      }

      // ── Детальный лог анализа портфеля ──
      const { portfolioAnalysis, income, priceAlerts } = analysisOutput;
      const assetsList = portfolioAnalysis.assetsAnalysis;
      const totalVal = portfolioAnalysis.macro.totalBalance;
      const freeCash = portfolioAnalysis.macro.freeCash;

      // Доли акций и облигаций
      const stocksPct = assetsList
        .filter((a) => a.assetType === 'А' || a.assetType === 'Акция')
        .reduce((s, a) => s + a.currentPercent, 0);
      const bondsPct = assetsList
        .filter((a) => a.assetType === 'О' || a.assetType === 'Облигация')
        .reduce((s, a) => s + a.currentPercent, 0);

      // Топ-5 активов по стоимости
      const topAssets = [...assetsList]
        .sort((a, b) => b.currentPrice * b.quantity - (a.currentPrice * a.quantity))
        .slice(0, 5);

      // Приоритеты покупок (активы с дефицитом, отсортированные по размеру дефицита)
      const buyPriorities = assetsList
        .filter((a) => a.deficitRub > 0)
        .sort((a, b) => b.deficitRub - a.deficitRub);

      // Концентрация (активы с долей > 20%)
      const concentrated = assetsList.filter((a) => a.currentPercent > 20);

      console.log('');
      console.log('═'.repeat(60));
      console.log('📊 АНАЛИЗ ПОРТФЕЛЯ');
      console.log('═'.repeat(60));
      console.log(`  Активов: ${assetsList.length} | Стоимость: ${Math.round(totalVal).toLocaleString('ru-RU')} ₽ | Кэш: ${Math.round(freeCash).toLocaleString('ru-RU')} ₽`);
      console.log(`  Структура: Акции ${stocksPct.toFixed(1)}% | Облигации ${bondsPct.toFixed(1)}%`);
      console.log('');
      console.log('  Топ-5 активов:');
      for (const a of topAssets) {
        const liq = Math.round(a.currentPrice * a.quantity).toLocaleString('ru-RU');
        const pnlPct =
          a.balancePrice > 0
            ? (((a.currentPrice - a.balancePrice) / a.balancePrice) * 100)
            : 0;
        const pnl = pnlPct !== 0 ? ` (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)` : '';
        console.log(`    • ${a.ticker} (${a.name}): ${liq} ₽ | Доля: ${a.currentPercent.toFixed(1)}% | Вход: ${a.balancePrice} ₽ | Текущая: ${a.currentPrice} ₽${pnl}`);
      }
      console.log('');
      if (buyPriorities.length > 0) {
        console.log('  Приоритеты покупок:');
        for (const a of buyPriorities) {
          console.log(`    • ${a.ticker}: дефицит ${Math.round(a.deficitRub).toLocaleString('ru-RU')} ₽ (целевая ${a.targetPercent?.toFixed(1)}%, текущая ${a.currentPercent.toFixed(1)}%)`);
        }
      } else {
        console.log('  Приоритеты покупок: нет (все позиции в норме)');
      }
      console.log('');
      if (concentrated.length > 0) {
        console.log('  ⚠️ Концентрация (>20%):');
        for (const a of concentrated) {
          console.log(`    • ${a.ticker}: ${a.currentPercent.toFixed(1)}%`);
        }
      }
      console.log('');
      console.log(`  Доходы: НКД ${income.totalNkd.toLocaleString('ru-RU')} ₽ | Дивиденды ${income.totalDivsNet.toLocaleString('ru-RU')} ₽ (чистые)`);
      if (priceAlerts.length > 0) {
        console.log(`  ⚠️ Ценовые алерты: ${priceAlerts.length}`);
        for (const p of priceAlerts) {
          console.log(`    • ${p.ticker}: ${p.alertLevel} ${p.threshold}%`);
        }
      }
      console.log('═'.repeat(60));
      console.log('');

      // Сохраняем результаты в оперативную память
      this.saveToMemory('research', researchOutput);
      this.saveToMemory('analysis', analysisOutput);

      // ── Stage 3: AI Agent (ждёт research + analysis) ──
      const aiResult = await this.runStage<'ai', AiAgentOutput>(
        'ai',
        async () => {
          const result = await this.aiAgent.execute({
            data: dataOutput,
            research: researchOutput,
            analysis: analysisOutput,
          });
          return result.data as AiAgentOutput;
        },
      );

      if (!aiResult.result.success) {
        console.warn(
          `[Pipeline] AI Agent warning: ${aiResult.result.error?.message}`,
        );
        // AI — необязательный этап, продолжаем с пустым результатом
      }

      const aiOutput =
        aiResult.result.success && aiResult.result.data
          ? aiResult.result.data
          : {
              thesisResults: new Map(),
              aiNarrative: '',
              aiClientResult: {
                text: '',
                modelUsed: 'SKIPPED',
                success: false,
                error: aiResult.result.error?.message,
              },
              structuredRecommendations: new Map(),
              validationWarnings: [],
            };

      // Сохраняем результат AI в оперативную память
      this.saveToMemory('ai', aiOutput);

      // Сохраняем AI-рекомендации для SelfImprovementLoop
      for (const [ticker, rec] of aiOutput.structuredRecommendations) {
        this.aiRecommendations.push({
          pipelineId: this._state.pipelineId,
          ticker,
          recommendedAction: rec.action ?? 'HOLD',
          factualResult: 'pending', // будет проверено PostFactumCheck
          recordedAt: new Date().toISOString(),
        });
      }
      this.cleanupAiRecommendations();

      // ── Stage 4: Review Agent (заглушка — удалён) ──
      const reviewResult = await this.runStage<'review', ReviewResult>(
        'review',
        async () => {
          // ReviewAgent удалён — возвращаем заглушку
          const stub: ReviewResult = {
            agreement: 100,
            agreementPercent: 100,
            discrepancies: [],
            hasDisagreement: false,
            timeMs: 0,
            successful: 0,
            timeouts: 0,
            finalRecommendation: 'ReviewAgent удалён',
          };
          return stub;
        },
      );

      if (!reviewResult.result.success) {
        console.warn(
          `[Pipeline] Review Agent warning: ${reviewResult.result.error?.message}`,
        );
        // Review — необязательный этап, продолжаем
      }

      this.reviewResultData = reviewResult.result.success
        ? reviewResult.result.data!
        : null;

      // Извлекаем данные для новых агентов (в scope для всех этапов)
      const assetsAnalysisList =
        analysisOutput.portfolioAnalysis.assetsAnalysis;
      const macroGoalsData = dataOutput.macroGoals;
      const assetsAnalysisJson = JSON.parse(JSON.stringify(assetsAnalysisList));
      const macroGoalsJson = JSON.parse(JSON.stringify(macroGoalsData));

      // ── Stage 4.5: Scenario Agent (сценарии "что если") ──
      const scenarioResult = await this.runStage<
        'scenario',
        ScenarioAgentOutput
      >('scenario', async () => {
        // Извлекаем proposed changes из AI-рекомендаций
        const proposedChanges: Array<{
          ticker: string;
          action: 'BUY' | 'SELL' | 'REDUCE' | 'HOLD';
          amountRub: number;
        }> = [];

        if (aiResult.result.success && aiOutput.structuredRecommendations) {
          for (const [ticker, rec] of aiOutput.structuredRecommendations) {
            if (rec.recommendedAction && rec.recommendedAction !== 'HOLD') {
              const asset = assetsAnalysisJson.find(
                (a: { ticker: string; deficitRub?: number }) =>
                  a.ticker.toUpperCase() === ticker.toUpperCase(),
              );
              proposedChanges.push({
                ticker,
                action: rec.recommendedAction as
                  'BUY' | 'SELL' | 'REDUCE' | 'HOLD',
                amountRub: asset?.deficitRub ?? 0,
              });
            }
          }
        }

        const scenarioInput = {
          assetsAnalysis: assetsAnalysisJson,
          totalPortfolioValue: macroGoalsJson.totalBalance ?? 0,
          freeCashRub: macroGoalsJson.freeCash ?? 0,
          proposedChanges: proposedChanges.map((c) => ({
            ticker: c.ticker,
            action: c.action === 'SELL' ? 'SELL' : c.action,
            amountRub: Math.abs(c.amountRub),
           })),
        };

        console.log(
          `[Pipeline] ScenarioAgent input: assets=${scenarioInput.assetsAnalysis.length}, ` +
            `total=${scenarioInput.totalPortfolioValue}, freeCash=${scenarioInput.freeCashRub}, ` +
            `proposedChanges=${scenarioInput.proposedChanges.length}`,
        );
        if (scenarioInput.proposedChanges.length > 0) {
          console.log(
            '[Pipeline] Proposed changes:',
            scenarioInput.proposedChanges
              .map((c) => `${c.ticker}=${c.action} ${c.amountRub}₽`)
              .join(', '),
          );
        }

        const result = await this.scenarioAgent.execute(scenarioInput);
        return result.data as ScenarioAgentOutput;
      });

      if (!scenarioResult.result.success) {
        console.warn(
          `[Pipeline] Scenario Agent warning: ${scenarioResult.result.error?.message}`,
        );
      }

      this.scenarioResultData = scenarioResult.result.success
        ? scenarioResult.result.data!
        : {
            scenarios: [],
            bestScenarioId: null,
            summary: {
              scenariosBuilt: 0,
              baselineDeviationPct: 0,
              bestImprovementPct: 0,
            },
          };

      // ── Stage 4.6: Strategist Agent (правила защиты) ──
      const strategistResult = await this.runStage<
        'strategist',
        StrategistAgentOutput
      >('strategist', async () => {
        const proposals: StrategistProposal[] = [];

        if (aiResult.result.success && aiOutput.structuredRecommendations) {
          for (const [ticker, rec] of aiOutput.structuredRecommendations) {
            proposals.push({
              ticker,
              action: rec.recommendedAction,
              keyCatalysts: rec.keyCatalysts ?? [],
              rationale: rec.rationale ?? null,
            });
          }
        }

        const strategistInput = {
          assetsAnalysis: assetsAnalysisJson,
          proposals,
        };

        const result = await this.strategistAgent.execute(strategistInput);
        return result.data as StrategistAgentOutput;
      });

      if (!strategistResult.result.success) {
        console.warn(
          `[Pipeline] Strategist Agent warning: ${strategistResult.result.error?.message}`,
        );
      }

      this.strategistResultData = strategistResult.result.success
        ? strategistResult.result.data!
        : { decisions: [], summary: { assetsChecked: 0, goal: '' } };

      // ── Stage 4.7: Consilium (совещание агентов) ──
      if (this.scenarioResultData && this.strategistResultData) {
        const proposals: Array<{
          ticker: string;
          action: import('./agents/strategist-agent.js').StrategistProposal['action'];
          keyCatalysts?: string[];
          rationale?: string | null;
        }> = [];
        if (aiResult.result.success && aiOutput.structuredRecommendations) {
          for (const [ticker, rec] of aiOutput.structuredRecommendations) {
            proposals.push({
              ticker,
              action: rec.recommendedAction,
              keyCatalysts: rec.keyCatalysts ?? [],
              rationale: rec.rationale ?? null,
            });
          }
        }

        const consiliumOutput = runConsilium({
          assetsAnalysis: assetsAnalysisJson,
          proposals,
          strategistOutput: this.strategistResultData,
          scenarioOutput: this.scenarioResultData,
          newsContext:
            researchOutput?.newsSummary ?? '',
          sentimentData: researchOutput?.data?.sentimentData,
        });

        this.consiliumResultData = consiliumOutput;
      }

      // ── Stage 5: Notification Agent (ждёт data + analysis + ai + review + consilium) ──
      // Вычисляем статистику обратной связи
      const feedbackStats = this.computeFeedbackStats();

      const notificationResult = await this.runStage<
        'notification',
        NotificationAgentOutput
      >('notification', async () => {
        const result = await this.notificationAgent.execute({
          data: dataOutput,
          analysis: analysisOutput,
          ai: aiOutput,
          review: this.reviewResultData ?? undefined,
          scenario: this.scenarioResultData ?? undefined,
          strategist: this.strategistResultData ?? undefined,
          consilium: this.consiliumResultData ?? undefined,
          feedbackStats,
        });
        return result.data as NotificationAgentOutput;
      });

      if (!notificationResult.result.success) {
        error = new Error(
          `Notification Agent failed: ${notificationResult.result.error?.message}`,
        );
        return this.buildResult(totalStart, error);
      }

      // Сохраняем результат Notification в оперативную память
      this.saveToMemory('notification', notificationResult.result.data);

      // Извлекаем интерактивные ордера из результата Notification Agent
      const notificationData = notificationResult.result.data;
      if (notificationData && 'interactiveOrders' in notificationData) {
        const orders = (
          notificationData as {
            interactiveOrders: Array<{
              ticker: string;
              action: string;
              id: string;
            }>;
          }
        ).interactiveOrders;
        
        // Guardrail-проверка: продажа в убыток > порога требует подтверждения
        const validatedOrders = this.validateOrdersWithGuardrails(
          orders,
          assetsAnalysisList,
        );
        
        this.interactiveOrdersData = validatedOrders.map((o) => ({
          ticker: o.ticker,
          action: o.action,
          id: o.id,
        }));
        
        // Логирование guardrail-предупреждений
        const warnings = validatedOrders.filter(
          (o) => o.guardrailWarning,
        );
        if (warnings.length > 0) {
          console.warn(
            `[Pipeline] ⚠️ Guardrail: ${warnings.length} ордер(ов) требуют подтверждения:`,
            warnings.map((o) => `${o.ticker}=${o.action} (${o.guardrailWarning})`).join(', '),
          );
        }
      }

      // Строим итоговый результат

      // ── Self-Improvement: обучение на основе AI-рекомендаций ──
      try {
        console.log('[Pipeline] 🧠 Запуск SelfImprovementLoop...');
        const improvementResult = await this.selfImprovementLoop.execute({
          action: 'update',
          newOutcomes: this.aiRecommendations.map((r) => ({
            ...r,
            success: r.factualResult === 'correct',
          })),
        });
        // execute возвращает AgentResult<unknown> — извлекаем data
        type ImprovementOutput = {
          message?: string;
          patterns?: Array<{ pattern: string; description: string; accuracy: number; sampleSize: number; applicableTickers: string[]; recommendation: string }>;
          strategyWeights?: Record<string, number>;
        };
        const output = (improvementResult as unknown as { data: ImprovementOutput }).data as ImprovementOutput;
        console.log(
          `[Pipeline] 🧠 SelfImprovementLoop: ${output?.message || 'завершён'}`,
        );
        // Сохраняем паттерны и веса стратегий в память
        if (output?.patterns && output.patterns.length > 0) {
          this.saveToMemory('strategist', {
            patterns: output.patterns,
            strategyWeights: output.strategyWeights,
          });
        }
      } catch (improvementErr) {
        console.warn(
          `[Pipeline] ⚠️ SelfImprovementLoop ошибка: ${improvementErr instanceof Error ? improvementErr.message : String(improvementErr)}`,
        );
      }

      const result = this.buildResult(totalStart);

      // Сохраняем KPI-снимок через memorySink (реальные данные из PipelineResult)
      if (this.memorySink && result.success) {
        try {
          await this.memorySink(result);
        } catch (sinkErr) {
          const sinkMsg =
            sinkErr instanceof Error ? sinkErr.message : String(sinkErr);
          console.warn(`[Pipeline] Ошибка memorySink: ${sinkMsg}`);
        }
      }

      console.log(`[Pipeline] ✅ Конвейер завершён за ${(Date.now() - totalStart)}мс`);
      return result;
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      console.error(`[Pipeline] ❌ Ошибка: ${error.message}`);
      return this.buildResult(totalStart, error);
    } finally {
      // Graceful shutdown всех агентов — ошибки не роняют результат
      try {
        await this.shutdown();
      } catch (shutdownErr) {
        console.warn(
          `[Pipeline] ⚠️ Ошибка shutdown: ${shutdownErr instanceof Error ? shutdownErr.message : String(shutdownErr)}`,
        );
      }
    }
  }

  /**
    * Загрузить последний результат pipeline из оперативной памяти.
    * Возвращает null, если результат не найден.
    */
  static async loadLastPipelineResult(): Promise<PipelineResult | null> {
    try {
      const entries = getByType('pipeline_result', 1);
      if (entries.length === 0) {
        return null;
      }
      const lastEntry = entries[0];
      if (!lastEntry) {
        return null;
      }
      const data = JSON.parse(lastEntry.content);
      return data;
    } catch (err) {
      console.error('[Pipeline] Ошибка загрузки последнего результата:', err);
      return null;
    }
  }

  /** Остановить конвейер */
  async shutdown(): Promise<void> {
    this._state.stopped = true;
    await Promise.all([
      this.dataAgent.stop(),
      this.researchAgent.stop(),
      this.analysisAgent.stop(),
      this.aiAgent.stop(),
      // this.reviewAgent.stop(), // Удалён
      this.scenarioAgent.stop(),
      this.strategistAgent.stop(),
      this.notificationAgent.stop(),
      this.watchdog.stop(),
      this.selfImprovementLoop.stop(),
    ]);
  }

  /** Получить сводки по всем агентам */
  getAgentSummaries(): Record<string, AgentSummary> {
    return {
      data: this.dataAgent.getSummary(),
      research: this.researchAgent.getSummary(),
      analysis: this.analysisAgent.getSummary(),
      ai: this.aiAgent.getSummary(),
      // review: this.reviewAgent.getSummary(), // Удалён
      scenario: this.scenarioAgent.getSummary(),
      strategist: this.strategistAgent.getSummary(),
      notification: this.notificationAgent.getSummary(),
    };
  }

  /** Обновить outcome AI-рекомендации (пользовательская обратная связь) */
  /**
   * Обновить субъективную оценку пользователя (👍/👎).
   * ТОЛЬКО для статистики — не влияет на обучение ИИ.
   * Обучение происходит через PostFactumCheck по фактическим результатам.
   */
  async updateRecommendationOutcome(
    ticker: string,
    feedback: 'good' | 'bad',
    _note?: string,
  ): Promise<void> {
    // Обновляем локальный массив (только для статистики)
    const rec = this.aiRecommendations.find((r) => r.ticker === ticker);
    if (rec) {
      rec.userFeedback = feedback;
      console.log(
        `[Pipeline] 👍/👎 по ${ticker}: ${feedback} (только статистика)`,
      );
    }
  }

  /** Получить стратегические веса */
  async getStrategyWeights(): Promise<Record<string, number> | null> {
    // Веса хранятся в памяти — читаем из последней записи
    try {
      const result = await aiMemoryImpl.query({
        types: ['pipeline_result'],
        maxResults: 10,
      });
      const entries = result.operationalEntries ?? [];
      for (const entry of entries) {
        try {
          const content = JSON.parse(entry.content as string);
          if (content.strategyWeights) {
            return content.strategyWeights;
          }
        } catch {
          // Пропускаем некорректные записи
        }
      }
    } catch {
      // Память недоступна
    }
    return null;
  }

  /**
   * PostFactumCheck — проверка рекомендаций через 30 дней.
   * Проверяет, были ли рекомендации ИИ верными, сравнивая цену
   * на дату рекомендации и через 30 дней.
   * Фактические результаты идут в обучение, а не субъективные 👍/👎.
   */
  async runPostFactumCheck(): Promise<void> {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const NOW = Date.now();

    // Находим рекомендации старше 30 дней, которые ещё не проверены
    const pendingRecs = this.aiRecommendations.filter((r) => {
      const recordedMs = new Date(r.recordedAt).getTime();
      return (
        (NOW - recordedMs) > THIRTY_DAYS_MS &&
        r.factualResult === 'pending'
      );
    });

    if (pendingRecs.length === 0) {
      console.log('[Pipeline] PostFactumCheck: нет рекомендаций для проверки');
      return;
    }

    console.log(
      `[Pipeline] PostFactumCheck: проверяем ${pendingRecs.length} рекомендаций`,
    );

    // Собираем уникальные тикеры для пакетной загрузки
    const uniqueTickers = [...new Set(pendingRecs.map((r) => r.ticker))];
    console.log(
      `[PostFactum] Загружаю исторические данные для ${uniqueTickers.length} тикеров...`,
    );

    // Пакетная загрузка исторических данных
    const allBars = await fetchHistoricalBatch(
      uniqueTickers,
      '2020-01-01',
      new Date().toISOString().split('T')[0]!,
      'D',
    );

    for (const rec of pendingRecs) {
      try {
        const bars = allBars.get(rec.ticker);
        if (!bars || bars.length === 0) {
          console.warn(
            `[PostFactum] Нет данных для ${rec.ticker} — пропуск`,
          );
          continue;
        }

        // Определяем, была ли рекомендация верной
        // BUY → цена выросла → correct
        // SELL/REDUCE → цена упала → correct
        // HOLD → цена не изменилась существенно → correct
        const recDate = new Date(rec.recordedAt);
        const endDate = new Date(recDate);
        endDate.setDate(endDate.getDate() + 30);

        const recDateStr = rec.recordedAt.split('T')[0]!;
        const endDateStr = endDate.toISOString().split('T')[0]!;

        // Находим свечу на дату рекомендации
        const startBar = bars.find((b) => b.date >= recDateStr);
        if (!startBar) {
          console.warn(
            `[PostFactum] Не найдена цена на дату для ${rec.ticker} — пропуск`,
          );
          continue;
        }

        // Находим свечу через 30 дней
        const endBar = bars
          .filter((b) => b.date <= endDateStr)
          .pop();
        if (!endBar) {
          console.warn(
            `[PostFactum] Не найдена цена через 30 дней для ${rec.ticker} — пропуск`,
          );
          continue;
        }

        const priceAtRecommendation = startBar.close;
        const priceAfter30Days = endBar.close;
        const changePct =
          ((priceAfter30Days - priceAtRecommendation) / priceAtRecommendation) *
          100;

        let isCorrect = false;
        if (rec.recommendedAction === 'BUY') {
          isCorrect = changePct > 0;
        } else if (rec.recommendedAction === 'SELL' || rec.recommendedAction === 'REDUCE') {
          isCorrect = changePct < 0;
        } else {
          // HOLD — цена не изменилась существенно (±5%)
          isCorrect = Math.abs(changePct) <= 5;
        }

        rec.factualResult = isCorrect ? 'correct' : 'incorrect';
        rec.checkedAt = new Date().toISOString();

        // Фактический результат идёт в обучение
        await this.learningAgent.feedback({
          outcome: isCorrect ? 'good' : 'bad',
          action: `postfactum:recommendation:${rec.ticker}:${rec.recommendedAction}`,
          note: `Рекомендация ${rec.recommendedAction} по ${rec.ticker} (${recDateStr}) → ${isCorrect ? 'верна' : 'неверна'} (изменение: ${changePct.toFixed(1)}%)`,
          agent: 'postfactum-check',
        });

        console.log(
          `[PostFactum] ${rec.ticker}: ${rec.recommendedAction} → ` +
            `${priceAtRecommendation} → ${priceAfter30Days} (${changePct.toFixed(1)}%) → ` +
            `${isCorrect ? '✅ верно' : '❌ неверно'}`,
        );
      } catch (err) {
        console.warn(
          `[Pipeline] PostFactumCheck ошибка для ${rec.ticker}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Очистка устаревших данных:
   * - Рекомендации старше 60 дней (30 дней на проверку + 30 дней на хранение)
   */
  async cleanupOldData(): Promise<void> {
    const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
    const NOW = Date.now();

    // Удаляем рекомендации старше 60 дней
    const beforeCount = this.aiRecommendations.length;
    this.aiRecommendations = this.aiRecommendations.filter((r) => {
      const recordedMs = new Date(r.recordedAt).getTime();
      return (NOW - recordedMs) <= SIXTY_DAYS_MS;
    });
    const removed = beforeCount - this.aiRecommendations.length;

    if (removed > 0) {
      console.log(`[Pipeline] Cleanup: удалено ${removed} устаревших рекомендаций`);
    }
  }

  // ── Helpers ──

  /** Вычислить статистику обратной связи по рекомендациям */
  private computeFeedbackStats(): {
    total: number;
    userGood: number;
    userBad: number;
    factualCorrect: number;
    factualIncorrect: number;
    pending: number;
  } {
    const stats = {
      total: this.aiRecommendations.length,
      userGood: 0,
      userBad: 0,
      factualCorrect: 0,
      factualIncorrect: 0,
      pending: 0,
    };

    for (const rec of this.aiRecommendations) {
      if (rec.userFeedback === 'good') stats.userGood++;
      if (rec.userFeedback === 'bad') stats.userBad++;
      if (rec.factualResult === 'correct') stats.factualCorrect++;
      if (rec.factualResult === 'incorrect') stats.factualIncorrect++;
      if (rec.factualResult === 'pending' || !rec.factualResult) stats.pending++;
    }

    return stats;
  }

  private async runStage<TStage extends PipelineStage, TData>(
    stage: TStage,
    execute: () => Promise<TData>,
  ): Promise<PipelineStageResult<TData>> {
    const stageStart = Date.now();
    const agentName = STAGE_AGENT_NAMES[stage];

    // Регистрируем агента в Watchdog и ставим текущее задание
    this.watchdog.registerAgent(agentName);
    this.watchdog.setAgentTask(
      agentName,
      this._state.pipelineId,
      DEFAULT_THRESHOLDS.timeoutThresholdMs,
    );

    try {
      const data = await execute();
      if (data === undefined || data === null) {
        const emptyError = new Error(`Stage ${stage} completed but returned no data`);
        console.error(`[Pipeline] ❌ Stage ${stage}: empty result`, {
          stage,
          agentName,
        });
        const durationMs = Date.now() - stageStart;
        const result: PipelineStageResult<TData> = {
          stage,
          result: {
            success: false,
            data: undefined,
            error: emptyError,
            durationMs,
            completedAt: new Date().toISOString(),
          },
          durationMs,
        };
        this.stageResults[stage] = result;
        return result;
      }
      const durationMs = Date.now() - stageStart;

      // После выполнения — проверка здоровья (регистрация остаётся в отчёте)
      const check = await this.watchdog.checkAgent(agentName);
      if (check.status !== 'healthy') {
        console.warn(
          `[Pipeline][Watchdog] Агент ${agentName}: статус «${check.status}» ` +
            `(${check.responseTimeMs}мс)`,
        );
      }

      const result: PipelineStageResult<TData> = {
        stage,
        result: {
          success: true,
          data,
          durationMs,
          completedAt: new Date().toISOString(),
        },
        durationMs,
      };

      this.stageResults[stage] = result;
      console.log(`[Pipeline] ✅ Stage ${stage} completed in ${durationMs}ms`);

      // Уведомляем слушателей о завершении стадии
      for (const listener of this.stageListeners) {
        try {
          listener(stage, durationMs);
        } catch {
          // Слушатели могут падать — не роняем конвейер
        }
      }

      return result;
    } catch (err) {
      const durationMs = Date.now() - stageStart;
      const error = err instanceof Error ? err : new Error(String(err));

      // Агент упал — тоже фиксируем проверку здоровья
      await this.watchdog.checkAgent(agentName);

      // Уведомляем слушателей даже при ошибке
      for (const listener of this.stageListeners) {
        try {
          listener(stage, durationMs);
        } catch {
          // no-op
        }
      }

      const result: PipelineStageResult<TData> = {
        stage,
        result: {
          success: false,
          error,
          durationMs,
          completedAt: new Date().toISOString(),
        },
        durationMs,
      };

      this.stageResults[stage] = result;
      console.error(`[Pipeline] ❌ Stage ${stage} failed: ${error.message}`);

      return result;
    }
  }

  /**
   * Guardrail-проверка ордеров: продажа в убыток > порога требует подтверждения.
   */
  private validateOrdersWithGuardrails(
    orders: Array<{ ticker: string; action: string; id: string }>,
    assetsAnalysis: AssetAnalysis[],
  ): Array<{
    ticker: string;
    action: string;
    id: string;
    guardrailWarning?: string;
    requiresManualConfirm?: boolean;
  }> {
    return orders.map((order) => {
      const upperTicker = order.ticker.toUpperCase();
      const asset = assetsAnalysis.find(
        (a) => a.ticker.toUpperCase() === upperTicker,
      );

      // Проверяем, является ли ордер продажей/сокращением
      const isSellAction = ['SELL', 'REDUCE', 'EXIT'].includes(order.action);
      if (!isSellAction || !asset) {
        return order;
      }

      // Рассчитываем убыток по позиции
      const balancePrice = asset.balancePrice ?? 0;
      const currentPrice = asset.currentPrice ?? 0;
      
      let lossPct = 0;
      if (balancePrice > 0 && currentPrice > 0) {
        lossPct = ((currentPrice - balancePrice) / balancePrice) * 100;
      }

      // Проверяем порог убытка
      const threshold = this.guardrailPolicy.lossThresholdPct;
      const requiresConfirm = lossPct < -threshold;

      if (requiresConfirm) {
        return {
          ...order,
          guardrailWarning: `Продажа в убыток ${lossPct.toFixed(1)}% (порог ${threshold}%)`,
          requiresManualConfirm: true,
        };
      }

      return order;
    });
  }

  private buildResult(totalStart: number, error?: Error): PipelineResult {
    // Обновляем сводки агентов
    this.agentSummaries = this.getAgentSummaries();

    // Отчёт Watchdog попадает в результат только при реальных проверках
    const watchdogHealth = this.watchdog.getHealthReport();
    const healthIncluded =
      watchdogHealth.agents.length > 0 ? watchdogHealth : undefined;

    return {
      pipelineId: this._state.pipelineId,
      startedAt: this._state.startedAt,
      completedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - totalStart,
      stages: this.stageResults as Record<
        PipelineStage,
        PipelineStageResult | null
      >,
      reviewResult: this.reviewResultData || undefined,
      scenarioResult: this.scenarioResultData || undefined,
      strategistResult: this.strategistResultData || undefined,
      consiliumResult: this.consiliumResultData || undefined,
      interactiveOrders:
        this.interactiveOrdersData.length > 0
          ? this.interactiveOrdersData
          : undefined,
      agentSummaries: this.agentSummaries,
      watchdogHealth: healthIncluded,
      success: error === undefined,
      error,
    };
  }
}
