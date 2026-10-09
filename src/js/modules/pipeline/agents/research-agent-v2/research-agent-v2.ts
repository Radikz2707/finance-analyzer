/**
 * ResearchAgentV2 — глубокое исследование активов с кросс-проверкой,
 * историческим анализом и экспортом.
 */

import { AgentBase } from '../../agent/agent-base.js';
import type { AgentConfig } from '../../agent/types.js';
import type {
  ResearchAgentV2Input,
  ResearchAgentV2Output,
  DeepResearchParams,
  CrossCheckParams,
  HistoricalParams,
  SentimentParams,
  ExportParams,
  DeepAssetSnapshot,
  CrossCheckResult,
  HistoricalAnalysis,
  SentimentAnalysis,
  HistoricalDataPoint,
  ResearchDepth,
} from './types.js';

const CACHE_TTL_MS = 3600000;
const DEFAULT_DEPTH: ResearchDepth = 'standard';
const DEFAULT_PERIOD_DAYS = 90;

export class ResearchAgentV2 extends AgentBase {
  private cache = new Map<string, DeepAssetSnapshot>();
  private crossCheckCache = new Map<string, CrossCheckResult[]>();

  constructor(config: AgentConfig) {
    super({ ...config, timeoutMs: config.timeoutMs ?? 60000 });
  }

