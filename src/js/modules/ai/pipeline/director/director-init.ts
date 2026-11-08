/**
 * Инициализация Director Agent (чат-интерфейс инвестиционного координатора).
 *
 * Вынесена из app.ts для соблюдения separation of concerns:
 * каждый модуль отвечает за свою инициализацию.
 */
import { DirectorAgent } from './director.js';
import type {
  DirectorFactsContext,
  DirectorResponse,
} from './director-types.js';

/** Агент Director для чата */
let directorAgent: DirectorAgent | null = null;

/**
 * Инициализация Director Agent.
 *
 * Читает факты портфеля из localStorage, создаёт DirectorAgent
 * и монтирует чат-виджет в DOM.
 */
export function initDirectorChat(): void {
  // Проверяем наличие контейнера
  const container = document.getElementById('directorChat');
  if (!container) return;

  // Применяем стили чата (если ещё не добавлены)
  const styleId = 'director-chat-styles';
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `
      .director-chat-container{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px;margin:20px auto;max-width:640px;font-family:system-ui,sans-serif;}
      .director-chat-container h3{color:#58a6ff;margin:0 0 15px 0;font-size:16px;}
      .director-chat-messages{max-height:400px;overflow-y:auto;margin-bottom:15px;padding:10px;background:#0d1117;border-radius:8px;display:flex;flex-direction:column;gap:8px;}
      .dc-msg{padding:8px 10px;border-radius:8px;max-width:92%;white-space:pre-wrap;}
      .dc-msg-user{align-self:flex-end;background:#2d5aa0;}
      .dc-msg-director{align-self:flex-start;background:#3a3a4c;}
      .dc-role{font-size:11px;opacity:.7;margin-bottom:2px;}
      .dc-text{font-size:14px;line-height:1.45;color:#c9d1d9;}
      .director-chat-input-container{display:flex;gap:8px;}
      .director-chat-input{flex:1;padding:8px 10px;border-radius:8px;border:1px solid #555;background:#14141f;color:#eee;font-size:14px;}
      .director-chat-input:focus{outline:none;border-color:#58a6ff;}
      .director-chat-send{padding:8px 16px;border-radius:8px;border:none;background:#2d5aa0;color:#fff;cursor:pointer;font-size:14px;}
      .director-chat-send:hover{background:#3a7bd5;}
      .director-chat-send:disabled{background:#30363d;color:#8b949e;cursor:not-allowed;}
    `;
    document.head.appendChild(styleEl);
  }

  try {
    // Формируем факты портфеля из localStorage (если есть)
    const savedFacts = localStorage.getItem('portfolioFacts');
    const facts: DirectorFactsContext = savedFacts
      ? JSON.parse(savedFacts)
      : {
          assets: [],
          macro: {
            totalBalance: 0,
            freeCash: 0,
            stocksPercent: 0,
            bondsPercent: 0,
          },
        };

    // Создаём DirectorAgent
    directorAgent = new DirectorAgent(undefined, {
      userName: 'Радик',
    });
    directorAgent.setFacts(facts);
    directorAgent.createSession();

    // Делаем processDirectorMessage доступным глобально
    (window as unknown as Record<string, unknown>).processDirectorMessage =
      async (message: string): Promise<DirectorResponse> => {
        return directorAgent!.processUserMessage(message);
      };

    console.log('🎯 Director: чат инициализирован');
  } catch (err) {
    console.warn('[Director] Ошибка инициализации:', err);
    container.innerHTML =
      '<p style="color:#8b949e;text-align:center;padding:20px;">Не удалось загрузить Director. Проверьте консоль.</p>';
  }
}

/** Получить текущий агент Director (для тестов и внешних вызовов) */
export function getDirectorAgent(): DirectorAgent | null {
  return directorAgent;
}
