/**
 * Director Chat Render — чистые функции форматирования для CLI-чата Директора.
 *
 * Модуль не имеет runtime-зависимостей (ни Node API, ни браузера):
 * все импорты — type-only (стираются при транспиляции), ANSI-цвета встроены.
 * Функции работают и без TTY: они не читают process/stdout, а возвращают
 * строки (возможно, с ANSI-кодами) — обрезать их должен вызывающий код
 * через `stripAnsi`, если вывод не является терминалом.
 */

import type {
  DirectorAuditEvent,
  MultiRoundConsiliumOutput,
} from '../src/js/modules/pipeline/director/director-types.js';

// ──────────────────────────────────────────────
// 1. Цвета (ANSI, без зависимостей)
// ──────────────────────────────────────────────

const RESET = '\u001b[0m';

function paint(code: string, text: string): string {
  return `${code}${text}${RESET}`;
}

/** Минимальная ANSI-палитра */
export const color = {
  dim: (text: string): string => paint('\u001b[2m', text),
  red: (text: string): string => paint('\u001b[31m', text),
  green: (text: string): string => paint('\u001b[32m', text),
  yellow: (text: string): string => paint('\u001b[33m', text),
  blue: (text: string): string => paint('\u001b[34m', text),
  magenta: (text: string): string => paint('\u001b[35m', text),
  cyan: (text: string): string => paint('\u001b[36m', text),
  bold: (text: string): string => paint('\u001b[1m', text),
};

// Регулярное выражение ANSI-кодов собрано без control-символов в литерале
// (правило eslint no-control-regex не допускает \x1b в /.../).
const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** Удалить ANSI-коды (для нетерминального вывода / тестов) */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

// ──────────────────────────────────────────────
// 2. Метки ролей и действий (локально, без импортов)
// ──────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  ai: 'AI',
  analysis: 'Analysis',
  strategist: 'Strategist',
  scenario: 'Scenario',
  research: 'Research',
  review: 'Review',
  file: 'File',
  terminal: 'Terminal',
};

const ACTION_LABELS: Record<string, string> = {
  BUY: 'докупить',
  SELL: 'продать часть',
  EXIT: 'выйти полностью',
  REDUCE: 'сократить',
  HOLD: 'удерживать',
  AVOID: 'избегать',
  AVERAGE: 'усреднить',
};

/** Человекочитаемая метка инвестиционного действия */
export function actionLabel(action: string | null | undefined): string {
  if (!action) return 'без действия';
  return ACTION_LABELS[action] ?? action;
}

/** Человекочитаемая метка роли агента */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

// ──────────────────────────────────────────────
// 3. Форматтеры событий аудита
// ──────────────────────────────────────────────

