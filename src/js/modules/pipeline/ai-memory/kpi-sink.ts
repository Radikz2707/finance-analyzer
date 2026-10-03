/**
 * KPI Sink — авто-архивация сжатых KPI портфеля в стратегическую память.
 *
 * После успешного run() PipelineCoordinator собирает компактный снимок
 * метрик из реальных полей PipelineResult (stages.data / stages.analysis /
 * reviewResult) и сохраняет его в стратегическую память (kpi_snapshot).
 *
 * Правила:
 * - Используются ТОЛЬКО реальные поля выходных данных агентов.
 * - Если данных недостаточно (нет стоимости портфеля и долей) — пропуск
 *   с предупреждением (никаких выдуманных значений).
 * - Ошибка сохранения не роняет конвейер (try/catch внутри).
 */

import type { PortfolioKpiSnapshot } from './types.js';
import type { PipelineResult } from '../pipeline-coordinator.js';
import type { DataAgentOutput } from '../agents/data-agent.js';
import type { AnalysisAgentOutput } from '../agents/analysis-agent.js';

/** Сжатый KPI-объект (только реальные поля) */
export interface CompactPortfolioKpi {
  /** Дата снимка (ISO 8601) */
  date: string;
  /** Общая стоимость портфеля (₽) */
  totalValue?: number;
  /** Доля акций (%) */
  stocksShare?: number;
  /** Доля облигаций (%) */
  bondsShare?: number;
  /** Свободные средства (₽) */
  freeCash?: number;
  /** Уровень риска */
  riskLevel?: 'low' | 'medium' | 'high';
  /** Количество аномалий на последнем баре */
  anomaliesCount?: number;
  /** Топ-движущиеся активы по дневной динамике */
  topMovers?: Array<{ ticker: string; dailyDynamicsPercent: number }>;
}

/** Минимальный интерфейс памяти, достаточный для сохранения KPI */
export interface KpiMemory {
  saveStrategicKpi(snapshot: PortfolioKpiSnapshot): Promise<void>;
}

/** Максимум активов в топ-движущихся */
export const MAX_TOP_MOVERS = 3;

/** Топ-движущиеся активы по |дневная динамика| */
function buildTopMovers(
  quotes: DataAgentOutput['quotes'],
): CompactPortfolioKpi['topMovers'] {
  const movers = Object.values(quotes)
    .filter((q) => q.currentPrice > 0)
    .map((q) => ({
      ticker: q.ticker,
      dailyDynamicsPercent: q.dailyDynamicsPercent ?? 0,
    }))
    .sort(
      (a, b) =>
        Math.abs(b.dailyDynamicsPercent) - Math.abs(a.dailyDynamicsPercent),
    )
    .slice(0, MAX_TOP_MOVERS);

  return movers.length > 0 ? movers : undefined;
}

/**
 * Собрать сжатый KPI-объект из результата конвейера.
 * Все поля опциональны — заполняются только реальные.
 */
export function buildCompactKpi(
  result: PipelineResult,
): CompactPortfolioKpi | null {
  // Защита: stages может быть undefined
  if (!result?.stages) {
    console.warn('[KpiSink] result.stages is undefined — пропуск KPI');
    return null;
  }

  const dataOutput = result.stages.data?.result.data as
    DataAgentOutput | undefined;
  const analysisOutput = result.stages.analysis?.result.data as
    AnalysisAgentOutput | undefined;

  const macroGoals = dataOutput?.macroGoals;

  const kpi: CompactPortfolioKpi = { date: new Date().toISOString() };

  // Стоимость портфеля и доли
  const totalValue = macroGoals?.totalBalance;
  if (totalValue !== undefined && totalValue > 0) {
    kpi.totalValue = totalValue;
  }
  if (macroGoals?.stocksPercent !== undefined) {
    kpi.stocksShare = macroGoals.stocksPercent;
  }
  if (macroGoals?.bondsPercent !== undefined) {
    kpi.bondsShare = macroGoals.bondsPercent;
  }

  // Свободные средства
  if (macroGoals?.freeCash !== undefined) {
    kpi.freeCash = macroGoals.freeCash;
  }

  // Уровень риска из валидации лимитов
  if (analysisOutput?.riskValidation) {
    const { isValid, errors } = analysisOutput.riskValidation;
    kpi.riskLevel = isValid ? 'low' : errors.length > 2 ? 'high' : 'medium';
  }

  // Аномалии цен на последнем баре
  const anomalyCount = (dataOutput?.anomalies ?? []).filter(
    (a) => a.isLastAnomaly,
  ).length;
  if (anomalyCount > 0) {
    kpi.anomaliesCount = anomalyCount;
  }

  // Топ-движущиеся активы
  if (dataOutput?.quotes) {
    const topMovers = buildTopMovers(dataOutput.quotes);
    if (topMovers) {
      kpi.topMovers = topMovers;
    }
  }

  // Достаточность данных: нужна стоимость ИЛИ хотя бы одна доля
  const hasValue = kpi.totalValue !== undefined && kpi.totalValue > 0;
  const hasShares =
    kpi.stocksShare !== undefined || kpi.bondsShare !== undefined;

  if (!hasValue && !hasShares) {
    console.warn(
      '[KpiSink] Недостаточно данных для KPI-снимка (нет стоимости/долей) — пропуск',
    );
    return null;
  }

  // Защита от записи нулевых KPI: если totalValue = 0, но доли есть — всё равно сохраняем
  // (доли рассчитываются из реальных позиций, а не из macroGoals)
  if (!hasValue && hasShares) {
    console.warn(
      '[KpiSink] ⚠️ totalBalance = 0, но доли активов есть — сохраняем KPI с нулевой стоимостью',
    );
  }

  return kpi;
}

