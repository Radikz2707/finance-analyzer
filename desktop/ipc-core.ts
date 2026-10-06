/**
 * Desktop IPC Core — чистые функции обработки запросов десктоп-приложения.
 *
 * ⚠️ МОДУЛЬ НЕ ИМПОРТИРУЕТ 'electron': только типы колбэков и DI-состояние,
 * поэтому полностью покрывается unit-тестами без Electron (vitest, Node ABI).
 *
 * Подсистемы (переиспользуются, НЕ переписываются):
 * - DirectorAgent — сборка как в scripts/director-chat.ts (фасад + action-агенты
 *   через SecurityAgent + aiExecutor Ollama/детерминированный fallback);
 * - DirectorAuditLog.onEvent() — живой стриминг событий аудита;
 * - buildPanelState() — панель агентов (agent-panel-model);
 * - XlsxParserModule по EXCEL_FILE_PATH — факты портфеля (или пустые);
 * - createHarness() — «Гибридный диспетчер» (фоновый конвейер, QUIK, аномалии,
 *   Telegram-уведомления) — подключается динамически, чтобы не тянуть
 *   better-sqlite3 в тестах директора.
 */

import * as fs from 'node:fs';

import { DirectorAgent } from '../src/js/modules/pipeline/director/director.js';
import {
  defaultAiExecutor,
  DirectorAgentFacade,
  type AiDecisionExecutor,
  type AiDecisionRequest,
} from '../src/js/modules/pipeline/director/agent-facade.js';
import { DirectorAuditLog } from '../src/js/modules/pipeline/director/director-audit.js';
import { OllamaClient } from '../src/js/modules/pipeline/director/ollama-client.js';
import { SecurityAgent } from '../src/js/modules/pipeline/agents/security-agent.js';
import {
  createDefaultActionAgents,
  type DirectorActionAgents,
} from '../src/js/modules/pipeline/agents/agent-factory.js';
import {
  XlsxParserModule,
  type CurrentAsset,
  type MacroGoals,
} from '../src/js/modules/xlsx-parser/xlsx-parser.js';
import {
  buildPanelState,
  type AgentPanelState,
  type AgentSourceItem,
} from '../src/js/modules/pipeline/visualization/agent-panel-model.js';
import type {
  AgentOpinion,
  DirectorAuditEvent,
  DirectorFactsContext,
  DirectorResponse,
  DirectorTask,
} from '../src/js/modules/pipeline/director/director-types.js';
import {
  formatConsiliumRounds,
  stripAnsi,
} from '../scripts/director-chat-render.js';
// type-only: стираются при транспиляции, better-sqlite3 не грузится.
import type { HarnessHandle } from '../src/js/modules/harness-integration/harness-bootstrap.js';
import type { HarnessDashboardPayload } from '../src/js/modules/harness-integration/types.js';

// ──────────────────────────────────────────────
// 1. Константы и утилиты
// ──────────────────────────────────────────────

const OLLAMA_CHECK_TIMEOUT_MS = 1500;
const OLLAMA_RESPONSE_TIMEOUT_MS = 30_000;
const DEFAULT_LOG_LINES = 50;
const MAX_LOG_LINES = 200;

/** Простой логгер ядра (по умолчанию — console, можно заменить DI) */
export type CoreLogger = (level: 'info' | 'warn', message: string) => void;

function consoleLogger(level: 'info' | 'warn', message: string): void {
  (level === 'warn' ? console.warn : console.info)(`[desktop] ${message}`);
}

/** Прогнать промис с таймаутом: при просрочке вернуть null (не отменяя работу) */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

// ──────────────────────────────────────────────
// 2. Факты портфеля (как в director-chat.ts)
// ──────────────────────────────────────────────

/** Пустые факты (режим «без данных портфеля») */
function emptyFacts(): DirectorFactsContext {
  return {
    assetsAnalysis: [],
    totalPortfolioValue: 0,
    freeCashRub: 0,
  };
}

