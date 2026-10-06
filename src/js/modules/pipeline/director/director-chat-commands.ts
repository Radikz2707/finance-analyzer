/**
 * Системные команды Director-чата (/status, /log, /undo, /help, /panel).
 *
 * Модуль не зависит от DOM: парсинг команд, форматирование ответов,
 * детекция опасных паттернов и построение заявки для SecurityAgent —
 * чистые функции, покрываются тестами без браузера.
 *
 * Честность данных:
 * - /status показывает только то, что реально доступно (state, счётчики,
 *   агенты последней задачи). Если точный список агентов недоступен — так и
 *   говорится вместо выдумывания.
 * - /log берёт события из DirectorAuditLog.
 * - /undo регистрирует последнее действие, но НЕ имитирует откат: если
 *   механика отката не предоставлена, это честно сообщается.
 * - /panel строит HTML панели управления агентами из доступных DI-источников
 *   (agentPanelSources); недостающие источники показываются как
 *   «данные недоступны», ничего не выдумывается.
 */

import type { DirectorAuditEvent } from './director-types.js';
import type {
  SecurityActionRequest,
  SecurityDecision,
} from '../agents/security-agent.js';
import { buildPanelState } from '../visualization/agent-panel-model.js';
import { renderAgentPanel } from '../visualization/agent-panel.js';
import type { AgentPanelSources } from '../visualization/agent-panel-model.js';

// ──────────────────────────────────────────────
// 1. Парсинг системных команд
// ──────────────────────────────────────────────

/** Имя системной команды */
export type SystemCommandName = 'status' | 'log' | 'undo' | 'help' | 'panel';

/** Разобранная системная команда */
export interface ChatCommand {
  /** Имя команды без слеша (в нижнем регистре) */
  name: string;
  /** Известна ли команда системе */
  known: boolean;
  /** Аргументы (например, число строк для /log 15) */
  args: string[];
  /** Исходная строка */
  raw: string;
}

/** Результат разбора ввода пользователя */
export type ParsedChatInput =
  { kind: 'command'; command: ChatCommand } | { kind: 'text'; text: string };

/** Известные системные команды */
export const KNOWN_COMMANDS: readonly SystemCommandName[] = [
  'status',
  'log',
  'undo',
  'help',
  'panel',
];

/**
 * Разобрать ввод пользователя.
 * Возвращает команду (включая неизвестные вида «/foo») или обычный текст.
 */
export function parseChatInput(raw: string): ParsedChatInput {
  const text = (raw ?? '').trim();
  if (!text.startsWith('/')) {
    return { kind: 'text', text };
  }
  const parts = text.slice(1).split(/\s+/);
  const name = (parts[0] ?? '').toLowerCase();
  const known = (KNOWN_COMMANDS as readonly string[]).includes(name);
  return {
    kind: 'command',
    command: {
      name,
      known,
      args: parts.slice(1),
      raw: text,
    },
  };
}

// ──────────────────────────────────────────────
// 2. Справка
// ──────────────────────────────────────────────

/** Текст справки по системным командам */
export function buildHelpText(): string {
  return (
    'Доступные команды:\n' +
    '• /status — статус Director и последней задачи\n' +
    '• /log [N] — последние N действий (по умолчанию 10)\n' +
    '• /undo — отмена последнего действия (ограниченно)\n' +
    '• /panel — панель управления агентами (карточки, цепочки, история)\n' +
    '• /help — эта справка'
  );
}

// ──────────────────────────────────────────────
// 3. Источники данных и диспетчер команд
// ──────────────────────────────────────────────

/** Источники данных для системных команд (адаптер к Director и хранилищам) */
export interface ChatCommandSources {
  /** Состояние Director: idle/running/paused/error/stopped */
  state?: string;
  /** Количество сообщений в текущей сессии */
  chatMessageCount?: number;
  /** Количество выполненных задач (по аудит-событиям синтеза) */
  completedTasks?: number;
  /** Количество записей стратегической памяти */
  strategicMemoryCount?: number;
  /** Агенты, подключённые к последней задаче */
  connectedAgents?: Array<{ role: string; label?: string }>;
  /** Аудит-события Director (для /log) */
  auditEvents?: readonly DirectorAuditEvent[];
  /** Человекочитаемое описание последнего зарегистрированного действия */
  lastActionDescription?: string | null;
  /** Есть ли механика отката последнего действия */
  canUndo?: boolean;
  /** Выполнить откат последнего действия (если механика есть) */
  undoAction?: () => { undone: boolean; message: string };
  /** Источники данных для панели управления агентами (/panel) */
  agentPanelSources?: AgentPanelSources;
}

