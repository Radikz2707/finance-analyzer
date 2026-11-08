/** News Research Provider stub */
import type { AssetResearchSnapshot, ResearchAsset, ResearchContext } from '../types.js';
import { ResearchProvider } from './types.js';

export class NewsResearchProvider extends ResearchProvider {
  name = 'news';
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