/** Привести данные Excel к неизменяемым фактам Director */
function portfolioToFacts(
  assets: readonly CurrentAsset[],
  goals: MacroGoals,
): DirectorFactsContext {
  return {
    assetsAnalysis: assets.map((asset) => {
      const currentPercent =
        asset.balancePercent ?? asset.liquidationPercent ?? 0;
      const targetPercent = asset.targetPercent ?? 0;
      return {
        ticker: asset.ticker,
        name: asset.name,
        currentPercent,
        targetPercent,
        deficitRub:
          targetPercent > 0
            ? Math.max(
                0,
                Math.round(
                  ((targetPercent - currentPercent) / 100) * goals.totalBalance,
                ),
              )
            : 0,
        status: 'STABLE',
        quantity: asset.quantity,
        balancePrice: asset.balancePrice,
        currentPrice: asset.currentPrice,
        unrealizedProfitRub: asset.unrealizedProfitRub,
        isConcentrated: currentPercent > 25,
      };
    }),
    totalPortfolioValue: goals.totalBalance,
    freeCashRub: goals.freeCash,
  };
}

interface LoadedFacts {
  facts: DirectorFactsContext;
  /** Человекочитаемое описание источника данных */
  sourceLabel: string;
}

/** Загрузить факты портфеля из excelPath (или пустые) */
async function loadFacts(
  excelPath: string | undefined,
  log: CoreLogger,
): Promise<LoadedFacts> {
  if (!excelPath || !fs.existsSync(excelPath)) {
    return {
      facts: emptyFacts(),
      sourceLabel: 'нет данных портфеля (задайте EXCEL_FILE_PATH)',
    };
  }
  try {
    const parser = new XlsxParserModule();
    const [assets, goals] = await Promise.all([
      parser.parseCurrentPortfolio(),
      parser.parseMacroGoals(),
    ]);
    log(
      'info',
      `Факты портфеля загружены: активов ${assets.length}, файл ${excelPath}`,
    );
    return {
      facts: portfolioToFacts(assets, goals),
      sourceLabel: `данные портфеля: ${excelPath}`,
    };
  } catch (err) {
    log(
      'warn',
      `Не удалось прочитать Excel (${excelPath}): ${
        err instanceof Error ? err.message : String(err)
      } — работаем без данных портфеля`,
    );
    return {
      facts: emptyFacts(),
      sourceLabel: `Excel прочитать не удалось (${excelPath})`,
    };
  }
}

// ──────────────────────────────────────────────
// 3. AI-исполнитель роли «ai» (как в director-chat.ts)
// ──────────────────────────────────────────────

const AI_SYSTEM_PROMPT = `Ты — AI-агент инвестиционного reasoning в системе Finance Analyzer.
Твоя задача — сформулировать независимое мнение по вопросу пользователя на основе фактов портфеля.
Ты имеешь полную свободу решения и можешь не соглашаться с целевыми долями.
Ответь СТРОГО одним JSON-объектом без markdown-разметки и пояснений:
{"action":"BUY|SELL|EXIT|REDUCE|HOLD|AVOID|AVERAGE|null","confidence":0.0-1.0,"position":"краткая позиция","arguments":["аргумент1","аргумент2"]}`;

const VALID_AI_ACTIONS: ReadonlySet<string> = new Set([
  'BUY',
  'SELL',
  'EXIT',
  'REDUCE',
  'HOLD',
  'AVOID',
  'AVERAGE',
]);

/** Вопрос пользователя для LLM */
function buildAiQuestion(req: AiDecisionRequest): string {
  return [
    `Категория: ${req.question.category} / ${req.question.intent}`,
    `Тема: ${req.question.topic}`,
    `Тикеры: ${req.question.tickers.join(', ') || '—'}`,
    `Вопрос пользователя: ${req.question.text}`,
  ].join('\n');
}

/** Компактная сводка фактов портфеля для LLM */
function buildFactsText(req: AiDecisionRequest): string {
  const lines = req.facts.assetsAnalysis.map(
    (asset) =>
      `${asset.ticker}: доля ${asset.currentPercent}%, ` +
      `цель ${asset.targetPercent}%, P&L ${asset.unrealizedProfitRub ?? 0} ₽`,
  );
  return [
    'Портфель:',
    ...lines,
    `Стоимость портфеля: ${req.facts.totalPortfolioValue} ₽, ` +
      `свободные средства: ${req.facts.freeCashRub} ₽`,
  ].join('\n');
}

