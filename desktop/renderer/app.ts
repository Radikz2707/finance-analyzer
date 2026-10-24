/**
 * Renderer App — логика UI десктоп-приложения.
 *
 * Работает через типизированный мост window.financeApp (preload/contextBridge).
 * Чистый DOM-рендер без внешних фреймворков. Форматирование событий —
 * переиспользует scripts/director-chat-render.ts (чистые функции, без Node).
 */

import type {
  AgentActivityEvent,
  AgentPanelState,
  AskResult,
  AutonomousIterationEvent,
  DirectorAuditEvent,
  FinanceDesktopApi,
  GoalSummary,
  HarnessDashboardPayload,
  LastAnalysisInfo,
} from '../api-types.js';
import {
  formatAuditEventLine,
  stripAnsi,
} from '../../scripts/director-chat-render.js';

// Заглушки — удалённые модули больше не используются
function formatActivityEvent(_event: unknown): string {
  return '[Activity Event] Заглушка';
}

type NewsImpact = { ticker: string; impact: number; sentiment: string };

declare global {
  interface Window {
    financeApp: FinanceDesktopApi;
  }
}

// ── Элементы DOM ─────────────────────────────────────────────

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Элемент не найден: ${selector}`);
  return el;
};

const messagesEl = $('#messages');
const activityEl = $('#activity');
const questionInput = $('#question-input') as HTMLInputElement;
const sendBtn = $('#send-btn') as HTMLButtonElement;
const settingsToggleBtn = $('#settings-toggle-btn') as HTMLButtonElement;
const settingsPanel = $('#settings-panel') as HTMLElement;
const settingsExcelPathEl = $('#settings-excel-path') as HTMLElement;
const activityClearBtn = $('#activity-clear');
const agentCardsEl = $('#agent-cards');
const agentChainsEl = $('#agent-chains');
const agentHistoryBody = $('#agent-history') as HTMLTableSectionElement;
const consoleListEl = $('#console-list');
const consoleSearch = $('#console-search') as HTMLInputElement;
const consoleAutoscroll = $('#console-autoscroll') as HTMLInputElement;
const consoleClearBtn = $('#console-clear');
const runAnalysisBtn = $('#run-analysis-btn') as HTMLButtonElement;
const dispatchStatusEl = $('#dispatch-status');
const anomaliesListEl = $('#anomalies-list');
const quikNewsEl = $('#quik-news');
const versionEl = $('#app-version');
const aiStatusEl = $('#ai-status') as HTMLSpanElement | null;
const analysisStatusEl = $('#analysis-status') as HTMLSpanElement | null;
const pickExcelBtn = $('#pick-excel-btn') as HTMLButtonElement;
const ollamaModelSelect = $('#ollama-model-select') as HTMLSelectElement;
const applyOllamaBtn = $('#apply-ollama-btn') as HTMLButtonElement;
const reconnectOllamaBtn = $(
  '#reconnect-ollama-btn',
) as HTMLButtonElement | null;
const exportReportBtn = $('#export-report-btn') as HTMLButtonElement;
const exportPdfBtn = $('#export-report-pdf-btn') as HTMLButtonElement;
const harnessRunNote = $('#harness-run-note');

// Вкладка «Анализ» (результат + экспорт)
const analysisFrameEl = $('#analysis-frame') as HTMLIFrameElement;
const analysisReportEl = $('#analysis-report');
const analysisMetaEl = $('#analysis-meta');
const analysisNote = $('#analysis-note');
const analysisTextEl = $('#analysis-text');
const analysisRunBtn = $('#analysis-run-btn') as HTMLButtonElement;
const openReportCheckbox = $(
  '#open-report-checkbox',
) as HTMLInputElement | null;
const analysisExportHtmlBtn = $(
  '#analysis-export-html-btn',
) as HTMLButtonElement;
const analysisExportPdfBtn = $('#analysis-export-pdf-btn') as HTMLButtonElement;

// Вкладка «Цели» (автономный цикл)
const goalsBody = $('#goals-body') as HTMLTableSectionElement;
const autonomousStatusEl = $('#autonomous-status');
const autonomousToggleBtn = $('#autonomous-toggle-btn') as HTMLButtonElement;
const autonomousRunBtn = $('#autonomous-run-btn') as HTMLButtonElement;
const goalInput = $('#goal-input') as HTMLInputElement;
const addGoalBtn = $('#add-goal-btn') as HTMLButtonElement;
const goalsNote = $('#goals-note');
let autonomousRunning = false;

const MAX_ACTIVITY_LINES = 400;
const MAX_CONSOLE_LINES = 1500;

// ── Утилиты ──────────────────────────────────────────────────

function nowTime(): string {
  // Локальное время пользователя (не UTC)
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Локальное время из ISO-метки (для «Последнего запуска» диспетчера) */
function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Длительность прогона в формате MM:SS */
function formatElapsed(startedAtMs: number): string {
  const total = Math.max(
    0,
    Math.round((performance.now() - startedAtMs) / 1000),
  );
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function makeEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function scrollToBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
}

// ── Сообщения чата ───────────────────────────────────────────

function appendMessage(
  text: string,
  kind: 'user' | 'director' | 'system' | 'error',
): void {
  const msg = makeEl('div', `msg ${kind}`);
  msg.textContent = text;
  const time = makeEl('span', 'msg-time', nowTime());
  msg.appendChild(time);
  messagesEl.appendChild(msg);
  while (messagesEl.childElementCount > 200) {
    messagesEl.removeChild(messagesEl.firstChild as Node);
  }
  scrollToBottom(messagesEl);
}

// ── Лента активности ─────────────────────────────────────────

function appendActivityLine(
  text: string,
  cssClass: string,
  eventType?: string,
): void {
  const line = makeEl('div', `ev ${cssClass}`);
  const time = makeEl('span', 'ev-time', nowTime());
  line.appendChild(time);
  line.appendChild(document.createTextNode(text));
  if (eventType) line.setAttribute('data-type', eventType);
  activityEl.appendChild(line);
  while (activityEl.childElementCount > MAX_ACTIVITY_LINES) {
    activityEl.removeChild(activityEl.firstChild as Node);
  }
  scrollToBottom(activityEl);
}

function activityCssClass(event: DirectorAuditEvent): string {
  switch (event.type) {
    case 'director.plan_created':
      return 'type-plan';
    case 'director.consilium_started':
    case 'director.consilium_round_completed':
    case 'director.consilium_completed':
      return 'type-consilium';
    case 'director.agent_result_received':
    case 'director.task_delegated':
      return 'type-agent';
    case 'director.recommendation_formed':
      return 'type-error';
    default:
      return '';
  }
}

function onDirectorEvent(event: DirectorAuditEvent): void {
  const text = stripAnsi(formatAuditEventLine(event));
  appendActivityLine(text, activityCssClass(event), event.type);
  appendConsoleLine(event);
}

// ── Живые шаги агентов ───────────────────────────────────────

/** Троттлинг обновления вкладки «Агенты» (не чаще раза в секунду) */
let lastAgentsRefreshAt = 0;

function scheduleAgentsRefresh(): void {
  const now = performance.now();
  if (now - lastAgentsRefreshAt < 1000) return;
  lastAgentsRefreshAt = now;
  void refreshAux();
}

/**
 * Живой шаг агента: показываем в чате блок «🤖 Агенты работают: …»
 * и в ленте активности; вкладка «Агенты» обновляется с троттлингом.
 */
function onDirectorActivity(event: AgentActivityEvent): void {
  const text = formatActivityEvent(event);
  appendMessage(`🤖 Агенты работают: ${text}`, 'system');
  appendActivityLine(text, 'type-agent', `activity.${event.phase}`);
  scheduleAgentsRefresh();
}

// ── Консоль ──────────────────────────────────────────────────

function appendConsoleLine(event: DirectorAuditEvent): void {
  const line = makeEl('div', 'line');
  line.appendChild(makeEl('span', 't', event.timestamp.slice(11, 23)));
  line.appendChild(makeEl('span', 'type', event.type));
  line.appendChild(makeEl('span', 'msg', stripAnsi(event.message)));
  line.setAttribute(
    'data-search',
    `${event.type} ${event.message}`.toLowerCase(),
  );
  if (consoleSearch.value.trim() !== '') {
    applyConsoleFilter();
  }
  consoleListEl.appendChild(line);
  while (consoleListEl.childElementCount > MAX_CONSOLE_LINES) {
    consoleListEl.removeChild(consoleListEl.firstChild as Node);
  }
  if (consoleAutoscroll.checked) {
    scrollToBottom(consoleListEl);
  }
}

function applyConsoleFilter(): void {
  const needle = consoleSearch.value.trim().toLowerCase();
  for (const line of Array.from(consoleListEl.children)) {
    const haystack = (line as HTMLElement).getAttribute('data-search') ?? '';
    (line as HTMLElement).classList.toggle(
      'hidden',
      needle !== '' && !haystack.includes(needle),
    );
  }
}

function fillConsole(entries: readonly DirectorAuditEvent[]): void {
  consoleListEl.textContent = '';
  for (const entry of entries) {
    appendConsoleLine(entry);
  }
}

// ── Вкладка «Агенты» ─────────────────────────────────────────

function renderPanel(panel: AgentPanelState | null): void {
  agentCardsEl.textContent = '';
  agentChainsEl.textContent = '';
  agentHistoryBody.textContent = '';

  if (!panel) {
    agentCardsEl.appendChild(
      makeEl('div', 'empty-note', 'Панель агентов недоступна'),
    );
    return;
  }

  if (panel.agents.length === 0) {
    agentCardsEl.appendChild(
      makeEl('div', 'empty-note', 'Action-агенты не подключены'),
    );
  }
  for (const card of panel.agents) {
    const node = makeEl('div', 'agent-card');
    const row1 = makeEl('div', 'row1');
    row1.appendChild(makeEl('span', 'name', card.name));
    row1.appendChild(makeEl('span', `badge ${card.status}`, card.status));
    node.appendChild(row1);

    const counters = makeEl('div', 'counters');
    counters.appendChild(
      makeEl('span', '', `выполнений: ${card.totalExecutions}`),
    );
    counters.appendChild(makeEl('span', '', `успешно: ${card.successes}`));
    counters.appendChild(makeEl('span', '', `ошибок: ${card.failures}`));
    if (card.lastDurationMs !== undefined) {
      counters.appendChild(
        makeEl('span', '', `последнее: ${card.lastDurationMs} мс`),
      );
    }
    node.appendChild(counters);

    if (card.lastError) {
      node.appendChild(makeEl('div', 'last-error', `⚠ ${card.lastError}`));
    }
    agentCardsEl.appendChild(node);
  }

  if (panel.chains.length === 0) {
    agentChainsEl.appendChild(makeEl('div', 'empty-note', 'Цепочек пока нет'));
  }
  for (const chain of panel.chains) {
    const node = makeEl('div', 'chain');
    const head = makeEl('div', 'chain-head');
    head.appendChild(makeEl('span', '', `run ${chain.runId}`));
    head.appendChild(
      makeEl(
        'span',
        '',
        chain.success === true
          ? '✓ успех'
          : chain.success === false
            ? '✗ провал'
            : '?',
      ),
    );
    node.appendChild(head);
    for (const step of chain.steps) {
      const cls =
        step.status === 'success'
          ? 'step-ok'
          : step.status === 'failed'
            ? 'step-failed'
            : step.status === 'blocked'
              ? 'step-blocked'
              : '';
      node.appendChild(
        makeEl('div', `step ${cls}`, `· ${step.agentName}: ${step.action}`),
      );
    }
    agentChainsEl.appendChild(node);
  }

  if (panel.history.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'empty-note';
    cell.textContent = 'Истории действий пока нет';
    row.appendChild(cell);
    agentHistoryBody.appendChild(row);
  }
  for (const entry of panel.history) {
    const row = document.createElement('tr');
    row.appendChild(makeEl('td', '', entry.createdAt.slice(11, 19)));
    row.appendChild(makeEl('td', '', entry.agentName));
    row.appendChild(makeEl('td', '', entry.action));
    row.appendChild(makeEl('td', '', entry.status));
    agentHistoryBody.appendChild(row);
  }
}

// ── Вкладка «Диспетчер» ──────────────────────────────────────

function statCell(label: string, value: string, valueClass = ''): HTMLElement {
  const cell = makeEl('div', 'stat-cell');
  cell.appendChild(makeEl('div', 'label', label));
  cell.appendChild(makeEl('div', `value ${valueClass}`, value));
  return cell;
}

function renderHarness(payload: HarnessDashboardPayload | null): void {
  dispatchStatusEl.textContent = '';
  if (!payload) {
    dispatchStatusEl.appendChild(
      makeEl(
        'div',
        'empty-note',
        'Гибридный диспетчер не активирован (нет конфигурации)',
      ),
    );
    anomaliesListEl.textContent = '';
    quikNewsEl.textContent = '';
    runAnalysisBtn.disabled = true;
    return;
  }

  const sched = payload.scheduler;
  if (sched) {
    dispatchStatusEl.appendChild(
      statCell('Режим', sched.mode, `mode-${sched.mode}`),
    );
    dispatchStatusEl.appendChild(
      statCell(
        'Последний запуск',
        sched.lastRunAt ? formatLocalTime(sched.lastRunAt) : '—',
      ),
    );
    dispatchStatusEl.appendChild(
      statCell('CPU', `${sched.cpuUsagePct.toFixed(1)}%`),
    );
    dispatchStatusEl.appendChild(
      statCell('RAM', `${sched.memoryUsagePct.toFixed(1)}%`),
    );
    dispatchStatusEl.appendChild(
      statCell('Пропущено циклов', String(sched.skippedCycles)),
    );
  } else {
    dispatchStatusEl.appendChild(
      makeEl('div', 'empty-note', 'Диспетчер не зарегистрирован'),
    );
  }

  anomaliesListEl.textContent = '';
  if (payload.anomalies.length === 0) {
    anomaliesListEl.appendChild(
      makeEl('div', 'empty-note', 'Аномалий нет (или данные недоступны)'),
    );
  }
  for (const a of payload.anomalies) {
    const item = makeEl('div', 'anomaly-item');
    const head = makeEl('div', '');
    head.appendChild(makeEl('span', 'ticker', a.ticker));
    head.appendChild(
      document.createTextNode(` · z=${a.zScoreLast.toFixed(2)} · риск `),
    );
    head.appendChild(makeEl('span', `risk-${a.riskLevel}`, a.riskLevel));
    item.appendChild(head);
    item.appendChild(
      makeEl(
        'div',
        '',
        `волатильность: ${a.volatilityAnnual.toFixed(1)}% годовых`,
      ),
    );
    anomaliesListEl.appendChild(item);
  }

  quikNewsEl.textContent = '';
  if (payload.quikNews.length === 0) {
    quikNewsEl.appendChild(makeEl('div', 'empty-note', 'Новостей QUIK нет'));
  }
  for (const n of payload.quikNews.slice(0, 10)) {
    const item = makeEl('div', 'news-item');
    item.appendChild(makeEl('div', 'news-time', `${n.time} · ${n.sourceName}`));
    item.appendChild(makeEl('div', 'news-text', n.text));
    quikNewsEl.appendChild(item);
  }
}

// ── Toast-уведомления ────────────────────────────────────────

function showToast(message: string, type: 'ok' | 'error'): void {
  // Стили toast — в styles.scss (.toast): карточка в теме приложения
  // с акцентной полосой слева (зелёная ok / красная error).
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.appendChild(toast);

  const dismiss = (): void => {
    clearTimeout(timer);
    toast.style.animation = 'toast-out 0.2s ease forwards';
    setTimeout(() => toast.remove(), 200);
  };
  const timer = window.setTimeout(dismiss, 5000);
  // Клик по уведомлению закрывает его
  toast.addEventListener('click', dismiss);
}

// ── Статус-бар ───────────────────────────────────────────────

function renderStatusBar(sourceLabel: string, hasData: boolean): void {
  // Источник данных теперь в панели настроек (не занимает шапку)
  // Показываем путь, если он не пустой и не "нет данных"
  const label = (sourceLabel && sourceLabel !== 'нет данных') ? sourceLabel : 'нет данных';
  settingsExcelPathEl.textContent = label;
  settingsExcelPathEl.title = sourceLabel;
}

// ── Индикатор статуса AI ──────────────────────────────────────

function renderAiStatus(aiLabel: string): void {
  if (!aiStatusEl) return;

  const isOllama = aiLabel.includes('Ollama');
  const isOff = aiLabel.includes('aiMode=off');

  aiStatusEl.textContent = isOff
    ? '⚠ AI отключён'
    : isOllama
      ? '● Ollama ✓'
      : '● Детермин. режим';

  aiStatusEl.className = isOff
    ? 'ai-status warning'
    : isOllama
      ? 'ai-status ok'
      : 'ai-status fallback';
}

// ── Индикатор статуса анализа портфеля ────────────────────────

function renderAnalysisStatus(status: string): void {
  if (!analysisStatusEl) return;

  switch (status) {
    case 'ready':
      analysisStatusEl.textContent = '✅ Анализ готов';
      analysisStatusEl.className = 'analysis-status ready';
      break;
    case 'in_progress':
      analysisStatusEl.textContent = '⏳ Анализ запущен...';
      analysisStatusEl.className = 'analysis-status in_progress';
      break;
    case 'pending':
      analysisStatusEl.textContent = '⏳ Анализ не запущен';
      analysisStatusEl.className = 'analysis-status pending';
      break;
    default:
      analysisStatusEl.textContent = '⚠ Нет данных';
      analysisStatusEl.className = 'analysis-status';
  }
}

const ANALYSIS_RUN_LABEL = '▶ Запустить анализ';

/**
 * Синхронизировать кнопку запуска и заметку на вкладке «Анализ» с реальным
 * статусом: во время прогона кнопка «⏳ Идёт анализ…» и заблокирована,
 * иначе — обычная надпись и разблокирована. Вызывается при возврате
 * на вкладку и после завершения прогона, чтобы UI не «залипал».
 */
function syncAnalysisRunUi(status: string): void {
  if (!analysisRunBtn) return;
  const running = status === 'in_progress';
  analysisRunBtn.disabled = running;
  analysisRunBtn.textContent = running ? '⏳ Идёт анализ…' : ANALYSIS_RUN_LABEL;
  if (running && !analysisNote.classList.contains('ok')) {
    analysisNote.textContent =
      '⏳ Полный конвейер: данные → исследование → AI-анализ ' +
      '(на CPU может занять несколько минут)…';
    analysisNote.className = 'harness-run-note progress';
  }
}

/**
 * Обновить индикатор анализа в шапке с сервера. Статус сводный:
 * полный конвейер (in_progress/ready по report.html) + статус Директора.
 */
async function refreshAnalysisStatus(): Promise<void> {
  try {
    const info = await window.financeApp.getAnalysisStatus();
    const status = info?.status ?? 'pending';
    renderAnalysisStatus(status);
    syncAnalysisRunUi(status);
  } catch {
    // Индикатор некритичен — при сбое оставляем как есть
  }
}

// ── Новостной блок (NewsDriver) ──────────────────────────────

/** Обработка обратной связи по AI-рекомендациям из iframe */
window.addEventListener('message', async (event) => {
  if (
    event.data &&
    event.data.type === 'recommendation:feedback' &&
    event.data.ticker &&
    event.data.feedback
  ) {
    try {
      const result = await window.financeApp.sendRecommendationFeedback(
        event.data.ticker,
        event.data.feedback,
      );
      if (result.ok) {
        showToast(result.message, 'ok');
      }
    } catch (err) {
      console.error('[Renderer] Ошибка отправки обратной связи:', err);
    }
  }
});

/**
 * Новостной блок во вкладке «Чат»: impact'ы NewsDriver по тикерам
 * портфеля (сентимент, важность, влияние, источники). Показывается
 * после ответа Director как отдельное system-сообщение.
 */
function appendNewsBlock(impacts: NewsImpact[]): void {
  const lines: string[] = ['📰 Новостной фон по портфелю:'];
  if (impacts.length === 0) {
    lines.push(
      'Новостей по тикерам портфеля пока нет — подключите источник ' +
        'новостей (пайплайн/gatekeeper), и я учту их в оценке.',
    );
    appendMessage(lines.join('\n'), 'system');
    return;
  }
  for (const impact of impacts) {
    const direction =
      impact.impactDirection === 'positive'
        ? '📈'
        : impact.impactDirection === 'negative'
          ? '📉'
          : '➡️';
    lines.push(
      `${direction} ${impact.ticker}: ${impact.impactDirection} ` +
        `(сентимент ${impact.sentimentScore.toFixed(2)}, важность «${impact.importance}», ` +
        `score ${impact.impactScore.toFixed(2)})`,
    );
    if (impact.affectedMetrics.length > 0) {
      lines.push(`   Затронуто: ${impact.affectedMetrics.join(', ')}.`);
    }
    if (impact.suggestedAction) {
      lines.push(`   Учитываю как: ${impact.suggestedAction}.`);
    }
    for (const headline of impact.headlines.slice(0, 2)) {
      lines.push(`   • ${headline}`);
    }
  }
  appendMessage(lines.join('\n'), 'system');
}

// ── Запрос к Директору ───────────────────────────────────────

async function ask(question: string): Promise<void> {
  const q = question.trim();
  if (q === '') return;

  appendMessage(q, 'user');
  questionInput.value = '';
  sendBtn.disabled = true;
  try {
    await window.financeApp.ask(q);
    // Ответ приходит потоком через onDirectorReply
  } catch (err) {
    appendMessage(
      `Ошибка: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
  } finally {
    sendBtn.disabled = false;
    questionInput.focus();
  }
}

