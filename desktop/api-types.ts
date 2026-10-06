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
  DirectorStatusInfo,
  HarnessRunResult,
  LogResult,
} from './ipc-core.js';

export type {
  DirectorAuditEvent,
  DirectorTask,
  AgentPanelState,
  HarnessDashboardPayload,
  AskResult,
  DirectorStatusInfo,
  HarnessRunResult,
  LogResult,
};

/** Статус данных портфеля (вкладка «Чат» / статус-бар) */
export interface PortfolioStatusInfo {
  excelPath: string;
  sourceLabel: string;
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
  /** Версия приложения (из package.json) */
  getAppVersion(): Promise<string>;
  /** Подписка на живой поток событий аудита (стриминг) */
  onDirectorEvent(callback: (event: DirectorAuditEvent) => void): () => void;
  /** Подписка на завершение ответа Директора */
  onDirectorReply(callback: (result: AskResult) => void): () => void;
}
