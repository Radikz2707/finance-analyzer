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

/** Факты портфеля по умолчанию (пустые) */
function emptyFacts(): DirectorFactsContext {
  return {
    assetsAnalysis: [],
    totalPortfolioValue: 0,
    freeCashRub: 0,
  };
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
    // Создаём DirectorAgent
    const directorAgent = new DirectorAgent(undefined, {
      userName: 'Радик',
      includeAgentDetails: true,
    });
    directorAgent.setFacts(emptyFacts());
    directorAgent.createSession();

    // Делаем processDirectorMessage доступным глобально для inline-скрипта в report.html
    (window as unknown as Record<string, unknown>).processDirectorMessage = async (message: string): Promise<DirectorResponse> => {
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
