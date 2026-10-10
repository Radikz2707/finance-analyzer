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
import * as path from 'node:path';

import {
  isPackagedApp,
  resolveAppDataDir,
} from '../src/js/modules/app-paths.js';
import { DirectorAgent } from '../src/js/modules/pipeline/director/director.js';
import {
  defaultAiExecutor,
  DirectorAgentFacade,
  type AiDecisionExecutor,
  type AiDecisionRequest,
} from '../src/js/modules/pipeline/director/agent-facade.js';
import { DirectorAuditLog } from '../src/js/modules/pipeline/director/director-audit.js';
import {
  OllamaClient,
  type OllamaMessage,
} from '../src/js/modules/pipeline/director/ollama-client.js';
import {
  SecurityAgent,
  type SecurityActionRequest,
  type SecurityDecision,
} from '../src/js/modules/pipeline/agents/security-agent.js';
import type { AutonomousBridge } from './autonomous-bridge.js';
import {
  PipelineCoordinator,
  type PipelineResult,
} from '../src/js/modules/pipeline/pipeline-coordinator.js';
import type { NotificationAgentOutput } from '../src/js/modules/pipeline/agents/notification-agent.js';
import type { Goal } from '../src/js/modules/pipeline/agents/goal-agent/types.js';
import {
  createDefaultActionAgents,
  SYSTEM_COMMANDS,
  type DirectorActionAgents,
} from '../src/js/modules/pipeline/agents/agent-factory.js';
import {
  XlsxParserModule,
  type CurrentAsset,
  type MacroGoals,
} from '../src/js/modules/xlsx-parser/xlsx-parser.js';
import {
  buildAgentCatalogCards,
  buildPanelState,
  type AgentPanelState,
  type AgentSourceItem,
} from '../src/js/modules/pipeline/visualization/agent-panel-model.js';
import type {
  AgentOpinion,
  AssetAnalysisLike,
  ChatResponder,
  DirectorAuditEvent,
  DirectorFactsContext,
  DirectorResponse,
  DirectorTask,
  PriceAlertLike,
} from '../src/js/modules/pipeline/director/director-types.js';
import {
  formatConsiliumRounds,
  stripAnsi,
} from '../scripts/director-chat-render.js';
// type-only: стираются при транспиляции, better-sqlite3 не грузится.
import type { HarnessHandle } from '../src/js/modules/harness-integration/harness-bootstrap.js';
import { formatDashboardHtml } from '../src/js/modules/harness-integration/format-dashboard-html.js';
import type {
  HarnessDashboardPayload,
  HarnessRunOutcome,
} from '../src/js/modules/harness-integration/types.js';

// ──────────────────────────────────────────────
// 1. Константы и утилиты
// ──────────────────────────────────────────────

const OLLAMA_CHECK_TIMEOUT_MS = 3000;
const OLLAMA_RESPONSE_TIMEOUT_MS = 45_000;
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

/** Системный промпт свободного диалога (нефинансовые реплики пользователя) */
const CHAT_SYSTEM_PROMPT = `Ты — дружелюбный финансовый ассистент Finance Analyzer.
Отвечай на русском языке кратко и по делу.
Ты знаком с портфелем пользователя и можешь обсуждать его, но умеешь и просто поддержать разговор.
Никогда не выдумывай данные о портфеле: используй только факты из контекста.`;

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

/** Компактная сводка фактов портфеля для LLM (из запроса роли «ai») */
function buildFactsText(req: AiDecisionRequest): string {
  return factsDigest(req.facts);
}

/** Сводка фактов портфеля напрямую (для свободного диалога чата) */
function factsDigest(facts: DirectorFactsContext): string {
  const lines = facts.assetsAnalysis.map(
    (asset) =>
      `${asset.ticker}: доля ${asset.currentPercent}%, ` +
      `цель ${asset.targetPercent}%, P&L ${asset.unrealizedProfitRub ?? 0} ₽`,
  );
  return [
    'Портфель:',
    ...lines,
    `Стоимость портфеля: ${facts.totalPortfolioValue} ₽, ` +
      `свободные средства: ${facts.freeCashRub} ₽`,
  ].join('\n');
}

