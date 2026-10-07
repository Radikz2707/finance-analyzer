/**
 * Renderer App — логика UI десктоп-приложения.
 *
 * Работает через типизированный мост window.financeApp (preload/contextBridge).
 * Чистый DOM-рендер без внешних фреймворков. Форматирование событий —
 * переиспользует scripts/director-chat-render.ts (чистые функции, без Node).
 */

import type {
  AgentPanelState,
  AskResult,
  DirectorAuditEvent,
  FinanceDesktopApi,
  HarnessDashboardPayload,
} from '../api-types.js';
import {
  formatAuditEventLine,
  stripAnsi,
} from '../../scripts/director-chat-render.js';

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
const statusBar = $('#status-bar');
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
const pickExcelBtn = $('#pick-excel-btn') as HTMLButtonElement;
const ollamaModelSelect = $('#ollama-model-select') as HTMLSelectElement;
const applyOllamaBtn = $('#apply-ollama-btn') as HTMLButtonElement;
const exportReportBtn = $('#export-report-btn') as HTMLButtonElement;
const exportPdfBtn = $('#export-report-pdf-btn') as HTMLButtonElement;

const MAX_ACTIVITY_LINES = 400;
const MAX_CONSOLE_LINES = 1500;

// ── Утилиты ──────────────────────────────────────────────────

function nowTime(): string {
  // Локальное время пользователя (не UTC)
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
        sched.lastRunAt ? sched.lastRunAt.slice(11, 19) : '—',
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

// ── Статус-бар ───────────────────────────────────────────────

function renderStatusBar(sourceLabel: string, hasData: boolean): void {
  statusBar.textContent = sourceLabel;
  statusBar.classList.toggle('has-data', hasData);
  statusBar.classList.toggle('no-data', !hasData);
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
  if (result.consiliumText) {
    const block = makeEl('div', 'consilium-block', result.consiliumText);
    activityEl.appendChild(block);
    scrollToBottom(activityEl);
  }
  appendActivityLine(
    `⏱ Ответ Director за ${result.elapsedMs} мс (событий: ${result.events.length})`,
    'type-plan',
  );
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
    });
  }
}

// ── Инициализация ────────────────────────────────────────────

async function init(): Promise<void> {
  bindTabs();

  // Версия приложения (из package.json через main process)
  window.financeApp
    .getAppVersion()
    .then((version) => {
      versionEl.textContent = `v${version}`;
    })
    .catch(() => {
      // Версия не критична — молча пропускаем
    });

  // Настройки: выбор Excel-файла портфеля через нативный диалог
  pickExcelBtn.addEventListener('click', async () => {
    pickExcelBtn.disabled = true;
    try {
      const result = await window.financeApp.pickExcelFile();
      if (!result.canceled && result.excelFilePath) {
        appendActivityLine(
          `📁 Путь к Excel сохранён: ${result.excelFilePath}`,
          'type-agent',
        );
        const restart = window.confirm(
          'Путь к Excel сохранён. Перезапустить приложение, чтобы данные портфеля загрузились?',
        );
        if (restart) {
          await window.financeApp.restartApp();
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
      appendActivityLine(`🔄 Модель Ollama сохранена: ${model}`, 'type-agent');
      const restart = window.confirm(
        'Модель Ollama сохранена. Перезапустить приложение, чтобы она применилась?',
      );
      if (restart) {
        await window.financeApp.restartApp();
      }
    } catch {
      appendActivityLine('✗ Ошибка сохранения модели Ollama', 'type-error');
    } finally {
      applyOllamaBtn.disabled = false;
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
    btn.addEventListener('click', () => {
      void ask(btn.dataset.question ?? '');
    });
  }

  activityClearBtn.addEventListener('click', () => {
    activityEl.textContent = '';
  });
  consoleClearBtn.addEventListener('click', () => {
    consoleListEl.textContent = '';
  });
  consoleSearch.addEventListener('input', applyConsoleFilter);
  runAnalysisBtn.addEventListener('click', async () => {
    runAnalysisBtn.disabled = true;
    try {
      const result = await window.financeApp.runHarnessAnalysis();
      appendActivityLine(
        `🛰 ${result.ok ? '✓' : '✗'} ${result.message}`,
        result.ok ? 'type-agent' : 'type-error',
      );
      await refreshHarness();
    } finally {
      runAnalysisBtn.disabled = false;
    }
  });

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

  // Живой стриминг событий аудита
  window.financeApp.onDirectorEvent(onDirectorEvent);
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
}

void init();