/** Тип ответа системной команды */
export type CommandReplyKind =
  'help' | 'status' | 'log' | 'undo' | 'panel' | 'unknown';

/** Ответ системной команды */
export interface CommandReply {
  kind: CommandReplyKind;
  /** Текст ответа для чата */
  text: string;
  /** Сколько аудит-событий показано в /log (для тестов) */
  shownEvents?: number;
}

/** Лимит /log по умолчанию и максимум */
export const DEFAULT_LOG_LIMIT = 10;
export const MAX_LOG_LIMIT = 50;

/**
 * Выполнить системную команду на основе доступных источников.
 * Возвращает null для обычного текста (не команды).
 */
export function executeChatCommand(
  parsed: ParsedChatInput,
  sources: ChatCommandSources,
): CommandReply | null {
  if (parsed.kind !== 'command') return null;
  const command = parsed.command;

  switch (command.name) {
    case 'help':
      return { kind: 'help', text: buildHelpText() };
    case 'status':
      return { kind: 'status', text: formatStatusText(sources) };
    case 'log': {
      const limit = parseLogLimit(command.args);
      const events = sources.auditEvents ?? [];
      return {
        kind: 'log',
        text: formatLogText(events, limit),
        shownEvents: Math.min(limit, events.length),
      };
    }
    case 'undo':
      return { kind: 'undo', text: formatUndoText(sources) };
    case 'panel':
      return { kind: 'panel', text: formatPanelText(sources) };
    default:
      return {
        kind: 'unknown',
        text: formatUnknownCommandText(command.name, command.args),
      };
  }
}

// ──────────────────────────────────────────────
// 4. Форматтеры ответов
// ──────────────────────────────────────────────

/** Текст ответа на /status (только реально доступные данные) */
export function formatStatusText(sources: ChatCommandSources): string {
  const lines: string[] = [];
  lines.push('📡 Статус Director');
  lines.push('• Состояние: ' + (sources.state ?? 'неизвестно'));
  lines.push('• Сообщений в сессии: ' + String(sources.chatMessageCount ?? 0));
  lines.push('• Выполнено задач: ' + String(sources.completedTasks ?? 0));
  lines.push(
    '• Записей стратегической памяти: ' +
      String(sources.strategicMemoryCount ?? 0),
  );

  const agents = sources.connectedAgents ?? [];
  if (agents.length > 0) {
    lines.push('');
    lines.push('Агенты последней задачи:');
    for (const agent of agents) {
      lines.push('• ' + (agent.label ?? agent.role));
    }
  } else {
    lines.push('');
    lines.push(
      '⚠️ Точный список агентов сейчас недоступен — данные последней задачи ' +
        'отсутствуют. Задачи делегируются через DirectorAgentFacade.',
    );
  }

  return lines.join('\n');
}

/** Текст ответа на /log [N] */
export function formatLogText(
  events: readonly DirectorAuditEvent[],
  limit: number,
): string {
  if (events.length === 0) {
    return '📋 Аудит-лог пуст — действий пока не зарегистрировано.';
  }
  const recent = events.slice(-limit).reverse();
  const lines: string[] = ['📋 Последние действия (' + recent.length + '):'];
  for (const event of recent) {
    const time = new Date(event.timestamp).toLocaleTimeString('ru-RU');
    const task = event.taskId
      ? ' [task ' + event.taskId.slice(0, 12) + '…]'
      : '';
    lines.push('• ' + time + ' ' + event.type + task);
    lines.push('  ' + event.message);
  }
  return lines.join('\n');
}

/** Текст ответа на /undo — честный: без механики отката не имитируем её */
export function formatUndoText(sources: ChatCommandSources): string {
  const lastAction = sources.lastActionDescription;
  const canUndo =
    sources.canUndo === true && typeof sources.undoAction === 'function';

  if (canUndo && sources.undoAction) {
    const result = sources.undoAction();
    if (result.undone) {
      return '↩️ Последнее действие отменено.\n' + result.message;
    }
    return '⚠️ Откат не выполнен: ' + result.message;
  }

  const lines: string[] = [];
  lines.push('↩️ Отмена последнего действия');
  if (lastAction) {
    lines.push(
      'Последнее зарегистрированное действие: «' +
        lastAction.slice(0, 160) +
        '».',
    );
  } else {
    lines.push('Действий пока не зарегистрировано.');
  }
  lines.push('');
  lines.push(
    '⚠️ Механика отката (undo) не реализована: Director не хранит обратных ' +
      'операций для уже выполненных действий.',
  );
  lines.push(
    'Действие зафиксировано в аудит-логе. Для корректировки отправьте новый запрос.',
  );
  return lines.join('\n');
}

