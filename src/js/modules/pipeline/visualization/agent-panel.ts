/**
 * Agent Panel — рендер панели управления агентами в HTML без внешних библиотек.
 *
 * Работает и в Node, и в браузере:
 * - `renderAgentPanel(state)` — чистая функция, возвращает строку HTML
 *   (может дополнительно смонтировать результат в контейнер через innerHTML,
 *   если контейнер передан и доступен document);
 * - `agentPanelStyles()` — минимальные стили одной строкой (как directorChatStyles);
 * - `escapeHtml` — обязательное экранирование всех динамических значений (XSS-safe).
 *
 * Модуль не выполняет никаких обращений к DOM на этапе импорта.
 */

import type {
  AgentCard,
  AgentPanelState,
  ChainStep,
  ChainView,
  HistoryEntryView,
} from './agent-panel-model.js';
import { HISTORY_VIEW_LIMIT } from './agent-panel-model.js';

// ──────────────────────────────────────────────
// 1. Escaping (XSS-safe)
// ──────────────────────────────────────────────

/**
 * Экранировать значение для безопасного встраивания в HTML.
 *
 * ВАЖНО: сущности записаны через hex-escape амперсанда (`\x26` = '&'),
 * чтобы при записи файла они не были декодированы в обычные символы —
 * иначе функция стала бы тождественной и XSS-защита исчезла бы.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '\x26amp;')
    .replace(/</g, '\x26lt;')
    .replace(/>/g, '\x26gt;')
    .replace(/"/g, '\x26quot;')
    .replace(/'/g, '\x26#39;');
}

// ──────────────────────────────────────────────
// 2. Форматирование
// ──────────────────────────────────────────────

/** Человекочитаемая длительность */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return Math.round(ms) + ' мс';
  return (ms / 1000).toFixed(1) + ' с';
}

/** Человекочитаемые подписи статусов (карточки и история) */
const STATUS_LABELS: Record<string, string> = {
  idle: 'ожидание',
  running: 'выполняется',
  error: 'ошибка',
  stopped: 'остановлен',
  unknown: 'неизвестно',
  success: 'успех',
  failed: 'ошибка',
  blocked: 'заблокировано',
};

