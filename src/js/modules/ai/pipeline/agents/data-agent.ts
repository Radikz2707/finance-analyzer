import type {
  CurrentAsset,
  MacroGoals,
  AggregatedAsset,
  InvestorParams,
} from '../../../data/xlsx-parser/xlsx-parser.js';
import type { QuikOrder } from '../../../data/xlsx-parser/quik-orders-parser.js';
import { XlsxParserModule } from '../../../data/xlsx-parser/xlsx-parser.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import {
  Gatekeeper,
  RssNewsSource,
  MoexNewsSource,
} from '../gatekeeper/index.js';
import { QuikNewsSource } from '../../../api/quik-gateway/index.js';
import type { GatekeeperResult } from '../gatekeeper/types.js';
import {
  buildTechnicalFacts,
  type TechnicalFacts,
} from '../../../api/moex-quotes/technical-facts.js';
import { loadTechnicalHistory } from '../../../api/moex-quotes/technical-history.js';
import { MoexQuotesClient } from '../../../api/moex-quotes/moex-quotes.js';
import { mergeIssQuotes } from '../../../api/moex-quotes/quote-merge.js';
import { PortfolioConfig } from '../../../../config/portfolio-config.js';
import { AnomalyDetector } from '../../../shared/python-engine/index.js';
import type {
  AnomalyDetectionResult,
  PriceSeriesInput,
} from '../../../shared/python-engine/types.js';
import { getCbrKeyRate } from '../../../ai/ai-advisor/cbr-rate.js';
import type { CbrRateData } from '../../../ai/ai-advisor/cbr-rate.js';
import { LiquidityAnalyzer } from '../../../ai/ai-advisor/liquidity-analyzer.js';
import type { LiquidityAnalysis } from '../../../ai/ai-advisor/liquidity-analyzer.js';
import { positionsRepo, newsRepo } from '../../../db/db-manager/db-manager.js';
import { getLogger } from '../../../shared/logger/index.js';
import { MoexQuoteProvider } from '../../../shared/python-engine/moex-quote-provider.js';
import { fetchSmartLabBondByIsin } from '../../../api/smart-lab-api/smart-lab-api.js';
import {
  calculateXirr,
  type XirrResult,
} from '../../../shared/xirr.js';
import { DataOrchestrator } from '../../../data/data-orchestrator/data-orchestrator.js';

// ──────────────────────────────────────────────
// 0. Хелперы персиста новостей
// ──────────────────────────────────────────────

/**
 * Похож ли идентификатор на ISIN (2 буквы + 9 букв/цифр + контрольная цифра).
 * Нужен, чтобы облигация не попала в запрос котировок акций даже при
 * нераспознанном assetType.
 */
