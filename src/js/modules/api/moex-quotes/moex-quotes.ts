/**
 * Прямые котировки и история MOEX ISS.
 *
 * Принципы:
 * - fail-closed: нет ответа/нет цены → null и запись в `unavailable`,
 *   никогда не 0 и не выдуманное значение;
 * - доска резолвится динамически через /iss/securities/{SECID}.json (boards),
 *   статическая карта — только конфиг-фолбэк;
 * - параметры (окно истории, SMA, таймаут) — из PortfolioConfig.moexQuotes.
 */

import { PortfolioConfig } from '../../../config/portfolio-config.js';

/** Текущая котировка одного инструмента. */
export interface MoexCurrentQuote {
  secid: string;
  board: string | null;
  last: number | null;
  changePct: number | null;
  volume: number | null;
  turnover: number | null;
  /** Время среза снимка (ISO). */
  asOf: string;
}

/** Дневная свеча истории. */
export interface MoexHistoryBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Снимок котировок: успешные + недоступные (fail-closed). */
export interface MoexQuotesSnapshot {
  asOf: string;
  quotes: Record<string, MoexCurrentQuote>;
  unavailable: string[];
}

/** Конфигурация клиента (fetch/now инъектируются в тестах). */
export interface MoexQuotesClientConfig {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

interface IssTable {
  columns: string[];
  data: unknown[][];
}

type IssPayload = Record<string, IssTable | undefined>;

/** Размер страницы ISS для history — протокольная константа API. */
const ISS_HISTORY_PAGE_SIZE = 100;

/**
 * ISIN-подобный идентификатор — это облигация. Котировки акций для неё
 * не запрашиваются: ISS отдаёт цену облигации в % от номинала, и такие
 * запросы только засоряют fail-статистику.
 */
function isIsinLike(value: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(value.trim().toUpperCase());
}

const ISS_BASE = 'https://iss.moex.com/iss';

function tableRows(
  payload: IssPayload,
  name: string,
): Array<Record<string, unknown>> {
  const table = payload[name];
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.data)) {
    return [];
  }
  return table.data.map((row) => {
    const record: Record<string, unknown> = {};
    table.columns.forEach((column, index) => {
      record[column] = row[index];
    });
    return record;
  });
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value: Date): string {
  return value.toISOString().split('T')[0] as string;
}

