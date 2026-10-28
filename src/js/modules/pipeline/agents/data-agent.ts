import type {
  CurrentAsset,
  MacroGoals,
  AggregatedAsset,
  InvestorParams,
} from '../../xlsx-parser/xlsx-parser.js';
import type { QuikOrder } from '../../xlsx-parser/quik-orders-parser.js';
import { XlsxParserModule } from '../../xlsx-parser/xlsx-parser.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import {
  Gatekeeper,
  RssNewsSource,
  MoexNewsSource,
} from '../gatekeeper/index.js';
import { QuikNewsSource } from '../../quik-gateway/index.js';
import type { GatekeeperResult } from '../gatekeeper/types.js';
import { fetchHistoricalBatch } from '../../data-fetcher/index.js';
import {
  AnomalyDetector,
  MoexQuoteProvider,
} from '../../python-engine/index.js';
import type {
  AnomalyDetectionResult,
  PriceSeriesInput,
} from '../../python-engine/types.js';
import { getCbrKeyRate } from '../../ai-advisor/cbr-rate.js';
import type { CbrRateData } from '../../ai-advisor/cbr-rate.js';
import { positionsRepo, newsRepo } from '../../db-manager/db-manager.js';
import { getLogger } from '../../logger/index.js';

// ──────────────────────────────────────────────
// 0. Хелперы персиста новостей
// ──────────────────────────────────────────────

/** Приоритет Gatekeeper → важность в БД */
function toNewsImportance(
  priority: string,
): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  switch (priority) {
    case 'critical':
      return 'CRITICAL';
    case 'high':
      return 'HIGH';
    case 'medium':
      return 'MEDIUM';
    default:
      return 'LOW';
  }
}

/** Ключевые слова → сентимент (компактная эвристика, как в NewsCache) */
const POSITIVE_WORDS = [
  'рост', 'прибыль', 'доход', 'успех', 'развит', 'инвестиц', 'покупк',
  'увелич', 'рекорд', 'дивиденд', 'выкуп', 'одобр', 'контракт', 'выигр',
  'лучш', 'позитив', 'дивид',
];
const NEGATIVE_WORDS = [
  'паден', 'снижен', 'убыт', 'кризис', 'риск', 'санкц', 'обвал', 'потер',
  'долг', 'дефолт', 'банкрот', 'суд', 'арест', 'штраф', 'расслед',
  'негатив', 'провал', 'угроз', 'сокращ', 'блокировк', 'конфискац',
];

function detectNewsSentiment(
  text: string,
): 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'UNKNOWN' {
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of POSITIVE_WORDS) {
    if (lower.includes(word)) score++;
  }
  for (const word of NEGATIVE_WORDS) {
    if (lower.includes(word)) score--;
  }
  if (score > 0) return 'POSITIVE';
  if (score < 0) return 'NEGATIVE';
  return 'NEUTRAL';
}

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
  averageMonthlyDeposit: number;
  anomalousDepositsTotal: number;
}

/** Данные о исторических сделках */
export interface HistoricalTradesData {
  tradesCount: number;
  totalPurchasesSum: number;
  totalSalesSum: number;
  profitC10: number;
  profitC11: number;
  totalHistoricalCommission: number;
  averageMonthlyDeposit: number;
  anomalousDepositsTotal: number;
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
  /** Статистические аномалии цен (Python Engine) */
  anomalies: AnomalyDetectionResult[];
  /** Ключевая ставка ЦБ РФ */
  keyRate: number;
  /** Дата обновления ключевой ставки */
  keyRateDate: string;
  /** Полные данные о ключевой ставке ЦБ (включая source, isFresh) */
  cbrRateData: CbrRateData | null;
  /** Параметры инвестора (горизонт, цель, риск) */
  investorParams?: InvestorParams;
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
  private readonly log = getLogger('data-agent');
  private parser: XlsxParserModule;

  constructor(config?: AgentConfig) {
    super(config ?? { name: 'DataAgent' });
    this.parser = new XlsxParserModule();
  }

