/**
 * MoexQuoteProvider — резервный источник котировок через Python Engine.
 *
 * Основной источник котировок в DataAgent — Excel (лист «Акции»).
 * Этот провайдер ДОПОЛНЯЕТ только отсутствующие тикеры: запрашивает
 * у Python-движка команду get_quotes (MOEX ISS, board TQBR) и маппит
 * ответ SECID → { price, changePct, volumeTodayRub }.
 *
 * Для облигаций используется get_board_quotes (доска EQOB).
 *
 * Отказоустойчивость:
 * - Python недоступен / команда упала → {} (без проброса ошибки);
 * - пустой ответ или отсутствие котировки по тикеру → {} для него;
 * - некорректная цена (<= 0, NaN) → запись пропускается.
 */

import { PythonBridge } from './python-bridge.js';
import type { IPythonBridge } from './types.js';

/** Одна строка ответа get_quotes (поле SECID/LAST/LASTCHANGEPCT/VALTODAY) */
export interface MoexQuote {
  /** Код инструмента (тикер, верхний регистр) */
  SECID: string;
  /** Последняя цена (число или строка от ISS) */
  LAST?: number | string | null;
  /** Изменение к предыдущему закрытию, % */
  LASTCHANGEPCT?: number | string | null;
  /** Оборот за сегодня, ₽ */
  VALTODAY?: number | string | null;
}

/** Одна строка ответа get_board_quotes (для облигаций/ETF) */
export interface MoexBoardQuote {
  SECID: string;
  LAST?: number | string | null;
  LASTCHANGEPCT?: number | string | null;
  VALTODAY?: number | string | null;
}

/** Ответ Python-моста на команду get_quotes */
export interface MoexQuotesResponse {
  ok: boolean;
  quotes?: MoexQuote[];
  error?: string;
}

/** Ответ Python-моста на команду get_board_quotes */
export interface MoexBoardQuotesResponse {
  ok: boolean;
  quotes?: MoexBoardQuote[];
  error?: string;
}

/** Котировка, понятная DataAgent: цена + дневная динамика + оборот */
export interface MoexFetchedQuote {
  price: number;
  changePct: number;
  volumeTodayRub?: number;
}

/** Конфигурация провайдера */
export interface MoexQuoteProviderConfig {
  /** Мост к Python-движку (по умолчанию — реальный PythonBridge) */
  bridge?: IPythonBridge;
}

/** Безопасное число из значения ISS (NaN/пусто → 0) */
function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Резервный источник котировок MOEX.
 */
export class MoexQuoteProvider {
  private readonly bridge: IPythonBridge;

  constructor(config?: MoexQuoteProviderConfig) {
    this.bridge = config?.bridge ?? new PythonBridge();
  }

  /**
   * Получить котировки для перечня тикеров.
   *
   * @param tickers — коды инструментов (SECID)
   * @returns мапа SECID → { price, changePct }. Ошибки/недоступность → {}.
   */
  async fetchQuotes(
    tickers: string[],
  ): Promise<Record<string, MoexFetchedQuote>> {
    const clean = tickers
      .map((t) =>
        String(t ?? '')
          .trim()
          .toUpperCase(),
      )
      .filter((t) => t.length > 0);

    if (clean.length === 0) {
      return {};
    }

    let data: MoexQuotesResponse;
    try {
      data = await this.bridge.call<MoexQuotesResponse>({
        command: 'get_quotes',
        payload: { tickers: clean },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[MoexQuoteProvider] Python недоступен: ${message}`);
      return {};
    }

    if (!data || !data.ok || !Array.isArray(data.quotes)) {
      // Логируем реальную причину от Python-движка (data.error), а не только
      // общее сообщение — иначе диагностика невозможна.
      const reason = data?.error ? `: ${data.error}` : '';
      const quotesCount = Array.isArray(data?.quotes) ? data.quotes.length : 0;
      console.warn(
        `[MoexQuoteProvider] Пустой/некорректный ответ get_quotes${reason}` +
          ` (ok=${data?.ok}, quotes=${quotesCount})`,
      );
      return {};
    }

    const result: Record<string, MoexFetchedQuote> = {};
    for (const quote of data.quotes) {
      if (!quote || typeof quote.SECID !== 'string') {
        continue;
      }
      const price = toFiniteNumber(quote.LAST);
      if (price <= 0) {
        continue;
      }
      result[quote.SECID] = {
        price,
        changePct: toFiniteNumber(quote.LASTCHANGEPCT),
        volumeTodayRub: toFiniteNumber(quote.VALTODAY),
      };
    }
    return result;
  }

  /**
   * Получить котировки с конкретной доски (облигации EQOB, ETF TQTF).
   *
   * @param tickers — коды инструментов (SECID)
   * @param board — доска торгов (по умолчанию EQOB для облигаций)
   * @returns мапа SECID → { price, changePct, volumeTodayRub }.
   */
  async fetchBoardQuotes(
    tickers: string[],
    board: string = 'EQOB',
  ): Promise<Record<string, MoexFetchedQuote>> {
    const clean = tickers
      .map((t) =>
        String(t ?? '')
          .trim()
          .toUpperCase(),
      )
      .filter((t) => t.length > 0);

    if (clean.length === 0) {
      return {};
    }

    let data: MoexBoardQuotesResponse;
    try {
      data = await this.bridge.call<MoexBoardQuotesResponse>({
        command: 'get_board_quotes',
        payload: { tickers: clean, board },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[MoexQuoteProvider] Python недоступен (board ${board}): ${message}`,
      );
      return {};
    }

    if (!data || !data.ok || !Array.isArray(data.quotes)) {
      const reason = data?.error ? `: ${data.error}` : '';
      const quotesCount = Array.isArray(data?.quotes) ? data.quotes.length : 0;
      console.warn(
        `[MoexQuoteProvider] Пустой ответ get_board_quotes ${board}${reason}` +
          ` (ok=${data?.ok}, quotes=${quotesCount})`,
      );
      return {};
    }

    const result: Record<string, MoexFetchedQuote> = {};
    for (const quote of data.quotes) {
      if (!quote || typeof quote.SECID !== 'string') {
        continue;
      }
      const price = toFiniteNumber(quote.LAST);
      if (price <= 0) {
        continue;
      }
      result[quote.SECID] = {
        price,
        changePct: toFiniteNumber(quote.LASTCHANGEPCT),
        volumeTodayRub: toFiniteNumber(quote.VALTODAY),
      };
    }
    return result;
  }
}