/** Извлечь список агентов из event.metadata.agents либо из message */
function extractAgents(event: DirectorAuditEvent): string[] {
  const meta = event.metadata?.agents;
  if (
    Array.isArray(meta) &&
    meta.every((item): item is string => typeof item === 'string')
  ) {
    return [...meta];
  }
  const match = /агенты?:\s*([^.;]+)/i.exec(event.message);
  if (match?.[1]) {
    return match[1]
      .split(/[,،]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * «📋 План: подключены агенты [analysis, strategist, scenario], Консилиум: да»
 */
export function formatPlanLine(event: DirectorAuditEvent): string {
  const agents = extractAgents(event);
  const consilium = /consilium:\s*(true|да)/i.test(event.message);
  return (
    color.bold('📋 План: ') +
    `подключены агенты [${agents.join(', ')}], ` +
    `Консилиум: ${consilium ? 'да' : 'нет'}`
  );
}

/**
 * «⚙️ strategist → ok (12ms)»
 */
export function formatAgentResultLine(event: DirectorAuditEvent): string {
  const match = /Результат от\s+([a-z-]+):\s*(\w+)/i.exec(event.message);
  const role = match?.[1] ?? 'агент';
  const ok = (match?.[2] ?? 'error').toLowerCase() === 'ok';
  const durationMs =
    typeof event.metadata?.durationMs === 'number'
      ? Math.round(event.metadata.durationMs)
      : 0;
  const icon = ok ? '⚙️' : '⛔';
  return `${icon} ${role} → ${ok ? 'ok' : 'error'} (${durationMs}ms)`;
}

/**
 * Синтез Director.
 * «🧠 Синтез Director: ...» (message уже усечён до 150 символов продюсером).
 */
export function formatSynthesisLine(event: DirectorAuditEvent): string {
  return `🧠 Синтез Director: ${event.message}`;
}

/**
 * Результат File/Terminal операции.
 * «✅ Файл записан: src/test.txt» / «⛔ Операция отклонена: ...» /
 * «⚠️ Требуется подтверждение: ...».
 */
export interface FileTerminalActionResultInput {
  role: 'file' | 'terminal';
  success: boolean;
  /** Человекочитаемая сводка (summary агента / payload) */
  summary?: string;
  /** Детали payload (может содержать verdict SecurityAgent) */
  detail?: Record<string, unknown>;
}

export function formatFileTerminalAction(
  input: FileTerminalActionResultInput,
): string {
  const verdict =
    typeof input.detail?.verdict === 'string' ? input.detail.verdict : null;
  let icon = '✅';
  if (verdict === 'deny') {
    icon = '⛔';
  } else if (verdict === 'require-confirmation') {
    icon = '⚠️';
  } else if (!input.success) {
    icon = '❌';
  }

  const fallback =
    input.role === 'file'
      ? 'Файловая операция выполнена'
      : 'Терминальная операция выполнена';
  const text =
    input.summary && input.summary.trim() !== ''
      ? input.summary.trim()
      : fallback;
  return `${icon} ${text}`;
}

// ──────────────────────────────────────────────
// 4. Консилиум
// ──────────────────────────────────────────────

/**
 * Отформатировать многораундовый Консилиум:
 * по каждому раунду — номер, тип, позиции ролей, смены позиций (→),
 * затем итог: finalRecommendation.action, directorConfidence, directorReasoning.
 */
export function formatConsiliumRounds(
  consilium: MultiRoundConsiliumOutput,
): string {
  const lines: string[] = [];
  lines.push(
    color.bold(
      `🏛 Консилиум · ${consilium.rounds.length} раунд(а/ов) обсуждения`,
    ),
  );

  for (const round of consilium.rounds) {
    lines.push(
      color.cyan(`── Раунд ${round.roundNumber} · ${round.roundType} ──`),
    );
    for (const opinion of round.agentOpinions) {
      lines.push(
        `  ${color.bold(roleLabel(opinion.role))}: ` +
          `${color.yellow(actionLabel(opinion.action))} — ${opinion.position}`,
      );
      if (opinion.arguments.length > 0) {
        lines.push(
          color.dim(
            `    аргументы: ${opinion.arguments.slice(0, 3).join('; ')}`,
          ),
        );
      }
      if (opinion.counterArguments && opinion.counterArguments.length > 0) {
        lines.push(
          color.dim(
            `    контраргументы: ${opinion.counterArguments.slice(0, 2).join('; ')}`,
          ),
        );
      }
    }
    if (round.positionChanges.length > 0) {
      lines.push(color.magenta('  Смена позиций:'));
      for (const change of round.positionChanges) {
        lines.push(
          `    ↪ ${roleLabel(change.role)}: ` +
            `${color.red(actionLabel(change.previousAction))} → ` +
            `${color.green(actionLabel(change.newAction))}` +
            (change.reason ? ` — ${change.reason}` : ''),
        );
      }
    }
  }

  lines.push(
    color.bold(
      `Итог: ${actionLabel(consilium.finalRecommendation.action)} ` +
        `(уверенность ${Math.round(consilium.directorConfidence * 100)}%)`,
    ),
  );
  lines.push(`Обоснование Director: ${consilium.directorReasoning ?? '—'}`);
  if (consilium.finalRecommendation.reasoning) {
    lines.push(
      color.dim(`Рекомендация: ${consilium.finalRecommendation.reasoning}`),
    );
  }
  return lines.join('\n');
}

// ──────────────────────────────────────────────
// 5. Диспетчер событий (для live-стриминга)
// ──────────────────────────────────────────────

/** Количество мнений из metadata события созыва консилиума */
function consiliumOpinionsCount(event: DirectorAuditEvent): number | null {
  const count = event.metadata?.opinions;
  return typeof count === 'number' ? count : null;
}

/**
 * Отформатировать любое событие аудита в одну строку.
 * Используется подписчиком onEvent для живого вывода.
 */
export function formatAuditEventLine(event: DirectorAuditEvent): string {
  switch (event.type) {
    case 'director.question_received':
      return color.dim(`💬 Вопрос: ${event.message}`);
    case 'director.question_interpreted':
      return color.dim(`🧭 Интерпретация: ${event.message}`);
    case 'director.plan_created':
      return formatPlanLine(event);
    case 'director.task_delegated':
      return `📤 ${event.message}`;
    case 'director.agent_result_received':
      return formatAgentResultLine(event);
    case 'director.consilium_started': {
      const count = consiliumOpinionsCount(event);
      return color.bold(
        `🏛 Консилиум начат${count !== null ? ` (мнений: ${count})` : ''}`,
      );
    }
    case 'director.consilium_round_completed':
      return `🔁 ${event.message}`;
    case 'director.consilium_completed':
      return color.bold(`🏛 ${event.message}`);
    case 'director.synthesis_created':
      return formatSynthesisLine(event);
    case 'director.recommendation_formed':
      return `🎯 Рекомендация: ${event.message}`;
    case 'director.memory_saved':
      return `💾 ${event.message}`;
    case 'director.proactive_message_sent':
      return `🔔 ${event.message}`;
    case 'director.chat_message_sent':
      return `💬 ${event.message}`;
    default:
      return `${event.type}: ${event.message}`;
  }
}

// ──────────────────────────────────────────────
// 6. Баннер / справка
// ──────────────────────────────────────────────

/** Список доступных команд чата (для printBanner и /help) */
export function buildBannerText(): string {
  const lines: string[] = [];
  lines.push(color.bold('🤖 Финансовый Директор — интерактивный чат'));
  lines.push('Вы наблюдаете работу агентов в реальном времени:');
  lines.push('  план делегирования → мнения агентов → Консилиум → синтез.');
  lines.push('');
  lines.push('Команды:');
  lines.push('  ' + color.cyan('/help') + '    — эта справка');
  lines.push('  ' + color.cyan('/status') + '  — состояние Директора и память');
  lines.push(
    '  ' +
      color.cyan('/log N') +
      '   — последние N событий аудита (по умолчанию 10)',
  );
  lines.push('  ' + color.cyan('/panel') + '   — текстовая панель агентов');
  lines.push('  ' + color.cyan('/quit') + '    — выход из чата');
  lines.push('');
  lines.push('Любой другой ввод — вопрос Директору (например:');
  lines.push('  «Оцени стратегию портфеля», «Создай файл src/test.txt»).');
  return lines.join('\n');
}

/** Напечатать баннер в stdout (плюс перевод строки) */
export function printBanner(): void {
  console.log(buildBannerText());
  console.log('');
}