/** Текст ответа на неизвестную команду */
export function formatUnknownCommandText(name: string, args: string[]): string {
  const rendered = '/' + name + (args.length > 0 ? ' ' + args.join(' ') : '');
  return '❓ Неизвестная команда: ' + rendered + '\n\n' + buildHelpText();
}

/**
 * HTML панели управления агентами для /panel.
 * Строит состояние из доступных DI-источников (agentPanelSources) и рендерит
 * HTML-строку. Если источник не подключён — панель честно показывает
 * «данные недоступны». Возвращаемый HTML предназначен для rich-отображения;
 * в текстовом чате виджет экранирует его как обычный текст.
 */
export function formatPanelText(sources: ChatCommandSources): string {
  const state = buildPanelState(sources.agentPanelSources);
  return renderAgentPanel(state);
}

/** Разобрать аргумент /log: число строк (1..MAX, по умолчанию DEFAULT) */
export function parseLogLimit(args: string[]): number {
  const raw = args[0];
  if (!raw) return DEFAULT_LOG_LIMIT;
  const parsedNumber = Number.parseInt(raw, 10);
  if (Number.isNaN(parsedNumber) || parsedNumber <= 0) return DEFAULT_LOG_LIMIT;
  return Math.min(parsedNumber, MAX_LOG_LIMIT);
}

// ──────────────────────────────────────────────
// 5. Детекция опасных действий
// ──────────────────────────────────────────────

/** Уровень опасности действия (отдельное имя — DangerLevel занят SecurityAgent) */
export type ChatDangerLevel = 'low' | 'medium' | 'high';

/** Оценка опасности сообщения пользователя */
export interface DangerAssessment {
  /** Сообщение опасно */
  dangerous: boolean;
  /** Уровень опасности */
  level?: ChatDangerLevel;
  /** Человекочитаемое описание риска */
  description?: string;
  /** Сработавшие правила */
  matchedPatterns?: string[];
  /** Вердикт SecurityAgent, если он использовался */
  securityVerdict?: string;
}

/**
 * Правило детекции опасного паттерна.
 *
 * ⚠️ НЕ полагаемся на \w/\b с флагом 'u' для кириллицы: в некоторых сборках
 * Node (small-icu) юникодные word-boundary и \w некорректны. Поэтому русские
 * слова детектируем литеральными подстроками через `keywords`, а ASCII-
 * паттерны (rm -rf, sudo, exec) — через `regex`.
 */
interface DangerRule {
  level: ChatDangerLevel;
  description: string;
  /** Литеральные подстроки (регистронезависимо, через includes) */
  keywords?: readonly string[];
  /** ASCII-паттерн (дополнительно к keywords) */
  regex?: RegExp;
}

const DANGER_RULES: readonly DangerRule[] = [
  {
    level: 'high',
    description: 'Деструктивная системная команда (rm -rf / sudo / format)',
    regex:
      /\b(?:rm\s+-rf\b|sudo\b|mkfs\.|shutdown|format\s+[a-z]:|del\s+(?:[\\/]|c:))/i,
  },
  {
    level: 'medium',
    description: 'Удаление или уничтожение данных',
    keywords: ['удал', 'уничтож', 'стерет', 'remove', 'delete'],
    regex: /drop\s+table/i,
  },
  {
    level: 'high',
    description: 'Доступ к чувствительному пути (.env / .git)',
    keywords: ['.env', '.git'],
  },
  {
    level: 'medium',
    description: 'Доступ к служебному пути node_modules',
    keywords: ['node_modules'],
  },
  {
    level: 'high',
    description: 'Запрос на выполнение команды или процесса',
    keywords: [
      'выполни команду',
      'исполни команду',
      'запусти процесс',
      'запусти команду',
      'child_process',
      'system(',
    ],
    regex: /\b(?:exec|spawn|shell)\b/i,
  },
  {
    level: 'medium',
    description: 'Изменение прав или перезапись файлов',
    keywords: ['перезапис', 'overwrite', 'truncate', 'chmod', 'chown'],
  },
  {
    level: 'medium',
    description: 'Запрос чувствительных данных (пароль/токен)',
    keywords: [
      'пароль',
      'password',
      'secret',
      'api_key',
      'apikey',
      'api-key',
      'token',
      'токен',
      'учётн',
      'учетн',
      'credential',
    ],
  },
];

