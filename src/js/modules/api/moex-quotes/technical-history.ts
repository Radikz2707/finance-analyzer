/**
 * Загрузка дневной истории для технических фактов: изоляция по тикерам.
 *
 * Проблема (прогон 20:57): `fetchHistoricalBatch` падал на первом тикере без
 * доступной доски (например, облигация без TQBR), и весь batch обрывался —
 * техфакты оказывались «недоступны на всех» активах. Здесь:
 *
 * - каждый тикер загружается независимо: сбой одного не влияет на остальные;
 * - единственный источник — `MoexQuotesClient.fetchDailyHistory` (MOEX ISS).
 *   Ветка data-fetcher удалена: в прогоне 19:35 UTC она давала primary=0 при
 *   fallback=4, то есть путь был мёртвым и только маскировал реальный источник;
 * - результат несёт источник и причину, чтобы лог `[TECH_FACTS]` был атрибутирован;
 * - функция чистая относительно I/O: загрузчик инжектируется, поэтому
 *   тестируется без сети.
 */

/** Минимальный контракт бара для технических фактов. */
export interface TechnicalHistoryBar {
  date: string;
  high: number;
  low: number;
  close: number;
}

/** Источник, из которого получена история. */
export type TechnicalHistorySource = 'moex-iss' | 'none';

/** Загрузчик истории одного тикера. */
export type TechnicalHistoryLoader = (
  ticker: string,
  from: string,
  to: string,
) => Promise<readonly TechnicalHistoryBar[]>;

export interface TechnicalHistoryLoaders {
  /** Единственный источник дневной истории (MOEX ISS). */
  load: TechnicalHistoryLoader;
}

/** Результат загрузки по одному тикеру. */
export interface TechnicalHistoryItem {
  ticker: string;
  bars: TechnicalHistoryBar[];
  source: TechnicalHistorySource;
  /** Причина пустого результата. */
  error: string | null;
}

/** Минимальный логгер: совместим с логгером агентов. */
export interface TechnicalHistoryLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeBars(
  bars: readonly TechnicalHistoryBar[] | null | undefined,
): TechnicalHistoryBar[] {
  if (!Array.isArray(bars)) return [];
  return bars.filter(
    (bar) =>
      typeof bar?.date === 'string' &&
      bar.date.length > 0 &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close) &&
      bar.close > 0,
  );
}

async function loadOne(
  ticker: string,
  from: string,
  to: string,
  loaders: TechnicalHistoryLoaders,
): Promise<TechnicalHistoryItem> {
  const normalized = ticker.trim().toUpperCase();

  try {
    const bars = normalizeBars(await loaders.load(normalized, from, to));
    if (bars.length > 0) {
      return { ticker: normalized, bars, source: 'moex-iss', error: null };
    }
    return {
      ticker: normalized,
      bars: [],
      source: 'none',
      error: 'moex-iss: пустая история',
    };
  } catch (error) {
    return {
      ticker: normalized,
      bars: [],
      source: 'none',
      error: `moex-iss: ${errorMessage(error)}`,
    };
  }
}

/**
 * Загрузить дневную историю по всем тикерам с изоляцией сбоев.
 *
 * Порядок фиксирован порядком входного массива; тикеры грузятся параллельно.
 */
export async function loadTechnicalHistory(
  tickers: readonly string[],
  from: string,
  to: string,
  loaders: TechnicalHistoryLoaders,
  logger?: TechnicalHistoryLogger,
): Promise<TechnicalHistoryItem[]> {
  const unique = Array.from(
    new Set(
      tickers
        .map((ticker) => ticker.trim().toUpperCase())
        .filter((ticker) => ticker.length > 0),
    ),
  );

  const results = await Promise.all(
    unique.map((ticker) => loadOne(ticker, from, to, loaders)),
  );

  let loadedCount = 0;
  const empty: string[] = [];
  for (const item of results) {
    if (item.source === 'moex-iss') loadedCount++;
    if (item.source === 'none') empty.push(item.ticker);

    const line = `[TECH_FACTS] ticker=${item.ticker} bars=${item.bars.length} source=${item.source}`;
    if (item.source === 'none') {
      logger?.warn(`${line} error=${item.error ?? 'unknown'}`);
    } else {
      logger?.info(line);
    }
  }

  logger?.info(
    `[TECH_FACTS] tickers=${results.length} withBars=${results.length - empty.length} ` +
      `source=moex-iss loaded=${loadedCount} ` +
      `empty=[${empty.join(', ')}]`,
  );

  return results;
}
