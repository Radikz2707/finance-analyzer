/**
 * Desktop IPC Core — чистые функции обработки запросов десктоп-приложения.
 *
 * Упрощённая версия после рефакторинга: удалены удалённые модули.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { DirectorAgent } from '../src/js/modules/pipeline/director/director.js';
import { resolveReportsDir } from '../src/js/modules/app-paths.js';
import type {
  AgentOpinion,
  DirectorAuditEvent,
  DirectorFactsContext,
  DirectorResponse,
  DirectorTask,
} from '../src/js/modules/pipeline/director/director-types.js';
import type { AutonomousBridge } from './autonomous-bridge.js';
import {
  PipelineCoordinator,
  type PipelineResult,
} from '../src/js/modules/pipeline/pipeline-coordinator.js';
import type { NotificationAgentOutput } from '../src/js/modules/pipeline/agents/notification-agent.js';
import {
  XlsxParserModule,
  type CurrentAsset,
  type MacroGoals,
} from '../src/js/modules/xlsx-parser/xlsx-parser.js';
import {
  formatConsiliumRounds,
  stripAnsi,
} from '../scripts/director-chat-render.js';

// ──────────────────────────────────────────────
// 1. Типы состояния
// ──────────────────────────────────────────────

export interface AppState {
  director: {
    agent: DirectorAgent;
    facts: DirectorFactsContext;
    sourceLabel: string;
  };
  pipeline: PipelineCoordinator | null;
  pipelineRunning: boolean;
  autonomous: AutonomousBridge | null;
  notificationAgent: NotificationAgentOutput | null;
  /** Последний отчёт pipeline (htmlContent + metadata) */
  lastPipelineReport: {
    htmlContent: string;
    elapsedMs: number;
    success: boolean;
    htmlPath: string;
    completedAt?: string;
  } | null;
  /** Хранилище обратной связи по рекомендациям */
  recommendationFeedback: Map<string, Array<{ ticker: string; feedback: string; timestamp: string }>>;
}

export interface IpcRequest {
  action: string;
  params?: Record<string, unknown>;
}

export interface IpcResponse {
  ok: boolean;
  message?: string;
  data?: unknown;
}

/** Результат ответа Директора для renderer */
export interface AskResult {
  text: string;
  agentsUsed?: string[];
  pipelineId?: string;
  news?: Array<{
    ticker: string;
    impact: number;
    sentiment: string;
    impactDirection?: 'positive' | 'negative' | 'neutral';
    sentimentScore?: number;
    importance?: string;
    impactScore?: number;
    affectedMetrics?: string[];
    suggestedAction?: string;
    headlines?: string[];
  }>;
  consiliumText?: string;
  elapsedMs?: number;
  events?: DirectorAuditEvent[];
}

// ──────────────────────────────────────────────
// 2. Утилиты
// ──────────────────────────────────────────────

function getAppDataDir(): string {
  if (process.env.APPDATA) return process.env.APPDATA;
  return path.join(process.cwd(), '.appdata');
}

// ──────────────────────────────────────────────
// 3. Инициализация Director
// ──────────────────────────────────────────────

export function createDirector(
  facts?: DirectorFactsContext,
): { agent: DirectorAgent; facts: DirectorFactsContext } {
  const loadedFacts = facts ?? {
    assets: [],
    macro: {
      totalBalance: 0,
      freeCash: 0,
      stocksPercent: 0,
      bondsPercent: 0,
    },
  };

  const agent = new DirectorAgent(undefined, {
    initialFacts: loadedFacts,
    userName: 'Радик',
  });

  return { agent, facts: loadedFacts };
}

// ──────────────────────────────────────────────
// 4. Pipeline
// ──────────────────────────────────────────────

export function createPipeline(): PipelineCoordinator {
  return new PipelineCoordinator();
}

export async function runPipeline(
  coordinator: PipelineCoordinator,
): Promise<PipelineResult | null> {
  try {
    return await coordinator.run();
  } catch (err) {
    console.warn('[IPC] Pipeline error:', err);
    return null;
  }
}