function ruleMatches(rule: DangerRule, lowerText: string): boolean {
  if (rule.keywords) {
    for (const keyword of rule.keywords) {
      if (lowerText.includes(keyword)) return true;
    }
  }
  if (rule.regex) {
    return rule.regex.test(lowerText);
  }
  return false;
}

/** Проверить сообщение на опасные паттерны (без внешних зависимостей) */
export function detectDangerousIntent(message: string): DangerAssessment {
  const text = (message ?? '').toLowerCase();
  const matched: string[] = [];
  let worstLevel: ChatDangerLevel | undefined;
  let description = '';

  for (const rule of DANGER_RULES) {
    if (ruleMatches(rule, text)) {
      matched.push(rule.description);
      if (!worstLevel || severity(rule.level) > severity(worstLevel)) {
        worstLevel = rule.level;
        description = rule.description;
      }
    }
  }

  if (matched.length === 0) {
    return { dangerous: false };
  }

  return {
    dangerous: true,
    level: worstLevel,
    description,
    matchedPatterns: [...new Set(matched)],
  };
}

function severity(level: ChatDangerLevel): number {
  return level === 'high' ? 2 : level === 'medium' ? 1 : 0;
}

// ──────────────────────────────────────────────
// 6. Интеграция с SecurityAgent
// ──────────────────────────────────────────────

/** Извлечь первый «путеподобный» токен из текста (эвристика) */
function findPathToken(text: string): string | null {
  const match = text.match(
    /(?:[a-zA-Z]:[\\/][^\s;,|&`$()"']*|[./~]?[\w-]+(?:[\\/][\w.-]+)+)/,
  );
  return match?.[0] ?? null;
}

/**
 * Построить заявку на действие для SecurityAgent из свободного сообщения.
 * Эвристика: «удали <путь>» → file delete; «выполни команду X» → terminal.
 * Возвращает null, если сообщение не похоже на заявку на действие.
 */
export function extractSecurityActionRequest(
  message: string,
): SecurityActionRequest | null {
  const text = (message ?? '').trim();
  if (text === '') return null;
  const lower = text.toLowerCase();

  // Удаление файла/каталога
  if (lower.includes('удал') || /\b(?:rm|del|remove|delete)\b/i.test(lower)) {
    const pathToken = findPathToken(text);
    return {
      kind: 'file',
      action: 'delete',
      path: pathToken ?? '.',
      description:
        'Пользователь запросил удаление' + (pathToken ? ': ' + pathToken : ''),
    };
  }

  // Выполнение терминальной команды
  const cmdMatch = text.match(
    /(?:выполни|исполни|запусти|выполнить|run|exec(?:ute)?)\s+(?:команду\s+)?([a-z0-9._-]+(?:\s+[^\s;,|&`$()"']*)?)/iu,
  );
  const commandLine = cmdMatch?.[1]?.trim();
  if (commandLine) {
    return {
      kind: 'terminal',
      command: commandLine,
      description: 'Пользователь запросил выполнение команды: ' + commandLine,
    };
  }

  return null;
}

/** Валидатор заявки (совместим с SecurityAgent.validate) */
export type SecurityActionValidator = (
  request: SecurityActionRequest,
) => SecurityDecision;

/**
 * Комбинированная оценка опасности: regex-детекция + вердикт SecurityAgent
 * (если передан валидатор и из сообщения удалось построить заявку).
 */
export function assessDanger(
  message: string,
  validate?: SecurityActionValidator,
): DangerAssessment {
  const base = detectDangerousIntent(message);

  if (validate) {
    const request = extractSecurityActionRequest(message);
    if (request) {
      const decision = validate(request);
      if (decision.verdict === 'deny') {
        return {
          dangerous: true,
          level: 'high',
          description: decision.reason ?? 'Действие запрещено SecurityAgent',
          matchedPatterns: base.matchedPatterns ?? [],
          securityVerdict: 'deny',
        };
      }
      if (decision.verdict === 'require-confirmation') {
        return {
          dangerous: true,
          level: decision.dangerLevel ?? 'medium',
          description:
            decision.description ??
            decision.reason ??
            'Действие требует подтверждения',
          matchedPatterns: base.matchedPatterns ?? [],
          securityVerdict: 'require-confirmation',
        };
      }
      // SecurityAgent разрешил — но если regex нашёл риск, всё равно предупредим
      if (base.dangerous) {
        return { ...base, securityVerdict: 'allow' };
      }
      return { dangerous: false, securityVerdict: 'allow' };
    }
  }

  return base;
}
