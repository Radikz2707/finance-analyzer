/**
 * BrowserIndexedDB — persistent memory для Director в браузере.
 * Использует IndexedDB для сохранения данных между сессиями.
 * 
 * Хранит:
 * - Историю портфеля (снимки состояния)
 * - Прошлые решения Director
 * - Диалоги с пользователем
 * - Результаты работы агентов
 * - Стратегические планы
 * - Moods и паттерны пользователя
 */

// ──────────────────────────────────────────────
// Типы данных
// ──────────────────────────────────────────────

export interface PortfolioSnapshot {
  id: string;
  date: string;
  totalValue: number;
  freeCash: number;
  assets: Array<{
    ticker: string;
    name: string;
    percent: number;
    quantity: number;
    price: number;
    pnl: number;
  }>;
  strategy: string;
}

export interface DirectorDecision {
  id: string;
  date: string;
  question: string;
  answer: string;
  tickers: string[];
  action: string | null;
  confidence: number;
  reasoning: string;
  agentResults: string[];
  outcome?: 'positive' | 'negative' | 'neutral' | 'pending';
}

export interface ChatMessage {
  id: string;
  date: string;
  role: 'user' | 'director';
  text: string;
  tickers?: string[];
  taskId?: string;
}

export interface AgentPerformance {
  agentName: string;
  totalTasks: number;
  successfulTasks: number;
  averageResponseTime: number;
  lastActive: string;
  specialties: string[];
  notes: string;
}

export interface StrategicPlan {
  id: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  goal: string;
  horizon: 'short' | 'medium' | 'long';
  steps: Array<{
    id: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    status: 'pending' | 'in_progress' | 'completed' | 'abandoned';
    ticker?: string;
    deadline?: string;
  }>;
  metrics: Array<{
    name: string;
    currentValue: number;
    targetValue: number;
    unit: string;
  }>;
}

export interface UserPreferences {
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  investmentHorizon: 'short' | 'medium' | 'long';
  preferredSectors: string[];
  excludedTickers: string[];
  communicationStyle: 'detailed' | 'concise' | 'balanced';
  notificationPreferences: {
    portfolioChanges: boolean;
    riskAlerts: boolean;
    opportunities: boolean;
  };
}

// ──────────────────────────────────────────────
// IndexedDB Manager
// ──────────────────────────────────────────────

const DB_NAME = 'FinanceAnalyzerDirector';
const DB_VERSION = 1;

interface DirectorDB extends IDBDatabase {
  objectStoreNames: DOMStringList;
}

