import type {
  PipelineState,
  AgentResult,
  AgentSummary,
  AgentConfig,
} from './agent/types.js';
import { createPipelineState } from './agent/types.js';
import { DataAgent, type DataAgentOutput } from './agents/data-agent.js';
import { ResearchAgent, type ResearchAgentOutput } from './agents/research-agent.js';
import { AnalysisAgent, type AnalysisAgentOutput } from './agents/analysis-agent.js';
import { AiAgent, type AiAgentOutput } from './agents/ai-agent.js';
import { NotificationAgent, type NotificationAgentOutput } from './agents/notification-agent.js';
import { ReviewAgent, type ReviewResult } from './review/review-agent.js';
import { aiMemoryImpl } from './ai-memory/index.js';
import type { PortfolioKpiSnapshot } from './ai-memory/types.js';

// ──────────────────────────────────────────────
// 1. Pipeline stage definitions
// ──────────────────────────────────────────────

/** Этап конвейера */
export type PipelineStage =
  | 'data'
  | 'research'
  | 'analysis'
  | 'ai'
  | 'review'
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
  /** Сводки по всем агентам */
  agentSummaries: Record<string, AgentSummary>;
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

  /**
   * Сохранить результат этапа в оперативную память ИИ.
   */
  private saveToMemory(stage: PipelineStage, data: unknown): void {
    try {
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
        const portfolio = this._state.sharedData.portfolio as Record<string, unknown>;
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

  constructor(
    private config: PipelineConfig = {},
  ) {
    this._state = createPipelineState();
    this.dataAgent = new DataAgent(this.config.data);
    this.researchAgent = new ResearchAgent(this.config.research);
    this.analysisAgent = new AnalysisAgent(this.config.analysis);
    this.aiAgent = new AiAgent(this.config.ai);
    this.reviewAgent = new ReviewAgent(this.config.review);
    this.notificationAgent = new NotificationAgent(this.config.notification);
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
        this.runStage<'research', ResearchAgentOutput>(
          'research',
          async () => {
            const result = await this.researchAgent.execute(dataOutput);
            return result.data as ResearchAgentOutput;
          },
        ),
        this.runStage<'analysis', AnalysisAgentOutput>(
          'analysis',
          async () => {
            const result = await this.analysisAgent.execute(dataOutput);
            return result.data as AnalysisAgentOutput;
          },
        ),
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

      const researchOutput = researchResult.result.data!;
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
      const notificationResult = await this.runStage<'notification', NotificationAgentOutput>(
        'notification',
        async () => {
          const result = await this.notificationAgent.execute({
            data: dataOutput,
            analysis: analysisOutput,
            ai: aiOutput,
          });
          return result.data as NotificationAgentOutput;
        },
      );

      if (!notificationResult.result.success) {
        error = new Error(
          `Notification Agent failed: ${notificationResult.result.error?.message}`,
        );
        return this.buildResult(totalStart, error);
      }

      // Сохраняем результат Notification в оперативную память
      this.saveToMemory('notification', notificationResult.result.data);

      // Сохраняем KPI-снимок в стратегическую память
      this.saveKpiSnapshot();

      return this.buildResult(totalStart);
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

    try {
      const data = await execute();
      const durationMs = Date.now() - stageStart;

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

  private buildResult(
    totalStart: number,
    error?: Error,
  ): PipelineResult {
    // Обновляем сводки агентов
    this.agentSummaries = this.getAgentSummaries();

    return {
      pipelineId: this._state.pipelineId,
      startedAt: this._state.startedAt,
      completedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - totalStart,
      stages: this.stageResults,
      reviewResult: this.reviewResultData || undefined,
      agentSummaries: this.agentSummaries,
      success: error === undefined,
      error,
    };
  }
}