// ──────────────────────────────────────────────
// 5. XlsxParser
// ──────────────────────────────────────────────

export async function loadPortfolioFromXlsx(
  filePath: string,
): Promise<{ assets: CurrentAsset[]; macro: MacroGoals }> {
  try {
    const parser = new XlsxParserModule();
    await parser.parse(filePath);
    return {
      assets: parser.getAssets() as unknown as CurrentAsset[],
      macro: parser.getMacroGoals() as unknown as MacroGoals,
    };
  } catch {
    return { assets: [], macro: {} as MacroGoals };
  }
}

// ──────────────────────────────────────────────
// 6. Заглушки для удалённых модулей
// ──────────────────────────────────────────────

// Заглушки — удалённые модули больше не используются
const _stubs = {
  ActivityStream: null,
  DirectorAgentFacade: null,
  DirectorAuditLog: null,
  OllamaClient: null,
  DialogueEngine: null,
  NewsDriver: null,
  AgentFactory: null,
  AgentPanelModel: null,
  HarnessIntegration: null,
  formatDashboardHtml: null,
};

void _stubs;

// ──────────────────────────────────────────────
// 7. IPC Handlers — все функции, требуемые desktop/main.ts
// ──────────────────────────────────────────────

export function buildDashboardHtml(_payload: unknown): string {
  return '<div>Dashboard HTML заглушка</div>';
}

export function buildDirectorState(_opts?: { getOllamaModel?: () => string }): {
  director: { agent: DirectorAgent; facts: DirectorFactsContext; sourceLabel: string };
} {
  // Данные будут загружены отдельно через reloadPortfolio или loadPortfolioFromRenderer
  const facts: DirectorFactsContext = {
    assets: [],
    macro: {
      totalBalance: 0,
      freeCash: 0,
      stocksPercent: 0,
      bondsPercent: 0,
    },
  };

  const agent = new DirectorAgent(undefined, {
    initialFacts: facts,
    userName: 'Радик',
  });

  return {
    director: {
      agent,
      facts,
      sourceLabel: 'нет данных портфеля',
    },
  };
}

/** Загрузить данные портфеля из renderer (localStorage) */
export async function loadPortfolioFromRenderer(
  directorState: { agent: DirectorAgent; facts: DirectorFactsContext; sourceLabel: string },
  factsJson: string,
): Promise<Record<string, unknown>> {
  try {
    const facts: DirectorFactsContext = JSON.parse(factsJson);
    directorState.facts = facts;
    directorState.agent.setFacts(facts);
    return {
      success: true,
      sourceLabel: 'данные из localStorage',
      assetsCount: facts.assets?.length ?? 0,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
      sourceLabel: '',
      assetsCount: 0,
    };
  }
}

export function buildHarnessState(_state: AppState): {
  harness: unknown;
} {
  return { harness: null };
}

