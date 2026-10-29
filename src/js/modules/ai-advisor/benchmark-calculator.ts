/**
 * Benchmark Calculator — сравнение доходности портфеля с бенчмарками.
 *
 * Бенчмарки:
 * 1. Индекс IMOEX (Московская биржа) — исторические данные из MOEX ISS
 * 2. Индекс IMOEXR (Московская биржа, с дивидендами)
 * 3. Банковский депозит — расчёт по средней ставке
 *
 * Результат: «Твой портфель: +X%, IMOEX: +Y%, Депозит: +Z%. Ты [опережаешь/проигрываешь] рынок на N п.п.»
 */

import axios from 'axios';

/** Результат расчёта бенчмарка */
export interface BenchmarkResult {
  /** Доходность портфеля за период (%) */
  portfolioReturnPct: number;
  /** Период расчёта */
  period: string;
  /** Доходность IMOEX за период (%) */
  imoexReturnPct: number;
  /** Доходность IMOEXR (с дивидендами) за период (%) */
  imoexrReturnPct: number;
  /** Доходность депозита за период (%) */
  depositReturnPct: number;
  /** Превышение/отставание от IMOEX (п.п.) */
  imoexAlpha: number;
  /** Превышение/отставание от депозита (п.п.) */
  depositAlpha: number;
  /** Вердикт */
  verdict: 'BEAT_MARKET' | 'BEAT_DEPOSIT' | 'UNDERPERFORM';
  /** Текстовая сводка для промпта ИИ */
  summaryText: string;
}

/** Конфигурация бенчмарка */
export interface BenchmarkConfig {
  /** Начальная дата расчёта (ISO) */
  startDate: string;
  /** Конечная дата расчёта (ISO) */
  endDate: string;
  /** Начальная стоимость портфеля (₽) */
  startValue: number;
  /** Конечная стоимость портфеля (₽) */
  endValue: number;
  /** Средняя ставка депозита (%) годовых */
  depositRateAnnual: number;
}

// URL MOEX ISS API
const MOEX_ISS_API = 'https://iss.moex.com/iss';

/**
 * Загрузка исторических данных индекса с MOEX ISS.
 * Возвращает массив { date, close } за указанный период.
 */
async function fetchIndexHistory(
  board: string,
  engine: string,
  swig: string,
  days: number,
): Promise<Array<{ date: string; close: number }>> {
  try {
    const url = `${MOEX_ISS_API}/securities/${swig}/candles.json`;
    const params = new URLSearchParams({
      board,
      engine,
      limit: days.toString(),
      group_by: 'day',
    });

    const response = await axios.get(`${url}?${params.toString()}`, {
      timeout: 15000,
    });

    const candles = response.data?.candles?.data;
    if (!candles) return [];

    const columns = response.data.candles.columns;
    const dateIdx = columns.indexOf('date');
    const closeIdx = columns.indexOf('close');

    if (dateIdx === -1 || closeIdx === -1) return [];

    return candles.map((c: unknown[]) => ({
      date: String(c[dateIdx]),
      close: Number(c[closeIdx]),
    }));
  } catch {
    return [];
  }
}

/**
 * Рассчитывает процентную доходность между первой и последней ценой.
 */
function calculateReturnPct(prices: Array<{ close: number }>): number {
  if (prices.length < 2) return 0;
  const first = prices[0]!.close;
  const last = prices[prices.length - 1]!.close;
  if (first === 0) return 0;
  return ((last - first) / first) * 100;
}

/**
 * Рассчитывает доходность банковского депозита за период.
 * @param annualRate — годовая ставка (%)
 * @param days — количество дней
 */
function calculateDepositReturn(annualRate: number, days: number): number {
  if (days <= 0 || annualRate <= 0) return 0;
  // Простой процент: P * (rate/100) * (days/365)
  return (annualRate / 100) * (days / 365) * 100;
}

/**
 * Определяет вердикт: опережает рынок, опережает депозит, или проигрывает обоим.
 */
function determineVerdict(
  portfolioReturn: number,
  imoexReturn: number,
  depositReturn: number,
): BenchmarkResult['verdict'] {
  if (portfolioReturn >= imoexReturn && portfolioReturn >= depositReturn) {
    return 'BEAT_MARKET';
  }
  if (portfolioReturn >= depositReturn) {
    return 'BEAT_DEPOSIT';
  }
  return 'UNDERPERFORM';
}

/**
 * Формирует текстовую сводку бенчмарка для промпта ИИ.
 */