function onDirectorReply(result: AskResult): void {
  appendMessage(result.text, 'director');
  if (result.news) {
    appendNewsBlock(result.news);
  }
  if (result.consiliumText) {
    const block = makeEl('div', 'consilium-block', result.consiliumText);
    activityEl.appendChild(block);
    scrollToBottom(activityEl);
  }
  appendActivityLine(
    `⏱ Ответ Director за ${result.elapsedMs} мс (событий: ${result.events.length})`,
    'type-plan',
  );
  // Обновляем индикатор статуса AI после каждого ответа
  void refreshAux();
}

// ── Обновление второстепенных панелей ────────────────────────

async function refreshAux(): Promise<void> {
  try {
    const [status, panel, log] = await Promise.all([
      window.financeApp.getStatus(),
      window.financeApp.getPanel(),
      window.financeApp.getLog(120),
    ]);
    if (status) {
      renderStatusBar(
        status.sourceLabel,
        !status.sourceLabel.includes('нет данных'),
      );
      // Обновляем индикатор статуса AI
      renderAiStatus(status.aiLabel);
      // Обновляем индикатор статуса анализа
      void window.financeApp.getAnalysisStatus().then((analysisStatus) => {
        renderAnalysisStatus(analysisStatus?.status ?? 'pending');
      });
    }
    renderPanel(panel);
    fillConsole(log.entries);
  } catch {
    // Без паники: панели обновятся при следующем событии
  }
}

