/** Macro Research Provider stub */
import type { AssetResearchSnapshot, ResearchAsset, ResearchContext } from '../types.js';
import { ResearchProvider } from './types.js';

export class MacroResearchProvider extends ResearchProvider {
  name = 'macro';
  supports(_asset: ResearchAsset): boolean { return true; }
  async research(_asset: ResearchAsset, _context: ResearchContext): Promise<AssetResearchSnapshot> {
    return {
      identity: { ticker: '', type: 'OTHER' },
      marketResearch: null,
      issuerResearch: null,
      fundamentals: [],
      newsResearch: [],
      macroResearch: null,
    };
  }
}
