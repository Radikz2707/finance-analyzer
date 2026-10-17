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

import { extractCorrection, parseUserMessage } from './nl-parser.js';
import { DialogueEngine } from '../dialogue-engine/dialogue-engine.js';
import {
  DirectorDelegationPlanner,
  AGENT_ROLE_LABELS,
} from './delegation-planner.js';
import { DirectorAgentFacade } from './agent-facade.js';
import { DirectorChatStore } from './chat-session.js';
import { BrowserPersistentMemory } from './browser-persistent-memory.js';
import { OllamaClient } from './ollama-client.js';
import { OLLAMA_MODEL_NAME } from '../../ai-advisor/ollama-model.js';
import { buildPortfolioSummary } from './browser-chat-responder.js';
import { buildInvestmentAdvisorPrompt } from './ollama-system-prompt.js';
import { NewsCache } from '../gatekeeper/news-cache.js';
import type { NewsTrend } from '../gatekeeper/news-cache.js';
import { NewsDriver } from '../news-driver/news-driver.js';
import type { NewsImpact } from '../news-driver/types.js';
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

/**
 * Разбить текст на чанки для streaming (по предложениям/абзацам).
 */
function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  const chunkSize = 30;

  const paragraphs = text.split('\n\n');

  for (const paragraph of paragraphs) {
    if (paragraph.length <= chunkSize) {
      if (paragraph) chunks.push(paragraph);
      continue;
    }

    let remaining = paragraph;
    while (remaining.length > 0) {
      let splitAt = chunkSize;
      const spaceIndex = remaining.indexOf(' ', chunkSize);
      if (spaceIndex > 0 && spaceIndex < chunkSize + 20) {
        splitAt = spaceIndex;
      }

      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
  }

  return chunks.filter((c) => c.length > 0);
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
  private dialogue: DialogueEngine;
  private newsCache: NewsCache;
  private newsDriver: NewsDriver;
  private vectorStore: VectorStore;
  private ragEngine: RAGEngine;

  private facts: DirectorFactsContext;
  private currentSessionId: string | null = null;
  private initialized = false;
  private strategicPlan: StrategicPlan | null = null;
  private portfolioHistory: PortfolioSnapshot[] = [];
  private chatHistory: Array<{ role: string; content: string }> = [];
  /** Поправки пользователя к долям активов (ticker → корректный %) */
  private userCorrections: Map<string, number> = new Map();
  /** Тикеры последнего обсуждённого вопроса (для follow-up «а если») */
  private lastTickers: string[] = [];

  constructor(_config: DirectorConfig = {}) {
    this.facts = emptyFacts();
    this.memory = new BrowserPersistentMemory();
    this.chat = new DirectorChatStore({ maxMessagesPerSession: 200 });
    this.planner = new DirectorDelegationPlanner();
    this.facade = new DirectorAgentFacade();
    // Модель из единой точки (env OLLAMA_MODEL) — см. ollama-model.ts.
    // Раньше здесь была жёстко зашита qwen3:14b, которой нет у пользователя.
    this.ollama = new OllamaClient({ model: OLLAMA_MODEL_NAME });
    // Естественный диалог: LLM-классификация интентов (Ollama) с fallback
    // на nl-parser. Заменяет regex-ветки приветствий/оффтопика/отчётов.
    this.dialogue = new DialogueEngine({
      userName: 'Радик',
      llm: {
        chat: (messages) => this.ollama.chat(messages),
      },
    });
    this.newsCache = new NewsCache();
    this.newsDriver = new NewsDriver();
    this.vectorStore = new VectorStore();
    this.ragEngine = new RAGEngine({
      vectorStore: this.vectorStore,
      ollamaModel: OLLAMA_MODEL_NAME,
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

    // --- Естественный диалог: NLU-классификация интента (вместо regex) ---
    // DialogueEngine (LLM через Ollama + fallback на nl-parser) понимает
    // приветствия, прощания, статус, оффтопик, поправки, отчёты, задачи,
    // действия и финансовые вопросы — как разговор двух людей.
    const analysis = await this.dialogue.analyze({
      text: message,
      context: this.dialogue.getContext(),
      facts: this.facts,
    });

    // Smalltalk-ветки (приветствие/прощание/статус/оффтопик/вежливость):
    // живые ответы БЕЗ агентов и БЕЗ портфельного контекста в LLM.
    const smallTalk = this.dialogue.buildSmallTalk(analysis, this.facts);
    if (smallTalk) {
      await this.saveChatMessage('director', smallTalk);
      this.dialogue.pushDirector(smallTalk);
      return this.createResponse(smallTalk, []);
    }

    // --- Поправка пользователя к данным портфеля ---
    // «доля PLZL 19%», «не 35,4%» — запоминаем и применяем в дальнейших
    // расчётах, чтобы не повторять ошибочную цифру.
    if (analysis.intent === 'correction') {
      const knownAssets = this.facts.assetsAnalysis.map((a) => ({
        ticker: a.ticker,
        name: a.name,
      }));
      const correction = extractCorrection(message, knownAssets);
      if (correction) {
        const ticker = (
          correction.ticker ?? this.lastTickers[0]
        )?.toUpperCase();
        if (ticker) {
          this.userCorrections.set(ticker, correction.currentPercent);
          const asset = this.facts.assetsAnalysis.find(
            (a) => a.ticker.toUpperCase() === ticker,
          );
          const answer =
            'Принято, спасибо за поправку! ✅\n\n' +
            `Доля ${asset?.name ?? ticker} (${ticker}) — ` +
            `${correction.currentPercent.toFixed(1)}%.\n` +
            'Учту это значение во всех дальнейших расчётах и рекомендациях.';
          await this.saveChatMessage('director', answer);
          this.dialogue.pushDirector(answer);
          return this.createResponse(answer, []);
        }
      }
    }

    // --- Запрос отчёта/анализа портфеля: сводка по РЕАЛЬНЫМ фактам ---
    // «ты видишь мой отчёт?» — показываем факты, а не отдаём в LLM,
    // который может выдумать активы (VKCO/IRAO из примеров промпта).
    if (analysis.intent === 'report') {
      const answer = this.buildPortfolioReportAnswer();
      await this.saveChatMessage('director', answer);
      this.dialogue.pushDirector(answer);
      return this.createResponse(answer, []);
    }

    // --- Задача/идея из свободной речи (без goalIntake в браузере) ---
    // В десктоп-версии такие реплики превращаются в цель автономного
    // цикла; здесь — честный ответ и предложение сформулировать действие.
    if (analysis.intent === 'task') {
      const answer =
        '🎯 Принял как задачу!\n\n' +
        'В десктоп-версии она поставится в план автономного цикла и ' +
        'выполнится фоном. Здесь, в браузере, могу сразу выполнить, если ' +
        'сформулируешь как действие: «создай файл …», «запусти тесты», ' +
        '«реализуй функционал …».';
      await this.saveChatMessage('director', answer);
      this.dialogue.pushDirector(answer);
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

    // Запоминаем тикеры вопроса для follow-up («а если…» без тикера)
    const parsedTickers = parseUserMessage(message).tickers;
    if (parsedTickers.length > 0) {
      this.lastTickers = parsedTickers;
    }

    // Запускаем консилиум если агенты спорят ИЛИ пользователь явно просит
    // («собери консилиум», «обсуди между собой»).
    let consiliumSummary = '';
    const wantsConsilium =
      /(консилиум|consilium|созови|собери\s+агентов|обсуди\s+между\s+собой)/i.test(
        message,
      );
    const hasDisagreement =
      this.detectDisagreement(agentResults) || wantsConsilium;

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
    // Запоминаем ответ Director в контексте диалога (для follow-up-анафор)
    this.dialogue.pushDirector(finalSynthesis);

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
    let interpreted = parseUserMessage(question);

    // Follow-up «а если/что если» без тикеров — подтягиваем тикеры из
    // последнего обсуждённого вопроса, чтобы ScenarioAgent считал сценарий
    // по тому же активу (например, «а если сокращу PLZL…»).
    if (interpreted.tickers.length === 0 && this.lastTickers.length > 0) {
      const lower = question.toLowerCase();
      if (
        /(а если|что если|если я|если мы|допустим|предположим)/i.test(lower)
      ) {
        interpreted = {
          ...interpreted,
          tickers: [...this.lastTickers],
        };
      }
    }

    const plan = this.planner.buildPlan(interpreted, '');

    if (plan.connectedAgents.length === 0) {
      return [];
    }

    try {
      const results = await this.facade.executeRoles(
        plan.connectedAgents,
        interpreted,
        this.correctedFacts(),
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

    const facts = this.correctedFacts();
    let context = `Портфель: ${this.formatCurrency(facts.totalPortfolioValue)} ₽, ${facts.assetsAnalysis.length} активов\n\n`;

    // Полный список активов — чтобы LLM НЕ выдумывал тикеры, которых нет
    // в портфеле (например, VKCO/IRAO из примеров системного промпта).
    context += 'Активы в портфеле (используй ТОЛЬКО этот список):\n';
    for (const asset of facts.assetsAnalysis) {
      context += `• ${asset.ticker} (${asset.name}): доля ${asset.currentPercent.toFixed(1)}%`;
      if (asset.targetPercent > 0) {
        context += `, цель ${asset.targetPercent.toFixed(1)}%`;
      }
      if (asset.unrealizedProfitRub !== undefined) {
        context += `, P&L ${Math.round(asset.unrealizedProfitRub)} ₽`;
      }
      context += '\n';
    }
    context += '\n';

    // Поправки пользователя — приоритет над исходными данными
    if (this.userCorrections.size > 0) {
      context +=
        'Поправки пользователя (используй ТОЛЬКО эти значения долей):\n';
      for (const [ticker, percent] of this.userCorrections) {
        context += `• ${ticker}: ${percent.toFixed(1)}%\n`;
      }
      context += '\n';
    }

    // Новостной фон (NewsDriver): сентимент/важность/влияние на позиции
    const newsImpacts = this.newsDriver.analyzePortfolio(
      this.correctedFacts(),
      this.newsCache,
    );
    const newsContext = this.newsDriver.buildNewsContext(newsImpacts);
    if (newsContext) {
      context += newsContext + '\n\n';
    }

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

  /**
   * Вернуть факты с применёнными поправками пользователя.
   * Оригинальные факты НЕ мутируются (immutable-контракт Director).
   */
  private correctedFacts(): DirectorFactsContext {
    if (this.userCorrections.size === 0) return this.facts;
    const assets = this.facts.assetsAnalysis.map((a) => {
      const corrected = this.userCorrections.get(a.ticker.toUpperCase());
      if (corrected === undefined) return a;
      return { ...a, currentPercent: corrected };
    });
    return { ...this.facts, assetsAnalysis: assets };
  }

  /** Сводка по РЕАЛЬНЫМ фактам портфеля (для запроса отчёта) */
  private buildPortfolioReportAnswer(): string {
    if (this.facts.assetsAnalysis.length === 0) {
      return (
        'Я вижу, что вы спрашиваете про отчёт, но данные портфеля ' +
        'пока не загружены. Запустите пайплайн (npm run pipeline), ' +
        'и я покажу полный анализ.'
      );
    }
    return (
      'Да, вижу ваш отчёт по портфелю 📊\n\n' +
      buildPortfolioSummary(this.correctedFacts()) +
      '\n\nЧто разобрать подробнее — например, «Что с ' +
      (this.facts.assetsAnalysis[0]?.ticker ?? 'SBER') +
      '?»?'
    );
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
    impact?: NewsImpact;
  } {
    const trend = this.newsCache.getTickerTrend(ticker);
    const recentNews = this.newsCache.getByTicker(ticker, 5).map((item) => ({
      title: item.title.slice(0, 100),
      sentiment: item.sentiment,
      date: item.date,
    }));

    // Влияние новостей на актив через NewsDriver
    // (сентимент × важность × релевантность тикера).
    const impact = this.newsDriver.analyzePortfolio(
      { assetsAnalysis: [{ ticker }] },
      this.newsCache,
    )[0];

    // Формируем прогноз на основе новостей
    let prediction: string;

    if (impact) {
      const directionLabel =
        impact.impactDirection === 'positive'
          ? 'позитивное'
          : impact.impactDirection === 'negative'
            ? 'негативное'
            : 'нейтральное';
      prediction =
        `Влияние на позицию ${ticker}: ${directionLabel} ` +
        `(сентимент ${impact.sentimentScore.toFixed(2)}, важность «${impact.importance}», ` +
        `impact score ${impact.impactScore.toFixed(2)}). ` +
        impact.reasoning;
      if (impact.suggestedAction) {
        prediction += ` Предлагаемое действие: ${impact.suggestedAction}.`;
      }
    } else if (!trend || trend.newsCount === 0) {
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

    return { trend, recentNews, prediction, impact };
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

  /**
   * Потоковая версия processUserMessage для браузерной версии.
   * Поддерживает streaming для smalltalk и простых вопросов.
   */
  async processUserMessageStreaming(
    rawMessage: string,
    onChunk: (chunk: string) => void,
  ): Promise<DirectorResponse> {
    const message = rawMessage.trim();
    if (!this.currentSessionId) {
      this.createSession();
    }

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

    // NLU анализ
    const analysis = await this.dialogue.analyze({
      text: message,
      context: this.dialogue.getContext(),
      facts: this.facts,
    });

    // Smalltalk — с streaming через LLM
    const smallTalk = this.dialogue.buildSmallTalk(analysis, this.facts);
    if (smallTalk) {
      // Отправляем по частям
      const chunks = splitIntoChunks(smallTalk);
      for (const chunk of chunks) {
        onChunk(chunk);
      }
      await this.saveChatMessage('director', smallTalk);
      this.dialogue.pushDirector(smallTalk);
      return this.createResponse(smallTalk, []);
    }

    // Для сложных запросов — используем стандартный processUserMessage
    const response = await this.processUserMessage(message);

    // Отправляем полный ответ через onChunk
    const chunks = splitIntoChunks(response.text);
    for (const chunk of chunks) {
      onChunk(chunk);
    }

    return response;
  }
}