async function refreshHarness(): Promise<void> {
  const payload = await window.financeApp.getHarnessPayload();
  renderHarness(payload);
}

// ── Вкладка «Цели»: рендер и действия ────────────────────────

const GOAL_STATUS_MARKS: Record<string, string> = {
  pending: '⏳',
  active: '▶',
  paused: '⏸',
  completed: '✅',
  cancelled: '✖',
};

function renderGoals(goals: readonly GoalSummary[]): void {
  goalsBody.innerHTML = '';
  if (goals.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent =
      'Целей нет — добавьте первую на этой вкладке или командой /goal в чате.';
    row.appendChild(cell);
    goalsBody.appendChild(row);
    return;
  }
  for (const goal of goals) {
    const row = document.createElement('tr');
    const statusCell = document.createElement('td');
    statusCell.textContent = `${GOAL_STATUS_MARKS[goal.status] ?? '•'} ${goal.status}`;
    const priorityCell = document.createElement('td');
    priorityCell.textContent = goal.priority;
    const nameCell = document.createElement('td');
    nameCell.textContent = goal.name;
    nameCell.title = goal.description;
    const updatedCell = document.createElement('td');
    updatedCell.textContent = goal.createdAt
      ? formatLocalTime(goal.createdAt)
      : '—';
    row.append(statusCell, priorityCell, nameCell, updatedCell);
    goalsBody.appendChild(row);
  }
}

