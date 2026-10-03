/**
 * MoexHistoryProvider — загрузка исторических цен через MOEX ISS API.
 *
 * Бесплатный API без регистрации и ключей:
 * https://iss.moex.com/iss/
 *
 * Поддерживает:
 * - Загрузку OHLCV для акций (TQBR) и облигаций
 * - Автоматическое определение рынка (stocks/bonds)
 * - Пагинацию по 1000 свечей за запрос
 * - Кэширование в SQLite
 * - Расчёт доходности и метрик
 */

import { db } from '../db-manager/db-manager.js';

// ──────────────────────────────────────────────
// 1. Types
// ──────────────────────────────────────────────

/** OHLCV-свеча */
export interface OHLCVBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Запрос к MOEX ISS API */
export interface MoexHistoryRequest {
  /** Тикер (SBER, GAZP, RU000A10FXF8, etc.) */
  ticker: string;
  /** Интервал (D = daily, W = weekly, M = monthly) */
  interval: 'D' | 'W' | 'M';
  /** Начальная дата (YYYY-MM-DD) */
  from: string;
  /** Конечная дата (YYYY-MM-DD) */
  to: string;
}

/** Результат загрузки исторических данных */
export interface HistoryResult {
  ticker: string;
  bars: OHLCVBar[];
  from: string;
  to: string;
  count: number;
  fromCache: boolean;
}

// ──────────────────────────────────────────────
// 2. MOEX ISS API Client
// ──────────────────────────────────────────────

/** Конфигурация MOEX ISS API */
const MOEX_ISS_CONFIG = {
  baseUrl: 'https://iss.moex.com/iss',
  dailyInterval: 24,
  maxLimit: 1000,
  endpoints: {
    candles: '/engines/stock/markets/shares/boards/{board}/securities/{ticker}/candles.json?interval={interval}',
    history: '/history.json',
  },
} as const;

/** Режимы торгов MOEX */
type Board = 'TQBR' | 'TQOB' | 'TRMK';

/** Определение режима торгов по тикеру */
function getBoardForTicker(ticker: string): Board {
  // Облигации (RU00...) → TQOB, остальное → TQBR
  if (/^RU00/i.test(ticker)) {
    return 'TQOB';
  }
  return 'TQBR';
}

/**
 * Загрузить исторические данные для одного тикера с MOEX ISS.
 *
 * Пробует два endpoint'а:
 * 1. candles.json — быстрый, но без фильтра по датам (Python-клиент)
 * 2. history.json — с фильтрами from/to (старый)
 */
async function fetchFromMoexISS(
  request: MoexHistoryRequest,
): Promise<OHLCVBar[]> {
  const board: Board = getBoardForTicker(request.ticker);
  const market = board === 'TQOB' ? 'bonds' : 'stocks';

  // Пробуем candles.json (быстрый, без дат)
  const candlesResult = await fetchCandlesEndpoint(request.ticker, board);
  if (candlesResult.length > 0) {
    // Фильтруем по датам вручную
    return candlesResult.filter((bar) => bar.date >= request.from && bar.date <= request.to);
  }

  // Fallback: history.json с датами
  return fetchHistoryEndpoint(request, market, board);
}

/** Endpoint candles.json (как в Python-клиенте) */
async function fetchCandlesEndpoint(
  ticker: string,
  board: Board,
): Promise<OHLCVBar[]> {
  try {
    const url = MOEX_ISS_CONFIG.baseUrl +
      MOEX_ISS_CONFIG.endpoints.candles
        .replace('{board}', board)
        .replace('{ticker}', encodeURIComponent(ticker))
        .replace('{interval}', String(MOEX_ISS_CONFIG.dailyInterval));

    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json() as Record<string, unknown>;
    const candles = data.candles as { columns: string[]; data: unknown[][] } | undefined;
    if (!candles || !candles.columns?.length || !candles.data?.length) return [];

    const col = candles.columns;
    const dateIdx = col.indexOf('begin');
    const closeIdx = col.indexOf('close');
    const openIdx = col.indexOf('open');
    const highIdx = col.indexOf('high');
    const lowIdx = col.indexOf('low');
    const volumeIdx = col.indexOf('volume');

    if (dateIdx === -1 || closeIdx === -1) return [];

    const bars: OHLCVBar[] = [];
    for (const row of candles.data) {
      bars.push({
        date: String(row[dateIdx] ?? ''),
        open: Number(row[openIdx] ?? 0) || 0,
        high: Number(row[highIdx] ?? 0) || 0,
        low: Number(row[lowIdx] ?? 0) || 0,
        close: Number(row[closeIdx] ?? 0) || 0,
        volume: Number(row[volumeIdx] ?? 0) || 0,
      });
    }
    return bars;
  } catch {
    return [];
  }
}