export class MoexQuotesClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly boardCache = new Map<string, string | null>();

  constructor(config: MoexQuotesClientConfig = {}) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? (() => new Date());
    this.timeoutMs =
      config.timeoutMs ?? PortfolioConfig.moexQuotes.requestTimeoutMs;
  }

  /** GET JSON с таймаутом; любая ошибка → null (fail-closed). */
  private async getJson(path: string): Promise<IssPayload | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${ISS_BASE}${path}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      return (await response.json()) as IssPayload;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Резолв основной доски SECID.
   * Приоритет: is_primary → первая доска из ISS → конфиг-фолбэк.
   */
  async resolveBoard(secid: string): Promise<string | null> {
    const normalized = secid.trim().toUpperCase();
    if (!normalized) return null;
    if (this.boardCache.has(normalized)) {
      return this.boardCache.get(normalized) ?? null;
    }

    const payload = await this.getJson(
      `/securities/${encodeURIComponent(normalized)}.json?iss.meta=off`,
    );
    let board: string | null = null;
    if (payload) {
      const boards = tableRows(payload, 'boards');
      const primary =
        boards.find((row) => Number(row['is_primary']) === 1) ?? boards[0];
      const boardId = primary?.['boardid'];
      board = typeof boardId === 'string' && boardId ? boardId : null;
    }

    if (!board) {
      board = PortfolioConfig.moexQuotes.boardFallback[normalized] ?? null;
    }

    this.boardCache.set(normalized, board);
    return board;
  }

  /**
   * Текущие котировки: last, изменение дня, объём, оборот.
   * `unavailable` содержит тикеры без подтверждённой цены.
   */
  async fetchCurrentQuotes(secids: string[]): Promise<MoexQuotesSnapshot> {
    const asOf = this.now().toISOString();
    const quotes: Record<string, MoexCurrentQuote> = {};
    const unavailable: string[] = [];
    const skippedBonds: string[] = [];

    for (const raw of secids) {
      const secid = raw.trim().toUpperCase();
      if (!secid) continue;

      // Облигации не запрашиваем: цена в ISS — % от номинала, а не рыночная
      // котировка акции. Раньше они давали failed=10 шума в логе.
      if (isIsinLike(secid)) {
        skippedBonds.push(secid);
        continue;
      }

      const board = await this.resolveBoard(secid);
      if (!board) {
        unavailable.push(secid);
        continue;
      }

      const payload = await this.getJson(
        `/engines/stock/markets/shares/boards/${encodeURIComponent(
          board,
        )}/securities/${encodeURIComponent(
          secid,
        )}.json?iss.meta=off&iss.only=securities,marketdata`,
      );
      const market = tableRows(payload ?? {}, 'marketdata')[0];
      const security = tableRows(payload ?? {}, 'securities')[0];
      const last =
        toNumber(market?.['LAST']) ??
        toNumber(market?.['MARKETPRICE']) ??
        toNumber(security?.['PREVPRICE']);

      if (last === null || last <= 0) {
        unavailable.push(secid);
        continue;
      }

      quotes[secid] = {
        secid,
        board,
        last,
        changePct: toNumber(market?.['LASTCHANGEPCT']),
        volume: toNumber(market?.['VOLTODAY']),
        turnover: toNumber(market?.['VALTODAY']),
        asOf,
      };
    }

    // fail-статистика — только по акциям: облигации в запрос не попадают.
    console.log(
      `[MOEX_QUOTES] instruments=${secids.length} asOf=${asOf} ` +
        `ok=${Object.keys(quotes).length} failed=${unavailable.length} ` +
        `skippedBonds=${skippedBonds.length}`,
    );

    return { asOf, quotes, unavailable };
  }

  /**
   * Дневная история за окно из конфига (по умолчанию 365 дней).
   * Пагинация по ISS page size; пустая страница = конец истории.
   */
  async fetchDailyHistory(
    secid: string,
    from?: string,
    to?: string,
  ): Promise<MoexHistoryBar[]> {
    const normalized = secid.trim().toUpperCase();
    if (!normalized) return [];

    const board = await this.resolveBoard(normalized);
    if (!board) return [];

    const now = this.now();
    const end = to ?? isoDate(now);
    const start =
      from ??
      isoDate(
        new Date(
          now.getTime() -
            PortfolioConfig.moexQuotes.historyWindowDays * 24 * 60 * 60 * 1000,
        ),
      );

    const bars: MoexHistoryBar[] = [];
    const maxPages =
      Math.ceil(
        PortfolioConfig.moexQuotes.historyWindowDays / ISS_HISTORY_PAGE_SIZE,
      ) + 1;

    for (let page = 0; page < maxPages; page++) {
      const offset = page * ISS_HISTORY_PAGE_SIZE;
      const payload = await this.getJson(
        `/history/engines/stock/markets/shares/boards/${encodeURIComponent(
          board,
        )}/securities/${encodeURIComponent(
          normalized,
        )}.json?iss.meta=off&iss.only=history&from=${start}&to=${end}&start=${offset}`,
      );
      const rows = tableRows(payload ?? {}, 'history');
      if (rows.length === 0) break;

      for (const row of rows) {
        const date =
          typeof row['TRADEDATE'] === 'string' ? row['TRADEDATE'] : '';
        const close =
          toNumber(row['CLOSE']) ?? toNumber(row['LEGALCLOSEPRICE']);
        if (!date || close === null || close <= 0) continue;
        bars.push({
          date,
          open: toNumber(row['OPEN']) ?? close,
          high: toNumber(row['HIGH']) ?? close,
          low: toNumber(row['LOW']) ?? close,
          close,
          volume: toNumber(row['VOLUME']) ?? 0,
        });
      }

      if (rows.length < ISS_HISTORY_PAGE_SIZE) break;
    }

    return bars;
  }
}
