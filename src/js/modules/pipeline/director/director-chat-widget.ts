/**
 * DirectorChatWidget — браузерный чат-интерфейс для общения с Director.
 *
 * Встраивается в dashboard/report UI (приоритет 1) как отдельный блок.
 * Чат НЕ создаёт отдельного интерфейса для каждого агента:
 * пользователь разговаривает прежде всего с Director.
 *
 * Возможности:
 * - история диалога;
 * - поле обычного текста и отправка;
 * - индикатор работы Director;
 * - отображение подключённых агентов;
 * - отображение Consilium при необходимости;
 * - итог Director;
 * - ссылки на фактические источники (если предоставлены);
 * - возможность продолжить обсуждение без новой команды.
 */

import type { ChatMessage, DirectorResponse } from './director-types.js';

/** Публичный API для виджета (подмножество DirectorAgent) */
export interface DirectorChatWidgetApi {
  processUserMessage(message: string): Promise<DirectorResponse>;
  getChatHistory(): ChatMessage[];
  /** Проактивные сообщения (опционально) */
  getProactiveMessages?: () => unknown[];
}

/** Конфигурация виджета */
export interface DirectorChatWidgetConfig {
  containerSelector?: string;
  placeholder?: string;
  userName?: string;
}

const DEFAULT_SELECTOR = '#directorChat';
const DEFAULT_PLACEHOLDER = 'Спросите Director о портфеле…';

/** Роль сообщения -> CSS-класс */
function roleClass(role: ChatMessage['role']): string {
  return 'dc-msg-' + role;
}

/** Экранирование текста для безопасного встраивания в HTML */
function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

/**
 * Построить HTML одного сообщения.
 * @param msg — сообщение
 * @param showMeta — показывать метаданные (агенты, консилиум)
 */
export function buildMessageHtml(msg: ChatMessage, showMeta: boolean): string {
  const roleLabel =
    msg.role === 'user'
      ? 'Вы'
      : msg.role === 'director'
        ? 'Director'
        : 'Система';

  let meta = '';
  if (showMeta && msg.connectedAgents && msg.connectedAgents.length > 0) {
    meta +=
      '<div class="dc-meta dc-agents">Подключены: ' +
      escapeHtml(msg.connectedAgents.join(', ')) +
      '</div>';
  }
  if (showMeta && msg.taskId) {
    meta +=
      '<div class="dc-meta dc-task">task: ' + escapeHtml(msg.taskId) + '</div>';
  }

  const working = msg.isWorking ? ' dc-working' : '';

  return (
    '<div class="dc-msg ' +
    roleClass(msg.role) +
    working +
    '">' +
    '<div class="dc-role">' +
    escapeHtml(roleLabel) +
    '</div>' +
    '<div class="dc-text">' +
    escapeHtml(msg.text) +
    '</div>' +
    meta +
    '</div>'
  );
}

/**
 * Построить HTML всего блока чата (без встраивания в DOM).
 * Чистая функция — тестируется без браузера.
 */
export function buildChatHtml(
  messages: ChatMessage[],
  opts?: { working?: boolean; placeholder?: string },
): string {
  const placeholder = escapeHtml(opts?.placeholder ?? DEFAULT_PLACEHOLDER);
  const messagesHtml = messages.map((m) => buildMessageHtml(m, true)).join('');

  const body =
    messages.length > 0
      ? messagesHtml
      : '<div class="dc-empty">Диалог с Director ещё не начат.</div>';

  const indicator =
    opts?.working === true
      ? '<div class="dc-indicator dc-indicator-on">Director думает…</div>'
      : '<div class="dc-indicator">Готов к диалогу</div>';

  return (
    '<div class="director-chat">' +
    '<div class="dc-header">🎯 Director — инвестиционный координатор</div>' +
    '<div class="dc-messages">' +
    body +
    '</div>' +
    indicator +
    '<div class="dc-input-row">' +
    '<input type="text" class="dc-input" placeholder="' +
    placeholder +
    '" aria-label="Сообщение Director" />' +
    '<button type="button" class="dc-send">Отправить</button>' +
    '</div>' +
    '</div>'
  );
}

/**
 * Примонтировать чат Director в контейнер.
 * Браузеро-безопасно: если document отсутствует — тихий no-op.
 *
 * @returns функция отписки.
 */
