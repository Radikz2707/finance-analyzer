/**
 * Knowledge Graph — граф знаний для контекстного анализа.
 *
 * Связывает компании, отрасли, события и их влияние на цены.
 * Позволяет агентам видеть контекст, а не изолированные факты.
 */

import { config as newsConfig } from '../news-config.js';

/** Узел графа знаний */
export interface KnowledgeNode {
  /** Уникальный ID */
  id: string;
  /** Тип: COMPANY, SECTOR, EVENT, MACRO */
  type: 'COMPANY' | 'SECTOR' | 'EVENT' | 'MACRO';
  /** Название */
  name: string;
  /** Вес узла (важность) */
  weight: number;
}

/** Связь между узлами */
export interface KnowledgeEdge {
  /** ID узла-источника */
  source: string;
  /** ID узла-приёмника */
  target: string;
  /** Тип связи: IMPACTS, CORRELATES, DEPENDS */
  type: 'IMPACTS' | 'CORRELATES' | 'DEPENDS';
  /** Сила связи (0.0 - 1.0) */
  strength: number;
  /** Направление влияния: POSITIVE, NEGATIVE, NEUTRAL */
  direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

/** Результат запроса контекста */
export interface ContextResult {
  /** Прямые влияния на тикер */
  directImpacts: Array<{
    event: string;
    impact: 'POSITIVE' | 'NEGATIVE';
    date: string;
  }>;
  /** Тренды сектора */
  sectorTrends: {
    sector: string;
    trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    peerComparison: Record<string, string>;
  };
  /** Коррелированные события */
  correlatedEvents: Array<{
    event: string;
    correlation: number;
  }>;
}

/** Knowledge Graph */
export class KnowledgeGraph {
  private nodes: Map<string, KnowledgeNode> = new Map();
  private edges: Map<string, KnowledgeEdge[]> = new Map();
  private cacheTime: number = 0;
  private readonly cacheTtlMs = newsConfig.KG_CACHE_TTL_MS;

  /**
   * Добавление узла в граф.
   */
  addNode(node: KnowledgeNode): void {
    this.nodes.set(node.id, node);
    if (!this.edges.has(node.id)) {
      this.edges.set(node.id, []);
    }
  }

  /**
   * Добавление связи между узлами.
   */
  addEdge(edge: KnowledgeEdge): void {
    if (!this.edges.has(edge.source)) {
      this.edges.set(edge.source, []);
    }
    this.edges.get(edge.source)!.push(edge);

    // Ограничение количества связей
    const maxEdges = newsConfig.KG_MAX_EDGES_PER_NODE;
    const nodeEdges = this.edges.get(edge.source)!;
    if (nodeEdges.length > maxEdges) {
      nodeEdges.sort((a, b) => b.strength - a.strength);
      this.edges.set(edge.source, nodeEdges.slice(0, maxEdges));
    }
  }

  /**
   * Получение контекста для тикера.
   */
  async getContext(ticker: string): Promise<ContextResult> {
    // Проверка кэша
    if (Date.now() - this.cacheTime < this.cacheTtlMs) {
      return this.getCachedContext(ticker);
    }

    // Загрузка контекста из API
    const context = await this.loadContextFromApi(ticker);
    this.cacheTime = Date.now();
    return context;
  }

  /**
   * Загрузка контекста из API.
   */
  private async loadContextFromApi(ticker: string): Promise<ContextResult> {
    try {
      const response = await fetch(`/api/news/context/${ticker}`);
      if (!response.ok) throw new Error('API unavailable');

      const data = await response.json();

      // Построение графа из данных API
      for (const node of data.nodes || []) {
        this.addNode(node);
      }
      for (const edge of data.edges || []) {
        this.addEdge(edge);
      }

      return data.context as ContextResult;
    } catch {
      // Fallback: пустой контекст
      return {
        directImpacts: [],
        sectorTrends: {
          sector: 'UNKNOWN',
          trend: 'NEUTRAL',
          peerComparison: {},
        },
        correlatedEvents: [],
      };
    }
  }

  /**
   * Получение кэшированного контекста.
   */
  private getCachedContext(ticker: string): ContextResult {
    // Поиск узла в графе
    const node = this.nodes.get(ticker);
    if (!node) {
      return {
        directImpacts: [],
        sectorTrends: {
          sector: 'UNKNOWN',
          trend: 'NEUTRAL',
          peerComparison: {},
        },
        correlatedEvents: [],
      };
    }

    // Сбор связей
    const nodeEdges = this.edges.get(node.id) || [];
    const directImpacts = nodeEdges
      .filter((e) => e.type === 'IMPACTS' && e.strength >= newsConfig.KG_MIN_EDGE_STRENGTH)
      .map((e) => ({
        event: e.target,
        impact: e.direction === 'POSITIVE' ? 'POSITIVE' as const : 'NEGATIVE' as const,
        date: new Date().toISOString(),
      }));

    return {
      directImpacts,
      sectorTrends: {
        sector: node.name,
        trend: 'NEUTRAL',
        peerComparison: {},
      },
      correlatedEvents: nodeEdges
        .filter((e) => e.type === 'CORRELATES')
        .map((e) => ({
          event: e.target,
          correlation: e.strength,
        })),
    };
  }

  /**
   * Очистка кэша.
   */
  invalidateCache(): void {
    this.cacheTime = 0;
  }
}