/** Обновить статус цикла и список целей (IPC → main → AutonomousBridge) */
async function refreshAutonomous(): Promise<void> {
  try {
    const [status, goals] = await Promise.all([
      window.financeApp.autonomousStatus(),
      window.financeApp.goalsList(),
    ]);
    if (status) {
      autonomousRunning = status.running;
      autonomousStatusEl.textContent = status.running
        ? `▶ цикл каждые ${status.intervalSec} с · активных целей: ${status.activeGoals} · итераций: ${status.loop.totalIterations}`
        : `⏹ выключен · активных целей: ${status.activeGoals} · итераций: ${status.loop.totalIterations}`;
      autonomousToggleBtn.textContent = status.running
        ? '⏹ Выключить'
        : '▶ Включить';
    } else {
      autonomousStatusEl.textContent = 'автономный цикл недоступен';
    }
    renderGoals(goals);
  } catch {
    autonomousStatusEl.textContent = 'автономный цикл недоступен';
  }
}

function showGoalsNote(text: string, ok: boolean): void {
  goalsNote.textContent = text;
  goalsNote.className = ok ? 'harness-run-note ok' : 'harness-run-note error';
}

// ── Вкладка «Анализ»: рендер, запуск, экспорт ────────────────

function showAnalysisNote(text: string, ok: boolean): void {
  analysisNote.textContent = text;
  analysisNote.className = ok
    ? 'harness-run-note ok'
    : 'harness-run-note error';
}

