/**
 * DirectorAgent — упрощённый координатор инвестиционного анализа.
 *
 * Director:
 * - разговаривает с пользователем естественным языком;
 * - понимает контекст предыдущих разговоров;
 * - делегирует задачи агентам и собирает результаты;
 * - формирует итоговый вывод.
 */

import type { AgentState } from '../agent/types.js';
import type {
  ChatMessage,
  DirectorFactsContext,
  DirectorResponse,
  InterpretedQuestion,
} from './director-types.js';

/** Зависимости Director (DI) */
export interface DirectorAgentDeps {
  initialFacts?: DirectorFactsContext;
  userName?: string;
}

/** Пустые факты по умолчанию */
function emptyFacts(): DirectorFactsContext {
  return {
    assets: [],
    macro: {
      totalBalance: 0,
      freeCash: 0,
      stocksPercent: 0,
      bondsPercent: 0,
    },
  };
}

/**
 * DirectorAgent — главный координатор.
 */
export class DirectorAgent {
  private _state: AgentState = 'idle';
  private facts: DirectorFactsContext;
  private sessions: Map<string, { messages: ChatMessage[] }> = new Map();
  private currentSessionId: string | null = null;
  private readonly _userName: string;
  private readonly maxSessions = 50;
  private readonly sessionMaxAgeMs = 24 * 3600_000; // 24 часа

  constructor(_config?: unknown, deps?: DirectorAgentDeps) {
    this.facts = deps?.initialFacts ?? emptyFacts();
    this._userName = deps?.userName ?? 'User';
    void this._userName;
  }

  get state(): AgentState {
    return this._state;
  }

  /** Установить факты портфеля */
  setFacts(facts: DirectorFactsContext): void {
    this.facts = facts;
  }

  /** Создать новую сессию чата */
  createSession(): string {
    const id = `session_${Date.now()}`;
    this.sessions.set(id, { messages: [] });
    this.currentSessionId = id;
    this.cleanupOldSessions();
    return id;
  }

  /** Удалить сессию по ID */
  deleteSession(id: string): void {
    this.sessions.delete(id);
    if (this.currentSessionId === id) {
      this.currentSessionId = null;
    }
  }

  /** Очистить старые сессии */
  private cleanupOldSessions(): void {
    const cutoff = Date.now() - this.sessionMaxAgeMs;
    for (const [id, session] of this.sessions) {
      const lastMsg = session.messages[session.messages.length - 1];
      if (lastMsg && new Date(lastMsg.timestamp).getTime() < cutoff) {
        this.sessions.delete(id);
      }
    }
    // Если сессий больше лимита — удаляем самые старые
    while (this.sessions.size > this.maxSessions) {
      const oldest = Array.from(this.sessions.entries()).sort(
        (a, b) =>
          new Date(a[1].messages[0]?.timestamp ?? '').getTime() -
          new Date(b[1].messages[0]?.timestamp ?? '').getTime(),
      )[0];
      if (oldest) this.sessions.delete(oldest[0]);
    }
  }

  /** Получить историю чата */
  getChatHistory(): ChatMessage[] {
    if (!this.currentSessionId) return [];
    const session = this.sessions.get(this.currentSessionId);
    return session?.messages ?? [];
  }

  /** Получить проактивные сообщения */
  getProactiveMessages(): string[] {
    return [];
  }

  /** Сбросить кэш анализа (заглушка) */
  resetAnalysisCache(): void {
    // Заглушка — кэш не используется
  }

  /** Ленивый анализ портфеля (запуск pipeline) */
  async runLazyAnalysis(): Promise<string> {
    // Заглушка — ленивый анализ не реализован
    return 'Ленивый анализ не поддерживается. Используйте «Запустить анализ» для полного конвейера.';
  }