/** Извлечь AgentOpinion из ответа LLM (ленивый парсинг JSON-блока) */
function parseAiOpinion(raw: string | null): AgentOpinion | null {
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const actionRaw =
    typeof data.action === 'string' ? data.action.trim().toUpperCase() : null;
  const action =
    actionRaw && VALID_AI_ACTIONS.has(actionRaw)
      ? (actionRaw as AgentOpinion['action'])
      : null;

  const rawConfidence =
    typeof data.confidence === 'number' ? data.confidence : Number.NaN;
  const confidence = Number.isFinite(rawConfidence)
    ? Math.min(1, Math.max(0, rawConfidence))
    : 0.5;

  const position =
    typeof data.position === 'string' && data.position.trim() !== ''
      ? data.position.trim()
      : 'Мнение AI';

  const args = Array.isArray(data.arguments)
    ? data.arguments.filter((item): item is string => typeof item === 'string')
    : [];

  return { role: 'ai', position, action, confidence, arguments: args };
}

/**
 * Собрать исполнителя роли «ai»: Ollama, если доступна локально,
 * иначе детерминированный fallback (Консилиум работает офлайн).
 * aiMode='off' — проверка сети пропускается полностью (CI/тесты).
 */
async function createAiExecutor(
  aiMode: 'auto' | 'off',
  ollamaCheckTimeoutMs: number,
  log: CoreLogger,
): Promise<{ executor: AiDecisionExecutor; label: string }> {
  if (aiMode === 'off') {
    log('info', 'роль «ai» работает в детерминированном режиме (aiMode=off)');
    return {
      executor: defaultAiExecutor,
      label: 'детерминированный исполнитель (aiMode=off)',
    };
  }

  const client = new OllamaClient({
    model: process.env.OLLAMA_MODEL || undefined,
  });
  const available = await withTimeout(
    client.isAvailable(),
    ollamaCheckTimeoutMs,
  );

  if (!available) {
    log(
      'warn',
      'Ollama недоступен — роль «ai» работает в детерминированном режиме (офлайн)',
    );
    return {
      executor: defaultAiExecutor,
      label: 'детерминированный исполнитель (без Ollama)',
    };
  }

  log('info', 'Ollama подключён — роль «ai» использует LLM');
  return {
    executor: async (req) => {
      // Безопасное значение по умолчанию: детерминированное мнение.
      const fallback = await defaultAiExecutor(req);
      try {
        const raw = await withTimeout(
          client.generateResponse(
            AI_SYSTEM_PROMPT,
            buildAiQuestion(req),
            buildFactsText(req),
          ),
          OLLAMA_RESPONSE_TIMEOUT_MS,
        );
        const parsed = parseAiOpinion(raw);
        if (parsed) return parsed;
        log(
          'warn',
          'Ollama вернул неразбираемый ответ — используем детерминированное мнение',
        );
      } catch (err) {
        log(
          'warn',
          `Ошибка Ollama: ${err instanceof Error ? err.message : String(err)} — используем детерминированное мнение`,
        );
      }
      return fallback;
    },
    label: 'Ollama (LLM)',
  };
}

// ──────────────────────────────────────────────
// 4. Состояние приложения (Director + Harness)
// ──────────────────────────────────────────────

/** Состояние директора (один на весь lifecycle приложения) */
export interface DirectorState {
  director: DirectorAgent;
  audit: DirectorAuditLog;
  actionAgents: DirectorActionAgents;
  sourceLabel: string;
  aiLabel: string;
}

/** Полное состояние десктоп-приложения */
export interface AppState {
  director: DirectorState;
  /** «Гибридный диспетчер» — опционально (null при сбое сборки) */
  harness: HarnessHandle | null;
}

/** Опции сборки состояния директора */
export interface BuildDirectorStateOptions {
  /** Путь к Excel с портфелем (по умолчанию process.env.EXCEL_FILE_PATH) */
  excelPath?: string;
  /** Режим роли «ai» (по умолчанию 'auto'; 'off' — детерминированный) */
  aiMode?: 'auto' | 'off';
  /** Таймаут проверки Ollama, мс (по умолчанию 1500) */
  ollamaCheckTimeoutMs?: number;
  /** Логгер (по умолчанию console) */
  logger?: CoreLogger;
}

