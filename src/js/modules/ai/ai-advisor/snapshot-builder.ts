/**
 * Snapshot Builder — AssetAnalysis → AssetResearchSnapshot.
 *
 * Преобразует данные из PortfolioMath (AssetAnalysis)
 * в формат AssetResearchSnapshot, который понимает InvestmentThesisEngine.
 *
 * Оркестрация:
 * - AssetAnalysis → ResearchAsset
 * - ResearchProviderRegistry.researchAll(asset, context)
 * - Merged AssetResearchSnapshot → InvestmentThesisEngine
 *
 * НЕ создаёт fundamentals вручную.
 * НЕ создаёт новости вручную.
 * НЕ создаёт macro values вручную.
 * НЕ создаёт AIRecommendation.
 * НЕ создаёт InvestmentThesis.
 * Только orchestration.
 */

import type {
  AssetResearchSnapshot,
  AssetIdentity,
  AssetType,
  ResearchAsset,
  ResearchContext,
} from '../../research/types.js';

import type { AssetAnalysis } from '../../portfolio/portfolio-math/portfolio-math.js';
import {
  ResearchProviderRegistry,
  type ValueConflict,
} from '../../research/providers/registry.js';
import {
  MarketDataProvider,
  IssuerFundamentalsProvider,
  NewsResearchProvider,
  MacroResearchProvider,
} from '../../research/providers/types.js';

// ──────────────────────────────────────────────
// 1. AssetType mapping
// ──────────────────────────────────────────────

/**
 * Преобразует строковый assetType из AssetAnalysis
 * в enum AssetType.
 */
function mapAssetType(assetType: string): AssetType {
  const upper = assetType.toUpperCase();
  if (upper === 'А' || upper === 'АКЦИЯ' || upper === 'STOCK') return 'STOCK';
  if (upper === 'О' || upper === 'ОБЛ' || upper === 'ОБЛИГАЦИЯ' || upper === 'BOND') return 'BOND';
  if (upper === 'Ф' || upper === 'ETF' || upper === 'FUND') return 'ETF';
  if (upper === 'CASH' || upper === 'КЭШ' || upper === 'ДЕНЬГИ') return 'CASH';
  return 'OTHER';
}

// ──────────────────────────────────────────────
// 2. PortfolioAssetContext builder
// ──────────────────────────────────────────────

/**
 * Формирует PortfolioAssetContext из AssetAnalysis.
 * Используется как контекст портфеля для InvestmentThesisEngine.
 */
export interface SnapshotBuilderContext {
  totalPortfolioValue: number;
}

export function buildPortfolioAssetContext(
  asset: AssetAnalysis,
  ctx: SnapshotBuilderContext,
): import('../../research/types.js').PortfolioAssetContext {
  return {
    currentPercent: asset.currentPercent,
    targetPercent: asset.targetPercent ?? 0,
    portfolioMathStatus: asset.status,
    currentPriceRub: asset.currentPrice,
    balancePrice: asset.balancePrice,
    quantity: asset.quantity,
    unrealizedProfitRub: asset.unrealizedProfitRub,
    totalPortfolioValue: ctx.totalPortfolioValue,
  };
}

// ──────────────────────────────────────────────
// 3. ResearchAsset builder
// ──────────────────────────────────────────────

/**
 * Преобразует AssetAnalysis в ResearchAsset для провайдеров.
 */
function toResearchAsset(asset: AssetAnalysis): ResearchAsset {
  return {
    ticker: asset.ticker,
    name: asset.name,
    type: mapAssetType(asset.assetType),
    assetType: asset.assetType,
    issuer: asset.name,
    currency: 'RUB',
    market: 'MOEX',
  };
}

// ──────────────────────────────────────────────
// 4. Registry factory
// ──────────────────────────────────────────────

/**
 * Создаёт Registry с четырьмя существующими провайдерами.
 * Порядок регистрации определяет приоритет при merge.
 */
export function createResearchRegistry(): ResearchProviderRegistry {
  const registry = new ResearchProviderRegistry();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider registration
  registry.register(new MarketDataProvider() as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider registration
  registry.register(new IssuerFundamentalsProvider() as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider registration
  registry.register(new NewsResearchProvider() as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider registration
  registry.register(new MacroResearchProvider() as any);
  return registry;
}

// ──────────────────────────────────────────────
// 5. Fallback snapshot (когда нет context или registry)
// ──────────────────────────────────────────────

/**
 * Создаёт fallback snapshot с NO_DATA.
 * Используется когда ResearchContext не передан.
 */
function buildFallbackSnapshot(asset: AssetAnalysis): AssetResearchSnapshot {
  const identity: AssetIdentity = {
    ticker: asset.ticker,
    name: asset.name,
    type: mapAssetType(asset.assetType),
    assetType: asset.assetType,
    issuer: asset.name,
    currency: 'RUB',
    market: 'MOEX',
  };

  return {
    identity,
    marketResearch: null,
    issuerResearch: null,
    fundamentals: [],
    newsResearch: [],
    macroResearch: null,
    evidence: [],
  };
}

// ──────────────────────────────────────────────
// 6. AssetResearchSnapshot builder (orchestration)
// ──────────────────────────────────────────────

/**
 * Создаёт AssetResearchSnapshot из AssetAnalysis.
 *
 * Если передан researchContext:
 * - Создаёт ResearchAsset из AssetAnalysis
 * - Создаёт Registry с 4 провайдерами (или использует переданный)
 * - Вызывает registry.researchAll(asset, context)
 * - Возвращает merged snapshot + conflicts
 *
 * Если researchContext не передан:
 * - Возвращает fallback snapshot с NO_DATA
 *
 * НЕ создаёт AIRecommendation.
 * НЕ создаёт InvestmentThesis.
 * НЕ создаёт fundamentals вручную.
 *
 * @param registry — опциональный кастомный registry для тестов с моками
 */
export async function buildAssetResearchSnapshot(
  asset: AssetAnalysis,
  researchContext?: ResearchContext,
  registry?: ResearchProviderRegistry,
): Promise<{
  snapshot: AssetResearchSnapshot;
  conflicts: ValueConflict[];
}> {
  // Если контекст не передан — fallback NO_DATA
  if (!researchContext) {
    return {
      snapshot: buildFallbackSnapshot(asset),
      conflicts: [],
    };
  }

  // Создаём ResearchAsset из AssetAnalysis
  const researchAsset = toResearchAsset(asset);

  // Используем переданный registry (для тестов) или создаём новый
  const providerRegistry = registry ?? createResearchRegistry();

  // Вызываем researchAll — orchestration
  const { snapshot, conflicts } = await providerRegistry.researchAll(
    researchAsset,
    researchContext,
  );

  // Сохраняем conflicts из Registry
  return {
    snapshot,
    conflicts,
  };
}
