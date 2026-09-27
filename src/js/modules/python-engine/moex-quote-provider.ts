/**
 * MoexQuoteProvider — резервный источник котировок через Python Engine.
 *
 * Основной источник котировок в DataAgent — Excel (лист «Акции»).
 * Этот провайдер ДОПОЛНЯЕТ только отсутствующие тикеры: запрашивает
 * у Python-движка команду get_quotes (MOEX ISS, board TQBR) и маппит
 * ответ SECID → { price, changePct }.
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
  /** Оборот за сегодня, ₽ (не используется, но присутствует в ответе) */
  VALTODAY?: number | string | null;
}

/** Ответ Python-моста на команду get_quotes */
export interface MoexQuotesResponse {
  ok: boolean;
  quotes?: MoexQuote[];
  error?: string;
}

/** Котировка, понятная DataAgent: цена + дневная динамика */
export interface MoexFetchedQuote {
  price: number;
  changePct: number;
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
      .map((t) => String(t ?? '').trim().toUpperCase())
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
      console.warn('[MoexQuoteProvider] Пустой/некорректный ответ get_quotes');
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
      };
    }
    return result;
  }
}
