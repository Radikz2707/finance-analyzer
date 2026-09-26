import type { DataAgentOutput, AssetQuote } from './data-agent.js';
import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import type {
  AssetResearchSnapshot,
  AssetIdentity,
  AssetType,
} from '../../research/types.js';
import type {
  ResearchAsset,
  ResearchContext,
  MarketQuote,
  MacroSnapshot,
  NewsDataItem,
  SourceMetadata,
} from '../../research/providers/types.js';
import {
  ResearchProviderRegistry,
  type ValueConflict,
} from '../../research/providers/registry.js';
import { MarketDataProvider } from '../../research/providers/market-provider.js';
import { IssuerFundamentalsProvider } from '../../research/providers/issuer-fundamentals-provider.js';
import { NewsResearchProvider } from '../../research/providers/news-provider.js';
import { MacroResearchProvider } from '../../research/providers/macro-provider.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';

// ──────────────────────────────────────────────
// 1. Research Agent output types
// ──────────────────────────────────────────────

/** Снимок исследования одного актива */
export interface AssetResearchResult {
  /** Тикер актива */
  ticker: string;
  /** Снимок исследования */
  snapshot: AssetResearchSnapshot;
  /** Конфликты данных от провайдеров */
  conflicts: ValueConflict[];
  /** Количество задействованных провайдеров */
  providerCount: number;
}

/**
 * Полные выходные данные Research Agent.
 * Передаются в AI Agent.
 */
export interface ResearchAgentOutput {
  /** Снимки по каждому активу (ключ — тикер) */
  snapshots: Map<string, AssetResearchResult>;
  /** Общие конфликты данных */
  allConflicts: ValueConflict[];
  /** Всего активов исследовано */
  totalAssets: number;
  /** Метка времени исследования */
  researchTimestamp: string;
}

// ──────────────────────────────────────────────
// 2. AssetType mapping
// ──────────────────────────────────────────────

function mapAssetType(assetType: string): AssetType {
  const upper = assetType.toUpperCase();
  if (upper === 'А' || upper === 'АКЦИЯ' || upper === 'STOCK') return 'STOCK';
  if (upper === 'О' || upper === 'ОБЛ' || upper === 'ОБЛИГАЦИЯ' || upper === 'BOND') return 'BOND';
  if (upper === 'Ф' || upper === 'ETF' || upper === 'FUND') return 'ETF';
  if (upper === 'CASH' || upper === 'КЭШ' || upper === 'ДЕНЬГИ') return 'CASH';
  return 'OTHER';
}

// ──────────────────────────────────────────────
// 3. Research Agent
// ──────────────────────────────────────────────

/**
 * Research Agent — параллельное исследование всех активов портфеля.
 *
 * Задачи:
 * - Преобразование DataAgentOutput в ResearchContext
 * - Создание ResearchProviderRegistry с 4 провайдерами
 * - Параллельный запуск research для каждого актива
 * - Агрегация результатов (merge snapshots, track conflicts)
 *
 * Каждый актив исследуется параллельно через Promise.all.
 * Providers внутри research() вызываются последовательно (registry.researchAll).
 */
export class ResearchAgent extends AgentBase {
  constructor(config?: AgentConfig) {
    super(config ?? { name: 'ResearchAgent' });
  }

