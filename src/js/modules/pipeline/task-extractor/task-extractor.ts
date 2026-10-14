/**
 * TaskExtractor — извлечение структурированных задач из свободной речи.
 *
 * Двухконтурная архитектура (как в dialogue-engine):
 * 1. LLM-извлечение (OllamaClient.chat, JSON-схема `{tasks: [{action,
 *    target, params}]}`) — понимает свободную речь, сложные формулировки;
 * 2. Детерминированный fallback на nl-parser + action-input-builder —
 *    работает офлайн, покрывает все прежние action-запросы Director.
 *
 * LLM-результат принимается только при валидных action/target; иначе —
 * fallback (честность: не выдумываем задачу).
 *
 * Модуль чистый: без Node-зависимостей, LLM-клиент — DI (type-only импорт).
 */

import {
  buildAutomationAgentInput,
  buildCodingWorkflowInput,
  buildFileAgentInput,
  buildPackageAgentInput,
  buildProcessAgentInput,
  buildSystemResourceInput,
  buildTerminalAgentInput,
  extractAllFilePaths,
} from '../director/action-input-builder.js';
import type { InterpretedQuestion } from '../director/director-types.js';
import {
  looksLikeAutomationRequest,
  looksLikeCodeRequest,
  looksLikeFileRequest,
  looksLikePackageRequest,
  looksLikeProcessRequest,
  looksLikeSystemStatusRequest,
  looksLikeTaskIntent,
  looksLikeTerminalRequest,
  parseUserMessage,
} from '../director/nl-parser.js';
import type {
  ExtractedTask,
  LlmChatLike,
  TaskAction,
  TaskExtractionContext,
  TaskExtractionResult,
  TaskExtractorOptions,
} from './types.js';

// ──────────────────────────────────────────────
// 1. Константы
// ──────────────────────────────────────────────

/** Валидные действия задач */
const VALID_ACTIONS: ReadonlySet<string> = new Set([
  'file',
  'terminal',
  'code',
  'package',
  'process',
  'automation',
  'research',
  'portfolio',
  'goal',
]);

/** Системный промпт LLM-извлечения */
const DEFAULT_SYSTEM_PROMPT = `Ты — извлекатель задач финансового ассистента.
Из свободной речи пользователя выдели структурированные задачи для агентов.

Действия (action):
- file — файловая операция (создать/прочитать/изменить/удалить файл);
- terminal — команда терминала (запустить тесты, git, npm run ...);
- code — разработка кода (реализовать функцию, добавить модуль, исправить баг);
- package — управление зависимостями (установить/обновить/удалить пакет);
- process — управление процессами (запустить/остановить/перезапустить процесс);
- automation — автоматизация (workflow, расписание);
- research — исследование: факты, фундаментал, новости по активу;
- portfolio — анализ портфеля в целом;
- goal — задача/идея для автономного цикла («добавь в план», «давай сделаем»).

target — цель действия: путь файла, команда, тикер (SBER, GAZP, PLZL), тема.
params — параметры действия (action файла, command/args терминала, files кода).

Ответь СТРОГО одним JSON-объектом без markdown:
{"tasks":[{"action":"file","target":"src/test.ts","params":{"action":"write"}}]}

Если задач нет — верни {"tasks":[]}.`;

/** Порог доверия LLM-ответу по умолчанию */
const DEFAULT_MIN_CONFIDENCE = 0.55;

/** Таймаут LLM-запроса по умолчанию, мс */
const DEFAULT_TIMEOUT_MS = 5000;

/** Уверенность LLM-задачи по умолчанию (LLM явно выделил задачу) */
const LLM_TASK_CONFIDENCE = 0.85;

/** Уверенность fallback-задач (детерминированные паттерны) */
const FALLBACK_ACTION_CONFIDENCE = 0.9;
const FALLBACK_CODE_CONFIDENCE = 0.85;
const FALLBACK_GOAL_CONFIDENCE = 0.8;
const FALLBACK_RESEARCH_CONFIDENCE = 0.6;

