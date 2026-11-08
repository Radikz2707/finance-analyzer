/**
 * Research Provider Registry — реестр провайдеров исследований.
 */

import type {
  AssetResearchSnapshot,
  ResearchAsset,
  ResearchContext,
} from '../types.js';

/** Сводка конфликта данных */
export interface ValueConflict {
  providerA: string;
  providerB: string;
  field: string;
  valueA: unknown;
  valueB: unknown;
}

/** Результат researchAll */
export interface ResearchAllResult {
  snapshot: AssetResearchSnapshot;
  conflicts: ValueConflict[];
}

/** Registry провайдеров */
export class ResearchProviderRegistry {
  private providers: Array<{ research: (a: ResearchAsset, ctx?: ResearchContext) => Promise<AssetResearchSnapshot> }> = [];

  register(provider: { supports: (a: ResearchAsset) => boolean; research: (a: ResearchAsset, ctx?: ResearchContext) => Promise<AssetResearchSnapshot> }): void {
    this.providers.push({ research: provider.research });
  }

  async researchAll(
    asset: ResearchAsset,
    context: ResearchContext,
  ): Promise<ResearchAllResult> {
    const snapshots: AssetResearchSnapshot[] = [];
    for (const provider of this.providers) {
      if (provider.research) {
        const result = await provider.research(asset, context);
        if (result) {
          snapshots.push(result);
        }
      }
    }
    return {
      snapshot: this.mergeSnapshots(snapshots),
      conflicts: [],
    };
  }

  private mergeSnapshots(snapshots: AssetResearchSnapshot[]): AssetResearchSnapshot {
    const merged: AssetResearchSnapshot = {
      identity: snapshots[0]?.identity || { ticker: '', type: 'OTHER' },
      marketResearch: null,
      issuerResearch: null,
      fundamentals: [],
      newsResearch: [],
      macroResearch: null,
      evidence: [],
    };
    for (const snap of snapshots) {
      if (snap.marketResearch) merged.marketResearch = snap.marketResearch;
      if (snap.issuerResearch) merged.issuerResearch = snap.issuerResearch;
      if (snap.macroResearch) merged.macroResearch = snap.macroResearch;
      if (snap.newsResearch) merged.newsResearch = snap.newsResearch;
      if (snap.evidence) {
        snap.evidence.forEach(e => merged.evidence!.push(e));
      }
    }
    return merged;
  }

  getConflicts(_snapshots: AssetResearchSnapshot[]): ValueConflict[] {
    return [];
  }
}
