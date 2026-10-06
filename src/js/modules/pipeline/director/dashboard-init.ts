/**
 * Dashboard Init — инициализация Director-чата в dashboard.html
 * Загружается через webpack вместе с другими модулями
 *
 * Director с persistent memory (IndexedDB):
 * - Помнит историю портфеля, решения, диалоги
 * - Строит стратегический план
 * - Управляет агентами
 */

import { BrowserDirector } from './browser-director.js';
import type {
  DirectorFactsContext,
  DirectorResponse,
  ChatMessage,
} from './director-types.js';
import {
  mountDirectorChat,
  directorChatStyles,
} from './director-chat-widget.js';
import { detectDangerousIntent } from './director-chat-commands.js';

/** Факты портфеля по умолчанию (пустые) */
function emptyFacts(): DirectorFactsContext {
  return {
    assetsAnalysis: [],
    totalPortfolioValue: 0,
    freeCashRub: 0,
  };
}

/** Пустой план Director (для ответов об ошибке) */
function emptyDirectorPlan(): import('./director-types.js').DirectorPlan {
  return {
    taskId: '',
    userQuestion: '',
    goal: '',
    connectedAgents: [],
    agentAssignments: [],
    discussionTopics: [],
    needsConsilium: false,
    directorSynthesis: '',
  };
}

// Глобальная переменная для загрузки данных портфеля из dashboard.html
declare global {
  interface Window {
    portfolioFacts?: DirectorFactsContext;
    pipelineResult?: Record<string, unknown>;
  }
}

/** Загрузка фактов портфеля из pipeline result */
async function loadPortfolioFacts(): Promise<DirectorFactsContext> {
  try {
    const response = await fetch('/pipeline-result.json');
    if (!response.ok) throw new Error('Файл не найден');

    const result = await response.json();

    // Загружаем данные из data stage (не AI)
    const dataStage = result.stages?.data;
    if (!dataStage || !dataStage.result?.success) {
      console.warn('[Director] Data stage не выполнен');
      return emptyFacts();
    }

    const data = dataStage.result.data;
    if (!data) return emptyFacts();

    // Преобразуем aggregated данные в assetsAnalysis
    const assetsAnalysis = (data.aggregated || []).map(
      (asset: Record<string, unknown>) => ({
        ticker: (asset.ticker as string) || 'UNKNOWN',
        name: (asset.name as string) || (asset.ticker as string),
        assetType: (asset.assetType as string) || 'STOCK',
        currentPercent: (asset.totalLiquidationPercent as number) || 0,
        targetPercent: (asset.targetPercent as number) || 0,
        balancePrice: (asset.balancePrice as number) || 0,
        currentPrice: (asset.currentPrice as number) || 0,
        quantity: (asset.quantity as number) || 0,
        totalQuantity:
          (asset.totalQuantity as number) || (asset.quantity as number) || 0,
        unrealizedProfitRub: (asset.unrealizedProfitRub as number) || 0,
        totalUnrealizedProfitRub:
          (asset.totalUnrealizedProfitRub as number) ||
          (asset.unrealizedProfitRub as number) ||
          0,
        totalLiquidationValue: (asset.totalLiquidationValue as number) || 0,
        deficitRub: (asset.deficitRub as number) || 0,
        status: (asset.status as string) || 'STABLE',
        dynamicsPercent: (asset.dynamicsPercent as number) || 0,
        isConcentrated: (asset.isConcentrated as boolean) || false,
        nkdRub: (asset.nkdRub as number) || 0,
        nominal: (asset.nominal as number) || 0,
        priority: (asset.priority as number) || 0,
      }),
    );

    // Рассчитываем общую стоимость
    const totalPortfolioValue =
      ((data.aggregated as Record<string, unknown>[]) || []).reduce(
        (sum: number, a: Record<string, unknown>) =>
          sum + ((a.totalLiquidationValue as number) || 0),
        0,
      ) || 0;

    // Свободные средства
    const freeCashRub = data.investedFunds?.freeCash || 0;

    console.log('[Director] Загружено активов:', assetsAnalysis.length);
    console.log('[Director] Общая стоимость:', totalPortfolioValue);

    return {
      assetsAnalysis,
      totalPortfolioValue,
      freeCashRub,
    };
  } catch (err) {
    console.warn('[Director] Ошибка загрузки фактов портфеля:', err);
    return emptyFacts();
  }
}

/** Инициализация Director-чата */
async function initDirectorChat(): Promise<void> {
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
    console.log(
      '[Director] Инициализация BrowserDirector с persistent memory...',
    );

    // Создаём BrowserDirector
    const directorAgent = new BrowserDirector({
      userName: 'Радик',
    });

    // Инициализируем (загрузка истории из IndexedDB)
    await directorAgent.init();
    console.log('[Director] Persistent memory загружена');

    // Загружаем факты портфеля
    const facts = await loadPortfolioFacts();
    directorAgent.setFacts(facts);
    console.log(
      `[Director] Портфель: ${facts.totalPortfolioValue.toLocaleString()} ₽`,
    );

    // Создаём сессию
    directorAgent.createSession();

    // Отправляем проактивное сообщение с информацией о возможностях
    const proactiveMessage = `👋 Привет, Радик!

Я — твой инвестиционный координатор. Вот что я умею:

📊 **История портфеля**
- Отслеживаю изменения портфеля
- Помню все прошлые решения
- Анализирую результаты

🎯 **Стратегическое планирование**
- Строю долгосрочную стратегию
- Корректирую план при изменениях
- Предупреждаю о рисках

🤖 **Управление агентами**
- 8 специализированных агентов
- Контролирую их работу
- Оптимизирую задачи

💡 **Проактивные рекомендации**
- Предупреждаю о возможностях
- Советую при изменениях рынка
- Помогаю принимать решения

⌨️ **Команды**
- /status — статус Director и задач
- /log [N] — последние N действий
- /undo — отмена последнего действия (ограниченно)
- /help — справка по командам

Спроси меня о портфеле, стратегии или конкретных активах!`;

    // API для чат-виджета
    const api = {
      processUserMessage: async (
        message: string,
      ): Promise<DirectorResponse> => {
        try {
          console.log('[API] processUserMessage:', message.slice(0, 50));
          const response = await directorAgent.processUserMessage(message);
          console.log('[API] Response received:', response.text?.slice(0, 100));
          return response;
        } catch (err) {
          console.error('[API] Error processing message:', err);
          return {
            text: `❌ Ошибка: ${err instanceof Error ? err.message : String(err)}`,
            plan: emptyDirectorPlan(),
            connectedAgents: [] as import('./director-types.js').AgentRole[],
            needsConsilium: false,
          };
        }
      },
      getChatHistory: (): ChatMessage[] => {
        return directorAgent.getChatHistory();
      },
      getProactiveMessages: () => {
        return [];
      },
      /**
       * Детекция опасных паттернов в сообщении пользователя.
       * Перед отправкой Director виджет покажет кнопку «Подтвердить».
       */
      assessDanger: (message: string) => detectDangerousIntent(message),
      /** Выполнить сообщение после подтверждения пользователем */
      confirmDangerousAction: async (
        message: string,
      ): Promise<DirectorResponse> => {
        console.log(
          '[API] Подтверждено опасное действие:',
          message.slice(0, 60),
        );
        return directorAgent.processUserMessage(message);
      },
    };

    // Монтируем чат-виджет
    mountDirectorChat(api);

    // Отправляем проактивное сообщение
    await directorAgent.processUserMessage(proactiveMessage);

    console.log('🎯 BrowserDirector: инициализирован с persistent memory');
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
