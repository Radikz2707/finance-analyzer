/**
 * Director Chat — интерактивный CLI-чат с Директором.
 *
 * Запуск:
 *   npm run chat                                    (интерактивный REPL)
 *   npm run chat -- --once "Сравни Сбер и Газпром"  (один вопрос и выход)
 *
 * Что показывает:
 *   план делегирования → мнения каждого агента по мере поступления →
 *   раунды Консилиума (позиции и смены позиций) → синтез Director →
 *   реальное выполнение File/Terminal операций через SecurityAgent.
 *
 * Режимы данных:
 *   - EXCEL_FILE_PATH задан и файл существует — факты портфеля прогоняются
 *     через XlsxParserModule (CurrentAsset + MacroGoals);
 *   - иначе — пустые факты с честной пометкой «без данных портфеля».
 *
 * Роль «ai»: если локальный Ollama доступен (быстрая проверка с таймаутом) —
 * используется LLM; иначе детерминированный исполнитель из agent-facade,
 * поэтому Консилиум работает офлайн (strategist + scenario дают ≥2 мнений).
 * Принудительный детерминированный режим: DIRECTOR_CHAT_AI=off (для CI/тестов).
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import { createInterface } from 'node:readline/promises';

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
  type AgentSourceItem,
} from '../src/js/modules/pipeline/visualization/agent-panel-model.js';
import type {
  AgentOpinion,
  DirectorFactsContext,
  DirectorResponse,
} from '../src/js/modules/pipeline/director/director-types.js';
import {
  buildBannerText,
  color,
  formatAuditEventLine,
  formatConsiliumRounds,
  stripAnsi,
} from './director-chat-render.js';

// ──────────────────────────────────────────────
// 1. Константы и утилиты вывода
// ──────────────────────────────────────────────

const OLLAMA_CHECK_TIMEOUT_MS = 1500;
const OLLAMA_RESPONSE_TIMEOUT_MS = 30_000;
const MAX_LOG_LINES = 100;
const SEPARATOR = '─'.repeat(36);

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

/** Вывод с учётом TTY: без терминала ANSI-коды обрезаются */
function createPrinter(): (text: string) => void {
  const useColor = process.stdout.isTTY === true;
  return (text: string): void => {
    console.log(useColor ? text : stripAnsi(text));
  };
}

/** Простой логгер для служебных сообщений (с префиксом) */
function createLogger(): {
  info: (message: string) => void;
  warn: (message: string) => void;
} {
  const print = createPrinter();
  return {
    info: (message) => print(color.dim(`[chat] ${message}`)),
    warn: (message) => print(color.yellow(`[chat] ⚠ ${message}`)),
  };
}

// ──────────────────────────────────────────────
// 2. Мягкая валидация env и загрузка фактов
// ──────────────────────────────────────────────

/** Проверить окружение: предупредить, но НЕ падать (warn, не throw) */
function validateEnvSoft(log: ReturnType<typeof createLogger>): void {
  if (!process.env.EXCEL_FILE_PATH) {
    log.warn(
      'EXCEL_FILE_PATH не задан — работаем без данных портфеля (задайте путь в .env)',
    );
  } else if (!fs.existsSync(process.env.EXCEL_FILE_PATH)) {
    log.warn(
      `EXCEL_FILE_PATH указывает на несуществующий файл: ${process.env.EXCEL_FILE_PATH}`,
    );
  }
  if (!process.env.OLLAMA_MODEL) {
    log.info('OLLAMA_MODEL не задан — используется модель Ollama по умолчанию');
  }
}

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