/**
 * Собрать DirectorAgent как в director-chat.ts:
 * фасад + createDefaultActionAgents() + SecurityAgent-адаптер + aiExecutor.
 */
export async function buildDirectorState(
  options: BuildDirectorStateOptions = {},
): Promise<DirectorState> {
  const log = options.logger ?? consoleLogger;
  const excelPath =
    options.excelPath !== undefined
      ? options.excelPath
      : process.env.EXCEL_FILE_PATH;
  const aiMode =
    options.aiMode ??
    (process.env.DIRECTOR_CHAT_AI === 'off' ||
    process.env.DIRECTOR_CHAT_AI === '0'
      ? 'off'
      : 'auto');
  const ollamaCheckTimeoutMs =
    options.ollamaCheckTimeoutMs ?? OLLAMA_CHECK_TIMEOUT_MS;

  const { facts, sourceLabel } = await loadFacts(excelPath, log);
  const { executor: aiExecutor, label: aiLabel } = await createAiExecutor(
    aiMode,
    ollamaCheckTimeoutMs,
    log,
  );

  const actionAgents = createDefaultActionAgents();
  const security = new SecurityAgent();
  const facade = new DirectorAgentFacade({
    actionAgents,
    // Адаптер к единому контракту `check` фасада (validate — синхронный)
    security: { check: (request) => security.validate(request) },
    aiExecutor,
  });
  const audit = new DirectorAuditLog();
  const director = new DirectorAgent(
    { facade, audit, initialFacts: facts },
    { maxConsiliumRounds: 3, includeAgentDetails: true },
  );
  director.createSession();

  return { director, audit, actionAgents, sourceLabel, aiLabel };
}

/** Опции сборки «Гибридного диспетчера» */
export interface BuildHarnessStateOptions {
  /** Начинать наблюдение сразу (по умолчанию true) */
  autoStart?: boolean;
  /** Интервал опроса, мс */
  pollIntervalMs?: number;
  /** Минимальная пауза между запусками, мс */
  minRunIntervalMs?: number;
  /** Логгер (по умолчанию console) */
  logger?: CoreLogger;
}

/**
 * Собрать «Гибридный диспетчер» (createHarness): фоновый конвейер,
 * QUIK, аномалии цен, Telegram. Динамический import — better-sqlite3
 * (через PipelineCoordinator → ai-memory) грузится только здесь.
 *
 * Любая ошибка сборки → null (приложение продолжает работать).
 */