function isIsinLike(value: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(value.trim().toUpperCase());
}

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
  'рост',
  'прибыль',
  'доход',
  'успех',
  'развит',
  'инвестиц',
  'покупк',
  'увелич',
  'рекорд',
  'дивиденд',
  'выкуп',
  'одобр',
  'контракт',
  'выигр',
  'лучш',
  'позитив',
  'дивид',
];
const NEGATIVE_WORDS = [
  'паден',
  'снижен',
  'убыт',
  'кризис',
  'риск',
  'санкц',
  'обвал',
  'потер',
  'долг',
  'дефолт',
  'банкрот',
  'суд',
  'арест',
  'штраф',
  'расслед',
  'негатив',
  'провал',
  'угроз',
  'сокращ',
  'блокировк',
  'конфискац',
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

/** Котировка актива из листа "Акции" + MOEX */
export interface AssetQuote {
  ticker: string;
  name: string;
  shortName: string;
  currentPrice: number;
  dailyDynamicsPercent: number;
  /** Дневной оборот в рублях (из Excel, MOEX VALTODAY или Smart-Lab) */
  volumeTodayRub?: number;
  /** Минимальная цена за период (из Excel) */
  minPrice?: number | null;
  /** Максимальная цена за период (из Excel) */
  maxPrice?: number | null;
  /** Рейтинг по динамике (0-100, из Excel) */
  ratingDynamic?: number | null;
  /** Рейтинг по объему (0-100, из Excel) */
  ratingVolume?: number | null;
  /** Общий рейтинг (0-100, из Excel) */
  ratingTotal?: number | null;
  /** Позиция в диапазоне (%) — % от мин/макс за период (из Excel) */
  rangePosition?: number | null;
  /** Сигнал входа из Excel (из Excel) */
  entrySignal?: string | null;
  /**
   * Источник котировки: MOEX ISS (основной), EXCEL (фолбэк),
   * PYTHON_ISS (резерв для облигаций).
   */
  source?: string;
  /** Время среза (ISO), если источник его даёт */
  asOf?: string | null;
}

/** Данные о вложенных средствах */
export interface InvestedFundsData {
  totalNet: number;
  totalPurchases: number;
  totalSales: number;
  totalWithdrawals: number;
  totalDeposits: number;
  averageMonthlyDeposit: number;
  anomalousDepositsTotal: number;
  currentMonthDeposits: number;
  lastMonthDeposits: number;
  currentYearDeposits: number;
  lastYearDeposits: number;
}

/** Данные о исторических сделках */
export interface HistoricalTradesData {
  tradesCount: number;
  totalPurchasesSum: number;
  totalSalesSum: number;
  totalWithdrawalsSum: number;
  totalDepositsSum: number;
  profitC10: number;
  profitC11: number;
  totalHistoricalCommission: number;
  averageMonthlyDeposit: number;
  anomalousDepositsTotal: number;
  currentMonthDeposits: number;
  lastMonthDeposits: number;
  currentYearDeposits: number;
  lastYearDeposits: number;
  /** Все взносы с датами для расчёта XIRR */
  allDeposits: Array<{ value: number; date: Date }>;
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
  /**
   * Технические факты карточки: 52w high/low и SMA по периодам из
   * PortfolioConfig.moexQuotes.smaPeriods. Строятся из той же истории,
   * что и аномалии; нет истории → показатели недоступны.
   */
  technicalFacts?: TechnicalFacts[];
  /** Ключевая ставка ЦБ РФ */
  keyRate: number;
  /** Дата обновления ключевой ставки */
  keyRateDate: string;
  /** Полные данные о ключевой ставке ЦБ (включая source, isFresh) */
  cbrRateData: CbrRateData | null;
  /** Параметры инвестора (горизонт, цель, риск) */
  investorParams?: InvestorParams;
  /**
   * Рыночные данные по облигациям из листа «Облигации».
   * Map<ISIN, BondReferenceData> — полный справочник ~3030 выпусков.
   * Используется для обогащения позиций облигаций и передачи в AI.
   */
  bondMarketData: Map<
    string,
    import('../../../data/xlsx-parser/xlsx-parser.js').BondReferenceData
  >;
  /**
   * Анализ ликвидности портфеля на основе дневных оборотов.
   * Содержит предупреждения и рекомендации по управлению рисками ликвидности.
   */
  liquidityAnalysis?: LiquidityAnalysis;
  /**
   * Предупреждения о невозможности нормализовать цены (например,
   * облигация без номинала и без ориентира MOEX). Выводятся в отчёте.
   */
  priceWarnings?: string[];
  /**
   * XIRR — годовая доходность портфеля по потоку денежных средств.
   * Рассчитывается из allDeposits + totalWithdrawals + marketValue + cash.
   */
  xirr: XirrResult;
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

    // Шаг 2: Агрегация портфеля — ДО orchestrator (нужны тикеры для execute)
    const aggregated = await this.parser.parseAggregatedPortfolio();
    const assets = this.parser.aggregatedToCurrentAssets(aggregated);

    // ── Шаг 0: DataOrchestrator (если включён) ──────────────────────
    if (PortfolioConfig.orchestrator.enabled) {
      const orchestrator = new DataOrchestrator();
      const runResult = await orchestrator.execute(
        assets.map((a) => ({ ticker: a.ticker, assetType: a.assetType })),
      );

      if (runResult.skipped) {
        if (runResult.skipReason === 'flag-off') {
          this.log.info('[DataAgent] Orchestrator disabled (flag-off), legacy path');
        } else if (runResult.skipReason === 'empty-registry') {
          this.log.error(
            '[DataAgent] Orchestrator skipped: empty registry — ' +
            'no quality validation! Registration wiring not implemented.',
          );
        }
      } else if (runResult.gateDecision === 'stop') {
        this.log.error(
          '[DataAgent] ✗ PIPELINE STOP: gateDecision=stop, ' +
          `qualityScore=${runResult.qualityReport?.averageQualityScore ?? 'N/A'}%`,
        );
        throw new Error(
          `Orchestrator gate: stop (qualityScore=${runResult.qualityReport?.averageQualityScore ?? 0}%)`,
        );
      } else if (runResult.gateDecision === 'degrade') {
        this.log.warn(
          `[DataAgent] ⚠ DEGRADE: qualityScore=${runResult.qualityReport?.averageQualityScore ?? 'N/A'}%`,
        );
      } else {
        // pass — продолжаем
        this.log.info(
          '[DataAgent] DataOrchestrator: ' +
          'ok=' + runResult.snapshot.okData.size + '/' + runResult.snapshot.sources.length + ' ' +
          'unavailable=' + runResult.snapshot.unavailableSources.length + ' ' +
          'duration=' + runResult.totalDurationMs + 'ms',
        );
      }
    }

    // Шаг 1: Синхронизация новых сделок
    await this.parser.syncNewTrades();

    // Предупреждения о ценах, которые не удалось нормализовать.
    const priceWarnings = Array.from(
      new Set(
        assets
          .map((asset) => asset.priceWarning)
          .filter((warning): warning is string => Boolean(warning)),
      ),
    );
    if (priceWarnings.length > 0) {
      this.log.warn(
        `[DataAgent] ⚠️ Проблемы нормализации цен: ${priceWarnings.length}`,
      );
    }

    // Шаг 3: Макро-цели
    const macroGoals = await this.parser.parseMacroGoals();

    // Шаг 2.7: Рыночные данные по облигациям (лист «Облигации» A:M)
    const bondMarketData = await this.parser.parseBondsSheet();
    this.log.info(
      `[DataAgent] ✅ BondMarketData: ${bondMarketData.size} выпусков загружено`,
    );

    // Шаг 2.5: Сохранение позиций в БД
    for (const asset of assets) {
      try {
        const totalCost = (asset.quantity || 0) * (asset.balancePrice || 0);
        const currentMarketValue =
          (asset.quantity || 0) * (asset.currentPrice || 0);

        const validAssetType = [
          'STOCK',
          'BOND',
          'ETF',
          'CASH',
          'OTHER',
        ].includes(asset.assetType.toUpperCase())
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
            volumeTodayRub: value.volumeTodayRub ?? undefined,
            minPrice: value.minPrice ?? null,
            maxPrice: value.maxPrice ?? null,
            ratingDynamic: value.ratingDynamic ?? null,
            ratingVolume: value.ratingVolume ?? null,
            ratingTotal: value.ratingTotal ?? null,
            rangePosition: value.rangePosition ?? null,
            entrySignal: value.entrySignal ?? null,
            source: 'EXCEL',
            asOf: null,
          },
        ]),
    );

    // Шаг 5.1: MOEX ISS — ОСНОВНОЙ источник котировок акций.
    // Excel остаётся фолбэком: если ISS не подтвердил тикер, цена берётся
    // из Excel с явной подписью 'EXCEL (фолбэк)'. Облигации здесь не
    // трогаем: цена облигации в ISS — процент от номинала (шаг 5.2).
    try {
      const stockTickers = assets
        .filter((a) => {
          const type = a.assetType ?? '';
          // «О» — короткий тип облигации из QUIK/Excel. Без него облигации
          // уходили в запрос котировок акций и давали failed=10 шума.
          return (
            type !== 'BOND' &&
            type !== 'Облигация' &&
            type !== 'О' &&
            !type.includes('Облиг') &&
            type !== 'CASH'
          );
        })
        .map((a) => a.ticker.toUpperCase())
        // ISIN-подобный идентификатор — это облигация, даже если тип не распознан.
        .filter((ticker) => ticker.length > 0 && !isIsinLike(ticker));

      if (stockTickers.length > 0) {
        const snapshot = await new MoexQuotesClient().fetchCurrentQuotes(
          stockTickers,
        );
        const merged = mergeIssQuotes(quotes, snapshot);
        for (const ticker of Object.keys(quotes)) delete quotes[ticker];
        Object.assign(quotes, merged.quotes);
        this.log.info(
          `[MOEX_QUOTES] applied=${merged.applied.length} ` +
            `excelFallback=${merged.excelFallback.length} ` +
            `unavailable=[${merged.issUnavailable.join(', ')}]`,
        );
      }
    } catch (err) {
      // ISS недоступен целиком: Excel остаётся, но честно подписан фолбэком.
      for (const quote of Object.values(quotes)) {
        if (quote.source === 'EXCEL') quote.source = 'EXCEL (фолбэк)';
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.warn(
        `[MOEX_QUOTES] ⚠️ ISS недоступен, используется Excel-фолбэк: ${errorMsg}`,
      );
    }

    // Шаг 5.2: Котировки облигаций с доски EQOB (MOEX) — оборот и цена.
    // Облигации часто не доступны на доске TQBR (акции), поэтому используем
    // отдельный запрос к boards/EQOB для получения VALTODAY (оборота в RUB).
    try {
      const bondTickers = assets
        .filter(
          (a) =>
            a.assetType === 'BOND' ||
            a.assetType === 'Облигация' ||
            a.assetType.includes('Облиг'),
        )
        .map((a) => a.ticker.toUpperCase())
        .filter(
          (ticker) =>
            !quotes[ticker] ||
            (quotes[ticker].currentPrice <= 0 &&
              !quotes[ticker].volumeTodayRub),
        );
      if (bondTickers.length > 0) {
        const moexProvider = new MoexQuoteProvider();
        const boardQuotes = await moexProvider.fetchBoardQuotes(
          bondTickers,
          'EQOB',
        );
        let added = 0;
        for (const [ticker, quote] of Object.entries(boardQuotes)) {
          const key = ticker.toUpperCase();
          const price = quote.price;
          const changePct = quote.changePct;
          if (price !== null && price > 0) {
            if (!quotes[key]) {
              quotes[key] = {
                ticker: key,
                name: key,
                shortName: key,
                currentPrice: price,
                dailyDynamicsPercent: changePct ?? 0,
                volumeTodayRub: quote.volumeTodayRub ?? undefined,
                source: 'PYTHON_ISS',
                asOf: new Date().toISOString(),
              };
            } else {
              // Дополняем отсутствующий оборот
              if (!quotes[key].volumeTodayRub && quote.volumeTodayRub) {
                quotes[key].volumeTodayRub = quote.volumeTodayRub;
              }
            }
            added++;
          }
        }
        if (added > 0) {
          this.log.info(
            `[DataAgent] ✅ MOEX EQOB: дополнено данных по ${added} облигациям`,
          );
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.warn(`[DataAgent] ⚠️ MOEX EQOB недоступен: ${errorMsg}`);
    }

    // Шаг 5.3: Анализ ликвидности портфеля на основе дневных оборотов.
    // Определяет «мёртвые» активы, предупреждает о рисках ликвидации,
    // оценивает долю низколиквидных активов в портфеле.
    //
    // Приоритет источников оборота:
    // 1. Excel «Акции» (quotes[volumeTodayRub]) — для акций
    // 2. Excel «Облигации» (bondMarketData[ISIN].turnover) — для облигаций
    // 3. MOEX EQOB (get_board_quotes) — fallback для облигаций
    // 4. Smart-Lab — fallback для редких облигаций
    let liquidityAnalysis: LiquidityAnalysis | undefined;
    try {
      // Сначала собираем данные из Excel
      const excelAssets = aggregated
        .filter((a) => a.totalLiquidationValue > 0)
        .map((a) => {
          // Оборот из листа «Акции» (для акций)
          const quotesTurnover = quotes[a.ticker.toUpperCase()]?.volumeTodayRub;
          // Оборот из листа «Облигации» (для облигаций)
          const bondData = bondMarketData.get(a.ticker.toUpperCase());
          const bondTurnover =
            bondData?.turnover != null ? Number(bondData.turnover) : undefined;
          // Приоритет: quotes (акции) → bondMarketData (облигации)
          const dailyTurnover = quotesTurnover ?? bondTurnover ?? null;
          return {
            ticker: a.ticker,
            name: a.name,
            marketValue: a.totalLiquidationValue,
            dailyTurnover,
            hasTurnover: dailyTurnover != null && dailyTurnover > 0,
          };
        });

      // Находим облигации без оборота для догрузки из MOEX/Smart-Lab
      const missingBondTickers = excelAssets
        .filter((a) => !a.hasTurnover)
        .map((a) => ({
          ticker: a.ticker.toUpperCase(),
          isin: a.ticker.toUpperCase(),
          name: a.name,
          marketValue: a.marketValue,
        }));

      const moexTurnovers: Record<string, number> = {};
      const smartlabTurnovers: Record<string, number> = {};

      // 3. MOEX EQOB — догружаем оборот для облигаций
      if (missingBondTickers.length > 0) {
        try {
          const moexProvider = new MoexQuoteProvider();
          const boardQuotes = await moexProvider.fetchBoardQuotes(
            missingBondTickers.map((b) => b.ticker),
            'EQOB',
          );
          for (const [ticker, quote] of Object.entries(boardQuotes)) {
            if (quote.volumeTodayRub != null && quote.volumeTodayRub > 0) {
              moexTurnovers[ticker] = quote.volumeTodayRub;
            }
          }
          if (Object.keys(moexTurnovers).length > 0) {
            this.log.info(
              `[DataAgent] 📊 MOEX EQOB: загружен оборот по ${Object.keys(moexTurnovers).length} облигациям`,
            );
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.log.warn(`[DataAgent] ⚠️ MOEX EQOB недоступен: ${errorMsg}`);
        }
      }

      // 4. Smart-Lab — fallback для тех, у кого нет оборота (null ИЛИ 0)
      // NOTE: Smart-Lab API для облигаций часто возвращает 404 (страницы
      // /q/bonds/{TICKER}/ не существуют для корпоративных бумаг).
      // Оставляем как запасной вариант, но не спамим ошибками.
      const smartlabTickers = missingBondTickers
        .filter(
          (b) => !moexTurnovers[b.ticker] || moexTurnovers[b.ticker] === 0,
        )
        .slice(0, 5); // максимум 5, чтобы не перегружать

      if (smartlabTickers.length > 0) {
        this.log.info(
          `[DataAgent] 📊 Smart-Lab: запрашиваем оборот для ${smartlabTickers.length} облигаций (fallback)`,
        );
        try {
          const results = await Promise.allSettled(
            smartlabTickers.map(async (b) => {
              try {
                const data = await fetchSmartLabBondByIsin(b.isin);
                if (data && data.volume != null && data.volume > 0) {
                  this.log.info(
                    `[DataAgent] 📊 Smart-Lab: ${b.ticker} volume=${data.volume} млн руб`,
                  );
                  return {
                    ticker: b.ticker,
                    isin: b.isin,
                    volume: data.volume * 1e6,
                  }; // млн → руб
                }
              } catch {
                // Smart-Lab часто 404 для корпоративных облигаций — не спамим
              }
              return null;
            }),
          );
          for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
              // Используем ISIN как ключ
              smartlabTurnovers[result.value.isin] = result.value.volume;
            }
          }
          if (Object.keys(smartlabTurnovers).length > 0) {
            this.log.info(
              `[DataAgent] 📊 Smart-Lab: загружен оборот по ${Object.keys(smartlabTurnovers).length} облигациям`,
            );
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.log.warn(`[DataAgent] ⚠️ Smart-Lab недоступен: ${errorMsg}`);
        }
      }

      // Собираем финальный массив с оборотом из всех источников
      const liquidityAssets = excelAssets.map((a) => {
        const ticker = a.ticker.toUpperCase();
        // Приоритет: Excel → MOEX EQOB → Smart-Lab
        const dailyTurnover =
          a.dailyTurnover ??
          moexTurnovers[ticker] ??
          smartlabTurnovers[ticker] ??
          null;
        return {
          ticker: a.ticker,
          name: a.name,
          marketValue: a.marketValue,
          dailyTurnover,
        };
      });

      if (liquidityAssets.length > 0) {
        const analyzer = new LiquidityAnalyzer();
        liquidityAnalysis = analyzer.analyze(liquidityAssets);
        this.log.info(
          `[DataAgent] 📊 Ликвидность: статус=${liquidityAnalysis.summary.status}, ` +
            `HIGH=${liquidityAnalysis.summary.highLiquidityPct.toFixed(0)}%, ` +
            `LOW=${liquidityAnalysis.summary.lowLiquidityPct.toFixed(0)}%, ` +
            `CRITICAL=${liquidityAnalysis.summary.criticalLiquidityPct.toFixed(0)}%`,
        );
        if (liquidityAnalysis.warnings.length > 0) {
          this.log.warn(
            `[DataAgent] ⚠️ Предупреждения ликвидности: ${liquidityAnalysis.warnings.length}`,
          );
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.warn(
        `[DataAgent] ⚠️ Анализ ликвидности недоступен: ${errorMsg}`,
      );
    }

    // Шаг 6: Активные заявки QUIK
    const activeOrders = this.parser.parsedActiveOrders;

    // Шаг 7: Исторические сделки
    const historicalTrades = await this.parser.parseHistoricalTradesAnalysis();

    // Шаг 8: Вложенные средства
    const investedFunds = await this.parser.parseInvestedFunds();

    // Пересчитываем averageMonthlyDeposit: (всего внесено - аномальные) / месяцы
    const monthsSinceStart = Math.max(
      1,
      Math.floor(
        (Date.now() - this.parser['startDate'].getTime()) /
          (30 * 24 * 60 * 60 * 1000),
      ),
    );
    const totalDepositsSum = historicalTrades.totalDepositsSum || 0;
    const anomalousDepositsTotal = historicalTrades.anomalousDepositsTotal || 0;
    const recalculatedAverageMonthlyDeposit = Math.round(
      (totalDepositsSum - anomalousDepositsTotal) / monthsSinceStart,
    );

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
        const sentiment = detectNewsSentiment(`${item.title} ${item.summary}`);
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
    const technicalFacts: TechnicalFacts[] = [];
    try {
      const anomalyTickers = assets.map((a) => a.ticker);
      const toDate = new Date().toISOString().slice(0, 10);
      // Окно истории — из конфига: то же окно питает 52w-диапазон и SMA.
      const fromDate = new Date(
        Date.now() -
          PortfolioConfig.moexQuotes.historyWindowDays * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10);

      // История грузится по тикерам: сбой одного (нет доски, сеть) больше не
      // обнуляет техфакты у всех. Единственный источник — MoexQuotesClient
      // (MOEX ISS). Ветка data-fetcher удалена: в прогоне 19:35 UTC она давала
      // primary=0 при fallback=4, то есть была мёртвой.
      const quotesClient = new MoexQuotesClient();
      const history = await loadTechnicalHistory(
        anomalyTickers,
        fromDate,
        toDate,
        {
          load: (ticker, from, to) =>
            quotesClient.fetchDailyHistory(ticker, from, to),
        },
        {
          info: (message) => this.log.info(message),
          warn: (message) => this.log.warn(message),
        },
      );

      const series: PriceSeriesInput[] = [];
      for (const item of history) {
        if (item.bars.length >= 21) {
          series.push({
            ticker: item.ticker,
            prices: item.bars.map((b) => b.close),
            dates: item.bars.map((b) => b.date),
          });
        }
      }

      for (const item of history) {
        technicalFacts.push(buildTechnicalFacts(item.ticker, item.bars));
      }
      const facts52w = technicalFacts.filter(
        (facts) => facts.high52w !== null && facts.low52w !== null,
      ).length;
      this.log.info(
        `[TECH_FACTS] tickers=${technicalFacts.length} with52w=${facts52w} ` +
          `smaPeriods=${PortfolioConfig.moexQuotes.smaPeriods.join('/')}`,
      );

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
      this.log.warn(
        `[DataAgent] ⚠️ Ошибка получения ключевой ставки: ${errorMsg}`,
      );
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
        totalWithdrawalsSum: historicalTrades.totalWithdrawalsSum || 0,
        totalDepositsSum: historicalTrades.totalDepositsSum || 0,
        profitC10: historicalTrades.profitC10,
        profitC11: historicalTrades.profitC11,
        totalHistoricalCommission: historicalTrades.totalHistoricalCommission,
        averageMonthlyDeposit: recalculatedAverageMonthlyDeposit,
        anomalousDepositsTotal: historicalTrades.anomalousDepositsTotal || 0,
        currentMonthDeposits: historicalTrades.currentMonthDeposits || 0,
        lastMonthDeposits: historicalTrades.lastMonthDeposits || 0,
        currentYearDeposits: historicalTrades.currentYearDeposits || 0,
        lastYearDeposits: historicalTrades.lastYearDeposits || 0,
        allDeposits: historicalTrades.allDeposits || [],
      },
      investedFunds: {
        totalNet: investedFunds.totalNet,
        totalPurchases: historicalTrades.totalPurchasesSum,
        totalSales: historicalTrades.totalSalesSum,
        totalWithdrawals: historicalTrades.totalWithdrawalsSum || 0,
        totalDeposits: historicalTrades.totalDepositsSum || 0,
        averageMonthlyDeposit: recalculatedAverageMonthlyDeposit,
        anomalousDepositsTotal: historicalTrades.anomalousDepositsTotal || 0,
        currentMonthDeposits: historicalTrades.currentMonthDeposits || 0,
        lastMonthDeposits: historicalTrades.lastMonthDeposits || 0,
        currentYearDeposits: historicalTrades.currentYearDeposits || 0,
        lastYearDeposits: historicalTrades.lastYearDeposits || 0,
      },
      news: newsResult,
      anomalies,
      technicalFacts,
      keyRate,
      keyRateDate,
      cbrRateData: cbrRateDataResult,
      bondMarketData,
      liquidityAnalysis,
      priceWarnings,
      xirr: {
        rate: null,
        reason: 'не рассчитан',
        cashFlows: [],
        npv: 0,
      },
    };

    // ─── XIRR: расчёт годовой доходности ───
    try {
      const marketValue = assets.reduce(
        (sum, a) => sum + (a.quantity ?? 0) * (a.currentPrice ?? 0),
        0,
      );
      const cash = macroGoals.freeCash ?? 0;
      const today = new Date();

      const xirr = calculateXirr(
        historicalTrades.allDeposits || [],
        historicalTrades.totalWithdrawalsSum || 0,
        marketValue,
        cash,
        today,
        undefined, // plzlPurchaseFlows
        undefined, // plzlCurrentMarketValue
        false, // withdrawalsHaveDates — выводы агрегированы без дат
      );

      // Логируем поток CF для отладки
      const cfSummary = xirr.cashFlows
        .map((cf) => `${cf.date.toISOString().slice(0, 10)}: ${cf.amount.toFixed(0)}₽`)
        .join('; ');
      this.log.info(`[XIRR] Поток CF: ${cfSummary}`);
      this.log.info(
        `[XIRR] Доходность: ${xirr.rate !== null ? xirr.rate.toFixed(2) + '%' : 'н/д'}, причина: ${xirr.reason}`,
      );

      output.xirr = xirr;
    } catch (err) {
      this.log.warn(
        `[DataAgent] ⚠️ Ошибка расчёта XIRR: ${err instanceof Error ? err.message : String(err)}`,
      );
      output.xirr = {
        rate: null,
        reason: 'Ошибка расчёта',
        cashFlows: [],
        npv: 0,
      };
    }

    // Парсим параметры инвестора (опционально)
    try {
      const params = await this.parser.parseInvestorParams();
      if (params) output.investorParams = params;
    } catch (e) {
      this.log.warn(
        '[DataAgent] ⚠️ Не удалось прочитать параметры инвестора:',
        e,
      );
    }

    this.log.info(
      `[DataAgent] ✅ Парсинг завершён: ${assets.length} активов, ` +
        `${accounts.length} счетов, ${activeOrders.length} заявок`,
    );

    // Освобождаем память — workbook больше не нужен
    this.parser.cleanup();

    return output;
  }
}