/** Канонические команды для абстрактных формулировок («запусти тесты») */
const CANONICAL_COMMANDS: ReadonlyArray<{
  pattern: RegExp;
  command: string;
  args: string[];
}> = [
  {
    pattern: /(?:запусти|запустить|прогони|прогнать)\s+тест/i,
    command: 'npm',
    args: ['run', 'test'],
  },
];

// ──────────────────────────────────────────────
// 2. Извлекатель
// ──────────────────────────────────────────────

/**
 * Извлекатель задач: LLM с fallback на nl-parser + action-input-builder.
 */
export class TaskExtractor {
  private readonly llm?: LlmChatLike;
  private readonly systemPrompt: string;
  private readonly minConfidence: number;
  private readonly timeoutMs: number;

  constructor(options?: TaskExtractorOptions) {
    this.llm = options?.llm;
    this.systemPrompt = options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.minConfidence = options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Есть ли подключённый LLM */
  hasLlm(): boolean {
    return this.llm !== undefined;
  }

  /**
   * Извлечь задачи из текста: LLM → fallback.
   * Никогда не бросает: падение LLM даёт fallback-извлечение.
   */
  async extract(
    text: string,
    context?: TaskExtractionContext,
  ): Promise<TaskExtractionResult> {
    const trimmed = (text ?? '').trim();
    if (trimmed === '') {
      return { tasks: [], source: 'fallback', rawText: '' };
    }

    if (this.llm) {
      const llmResult = await this.tryLlm(trimmed, context);
      if (llmResult) {
        return { ...llmResult, source: 'llm' as const };
      }
    }

    return fallbackExtract(trimmed, context);
  }

  // ── LLM-контур ──

  private async tryLlm(
    text: string,
    context?: TaskExtractionContext,
  ): Promise<TaskExtractionResult | null> {
    try {
      const factsHint = buildFactsHint(context?.facts);
      const userPrompt = [
        'Реплика пользователя:',
        text,
        factsHint ? '\nКонтекст портфеля:\n' + factsHint : '',
        '\nВерни JSON-объект с извлечёнными задачами.',
      ]
        .filter(Boolean)
        .join('\n');

      const raw = await this.withTimeout(
        this.llm!.chat([
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: userPrompt },
        ]),
        this.timeoutMs,
      );
      if (raw === null) return null;

      const parsed = parseLlmJson(raw);
      if (!parsed || !Array.isArray(parsed.tasks)) return null;

      const tasks: ExtractedTask[] = [];
      for (const item of parsed.tasks) {
        const task = normalizeLlmTask(item, text, this.minConfidence);
        if (task) {
          tasks.push(task);
        }
      }
      if (tasks.length === 0) return null;

      return { tasks, source: 'llm', rawText: text };
    } catch {
      return null;
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
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
}

// ──────────────────────────────────────────────
// 3. Fallback-извлечение (nl-parser + action-input-builder)
// ──────────────────────────────────────────────

/**
 * Детерминированное извлечение задач через nl-parser и
 * action-input-builder. Порядок проверок сохраняет приоритеты
 * существующих action-ролей Director.
 */
export function fallbackExtract(
  text: string,
  _context?: TaskExtractionContext,
): TaskExtractionResult {
  const trimmed = (text ?? '').trim();
  const tasks: ExtractedTask[] = [];
  if (trimmed === '') {
    return { tasks, source: 'fallback', rawText: '' };
  }

  const question = toQuestion(trimmed);
  // Создана ли action-задача: терминальная ветка подключается ТОЛЬКО если
  // более специфичный action (file/code/package/process/automation/system)
  // не распознан — иначе «обнови модули» не превратится в команду терминала,
  // а «запусти процесс python» — в команду «процесс».
  let actionTaskCreated = false;

  // 1. Файловые операции (FileAgent)
  if (looksLikeFileRequest(trimmed)) {
    const input = buildFileAgentInput(question);
    if (input) {
      const params: Record<string, unknown> = { action: input.action };
      if (input.toPath) params.toPath = input.toPath;
      tasks.push(
        makeTask(
          'file',
          input.path ?? '',
          params,
          FALLBACK_ACTION_CONFIDENCE,
          trimmed,
        ),
      );
      actionTaskCreated = true;
    }
  }

  // 2. Задачи разработки (CodingWorkflow)
  if (looksLikeCodeRequest(trimmed)) {
    const input = buildCodingWorkflowInput(question);
    const paths =
      input && input.files.length > 0
        ? input.files.map((file) => file.path)
        : extractAllFilePaths(trimmed);
    tasks.push(
      makeTask(
        'code',
        paths.join(', ') || trimmed,
        { files: paths },
        FALLBACK_CODE_CONFIDENCE,
        trimmed,
      ),
    );
    actionTaskCreated = true;
  }

  // 3. Операции с зависимостями (PackageAgent) — приоритет над терминалом
  if (looksLikePackageRequest(trimmed)) {
    const input = buildPackageAgentInput(question);
    if (input) {
      tasks.push(
        makeTask(
          'package',
          (input.packages ?? []).join(', ') || input.action,
          {
            action: input.action,
            manager: input.manager,
            packages: input.packages ?? [],
          },
          FALLBACK_ACTION_CONFIDENCE,
          trimmed,
        ),
      );
      actionTaskCreated = true;
    }
  }

  // 4. Операции с процессами (ProcessAgent) — приоритет над терминалом
  if (looksLikeProcessRequest(trimmed)) {
    const input = buildProcessAgentInput(question);
    if (input) {
      const target =
        input.name !== undefined
          ? String(input.name)
          : [input.command ?? '', ...(input.args ?? [])]
              .filter(Boolean)
              .join(' ');
      tasks.push(
        makeTask(
          'process',
          target,
          { ...input },
          FALLBACK_ACTION_CONFIDENCE,
          trimmed,
        ),
      );
      actionTaskCreated = true;
    }
  }

  // 5. Автоматизация (AutomationAgent) — приоритет над терминалом
  if (looksLikeAutomationRequest(trimmed)) {
    const input = buildAutomationAgentInput(question);
    if (input) {
      const templateId =
        input.action === 'run-now'
          ? input.params.templateId
          : (input.params as { templateId?: string }).templateId;
      tasks.push(
        makeTask(
          'automation',
          String(templateId ?? input.action),
          { ...input },
          FALLBACK_ACTION_CONFIDENCE,
          trimmed,
        ),
      );
      actionTaskCreated = true;
    }
  }

  // 6. Системные ресурсы (SystemResourceAgent) — мониторинг, только чтение
  if (looksLikeSystemStatusRequest(trimmed)) {
    const input = buildSystemResourceInput(question);
    if (input) {
      tasks.push(
        makeTask(
          'process',
          'system',
          { action: 'status', scope: 'system' },
          FALLBACK_ACTION_CONFIDENCE,
          trimmed,
        ),
      );
      actionTaskCreated = true;
    }
  }

  // 7. Терминальные операции (TerminalAgent) — только если не распознан
  // более специфичный action. Сначала канонические команды («запусти
  // тесты» → npm run test): общий парсер честно отказывается от
  // абстрактных формулировок, а «запусти тесты и покажи результат» не
  // должно превращаться в команду «тесты».
  if (!actionTaskCreated && looksLikeTerminalRequest(trimmed)) {
    const canonical = findCanonicalCommand(trimmed);
    if (canonical) {
      tasks.push(
        makeTask(
          'terminal',
          [canonical.command, ...canonical.args].join(' '),
          { command: canonical.command, args: canonical.args },
          FALLBACK_ACTION_CONFIDENCE,
          trimmed,
        ),
      );
    } else {
      const input = buildTerminalAgentInput(question);
      if (input) {
        tasks.push(
          makeTask(
            'terminal',
            [input.command, ...(input.args ?? [])].join(' '),
            { command: input.command, args: input.args },
            FALLBACK_ACTION_CONFIDENCE,
            trimmed,
          ),
        );
      }
    }
  }

  // 8. Задача/идея → цель автономного цикла (GoalAgent)
  if (looksLikeTaskIntent(trimmed)) {
    tasks.push(
      makeTask('goal', trimmed, {}, FALLBACK_GOAL_CONFIDENCE, trimmed),
    );
  }

  // 9. Исследование/портфель — низкая уверенность: категорийная
  // маршрутизация Director остаётся основным путём для таких вопросов.
  if (tasks.length === 0) {
    const parsed = parseUserMessage(trimmed);
    if (parsed.tickers.length > 0 || parsed.category !== 'general') {
      const action: TaskAction =
        parsed.category === 'portfolio' ? 'portfolio' : 'research';
      tasks.push(
        makeTask(
          action,
          parsed.tickers.join(', ') || parsed.topic,
          { category: parsed.category, tickers: parsed.tickers },
          FALLBACK_RESEARCH_CONFIDENCE,
          trimmed,
        ),
      );
    }
  }

  return { tasks, source: 'fallback', rawText: trimmed };
}

// ──────────────────────────────────────────────
// 4. Helpers
// ──────────────────────────────────────────────

/** Создать ExtractedTask с уникальным id */
function makeTask(
  action: TaskAction,
  target: string,
  params: Record<string, unknown>,
  confidence: number,
  rawText: string,
): ExtractedTask {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    target,
    params,
    confidence: clamp01(confidence),
    rawText,
  };
}

/** Минимальный InterpretedQuestion для action-input-builder */
function toQuestion(text: string): InterpretedQuestion {
  return {
    category: 'general',
    tickers: [],
    topic: text,
    text,
    requiredAgents: [],
    needsConsilium: false,
    complexity: 1,
    intent: 'general-inquiry',
  };
}

/** Найти каноническую команду для абстрактной формулировки */
function findCanonicalCommand(
  text: string,
): { command: string; args: string[] } | null {
  for (const entry of CANONICAL_COMMANDS) {
    if (entry.pattern.test(text)) {
      return { command: entry.command, args: entry.args };
    }
  }
  return null;
}

/** Подсказка по фактам портфеля для LLM (тикеры) */
function buildFactsHint(facts?: TaskExtractionContext['facts']): string {
  if (!facts || facts.assetsAnalysis.length === 0) return '';
  const tickers = facts.assetsAnalysis
    .map((asset) => asset.ticker)
    .filter(Boolean)
    .slice(0, 20)
    .join(', ');
  return tickers ? `Известные тикеры: ${tickers}` : '';
}

/** Распарсить JSON из ответа LLM (ленивый парсинг JSON-блока) */
function parseLlmJson(raw: string): { tasks?: unknown } | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    return { tasks: data.tasks };
  } catch {
    return null;
  }
}

/** Нормализовать задачу из ответа LLM (валидация action/target) */
function normalizeLlmTask(
  item: unknown,
  rawText: string,
  minConfidence: number,
): ExtractedTask | null {
  if (typeof item !== 'object' || item === null) return null;
  const record = item as Record<string, unknown>;

  const action = record.action;
  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) return null;

  const target = typeof record.target === 'string' ? record.target.trim() : '';
  if (target === '') return null;

  const params =
    typeof record.params === 'object' && record.params !== null
      ? (record.params as Record<string, unknown>)
      : {};

  // Необязательная уверенность: ниже порога — отбрасываем задачу
  const confidence =
    typeof record.confidence === 'number'
      ? clamp01(record.confidence)
      : LLM_TASK_CONFIDENCE;
  if (confidence < minConfidence) return null;

  return makeTask(action as TaskAction, target, params, confidence, rawText);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
