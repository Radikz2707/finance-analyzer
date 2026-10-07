/**
 * Director Chat — лёгкий чат для report.html (собирается в director-chat-init.min.js).
 * Работает в браузере через file:// без Node-модулей.
 *
 * Что делает:
 * - отвечает по РЕАЛЬНЫМ фактам портфеля (через buildBrowserChatResponse)
 *   вместо фиксированных заглушек на любой вопрос;
 * - выставляет window.processDirectorMessage для inline-скрипта report.html;
 * - вешает обработчики чата ТОЛЬКО если их ещё не повесил inline-скрипт
 *   (защита от дублирования через window.__directorChatBound);
 * - во время обработки показывает статус «Director анализирует…» и
 *   прогресс-бар — видно, что ответ придёт в этот чат.
 *
 * Полный DirectorAgent (агенты, Consilium, LLM) доступен на dashboard
 * (npm run dev) и в CLI (npm run chat); здесь — только разговор по фактам.
 */

import type { DirectorFactsContext } from './director-types.js';
import { buildBrowserChatResponse } from './browser-chat-responder.js';

(function () {
  'use strict';

  const container = document.getElementById('directorChat');
  if (!container) {
    console.warn('[Director] Контейнер #directorChat не найден');
    return;
  }

  /** Факты портфеля из глобальных данных или localStorage */
  function loadFacts(): DirectorFactsContext {
    const win = window as unknown as {
      __DIRECTOR_FACTS__?: DirectorFactsContext;
    };
    if (win.__DIRECTOR_FACTS__) return win.__DIRECTOR_FACTS__;
    try {
      const saved = localStorage.getItem('portfolioFacts');
      if (saved) {
        const parsed = JSON.parse(saved) as DirectorFactsContext;
        if (Array.isArray(parsed.assetsAnalysis)) return parsed;
      }
    } catch {
      // localStorage недоступен или данные повреждены — пустые факты
    }
    return { assetsAnalysis: [], totalPortfolioValue: 0, freeCashRub: 0 };
  }

  const facts = loadFacts();
  const history: Array<{ role: string; text: string }> = [];

  /** Системные команды (/status, /log, /undo, /help) — локально */
  function handleSystemCommand(message: string): string | null {
    const lower = message.toLowerCase().trim();
    if (lower === '/help' || lower === 'помощь') {
      return (
        '⌨️ Команды чата:\n' +
        '• /status — статус Director и данные портфеля\n' +
        '• /log — последние действия\n' +
        '• /undo — отмена последнего действия\n' +
        '• /help — справка'
      );
    }
    if (lower === '/status') {
      return (
        '📡 Статус Director:\n' +
        'Режим: отчёт (report.html), агенты и LLM недоступны.\n' +
        'Активов в данных: ' +
        facts.assetsAnalysis.length +
        ', стоимость: ' +
        (facts.totalPortfolioValue > 0
          ? Math.round(facts.totalPortfolioValue).toLocaleString('ru-RU') + ' ₽'
          : '—') +
        '.\n' +
        'Полный Director с агентами — на dashboard (npm run dev).'
      );
    }
    if (lower === '/log') {
      return (
        '📋 Последние действия:\n' +
        (history.length > 0
          ? history
              .slice(-5)
              .map(
                (m) =>
                  (m.role === 'user' ? 'Вы: ' : 'Director: ') +
                  m.text.slice(0, 80),
              )
              .join('\n')
          : 'Диалог ещё не начат.')
      );
    }
    if (lower === '/undo') {
      return (
        '↩️ В режиме отчёта отмена действий недоступна.\n' +
        'Director с журналом действий работает на dashboard (npm run dev).'
      );
    }
    if (lower.startsWith('/')) {
      return (
        '❓ Неизвестная команда: ' +
        message +
        '\n' +
        'Доступно: /status, /log, /undo, /help'
      );
    }
    return null;
  }

  /** Обработать сообщение пользователя → текст ответа */
  function buildReply(message: string): string {
    const commandReply = handleSystemCommand(message);
    if (commandReply) return commandReply;

    const reply = buildBrowserChatResponse({
      question: message,
      facts,
      history: history.map((m) => m.role + ': ' + m.text).join('\n'),
    });
    return (
      reply ??
      'Пока я не смог распознать этот вопрос как запрос по портфелю.\n\n' +
        'Попробуйте спросить иначе: «Что с SBER?», «Как выглядит портфель?», ' +
        '«Есть ли риски?», «Новости» или «Стратегия».'
    );
  }

  // Глобальный API для inline-скрипта report.html
  (window as unknown as Record<string, unknown>).processDirectorMessage = (
    message: string,
  ): Promise<{
    text: string;
    connectedAgents: never[];
    needsConsilium: boolean;
  }> => {
    return Promise.resolve({
      text: buildReply(message),
      connectedAgents: [],
      needsConsilium: false,
    });
  };

  console.log('🎯 Director: чат инициализирован (отчёт report.html)');

  // Inline-скрипт report.html уже повесил обработчики — не дублируем их.
  const alreadyBound = Boolean(
    (window as unknown as Record<string, boolean>).__directorChatBound,
  );
  if (alreadyBound) {
    return;
  }

  const messagesEl = container.querySelector('#directorChatMessages');
  const inputEl =
    container.querySelector<HTMLInputElement>('#directorChatInput');
  const sendBtn =
    container.querySelector<HTMLButtonElement>('#directorChatSend');

  function addMsg(role: string, text: string): void {
    if (!messagesEl) return;
    history.push({ role: role, text: text });
    const cls = role === 'user' ? 'dc-msg-user' : 'dc-msg-director';
    const label = role === 'user' ? 'Вы' : 'Director';
    const div = document.createElement('div');
    div.className = 'dc-msg ' + cls;
    div.innerHTML =
      '<div class="dc-role">' +
      label +
      '</div><div class="dc-text">' +
      text.replace(/\n/g, '<br>') +
      '</div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /** Видимый статус обработки: понятно, что Director работает и куда придёт ответ */
  function setWorking(on: boolean): void {
    if (!messagesEl) return;
    let statusEl = messagesEl.querySelector<HTMLElement>('.dc-status');
    let progressEl = messagesEl.querySelector<HTMLElement>('.dc-progress-line');
    if (on) {
      if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.className = 'dc-status';
        statusEl.textContent = '🧠 Director анализирует ваш вопрос…';
        messagesEl.appendChild(statusEl);
      }
      statusEl.style.display = 'block';
      if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.className = 'dc-progress-line';
        const bar = document.createElement('span');
        bar.className = 'dc-progress-bar';
        progressEl.appendChild(bar);
        messagesEl.appendChild(progressEl);
      }
      progressEl.style.display = 'block';
    } else {
      if (statusEl) statusEl.style.display = 'none';
      if (progressEl) progressEl.style.display = 'none';
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function sendMessage(): void {
    if (!inputEl || !sendBtn) return;
    const text = inputEl.value.trim();
    if (!text) return;

    addMsg('user', text);
    inputEl.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = 'Думаю...';
    setWorking(true);

    const process = (window as unknown as Record<string, unknown>)
      .processDirectorMessage;
    Promise.resolve(
      typeof process === 'function'
        ? (process as (m: string) => Promise<{ text: string }>)(text)
        : { text: buildReply(text) },
    )
      .then(function (response: { text: string }) {
        addMsg('director', response.text || 'Готово.');
      })
      .catch(function (err: unknown) {
        addMsg(
          'director',
          'Ошибка: ' + (err instanceof Error ? err.message : String(err)),
        );
      })
      .finally(function () {
        setWorking(false);
        sendBtn.disabled = false;
        sendBtn.textContent = 'Отправить';
      });
  }

  if (sendBtn) sendBtn.addEventListener('click', sendMessage);
  if (inputEl)
    inputEl.addEventListener('keydown', function (e: KeyboardEvent) {
      if (e.key === 'Enter') sendMessage();
    });

  // Помечаем, что обработчики повешены — inline-скрипт не продублирует их
  (window as unknown as Record<string, boolean>).__directorChatBound = true;

  console.log('🎯 Director: обработчики чата подключены (простой режим)');
})();
