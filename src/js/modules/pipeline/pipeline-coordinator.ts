import type {
  PipelineState,
  AgentResult,
  AgentSummary,
  AgentConfig,
} from './agent/types.js';
import { createPipelineState } from './agent/types.js';
import { DataAgent, type DataAgentOutput } from './agents/data-agent.js';
import {
  ResearchAgent,
  type ResearchAgentOutput,
} from './agents/research-agent.js';
import {
  AnalysisAgent,
  type AnalysisAgentOutput,
} from './agents/analysis-agent.js';
import { AiAgent, type AiAgentOutput } from './agents/ai-agent.js';
import {
  NotificationAgent,
  type NotificationAgentOutput,
} from './agents/notification-agent.js';
import { ReviewAgent, type ReviewResult } from './review/review-agent.js';
import { ScenarioAgent, type ScenarioAgentOutput } from './agents/scenario-agent.js';
import {
  StrategistAgent,
  type StrategistAgentOutput,
  type StrategistProposal,
} from './agents/strategist-agent.js';
import { runConsilium, type ConsiliumOutput } from './agents/consilium.js';
import { aiMemoryImpl } from './ai-memory/index.js';
import { Watchdog } from './watchdog/watchdog.js';
import type { AgentHealthReport } from './watchdog/types.js';
import { DEFAULT_THRESHOLDS } from './watchdog/types.js';

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
  private researchAgent: ResearchAgent;
  private analysisAgent: AnalysisAgent;
  private aiAgent: AiAgent;
  private reviewAgent: ReviewAgent;
  private scenarioAgent: ScenarioAgent;
  private strategistAgent: StrategistAgent;
  private notificationAgent: NotificationAgent;

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
  private stageListeners: Array<(stage: PipelineStage, durationMs: number) => void> = [];

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

  /** Подписаться на завершение стадии конвейера */
  onStageComplete(callback: (stage: PipelineStage, durationMs: number) => void): () => void {
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

  private readonly watchdog: Watchdog;
  private readonly memorySink?: (
    result: PipelineResult,
  ) => Promise<void> | void;

  constructor(
    private config: PipelineConfig = {},
    options: PipelineRuntimeOptions = {},
  ) {
    this._state = createPipelineState();
    this.dataAgent = new DataAgent(this.config.data);
    this.researchAgent = new ResearchAgent(this.config.research);
    this.analysisAgent = new AnalysisAgent(this.config.analysis);
    this.aiAgent = new AiAgent(this.config.ai);
    this.reviewAgent = new ReviewAgent(this.config.review);
    this.scenarioAgent = new ScenarioAgent(this.config.scenario);
    this.strategistAgent = new StrategistAgent(this.config.strategist);
    this.notificationAgent = new NotificationAgent(this.config.notification);

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

      // ── Stage 2: Research Agent + Analysis Agent (параллельно) ──
      const [researchResult, analysisResult] = await Promise.all([
        this.runStage<'research', ResearchAgentOutput>('research', async () => {
          const result = await this.researchAgent.execute(dataOutput);
          return result.data as ResearchAgentOutput;
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
        ? researchResult.result.data!
        : {
            snapshots: new Map(),
            allConflicts: [],
            totalAssets: 0,
            researchTimestamp: new Date().toISOString(),
          };
      const analysisOutput = analysisResult.result.data!;

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

      const aiOutput = aiResult.result.success
        ? aiResult.result.data!
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

      // ── Stage 4: Review Agent (проверка 3 ревизорами) ──
      const reviewResult = await this.runStage<'review', ReviewResult>(
        'review',
        async () => {
          const result = await this.reviewAgent.execute({
            data: dataOutput,
            analysis: analysisOutput,
            ai: aiOutput,
          });
          return result.data as ReviewResult;
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
      const assetsAnalysisList = analysisOutput.portfolioAnalysis.assetsAnalysis;
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
                action: rec.recommendedAction as 'BUY' | 'SELL' | 'REDUCE' | 'HOLD',
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
        : { scenarios: [], bestScenarioId: null, summary: { scenariosBuilt: 0, baselineDeviationPct: 0, bestImprovementPct: 0 } };

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
          newsContext: researchOutput?.allConflicts
            ?.map((c) => `${c.field}: ${c.providerA}=${c.valueA} vs ${c.providerB}=${c.valueB}`)
            .join('; ') ?? '',
        });

        this.consiliumResultData = consiliumOutput;
      }

      // ── Stage 5: Notification Agent (ждёт data + analysis + ai + review + consilium) ──
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
        this.interactiveOrdersData = orders.map((o) => ({
          ticker: o.ticker,
          action: o.action,
          id: o.id,
        }));
      }

      // Строим итоговый результат
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

      return result;
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      return this.buildResult(totalStart, error);
    } finally {
      // Graceful shutdown всех агентов
      await this.shutdown();
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
      this.reviewAgent.stop(),
      this.scenarioAgent.stop(),
      this.strategistAgent.stop(),
      this.notificationAgent.stop(),
      this.watchdog.stop(),
    ]);
  }

  /** Получить сводки по всем агентам */
  getAgentSummaries(): Record<string, AgentSummary> {
    return {
      data: this.dataAgent.getSummary(),
      research: this.researchAgent.getSummary(),
      analysis: this.analysisAgent.getSummary(),
      ai: this.aiAgent.getSummary(),
      review: this.reviewAgent.getSummary(),
      scenario: this.scenarioAgent.getSummary(),
      strategist: this.strategistAgent.getSummary(),
      notification: this.notificationAgent.getSummary(),
    };
  }

  // ── Helpers ──

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
      stages: this.stageResults as Record<PipelineStage, PipelineStageResult | null>,
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