export function mountDirectorChat(
  api: DirectorChatWidgetApi,
  config?: DirectorChatWidgetConfig,
): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }

  const selector = config?.containerSelector ?? DEFAULT_SELECTOR;
  const container = document.querySelector<HTMLElement>(selector);
  if (!container) {
    console.warn('[DirectorChat] Контейнер не найден: ' + selector);
    return () => {};
  }

  container.innerHTML = buildChatHtml(api.getChatHistory(), {
    placeholder: config?.placeholder,
  });

  const input = container.querySelector<HTMLInputElement>('.dc-input');
  const sendBtn = container.querySelector<HTMLButtonElement>('.dc-send');
  const messagesEl = container.querySelector<HTMLElement>('.dc-messages');
  const indicatorEl = container.querySelector<HTMLElement>('.dc-indicator');

  const render = (working: boolean): void => {
    if (!messagesEl || !indicatorEl) return;
    messagesEl.innerHTML = api
      .getChatHistory()
      .map((m) => buildMessageHtml(m, true))
      .join('');
    indicatorEl.className =
      'dc-indicator' + (working ? ' dc-indicator-on' : '');
    indicatorEl.textContent = working ? 'Director думает…' : 'Готов к диалогу';
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const send = (): void => {
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    render(true);
    void api
      .processUserMessage(text)
      .catch((err: unknown) => {
        console.warn('[DirectorChat] Ошибка обработки сообщения:', err);
      })
      .finally(() => {
        render(false);
      });
  };

  const onSendClick = (): void => send();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      send();
    }
  };

  if (sendBtn) sendBtn.addEventListener('click', onSendClick);
  if (input) input.addEventListener('keydown', onKeyDown);

  // Автообновление списка проактивных сообщений (если API предоставляет)
  let proactiveTimer: ReturnType<typeof setInterval> | null = null;
  if (api.getProactiveMessages) {
    proactiveTimer = setInterval(() => {
      const unread = api
        .getProactiveMessages?.()
        .filter((m) => (m as { read?: boolean }).read === false).length;
      if (unread && unread > 0 && indicatorEl) {
        indicatorEl.textContent =
          'Есть новые сообщения Director (' + unread + ')';
        indicatorEl.className = 'dc-indicator dc-indicator-proactive';
      }
    }, 15000);
  }

  return () => {
    if (sendBtn) sendBtn.removeEventListener('click', onSendClick);
    if (input) input.removeEventListener('keydown', onKeyDown);
    if (proactiveTimer !== null) {
      clearInterval(proactiveTimer);
    }
  };
}

/** CSS-стили виджета (строка, встраивается в страницу при необходимости) */
export function directorChatStyles(): string {
  return (
    '.director-chat{display:flex;flex-direction:column;gap:8px;border:1px solid #333;' +
    'border-radius:10px;padding:12px;background:#1e1e2e;color:#eee;max-width:640px;' +
    'font-family:system-ui,sans-serif;}' +
    '.dc-header{font-weight:700;font-size:15px;}' +
    '.dc-messages{max-height:420px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;}' +
    '.dc-msg{padding:8px 10px;border-radius:8px;max-width:92%;white-space:pre-wrap;}' +
    '.dc-msg-user{align-self:flex-end;background:#2d5aa0;}' +
    '.dc-msg-director{align-self:flex-start;background:#3a3a4c;}' +
    '.dc-msg-system{align-self:center;background:#444;font-size:12px;}' +
    '.dc-role{font-size:11px;opacity:.7;margin-bottom:2px;}' +
    '.dc-text{font-size:14px;line-height:1.45;}' +
    '.dc-meta{font-size:11px;opacity:.6;margin-top:4px;}' +
    '.dc-working .dc-text::after{content:"…";animation:dc-blink 1s infinite;}' +
    '.dc-indicator{font-size:12px;opacity:.6;}' +
    '.dc-indicator-on{opacity:1;color:#ffd166;}' +
    '.dc-indicator-proactive{opacity:1;color:#6cf08f;}' +
    '.dc-input-row{display:flex;gap:8px;}' +
    '.dc-input{flex:1;padding:8px 10px;border-radius:8px;border:1px solid #555;' +
    'background:#14141f;color:#eee;}' +
    '.dc-send{padding:8px 16px;border-radius:8px;border:none;background:#2d5aa0;' +
    'color:#fff;cursor:pointer;}' +
    '.dc-empty{color:#888;font-style:italic;padding:8px;}' +
    '@keyframes dc-blink{50%{opacity:0}}'
  );
}

/** Экспорт для тестов: роль сообщения -> css класс */
export { roleClass };