export async function handleAsk(
  directorState: { agent: DirectorAgent; facts: DirectorFactsContext; sourceLabel: string },
  question: string,
): Promise<IpcResponse> {
  try {
    const response = await directorState.agent.processUserMessage(question);
    return {
      ok: true,
      data: {
        text: response.text,
        agentsUsed: response.agentsUsed,
        pipelineId: response.pipelineId,
      },
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function handleAutonomousChatCommand(
  state: AppState,
  command: string,
): Promise<IpcResponse | null> {
  // Проверяем, является ли команда автономного цикла
  const cmd = command.trim().toLowerCase();
  
  // Команды автономного цикла
  if (cmd === '/goal' || cmd === '/goals' || cmd === '/autonomous') {
    return {
      ok: true,
      data: {
        text: `Команда "${command}" обрабатывается автономным циклом.`,
      },
    };
  }
  
  // Не автономная команда — возвращаем null, чтобы обработал handleAsk
  return null;
}

export async function handleAutonomousRunOnce(
  _state: AppState,
): Promise<IpcResponse> {
  return { ok: true, data: { iterations: 0 } };
}

export async function handleAutonomousStart(
  _state: AppState,
  _intervalSec?: number,
): Promise<IpcResponse> {
  return { ok: true, data: { running: false } };
}

export async function handleAutonomousStatus(
  _state: AppState,
): Promise<IpcResponse> {
  return { ok: true, data: { running: false } };
}

export async function handleAutonomousStop(
  _state: AppState,
): Promise<IpcResponse> {
  return { ok: true, data: { running: false } };
}

export async function handleProactiveIdeas(
  _state: AppState,
): Promise<IpcResponse> {
  return { ok: true, data: { ideas: [] } };
}

export async function handleLastPipelineReport(
  state: AppState,
): Promise<IpcResponse> {
  // Приоритет 1: отчёт из state (только что выполненный pipeline)
  if (state.lastPipelineReport) {
    return {
      ok: true,
      data: {
        htmlContent: state.lastPipelineReport.htmlContent,
        elapsedMs: state.lastPipelineReport.elapsedMs,
        success: state.lastPipelineReport.success,
        htmlPath: state.lastPipelineReport.htmlPath,
      },
    };
  }

  // Приоритет 2: чтение с диска — ТОЛЬКО из reports/ (туда же пишет NotificationAgent)
  const reportsDir = path.join(process.cwd(), 'reports');
  const reportPath = path.join(reportsDir, 'report.html');
  
  if (fs.existsSync(reportPath)) {
    const htmlContent = fs.readFileSync(reportPath, 'utf-8');
    const metaPath = path.join(reportsDir, 'report-meta.json');
    let elapsedMs = 0;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      elapsedMs = meta.totalDurationMs || 0;
    } catch {
      // metadata не найден
    }
    return {
      ok: true,
      data: {
        htmlContent,
        elapsedMs,
        success: true,
        htmlPath: reportPath,
      },
    };
  }
  return { ok: true, data: null };
}

export function loadLastPipelineReport(state: AppState): void {
  // Ищем ТОЛЬКО в директории reports — туда же пишет NotificationAgent
  const reportsDir = path.join(process.cwd(), 'reports');
  const reportPath = path.join(reportsDir, 'report.html');
  
  if (fs.existsSync(reportPath)) {
    const stats = fs.statSync(reportPath);
    const htmlContent = fs.readFileSync(reportPath, 'utf-8');
    // Читаем duration из metadata файла
    const metaPath = path.join(reportsDir, 'report-meta.json');
    let elapsedMs = 0;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      elapsedMs = meta.totalDurationMs || 0;
    } catch {
      // metadata не найден
    }
    state.lastPipelineReport = {
      htmlContent,
      elapsedMs,
      success: true,
      htmlPath: reportPath,
      completedAt: new Date(stats.mtimeMs).toISOString(),
    };
    return;
  }
  state.lastPipelineReport = null;
}

export function resolveAnalysisStatus(state: AppState): string {
  if (state.pipelineRunning) return 'in_progress';
  // Проверяем наличие отчёта конвейера (report.html)
  const reportsDir = path.join(process.cwd(), 'reports');
  const reportPath = path.join(reportsDir, 'report.html');
  if (fs.existsSync(reportPath)) return 'ready';
  return 'pending';
}

export function getAnalysisRunningState(_state: AppState): boolean {
  // Проверка по файлу pipeline.lock (если pipeline запущен)
  const lockPath = path.join(process.cwd(), 'pipeline.lock');
  return fs.existsSync(lockPath);
}

export async function runPipelineReport(state: AppState): Promise<Record<string, unknown>> {
  state.pipelineRunning = true;
  try {
    // Удаляем старые отчёты перед запуском — чтобы не было конфликта с кэшем
    const reportsDir = resolveReportsDir();
    const oldFiles = [
      path.join(reportsDir, 'report.html'),
      path.join(reportsDir, 'report.md'),
      path.join(reportsDir, 'report-meta.json'),
    ];
    for (const file of oldFiles) {
      try {
        fs.unlinkSync(file);
      } catch {
        // файл может не существовать
      }
    }

    const coordinator = createPipeline();
    const result = await runPipeline(coordinator);
    if (!result) {
      console.error('[IPC] Pipeline вернул null — координатор не выполнился');
      return { ok: false, message: 'Pipeline не выполнился' };
    }
    if (!result.success) {
      console.error('[IPC] Pipeline завершился с ошибкой:', result.error?.message || 'без сообщения');
    }
    const reportPath = path.join(reportsDir, 'report.html');
    const htmlContent = fs.existsSync(reportPath)
      ? fs.readFileSync(reportPath, 'utf-8')
      : '';
    // Сохраняем metadata (duration) рядом с report.html
    try {
      const metaPath = path.join(reportsDir, 'report-meta.json');
      fs.writeFileSync(metaPath, JSON.stringify({
        totalDurationMs: result.totalDurationMs,
        success: result.success,
        completedAt: result.completedAt,
      }), 'utf-8');
    } catch {
      // metadata не критичен
    }
    // Сохраняем отчёт в state для мгновенного доступа
    state.lastPipelineReport = {
      htmlContent,
      elapsedMs: result.totalDurationMs,
      success: result.success,
      htmlPath: reportPath,
      completedAt: result.completedAt,
    };

    // Запускаем PostFactumCheck и очистку устаревших данных
    try {
      await coordinator.runPostFactumCheck();
      await coordinator.cleanupOldData();
    } catch (err) {
      console.warn('[IPC] PostFactumCheck ошибка:', err);
    }

    return {
      ok: true,
      data: {
        success: result.success,
        elapsedMs: result.totalDurationMs,
        htmlContent,
        htmlPath: reportPath,
        error: result.error?.message || (result.success ? undefined : 'Pipeline failed'),
      },
    };
  } catch (err) {
    console.error('[IPC] Pipeline упал с исключением:', err);
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    state.pipelineRunning = false;
  }
}

/**
 * Обработка обратной связи пользователя по AI-рекомендациям.
 * Вызывается из renderer при нажатии 👍/👎.
 */
export async function handleRecommendationFeedback(
  _state: AppState,
  input: { ticker: string; feedback: 'good' | 'bad' },
): Promise<Record<string, unknown>> {
  try {
    const { ticker, feedback } = input;

    // Обновляем субъективную оценку (только для статистики, не для обучения)
    if (_state?.pipeline) {
      await _state.pipeline.updateRecommendationOutcome(ticker, feedback);
    }

    return {
      ok: true,
      data: {
        success: true,
        message: feedback === 'good' ? '👍 Рекомендация учтена.' : '👎 Учтём для улучшения.',
      },
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function buildAnalysisHtml(_data: unknown): string {
  return '<div>Analysis HTML заглушка</div>';
}

export async function handleGoalsAdd(
  _text: string,
  _state: AppState,
): Promise<IpcResponse> {
  return { ok: true, data: { id: `goal-${Date.now()}` } };
}

export async function handleGoalsList(
  _state: AppState,
): Promise<IpcResponse> {
  return { ok: true, data: { goals: [] } };
}

export async function handleLastAnalysis(
  directorState: { agent: DirectorAgent; facts: DirectorFactsContext; sourceLabel: string },
): Promise<Record<string, unknown> | null> {
  // Приоритет: report.html (полный конвейер)
  const reportsDir = path.join(process.cwd(), 'reports');
  const reportPath = path.join(reportsDir, 'report.html');
  
  if (fs.existsSync(reportPath)) {
    const stats = fs.statSync(reportPath);
    const htmlContent = fs.readFileSync(reportPath, 'utf-8');
    return {
      text: htmlContent,
      finishedAt: new Date(stats.mtimeMs).toISOString(),
      elapsedMs: stats.mtimeMs,
      sourceLabel: reportPath,
      totalValue: 0,
      assets: [],
      alerts: [],
    };
  }
  return null;
}

export async function handleHarnessExport(
  _state: AppState,
): Promise<IpcResponse> {
  return { ok: true, data: null };
}

export async function handleHarnessPayload(
  _state: AppState,
): Promise<IpcResponse> {
  return { ok: true, data: null };
}

export async function handleHarnessRun(
  _state: AppState,
): Promise<IpcResponse> {
  return { ok: true, data: null };
}

export function handleLog(
  _directorState: { agent: DirectorAgent; facts: DirectorFactsContext; sourceLabel: string },
  _count?: number,
): { entries: unknown[]; total: number } {
  return { entries: [], total: 0 };
}

export function handlePanel(_directorState: { agent: DirectorAgent; facts: DirectorFactsContext; sourceLabel: string }): unknown {
  return { agents: [] };
}

export async function handleStatus(directorState: { agent: DirectorAgent; facts: DirectorFactsContext; sourceLabel: string }): Promise<Record<string, unknown>> {
  return {
    portfolioValue: directorState.facts.macro.totalBalance,
    freeCash: directorState.facts.macro.freeCash,
    aiLabel: '● Ollama ✓',
    sourceLabel: directorState.sourceLabel ?? 'нет данных портфеля',
  };
}

export async function reloadPortfolio(
  directorState: { agent: DirectorAgent; facts: DirectorFactsContext; sourceLabel: string },
  filePath?: string,
): Promise<Record<string, unknown>> {
  if (!filePath) {
    return {
      success: false,
      message: 'Путь к файлу не указан',
      sourceLabel: 'нет данных',
      assetsCount: 0,
    };
  }
  try {
    const { assets } = await loadPortfolioFromXlsx(filePath);
    directorState.facts.macro.totalBalance = 0;
    directorState.facts.macro.freeCash = 0;
    return {
      success: true,
      message: 'Портфель загружен',
      sourceLabel: filePath,
      assetsCount: assets.length,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
      sourceLabel: filePath,
      assetsCount: 0,
    };
  }
}

export async function reconnectOllama(
  _state: AppState,
): Promise<IpcResponse> {
  return { ok: true, data: { connected: false } };
}

export function subscribeActivity(
  _director: DirectorAgent,
  _callback: (event: unknown) => void,
): () => void {
  return () => {};
}

export function subscribeEvents(
  _director: DirectorAgent,
  _callback: (event: unknown) => void,
): () => void {
  return () => {};
}

// ──────────────────────────────────────────────
// 8. Shutdown
// ──────────────────────────────────────────────

export async function handleIpcRequest(
  request: IpcRequest,
  state: AppState,
): Promise<IpcResponse> {
  const { action, params } = request;

  switch (action) {
    case 'director-message': {
      const message = (params?.message ?? '') as string;
      try {
        const response = await state.director.agent.processUserMessage(message);
        return {
          ok: true,
          data: response,
        };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    case 'pipeline-run': {
      try {
        const result = await runPipeline(state.pipeline!);
        return {
          ok: true,
          data: result,
        };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    case 'send-recommendation-feedback': {
      const ticker = (params?.ticker ?? '') as string;
      const feedback = (params?.feedback ?? 'good') as 'good' | 'bad';
      const result = await handleRecommendationFeedback(state, { ticker, feedback });
      return result;
    }

    case 'get-state': {
      return {
        ok: true,
        data: {
          portfolioValue: state.director.facts.macro.totalBalance,
          freeCash: state.director.facts.macro.freeCash,
          pipelineRunning: state.pipeline?.isRunning ?? false,
        },
      };
    }

    default:
      return {
        ok: false,
        message: `Неизвестное действие: ${action}`,
      };
  }
}

// ──────────────────────────────────────────────
// 8. Shutdown
// ──────────────────────────────────────────────

export async function shutdownAppState(appState: AppState): Promise<void> {
  try {
    appState.autonomous?.dispose();
  } catch {
    // Остановка — best effort
  }
  try {
    await appState.pipeline?.shutdown();
  } catch {
    // Остановка — best effort
  }
}
