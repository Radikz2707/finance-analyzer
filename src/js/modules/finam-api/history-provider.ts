/**
 * FinamHistoryProvider — загрузка исторических цен через Finam API.
 *
 * Поддерживает:
 * - Загрузку OHLCV для тикеров
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

/** Запрос к Finam API */
export interface FinamHistoryRequest {
  /** Тикер (SBER, GAZP, etc.) */
  ticker: string;
  /** Интервал (D = daily, W = weekly, M = monthly) */
  interval: 'D' | 'W' | 'M';
  /** Начальная дата (YYYY-MM-DD) */
  from: string;
  /** Конечная дата (YYYY-MM-DD) */
  to: string;
  /** Портфель (для MOEX) */
  portfolio?: string;
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
// 2. Finam API Client
// ──────────────────────────────────────────────

/**
 * Загрузить исторические данные через Finam API.
 *
 * API: https://api.finam.ru/api/v1/history-price
 * Документация: https://dev.finam.ru/docs/#api-history-price
 */
async function fetchFromFinamAPI(request: FinamHistoryRequest): Promise<OHLCVBar[]> {
  const baseUrl = 'https://api.finam.ru';
  const apiKey = process.env.FINAM_API_KEY || '';

  if (!apiKey) {
    console.warn('[FinamAPI] FINAM_API_KEY не установлен. Пропускаем загрузку.');
    return [];
  }

  try {
    const response = await fetch(`${baseUrl}/api/v1/history-price`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        instrument_group: 'tmo', // MOEX
        instrument_name: request.ticker,
        period: request.interval,
        period_length: 1,
        date_from: request.from,
        date_to: request.to,
        portfolio: request.portfolio || 'DEMO',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[FinamAPI] Ошибка загрузки для ' + request.ticker + ': ' + response.status + ' - ' + errorText);
      return [];
    }

    const data = await response.json();

    // Парсим ответ в OHLCVBar
    const bars: OHLCVBar[] = [];
    if (data && Array.isArray(data.candles)) {
      for (const candle of data.candles) {
        bars.push({
          date: candle.time || '',
          open: candle.open || 0,
          high: candle.high || 0,
          low: candle.low || 0,
          close: candle.close || 0,
          volume: candle.volume || 0,
        });
      }
    }

    return bars;
  } catch (err) {
    console.error('[FinamAPI] Исключение при загрузке ' + request.ticker + ':', err);
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
      stmt.run(ticker, bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume);
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
 * Сначала проверяет кэш, затем загружает с Finam API.
 */
export async function fetchHistoricalData(request: FinamHistoryRequest): Promise<HistoryResult> {
  // Проверяем кэш
  const cached = getBarsFromDB(request.ticker, request.from, request.to);

  if (cached.length > 0) {
    console.log('[FinamHistory] ✅ ' + request.ticker + ' — данные из кэша (' + cached.length + ' свечей)');
    return {
      ticker: request.ticker,
      bars: cached,
      from: request.from,
      to: request.to,
      count: cached.length,
      fromCache: true,
    };
  }

  // Загружаем с API
  console.log('[FinamHistory] Загрузка ' + request.ticker + ' с Finam API (' + request.from + ' — ' + request.to + ')');
  const bars = await fetchFromFinamAPI(request);

  if (bars.length > 0) {
    saveBarsToDB(request.ticker, bars);
    console.log('[FinamHistory] 💾 ' + request.ticker + ' — сохранено ' + bars.length + ' свечей');
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
    const ret = (bars[i].close - bars[i - 1].close) / bars[i - 1].close;
    dailyReturns.push(ret);
  }

  // Общая доходность
  const totalReturn = (bars[bars.length - 1].close - bars[0].close) / bars[0].close;

  // Годовая доходность
  const days = bars.length;
  const years = days / 365;
  const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

  // Волатильность (std dev daily returns)
  const meanReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / dailyReturns.length;
  const dailyVolatility = Math.sqrt(variance);
  const annualizedVolatility = dailyVolatility * Math.sqrt(252);

  // Sharpe Ratio (безрисковая ставка ~7%)
  const riskFreeRate = 0.07;
  const sharpeRatio = annualizedVolatility > 0
    ? (annualizedReturn - riskFreeRate) / annualizedVolatility
    : 0;

  // Max Drawdown
  let peak = bars[0].close;
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
  const winRate = dailyReturns.length > 0 ? winningDays / dailyReturns.length : 0;

  // Лучший/худший день
  const bestDay = dailyReturns.length > 0 ? Math.max(...dailyReturns) : 0;
  const worstDay = dailyReturns.length > 0 ? Math.min(...dailyReturns) : 0;

  // Средний объём
  const averageVolume = bars.reduce((sum, b) => sum + b.volume, 0) / bars.length;

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
export function formatMetrics(metrics: ReturnType<typeof calculatePriceMetrics>): string {
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