/**
 * Собрать и сохранить KPI-снимок в стратегическую память.
 *
 * @param memory — стратегическая память (IAIMemory или mock)
 * @param result — результат успешного run()
 * @returns true если снимок сохранён, false при пропуске/ошибке
 */
export async function savePortfolioKpi(
  memory: KpiMemory | null | undefined,
  result: PipelineResult,
): Promise<boolean> {
  if (!memory) {
    return false;
  }

  const kpi = buildCompactKpi(result);
  if (!kpi) {
    return false;
  }

  // Защита: stages может быть undefined
  if (!result?.stages) {
    console.warn('[KpiSink] result.stages is undefined — пропуск сохранения');
    return false;
  }

  const dataOutput = result.stages.data?.result.data as
    DataAgentOutput | undefined;
  const analysisOutput = result.stages.analysis?.result.data as
    AnalysisAgentOutput | undefined;

  // DIAG: что пришло в kpi-sink
  console.warn(
    '[KpiSink] 🔍 investedFunds.totalNet=' +
      (dataOutput?.investedFunds?.totalNet ?? 'undefined') +
      ', profitC11=' +
      (dataOutput?.historicalTrades?.profitC11 ?? 'undefined') +
      ', totalBalance=' +
      (dataOutput?.macroGoals?.totalBalance ?? 'undefined'),
  );

  // Полный снапшот для стратегической памяти: реальные поля + нули
  // там, где данные недоступны (снапшот обязан быть полным по типу).
  const investedNet = dataOutput?.investedFunds?.totalNet ?? 0;
  const profitC11 = dataOutput?.historicalTrades?.profitC11 ?? 0;
  const returnPercent =
    investedNet > 0
      ? Math.round(((profitC11 / investedNet) * 100) * 100) / 100
      : 0;

  // Защита от записи полностью нулевого KPI (данные из Excel не найдены)
  if (kpi.totalValue === 0 && kpi.stocksShare === 0 && kpi.bondsShare === 0) {
    console.warn(
      '[KpiSink] ⛔ Пропуск сохранения KPI: все ключевые метрики = 0. ' +
        'Проверьте Excel-файл: лист «Отчет по сделкам» (строка "Итого активов") ' +
        'и лист «Цели» (целевые доли акций/облигаций).',
    );
    return false;
  }

  const snapshot: PortfolioKpiSnapshot = {
    date: kpi.date,
    totalValue: kpi.totalValue ?? 0,
    returnPercent: Math.round(returnPercent * 100) / 100,
    volatility: 0,
    sharpeRatio: 0,
    maxDrawdown: 0,
    assetCount: dataOutput?.assets.length ?? 0,
    stocksPercent: kpi.stocksShare ?? 0,
    bondsPercent: kpi.bondsShare ?? 0,
    dividendIncome: analysisOutput?.income.totalDivsNet ?? 0,
    realizedProfit: dataOutput?.historicalTrades.profitC10 ?? 0,
    unrealizedProfit:
      (dataOutput?.assets ?? []).reduce(
        (sum, a) => sum + (a.unrealizedProfitRub ?? 0),
        0,
      ) ?? 0,
  };

  try {
    await memory.saveStrategicKpi(snapshot);
    console.log(
      `[KpiSink] KPI-снимок сохранён: value=${snapshot.totalValue}, ` +
        `акции=${snapshot.stocksPercent}%, облигации=${snapshot.bondsPercent}%`,
    );
    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[KpiSink] Ошибка сохранения KPI: ${errorMsg}`);
    return false;
  }
}
