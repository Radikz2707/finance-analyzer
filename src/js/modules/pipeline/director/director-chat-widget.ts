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
import type { DangerAssessment } from './director-chat-commands.js';

/** Публичный API для виджета (подмножество DirectorAgent) */
export interface DirectorChatWidgetApi {
  processUserMessage(message: string): Promise<DirectorResponse>;
  getChatHistory(): ChatMessage[];
  /** Проактивные сообщения (опционально) */
  getProactiveMessages?: () => unknown[];
  /**
   * Оценка опасности сообщения перед отправкой Director.
   * Если возвращает dangerous=true, виджет покажет кнопку «Подтвердить»
   * и не отправит сообщение до подтверждения.
   */
  assessDanger?: (message: string) => DangerAssessment | null;
  /** Выполнить сообщение после подтверждения опасности */
  confirmDangerousAction?: (message: string) => Promise<DirectorResponse>;
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

/** Упрощённый формат сообщения для виджета */
export interface SimpleChatMessage {
  role: string;
  content: string;
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
 * Построить HTML одного сообщения (упрощённый формат).
 * @param msg — сообщение
 */
export function buildSimpleMessageHtml(msg: ChatMessage): string {
  const roleLabel =
    msg.role === 'user'
      ? 'Вы'
      : msg.role === 'director'
        ? 'Director'
        : 'Система';

  return (
    '<div class="dc-msg ' +
    roleClass(msg.role) +
    '">' +
    '<div class="dc-role">' +
    escapeHtml(roleLabel) +
    '</div>' +
    '<div class="dc-text">' +
    escapeHtml(msg.text) +
    '</div>' +
    '</div>'
  );
}

/** Подсказка по системным командам */
export function buildCommandsHint(): string {
  return 'Команды: /status · /log [N] · /undo · /help';
}

/**
 * Построить HTML всего блока чата (без встраивания в DOM).
 * Чистая функция — тестируется без браузера.
 */
export function buildChatHtml(
  messages: ChatMessage[],
  opts?: { working?: boolean; placeholder?: string; commandsHint?: string },
): string {
  const placeholder = escapeHtml(opts?.placeholder ?? DEFAULT_PLACEHOLDER);
  const messagesHtml = messages.map((m) => buildSimpleMessageHtml(m)).join('');

  const body =
    messages.length > 0
      ? messagesHtml
      : '<div class="dc-empty">Диалог с Director ещё не начат.</div>';

  const indicator =
    opts?.working === true
      ? '<div class="dc-indicator dc-indicator-on">Director думает…</div>'
      : '<div class="dc-indicator">Готов к диалогу</div>';

  const progress =
    '<div class="dc-progress' +
    (opts?.working === true ? ' dc-progress-on' : '') +
    '" role="progressbar" aria-hidden="true"><div class="dc-progress-bar"></div></div>';

  const commandsHint =
    '<div class="dc-commands">' +
    escapeHtml(opts?.commandsHint ?? buildCommandsHint()) +
    '</div>';

  return (
    '<div class="director-chat">' +
    '<div class="dc-header">🎯 Director — инвестиционный координатор</div>' +
    '<div class="dc-messages">' +
    body +
    '</div>' +
    indicator +
    progress +
    commandsHint +
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
  const progressEl = container.querySelector<HTMLElement>('.dc-progress');

  // Ожидающее подтверждения опасное действие (human-in-the-loop)
  let pendingDanger: { message: string; assessment: DangerAssessment } | null =
    null;

  /** Последняя ошибка обработки — показывается в ленте, а не только в консоли */
  let pendingError: string | null = null;

  const render = (working: boolean): void => {
    if (!messagesEl || !indicatorEl) return;
    messagesEl.innerHTML = api
      .getChatHistory()
      .map((m) => buildSimpleMessageHtml(m))
      .join('');
    if (working) {
      // Наглядный «печатающий» пузырь: видно, что ответ придёт в эту ленту
      const typing = document.createElement('div');
      typing.className = 'dc-msg dc-msg-director dc-typing';
      typing.innerHTML =
        '<div class="dc-role">Director</div>' +
        '<div class="dc-text">анализирует вопрос…</div>';
      messagesEl.appendChild(typing);
    } else if (pendingError) {
      const div = document.createElement('div');
      div.className = 'dc-msg dc-msg-system dc-error';
      div.innerHTML =
        '<div class="dc-role">⚠️ Ошибка</div>' +
        '<div class="dc-text">' +
        escapeHtml(pendingError) +
        '</div>';
      messagesEl.appendChild(div);
    }
    indicatorEl.className =
      'dc-indicator' + (working ? ' dc-indicator-on' : '');
    indicatorEl.textContent = working ? 'Director думает…' : 'Готов к диалогу';
    progressEl?.classList.toggle('dc-progress-on', working);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  /** Показать предупреждение об опасном действии с кнопкой «Подтвердить» */
  const showConfirmation = (
    message: string,
    assessment: DangerAssessment,
  ): void => {
    pendingDanger = { message, assessment };
    if (!messagesEl) return;

    const div = document.createElement('div');
    div.className = 'dc-msg dc-msg-system dc-confirm';
    div.innerHTML =
      '<div class="dc-role">⚠️ Подтверждение действия</div>' +
      '<div class="dc-text">' +
      escapeHtml(assessment.description ?? 'Действие требует подтверждения') +
      '</div>' +
      '<div class="dc-confirm-actions">' +
      '<button type="button" class="dc-confirm-yes">Подтвердить</button>' +
      '<button type="button" class="dc-confirm-no">Отмена</button>' +
      '</div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const confirm = (): void => {
      if (!pendingDanger || !api.confirmDangerousAction || !input) return;
      const confirmedText = pendingDanger.message;
      pendingDanger = null;
      div.remove();
      input.value = '';
      pendingError = null;
      render(true);
      void api
        .confirmDangerousAction(confirmedText)
        .catch((err: unknown) => {
          console.warn('[DirectorChat] Ошибка подтверждённого действия:', err);
          pendingError = err instanceof Error ? err.message : String(err);
        })
        .finally(() => {
          render(false);
        });
    };

    const cancel = (): void => {
      pendingDanger = null;
      div.remove();
      if (input) input.focus();
    };

    div
      .querySelector<HTMLButtonElement>('.dc-confirm-yes')
      ?.addEventListener('click', confirm);
    div
      .querySelector<HTMLButtonElement>('.dc-confirm-no')
      ?.addEventListener('click', cancel);
  };

  const send = (): void => {
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    // Подтверждение опасных действий перед отправкой Director
    const danger = api.assessDanger?.(text) ?? null;
    if (danger?.dangerous && api.confirmDangerousAction && !pendingDanger) {
      showConfirmation(text, danger);
      return;
    }
    if (pendingDanger) return; // ждём решение по текущему предупреждению

    input.value = '';
    pendingError = null;
    render(true);
    void api
      .processUserMessage(text)
      .catch((err: unknown) => {
        console.warn('[DirectorChat] Ошибка обработки сообщения:', err);
        pendingError = err instanceof Error ? err.message : String(err);
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
    '.dc-commands{font-size:11px;opacity:.55;color:#9aa0b4;padding:2px 2px 0;}' +
    '.dc-progress{display:none;height:4px;border-radius:2px;background:#2a2a3c;' +
    'overflow:hidden;}' +
    '.dc-progress-on{display:block;}' +
    '.dc-progress-bar{height:100%;width:40%;background:#ffd166;border-radius:2px;' +
    'animation:dc-progress-slide 1.2s ease-in-out infinite;}' +
    '.dc-typing{opacity:.7;font-style:italic;animation:dc-blink 1.4s infinite;}' +
    '.dc-error{border:1px solid #b91c1c;background:#3a1116!important;' +
    'max-width:100%!important;}' +
    '.dc-confirm{border:1px solid #b45309;background:#3d2b10!important;' +
    'max-width:100%!important;}' +
    '.dc-confirm-actions{display:flex;gap:8px;margin-top:8px;}' +
    '.dc-confirm-yes{padding:6px 14px;border-radius:6px;border:none;' +
    'background:#b45309;color:#fff;cursor:pointer;}' +
    '.dc-confirm-no{padding:6px 14px;border-radius:6px;border:1px solid #666;' +
    'background:transparent;color:#ddd;cursor:pointer;}' +
    '@keyframes dc-blink{50%{opacity:0}}' +
    '@keyframes dc-progress-slide{0%{transform:translateX(-120%)}' +
    '100%{transform:translateX(260%)}}'
  );
}

/** Экспорт для тестов: роль сообщения -> css класс */
export { roleClass };
