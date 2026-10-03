/**
 * AnomalySource — источник живых z-score аномалий для HarnessBridge.
 *
 * Повторяет логику «Шага 10» DataAgent (src/js/modules/pipeline/agents/data-agent.ts):
 * 1. Получение тикеров портфеля из агрегированного Excel-портфеля
 *    (XlsxParserModule.parseAggregatedPortfolio → aggregatedToCurrentAssets) —
 *    НЕ хардкод: список строится из реальных данных.
 * 2. fetchHistoricalBatch(тикеры, 180 дней назад, сегодня, 'D').
 * 3. Серии с длиной >= 21 баров → AnomalyDetector.detectAnomalies().
 *
 * Все шаги инъектируемы (DI) для тестируемости без сети/файлов/Python.
 * Любая ошибка источника (нет Excel, нет FINAM_API_KEY, недоступен Python)
 * приводит к [] — поток дашборда не прерывается.
 */

import { XlsxParserModule } from '../xlsx-parser/xlsx-parser.js';
import { fetchHistoricalBatch } from '../data-fetcher/index.js';
import type { OHLCVBar } from '../finam-api/history-provider.js';
import { AnomalyDetector } from '../python-engine/anomaly-detector.js';
import type {
  AnomalyDetectionResult,
  PriceSeriesInput,
} from '../python-engine/types.js';

/** Глубина истории для анализа: 180 дней */
export const HISTORY_DAYS = 180;

/** Минимальное количество баров для детекции (как в DataAgent, шаг 10) */
export const MIN_BARS_FOR_ANALYSIS = 21;

/** Интервал свечей */
const INTERVAL = 'D' as const;

/** Сигнатура загрузчика истории (совпадает с fetchHistoricalBatch) */
export type HistoryLoader = (
  tickers: string[],
  from: string,
  to: string,
  interval: 'D' | 'W' | 'M',
) => Promise<Map<string, OHLCVBar[]>>;

/** Инъекции источника (все опциональны — для тестов и подмены окружения) */
export interface AnomalySourceDeps {
  /** Источник тикеров портфеля (по умолчанию — Excel-агрегация) */
  getTickers?: () => Promise<string[]>;
  /** Загрузчик исторических цен (по умолчанию — Finam/MOEX + кэш SQLite) */
  fetchHistory?: HistoryLoader;
  /** Детектор аномалий (по умолчанию — AnomalyDetector с Python/TS-fallback) */
  detector?: Pick<AnomalyDetector, 'detectAnomalies'>;
}

/** Интерфейс источника аномалий */
export interface AnomalySource {
  /** Загрузить результаты детекции. При любой ошибке — [] */
  load(): Promise<AnomalyDetectionResult[]>;
}

/** Получить тикеры портфеля из Excel-агрегации (как в DataAgent) */
async function getPortfolioTickers(): Promise<string[]> {
  const parser = new XlsxParserModule();
  const aggregated = await parser.parseAggregatedPortfolio();
  return parser
    .aggregatedToCurrentAssets(aggregated)
    .map((asset) => asset.ticker)
    .filter((ticker) => ticker.length > 0);
}

/** Дата «сегодня» в формате YYYY-MM-DD */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Дата «180 дней назад» в формате YYYY-MM-DD */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Создать источник аномалий для HarnessBridge.
 * @param deps — инъекции (для тестов); по умолчанию реальные зависимости.
 */
export function createAnomalySource(
  deps: AnomalySourceDeps = {},
): AnomalySource {
  const getTickers = deps.getTickers ?? getPortfolioTickers;
  const fetchHistory = deps.fetchHistory ?? fetchHistoricalBatch;
  const detector = deps.detector ?? new AnomalyDetector();

  return {
    async load(): Promise<AnomalyDetectionResult[]> {
      try {
        const tickers = await getTickers();
        if (tickers.length === 0) {
          return [];
        }

        const history = await fetchHistory(
          tickers,
          daysAgoIso(HISTORY_DAYS),
          todayIso(),
          INTERVAL,
        );

        const series: PriceSeriesInput[] = [];
        for (const [ticker, bars] of history) {
          if (bars.length >= MIN_BARS_FOR_ANALYSIS) {
            series.push({
              ticker,
              prices: bars.map((bar) => bar.close),
              dates: bars.map((bar) => bar.date),
            });
          }
        }

        if (series.length === 0) {
          return [];
        }

        return await detector.detectAnomalies(series);
      } catch (err) {
        console.warn('[AnomalySource] Не удалось загрузить аномалии:', err);
        return [];
      }
    },
  };
}