function formatBenchmarkSummary(result: BenchmarkResult): string {
  const verb =
    result.verdict === 'BEAT_MARKET'
      ? 'опережаешь'
      : result.verdict === 'BEAT_DEPOSIT'
        ? 'опережаешь депозит, но проигрываешь рынку'
        : 'проигрываешь';

  const imoexDirection =
    result.imoexAlpha > 0
      ? `+${result.imoexAlpha.toFixed(1)} п.п.`
      : `${result.imoexAlpha.toFixed(1)} п.п.`;
  const depositDirection =
    result.depositAlpha > 0
      ? `+${result.depositAlpha.toFixed(1)} п.п.`
      : `${result.depositAlpha.toFixed(1)} п.п.`;

  let text = `БЕНЧМАРКИ (за ${result.period}):\n`;
  text += `- Портфель: ${result.portfolioReturnPct >= 0 ? '+' : ''}${result.portfolioReturnPct.toFixed(1)}%\n`;
  text += `- IMOEX: ${result.imoexReturnPct >= 0 ? '+' : ''}${result.imoexReturnPct.toFixed(1)}%\n`;
  text += `- IMOEX (с див.): ${result.imoexrReturnPct >= 0 ? '+' : ''}${result.imoexrReturnPct.toFixed(1)}%\n`;
  text += `- Депозит (~14% годовых): ${result.depositReturnPct.toFixed(1)}%\n`;
  text += `Ты ${verb} рынок на ${imoexDirection} и ${depositDirection} депозит.\n`;

  // Добавляем аналитику
  if (result.verdict === 'UNDERPERFORM') {
    text +=
      '⚠️ Портфель проигрывает обоим бенчмаркам. Проверь: нет ли просевших «спутников» с большой долей.\n';
  } else if (result.verdict === 'BEAT_MARKET') {
    text += '✅ Портфель опережает рынок. Структура работает корректно.\n';
  } else {
    text +=
      '⚠️ Портфель опережает депозит, но проигрывает рынку. Возможно, слишком консервативная структура.\n';
  }

  return text;
}

/**
 * Основной расчёт бенчмарка.
 *
 * @param config — конфигурация с данными портфеля
 * @returns BenchmarkResult с результатами сравнения
 */
export async function calculateBenchmark(
  config: BenchmarkConfig,
): Promise<BenchmarkResult> {
  const { startDate, endDate, startValue, endValue, depositRateAnnual } =
    config;

  // Доходность портфеля
  const portfolioReturnPct =
    startValue > 0 ? ((endValue - startValue) / startValue) * 100 : 0;

  // Период в днях
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
  );

  // Депозит
  const depositReturnPct = calculateDepositReturn(depositRateAnnual, days);

  // Загружаем исторические данные IMOEX и IMOEXR с MOEX
  // MOEX: board=TQBR, engine=market, swig=IMOEX
  // Для дивидендной версии: swig=IMOEXR
  const [imoexHistory, imoexrHistory] = await Promise.all([
    fetchIndexHistory('TQBR', 'market', 'IMOEX', Math.min(days, 365)),
    fetchIndexHistory('TQBR', 'market', 'IMOEXR', Math.min(days, 365)),
  ]);

  const imoexReturnPct = calculateReturnPct(imoexHistory);
  const imoexrReturnPct = calculateReturnPct(imoexrHistory);

  // Alpha
  const imoexAlpha = portfolioReturnPct - imoexReturnPct;
  const depositAlpha = portfolioReturnPct - depositReturnPct;

  // Вердикт
  const verdict = determineVerdict(
    portfolioReturnPct,
    imoexReturnPct,
    depositReturnPct,
  );

  // Период для текста
  const periodStr = `${start.toLocaleDateString('ru-RU')} — ${end.toLocaleDateString('ru-RU')} (${days} дн.)`;

  const result: BenchmarkResult = {
    portfolioReturnPct,
    period: periodStr,
    imoexReturnPct,
    imoexrReturnPct,
    depositReturnPct,
    imoexAlpha,
    depositAlpha,
    verdict,
    summaryText: '',
  };

  result.summaryText = formatBenchmarkSummary(result);

  return result;
}

/**
 * Формирует компактную строку бенчмарка для включения в промпт ИИ.
 * Используется когда данные бенчмарка уже рассчитаны.
 */
export function formatBenchmarkForPrompt(result: BenchmarkResult): string {
  return result.summaryText;
}