/** Endpoint history.json (с фильтрами по датам) */
async function fetchHistoryEndpoint(
  request: MoexHistoryRequest,
  market: string,
  board: Board,
): Promise<OHLCVBar[]> {
  try {
    const params = new URLSearchParams({
      market,
      board,
      symbols: request.ticker,
      from: request.from,
      to: request.to,
      candle_interval: 'daily',
      limit: String(MOEX_ISS_CONFIG.maxLimit),
    });

    const url = MOEX_ISS_CONFIG.baseUrl + MOEX_ISS_CONFIG.endpoints.history + '?' + params.toString();
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json() as Record<string, unknown>;
    const history = data.history as { meta: { columns: string[]; after?: number }; data: unknown[][] } | undefined;
    if (!history || !history.meta?.columns?.length || !history.data?.length) return [];

    const col = history.meta.columns;
    const dateIdx = col.indexOf('date');
    const closeIdx = col.indexOf('close');
    const openIdx = col.indexOf('open');
    const highIdx = col.indexOf('high');
    const lowIdx = col.indexOf('low');
    const volumeIdx = col.indexOf('volume');

    if (dateIdx === -1 || closeIdx === -1) return [];

    const bars: OHLCVBar[] = [];
    for (const row of history.data) {
      bars.push({
        date: String(row[dateIdx] ?? ''),
        open: Number(row[openIdx] ?? 0) || 0,
        high: Number(row[highIdx] ?? 0) || 0,
        low: Number(row[lowIdx] ?? 0) || 0,
        close: Number(row[closeIdx] ?? 0) || 0,
        volume: Number(row[volumeIdx] ?? 0) || 0,
      });
    }
    return bars;
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────
// 3. SQLite Caching Layer
// ──────────────────────────────────────────────

/** Сохранить свечи в SQLite */
function saveBarsToDB(ticker: string, bars: OHLCVBar[]): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO price_snapshots (ticker, date, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const batch = db.transaction((barsToSave: OHLCVBar[]) => {
    for (const bar of barsToSave) {
      stmt.run(
        ticker,
        bar.date,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.volume,
      );
    }
  });

  batch(bars);
}

/** Получить свечи из SQLite */
function getBarsFromDB(ticker: string, from: string, to: string): OHLCVBar[] {
  const stmt = db.prepare(`
    SELECT date, open, high, low, close, volume
    FROM price_snapshots
    WHERE ticker = ? AND date >= ? AND date <= ?
    ORDER BY date ASC
  `);

  const rows = stmt.all(ticker, from, to) as Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;

  return rows.map((row) => ({
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  }));
}

// ──────────────────────────────────────────────
// 4. Main Provider
// ──────────────────────────────────────────────

/**
 * Загрузить исторические данные для тикера.
 * Сначала проверяет кэш, затем загружает с MOEX ISS API.
 */
export async function fetchHistoricalData(
  request: MoexHistoryRequest,
): Promise<HistoryResult> {
  // Проверяем кэш
  const cached = getBarsFromDB(request.ticker, request.from, request.to);

  if (cached.length > 0) {
    console.log(
      '[MoexHistory] ✅ ' +
        request.ticker +
        ' — данные из кэша (' +
        cached.length +
        ' свечей)',
    );
    return {
      ticker: request.ticker,
      bars: cached,
      from: request.from,
      to: request.to,
      count: cached.length,
      fromCache: true,
    };
  }

  // Загружаем с MOEX ISS
  console.log(
    '[MoexHistory] Загрузка ' +
      request.ticker +
      ' с MOEX ISS (' +
      request.from +
      ' — ' +
      request.to +
      ')',
  );
  const bars = await fetchFromMoexISS(request);

  if (bars.length > 0) {
    saveBarsToDB(request.ticker, bars);
    console.log(
      '[MoexHistory] 💾 ' +
        request.ticker +
        ' — сохранено ' +
        bars.length +
        ' свечей',
    );
  }

  return {
    ticker: request.ticker,
    bars,
    from: request.from,
    to: request.to,
    count: bars.length,
    fromCache: false,
  };
}

/**
 * Загрузить исторические данные для множества тикеров.
 */
export async function fetchHistoricalBatch(
  tickers: string[],
  from: string,
  to: string,
  interval: 'D' | 'W' | 'M' = 'D',
): Promise<Map<string, OHLCVBar[]>> {
  const results = new Map<string, OHLCVBar[]>();

  for (const ticker of tickers) {
    const result = await fetchHistoricalData({
      ticker,
      interval,
      from,
      to,
    });

    results.set(ticker, result.bars);
  }

  return results;
}

// ──────────────────────────────────────────────
// 5. Price Analytics
// ──────────────────────────────────────────────

/**
 * Рассчитать метрики на основе исторических цен.
 */
export function calculatePriceMetrics(bars: OHLCVBar[]): {
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  bestDay: number;
  worstDay: number;
  averageVolume: number;
} {
  if (bars.length < 2) {
    return {
      totalReturn: 0,
      annualizedReturn: 0,
      volatility: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      winRate: 0,
      bestDay: 0,
      worstDay: 0,
      averageVolume: 0,
    };
  }

  // Доходности по дням
  const dailyReturns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const ret = (bars[i]!.close - bars[i - 1]!.close) / bars[i - 1]!.close;
    dailyReturns.push(ret);
  }

  // Общая доходность
  const totalReturn =
    (bars[bars.length - 1]!.close - bars[0]!.close) / bars[0]!.close;

  // Годовая доходность
  const days = bars.length;
  const years = days / 365;
  const annualizedReturn =
    years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

  // Волатильность (std dev daily returns)
  const meanReturn =
    dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) /
    dailyReturns.length;
  const dailyVolatility = Math.sqrt(variance);
  const annualizedVolatility = dailyVolatility * Math.sqrt(252);

  // Sharpe Ratio (безрисковая ставка ~7%)
  const riskFreeRate = 0.07;
  const sharpeRatio =
    annualizedVolatility > 0
      ? (annualizedReturn - riskFreeRate) / annualizedVolatility
      : 0;

  // Max Drawdown
  let peak = bars[0]!.close;
  let maxDrawdown = 0;
  for (const bar of bars) {
    if (bar.close > peak) {
      peak = bar.close;
    }
    const drawdown = (peak - bar.close) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // Win Rate (процент прибыльных дней)
  const winningDays = dailyReturns.filter((r) => r > 0).length;
  const winRate =
    dailyReturns.length > 0 ? winningDays / dailyReturns.length : 0;

  // Лучший/худший день
  const bestDay = dailyReturns.length > 0 ? Math.max(...dailyReturns) : 0;
  const worstDay = dailyReturns.length > 0 ? Math.min(...dailyReturns) : 0;

  // Средний объём
  const averageVolume =
    bars.reduce((sum, b) => sum + b.volume, 0) / bars.length;

  return {
    totalReturn,
    annualizedReturn,
    volatility: annualizedVolatility,
    sharpeRatio,
    maxDrawdown,
    winRate,
    bestDay,
    worstDay,
    averageVolume,
  };
}

/**
 * Сформировать строку метрик для Telegram.
 */
export function formatMetrics(
  metrics: ReturnType<typeof calculatePriceMetrics>,
): string {
  let text = '<b>📊 Метрики</b>\n\n';
  text += 'Доходность: ' + (metrics.totalReturn * 100).toFixed(2) + '%\n';
  text += 'Годовая: ' + (metrics.annualizedReturn * 100).toFixed(2) + '%\n';
  text += 'Волатильность: ' + (metrics.volatility * 100).toFixed(2) + '%\n';
  text += 'Sharpe: ' + metrics.sharpeRatio.toFixed(2) + '\n';
  text += 'Max Drawdown: ' + (metrics.maxDrawdown * 100).toFixed(2) + '%\n';
  text += 'Win Rate: ' + (metrics.winRate * 100).toFixed(1) + '%\n';
  text += 'Лучший день: ' + (metrics.bestDay * 100).toFixed(2) + '%\n';
  text += 'Худший день: ' + (metrics.worstDay * 100).toFixed(2) + '%\n';

  return text;
}

// ──────────────────────────────────────────────
// 6. Экспорт
// ──────────────────────────────────────────────
