/**
 * Director Chat Init — инициализация чата Director в report.html
 *
 * Этот файл НЕ импортирует Node-модули (db-manager, memory-layer и т.д.),
 * поэтому работает в браузере без ошибок.
 */

import { DirectorAgent } from './director.js';
import type {
  DirectorFactsContext,
  DirectorResponse,
} from './director-types.js';
import { directorChatStyles } from './director-chat-widget.js';
import { createBrowserChatResponder } from './browser-chat-responder.js';

/** Факты портфеля по умолчанию (пустые) */
function emptyFacts(): DirectorFactsContext {
  return {
    assetsAnalysis: [],
    totalPortfolioValue: 0,
    freeCashRub: 0,
  };
}

/** Загрузить факты портфеля из глобальных данных или localStorage (если есть) */
function loadFactsFromWindow(): DirectorFactsContext {
  const win = window as unknown as {
    __DIRECTOR_FACTS__?: DirectorFactsContext;
  };
  if (win.__DIRECTOR_FACTS__) {
    return win.__DIRECTOR_FACTS__;
  }
  try {
    const saved = localStorage.getItem('portfolioFacts');
    if (saved) {
      const parsed = JSON.parse(saved) as DirectorFactsContext;
      if (Array.isArray(parsed.assetsAnalysis)) return parsed;
    }
  } catch {
    // localStorage недоступен или данные повреждены — используем пустые факты
  }
  return emptyFacts();
}

/** Инициализация Director-чата */
function initDirectorChat(): void {
  // Проверяем наличие контейнера
  const container = document.getElementById('directorChat');
  if (!container) {
    console.warn('[Director] Контейнер #directorChat не найден');
    return;
  }

  // Применяем стили чата (если ещё не добавлены)
  const styleId = 'director-chat-styles';
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = directorChatStyles();
    document.head.appendChild(styleEl);
  }

  try {
    // Создаём DirectorAgent. chatResponder даёт осмысленные ответы по фактам
    // портфеля даже без локального LLM (вместо фиксированной отмазки).
    const directorAgent = new DirectorAgent(undefined, {
      userName: 'Радик',
      includeAgentDetails: true,
      chatResponder: createBrowserChatResponder(),
    });
    directorAgent.setFacts(loadFactsFromWindow());
    directorAgent.createSession();

    // Делаем processDirectorMessage доступным глобально для inline-скрипта в report.html
    (window as unknown as Record<string, unknown>).processDirectorMessage =
      async (message: string): Promise<DirectorResponse> => {
        return directorAgent.processUserMessage(message);
      };

    console.log('🎯 Director: чат инициализирован');
  } catch (err) {
    console.warn('[Director] Ошибка инициализации:', err);
    container.innerHTML =
      '<p style="color:#8b949e;text-align:center;padding:20px;">Не удалось загрузить Director. Проверьте консоль.</p>';
  }
}

// Запускаем при загрузке DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDirectorChat);
} else {
  initDirectorChat();
}
