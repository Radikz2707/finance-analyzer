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
import { aiMemoryImpl } from './ai-memory/index.js';
import type { PortfolioKpiSnapshot } from './ai-memory/types.js';
import { Watchdog } from './watchdog/watchdog.js';
import type { AgentHealthReport } from './watchdog/types.js';
import { DEFAULT_THRESHOLDS } from './watchdog/types.js';

// ──────────────────────────────────────────────
// 1. Pipeline stage definitions
// ──────────────────────────────────────────────

/** Этап конвейера */
export type PipelineStage =
  'data' | 'research' | 'analysis' | 'ai' | 'review' | 'notification';

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
  private notificationAgent: NotificationAgent;

  private stageResults: Record<PipelineStage, PipelineStageResult | null> = {
    data: null,
    research: null,
    analysis: null,
    ai: null,
    review: null,
    notification: null,
  };

  private agentSummaries: Record<string, AgentSummary> = {};
  private reviewResultData: ReviewResult | null = null;
  private interactiveOrdersData: Array<{
    ticker: string;
    action: string;
    id: string;
  }> = [];

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

  /**
   * Сохранить KPI-снимок в стратегическую память.
   */
  private saveKpiSnapshot(): void {
    try {
      const snapshot: PortfolioKpiSnapshot = {
        date: new Date().toISOString(),
        totalValue: 0,
        returnPercent: 0,
        volatility: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        assetCount: 0,
        stocksPercent: 0,
        bondsPercent: 0,
        dividendIncome: 0,
        realizedProfit: 0,
        unrealizedProfit: 0,
      };

      // Получаем данные из sharedData если они есть
      if (this._state.sharedData.portfolio) {
        const portfolio = this._state.sharedData.portfolio as Record<
          string,
          unknown
        >;
        snapshot.totalValue = (portfolio.totalValue as number) || 0;
        snapshot.returnPercent = (portfolio.returnPercent as number) || 0;
        snapshot.assetCount = (portfolio.assetCount as number) || 0;
      }

      aiMemoryImpl.saveStrategicKpi(snapshot);
      console.log('[Pipeline] KPI-снимок сохранён в стратегическую память');
    } catch (err) {
      console.warn('[Pipeline] Ошибка записи KPI в память:', err);
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

      // ── Stage 5: Notification Agent (ждёт data + analysis + ai + review) ──
      const notificationResult = await this.runStage<
        'notification',
        NotificationAgentOutput
      >('notification', async () => {
        const result = await this.notificationAgent.execute({
          data: dataOutput,
          analysis: analysisOutput,
          ai: aiOutput,
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

      // Сохраняем KPI-снимок в стратегическую память
      this.saveKpiSnapshot();

      const result = this.buildResult(totalStart);

      // Авто-архивация KPI во внешнюю стратегическую память (DI).
      // Без memorySink ничего не происходит; падение колбэка не роняет run().
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

      return result;
    } catch (err) {
      const durationMs = Date.now() - stageStart;
      const error = err instanceof Error ? err : new Error(String(err));

      // Агент упал — тоже фиксируем проверку здоровья
      await this.watchdog.checkAgent(agentName);

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
      stages: this.stageResults,
      reviewResult: this.reviewResultData || undefined,
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