/** Загрузить факты портфеля из EXCEL_FILE_PATH (или пустые) */
async function loadFacts(
  log: ReturnType<typeof createLogger>,
): Promise<LoadedFacts> {
  const excelPath = process.env.EXCEL_FILE_PATH;
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
    log.info(
      `Факты портфеля загружены: активов ${assets.length}, файл ${excelPath}`,
    );
    return {
      facts: portfolioToFacts(assets, goals),
      sourceLabel: `данные портфеля: ${excelPath}`,
    };
  } catch (err) {
    log.warn(
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
// 3. AI-исполнитель роли «ai»
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
 * Собрать исполнителя роли «ai»: Ollama, если доступен локально,
 * иначе детерминированный fallback (Консилиум работает офлайн).
 * При DIRECTOR_CHAT_AI=off проверка сети пропускается полностью.
 */
async function createAiExecutor(
  log: ReturnType<typeof createLogger>,
): Promise<{ executor: AiDecisionExecutor; label: string }> {
  const forcedDeterministic =
    process.env.DIRECTOR_CHAT_AI === 'off' ||
    process.env.DIRECTOR_CHAT_AI === '0';
  if (forcedDeterministic) {
    log.info(
      'DIRECTOR_CHAT_AI=off — роль «ai» работает в детерминированном режиме',
    );
    return {
      executor: defaultAiExecutor,
      label: 'детерминированный исполнитель (DIRECTOR_CHAT_AI=off)',
    };
  }

  const client = new OllamaClient({
    model: process.env.OLLAMA_MODEL || undefined,
  });
  const available = await withTimeout(
    client.isAvailable(),
    OLLAMA_CHECK_TIMEOUT_MS,
  );

  if (!available) {
    log.warn(
      'Ollama недоступен — роль «ai» работает в детерминированном режиме (офлайн)',
    );
    return {
      executor: defaultAiExecutor,
      label: 'детерминированный исполнитель (без Ollama)',
    };
  }

  log.info('Ollama подключён — роль «ai» использует LLM');
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
        log.warn(
          'Ollama вернул неразбираемый ответ — используем детерминированное мнение',
        );
      } catch (err) {
        log.warn(
          `Ошибка Ollama: ${err instanceof Error ? err.message : String(err)} — используем детерминированное мнение`,
        );
      }
      return fallback;
    },
    label: 'Ollama (LLM)',
  };
}

// ──────────────────────────────────────────────
// 4. Сборка DirectorAgent
// ──────────────────────────────────────────────

interface ChatDeps {
  director: DirectorAgent;
  audit: DirectorAuditLog;
  actionAgents: DirectorActionAgents;
  sourceLabel: string;
  aiLabel: string;
  log: ReturnType<typeof createLogger>;
}

function buildDirector(
  facts: DirectorFactsContext,
  aiExecutor: AiDecisionExecutor,
): {
  director: DirectorAgent;
  audit: DirectorAuditLog;
  actionAgents: DirectorActionAgents;
} {
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
  return { director, audit, actionAgents };
}

// ──────────────────────────────────────────────
// 5. Интерактивный цикл
// ──────────────────────────────────────────────

/** Обработать один вопрос: стриминг событий уже идёт через подписку onEvent */
async function askAndStream(
  question: string,
  deps: ChatDeps,
  print: (text: string) => void,
): Promise<DirectorResponse | null> {
  const { director } = deps;
  print(color.dim(`🤔 Вопрос принят: ${question}`));
  const startedAt = Date.now();
  try {
    const response = await director.processUserMessage(question);
    const elapsed = Date.now() - startedAt;

    if (response.task?.consilium) {
      print('');
      print(formatConsiliumRounds(response.task.consilium));
    }

    print('');
    print(color.bold(SEPARATOR));
    print(color.bold('💬 Ответ Director:'));
    print(response.text);
    print(color.bold(SEPARATOR));
    print(color.dim(`⏱ выполнено за ${elapsed} мс`));
    return response;
  } catch (err) {
    print(color.red('⚠️ Ошибка при обработке вопроса:'));
    print(color.red(err instanceof Error ? err.message : String(err)));
    return null;
  }
}

/** Формат события аудита с меткой времени (для /log) */
function formatLogEntry(
  event: Parameters<typeof formatAuditEventLine>[0],
): string {
  const time = event.timestamp.slice(11, 19);
  return `${time} ${formatAuditEventLine(event)}`;
}

