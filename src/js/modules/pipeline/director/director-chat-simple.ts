/**
 * Director Chat — полностью изолированный чат для report.html
 * НЕ импортирует Node-модули, работает в браузере через file://
 */

(function () {
  'use strict';

  // Обработка системных команд (/status, /log, /undo, /help) в простом режиме.
  // Честный ответ: полные данные доступны только на dashboard (npm run dev).
  function handleSystemCommand(message: string): string | null {
    const lower = message.toLowerCase().trim();
    if (lower === '/help' || lower === 'помощь') {
      return (
        '⌨️ Команды чата:\n' +
        '• /status — статус Director\n' +
        '• /log — последние действия\n' +
        '• /undo — отмена последнего действия\n' +
        '• /help — справка'
      );
    }
    if (lower === '/status') {
      return (
        '📡 Статус Director:\n' +
        'Режим: упрощённый (report.html), агенты недоступны.\n' +
        'Полный статус всех агентов смотрите на dashboard:\n' +
        'npm run dev → http://localhost:8080/components/dashboard/dashboard.html'
      );
    }
    if (lower === '/log') {
      return (
        '📋 В упрощённом режиме аудит-лог недоступен.\n' +
        'История действий Director ведётся на dashboard (npm run dev).'
      );
    }
    if (lower === '/undo') {
      return (
        '↩️ В упрощённом режиме отмена действий недоступна.\n' +
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

  // Простая заглушка Director — отвечает без подключения агентов
  // (агенты требуют Node.js и не работают в браузере)
  function simpleDirectorResponse(message: string): string {
    const commandReply = handleSystemCommand(message);
    if (commandReply) return commandReply;

    const responses: string[] = [
      '🎯 Я — Director, инвестиционный координатор.\n\n' +
        'К сожалению, в браузере я не могу подключать подчинённых агентов\n' +
        '(AnalysisAgent, ResearchAgent, AI Agent и др.), так как они требуют Node.js.\n\n' +
        '💡 Чтобы использовать Director с полным функционалом:\n' +
        '1. Запустите npm run dev (gulp)\n' +
        '2. Откройте http://localhost:8080/components/dashboard/dashboard.html\n' +
        '3. Там Director работает со всеми агентами!\n\n' +
        'Или запустите npm run pipeline — Director будет встроен в report.html.',

      '📊 Ваш портфель:\n' +
        'В report.html выше вы видите:\n' +
        '- AI-рекомендации по каждому активу\n' +
        '- Конфликты рекомендаций (PortfolioMath vs AI)\n' +
        '- Сценарии "что если"\n' +
        '- Приоритеты rebalance\n\n' +
        'Для интерактивного общения с Director откройте dashboard через npm run dev',

      '🤔 Для анализа вашего портфеля я могу:\n' +
        '- Объяснить конфликты рекомендаций\n' +
        '- Показать статистику по активам\n' +
        '- Рассчитать риски концентрации\n\n' +
        'Но для полноценного анализа с AI-агентами используйте dashboard',
    ];

    // Простой ответ на основе ключевых слов
    const lower = message.toLowerCase();
    if (lower.indexOf('portfel') !== -1 || lower.indexOf('портфел') !== -1) {
      return responses[1] as string;
    }
    if (lower.indexOf('почему') !== -1 || lower.indexOf('почем') !== -1) {
      return responses[2] as string;
    }
    return responses[0] as string;
  }

  // Инициализация чата
  const container = document.getElementById('directorChat');
  if (!container) {
    console.warn('[Director] Контейнер #directorChat не найден');
    return;
  }

  const messagesEl = container.querySelector('#directorChatMessages');
  const inputEl =
    container.querySelector<HTMLInputElement>('#directorChatInput');
  const sendBtn =
    container.querySelector<HTMLButtonElement>('#directorChatSend');

  const history: Array<{ role: string; text: string }> = [];

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

  function sendMessage(): void {
    if (!inputEl || !sendBtn) return;
    const text = inputEl.value.trim();
    if (!text) return;

    addMsg('user', text);
    inputEl.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = 'Думаю...';

    // Имитация задержки "мышления"
    setTimeout(function () {
      const response = simpleDirectorResponse(text);
      addMsg('director', response);
      sendBtn.disabled = false;
      sendBtn.textContent = 'Отправить';
    }, 500);
  }

  if (sendBtn) sendBtn.addEventListener('click', sendMessage);
  if (inputEl)
    inputEl.addEventListener('keydown', function (e: KeyboardEvent) {
      if (e.key === 'Enter') sendMessage();
    });

  console.log('🎯 Director: чат инициализирован (простой режим)');
})();