/** Загрузить последний анализ в pre + метаданные */
/** Экранирование HTML в данных отчёта */
function escapeHtmlReport(value: string): string {
  return value
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

/**
 * Богатый отчёт на вкладке «Анализ» (в стиле старого report.html):
 * карточки-показатели + таблица активов + ценовые алерты.
 * Текстовая сводка остаётся в analysis-text ниже.
 */
function renderAnalysisReport(info: LastAnalysisInfo): string {
  const fmtRub = (value: number): string =>
    `${Math.round(value).toLocaleString('ru-RU')} ₽`;
  const fmtPct = (value: number): string => `${value.toFixed(1)}%`;
  const assets = info.assets ?? [];
  const alerts = info.alerts ?? [];
  const totalPnl = assets.reduce(
    (sum, asset) => sum + (asset.unrealizedProfitRub ?? 0),
    0,
  );
  const maxDeviation = assets.reduce(
    (max, asset) =>
      Math.max(max, Math.abs(asset.currentPercent - asset.targetPercent)),
    0,
  );

  const cards = `
    <div class="analysis-cards">
      <div class="analysis-card"><div class="card-label">Стоимость портфеля</div><div class="card-value">${fmtRub(info.totalValue ?? 0)}</div></div>
      <div class="analysis-card"><div class="card-label">Нереализованный P&L</div><div class="card-value ${totalPnl < 0 ? 'neg' : 'pos'}">${fmtRub(totalPnl)}</div></div>
      <div class="analysis-card"><div class="card-label">Активов</div><div class="card-value">${assets.length}</div></div>
      <div class="analysis-card"><div class="card-label">Макс. отклонение</div><div class="card-value ${maxDeviation > 15 ? 'neg' : ''}">${fmtPct(maxDeviation)}</div></div>
    </div>`;

  const rows = assets
    .map((asset) => {
      const deviation = asset.currentPercent - asset.targetPercent;
      const pnl = asset.unrealizedProfitRub;
      const flags = asset.isConcentrated ? ['концентрация'] : [];
      const ticker = escapeHtmlReport(asset.ticker);
      const name = escapeHtmlReport(asset.name);
      const status = escapeHtmlReport(asset.status);
      const flagsHtml =
        flags.length > 0
          ? `<div class="muted">${escapeHtmlReport(flags.join(', '))}</div>`
          : '';
      const deviationHtml = `<span class="${deviation > 2 ? 'neg' : deviation < -2 ? 'pos' : ''}">${deviation > 0 ? '+' : ''}${deviation.toFixed(1)} п.п.</span>`;
      const pnlHtml =
        pnl === undefined
          ? '—'
          : `<span class="${pnl < 0 ? 'neg' : 'pos'}">${fmtRub(pnl)}</span>`;
      return `<tr${asset.isConcentrated ? ' class="warn"' : ''}><td><b>${ticker}</b><div class="muted">${name}</div></td><td class="num">${fmtPct(asset.currentPercent)}</td><td class="num">${fmtPct(asset.targetPercent)}</td><td class="num">${deviationHtml}</td><td class="num">${pnlHtml}</td><td>${status}${flagsHtml}</td></tr>`;
    })
    .join('');
  const table =
    rows.length === 0
      ? ''
      : `<h2>📋 Структура портфеля</h2><table class="history-table analysis-assets-table"><thead><tr><th>Актив</th><th class="num">Доля (тек.)</th><th class="num">Доля (цель)</th><th class="num">Отклонение</th><th class="num">P&L</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table>`;

  const alertsHtml =
    alerts.length === 0
      ? ''
      : `<h2>🔔 Ценовые алерты</h2><ul>${alerts
          .map((alert) => {
            const price =
              alert.currentPrice !== undefined
                ? ` (цена ${alert.currentPrice})`
                : '';
            return `<li><b>${escapeHtmlReport(alert.ticker)}</b> — ${escapeHtmlReport(alert.alertLevel ?? 'alert')}${price}</li>`;
          })
          .join('')}</ul>`;

  return cards + table + alertsHtml;
}

async function refreshAnalysis(): Promise<void> {
  try {
    const statusInfo = await window.financeApp.getAnalysisStatus();
    const inProgress = statusInfo?.status === 'in_progress';

    // Приоритет 1: полный отчёт конвейера (report.html) — как npm run pipeline
    // getLastPipelineReport возвращает { ok, data: { htmlContent, htmlPath } }
    const report = await window.financeApp.getLastPipelineReport();
    const data = report?.ok ? report.data : null;
    if (data && data.htmlContent) {
      const seconds = data.elapsedMs
        ? (data.elapsedMs / 1000).toFixed(1)
        : '—';
      analysisMetaEl.textContent =
        data.elapsedMs
          ? `полный конвейер · ${seconds} с`
          : 'отчёт готов';
      analysisFrameEl.hidden = false;
      analysisFrameEl.srcdoc = data.htmlContent;
      analysisReportEl.innerHTML = '';
      analysisTextEl.hidden = true;
      return;
    }

    // Конвейер запущен, но отчёт ещё не готов
    if (inProgress) {
      analysisMetaEl.textContent = '⏳ Анализ выполняется…';
      analysisTextEl.textContent =
        '⏳ Полный конвейер работает — отчёт появится автоматически после завершения.';
      analysisFrameEl.hidden = true;
      analysisTextEl.hidden = false;
      analysisReportEl.innerHTML = '';
      return;
    }

    // Конвейер не запускался
    analysisFrameEl.hidden = true;
    analysisTextEl.hidden = false;
    analysisMetaEl.textContent = 'анализ не запускался';
    analysisTextEl.textContent =
      'Анализ ещё не запускался. Нажмите «Запустить анализ» — текст ' +
      'отчёта появится здесь, и его можно будет сохранить в HTML или PDF.';
    analysisReportEl.innerHTML = '';
  } catch {
    analysisMetaEl.textContent = 'статус анализа недоступен';
  }
}

/**
 * Запустить полный конвейер (как npm run pipeline) прямо в приложении
 * и показать готовый report.html во вкладке «Анализ».
 */
async function runPipelineAnalysis(
  sourceBtn: HTMLButtonElement,
): Promise<void> {
  sourceBtn.disabled = true;
  sourceBtn.textContent = '⏳ Идёт анализ…';
  analysisNote.textContent =
    '⏳ Полный конвейер: данные → исследование → AI-анализ ' +
    '(на CPU может занять несколько минут)…';
  analysisNote.className = 'harness-run-note progress';
  // Индикатор в шапке сразу виден «запущен» — даже на других вкладках
  renderAnalysisStatus('in_progress');
  try {
    const report = await window.financeApp.runPipelineReport();
    if (!report) {
      analysisNote.textContent = 'Анализ ещё не запускался. Нажмите «Запустить анализ» — текст отчёта появится здесь, и его можно будет сохранить в HTML или PDF.';
      analysisNote.className = 'harness-run-note';
      return;
    }
    // runPipelineReport возвращает { ok, data: { success, error, elapsedMs, htmlPath } }
    const data = report.ok ? report.data : null;
    if (!data) {
      const msg = report.message || 'Неизвестная ошибка';
      analysisNote.textContent = `⚠️ Конвейер завершён с ошибками: ${msg}`;
      analysisNote.className = 'harness-run-note error';
      return;
    }
    const seconds = data.elapsedMs ? (data.elapsedMs / 1000).toFixed(1) : '—';
    if (data.success) {
      analysisNote.textContent = `✅ Отчёт готов за ${seconds} с · ${data.htmlPath || 'report.html'}`;
      analysisNote.className = 'harness-run-note ok';
      showToast(`✅ Отчёт готов за ${seconds} с`, 'ok');
    } else {
      const errorMsg = data.error || 'Неизвестная ошибка';
      analysisNote.textContent = `⚠️ Конвейер завершён с ошибками: ${errorMsg}`;
      analysisNote.className = 'harness-run-note error';
    }
    await refreshAnalysis();
  } catch (err) {
    analysisNote.textContent = `✗ Конвейер упал: ${
      err instanceof Error ? err.message : String(err)
    }`;
    analysisNote.className = 'harness-run-note error';
  } finally {
    // Сводный статус с сервера: готов / падение / статус Директора —
    // refreshAnalysisStatus синхронизирует и кнопку (текст + блокировка)
    await refreshAnalysisStatus();
  }
}

/** Запустить анализ Директора (единая точка для шапки и вкладки) */
async function runPortfolioAnalysis(
  sourceBtn: HTMLButtonElement,
): Promise<void> {
  sourceBtn.disabled = true;
  const originalText = sourceBtn.textContent || '▶ Запустить анализ';
  sourceBtn.textContent = '⏳ Анализ…';
  try {
    const result = await window.financeApp.runAnalysis();
    if (result.success) {
      appendActivityLine(`📊 ${result.message}`, 'type-agent');
      showAnalysisNote(`✅ ${result.message}`, true);
      showToast('✅ Анализ завершён', 'ok');
    } else {
      showAnalysisNote(`✗ ${result.message}`, false);
      showToast(`❌ ${result.message}`, 'error');
    }
  } catch (err) {
    showAnalysisNote(
      `✗ Ошибка анализа: ${err instanceof Error ? err.message : String(err)}`,
      false,
    );
    showToast(
      `❌ Ошибка анализа: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
  } finally {
    sourceBtn.disabled = false;
    sourceBtn.textContent = originalText;
    await refreshAnalysis();
    await refreshAnalysisStatus();
  }
}

// ── Вкладки ──────────────────────────────────────────────────

function bindTabs(): void {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.tab-btn'),
  );
  const panels = Array.from(
    document.querySelectorAll<HTMLElement>('.tab-panel'),
  );
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab ?? '';
      for (const b of buttons) b.classList.toggle('active', b === btn);
      for (const p of panels)
        p.classList.toggle('active', p.id === `tab-${target}`);
      if (target === 'console') {
        applyConsoleFilter();
        scrollToBottom(consoleListEl);
      }
      if (target === 'dispatcher') {
        void refreshHarness();
      }
      if (target === 'agents') {
        void refreshAux();
      }
      if (target === 'goals') {
        void refreshAutonomous();
      }
      if (target === 'analysis') {
        void refreshAnalysis();
        void refreshAnalysisStatus();
      }
    });
  }
}

// ── Инициализация ────────────────────────────────────────────

async function init(): Promise<void> {
  bindTabs();

  // Панель настроек в шапке: открыть/закрыть по кнопке, клик мимо — закрыть
  settingsToggleBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    settingsPanel.hidden = !settingsPanel.hidden;
  });
  settingsPanel.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  document.addEventListener('click', () => {
    settingsPanel.hidden = true;
  });

  // Статус анализа в шапке (в т.ч. если полный конвейер уже запущен/готов)
  void refreshAnalysisStatus();

  // Версия приложения (из package.json через main process)
  window.financeApp
    .getAppVersion()
    .then((version) => {
      versionEl.textContent = `v${version}`;
    })
    .catch(() => {
      // Версия не критична — молча пропускаем
    });

  // Настройка: открывать отчёт в браузере после прогона конвейера
  if (openReportCheckbox) {
    window.financeApp
      .getSettings()
      .then((settings) => {
        openReportCheckbox.checked = settings.openReportInBrowser;
      })
      .catch(() => {
        // Некритично: останется выключенным
      });
    openReportCheckbox.addEventListener('change', async () => {
      const checked = openReportCheckbox.checked;
      try {
        await window.financeApp.setOpenReportInBrowser(checked);
        showToast(
          checked
            ? '🌐 Отчёт будет открываться в браузере после анализа'
            : '🌐 Отчёт остаётся во вкладке «Анализ»',
          'ok',
        );
      } catch {
        openReportCheckbox.checked = !checked;
        showToast('Не удалось сохранить настройку', 'error');
      }
    });
  }

  // Настройки: выбор Excel-файла портфеля через нативный диалог
  pickExcelBtn.addEventListener('click', async () => {
    pickExcelBtn.disabled = true;
    try {
      const result = await window.financeApp.pickExcelFile();
      if (!result.canceled && result.excelFilePath) {
        // Перезагружаем данные портфеля без перезапуска
        const reload = await window.financeApp.reloadPortfolio(
          result.excelFilePath,
        );
        if (reload.success) {
          appendActivityLine(
            `📁 ${reload.message}: ${result.excelFilePath}`,
            'type-agent',
          );
          // Обновляем статус-бар
          renderStatusBar(reload.sourceLabel, reload.assetsCount > 0);
        } else {
          appendActivityLine(
            `✗ Не удалось загрузить портфель: ${reload.message}`,
            'type-error',
          );
        }
      }
    } catch {
      appendActivityLine('✗ Не удалось выбрать файл Excel', 'type-error');
    } finally {
      pickExcelBtn.disabled = false;
    }
  });

  // Настройки: выбор модели Ollama для общения (dropdown в шапке)
  const loadOllamaModels = async (): Promise<void> => {
    let current = '';
    try {
      const settings = await window.financeApp.getSettings();
      current = settings.ollamaModel ?? '';
    } catch {
      // Настройки не критичны — продолжим с пустым значением
    }
    let models: string[];
    try {
      models = await window.financeApp.getOllamaModels();
    } catch {
      models = [];
    }
    ollamaModelSelect.innerHTML = '';
    if (models.length === 0) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Ollama недоступна';
      ollamaModelSelect.appendChild(placeholder);
      ollamaModelSelect.disabled = true;
      applyOllamaBtn.disabled = true;
      return;
    }
    ollamaModelSelect.disabled = false;
    applyOllamaBtn.disabled = false;
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      ollamaModelSelect.appendChild(option);
    }
    if (current && models.includes(current)) {
      ollamaModelSelect.value = current;
    }
  };

  void loadOllamaModels();

  applyOllamaBtn.addEventListener('click', async () => {
    applyOllamaBtn.disabled = true;
    try {
      const model = ollamaModelSelect.value;
      if (!model) {
        appendActivityLine('✗ Модель Ollama не выбрана', 'type-error');
        return;
      }
      const saved = await window.financeApp.setOllamaModel(model);
      if (!saved) {
        appendActivityLine(
          '✗ Не удалось сохранить модель Ollama',
          'type-error',
        );
        return;
      }
      appendActivityLine(
        `🔄 Модель Ollama сохранена: ${model} — применится со следующего вопроса`,
        'type-agent',
      );
    } catch {
      appendActivityLine('✗ Ошибка сохранения модели Ollama', 'type-error');
    } finally {
      applyOllamaBtn.disabled = false;
    }
  });

  // Переподключение Ollama из UI
  reconnectOllamaBtn?.addEventListener('click', async () => {
    reconnectOllamaBtn.disabled = true;
    try {
      const result = await window.financeApp.reconnectOllama();
      appendActivityLine(
        result.success ? `✅ ${result.message}` : `⚠ ${result.message}`,
        result.success ? 'type-agent' : 'type-error',
      );
      // Обновляем индикатор статуса AI
      const status = await window.financeApp.getStatus();
      if (status) {
        renderAiStatus(status.aiLabel);
      }
    } catch {
      appendActivityLine('✗ Ошибка переподключения Ollama', 'type-error');
    } finally {
      reconnectOllamaBtn.disabled = false;
    }
  });

  sendBtn.addEventListener('click', () => {
    void ask(questionInput.value);
  });
  questionInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void ask(questionInput.value);
    }
  });

  for (const btn of Array.from(
    document.querySelectorAll<HTMLButtonElement>('.quick-btn'),
  )) {
    // «Идеи» — отдельная кнопка: показывает предложения, а не отправляет вопрос
    if (btn.id === 'ideas-btn') {
      continue;
    }
    btn.addEventListener('click', () => {
      void ask(btn.dataset.question ?? '');
    });
  }

  const ideasBtn = $('#ideas-btn') as HTMLButtonElement;
  ideasBtn.addEventListener('click', async () => {
    ideasBtn.disabled = true;
    try {
      const ideas = await window.financeApp.getProactiveIdeas();
      if (ideas.length === 0) {
        appendMessage(
          '💡 Пока предложений нет. Поставь цель («давай добавим …») ' +
            'или задай вопрос по портфелю.',
          'director',
        );
        return;
      }
      const lines = ideas.map(
        (idea) =>
          `${idea.kind === 'project' ? '🛠' : '📈'} ${idea.title}\n${idea.text}`,
      );
      appendMessage('💡 Мои предложения:\n\n' + lines.join('\n\n'), 'director');
    } catch (err) {
      appendMessage(
        `Не удалось получить идеи: ${err instanceof Error ? err.message : String(err)}`,
        'director',
      );
    } finally {
      ideasBtn.disabled = false;
    }
  });

  activityClearBtn.addEventListener('click', () => {
    activityEl.textContent = '';
  });
  consoleClearBtn.addEventListener('click', () => {
    consoleListEl.textContent = '';
  });
  consoleSearch.addEventListener('input', applyConsoleFilter);
  runAnalysisBtn.addEventListener('click', async () => {
    runAnalysisBtn.disabled = true;
    const originalText = runAnalysisBtn.textContent || '▶ Запустить анализ';
    runAnalysisBtn.textContent = '⏳ Анализ выполняется…';
    harnessRunNote.textContent = '⏳ Анализ выполняется…';
    harnessRunNote.className = 'harness-run-note progress';
    const startedAtMs = performance.now();
    try {
      const result = await window.financeApp.runHarnessAnalysis();
      const elapsed = formatElapsed(startedAtMs);
      appendActivityLine(
        `🛰 ${result.ok ? '✓' : '✗'} ${result.message} (${elapsed})`,
        result.ok ? 'type-agent' : 'type-error',
      );
      harnessRunNote.textContent = result.ok
        ? `✓ Анализ завершён за ${elapsed}`
        : `✗ Анализ завершён с ошибками за ${elapsed}`;
      harnessRunNote.className = result.ok
        ? 'harness-run-note ok'
        : 'harness-run-note error';
      await refreshHarness();
      await refreshAux();

      // Toast-уведомление о завершении
      showToast(
        result.ok
          ? `✅ Анализ завершён за ${elapsed}`
          : `❌ Анализ завершён с ошибками за ${elapsed}`,
        result.ok ? 'ok' : 'error',
      );
    } catch (err) {
      harnessRunNote.textContent = `✗ Ошибка анализа: ${
        err instanceof Error ? err.message : String(err)
      }`;
      harnessRunNote.className = 'harness-run-note error';
      showToast(
        `❌ Ошибка анализа: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    } finally {
      runAnalysisBtn.disabled = false;
      runAnalysisBtn.textContent = originalText;
    }
  });

  // Шапка «▶ Анализ»: запускает анализ и открывает вкладку «📊 Анализ»,
  // где виден результат и кнопки экспорта (единая точка входа)
  const directorRunBtn = $(
    '#director-run-analysis-btn',
  ) as HTMLButtonElement | null;
  if (directorRunBtn) {
    directorRunBtn.addEventListener('click', () => {
      document
        .querySelector<HTMLButtonElement>('.tab-btn[data-tab="analysis"]')
        ?.click();
      void runPortfolioAnalysis(analysisRunBtn);
    });
  }

  // Экспорт HTML-дашборда диспетчера в файл
  exportReportBtn.addEventListener('click', async () => {
    exportReportBtn.disabled = true;
    try {
      const result = await window.financeApp.exportDashboard();
      appendActivityLine(
        `💾 ${result.ok ? '✓' : '✗'} ${result.message}`,
        result.ok ? 'type-agent' : 'type-error',
      );
    } catch {
      appendActivityLine('✗ Ошибка экспорта дашборда', 'type-error');
    } finally {
      exportReportBtn.disabled = false;
    }
  });

  // Экспорт дашборда в PDF (диалог выбора места сохранения)
  exportPdfBtn.addEventListener('click', async () => {
    exportPdfBtn.disabled = true;
    try {
      const result = await window.financeApp.exportDashboardPdf();
      appendActivityLine(
        `📄 ${result.ok ? '✓' : '✗'} ${result.message}`,
        result.ok ? 'type-agent' : 'type-error',
      );
    } catch {
      appendActivityLine('✗ Ошибка экспорта PDF', 'type-error');
    } finally {
      exportPdfBtn.disabled = false;
    }
  });

  // ── Вкладка «Анализ»: полный конвейер + экспорт ──
  analysisRunBtn.addEventListener('click', () => {
    void runPipelineAnalysis(analysisRunBtn);
  });

  const exportAnalysis = async (
    button: HTMLButtonElement,
    action: () => Promise<{ ok: boolean; message: string }>,
  ): Promise<void> => {
    button.disabled = true;
    try {
      const result = await action();
      showAnalysisNote(
        `${result.ok ? '💾' : '✗'} ${result.message}`,
        result.ok,
      );
      appendActivityLine(
        `${result.ok ? '💾' : '✗'} ${result.message}`,
        result.ok ? 'type-agent' : 'type-error',
      );
    } catch (err) {
      showAnalysisNote(
        `✗ Ошибка экспорта: ${err instanceof Error ? err.message : String(err)}`,
        false,
      );
    } finally {
      button.disabled = false;
    }
  };
  analysisExportHtmlBtn.addEventListener('click', () => {
    void exportAnalysis(analysisExportHtmlBtn, () =>
      window.financeApp.exportAnalysisHtml(),
    );
  });
  analysisExportPdfBtn.addEventListener('click', () => {
    void exportAnalysis(analysisExportPdfBtn, () =>
      window.financeApp.exportAnalysisPdf(),
    );
  });

  // ── Вкладка «Цели»: переключение цикла, разовый запуск, добавление цели ──
  autonomousToggleBtn.addEventListener('click', async () => {
    autonomousToggleBtn.disabled = true;
    try {
      const status = autonomousRunning
        ? await window.financeApp.autonomousStop()
        : await window.financeApp.autonomousStart();
      showGoalsNote(
        status?.running
          ? `👀 Автономный цикл включён: каждые ${status.intervalSec} с`
          : '⏹ Автономный цикл остановлен',
        true,
      );
    } catch (err) {
      showGoalsNote(
        `✗ Ошибка: ${err instanceof Error ? err.message : String(err)}`,
        false,
      );
    } finally {
      autonomousToggleBtn.disabled = false;
      await refreshAutonomous();
    }
  });

  autonomousRunBtn.addEventListener('click', async () => {
    autonomousRunBtn.disabled = true;
    try {
      const result = await window.financeApp.autonomousRunOnce();
      showGoalsNote(
        result.started ? `⚙️ ${result.message}` : `⚠️ ${result.message}`,
        result.started,
      );
    } catch (err) {
      showGoalsNote(
        `✗ Ошибка: ${err instanceof Error ? err.message : String(err)}`,
        false,
      );
    } finally {
      autonomousRunBtn.disabled = false;
      await refreshAutonomous();
    }
  });

  const submitGoal = async (): Promise<void> => {
    const text = goalInput.value.trim();
    if (!text) {
      showGoalsNote('Введите текст задачи', false);
      return;
    }
    addGoalBtn.disabled = true;
    try {
      const goal = await window.financeApp.goalsAdd(text);
      goalInput.value = '';
      showGoalsNote(
        `🎯 Цель добавлена и активирована: «${goal.name}» — выполнится фоном`,
        true,
      );
      appendActivityLine(
        `🎯 Цель поставлена в план: ${goal.name}`,
        'type-agent',
      );
    } catch (err) {
      showGoalsNote(
        `✗ Не удалось добавить цель: ${
          err instanceof Error ? err.message : String(err)
        }`,
        false,
      );
    } finally {
      addGoalBtn.disabled = false;
      await refreshAutonomous();
    }
  };
  addGoalBtn.addEventListener('click', () => {
    void submitGoal();
  });
  goalInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void submitGoal();
  });

  // Живые уведомления о выполненных целях автономного цикла
  window.financeApp.onAutonomousUpdate((event: AutonomousIterationEvent) => {
    const outcome = event.outcome ? ` (${event.outcome})` : '';
    appendActivityLine(
      `${event.success ? '✅' : '❌'} Автономный цикл · «${event.goalName}»${outcome}`,
      event.success ? 'type-agent' : 'type-error',
    );
    showToast(
      event.success
        ? `🎯 Цель выполнена: «${event.goalName}»${outcome}`
        : `⚠️ Цель не выполнена: «${event.goalName}»${outcome}`,
      event.success ? 'ok' : 'error',
    );
    void refreshAutonomous();
  });

  // Автообновление вкладки «Цели» (цикл работает фоном)
  setInterval(() => {
    void refreshAutonomous();
  }, 10000);

  // Живой стриминг событий аудита
  window.financeApp.onDirectorEvent(onDirectorEvent);
  // Живой стриминг шагов агентов (started/step/completed/failed)
  window.financeApp.onDirectorActivity(onDirectorActivity);
  window.financeApp.onDirectorReply(onDirectorReply);

  // Начальное состояние
  try {
    const portfolio = await window.financeApp.loadPortfolio();
    renderStatusBar(
      portfolio.sourceLabel,
      !portfolio.sourceLabel.includes('нет данных'),
    );
  } catch {
    renderStatusBar('статус данных недоступен', false);
  }

  appendMessage(
    'Здравствуйте! Я — Финансовый Директор. Задайте вопрос, и вы увидите в реальном времени, как план делегируется агентам, проходит Консилиум и синтезируется ответ.',
    'director',
  );

  await refreshAux();
  await refreshHarness();
  await refreshAutonomous();
  await refreshAnalysis();
}

void init();