  /**
   * Обработать сообщение пользователя.
   * Использует факты портфеля для формирования ответа.
   */
  async processUserMessage(message: string): Promise<DirectorResponse> {
    this._state = 'running';

    // Интерпретировать вопрос
    const interpreted = this.interpretQuestion(message);

    // Добавить в историю
    if (this.currentSessionId) {
      const session = this.sessions.get(this.currentSessionId);
      if (session) {
        session.messages.push({
          id: `msg_${Date.now()}`,
          role: 'user',
          content: message,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Сформировать ответ на основе фактов
    const response = this.buildResponse(interpreted);

    // Добавить ответ в историю
    if (this.currentSessionId) {
      const session = this.sessions.get(this.currentSessionId);
      if (session) {
        session.messages.push({
          id: `msg_${Date.now() + 1}`,
          role: 'assistant',
          content: response.text,
          timestamp: new Date().toISOString(),
        });
      }
    }

    this._state = 'idle';
    return response;
  }

  /** Интерпретировать вопрос пользователя */
  private interpretQuestion(message: string): InterpretedQuestion {
    const lower = message.toLowerCase();

    if (
      lower.includes('сравн') ||
      lower.includes('чем') ||
      lower.includes('отличает')
    ) {
      return {
        category: 'comparison',
        entities: this.extractTickers(message),
        intent: 'сравнение активов',
        confidence: 0.8,
      };
    }

    if (lower.includes('портфел') || lower.includes('портфель')) {
      return {
        category: 'portfolio',
        entities: [],
        intent: 'вопрос по портфелю',
        confidence: 0.7,
      };
    }

    if (
      lower.includes('сценар') ||
      lower.includes('если') ||
      lower.includes('что будет')
    ) {
      return {
        category: 'scenario',
        entities: this.extractTickers(message),
        intent: 'сценарный анализ',
        confidence: 0.75,
      };
    }

    if (
      lower.includes('стратег') ||
      lower.includes('перспектив') ||
      lower.includes('развит')
    ) {
      return {
        category: 'strategy',
        entities: [],
        intent: 'стратегический вопрос',
        confidence: 0.7,
      };
    }

    return {
      category: 'asset',
      entities: this.extractTickers(message),
      intent: 'общий вопрос',
      confidence: 0.5,
    };
  }

  /** Извлечь тикеры из сообщения */
  private extractTickers(message: string): string[] {
    const tickers: string[] = [];
    const words = message.split(/\s+/);
    for (const word of words) {
      if (/^[A-Z]{2,10}$/.test(word)) {
        tickers.push(word);
      }
    }
    return tickers;
  }

  /** Сформировать ответ на основе фактов */
  private buildResponse(
    interpreted: InterpretedQuestion,
  ): DirectorResponse {
    const assets = this.facts.assets;
    const macro = this.facts.macro;
    const assetsAnalysis = this.facts.assetsAnalysis;

    // Базовый ответ
    let response = 'Привет! Я Director — инвестиционный координатор.\n\n';
    response += 'Ваш портфель:\n';
    response += `  Общая стоимость: ${Math.round(macro.totalBalance).toLocaleString('ru-RU')} ₽\n`;
    response += `  Свободный кэш: ${Math.round(macro.freeCash).toLocaleString('ru-RU')} ₽\n`;
    response += `  Акции: ${macro.stocksPercent.toFixed(1)}% | Облигации: ${macro.bondsPercent.toFixed(1)}%\n\n`;

    // Ответ на основе интерпретации
    if (interpreted.category === 'portfolio') {
      response += `В вашем портфеле ${assets.length} позиций.\n`;
      if (assetsAnalysis && assetsAnalysis.length > 0) {
        response += '\nТоп-5 активов:\n';
        for (const a of assetsAnalysis.slice(0, 5)) {
          response += `  • ${a.ticker}: ${a.currentPercent.toFixed(1)}% (${Math.round(a.currentPrice * a.quantity).toLocaleString('ru-RU')} ₽)\n`;
        }
      }
    } else if (interpreted.category === 'comparison') {
      response += 'Для сравнения активов нужно указать тикеры.\n';
      if (interpreted.entities.length > 0) {
        response += `\nТикеры: ${interpreted.entities.join(', ')}\n`;
      }
    } else if (interpreted.category === 'scenario') {
      response += 'Сценарный анализ требует запуска pipeline.\n';
      response += 'Запустите `npm run pipeline` для получения рекомендаций.\n';
    } else if (interpreted.category === 'strategy') {
      response += 'Стратегический анализ:\n';
      response += '  - Диверсифицируйте портфель (не более 20% в один актив)\n';
      response += '  - Следите за соотношением акции/облигации\n';
      response += '  - Используйте свободный кэш для покупки дефицитных позиций\n';
    } else {
      response += 'Я могу помочь с:\n';
      response += '  • Анализом портфеля\n';
      response += '  • Сравнением активов\n';
      response += '  • Сценарным анализом\n';
      response += '  • Стратегическими рекомендациями\n';
    }

    return {
      text: response,
      agentsUsed: [],
      pipelineId: undefined,
    };
  }
}