/** Обработчик спецкоманд чата. Возвращает false для /quit */
async function handleCommand(
  line: string,
  deps: ChatDeps,
  print: (text: string) => void,
): Promise<boolean> {
  const { director, audit, actionAgents, sourceLabel, aiLabel } = deps;

  if (/^\/quit$/.test(line) || /^\/exit$/.test(line)) {
    return false;
  }
  if (/^\/help$/.test(line)) {
    print(buildBannerText());
    return true;
  }
  if (/^\/status$/.test(line)) {
    const session = director.currentSession;
    const memory = director.getStrategicMemory();
    const proactive = director.getProactiveMessages();
    const lastDirectorMessage = [...(session?.messages ?? [])]
      .reverse()
      .find((m) => m.role === 'director');
    print(color.bold('🧭 Статус Director'));
    print(`  состояние: ${director.state}`);
    print(`  сессия: ${session?.sessionId ?? '—'}`);
    print(`  стратегическая память: ${memory.length} записей`);
    print(`  проактивные сообщения: ${proactive.length}`);
    print(
      `  агенты последней задачи: ${
        lastDirectorMessage?.connectedAgents?.join(', ') ?? '—'
      }`,
    );
    print(`  факты: ${sourceLabel}`);
    print(`  роль «ai»: ${aiLabel}`);
    return true;
  }
  const logMatch = /^\/log(?:\s+(\d+))?$/.exec(line);
  if (logMatch) {
    const count = logMatch[1]
      ? Math.max(1, Math.min(Number(logMatch[1]), MAX_LOG_LINES))
      : 10;
    const entries = audit.getAll().slice(-count);
    print(color.bold(`📜 Последние ${entries.length} событий аудита:`));
    if (entries.length === 0) {
      print(color.dim('  (событий пока нет)'));
    }
    for (const entry of entries) {
      print(`  ${formatLogEntry(entry)}`);
    }
    return true;
  }
  if (/^\/panel$/.test(line)) {
    // Источники панели: реальные action-агенты (getSummary),
    // остальные источники честно отсутствуют в CLI.
    const sources: AgentSourceItem[] = [];
    if (actionAgents.file) {
      sources.push(actionAgents.file as unknown as AgentSourceItem);
    }
    if (actionAgents.terminal) {
      sources.push(actionAgents.terminal as unknown as AgentSourceItem);
    }
    const panel = buildPanelState({ agents: sources });
    print(color.bold('📊 Панель агентов (текстовая версия)'));
    print(`  общая оценка: ${panel.overall}`);
    print('  агенты:');
    if (panel.agents.length === 0) {
      print(color.dim('    (action-агенты недоступны)'));
    }
    for (const card of panel.agents) {
      print(
        `    • ${color.cyan(card.name)} — ${card.status} ` +
          `(выполнений ${card.totalExecutions}, ` +
          `успешно ${card.successes}, ошибок ${card.failures})`,
      );
    }
    const flags = panel.available;
    print(
      `  источники: agents ${flags.agents ? '✔' : '✘'} · ` +
        `history ${flags.history ? '✔' : '✘'} · ` +
        `watchdog ${flags.watchdog ? '✔' : '✘'} · ` +
        `controller ${flags.controller ? '✔' : '✘'}`,
    );
    print(
      color.dim(
        '  (источники history/watchdog/controller не подключены в CLI — честно)',
      ),
    );
    return true;
  }

  print(color.yellow(`Неизвестная команда: ${line} (наберите /help)`));
  return true;
}

/** Интерактивный REPL */
async function runRepl(
  deps: ChatDeps,
  print: (text: string) => void,
): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let interrupted = false;
  const onSigint = (): void => {
    interrupted = true;
    rl.close();
  };
  process.on('SIGINT', onSigint);

  print('');
  print(color.dim('Наберите /help для списка команд, /quit — для выхода.'));
  print('');

  while (!interrupted) {
    const raw = await rl.question('Вы> ').catch(() => '');
    const line = raw.trim();
    if (line === '') continue;

    if (line.startsWith('/')) {
      const keepGoing = await handleCommand(line, deps, print);
      if (!keepGoing) break;
      continue;
    }

    await askAndStream(line, deps, print);
    print('');
  }

  process.off('SIGINT', onSigint);
  rl.close();
  print(color.dim('До свидания!'));
}

// ──────────────────────────────────────────────
// 6. Точка входа
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  const print = createPrinter();
  const log = createLogger();

  validateEnvSoft(log);

  const { facts, sourceLabel } = await loadFacts(log);
  const { executor: aiExecutor, label: aiLabel } = await createAiExecutor(log);
  const { director, audit, actionAgents } = buildDirector(facts, aiExecutor);

  const deps: ChatDeps = {
    director,
    audit,
    actionAgents,
    sourceLabel,
    aiLabel,
    log,
  };

  // Живой стриминг всех событий аудита (план, агенты, Консилиум, синтез)
  const unsubscribe = audit.onEvent((event) => {
    print(formatAuditEventLine(event));
  });

  const onceIndex = process.argv.indexOf('--once');
  if (onceIndex >= 0) {
    const question = process.argv
      .slice(onceIndex + 1)
      .join(' ')
      .trim();
    if (!question) {
      print(color.red('Использование: npm run chat -- --once "ваш вопрос"'));
      unsubscribe();
      process.exitCode = 1;
      return;
    }
    print(buildBannerText());
    print('');
    print(color.dim(`📁 Факты: ${sourceLabel} · роль «ai»: ${aiLabel}`));
    print('');
    await askAndStream(question, deps, print);
    unsubscribe();
    // --once: вопрос обработан и процесс должен завершиться сам по себе,
    // несмотря на фоновые таймеры памяти (MemoryCleaner и т.п.)
    process.exit(0);
  }

  print(buildBannerText());
  print('');
  print(color.dim(`📁 Факты: ${sourceLabel} · роль «ai»: ${aiLabel}`));
  await runRepl(deps, print);
  unsubscribe();
  // Интерактивный режим завершён (/quit или Ctrl+C): выходим явно.
  process.exit(0);
}

void main();