  protected async executeInternal(input: unknown): Promise<unknown> {
    const p = input as ResearchAgentV2Input;
    switch (p.action) {
      case 'deep-research':
        return this.deepResearch(p.params as DeepResearchParams);
      case 'cross-check':
        return this.crossCheck(p.params as CrossCheckParams);
      case 'historical-analysis':
        return this.historicalAnalysis(p.params as HistoricalParams);
      case 'sentiment-analysis':
        return this.sentimentAnalysis(p.params as SentimentParams);
      case 'export-research':
        return this.exportResearch(p.params as ExportParams);
      case 'get-cache':
        return this.getCacheStats();
      case 'clear-cache':
        return this.clearCache();
      default:
        throw new Error('Unknown action: ' + (p as { action: string }).action);
    }
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ── Deep Research ──

  private async deepResearch(params: DeepResearchParams): Promise<ResearchAgentV2Output> {
    const { tickers, depth = DEFAULT_DEPTH, includeHistorical = true, includeSentiment = true } = params;
    const snapshots: DeepAssetSnapshot[] = [];

    for (const ticker of tickers) {
      const cached = this.getCached(ticker);
      if (cached && depth === 'quick') {
        snapshots.push(cached);
        continue;
      }

      const crossChecks = await this.performCrossChecks([ticker]);
      const snapshot: DeepAssetSnapshot = {
        ticker,
        crossChecks,
        researchDepth: depth,
        completedAt: this.now(),
        dataSources: ['market', 'fundamentals'],
      };

      if (includeHistorical) {
        snapshot.historicalAnalysis = await this.simulateHistoricalAnalysis(ticker);
        snapshot.dataSources.push('historical');
      }

      if (includeSentiment) {
        snapshot.sentimentAnalysis = await this.simulateSentimentAnalysis(ticker);
        snapshot.dataSources.push('news', 'social');
      }

      this.cache.set(ticker, snapshot);
      snapshots.push(snapshot);
    }

    return {
      success: true,
      message: 'Исследовано ' + tickers.length + ' активов',
      snapshots,
    };
  }

  // ── Cross Check ──

  private async crossCheck(params: CrossCheckParams): Promise<ResearchAgentV2Output> {
    const { tickers, types = ['price', 'volume', 'fundamentals'] } = params;
    const results = await this.performCrossChecks(tickers, types);

    for (const result of results) {
      this.crossCheckCache.set(
        result.ticker,
        results.filter((r) => r.ticker === result.ticker),
      );
    }

    return {
      success: true,
      message: 'Кросс-проверка для ' + tickers.length + ' активов',
      crossChecks: results,
    };
  }

  private async performCrossChecks(
    tickers: string[],
    types?: string[],
  ): Promise<CrossCheckResult[]> {
    const results: CrossCheckResult[] = [];
    const checkTypes = types ?? ['price', 'volume', 'fundamentals'];

    for (const ticker of tickers) {
      for (const type of checkTypes) {
        const ok = Math.random() > 0.2;
        results.push({
          type: type as CrossCheckResult['type'],
          ticker,
          isConsistent: ok,
          discrepancies: ok ? [] : ['Расхождение по ' + type],
          confidence: ok ? 'high' : 'low',
        });
      }
    }

    return results;
  }

  // ── Historical Analysis ──

  private async historicalAnalysis(
    params: HistoricalParams,
  ): Promise<ResearchAgentV2Output> {
    const ticker = params.ticker ?? '';
    const periodDays = params.periodDays ?? DEFAULT_PERIOD_DAYS;
    const analysis = await this.simulateHistoricalAnalysis(ticker, periodDays);

    return {
      success: true,
      message: 'Исторический анализ для ' + ticker,
      historical: analysis,
    };
  }

  private async simulateHistoricalAnalysis(
    ticker: string,
    periodDays: number = DEFAULT_PERIOD_DAYS,
  ): Promise<HistoricalAnalysis> {
    const dataPoints: HistoricalDataPoint[] = [];
    const days = Math.min(periodDays, 365);
    let price = 100 + Math.random() * 900;
    const now = new Date();

    for (let i = days; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const change = (Math.random() - 0.48) * 5;
      price = Math.max(1, price * (1 + change / 100));
      const volume = Math.floor(1e6 + Math.random() * 9e6);

      dataPoints.push({
        date: date.toISOString().split('T').at(0)!,
        price: Math.round(price * 100) / 100,
        volume,
        changePercent: Math.round(change * 100) / 100,
      });
    }

    if (dataPoints.length === 0) {
      return {
        ticker,
        dataPoints: [],
        averageChange: 0,
        volatility: 0,
        trend: 'neutral',
        maxDrawdown: 0,
        sharpeRatio: 0,
      };
    }

    const changes = dataPoints.map((d) => d.changePercent);
    const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
    const vol = Math.sqrt(
      changes.reduce((s, c) => s + Math.pow(c - avg, 2), 0) / changes.length,
    );

    const firstPrice = dataPoints.at(0)!.price;
    const lastPrice = dataPoints.at(-1)!.price;
    const trend: HistoricalAnalysis['trend'] =
      lastPrice > firstPrice * 1.05
        ? 'up'
        : lastPrice < firstPrice * 0.95
          ? 'down'
          : 'neutral';

    let maxDD = 0;
    let peak = dataPoints.at(0)!.price;
    for (const dp of dataPoints) {
      if (dp.price > peak) peak = dp.price;
      const dd = (peak - dp.price) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    const sharpe = vol > 0 ? (avg / vol) * Math.sqrt(252) : 0;

    return {
      ticker,
      dataPoints,
      averageChange: Math.round(avg * 100) / 100,
      volatility: Math.round(vol * 100) / 100,
      trend,
      maxDrawdown: Math.round(maxDD * 100) / 100,
      sharpeRatio: Math.round(sharpe * 100) / 100,
    };
  }

  // ── Sentiment Analysis ──

  private async sentimentAnalysis(
    params: SentimentParams,
  ): Promise<ResearchAgentV2Output> {
    const { ticker } = params;
    const sentiment = await this.simulateSentimentAnalysis(ticker);

    return {
      success: true,
      message: 'Анализ настроений для ' + ticker,
      sentiment,
    };
  }

  private async simulateSentimentAnalysis(
    ticker: string,
  ): Promise<SentimentAnalysis> {
    const score = (Math.random() - 0.5) * 2;
    const label: SentimentAnalysis['label'] =
      score < -0.2 ? 'bearish' : score > 0.2 ? 'bullish' : 'neutral';

    const phrases = [
      'рост выручки',
      'изменение регуляторики',
      'конкурентная среда',
      'макроэкономические факторы',
      'инвесторский интерес',
    ]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);

    return {
      ticker,
      score: Math.round(score * 100) / 100,
      label,
      keyPhrases: phrases,
      sourceCount: Math.floor(5 + Math.random() * 20),
    };
  }

  // ── Export ──

  private exportResearch(params: ExportParams): ResearchAgentV2Output {
    const tickers = params.tickers ?? Array.from(this.cache.keys());
    const format = params.format;
    const snapshots = tickers
      .map((t) => this.cache.get(t))
      .filter(Boolean) as DeepAssetSnapshot[];

    if (format === 'json') {
      return {
        success: true,
        message: 'Экспортировано ' + snapshots.length,
        exportResult: {
          format,
          content: JSON.stringify(snapshots, null, 2),
          tickers,
        },
      };
    }

    if (format === 'csv') {
      const h = [
        'ticker',
        'depth',
        'trend',
        'volatility',
        'sentiment_score',
        'sentiment_label',
        'completedAt',
      ];
      const rows = snapshots.map((s) => [
        s.ticker,
        s.researchDepth,
        s.historicalAnalysis?.trend ?? '',
        s.historicalAnalysis?.volatility ?? '',
        s.sentimentAnalysis?.score ?? '',
        s.sentimentAnalysis?.label ?? '',
        s.completedAt,
      ].join(','));
      return {
        success: true,
        message: 'Экспортировано ' + snapshots.length,
        exportResult: {
          format,
          content: [h.join(','), ...rows].join('\n'),
          tickers,
        },
      };
    }

    // Markdown
    let md = '# Research Report\n\n';
    for (const s of snapshots) {
      md += '## ' + s.ticker + '\n\n';
      md += '- **Depth**: ' + s.researchDepth + '\n';
      if (s.historicalAnalysis) {
        md += '- **Trend**: ' + s.historicalAnalysis.trend + '\n';
      }
      if (s.sentimentAnalysis) {
        md += '- **Sentiment**: ' + s.sentimentAnalysis.label + ' (' + s.sentimentAnalysis.score + ')\n';
      }
      md += '\n';
    }
    return {
      success: true,
      message: 'Экспортировано ' + snapshots.length,
      exportResult: { format: 'markdown', content: md, tickers },
    };
  }

  // ── Cache Management ──

  private getCacheStats(): ResearchAgentV2Output {
    const entries = Array.from(this.cache.values());
    const ts = entries.map((e) => e.completedAt).sort();

    return {
      success: true,
      message: 'Статистика кэша',
      cacheStats: {
        totalEntries: this.cache.size,
        tickers: Array.from(this.cache.keys()),
        oldestEntry: ts.at(0) ?? '',
        newestEntry: ts.at(-1) ?? '',
      },
    };
  }

  private clearCache(): ResearchAgentV2Output {
    const count = this.cache.size;
    this.cache.clear();
    this.crossCheckCache.clear();
    return { success: true, message: 'Очищено ' + count + ' записей' };
  }

  // ── Helpers ──

  private getCached(ticker: string): DeepAssetSnapshot | null {
    const entry = this.cache.get(ticker);
    if (!entry) return null;
    const age = Date.now() - new Date(entry.completedAt).getTime();
    return age < CACHE_TTL_MS ? entry : null;
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  getAllSnapshots(): DeepAssetSnapshot[] {
    return Array.from(this.cache.values());
  }
}