  protected async executeInternal(_input: unknown): Promise<DataAgentOutput> {
    this.log.info('[DataAgent] >>> Начало парсинга Excel/QUIK');

    try {
      // Шаг 1: Синхронизация новых сделок
      await this.parser.syncNewTrades();

      // Шаг 2: Агрегация портфеля
      const aggregated = await this.parser.parseAggregatedPortfolio();
      const assets = this.parser.aggregatedToCurrentAssets(aggregated);

      // Шаг 3: Макро-цели
      const macroGoals = await this.parser.parseMacroGoals();

    // Шаг 2.5: Сохранение позиций в БД
    for (const asset of assets) {
      try {
        const totalCost = (asset.quantity || 0) * (asset.balancePrice || 0);
        const currentMarketValue =
          (asset.quantity || 0) * (asset.currentPrice || 0);

        const validAssetType = ['STOCK', 'BOND', 'ETF', 'CASH', 'OTHER'].includes(
          asset.assetType.toUpperCase(),
        )
          ? (asset.assetType.toUpperCase() as
              'STOCK' | 'BOND' | 'ETF' | 'CASH' | 'OTHER')
          : 'OTHER';

        positionsRepo.upsert({
          ticker: asset.ticker,
          name: asset.name,
          assetType: validAssetType,
          issuer: asset.name,
          currency: 'RUB',
          market: 'MOEX',
          quantity: asset.quantity || 0,
          avgPrice: asset.balancePrice || 0,
          totalCost: totalCost,
          currentPrice: asset.currentPrice || 0,
          currentMarketValue: currentMarketValue,
          targetPercent: asset.targetPercent,
          status: 'ACTIVE',
        });
      } catch (e) {
        this.log.error(`[DataAgent] ❌ Ошибка сохранения ${asset.ticker}:`, e);
      }
    }

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

    // Шаг 5.1: Резервные котировки MOEX (Python Engine) — дополняем ТОЛЬКО
    // отсутствующие тикеры. Excel остаётся основным источником; Moex — fallback.
    // Любая ошибка (нет Python, сеть, пустой ответ) не прерывает конвейер.
    try {
      const missingTickers = assets
        .map((a) => a.ticker.toUpperCase())
        .filter(
          (ticker) => !quotes[ticker] || quotes[ticker].currentPrice <= 0,
        );
      if (missingTickers.length > 0) {
        const moexProvider = new MoexQuoteProvider();
        const moexQuotes = await moexProvider.fetchQuotes(missingTickers);
        let added = 0;
        for (const [ticker, quote] of Object.entries(moexQuotes)) {
          const key = ticker.toUpperCase();
          if (quote.price > 0 && !quotes[key]) {
            quotes[key] = {
              ticker: key,
              name: key,
              shortName: key,
              currentPrice: quote.price,
              dailyDynamicsPercent: quote.changePct,
            };
            added++;
          }
        }
        if (added > 0) {
          this.log.info(
            `[DataAgent] ✅ MOEX fallback: дополнено котировок по ${added} тикерам`,
          );
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.warn(`[DataAgent] ⚠️ MOEX-котировки недоступны: ${errorMsg}`);
    }

    // Шаг 6: Активные заявки QUIK
    const activeOrders = this.parser.parsedActiveOrders;

    // Шаг 7: Исторические сделки
    const historicalTrades = await this.parser.parseHistoricalTradesAnalysis();

    // Шаг 8: Вложенные средства
    const investedFunds = await this.parser.parseInvestedFunds();

    // Шаг 9: Gatekeeper — фильтрация новостей (RSS + MOEX + QUIK)
    let newsResult: GatekeeperResult | null = null;
    try {
      const monitoredTickers = assets.map((a) => a.ticker);

      // Создаём все источники новостей
      const rssSource = new RssNewsSource();
      const moexSource = new MoexNewsSource({ enabled: true, maxItems: 50 });
      // QUIK-канал: при недоступности терминала fetch() вернёт [] —
      // поток данных не прерывается
      const quikSource = new QuikNewsSource({ enabled: true });

      const gatekeeper = new Gatekeeper(
        {
          monitoredTickers,
          verbose: false,
        },
        [rssSource, moexSource, quikSource],
      );
      newsResult = await gatekeeper.run();
      this.log.info(
        `[DataAgent] ✅ Gatekeeper: ${newsResult.approvedNews.length} новостей одобрено, ` +
          `${newsResult.filteredOut.total} отфильтровано`,
      );

      // Персист одобренных новостей в БД (relevance_to_ticker, is_processed=1):
      // desktop-Директор и NewsDriver читают реальный новостной фон из newsRepo.
      let persistedNews = 0;
      for (const item of newsResult.approvedNews) {
        const sentiment = detectNewsSentiment(
          `${item.title} ${item.summary}`,
        );
        for (const ticker of item.relevantTickers) {
          try {
            newsRepo.addProcessed({
              title: item.title,
              date: item.publishedAt,
              source: item.source,
              url: item.url,
              importance: toNewsImportance(item.priority),
              sentiment,
              summary: item.summary,
              relevanceToTicker: ticker,
            });
            persistedNews++;
          } catch {
            // Ошибка БД не прерывает конвейер
          }
        }
      }
      if (persistedNews > 0) {
        this.log.info(
          `[DataAgent] 💾 Новостей сохранено в БД: ${persistedNews}`,
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.warn(`[DataAgent] ⚠️ Gatekeeper ошибка: ${errorMsg}`);
    }

    // Шаг 10: Python Engine — статистические аномалии цен
    let anomalies: AnomalyDetectionResult[] = [];
    try {
      const anomalyTickers = assets.map((a) => a.ticker);
      const toDate = new Date().toISOString().slice(0, 10);
      const fromDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const history = await fetchHistoricalBatch(
        anomalyTickers,
        fromDate,
        toDate,
        'D',
      );

      const series: PriceSeriesInput[] = [];
      for (const [ticker, bars] of history) {
        if (bars.length >= 21) {
          series.push({
            ticker,
            prices: bars.map((b) => b.close),
            dates: bars.map((b) => b.date),
          });
        }
      }

      if (series.length > 0) {
        const detector = new AnomalyDetector();
        anomalies = await detector.detectAnomalies(series);
        const anomalyCount = anomalies.filter((a) => a.isLastAnomaly).length;
        this.log.info(
          `[DataAgent] 🐍 Python Engine: анализ ${anomalies.length} тикеров, ` +
            `${anomalyCount} с аномалией на последнем баре`,
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.warn(`[DataAgent] ⚠️ Python Engine ошибка: ${errorMsg}`);
    }

    // Шаг 11: Ключевая ставка ЦБ РФ
    let keyRate = 0;
    let keyRateDate = '—';
    let cbrRateDataResult: CbrRateData | null = null;
    try {
      cbrRateDataResult = await getCbrKeyRate();
      keyRate = cbrRateDataResult.rate;
      keyRateDate = cbrRateDataResult.date;
      this.log.info(
        `[DataAgent] 🏛️ Ключевая ставка ЦБ: ${keyRate}% (от ${keyRateDate}, source=${cbrRateDataResult.source}, fresh=${cbrRateDataResult.isFresh})`,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.warn(`[DataAgent] ⚠️ Ошибка получения ключевой ставки: ${errorMsg}`);
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
        averageMonthlyDeposit: historicalTrades.averageMonthlyDeposit || 0,
        anomalousDepositsTotal: historicalTrades.anomalousDepositsTotal || 0,
      },
      investedFunds: {
        totalNet: investedFunds.totalNet,
        totalPurchases: historicalTrades.totalPurchasesSum,
        totalSales: historicalTrades.totalSalesSum,
        averageMonthlyDeposit: historicalTrades.averageMonthlyDeposit || 0,
        anomalousDepositsTotal: historicalTrades.anomalousDepositsTotal || 0,
      },
      news: newsResult,
      anomalies,
      keyRate,
      keyRateDate,
      cbrRateData: cbrRateDataResult,
    };

    // Парсим параметры инвестора (опционально)
    try {
      const params = await this.parser.parseInvestorParams();
      if (params) output.investorParams = params;
    } catch (e) {
      this.log.warn('[DataAgent] ⚠️ Не удалось прочитать параметры инвестора:', e);
    }

    this.log.info(
      `[DataAgent] ✅ Парсинг завершён: ${assets.length} активов, ` +
        `${accounts.length} счетов, ${activeOrders.length} заявок`,
    );

    // Освобождаем память — workbook больше не нужен
    this.parser.cleanup();

    return output;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.error('[DataAgent] ❌ Ошибка executeInternal:', errorMsg);
      throw err;
    }
  }
}
