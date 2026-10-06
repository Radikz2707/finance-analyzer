/**
 * BrowserDirector — полноценный инвестиционный координатор для браузера.
 *
 * Возможности:
 * - Persistent memory (IndexedDB) — помнит всё между сессиями
 * - Стратегическое планирование — строит долгосрочную финансовую стратегию
 * - Управление агентами — оценивает эффективность, корректирует задачи
 * - LLM-генерация ответов через Ollama — естественный диалог
 * - Полная замена пользователя — действует в его интересах
 */

import { parseUserMessage } from './nl-parser.js';
import {
  DirectorDelegationPlanner,
  AGENT_ROLE_LABELS,
} from './delegation-planner.js';
import { DirectorAgentFacade } from './agent-facade.js';
import { DirectorChatStore } from './chat-session.js';
import { BrowserPersistentMemory } from './browser-persistent-memory.js';
import { OllamaClient } from './ollama-client.js';
import { buildInvestmentAdvisorPrompt } from './ollama-system-prompt.js';
import { NewsCache } from '../gatekeeper/news-cache.js';
import type { NewsTrend } from '../gatekeeper/news-cache.js';
import { RAGEngine } from '../../rag/rag-engine.js';
import { VectorStore } from '../../rag/vector-store.js';
import type {
  DirectorConfig,
  DirectorResponse,
  DirectorPlan,
  AgentResultEntry,
  DirectorFactsContext,
  ProactiveMessage,
  ChatMessage,
} from './director-types.js';
import type { AgentRole } from './director-types.js';
import type {
  PortfolioSnapshot,
  StrategicPlan,
  AgentPerformance,
  ChatMessage as StoredChatMessage,
} from './browser-persistent-memory.js';
import type { DocumentVector } from '../../rag/vector-store.js';

// ──────────────────────────────────────────────
// Helper functions
// ──────────────────────────────────────────────

