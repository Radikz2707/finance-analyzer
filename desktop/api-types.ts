/**
 * Общие типы десктоп-приложения (main / preload / renderer / ipc-core).
 *
 * ВСЕ импорты — type-only (стираются при сборке esbuild): этот файл можно
 * подключать и в renderer-бандл без риска затащить Node/electron-код.
 */

import type {
  DirectorAuditEvent,
  DirectorTask,
} from '../src/js/modules/pipeline/director/director-types.js';
import type { AgentPanelState } from '../src/js/modules/pipeline/visualization/agent-panel-model.js';
import type { HarnessDashboardPayload } from '../src/js/modules/harness-integration/types.js';
import type {
  AskResult,
  AutonomousBridgeStatusInfo,
  AutonomousRunOnceResult,
  DirectorStatusInfo,
  GoalSummary,
  HarnessExportResult,
  HarnessRunResult,
  LastAnalysisInfo,
  LogResult,
  OllamaReconnectResult,
  PipelineReportInfo,
  PortfolioReloadResult,
} from './ipc-core.js';

export type {
  DirectorAuditEvent,
  DirectorTask,
  AgentPanelState,
  HarnessDashboardPayload,
  AskResult,
  AutonomousBridgeStatusInfo,
  AutonomousRunOnceResult,
  DirectorStatusInfo,
  LastAnalysisInfo,
  PipelineReportInfo,
  GoalSummary,
  HarnessExportResult,
  HarnessRunResult,
  LogResult,
  OllamaReconnectResult,
  PortfolioReloadResult,
};

/** Статус данных портфеля (вкладка «Чат» / статус-бар) */
export interface PortfolioStatusInfo {
  excelPath: string;
  sourceLabel: string;
}

/** Текущие настройки приложения */
export interface DesktopSettingsInfo {
  excelFilePath: string;
  /** Выбранная модель Ollama (пусто — значение по умолчанию) */
  ollamaModel: string;
}

/** Результат нативного диалога выбора Excel-файла */
export interface PickExcelResult {
  canceled: boolean;
  excelFilePath: string;
}

/** Событие о выполненной цели автономного цикла (main → renderer) */
export interface AutonomousIterationEvent {
  goalId: string;
  goalName: string;
  success: boolean;
  outcome?: string;
  lesson?: string;
}

/** Идея Директора (портфельная или проектная) */
export interface ProactiveIdea {
  /** Источник идеи */
  kind: 'portfolio' | 'project';
  /** Тип (ProactiveMessageType / 'project-improvement') */
  type: string;
  /** Короткий заголовок */
  title: string;
  /** Содержание */
  text: string;
  /** Приоритет */
  priority: string;
}

/**
 * API, который preload.ts пробрасывает в renderer через contextBridge
 * (contextIsolation: true, nodeIntegration: false).
 */
export interface FinanceDesktopApi {
  /** Отправить вопрос Директору (ответ также придёт через onDirectorReply) */
  ask(question: string): Promise<AskResult>;
  /** Состояние Директора */
  getStatus(): Promise<DirectorStatusInfo | null>;
  /** Последние N событий аудита */
  getLog(count?: number): Promise<LogResult>;
  /** Панель агентов */
  getPanel(): Promise<AgentPanelState | null>;
  /** Статус данных портфеля */
  loadPortfolio(): Promise<PortfolioStatusInfo>;
  /** Payload «Гибридного диспетчера» (scheduler/аномалии/QUIK) */
  getHarnessPayload(): Promise<HarnessDashboardPayload | null>;
  /** Ручной запуск фонового анализа */
  runHarnessAnalysis(): Promise<HarnessRunResult>;
  /** Экспорт HTML-дашборда диспетчера в файл (открывает в браузере) */
  exportDashboard(): Promise<HarnessExportResult>;
  /** Экспорт дашборда в PDF через диалог выбора места сохранения */
  exportDashboardPdf(): Promise<HarnessExportResult>;
  /** Версия приложения (из package.json) */
  getAppVersion(): Promise<string>;
  /** Текущие настройки приложения */
  getSettings(): Promise<DesktopSettingsInfo>;
  /** Нативный диалог выбора Excel-файла портфеля (сохраняет и применяет путь) */
  pickExcelFile(): Promise<PickExcelResult>;
  /** Перезапуск приложения (после смены пути к Excel) */
  restartApp(): Promise<boolean>;
  /** Перезагрузить данные портфеля из Excel (без перезапуска) */
  reloadPortfolio(excelPath: string): Promise<PortfolioReloadResult>;
  /** Список моделей, загруженных в локальную Ollama ([] — Ollama недоступна) */
  getOllamaModels(): Promise<string[]>;
  /** Сохранить выбранную модель Ollama (применяется после перезапуска) */
  setOllamaModel(model: string): Promise<boolean>;
  /** Переподключить Ollama (если был fallback-режим) */
  reconnectOllama(): Promise<OllamaReconnectResult>;
  /** Получить статус анализа портфеля */
  getAnalysisStatus(): Promise<{
    status: 'ready' | 'pending' | 'in_progress' | 'none';
  }>;
  /** Запустить полный анализ портфеля */
  runAnalysis(): Promise<{ success: boolean; message: string }>;

  /** Список целей автономного цикла (все или по статусу) */
  goalsList(
    status?: 'active' | 'completed' | 'pending' | 'paused' | 'cancelled',
  ): Promise<GoalSummary[]>;
  /** Добавить и активировать цель автономного цикла */
  goalsAdd(text: string): Promise<GoalSummary>;
  /** Статус автономного цикла */
  autonomousStatus(): Promise<AutonomousBridgeStatusInfo | null>;
  /** Включить фоновый автономный цикл (интервал, сек) */
  autonomousStart(
    intervalSec?: number,
  ): Promise<AutonomousBridgeStatusInfo | null>;
  /** Выключить фоновый автономный цикл */
  autonomousStop(): Promise<AutonomousBridgeStatusInfo | null>;
  /** Разовый цикл прямо сейчас */
  autonomousRunOnce(): Promise<AutonomousRunOnceResult>;
  /** Подписка на живые уведомления о выполненных целях */
  onAutonomousUpdate(
    callback: (event: AutonomousIterationEvent) => void,
  ): () => void;
  /** Последний результат анализа портфеля (null-поля — не запускался) */
  getLastAnalysis(): Promise<LastAnalysisInfo | null>;
  /** Экспорт последнего анализа в HTML-файл (диалог сохранения) */
  exportAnalysisHtml(): Promise<HarnessExportResult>;
  /** Экспорт последнего анализа в PDF (диалог сохранения) */
  exportAnalysisPdf(): Promise<HarnessExportResult>;
  /** Идеи Директора: портфельные (ProactiveSuggester) + проектные (по целям) */
  getProactiveIdeas(): Promise<ProactiveIdea[]>;
  /** Запустить полный конвейер (как npm run pipeline) и получить отчёт */
  runPipelineReport(): Promise<PipelineReportInfo>;
  /** Последний отчёт полного конвейера (null — ещё не запускался) */
  getLastPipelineReport(): Promise<PipelineReportInfo | null>;
  /** Подписка на живой поток событий аудита (стриминг) */
  onDirectorEvent(callback: (event: DirectorAuditEvent) => void): () => void;
  /** Подписка на завершение ответа Директора */
  onDirectorReply(callback: (result: AskResult) => void): () => void;
}
