import type {
  CurrentAsset,
  MacroGoals,
  AggregatedAsset,
} from '../../xlsx-parser/xlsx-parser.js';
import type { QuikOrder } from '../../xlsx-parser/quik-orders-parser.js';
import { XlsxParserModule } from '../../xlsx-parser/xlsx-parser.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import { Gatekeeper, RssNewsSource } from '../gatekeeper/index.js';
import type { GatekeeperResult } from '../gatekeeper/types.js';

// ──────────────────────────────────────────────
// 1. Data Agent output types
// ──────────────────────────────────────────────

/** Информация о счёте */
export interface AccountInfo {
  name: string;
  value: number;
}

/** Котировка актива из листа "Акции" */
export interface AssetQuote {
  ticker: string;
  name: string;
  shortName: string;
  currentPrice: number;
  dailyDynamicsPercent: number;
}

/** Данные о вложенных средствах */
export interface InvestedFundsData {
  totalNet: number;
  totalPurchases: number;
  totalSales: number;
}

/** Данные о исторических сделках */
export interface HistoricalTradesData {
  tradesCount: number;
  totalPurchasesSum: number;
  totalSalesSum: number;
  profitC10: number;
  profitC11: number;
  totalHistoricalCommission: number;
}

/**
 * Полные выходные данные Data Agent.
 * Передаются в Research Agent и Analysis Agent.
 */
export interface DataAgentOutput {
  /** Агрегированный портфель */
  aggregated: AggregatedAsset[];
  /** Текущие активы (flattened) */
  assets: CurrentAsset[];
  /** Макро-цели из Excel */
  macroGoals: MacroGoals;
  /** Информация о счетах */
  accounts: AccountInfo[];
  /** Котировки */
  quotes: Record<string, AssetQuote>;
  /** Активные заявки QUIK */
  activeOrders: QuikOrder[];
  /** Исторические сделки */
  historicalTrades: HistoricalTradesData;
  /** Вложенные средства */
  investedFunds: InvestedFundsData;
  /** Отфильтрованные новости от Gatekeeper */
  news: GatekeeperResult | null;
}

// ──────────────────────────────────────────────
// 2. Data Agent
// ──────────────────────────────────────────────

/**
 * Data Agent — извлечение и агрегация данных из Excel/QUIK.
 *
 * Задачи:
 * - Парсинг листа QUIK (позиции, цены, НКД, целевые доли)
 * - Парсинг счетов (Портфель_XXXXX)
 * - Парсинг котировок (лист "Акции")
 * - Парсинг заявок QUIK (CSV)
 * - Парсинг исторических сделок
 * - Парсинг вложенных средств
 * - Парсинг макро-целей
 *
 * Все данные агрегируются в DataAgentOutput и передаются
 * дальше по конвейеру (Research Agent + Analysis Agent).
 */
export class DataAgent extends AgentBase {
  private parser: XlsxParserModule;

  constructor(config?: AgentConfig) {
    super(config ?? { name: 'DataAgent' });
    this.parser = new XlsxParserModule();
  }

  protected async executeInternal(_input: unknown): Promise<DataAgentOutput> {
    console.log('[DataAgent] >>> Начало парсинга Excel/QUIK');

    // Шаг 1: Синхронизация новых сделок
    await this.parser.syncNewTrades();

    // Шаг 2: Агрегация портфеля
    const aggregated = await this.parser.parseAggregatedPortfolio();
    const assets = this.parser.aggregatedToCurrentAssets(aggregated);

    // Шаг 3: Макро-цели
    const macroGoals = await this.parser.parseMacroGoals();

    // Шаг 4: Информация о счетах
    const accounts = await this.parser.parseAccountsInfo();

    // Шаг 5: Котировки
    const quotesMap = await this.parser.parseQuotesSheet();
    const quotes: Record<string, AssetQuote> = Object.fromEntries(
      Object.entries(quotesMap)
        .filter(([, value]) => value.currentPrice > 0)
        .map(([key, value]) => [
          key,
          {
            ticker: key,
            name: key,
            shortName: value.shortName || key,
            currentPrice: value.currentPrice,
            dailyDynamicsPercent: value.dailyDynamicsPercent ?? 0,
          },
        ]),
    );

    // Шаг 6: Активные заявки QUIK
    const activeOrders = this.parser.parsedActiveOrders;

    // Шаг 7: Исторические сделки
    const historicalTrades = await this.parser.parseHistoricalTradesAnalysis();

    // Шаг 8: Вложенные средства
    const investedFunds = await this.parser.parseInvestedFunds();

    // Шаг 9: Gatekeeper — фильтрация новостей
    let newsResult: GatekeeperResult | null = null;
    try {
      const monitoredTickers = assets.map((a) => a.ticker);
      const rssSource = new RssNewsSource();
      const gatekeeper = new Gatekeeper(
        {
          monitoredTickers,
          verbose: false,
        },
        [rssSource],
      );
      newsResult = await gatekeeper.run();
      console.log(
        `[DataAgent] ✅ Gatekeeper: ${newsResult.approvedNews.length} новостей одобрено, ` +
        `${newsResult.filteredOut.total} отфильтровано`,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[DataAgent] ⚠️ Gatekeeper ошибка: ${errorMsg}`);
    }

    const output: DataAgentOutput = {
      aggregated,
      assets,
      macroGoals,
      accounts,
      quotes,
      activeOrders,
      historicalTrades: {
        tradesCount: historicalTrades.tradesCount,
        totalPurchasesSum: historicalTrades.totalPurchasesSum,
        totalSalesSum: historicalTrades.totalSalesSum,
        profitC10: historicalTrades.profitC10,
        profitC11: historicalTrades.profitC11,
        totalHistoricalCommission: historicalTrades.totalHistoricalCommission,
      },
      investedFunds: {
        totalNet: investedFunds.totalNet,
        totalPurchases: historicalTrades.totalPurchasesSum,
        totalSales: historicalTrades.totalSalesSum,
      },
      news: newsResult,
    };

    console.log(
      `[DataAgent] ✅ Парсинг завершён: ${assets.length} активов, ` +
      `${accounts.length} счетов, ${activeOrders.length} заявок`,
    );

    return output;
  }
}