function generateId(): string {
  return `dir-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyFacts(): DirectorFactsContext {
  return {
    assetsAnalysis: [],
    totalPortfolioValue: 0,
    freeCashRub: 0,
  };
}

// ──────────────────────────────────────────────
// BrowserDirector
// ──────────────────────────────────────────────

export class BrowserDirector {
  private planner: DirectorDelegationPlanner;
  private facade: DirectorAgentFacade;
  private memory: BrowserPersistentMemory;
  private chat: DirectorChatStore;
  private ollama: OllamaClient;
  private newsCache: NewsCache;
  private vectorStore: VectorStore;
  private ragEngine: RAGEngine;

  private facts: DirectorFactsContext;
  private currentSessionId: string | null = null;
  private initialized = false;
  private strategicPlan: StrategicPlan | null = null;
  private portfolioHistory: PortfolioSnapshot[] = [];
  private chatHistory: Array<{ role: string; content: string }> = [];

  constructor(_config: DirectorConfig = {}) {
    this.facts = emptyFacts();
    this.memory = new BrowserPersistentMemory();
    this.chat = new DirectorChatStore({ maxMessagesPerSession: 200 });
    this.planner = new DirectorDelegationPlanner();
    this.facade = new DirectorAgentFacade();
    this.ollama = new OllamaClient({ model: 'qwen3:14b' });
    this.newsCache = new NewsCache();
    this.vectorStore = new VectorStore();
    this.ragEngine = new RAGEngine({
      vectorStore: this.vectorStore,
      ollamaModel: 'qwen3:14b',
      maxContextDocuments: 5,
      maxContextLength: 8000,
    });
    this.ragEngine.setOllamaClient(this.ollama);
  }

  /** Инициализация (загрузка истории из IndexedDB) */
  async init(): Promise<void> {
    if (this.initialized) return;

    await this.memory.init();

    // Загружаем историю портфеля
    this.portfolioHistory = await this.memory.getPortfolioHistory();

    // Загружаем стратегический план
    const activePlan = await this.memory.getActiveStrategicPlan();
    if (activePlan) {
      this.strategicPlan = activePlan;
    }

    // Загружаем предпочтения (заглушка)
    // const prefs = await this.memory.getUserPreferences();
    // if (prefs) {
    //   this.userPreferences = prefs;
    // }

    this.initialized = true;
    console.log('[BrowserDirector] Инициализация завершена');
    console.log(
      `  - Исторических снимков портфеля: ${this.portfolioHistory.length}`,
    );
    console.log(
      `  - Стратегический план: ${this.strategicPlan ? 'активен' : 'отсутствует'}`,
    );
  }

  setFacts(facts: DirectorFactsContext): void {
    const oldTotal = this.facts.totalPortfolioValue;
    this.facts = facts;

    // Если портфель значительно изменился, создаём снимок
    if (
      oldTotal > 0 &&
      Math.abs(facts.totalPortfolioValue - oldTotal) / oldTotal > 0.01
    ) {
      this.savePortfolioSnapshot();
    }
  }

  createSession(): string {
    const session = this.chat.createSession();
    this.currentSessionId = session.sessionId;
    return this.currentSessionId!;
  }

  getChatHistory(): ChatMessage[] {
    if (!this.currentSessionId) return [];
    const history = this.chat.getHistory(this.currentSessionId);
    return history.map((msg) => ({
      id: msg.id || generateId(),
      role: msg.role,
      text: msg.text,
      isWorking: msg.isWorking,
      timestamp: msg.timestamp,
    }));
  }

  /** Получить полную историю чата из IndexedDB */
  async getFullChatHistory(): Promise<StoredChatMessage[]> {
    return await this.memory.getChatHistory();
  }

  getProactiveMessages(): ProactiveMessage[] {
    return [];
  }

  /** Получить историю портфеля */
  async getPortfolioHistory(): Promise<PortfolioSnapshot[]> {
    return this.portfolioHistory;
  }

  /** Получить стратегический план */
  async getStrategicPlan(): Promise<StrategicPlan | null> {
    return this.strategicPlan;
  }

  /** Получить статистику памяти */
  async getMemoryStats(): Promise<Record<string, number>> {
    return await this.memory.getMemoryStats();
  }

  /** Получить производительность агентов */
  async getAgentPerformance(): Promise<AgentPerformance[]> {
    return await this.memory.getAllAgentPerformance();
  }

  async processUserMessage(rawMessage: string): Promise<DirectorResponse> {
    const message = rawMessage.trim();
    if (!this.currentSessionId) {
      this.createSession();
    }

    console.log('[BrowserDirector] Вопрос:', message.slice(0, 100));

    // Сохраняем сообщение пользователя
    const userMessage = {
      id: generateId(),
      date: new Date().toISOString(),
      role: 'user' as const,
      text: message,
      tickers: [],
    };
    await this.memory.saveMessage(userMessage);
    this.chat.appendMessage(this.currentSessionId!, 'user', message);

    // --- Обработка простых вопросов ---
    const lowerMessage = message.toLowerCase();

    if (
      /^(привет|здравствуй|хай|hello|hi|hey|добрый|йо|здарова)/i.test(
        lowerMessage,
      )
    ) {
      const greeting = this.buildGreeting();
      await this.saveChatMessage('director', greeting);
      return this.createResponse(greeting, []);
    }

    if (/как (у тебя|дела|сам|настроение)/i.test(lowerMessage)) {
      const answer =
        'У меня всё отлично, Радик! Готов помогать с твоим портфелем. 🚀\n\nСпроси меня о:\n• Состоянии портфеля\n• Конкретных акциях\n• Рекомендациях по покупке/продаже\n• Рисках и стратегии';
      await this.saveChatMessage('director', answer);
      return this.createResponse(answer, []);
    }

    if (/что (ты|можешь)|помощь|help|функции/i.test(lowerMessage)) {
      const answer =
        'Я — твой инвестиционный координатор. Вот что я умею:\n\n' +
        '📊 **Анализ портфеля** — покажу текущее состояние, P&L, структуру\n' +
        '🎯 **Рекомендации** — покупать, продавать или удерживать\n' +
        '⚠️ **Риски** — предупрежу о концентрации, просадках\n' +
        '📈 **Стратегия** — помогу построить долгосрочный план\n\n' +
        'Просто спроси о чём-нибудь конкретном!';
      await this.saveChatMessage('director', answer);
      return this.createResponse(answer, []);
    }

    if (/^(пока|до свидания|прощай|bye|see you)/i.test(lowerMessage)) {
      const answer = 'До встречи, Радик! Буду ждать тебя снова. 🤝';
      await this.saveChatMessage('director', answer);
      return this.createResponse(answer, []);
    }

    // --- Сложный вопрос — запускаем агентов и отправляем в LLM ---

    console.log(
      '[BrowserDirector] Портфель:',
      this.facts.assetsAnalysis.length,
      'активов, стоимость:',
      this.facts.totalPortfolioValue,
    );

    // Запускаем агентов
    const agentResults = await this.runAgents(message);
    console.log('[BrowserDirector] Результаты агентов:', agentResults.length);

    // Запускаем консилиум если агенты спорят
    let consiliumSummary = '';
    const hasDisagreement = this.detectDisagreement(agentResults);

    if (hasDisagreement) {
      console.log(
        '[BrowserDirector] Обнаружены разногласия — запускаем консилиум',
      );
      consiliumSummary = await this.runConsilium(agentResults, message);
    }

    // Формируем контекст для LLM
    const llmContext = this.buildLlmContext(agentResults, consiliumSummary);

    // Генерируем ответ через Ollama
    let finalSynthesis: string;
    try {
      const systemPrompt = buildInvestmentAdvisorPrompt();
      const chatHistory = this.chatHistory.slice(-10); // Последние 10 сообщений

      const messages: import('./ollama-client.js').OllamaMessage[] = [
        { role: 'system', content: systemPrompt },
        ...(chatHistory as Array<{
          role: 'system' | 'user' | 'assistant';
          content: string;
        }>),
        {
          role: 'user',
          content: llmContext
            ? `Данные портфеля:\n${llmContext}\n\nВопрос пользователя: ${message}`
            : message,
        },
      ];

      finalSynthesis = await this.ollama.chat(messages);
      console.log('[BrowserDirector] LLM ответ:', finalSynthesis.slice(0, 200));
    } catch (err) {
      console.warn('[BrowserDirector] Ошибка LLM, fallback к шаблону:', err);
      // Fallback — показываем сырые данные
      finalSynthesis =
        'Не удалось сгенерировать ответ через LLM. Данные агентов:\n\n';
      for (const result of agentResults) {
        const data = result.data as Record<string, unknown> | undefined;
        if (result.success && data?.summary) {
          finalSynthesis += `• ${AGENT_ROLE_LABELS[result.role] || result.role}: ${data.summary}\n`;
        }
      }
      finalSynthesis += '\n⚠️ Это рекомендация, а не совет к действию.';
    }

    // Сохраняем ответ
    await this.saveChatMessage('director', finalSynthesis);

    const agentLabels = agentResults.map(
      (r) => AGENT_ROLE_LABELS[r.role] || r.role,
    );

    return {
      text: finalSynthesis,
      plan: this.buildDirectorPlan(
        agentLabels as unknown as AgentRole[],
        message,
        finalSynthesis,
      ),
      connectedAgents: agentLabels as unknown as AgentRole[],
      needsConsilium: false,
    };
  }

  private async runAgents(question: string): Promise<AgentResultEntry[]> {
    const interpreted = parseUserMessage(question);
    const plan = this.planner.buildPlan(interpreted, '');

    if (plan.connectedAgents.length === 0) {
      return [];
    }

    try {
      const results = await this.facade.executeRoles(
        plan.connectedAgents,
        interpreted,
        this.facts,
      );

      // Мониторим производительность
      for (const result of results) {
        await this.memory.updateAgentTaskCount(
          result.role,
          result.success,
          result.durationMs || 0,
        );
      }

      return results;
    } catch (err) {
      console.warn('[BrowserDirector] Ошибка агентов:', err);
      return [];
    }
  }

  /** Проверить, спорят ли агенты */
  private detectDisagreement(agentResults: AgentResultEntry[]): boolean {
    const actions: string[] = [];

    for (const result of agentResults) {
      const data = result.data as { opinion?: { action?: string } } | undefined;

      if (!result.success || !data) continue;

      // Собираем действия от AI и Strategist
      if (result.role === 'ai' && data?.opinion?.action) {
        actions.push(data.opinion.action);
      }

      if (result.role === 'strategist' && data?.opinion?.action) {
        actions.push(data.opinion.action);
      }
    }

    // Если есть BUY и SELL/REDUCE одновременно — спорим
    const hasBuy = actions.includes('BUY');
    const hasSell = actions.includes('SELL') || actions.includes('REDUCE');
    const hasExit = actions.includes('EXIT');

    return (hasBuy && (hasSell || hasExit)) || (hasSell && hasExit);
  }

  /** Запустить консилиум — multi-round discussion */
  private async runConsilium(
    agentResults: AgentResultEntry[],
    question: string,
  ): Promise<string> {
    const maxRounds = 2;
    let currentResults = agentResults;

    for (let round = 1; round <= maxRounds; round++) {
      console.log(`[Consilium] Раунд ${round}/${maxRounds}`);

      // Формируем дискуссию для LLM
      const discussion = this.buildConsiliumDiscussion(
        currentResults,
        question,
      );

      if (!discussion) break;

      // Отправляем в LLM для симуляции обсуждения
      try {
        const systemPrompt = `Ты — модератор консилиума инвестиционных агентов.

Твоя задача:
1. Прочитай мнения агентов
2. Определи, есть ли конфликт мнений
3. Если есть конфликт — сформулируй вопросы для уточнения
4. Если нет — дай краткий консенсус

Отвечай кратко, на русском языке.`;

        const response = await this.ollama.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: discussion },
        ]);

        console.log(`[Consilium] Раунд ${round}:`, response.slice(0, 100));

        // Сохраняем результат раунда
        currentResults = this.mergeConsiliumResults(currentResults, response);
      } catch (err) {
        console.warn('[Consilium] Ошибка раунда:', err);
        break;
      }
    }

    // Формируем итоговое резюме
    return this.buildConsiliumSummary(currentResults);
  }

  /** Построить дискуссию для консилиума */
  private buildConsiliumDiscussion(
    agentResults: AgentResultEntry[],
    question: string,
  ): string {
    let discussion = `Вопрос пользователя: ${question}\n\n`;

    for (const result of agentResults) {
      const data = result.data as
        | {
            summary?: string;
            opinion?: {
              position?: string;
              action?: string;
              arguments?: string[];
            };
          }
        | undefined;
      const agentName = AGENT_ROLE_LABELS[result.role] || result.role;

      if (!result.success || !data) continue;

      discussion += `--- ${agentName} ---\n`;

      if (data.summary) {
        discussion += `${data.summary}\n`;
      }

      if (data.opinion) {
        discussion += `Мнение: ${data.opinion.position}\n`;
        if (data.opinion.action) {
          discussion += `Действие: ${data.opinion.action}\n`;
        }
        if (
          data.opinion.arguments?.length &&
          data.opinion.arguments.length > 0
        ) {
          discussion += `Аргументы: ${data.opinion.arguments.join('; ')}\n`;
        }
      }

      discussion += '\n';
    }

    return discussion;
  }

  /** Объединить результаты консилиума */
  private mergeConsiliumResults(
    originalResults: AgentResultEntry[],
    consiliumResponse: string,
  ): AgentResultEntry[] {
    // В упрощённой версии просто добавляем результат консилиума
    return [
      ...originalResults,
      {
        role: 'consilium' as unknown as AgentRole,
        taskId: 'consilium',
        success: true,
        data: {
          summary: `Консилиум: ${consiliumResponse.slice(0, 200)}`,
          sources: ['Consilium'],
        },
        error: undefined,
        durationMs: 0,
        completedAt: new Date().toISOString(),
      } as unknown as AgentResultEntry,
    ];
  }

  /** Построить резюме консилиума */
  private buildConsiliumSummary(agentResults: AgentResultEntry[]): string {
    const consiliumResult = agentResults.find(
      (r) => (r as unknown as Record<string, unknown>).role === 'consilium',
    );

    if (!consiliumResult || !consiliumResult.data) {
      return '';
    }

    // Данные консилиума формируются внутренним mergeConsiliumResults(),
    // поэтому достаточно типизированного чтения поля summary.
    const data = consiliumResult.data as { summary?: string };
    if (!data?.summary) return '';

    return `\n\n🤝 **Консилиум:** ${data.summary}`;
  }

  /** Построить контекст для LLM */
  private buildLlmContext(
    agentResults: AgentResultEntry[],
    consiliumSummary?: string,
  ): string {
    if (agentResults.length === 0) return '';

    let context = `Портфель: ${this.formatCurrency(this.facts.totalPortfolioValue)} ₽, ${this.facts.assetsAnalysis.length} активов\n\n`;

    for (const result of agentResults) {
      const data = result.data as
        | {
            summary?: string;
            opinion?: { position?: string; action?: string };
            detail?: {
              factsLines?: string[];
              decisions?: Array<{
                ticker?: string;
                finalAction?: string;
                suggestedAction?: string;
              }>;
            };
          }
        | undefined;
      if (!result.success || !data) continue;

      if (data.summary) {
        context += `${data.summary}\n`;
      }

      if (data.opinion?.position) {
        context += `Позиция: ${data.opinion.position}\n`;
      }

      if (data.opinion?.action) {
        context += `Действие: ${data.opinion.action}\n`;
      }

      if (data.detail?.factsLines) {
        context += `Данные:\n${data.detail.factsLines.slice(0, 5).join('\n')}\n`;
      }

      if (data.detail?.decisions) {
        for (const dec of data.detail.decisions.slice(0, 5)) {
          context += `${dec.ticker || ''}: ${dec.finalAction || dec.suggestedAction || 'HOLD'}\n`;
        }
      }

      context += '\n';
    }

    if (consiliumSummary) {
      context += `--- Консилиум ---\n${consiliumSummary}\n\n`;
    }

    return context;
  }

  private async saveChatMessage(
    role: 'user' | 'director',
    content: string,
  ): Promise<void> {
    this.chatHistory.push({ role, content });

    const message = {
      id: generateId(),
      date: new Date().toISOString(),
      role,
      text: content,
      tickers: [],
    };
    await this.memory.saveMessage(message);
    this.chat.appendMessage(this.currentSessionId!, role, content);
  }

  private createResponse(text: string, agents: string[]): DirectorResponse {
    return {
      text,
      plan: this.buildDirectorPlan(
        agents as unknown as AgentRole[],
        text,
        text,
      ),
      connectedAgents: agents as unknown as AgentRole[],
      needsConsilium: false,
    };
  }

  /** Построить план Director для ответов, где полный план не создавался планировщиком */
  private buildDirectorPlan(
    agents: AgentRole[],
    question: string,
    synthesis: string,
  ): DirectorPlan {
    return {
      taskId: generateId(),
      userQuestion: question,
      goal: question,
      connectedAgents: agents,
      agentAssignments: agents.map((role) => ({
        role,
        task: question,
        inputData: '',
        rationale: `Агент подключён для обработки запроса: ${question}`,
      })),
      discussionTopics: [],
      needsConsilium: false,
      directorSynthesis: synthesis,
    };
  }

  private buildGreeting(): string {
    const timeOfDay =
      new Date().getHours() < 12
        ? 'утро'
        : new Date().getHours() < 18
          ? 'день'
          : 'вечер';

    let greeting = `Добрый ${timeOfDay}, Радик! 👋\n\n`;

    // Добавляем актуальную информацию о портфеле
    if (this.facts.totalPortfolioValue > 0) {
      greeting += `💰 Твой портфель сейчас стоит **${this.formatCurrency(this.facts.totalPortfolioValue)} ₽**\n`;
      greeting += `📊 Активов: **${this.facts.assetsAnalysis.length}**\n\n`;
    }

    greeting +=
      'Чем могу помочь?\n\n' +
      '• Спроси "**как портфель**" — покажу текущее состояние\n' +
      '• Спроси о конкретной акции — "**SBER**", "**GAZP**"\n' +
      '• Спроси "**рекомендации**" — получу советы агентов\n' +
      '• Спроси "**риски**" — проверю портфель на проблемы';

    return greeting;
  }

  // ── Private methods ──

  private async savePortfolioSnapshot(): Promise<void> {
    const snapshot: PortfolioSnapshot = {
      id: generateId(),
      date: new Date().toISOString(),
      totalValue: this.facts.totalPortfolioValue,
      freeCash: this.facts.freeCashRub,
      assets: this.facts.assetsAnalysis.map((asset) => ({
        ticker: asset.ticker,
        name: asset.name || asset.ticker,
        percent: asset.currentPercent || 0,
        quantity:
          Number(
            (asset as unknown as Record<string, unknown>).totalQuantity ||
              asset.quantity ||
              0,
          ) || 0,
        price: asset.currentPrice || 0,
        pnl:
          Number(
            (asset as unknown as Record<string, unknown>)
              .totalUnrealizedProfitRub ||
              asset.unrealizedProfitRub ||
              0,
          ) || 0,
      })),
      strategy: this.strategicPlan?.goal || 'без стратегии',
    };

    await this.memory.savePortfolioSnapshot(snapshot);
    this.portfolioHistory.push(snapshot);
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('ru-RU').format(Math.round(value));
  }

  /**
   * Проанализировать новости по тикеру и дать прогноз.
   */
  analyzeNewsForTicker(ticker: string): {
    trend: NewsTrend | undefined;
    recentNews: Array<{ title: string; sentiment: string; date: string }>;
    prediction: string;
  } {
    const trend = this.newsCache.getTickerTrend(ticker);
    const recentNews = this.newsCache.getByTicker(ticker, 5).map((item) => ({
      title: item.title.slice(0, 100),
      sentiment: item.sentiment,
      date: item.date,
    }));

    // Формируем прогноз на основе новостей
    let prediction: string;

    if (!trend || trend.newsCount === 0) {
      prediction = `По тикеру ${ticker} пока мало новостного фона. Рекомендую следить за официальными источниками.`;
    } else {
      const sentimentPercent = ((trend.averageSentiment + 1) / 2) * 100;

      if (trend.averageSentiment > 0.3) {
        prediction =
          `Позитивный новостной фон по ${ticker} (сентимент: ${sentimentPercent.toFixed(0)}%). ` +
          `Тренд на рост упоминаний: ${trend.trend === 'up' ? 'да' : 'нет'}. ` +
          `Ключевые темы: ${trend.topKeywords.slice(0, 3).join(', ')}.`;
      } else if (trend.averageSentiment < -0.3) {
        prediction =
          `Негативный новостной фон по ${ticker} (сентимент: ${sentimentPercent.toFixed(0)}%). ` +
          'Рекомендую следить за развитием ситуации и возможными рисками.';
      } else {
        prediction =
          `Нейтральный новостной фон по ${ticker} (сентимент: ${sentimentPercent.toFixed(0)}%). ` +
          `Новостной объём: ${trend.newsCount} упоминаний.`;
      }
    }

    return { trend, recentNews, prediction };
  }

  /**
   * Получить сводку по новостным трендам для всего портфеля.
   */
  getPortfolioNewsSummary(): string {
    const stats = this.newsCache.getStats();
    const trends = this.newsCache.getTrends();

    if (stats.totalItems === 0) {
      return 'Новостной кэш пуст. Запустите пайплайн для загрузки новостей.';
    }

    let summary = '📰 **Новостная сводка по портфелю**\n\n';
    summary += `Всего новостей в кэше: ${stats.totalItems}\n`;
    summary += `Из них по Московской бирже: ${stats.moscowExchangeItems}\n`;
    summary += `Уникальных тикеров в новостях: ${stats.uniqueTickers}\n\n`;

    // Топ трендов
    if (trends.length > 0) {
      summary += '**Топ трендов по тикерам:**\n\n';

      const sortedTrends = [...trends].sort(
        (a, b) => Math.abs(b.averageSentiment) - Math.abs(a.averageSentiment),
      );

      for (const trend of sortedTrends.slice(0, 5)) {
        const sentimentIcon =
          trend.averageSentiment > 0.2
            ? '📈'
            : trend.averageSentiment < -0.2
              ? '📉'
              : '➡️';
        const trendIcon =
          trend.trend === 'up' ? '🔼' : trend.trend === 'down' ? '🔽' : '➡️';

        summary +=
          `${sentimentIcon} ${trend.ticker}: ${trend.newsCount} новостей, ` +
          `сентимент: ${(trend.averageSentiment * 100).toFixed(0)}% ${trendIcon}\n`;

        if (trend.topKeywords.length > 0) {
          summary += `   Ключевые темы: ${trend.topKeywords.slice(0, 3).join(', ')}\n`;
        }
      }
    }

    // Критические новости
    const criticalNews = this.newsCache.getByImportance('critical', 3);
    if (criticalNews.length > 0) {
      summary += '\n⚠️ **Критические новости:**\n\n';
      for (const news of criticalNews) {
        summary += `• ${news.title.slice(0, 100)}\n`;
        if (news.tickers.length > 0) {
          summary += `   Тикеры: ${news.tickers.join(', ')}\n`;
        }
      }
    }

    return summary;
  }

  /**
   * Получить статистику новостного кэша.
   */
  getNewsStats(): Record<string, number> {
    const stats = this.newsCache.getStats();
    return {
      totalItems: stats.totalItems,
      moscowExchangeItems: stats.moscowExchangeItems,
      uniqueTickers: stats.uniqueTickers,
    };
  }

  /**
   * Загрузить документы в RAG базу знаний.
   */
  async loadDocumentsForRAG(
    documents: Array<{
      text: string;
      title: string;
      type: DocumentVector['type'];
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<number> {
    let count = 0;

    for (const doc of documents) {
      const id = `rag-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      this.ragEngine.addDocument(
        id,
        doc.text,
        doc.title,
        doc.type,
        doc.metadata || {},
      );
      count++;
    }

    console.log(`[BrowserDirector] Загружено ${count} документов в RAG базу`);
    return count;
  }

  /**
   * Выполнить RAG запрос.
   */
  async queryRAG(question: string): Promise<{
    answer: string;
    sources: Array<{ title: string; score: number }>;
    hasRelevantDocuments: boolean;
  }> {
    const result = await this.ragEngine.query(question);

    return {
      answer: result.answer,
      sources: result.sources.map((s) => ({
        title: s.title,
        score: s.score,
      })),
      hasRelevantDocuments: result.hasRelevantDocuments,
    };
  }

  /**
   * Получить статистику RAG базы знаний.
   */
  getRAGStats(): Record<string, unknown> {
    return this.ragEngine.getStats();
  }

  /**
   * Очистить RAG базу знаний.
   */
  clearRAG(): void {
    this.ragEngine.clear();
  }
}