export async function buildHarnessState(
  options: BuildHarnessStateOptions = {},
): Promise<HarnessHandle | null> {
  const log = options.logger ?? consoleLogger;
  try {
    const { createHarness } =
      await import('../src/js/modules/harness-integration/harness-bootstrap.js');
    const handle = createHarness({
      autoStart: options.autoStart ?? true,
      pollIntervalMs: options.pollIntervalMs,
      minRunIntervalMs: options.minRunIntervalMs,
    });
    log('info', 'Гибридный диспетчер активирован');
    return handle;
  } catch (err) {
    log(
      'warn',
      `Гибридный диспетчер не активирован: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

// ──────────────────────────────────────────────
// 5. Хендлеры запросов
// ──────────────────────────────────────────────

/** Результат обработки вопроса */
export interface AskResult {
  /** Текст ответа Director */
  text: string;
  /** Задача Director (если создана) */
  task?: DirectorTask;
  /** События аудита, записанные за время обработки вопроса */
  events: DirectorAuditEvent[];
  /** Отформатированные раунды Консилиума (для «ленты активности») */
  consiliumText?: string;
  /** Время обработки, мс */
  elapsedMs: number;
}

/**
 * Обработать вопрос пользователя: стриминг событий уже идёт через
 * подписку onEvent (subscribeEvents), здесь собирается итог.
 */
export async function handleAsk(
  state: DirectorState,
  question: string,
): Promise<AskResult> {
  const startedAt = Date.now();
  const beforeCount = state.audit.getAll().length;
  const response: DirectorResponse =
    await state.director.processUserMessage(question);
  const elapsedMs = Date.now() - startedAt;
  const events = state.audit.getAll().slice(beforeCount);

  const result: AskResult = {
    text: response.text,
    events,
    elapsedMs,
  };
  if (response.task) {
    result.task = response.task;
    if (response.task.consilium) {
      result.consiliumText = stripAnsi(
        formatConsiliumRounds(response.task.consilium),
      );
    }
  }
  return result;
}

/** Статус Director (для вкладки «Чат»/статус-бара) */
export interface DirectorStatusInfo {
  state: string;
  sessionId: string | null;
  strategicMemoryCount: number;
  proactiveCount: number;
  connectedAgents: string[];
  sourceLabel: string;
  aiLabel: string;
  chatMessagesCount: number;
}

export function handleStatus(state: DirectorState): DirectorStatusInfo {
  const { director } = state;
  const session = director.currentSession;
  const lastDirectorMessage = [...(session?.messages ?? [])]
    .reverse()
    .find((m) => m.role === 'director');
  return {
    state: director.state,
    sessionId: session?.sessionId ?? null,
    strategicMemoryCount: director.getStrategicMemory().length,
    proactiveCount: director.getProactiveMessages().length,
    connectedAgents: lastDirectorMessage?.connectedAgents ?? [],
    sourceLabel: state.sourceLabel,
    aiLabel: state.aiLabel,
    chatMessagesCount: session?.messages.length ?? 0,
  };
}

/** Последние N событий аудита (для вкладки «Консоль») */
export interface LogResult {
  entries: DirectorAuditEvent[];
  total: number;
}

export function handleLog(state: DirectorState, count?: number): LogResult {
  const n = Math.max(1, Math.min(count ?? DEFAULT_LOG_LINES, MAX_LOG_LINES));
  const all = state.audit.getAll();
  return { entries: all.slice(-n), total: all.length };
}

/** Панель агентов (вкладка «Агенты») */
export function handlePanel(state: DirectorState): AgentPanelState {
  // Источники панели: реальные action-агенты (getSummary),
  // остальные источники честно отсутствуют в десктоп-версии.
  const sources: AgentSourceItem[] = [];
  if (state.actionAgents.file) {
    sources.push(state.actionAgents.file as unknown as AgentSourceItem);
  }
  if (state.actionAgents.terminal) {
    sources.push(state.actionAgents.terminal as unknown as AgentSourceItem);
  }
  return buildPanelState({ agents: sources });
}

/**
 * Подписка на поток событий аудита.
 * @returns функция отписки (безопасная, повторный вызов — no-op).
 */
export function subscribeEvents(
  state: DirectorState,
  emit: (event: DirectorAuditEvent) => void,
): () => void {
  return state.audit.onEvent(emit);
}

// ──────────────────────────────────────────────
// 6. Хендлеры «Гибридного диспетчера»
// ──────────────────────────────────────────────

/** Payload диспетчера для вкладки UI (null — диспетчер недоступен) */
export async function handleHarnessPayload(
  harness: HarnessHandle | null,
): Promise<HarnessDashboardPayload | null> {
  if (!harness) return null;
  try {
    return await harness.bridge.getDashboardPayload();
  } catch {
    return null;
  }
}

/** Ручной запуск фонового анализа (кнопка UI) */
export interface HarnessRunResult {
  ok: boolean;
  message: string;
}

export async function handleHarnessRun(
  harness: HarnessHandle | null,
): Promise<HarnessRunResult> {
  if (!harness) {
    return { ok: false, message: 'Гибридный диспетчер не активирован' };
  }
  try {
    await harness.scheduler.manualRun();
    return { ok: true, message: 'Фоновый анализ запущен и завершён' };
  } catch (err) {
    return {
      ok: false,
      message: `Ошибка фонового анализа: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

// ──────────────────────────────────────────────
// 7. Graceful shutdown
// ──────────────────────────────────────────────

/** Остановить все подсистемы приложения (идемпотентно, без проброса ошибок) */
export async function shutdownAppState(appState: AppState): Promise<void> {
  try {
    await appState.director.director.stop();
  } catch {
    // Остановка — best effort
  }
  try {
    appState.harness?.scheduler.stop();
  } catch {
    // Остановка — best effort
  }
}