class IndexedDBManager {
  private db: DirectorDB | null = null;
  private promise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.promise) return this.promise;

    this.promise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[IndexedDB] Ошибка открытия базы:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[IndexedDB] База данных открыта');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // История портфеля
        if (!db.objectStoreNames.contains('portfolioSnapshots')) {
          const store = db.createObjectStore('portfolioSnapshots', {
            keyPath: 'id',
          });
          store.createIndex('date', 'date', { unique: false });
        }

        // Решения Director
        if (!db.objectStoreNames.contains('decisions')) {
          const store = db.createObjectStore('decisions', { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('tickers', 'tickers', { unique: false, multiEntry: true });
        }

        // Чаты
        if (!db.objectStoreNames.contains('chatMessages')) {
          const store = db.createObjectStore('chatMessages', { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
        }

        // Производительность агентов
        if (!db.objectStoreNames.contains('agentPerformance')) {
          db.createObjectStore('agentPerformance', { keyPath: 'agentName' });
        }

        // Стратегические планы
        if (!db.objectStoreNames.contains('strategicPlans')) {
          const store = db.createObjectStore('strategicPlans', { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // Предпочтения пользователя
        if (!db.objectStoreNames.contains('userPreferences')) {
          db.createObjectStore('userPreferences', { keyPath: 'id' });
        }
      };
    });

    return this.promise;
  }

  private getDb(): Promise<DirectorDB> {
    if (!this.db) {
      throw new Error('IndexedDB не инициализирован. Вызовите init() сначала.');
    }
    return Promise.resolve(this.db);
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  async get<T>(storeName: string, key: string | number): Promise<T | null> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async put<T>(storeName: string, data: T): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(data);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName: string, key: string | number): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(storeName: string): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAllByIndex<T>(
    storeName: string,
    indexName: string,
    query: IDBKeyRange,
  ): Promise<T[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(query);

      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }
}

// ──────────────────────────────────────────────
// Persistent Memory Store
// ──────────────────────────────────────────────

export class BrowserPersistentMemory {
  private db: IndexedDBManager;

  constructor() {
    this.db = new IndexedDBManager();
  }

  async init(): Promise<void> {
    await this.db.init();
  }

  // ── Portfolio History ──

  async savePortfolioSnapshot(snapshot: PortfolioSnapshot): Promise<void> {
    await this.db.put('portfolioSnapshots', snapshot);
  }

  async getPortfolioHistory(): Promise<PortfolioSnapshot[]> {
    return await this.db.getAll<PortfolioSnapshot>('portfolioSnapshots');
  }

  async getLatestPortfolioSnapshot(): Promise<PortfolioSnapshot | null> {
    const history = await this.getPortfolioHistory();
    if (history.length === 0) return null;
    return history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] ?? null;
  }

  // ── Decisions ──

  async saveDecision(decision: DirectorDecision): Promise<void> {
    await this.db.put('decisions', decision);
  }

  async getDecisions(): Promise<DirectorDecision[]> {
    return await this.db.getAll<DirectorDecision>('decisions');
  }

  async getDecisionsByTicker(ticker: string): Promise<DirectorDecision[]> {
    const all = await this.getDecisions();
    return all.filter((d) => d.tickers.includes(ticker));
  }

  async getDecisionOutcome(decisionId: string): Promise<DirectorDecision['outcome'] | null> {
    const decision = await this.db.get<DirectorDecision>('decisions', decisionId);
    return decision?.outcome || null;
  }

  async updateDecisionOutcome(
    decisionId: string,
    outcome: DirectorDecision['outcome'],
  ): Promise<void> {
    const decision = await this.db.get<DirectorDecision>('decisions', decisionId);
    if (decision) {
      decision.outcome = outcome;
      await this.db.put('decisions', decision);
    }
  }

  // ── Chat History ──

  async saveMessage(message: ChatMessage): Promise<void> {
    await this.db.put('chatMessages', message);
  }

  async getChatHistory(): Promise<ChatMessage[]> {
    return await this.db.getAll<ChatMessage>('chatMessages');
  }

  async getRecentMessages(limit: number = 50): Promise<ChatMessage[]> {
    const all = await this.getChatHistory();
    return all
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);
  }

  // ── Agent Performance ──

  async saveAgentPerformance(performance: AgentPerformance): Promise<void> {
    await this.db.put('agentPerformance', performance);
  }

  async getAgentPerformance(agentName: string): Promise<AgentPerformance | null> {
    return await this.db.get<AgentPerformance>('agentPerformance', agentName);
  }

  async getAllAgentPerformance(): Promise<AgentPerformance[]> {
    return await this.db.getAll<AgentPerformance>('agentPerformance');
  }

  async updateAgentTaskCount(agentName: string, success: boolean, responseTime: number): Promise<void> {
    const existing = await this.getAgentPerformance(agentName);
    const now = new Date().toISOString();

    const performance: AgentPerformance = {
      agentName,
      totalTasks: (existing?.totalTasks || 0) + 1,
      successfulTasks: (existing?.successfulTasks || 0) + (success ? 1 : 0),
      averageResponseTime:
        existing
          ? ((existing.averageResponseTime * existing.totalTasks + responseTime) /
              (existing.totalTasks + 1))
          : responseTime,
      lastActive: now,
      specialties: existing?.specialties || [],
      notes: existing?.notes || '',
    };

    await this.saveAgentPerformance(performance);
  }

  // ── Strategic Plans ──

  async saveStrategicPlan(plan: StrategicPlan): Promise<void> {
    plan.updatedAt = new Date().toISOString();
    await this.db.put('strategicPlans', plan);
  }

  async getStrategicPlans(): Promise<StrategicPlan[]> {
    return await this.db.getAll<StrategicPlan>('strategicPlans');
  }

  async getActiveStrategicPlan(): Promise<StrategicPlan | null> {
    const plans = await this.getStrategicPlans();
    if (plans.length === 0) return null;
    return plans.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] ?? null;
  }

  // ── User Preferences ──

  async saveUserPreferences(preferences: UserPreferences): Promise<void> {
    await this.db.put('userPreferences', { id: 'main', ...preferences });
  }

  async getUserPreferences(): Promise<UserPreferences | null> {
    return await this.db.get<UserPreferences>('userPreferences', 'main');
  }

  // ── Statistics ──

  async getMemoryStats(): Promise<{
    portfolioSnapshots: number;
    decisions: number;
    messages: number;
    agents: number;
    plans: number;
    totalSizeBytes: number;
  }> {
    const [snapshots, decisions, messages, agents, plans] = await Promise.all([
      this.db.getAll('portfolioSnapshots'),
      this.db.getAll('decisions'),
      this.db.getAll('chatMessages'),
      this.db.getAll('agentPerformance'),
      this.db.getAll('strategicPlans'),
    ]);

    // Примерный размер в байтах
    const totalSize = JSON.stringify({
      snapshots,
      decisions,
      messages,
      agents,
      plans,
    }).length;

    return {
      portfolioSnapshots: snapshots.length,
      decisions: decisions.length,
      messages: messages.length,
      agents: agents.length,
      plans: plans.length,
      totalSizeBytes: totalSize,
    };
  }

  // ── Clear All ──

  async clearAll(): Promise<void> {
    await Promise.all([
      this.db.clear('portfolioSnapshots'),
      this.db.clear('decisions'),
      this.db.clear('chatMessages'),
      this.db.clear('agentPerformance'),
      this.db.clear('strategicPlans'),
      this.db.clear('userPreferences'),
    ]);
  }
}