  protected async executeInternal(
    input: { assetsAnalysis?: AssetAnalysis[]; quotes?: Record<string, AssetQuote>; macroGoals?: DataAgentOutput['macroGoals']; assets?: DataAgentOutput['assets'] },
  ): Promise<ResearchAgentOutput> {
    console.log('[ResearchAgent] >>> Начало исследования активов');

    // Поддержка обоих форматов: assetsAnalysis (из PipelineCoordinator) или assets (из DataAgent)
    const assetsAnalysis = input.assetsAnalysis ?? input.assets?.map((a) => ({
      name: a.name,
      ticker: a.ticker,
      assetType: a.assetType,
      currentPercent: 0,
      targetPercent: 0,
      deficitRub: 0,
      status: 'STABLE' as const,
      dynamicsPercent: 0,
      nkdRub: 0,
      nominal: 0,
      quantity: a.quantity || 0,
      balancePrice: 0,
      currentPrice: 0,
      unrealizedProfitRub: 0,
      priority: 0,
      isConcentrated: false,
    })) ?? [];
    
    const quotes = input.quotes ?? {};
    const macroGoals = input.macroGoals ?? undefined;

    if (assetsAnalysis.length === 0) {
      console.warn('[ResearchAgent] Нет активов для исследования');
      return {
        snapshots: new Map(),
        allConflicts: [],
        totalAssets: 0,
        researchTimestamp: new Date().toISOString(),
      };
    }

    // Шаг 1: Построение ResearchContext
    const researchContext = this.buildResearchContext(quotes, macroGoals);

    // Шаг 2: Создание Registry с провайдерами
    const registry = this.createRegistry();

    // Шаг 3: Параллельное исследование всех активов
    const researchPromises = assetsAnalysis.map(async (asset) => {
      const researchAsset = this.toResearchAsset(asset);

      try {
        console.log(`[ResearchAgent] researchAll для ${asset.ticker}...`);
        const { snapshot, conflicts } = await registry.researchAll(
          researchAsset,
          researchContext,
        );
        console.log(`[ResearchAgent] ✅ researchAll для ${asset.ticker} успешен`);

        return {
          ticker: asset.ticker,
          snapshot,
          conflicts,
          providerCount: registry.findProviders(researchAsset).length,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack?.substring(0, 500) : 'N/A';
        console.error(
          `[ResearchAgent] ❌ Ошибка researchAll для ${asset.ticker}: ${errorMsg}`,
        );
        console.error(`[ResearchAgent] Стек: ${errorStack}`);

        // Fallback: пустой snapshot вместо падения
        return {
          ticker: asset.ticker,
          snapshot: {
            identity: this.buildFallbackIdentity(asset),
            evidence: {},
          } as import('../../research/types.js').AssetResearchSnapshot,
          conflicts: [],
          providerCount: 0,
        };
      }
    });

    // Шаг 4: Ожидание всех параллельных исследований
    let results;
    try {
      results = await Promise.all(researchPromises);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : '';
      console.error(`[ResearchAgent] Promise.all ошибка: ${errorMsg}`);
      console.error(`[ResearchAgent] Стек: ${errorStack}`);
      // Продолжаем с пустыми результатами
      results = assetsAnalysis.map((asset) => ({
        ticker: asset.ticker,
        snapshot: {
          identity: this.buildFallbackIdentity(asset),
          evidence: {},
        } as import('../../research/types.js').AssetResearchSnapshot,
        conflicts: [],
        providerCount: 0,
      }));
    }

    // Шаг 5: Агрегация результатов
    const snapshots = new Map<string, AssetResearchResult>();
    const allConflicts: ValueConflict[] = [];

    for (const result of results) {
      if (result && result.ticker) {
        snapshots.set(result.ticker, result);
        allConflicts.push(...result.conflicts);
      }
    }

    console.log(
      `[ResearchAgent] ✅ Исследовано ${results.length} активов, ` +
      `конфликтов: ${allConflicts.length}`,
    );

    return {
      snapshots,
      allConflicts,
      totalAssets: results.length,
      researchTimestamp: new Date().toISOString(),
    };
  }

  // ── Helpers ──

  private buildResearchContext(
    quotes: Record<string, AssetQuote>,
    _macroGoals?: DataAgentOutput['macroGoals'],
  ): ResearchContext {
    const marketQuotes: Record<string, MarketQuote> = {};
    for (const [ticker, quote] of Object.entries(quotes)) {
      marketQuotes[ticker] = {
        currentPrice: quote.currentPrice,
        dailyDynamicsPercent: quote.dailyDynamicsPercent,
        shortName: quote.shortName,
      };
    }

    // Macro data из Excel (macroGoals содержит totalBalance, freeCash и т.д.)
    // Реальные macro данные (keyRate, fx) будут из MacroResearchProvider
    const macroData: MacroSnapshot = {};

    // News data — пока пусто (заполняется через NewsResearchProvider)
    const newsData: NewsDataItem[] = [];

    const sources: SourceMetadata[] = [
      {
        name: 'Excel/QUIK Parser',
        fetchedAt: new Date().toISOString(),
      },
    ];

    return {
      researchTimestamp: new Date().toISOString(),
      marketQuotes,
      macroData,
      newsData,
      sources,
    };
  }

  private createRegistry(): ResearchProviderRegistry {
    const registry = new ResearchProviderRegistry();
    // Порядок регистрации определяет приоритет при merge
    registry.register(new MarketDataProvider());
    registry.register(new IssuerFundamentalsProvider());
    registry.register(new NewsResearchProvider());
    registry.register(new MacroResearchProvider());
    return registry;
  }

  private toResearchAsset(asset: AssetAnalysis): ResearchAsset {
    return {
      ticker: asset.ticker,
      name: asset.name,
      assetType: mapAssetType(asset.assetType),
      issuer: asset.name,
      currency: 'RUB',
      market: 'MOEX',
    };
  }

  private buildFallbackIdentity(
    asset: AssetAnalysis,
  ): AssetIdentity {
    return {
      ticker: asset.ticker,
      name: asset.name,
      assetType: mapAssetType(asset.assetType),
      issuer: asset.name,
      currency: 'RUB',
      market: 'MOEX',
    };
  }
}