/** CSS-класс бейджа статуса */
function badgeClass(status: string): string {
  return 'ap-badge ap-badge-' + status;
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function shortRunId(runId: string): string {
  return runId.length > 24 ? runId.slice(0, 24) + '…' : runId;
}

// ──────────────────────────────────────────────
// 3. Рендер
// ──────────────────────────────────────────────

/** Опции рендера */
export interface RenderAgentPanelOptions {
  /** Контейнер для монтирования (innerHTML). Опционально — для браузера */
  container?: HTMLElement | null;
}

/**
 * Построить HTML панели управления агентами.
 * Возвращает строку всегда (работает в Node); если передан container и
 * доступен document — монтирует результат в контейнер.
 */
export function renderAgentPanel(
  state: AgentPanelState,
  options: RenderAgentPanelOptions = {},
): string {
  const html = buildPanelHtml(state);
  const container = options.container;
  if (container && typeof document !== 'undefined') {
    container.innerHTML = html;
  }
  return html;
}

function buildPanelHtml(state: AgentPanelState): string {
  const parts: string[] = [];
  parts.push('<div class="ap-panel">');
  parts.push(buildHeader(state));
  parts.push(buildAgentsSection(state));
  parts.push(buildChainsSection(state));
  parts.push(buildHistorySection(state));
  parts.push('</div>');
  return parts.join('\n');
}

function buildHeader(state: AgentPanelState): string {
  const label =
    state.overall === 'ok'
      ? 'ОК'
      : state.overall === 'warnings'
        ? 'Есть предупреждения'
        : 'Критическое состояние';
  return (
    '<div class="ap-header">' +
    '<span class="ap-title">🎛 Панель управления агентами</span>' +
    '<span class="ap-overall ap-overall-' +
    state.overall +
    '">' +
    escapeHtml(label) +
    '</span>' +
    '</div>'
  );
}

// ── Карточки агентов ──

function buildAgentsSection(state: AgentPanelState): string {
  const parts: string[] = ['<section class="ap-section ap-agents">'];
  parts.push('<h4 class="ap-section-title">🤖 Агенты</h4>');
  if (!state.available.agents || state.agents.length === 0) {
    parts.push(
      '<div class="ap-empty">Данные об агентах недоступны — источник не подключён.</div>',
    );
  } else {
    for (const card of state.agents) {
      parts.push(buildCard(card));
    }
  }
  parts.push('</section>');
  return parts.join('\n');
}

function buildCard(card: AgentCard): string {
  const parts: string[] = [];
  parts.push(
    '<div class="ap-card">' +
      '<div class="ap-card-head">' +
      '<span class="ap-card-name">' +
      escapeHtml(card.name) +
      '</span>' +
      '<span class="' +
      badgeClass(card.status) +
      '">' +
      escapeHtml(statusLabel(card.status)) +
      '</span>' +
      '</div>',
  );
  parts.push(
    '<div class="ap-card-stats">Выполнено: ' +
      String(card.totalExecutions) +
      ' · Успех: ' +
      String(card.successes) +
      ' · Ошибки: ' +
      String(card.failures) +
      '</div>',
  );
  if (card.lastDurationMs !== undefined) {
    parts.push(
      '<div class="ap-card-last">⏱ Последнее: ' +
        escapeHtml(formatDuration(card.lastDurationMs)) +
        '</div>',
    );
  }
  if (card.lastError) {
    parts.push(
      '<div class="ap-card-error">⚠ ' +
        escapeHtml(truncate(card.lastError, 120)) +
        '</div>',
    );
  }
  parts.push('</div>');
  return parts.join('\n');
}

// ── Цепочки выполнения ──

function buildChainsSection(state: AgentPanelState): string {
  const parts: string[] = ['<section class="ap-section ap-chains">'];
  parts.push('<h4 class="ap-section-title">🔗 Цепочки выполнения</h4>');
  if (!state.available.history || state.chains.length === 0) {
    parts.push(
      '<div class="ap-empty">Цепочки недоступны — HistoryAgent не подключён.</div>',
    );
  } else {
    for (const chain of state.chains) {
      parts.push(buildChain(chain));
    }
  }
  parts.push('</section>');
  return parts.join('\n');
}

function buildChain(chain: ChainView): string {
  const outcome =
    chain.success === undefined ? '' : chain.success ? ' ✅' : ' ❌';
  const head =
    '<div class="ap-chain-head">Цепочка ' +
    escapeHtml(shortRunId(chain.runId)) +
    (chain.startedAt ? ' · ' + escapeHtml(chain.startedAt) : '') +
    '<span class="ap-chain-outcome">' +
    escapeHtml(outcome) +
    '</span></div>';

  const stepsHtml = chain.steps
    .map((step, index) =>
      buildStep(step, index, index === chain.steps.length - 1),
    )
    .join('\n');

  return (
    '<div class="ap-chain">' +
    head +
    '<ol class="ap-chain-steps">' +
    stepsHtml +
    '</ol></div>'
  );
}

/** Шаг цепочки: индекс + агент + действие + статус; последний шаг подсвечен */
function buildStep(step: ChainStep, index: number, isLast: boolean): string {
  const cls =
    'ap-step ap-step-' + step.status + (isLast ? ' ap-step-last' : '');
  return (
    '<li class="' +
    cls +
    '">' +
    '<span class="ap-step-index">' +
    String(index + 1) +
    '</span>' +
    '<span class="ap-step-body">' +
    '<span class="ap-step-agent">' +
    escapeHtml(step.agentName) +
    '</span>' +
    ' · ' +
    escapeHtml(step.action) +
    (step.durationMs !== undefined
      ? ' · ' + escapeHtml(formatDuration(step.durationMs))
      : '') +
    ' · <span class="ap-step-status">' +
    escapeHtml(statusLabel(step.status)) +
    '</span>' +
    '</span>' +
    '</li>'
  );
}

// ── История ──

function buildHistorySection(state: AgentPanelState): string {
  const parts: string[] = ['<section class="ap-section ap-history">'];
  parts.push(
    '<h4 class="ap-section-title">🕘 История действий (последние ' +
      String(HISTORY_VIEW_LIMIT) +
      ')</h4>',
  );
  if (!state.available.history || state.history.length === 0) {
    parts.push(
      '<div class="ap-empty">История недоступна — событий пока нет.</div>',
    );
  } else {
    parts.push(
      '<table class="ap-history-table"><thead><tr>' +
        '<th>Время</th><th>Агент</th><th>Действие</th><th>Статус</th>' +
        '</tr></thead><tbody>',
    );
    for (const entry of state.history) {
      parts.push(buildHistoryRow(entry));
    }
    parts.push('</tbody></table>');
  }
  parts.push('</section>');
  return parts.join('\n');
}

function buildHistoryRow(entry: HistoryEntryView): string {
  return (
    '<tr>' +
    '<td>' +
    escapeHtml(entry.createdAt) +
    '</td>' +
    '<td>' +
    escapeHtml(entry.agentName) +
    '</td>' +
    '<td>' +
    escapeHtml(entry.action) +
    '</td>' +
    '<td><span class="' +
    badgeClass(entry.status) +
    '">' +
    escapeHtml(statusLabel(entry.status)) +
    '</span></td>' +
    '</tr>'
  );
}

// ──────────────────────────────────────────────
// 4. Стили
// ──────────────────────────────────────────────

/** Минимальные стили панели (строка — как directorChatStyles) */
export function agentPanelStyles(): string {
  return (
    '.ap-panel{display:flex;flex-direction:column;gap:12px;border:1px solid #333;' +
    'border-radius:10px;padding:14px;background:#1e1e2e;color:#eee;max-width:760px;' +
    'font-family:system-ui,sans-serif;font-size:13px;}' +
    '.ap-header{display:flex;justify-content:space-between;align-items:center;' +
    'font-weight:700;font-size:15px;}' +
    '.ap-overall{padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;}' +
    '.ap-overall-ok{background:#1c3a2a;color:#6cf08f;}' +
    '.ap-overall-warnings{background:#3d2f10;color:#ffd166;}' +
    '.ap-overall-critical{background:#4a1620;color:#ff8a9a;}' +
    '.ap-section{display:flex;flex-direction:column;gap:8px;}' +
    '.ap-section-title{margin:0;font-size:13px;color:#9aa0b4;text-transform:uppercase;}' +
    '.ap-empty{color:#888;font-style:italic;padding:6px 0;}' +
    '.ap-card{border:1px solid #333;border-radius:8px;padding:8px 10px;background:#242436;}' +
    '.ap-card-head{display:flex;justify-content:space-between;align-items:center;gap:8px;}' +
    '.ap-card-name{font-weight:600;}' +
    '.ap-card-stats{color:#b9bec9;margin-top:4px;}' +
    '.ap-card-last{color:#8fa1c9;margin-top:2px;font-size:12px;}' +
    '.ap-card-error{color:#ff8a9a;margin-top:2px;font-size:12px;}' +
    '.ap-badge{padding:1px 8px;border-radius:999px;font-size:11px;white-space:nowrap;}' +
    '.ap-badge-idle{background:#2a2a3c;color:#b9bec9;}' +
    '.ap-badge-running{background:#1c3a2a;color:#6cf08f;}' +
    '.ap-badge-error,.ap-badge-failed{background:#4a1620;color:#ff8a9a;}' +
    '.ap-badge-stopped{background:#333;color:#9aa0b4;}' +
    '.ap-badge-unknown{background:#3d2f10;color:#ffd166;}' +
    '.ap-badge-success{background:#1c3a2a;color:#6cf08f;}' +
    '.ap-badge-blocked{background:#3d2f10;color:#ffd166;}' +
    '.ap-chain{border:1px solid #333;border-radius:8px;padding:8px 10px;background:#242436;}' +
    '.ap-chain-head{font-size:12px;color:#9aa0b4;margin-bottom:6px;}' +
    '.ap-chain-outcome{font-weight:700;}' +
    '.ap-chain-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;}' +
    '.ap-step{display:flex;gap:8px;align-items:baseline;padding:3px 0;position:relative;' +
    'border-left:2px solid #333;padding-left:10px;margin-left:6px;}' +
    '.ap-step:not(:last-child)::after{content:"↓";position:absolute;left:-7px;bottom:-8px;' +
    'color:#555;font-size:10px;}' +
    '.ap-step-last{border-left-color:#ffd166;}' +
    '.ap-step-index{color:#888;font-size:11px;min-width:14px;}' +
    '.ap-step-body{color:#ddd;}' +
    '.ap-step-agent{font-weight:600;}' +
    '.ap-step-status{opacity:.8;}' +
    '.ap-history-table{width:100%;border-collapse:collapse;font-size:12px;}' +
    '.ap-history-table th,.ap-history-table td{border:1px solid #333;padding:4px 8px;' +
    'text-align:left;}' +
    '.ap-history-table th{background:#242436;color:#9aa0b4;}' +
    '.ap-history-table td{color:#ddd;word-break:break-word;}'
  );
}