/** Компактная сводка для чата: только запрашиваемые тикеры + общая статистика */
function compactFactsDigest(
  facts: DirectorFactsContext,
  tickers?: string[],
): string {
  const lines: string[] = [];

  if (tickers && tickers.length > 0) {
    // Только запрашиваемые тикеры
    const requested = facts.assetsAnalysis.filter((a) =>
      tickers.includes(a.ticker),
    );
    for (const asset of requested) {
      lines.push(
        `${asset.ticker}: доля ${asset.currentPercent}%, ` +
          `цель ${asset.targetPercent}%, P&L ${asset.unrealizedProfitRub ?? 0} ₽`,
      );
    }
  } else {
    // Общая статистика без перечисления всех активов
    const totalValue = facts.totalPortfolioValue;
    const freeCash = facts.freeCashRub;
    const assetsCount = facts.assetsAnalysis.length;
    const concentrated = facts.assetsAnalysis
      .filter((a) => a.isConcentrated)
      .map((a) => a.ticker);

    lines.push(`Активов: ${assetsCount}`);
    lines.push(`Стоимость портфеля: ${totalValue} ₽`);
    lines.push(`Свободные средства: ${freeCash} ₽`);
    if (concentrated.length > 0) {
      lines.push(`Концентрация (>25%): ${concentrated.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/** Извлечь AgentOpinion из ответа LLM (ленивый парсинг JSON-блока) */
function parseAiOpinion(raw: string | null): AgentOpinion | null {
  if (!raw) return null;

  // 1. Пытаемся найти JSON-блок: от первого '{' до последнего '}'
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      return buildOpinionFromData(data);
    } catch {
      // JSON невалидный — пробуем fallback
    }
  }

  // 2. Fallback: пытаемся извлечь action/confidence из текста через regex
  return parseOpinionFromText(raw);
}

/** Построить AgentOpinion из распарсенных данных */
function buildOpinionFromData(
  data: Record<string, unknown>,
): AgentOpinion | null {
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

/** Извлечь мнение из свободного текста (fallback если JSON не распарсился) */
function parseOpinionFromText(raw: string): AgentOpinion | null {
  // Определяем action по ключевым словам
  let action: AgentOpinion['action'] = null;
  if (/\b(doкупить|buy|покупк|увелич)\b/i.test(raw)) action = 'BUY';
  else if (/\b(продать|sell|сократ|распрод)\b/i.test(raw)) action = 'SELL';
  else if (/\b(выйти|exit|полност|полностью)\b/i.test(raw)) action = 'EXIT';
  else if (/\b(сократ|reduce|уменьш)\b/i.test(raw)) action = 'REDUCE';
  else if (/\b(удержив|hold|держать|не меня)\b/i.test(raw)) action = 'HOLD';
  else if (/\b(избег|avoid|не бр)\b/i.test(raw)) action = 'AVOID';
  else if (/\b(усредн|average|докуп|докупай)\b/i.test(raw)) action = 'AVERAGE';

  // Извлекаем confidence из текста (ищем числа 0.XX или XX%)
  let confidence = 0.5;
  const confMatch = raw.match(/(\d+)\s*%/);
  if (confMatch && confMatch[1]) {
    const pct = parseInt(confMatch[1], 10);
    confidence = Math.min(1, Math.max(0, pct / 100));
  } else {
    const confFloat = raw.match(
      /(?:confidence|уверенност|conf)\s*[:=]?\s*(\d+\.?\d*)/i,
    );
    if (confFloat && confFloat[1]) {
      confidence = Math.min(1, Math.max(0, parseFloat(confFloat[1])));
    }
  }

  // Если нашли action — формируем мнение
  if (action) {
    return {
      role: 'ai',
      position: raw.slice(0, 200),
      action,
      confidence,
      arguments: [raw.slice(0, 400)],
    };
  }

  // Если action не найден — HOLD с низкой уверенностью
  return {
    role: 'ai',
    position: raw.slice(0, 200),
    action: 'HOLD',
    confidence: 0.4,
    arguments: ['Действие не распознано из текста'],
  };
}

/** Актуальная модель Ollama: выбор пользователя → env по умолчанию */
function resolveActiveModel(
  getOllamaModel?: () => string | undefined,
): string | undefined {
  const fromProvider = getOllamaModel?.();
  if (fromProvider && fromProvider.trim() !== '') return fromProvider.trim();
  const env = process.env.OLLAMA_MODEL;
  return env && env.trim() !== '' ? env.trim() : undefined;
}

/**
 * Собрать исполнителя роли «ai»: Ollama, если доступна локально,
 * иначе детерминированный fallback (Консилиум работает офлайн).
 * aiMode='off' — проверка сети пропускается полностью (CI/тесты).
 *
 * Модель читается на КАЖДЫЙ запрос (getOllamaModel): смена модели в
 * настройках приложения применяется без перезапуска.
 */
async function createAiExecutor(
  aiMode: 'auto' | 'off',
  ollamaCheckTimeoutMs: number,
  log: CoreLogger,
  getOllamaModel?: () => string | undefined,
): Promise<{ executor: AiDecisionExecutor; label: string }> {
  if (aiMode === 'off') {
    log('info', 'роль «ai» работает в детерминированном режиме (aiMode=off)');
    return {
      executor: defaultAiExecutor,
      label: 'детерминированный исполнитель (aiMode=off)',
    };
  }

  const probeClient = new OllamaClient({
    model: resolveActiveModel(getOllamaModel),
  });
  const available = await withTimeout(
    probeClient.isAvailable(),
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
        const client = new OllamaClient({
          model: resolveActiveModel(getOllamaModel),
        });
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

/**
 * Собрать исполнителя свободного диалога чата: Ollama отвечает на
 * нефинансовые реплики с контекстом портфеля (factsDigest) и короткой
 * историей. Без Ollama возвращает undefined — Director даёт честный
 * fallback-ответ без запуска агентов.
 */
async function createChatResponder(
  aiMode: 'auto' | 'off',
  ollamaCheckTimeoutMs: number,
  log: CoreLogger,
  getOllamaModel?: () => string | undefined,
  ollamaAvailable?: boolean,
): Promise<ChatResponder | undefined> {
  if (aiMode === 'off') {
    log('info', 'свободный диалог отключён (aiMode=off)');
    return undefined;
  }

  // Если Ollama уже доступна для aiExecutor — пропускаем повторный probe.
  if (ollamaAvailable) {
    log(
      'info',
      'Ollama подключён — свободный диалог использует LLM (shared probe)',
    );
    return async ({ question, facts, history: _history }) => {
      const client = new OllamaClient({
        model: resolveActiveModel(getOllamaModel),
      });
      try {
        // Chat responder может ждать дольше AI Agent — 5 минут вместо 45 сек
        const CHAT_RESPONDER_TIMEOUT_MS = 300_000;

        // Сначала пробуем stream через /api/generate
        let fullResponse = '';
        const raw = await withTimeout(
          client.generate(
            CHAT_SYSTEM_PROMPT,
            question + '\n\nФакты портфеля:\n' + compactFactsDigest(facts),
            (chunk) => {
              fullResponse += chunk;
            },
          ),
          CHAT_RESPONDER_TIMEOUT_MS,
        );
        const text = (fullResponse || raw)?.trim();
        if (text && text !== '') {
          log('info', `Ollama chat responder ответ: ${text.slice(0, 80)}...`);
          return text;
        }
        log(
          'warn',
          'Ollama chat responder вернул пустой ответ — пробуем non-stream',
        );
        // Fallback: non-stream запрос
        const raw2 = await withTimeout(
          client.generate(
            CHAT_SYSTEM_PROMPT,
            question + '\n\nФакты портфеля:\n' + compactFactsDigest(facts),
          ),
          CHAT_RESPONDER_TIMEOUT_MS,
        );
        const text2 = raw2?.trim();
        if (text2 && text2 !== '') {
          log(
            'info',
            `Ollama chat responder (non-stream) ответ: ${text2.slice(0, 80)}...`,
          );
          return text2;
        }
        log('warn', 'Ollama chat responder вернул пустой ответ (оба метода)');
        return null;
      } catch (err) {
        log(
          'warn',
          `Ошибка Ollama в свободном диалоге: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      }
    };
  }

  // Стартовая проверка: предупреждаем сразу, если Ollama не запущена.
  const probeClient = new OllamaClient({
    model: resolveActiveModel(getOllamaModel),
  });
  const available = await withTimeout(
    probeClient.isAvailable(),
    ollamaCheckTimeoutMs,
  );

  if (!available) {
    log(
      'warn',
      'Ollama недоступен — свободный диалог использует fallback-ответы',
    );
    return undefined;
  }

  log('info', 'Ollama подключён — свободный диалог использует LLM');
  return async ({ question, facts, history }) => {
    // Клиент с АКТУАЛЬНОЙ моделью на каждый вопрос: выбранная в настройках
    // модель подхватывается без перезапуска приложения.
    const client = new OllamaClient({
      model: resolveActiveModel(getOllamaModel),
    });
    const historyMessages: OllamaMessage[] = history
      .split('\n')
      .filter((line) => line.includes(': '))
      .map((line) => {
        const idx = line.indexOf(': ');
        const roleRaw = line.slice(0, idx);
        const role = roleRaw === 'director' ? 'assistant' : 'user';
        return { role, content: line.slice(idx + 2) };
      });
    const messages: OllamaMessage[] = [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      ...historyMessages,
      {
        role: 'user',
        content: `${question}\n\nФакты портфеля:\n${compactFactsDigest(facts)}`,
      },
    ];
    try {
      const raw = await withTimeout(
        client.chat(messages),
        OLLAMA_RESPONSE_TIMEOUT_MS,
      );
      const text = raw?.trim();
      return text && text !== '' ? text : null;
    } catch (err) {
      log(
        'warn',
        `Ошибка Ollama в свободном диалоге: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  };
}

// ──────────────────────────────────────────────
// 4. Состояние приложения (Director + Harness + Autonomous)
// ──────────────────────────────────────────────

/** Результат последнего анализа портфеля (для вкладки «Анализ» и экспорта) */
export interface AnalysisResultInfo {
  /** Текст анализа (null — ещё не запускался) */
  text: string | null;
  /** ISO-метка времени завершения */
  finishedAt: string | null;
  /** Длительность, мс */
  elapsedMs: number | null;
}

/** Результат анализа + контекст (для UI) */
export type LastAnalysisInfo = AnalysisResultInfo & {
  sourceLabel: string;
  /** Структура портфеля на момент анализа (для таблиц отчёта) */
  assets: readonly AssetAnalysisLike[];
  /** Общая стоимость портфеля, руб */
  totalValue: number;
  /** Ценовые алерты */
  alerts: readonly PriceAlertLike[];
};

/** Состояние директора (один на весь lifecycle приложения) */
export interface DirectorState {
  director: DirectorAgent;
  audit: DirectorAuditLog;
  actionAgents: DirectorActionAgents;
  sourceLabel: string;
  aiLabel: string;
  /** Результат последнего анализа (обновляется при каждом запуске) */
  analysisResult: AnalysisResultInfo;
}

/** Полное состояние десктоп-приложения */
export interface AppState {
  director: DirectorState;
  /** «Гибридный диспетчер» — опционально (null при сбое сборки) */
  harness: HarnessHandle | null;
  /**
   * Автономный цикл (цели + фоновый watch) — опционально: собирается
   * в main.ts после инициализации director-состояния.
   */
  autonomous: AutonomousBridge | null;
  /** Последний отчёт полного конвейера (report.html/report.md) — null до прогона */
  pipelineReport: PipelineReportInfo | null;
}

/** Цель для UI/renderer (структурная копия Goal без внутренностей) */
export interface GoalSummary {
  id: string;
  name: string;
  description: string;
  status: string;
  priority: string;
  progress: number;
  createdAt: string;
}

/** Статус автономного цикла для UI/renderer */
export interface AutonomousBridgeStatusInfo {
  running: boolean;
  intervalSec: number;
  activeGoals: number;
  loop: {
    state: string;
    totalIterations: number;
    consecutiveFailures: number;
    lastStopReason?: string;
  };
}

/** Результат разового запуска автономного цикла */
export interface AutonomousRunOnceResult {
  started: boolean;
  message: string;
}

function toGoalSummary(goal: Goal): GoalSummary {
  return {
    id: goal.id,
    name: goal.name,
    description: goal.description,
    status: goal.status,
    priority: goal.priority,
    progress: goal.progress,
    createdAt: goal.createdAt,
  };
}

/**
 * Отчёт полного конвейера (как `npm run pipeline`): HTML/MD-содержимое
 * report-файлов + метаданные прогона. Хранится в AppState и показывается
 * на вкладке «Анализ» в исходном виде report.html.
 */
export interface PipelineReportInfo {
  /** Полный HTML-документ отчёта (report.html) */
  htmlContent: string;
  /** Markdown-версия отчёта (report.md) */
  mdContent: string;
  /** Путь записанного report.html (пусто — запись не удалась) */
  htmlPath: string;
  /** Путь записанного report.md */
  mdPath: string;
  /** ISO-метка завершения */
  finishedAt: string;
  /** Длительность прогона, мс */
  elapsedMs: number;
  /** Успешен ли весь конвейер */
  success: boolean;
}

/** Минимальный контракт координатора (для DI в тестах) */
export interface PipelineCoordinatorLike {
  run(sharedData?: Record<string, unknown>): Promise<PipelineResult>;
  onStageComplete(
    callback: (stage: string, durationMs: number) => void,
  ): () => void;
}

/**
 * Запустить полный конвейер (data → research → analysis → AI → review →
 * scenario → strategist → notification) и сохранить отчёт в state.
 * Тот же PipelineCoordinator, что в `npm run pipeline` и гибридном
 * диспетчере: NotificationAgent пишет report.html/report.md в корень.
 */
export async function runPipelineReport(
  state: AppState,
  deps: { createCoordinator?: () => PipelineCoordinatorLike } = {},
): Promise<PipelineReportInfo> {
  const create = deps.createCoordinator ?? (() => new PipelineCoordinator());
  const coordinator = create();
  const startedAt = Date.now();
  const result = await coordinator.run();
  const notification = result.stages.notification?.result.data as
    NotificationAgentOutput | undefined;
  const info: PipelineReportInfo = {
    htmlContent: notification?.htmlContent ?? '',
    mdContent: notification?.mdContent ?? '',
    htmlPath: notification?.htmlPath ?? '',
    mdPath: notification?.mdPath ?? '',
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    success: result.success,
  };
  state.pipelineReport = info;
  return info;
}

/** Последний отчёт полного конвейера (null — ещё не запускался) */
export function handleLastPipelineReport(
  state: AppState,
): PipelineReportInfo | null {
  return state.pipelineReport;
}

/**
 * Идея для пользователя: из ProactiveSuggester (портфель) или
 * детерминированных эвристик по целям/циклу (проект).
 */
export interface ProactiveIdea {
  /** Источник идеи */
  kind: 'portfolio' | 'project';
  /** Тип (ProactiveMessageType для портфеля, 'project-improvement' для проекта) */
  type: string;
  /** Короткий заголовок */
  title: string;
  /** Содержание */
  text: string;
  /** Приоритет */
  priority: string;
}

/**
 * Детерминированные идеи по развитию ПРОЕКТА: на основе целей автономного
 * цикла и состояния фонового watch-режима. Честность: если данных нет
 * (нет autonomous) — идей не выдаём.
 */
async function buildProjectIdeas(state: AppState): Promise<ProactiveIdea[]> {
  const ideas: ProactiveIdea[] = [];
  const bridge = state.autonomous;
  if (!bridge) {
    return ideas;
  }
  const goals = await bridge.listGoals();
  const count = (status: string): number =>
    goals.filter((goal) => goal.status === status).length;
  const active = count('active');
  const pending = count('pending');
  const paused = count('paused');
  const completed = count('completed');

  if (goals.length === 0) {
    ideas.push({
      kind: 'project',
      type: 'project-improvement',
      title: 'Список целей пуст',
      text:
        'Скажи в чате «давай добавим …» или «задача: …» — поставлю это ' +
        'в план автономного цикла и выполню фоном.',
      priority: 'normal',
    });
  }
  if (active > 0) {
    ideas.push({
      kind: 'project',
      type: 'project-improvement',
      title: `Активных целей: ${active}`,
      text:
        'Включи фоновый цикл на вкладке «Цели» (или попроси «запусти ' +
        'автономный цикл») — буду закрывать цели по одной и присылать итог.',
      priority: 'normal',
    });
  }
  if (pending > 0) {
    ideas.push({
      kind: 'project',
      type: 'project-improvement',
      title: `Целей в ожидании: ${pending}`,
      text: 'Есть неактивированные цели — стоит активировать их или убрать.',
      priority: 'low',
    });
  }
  if (paused > 0) {
    ideas.push({
      kind: 'project',
      type: 'project-improvement',
      title: `Целей на паузе: ${paused}`,
      text: 'Разберём блокеры по приостановленным целям — возможно, их уже можно возобновить.',
      priority: 'normal',
    });
  }
  if (completed >= 3) {
    ideas.push({
      kind: 'project',
      type: 'project-improvement',
      title: `Завершённых целей: ${completed}`,
      text: 'Накопилась история — можно подвести итоги и почистить список целей.',
      priority: 'low',
    });
  }
  const status = await bridge.status();
  if (status.loop.consecutiveFailures >= 2) {
    ideas.push({
      kind: 'project',
      type: 'project-improvement',
      title: 'Фоновый цикл падает',
      text: `Подряд неуспешных итераций: ${status.loop.consecutiveFailures}. Посмотри вкладку «Консоль» — там причина.`,
      priority: 'high',
    });
  }
  return ideas;
}

/**
 * Идеи Директора: портфельные (ProactiveSuggester по фактам) + проектные
 * (эвристики по целям автономного цикла).
 */
export async function handleProactiveIdeas(
  state: AppState,
): Promise<ProactiveIdea[]> {
  const ideas: ProactiveIdea[] = [];
  try {
    for (const message of state.director.director.suggestProactive()) {
      ideas.push({
        kind: 'portfolio',
        type: message.type,
        title: message.title,
        text: message.content,
        priority: message.priority,
      });
    }
  } catch {
    // Идеи не критичны: не отвечаем ошибкой в UI
  }
  try {
    ideas.push(...(await buildProjectIdeas(state)));
  } catch {
    // Проектные идеи не критичны: не отвечаем ошибкой в UI
  }
  return ideas;
}

/** Список целей (все или по статусу) */
export async function handleGoalsList(
  state: AppState,
  status?: 'pending' | 'active' | 'paused' | 'completed' | 'cancelled',
): Promise<GoalSummary[]> {
  if (!state.autonomous) return [];
  const goals = await state.autonomous.listGoals(status);
  return goals.map(toGoalSummary);
}

/** Добавить и активировать цель */
export async function handleGoalsAdd(
  state: AppState,
  text: string,
): Promise<GoalSummary> {
  if (!state.autonomous) {
    throw new Error('Автономный цикл не инициализирован');
  }
  const goal = await state.autonomous.addGoal(String(text ?? '').trim());
  return toGoalSummary(goal);
}

/** Статус автономного цикла */
export async function handleAutonomousStatus(
  state: AppState,
): Promise<AutonomousBridgeStatusInfo | null> {
  if (!state.autonomous) return null;
  return state.autonomous.status();
}

/** Включить фоновый автономный цикл */
export async function handleAutonomousStart(
  state: AppState,
  intervalSec?: number,
): Promise<AutonomousBridgeStatusInfo | null> {
  if (!state.autonomous) return null;
  return state.autonomous.start(intervalSec);
}

/** Выключить фоновый автономный цикл */
export async function handleAutonomousStop(
  state: AppState,
): Promise<AutonomousBridgeStatusInfo | null> {
  if (!state.autonomous) return null;
  return state.autonomous.stop();
}

/** Разовый цикл прямо сейчас */
export async function handleAutonomousRunOnce(
  state: AppState,
): Promise<AutonomousRunOnceResult> {
  if (!state.autonomous) {
    return { started: false, message: 'Автономный цикл не инициализирован' };
  }
  const output = await state.autonomous.runOnce();
  return {
    started: output !== null,
    message:
      output?.message ??
      'Цикл уже выполняется или упал (см. лог main-процесса)',
  };
}

/**
 * Чат-команды автономного цикла: /goal «текст», /goals, /autonomous …
 * Перехватываются ДО processUserMessage — работают мгновенно, без LLM.
 * Возвращает null, если сообщение не является командой цикла.
 */
export async function handleAutonomousChatCommand(
  state: AppState,
  question: string,
): Promise<AskResult | null> {
  const bridge = state.autonomous;
  const text = (question ?? '').trim();
  if (!bridge) return null;

  const startedAt = Date.now();
  const reply = async (message: string): Promise<AskResult> => ({
    text: message,
    events: [],
    elapsedMs: Date.now() - startedAt,
  });

  if (text.toLowerCase().startsWith('/goal ')) {
    const goalText = text.slice(6).trim();
    if (!goalText) {
      return reply('Формат: /goal «текст задачи»');
    }
    try {
      const goal = await bridge.addGoal(goalText);
      return reply(
        '🎯 Цель добавлена и активирована:\n' +
          `[${goal.id.slice(0, 8)}] ${goal.name}\n\n` +
          'Автономный цикл выполнит её на следующем тике. Список — /goals',
      );
    } catch (err) {
      return reply(
        `Не удалось добавить цель: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (
    text.toLowerCase() === '/goals' ||
    text.toLowerCase().startsWith('/goals ')
  ) {
    const arg = text.slice(6).trim().toLowerCase();
    const status =
      arg === 'active'
        ? ('active' as const)
        : arg === 'completed'
          ? ('completed' as const)
          : undefined;
    const goals = await bridge.listGoals(status);
    if (goals.length === 0) {
      return reply(
        '📭 Целей нет. Добавьте: /goal «текст задачи» или npm run goals -- add "..."',
      );
    }
    const marks: Record<string, string> = {
      pending: '⏳',
      active: '▶',
      paused: '⏸',
      completed: '✅',
      cancelled: '✖',
    };
    const lines = goals.map(
      (g) =>
        `${marks[g.status] ?? '•'} [${g.id.slice(0, 8)}] ${g.status} — ${g.name}`,
    );
    return reply(`Цели (${goals.length}):\n${lines.join('\n')}`);
  }

  if (
    text.toLowerCase() === '/autonomous' ||
    text.toLowerCase().startsWith('/autonomous ')
  ) {
    const arg = text.slice(11).trim().toLowerCase();
    const parts = arg.split(/\s+/).filter(Boolean);
    const sub = parts[0] ?? 'status';

    if (sub === 'on') {
      const intervalSec = Number(parts[1]);
      const st = await bridge.start(
        Number.isFinite(intervalSec) && intervalSec > 0
          ? intervalSec
          : undefined,
      );
      return reply(
        `👀 Автономный цикл включён: каждые ${st.intervalSec} с, активных целей: ${st.activeGoals}.`,
      );
    }
    if (sub === 'off') {
      const st = await bridge.stop();
      return reply(
        `⏹ Автономный цикл остановлен. Активных целей: ${st.activeGoals}.`,
      );
    }
    if (sub === 'now') {
      const result = await handleAutonomousRunOnce(state);
      return reply(
        result.started
          ? `⚙️ Цикл запущен: ${result.message}`
          : `⚠️ ${result.message}`,
      );
    }

    const st = await bridge.status();
    return reply(
      `Автономный цикл: ${st.running ? `работает (каждые ${st.intervalSec} с)` : 'выключен'}\n` +
        `Итераций всего: ${st.loop.totalIterations}, активных целей: ${st.activeGoals}\n` +
        `Причина последней остановки: ${st.loop.lastStopReason ?? '—'}\n\n` +
        'Команды: /autonomous on [сек] | off | now | status',
    );
  }

  return null;
}

/** Опции сборки состояния директора */
export interface BuildDirectorStateOptions {
  /** Путь к Excel с портфелем (по умолчанию process.env.EXCEL_FILE_PATH) */
  excelPath?: string;
  /** Режим роли «ai» (по умолчанию 'auto'; 'off' — детерминированный) */
  aiMode?: 'auto' | 'off';
  /** Таймаут проверки Ollama, мс (по умолчанию 1500) */
  ollamaCheckTimeoutMs?: number;
  /**
   * Живой источник актуальной модели Ollama (например, resolveOllamaModel из
   * load-settings). Если не задан — берётся process.env.OLLAMA_MODEL.
   */
  getOllamaModel?: () => string | undefined;
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
    options.getOllamaModel,
  );

  // Передаём результат probe Ollama в chatResponder — если Ollama доступна
  // для aiExecutor, она должна быть доступна и для свободного диалога.
  const ollamaAvailable = aiLabel.includes('Ollama');

  // Расширенный режим управления компьютером: системные команды Windows
  // (tasklist/taskkill/explorer/systeminfo/netstat/...) разрешены в терминале
  // и в whitelist SecurityAgent. taskkill остаётся опасной командой — все
  // команды по-прежнему проходят security-gate.
  const actionAgents = createDefaultActionAgents({
    enableSystemCommands: true,
  });
  const security = new SecurityAgent(
    {
      name: 'SecurityAgent',
    },
    {
      allowedCommands: [...SYSTEM_COMMANDS],
    },
  );
  const facade = new DirectorAgentFacade({
    actionAgents,
    // Адаптер к единому контракту `check` фасада (validate — синхронный)
    security: { check: (request) => security.validate(request) },
    aiExecutor,
  });
  const audit = new DirectorAuditLog();
  const chatResponder = await createChatResponder(
    aiMode,
    ollamaCheckTimeoutMs,
    log,
    options.getOllamaModel,
    ollamaAvailable,
  );
  const director = new DirectorAgent(
    { facade, audit, initialFacts: facts },
    {
      maxConsiliumRounds: 3,
      includeAgentDetails: true,
      chatResponder,
    },
  );
  director.createSession();

  // Перехват результата анализа при ЛЮБОМ запуске (кнопка или ленивый
  // анализ после вопроса): текст сохраняется в state.analysisResult.
  const analysisResult: AnalysisResultInfo = {
    text: null,
    finishedAt: null,
    elapsedMs: null,
  };
  const originalRunLazyAnalysis = director.runLazyAnalysis.bind(director);
  (director as unknown as Record<string, unknown>).runLazyAnalysis =
    async (): Promise<string> => {
      const startedAt = Date.now();
      const result = await originalRunLazyAnalysis();
      analysisResult.text = result;
      analysisResult.finishedAt = new Date().toISOString();
      analysisResult.elapsedMs = Date.now() - startedAt;
      return result;
    };

  return {
    director,
    audit,
    actionAgents,
    sourceLabel,
    aiLabel,
    analysisResult,
  };
}

/** Последний анализ + контекст (для вкладки «Анализ») */
export function handleLastAnalysis(state: DirectorState): LastAnalysisInfo {
  const facts = state.director.getFacts();
  return {
    ...state.analysisResult,
    sourceLabel: state.sourceLabel,
    assets: facts.assetsAnalysis,
    totalValue: facts.totalPortfolioValue,
    alerts: facts.priceAlerts ?? [],
  };
}

/** Полный HTML-документ отчёта по анализу (для HTML/PDF-экспорта) */
export function buildAnalysisHtml(
  info: LastAnalysisInfo,
  now: Date = new Date(),
): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<title>Анализ портфеля</title>
${buildAnalysisHtmlStyle()}
</head>
<body>
${buildAnalysisBodyHtml(info, now)}
</body>
</html>`;
}

/** Стили отчёта (используются и в HTML-экспорте, и в PDF-рендере) */
export function buildAnalysisHtmlStyle(): string {
  return `<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 32px; color: #1c2733; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 26px 0 10px; color: #2c3e50; }
  .meta { color: #5b6b7c; font-size: 12px; margin-bottom: 20px; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .card { background: #f6f8fa; border: 1px solid #d9e1e8; border-radius: 10px; padding: 14px 16px; }
  .card-label { font-size: 11px; color: #5b6b7c; text-transform: uppercase; letter-spacing: 0.4px; }
  .card-value { font-size: 20px; font-weight: 600; margin-top: 6px; }
  .pos { color: #1a7f37; } .neg { color: #c62828; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #5b6b7c; font-size: 11px; text-transform: uppercase;
       letter-spacing: 0.4px; padding: 8px 10px; border-bottom: 2px solid #d9e1e8; }
  td { padding: 9px 10px; border-bottom: 1px solid #e7edf2; vertical-align: top; }
  tr:nth-child(even) td { background: #fafbfc; }
  tr.warn td { background: #fff7e6; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .muted { color: #5b6b7c; font-size: 11px; margin-top: 2px; }
  ul.alerts { margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.7; }
  details { margin-top: 22px; }
  summary { cursor: pointer; color: #2c3e50; font-weight: 600; font-size: 14px; }
  pre { white-space: pre-wrap; overflow-wrap: break-word; font-family: Consolas,
        'Courier New', monospace; font-size: 12.5px; line-height: 1.55;
        background: #f6f8fa; border: 1px solid #d9e1e8; border-radius: 8px;
        padding: 16px; margin-top: 10px; }
  @media print { body { margin: 16px; } details { display: none; } }
</style>`;
}

/**
 * Тело отчёта: карточки-показатели + таблица активов + алерты + текстовая
 * сводка. Используется в HTML/PDF-экспорте (buildAnalysisHtml) и как
 * основа отображения на вкладке «Анализ».
 */
export function buildAnalysisBodyHtml(
  info: LastAnalysisInfo,
  now: Date = new Date(),
): string {
  const escapeHtml = (value: string): string =>
    value
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"');
  const finished = info.finishedAt
    ? new Date(info.finishedAt).toLocaleString('ru-RU')
    : '—';
  const fmtRub = (value: number): string =>
    `${Math.round(value).toLocaleString('ru-RU')} ₽`;
  const fmtPct = (value: number): string => `${value.toFixed(1)}%`;

  const assets = info.assets ?? [];
  const totalPnl = assets.reduce(
    (sum, asset) => sum + (asset.unrealizedProfitRub ?? 0),
    0,
  );
  const maxDeviation = assets.reduce(
    (max, asset) =>
      Math.max(max, Math.abs(asset.currentPercent - asset.targetPercent)),
    0,
  );
  const alerts = info.alerts ?? [];

  const cards = `
<div class="cards">
  <div class="card"><div class="card-label">Стоимость портфеля</div><div class="card-value">${fmtRub(info.totalValue ?? 0)}</div></div>
  <div class="card"><div class="card-label">Нереализованный P&L</div><div class="card-value ${totalPnl < 0 ? 'neg' : 'pos'}">${fmtRub(totalPnl)}</div></div>
  <div class="card"><div class="card-label">Активов</div><div class="card-value">${assets.length}</div></div>
  <div class="card"><div class="card-label">Макс. отклонение от цели</div><div class="card-value ${maxDeviation > 15 ? 'neg' : ''}">${fmtPct(maxDeviation)}</div></div>
</div>`;

  const assetsTable =
    assets.length === 0
      ? '<p class="muted">Данные портфеля не загружены.</p>'
      : `<h2>📋 Структура портфеля</h2>
<table>
  <thead><tr>
    <th>Актив</th><th class="num">Доля (тек.)</th><th class="num">Доля (цель)</th>
    <th class="num">Отклонение</th><th class="num">P&L</th><th>Статус</th>
  </tr></thead>
  <tbody>${assets
    .map((asset) => {
      const deviation = asset.currentPercent - asset.targetPercent;
      const deviationClass =
        deviation > 2 ? 'neg' : deviation < -2 ? 'pos' : '';
      const pnl = asset.unrealizedProfitRub;
      const flags = asset.isConcentrated ? ['концентрация'] : [];
      return `<tr${asset.isConcentrated ? ' class="warn"' : ''}>
    <td><b>${escapeHtml(asset.ticker)}</b><div class="muted">${escapeHtml(asset.name)}</div></td>
    <td class="num">${fmtPct(asset.currentPercent)}</td>
    <td class="num">${fmtPct(asset.targetPercent)}</td>
    <td class="num ${deviationClass}">${deviation > 0 ? '+' : ''}${deviation.toFixed(1)} п.п.</td>
    <td class="num">${pnl === undefined ? '—' : `<span class="${pnl < 0 ? 'neg' : 'pos'}">${fmtRub(pnl)}</span>`}</td>
    <td>${escapeHtml(asset.status)}${flags.length > 0 ? `<div class="muted">${escapeHtml(flags.join(', '))}</div>` : ''}</td>
  </tr>`;
    })
    .join('\n')}</tbody>
</table>`;

  const alertsBlock =
    alerts.length === 0
      ? ''
      : `<h2>🔔 Ценовые алерты</h2>
<ul class="alerts">${alerts
          .map(
            (alert) =>
              `<li><b>${escapeHtml(alert.ticker)}</b> — ${escapeHtml(
                alert.alertLevel ?? 'alert',
              )}${alert.currentPrice !== undefined ? ` (цена ${alert.currentPrice})` : ''}</li>`,
          )
          .join('')}</ul>`;

  const textBlock = info.text
    ? `<details open><summary>📝 Текстовая сводка</summary><pre>${escapeHtml(info.text)}</pre></details>`
    : '<p class="muted">Анализ ещё не запускался.</p>';

  return `<h1>📊 Анализ инвестиционного портфеля</h1>
<div class="meta">Завершён: ${finished} · Источник данных: ${escapeHtml(
    info.sourceLabel,
  )} · Сформировано: ${now.toLocaleString('ru-RU')}</div>
${cards}
${assetsTable}
${alertsBlock}
${textBlock}`;
}

/** Результат переподключения Ollama */
export interface OllamaReconnectResult {
  success: boolean;
  label: string;
  message: string;
}

/** Результат перезагрузки портфеля */
export interface PortfolioReloadResult {
  success: boolean;
  sourceLabel: string;
  assetsCount: number;
  message: string;
}

/**
 * Переподключить Ollama: проверить доступность и обновить executor в фасадe.
 * Вызывается при старте (fallback-режим), при явном запросе из UI,
 * или когда предыдущий вызов Ollama упал с ошибкой.
 */
export async function reconnectOllama(
  state: DirectorState,
  options: BuildDirectorStateOptions,
): Promise<OllamaReconnectResult> {
  const log = options.logger ?? consoleLogger;
  const aiMode =
    options.aiMode ??
    (process.env.DIRECTOR_CHAT_AI === 'off' ||
    process.env.DIRECTOR_CHAT_AI === '0'
      ? 'off'
      : 'auto');

  if (aiMode === 'off') {
    return {
      success: false,
      label: 'детерминированный исполнитель (aiMode=off)',
      message: 'AI-режим отключён (DIRECTOR_CHAT_AI=off)',
    };
  }

  const ollamaCheckTimeoutMs =
    options.ollamaCheckTimeoutMs ?? OLLAMA_CHECK_TIMEOUT_MS;

  // Проверка доступности Ollama
  const probeClient = new OllamaClient({
    model: resolveActiveModel(options.getOllamaModel),
  });
  const available = await withTimeout(
    probeClient.isAvailable(),
    ollamaCheckTimeoutMs,
  );

  if (!available) {
    log(
      'warn',
      'Ollama недоступна при переподключении — остаётся детерминированный режим',
    );
    return {
      success: false,
      label: 'детерминированный исполнитель (без Ollama)',
      message: 'Ollama недоступна — используется детерминированный режим',
    };
  }

  // Пересоздаём executor с Ollama
  const { executor: aiExecutor, label: aiLabel } = await createAiExecutor(
    aiMode,
    ollamaCheckTimeoutMs,
    log,
    options.getOllamaModel,
  );

  // Обновляем executor в существующем фасаде
  const existingFacade = (
    state.director as unknown as { facade?: DirectorAgentFacade }
  ).facade;
  (state.director as unknown as Record<string, unknown>).facade =
    existingFacade ??
    new DirectorAgentFacade({
      actionAgents: state.actionAgents,
      security: {
        check: (request: unknown) => {
          const security = new SecurityAgent();
          const validator = (
            security as unknown as {
              validate?: (r: unknown) => SecurityDecision;
            }
          ).validate;
          return validator
            ? validator(request)
            : ({
                id: `allow-${Date.now()}`,
                timestamp: new Date().toISOString(),
                request: request as SecurityActionRequest,
                verdict: 'allow',
                matchedRules: [],
              } satisfies SecurityDecision);
        },
      },
      aiExecutor,
    });

  // Пересоздаём chatResponder (Ollama уже проверена выше — available=true)
  const chatResponder = await createChatResponder(
    aiMode,
    ollamaCheckTimeoutMs,
    log,
    options.getOllamaModel,
    true,
  );

  // Обновляем config director
  (state.director as unknown as Record<string, unknown>).config = {
    ...((state.director as unknown as Record<string, unknown>).config ?? {}),
    chatResponder,
  };

  state.aiLabel = aiLabel;

  log('info', `Ollama переподключена — ${aiLabel}`);
  return {
    success: true,
    label: aiLabel,
    message: `Ollama подключена: ${aiLabel}`,
  };
}

/**
 * Перезагрузить данные портфеля из Excel и обновить Director.
 * Вызывается после выбора нового файла Excel — без перезапуска.
 */
export async function reloadPortfolio(
  state: DirectorState,
  excelPath: string,
): Promise<PortfolioReloadResult> {
  const log = consoleLogger;

  const { facts, sourceLabel } = await loadFacts(excelPath, log);
  state.sourceLabel = sourceLabel;

  // Обновляем факты в Director
  state.director.setFacts(facts);

  const assetsCount = facts.assetsAnalysis.length;

  log(
    'info',
    `Портфель перезагружен: ${assetsCount} активов, файл ${excelPath}`,
  );

  return {
    success: true,
    sourceLabel,
    assetsCount,
    message: `Данные портфеля обновлены: ${assetsCount} активов`,
  };
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
  // Каталог всех агентов системы: не выполнявшиеся показываются как idle.
  const panel = buildPanelState({ agents: sources });
  return { ...panel, agents: buildAgentCatalogCards(panel.agents) };
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
    const outcome = (await harness.scheduler.manualRun()) as
      HarnessRunOutcome | null | undefined;
    if (outcome && typeof outcome.ok === 'boolean') {
      return { ok: outcome.ok, message: outcome.summary };
    }
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

/** Результат экспорта дашборда диспетчера в HTML-файл */
export interface HarnessExportResult {
  ok: boolean;
  message: string;
  filePath?: string;
}

/**
 * Экспорт полного HTML-дашборда диспетчера в файл.
 * - Упакованное приложение: %APPDATA%/finance-analyzer/reports;
 * - dev/тесты: <cwd>/exports (или переопределённый outputDir).
 */
export async function handleHarnessExport(
  harness: HarnessHandle | null,
  now: Date = new Date(),
  outputDir?: string,
): Promise<HarnessExportResult> {
  if (!harness) {
    return { ok: false, message: 'Гибридный диспетчер не активирован' };
  }
  try {
    const payload = await harness.bridge.getDashboardPayload();
    if (!payload) {
      return { ok: false, message: 'Данные диспетчера ещё не сформированы' };
    }
    const dir =
      outputDir ??
      (isPackagedApp()
        ? path.join(resolveAppDataDir(), 'reports')
        : path.join(process.cwd(), 'exports'));
    fs.mkdirSync(dir, { recursive: true });
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filePath = path.join(dir, `dashboard_${stamp}.html`);
    fs.writeFileSync(filePath, buildDashboardHtml(payload, now), 'utf-8');
    return { ok: true, message: `Дашборд сохранён: ${filePath}`, filePath };
  } catch (err) {
    return {
      ok: false,
      message: `Ошибка экспорта дашборда: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/** Полный HTML-документ дашборда (обёртка над formatDashboardHtml) */
export function buildDashboardHtml(
  payload: HarnessDashboardPayload,
  now: Date,
): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Finance Analyzer — дашборд диспетчера</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #94a3b8; font-size: 12px; margin-bottom: 16px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; margin-bottom: 12px; }
</style>
</head>
<body>
<h1>🛰 Finance Analyzer — дашборд диспетчера</h1>
<div class="meta">Сформирован: ${now.toLocaleString('ru-RU')}</div>
${formatDashboardHtml(payload)}
</body>
</html>`;
}

// ──────────────────────────────────────────────
// 7. Graceful shutdown
// ──────────────────────────────────────────────

/** Остановить все подсистемы приложения (идемпотентно, без проброса ошибок) */
export async function shutdownAppState(appState: AppState): Promise<void> {
  try {
    appState.autonomous?.dispose();
  } catch {
    // Остановка — best effort
  }
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
