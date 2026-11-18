import { vi } from 'vitest';

import { MoexQuotesClient } from './moex-quotes.js';

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as unknown as Response;
}

function makeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    // Берём самый специфичный маршрут: URL котировки содержит и
    // «/securities/SECID.json», и «boards/...», поэтому `find` недостаточно.
    const match = Object.keys(routes)
      .filter((key) => url.includes(key))
      .sort((a, b) => b.length - a.length)[0];
    if (!match)
      return { ok: false, json: async () => ({}) } as unknown as Response;
    return jsonResponse(routes[match]);
  }) as typeof fetch;
}

describe('MoexQuotesClient', () => {
  it('резолвит доску динамически через boards (is_primary)', async () => {
    const fetchImpl = makeFetch({
      '/securities/PLZL.json': {
        boards: {
          columns: ['boardid', 'is_primary'],
          data: [
            ['TQBR', 1],
            ['SMAL', 0],
          ],
        },
      },
    });
    const client = new MoexQuotesClient({ fetchImpl });

    await expect(client.resolveBoard('PLZL')).resolves.toBe('TQBR');
  });

  it('парсит текущую котировку: last, изменение, оборот', async () => {
    const fetchImpl = makeFetch({
      '/securities/PLZL.json': {
        boards: { columns: ['boardid', 'is_primary'], data: [['TQBR', 1]] },
      },
      '/boards/TQBR/securities/PLZL.json': {
        securities: { columns: ['SECID', 'PREVPRICE'], data: [['PLZL', 1000]] },
        marketdata: {
          columns: ['LAST', 'LASTCHANGEPCT', 'VOLTODAY', 'VALTODAY'],
          data: [[1100, 1.5, 12345, 13_579_500]],
        },
      },
    });
    const client = new MoexQuotesClient({
      fetchImpl,
      now: () => new Date('2026-11-18T13:00:00.000Z'),
    });

    const snapshot = await client.fetchCurrentQuotes(['PLZL']);

    expect(snapshot.quotes.PLZL?.last).toBe(1100);
    expect(snapshot.quotes.PLZL?.changePct).toBe(1.5);
    expect(snapshot.quotes.PLZL?.turnover).toBe(13_579_500);
    expect(snapshot.asOf).toBe('2026-11-18T13:00:00.000Z');
    expect(snapshot.unavailable).toEqual([]);
  });

  it('fail-closed: нет цены → unavailable, не ноль', async () => {
    const fetchImpl = makeFetch({
      '/securities/PLZL.json': {
        boards: { columns: ['boardid', 'is_primary'], data: [['TQBR', 1]] },
      },
      '/boards/TQBR/securities/PLZL.json': {
        securities: { columns: ['SECID'], data: [['PLZL']] },
        marketdata: { columns: ['LAST'], data: [[null]] },
      },
    });
    const client = new MoexQuotesClient({ fetchImpl });

    const snapshot = await client.fetchCurrentQuotes(['PLZL']);

    expect(snapshot.quotes.PLZL).toBeUndefined();
    expect(snapshot.unavailable).toEqual(['PLZL']);
  });

  it('история: окно из конфига и разбор свечей', async () => {
    const fetchImpl = makeFetch({
      '/securities/SBER.json': {
        boards: { columns: ['boardid', 'is_primary'], data: [['TQBR', 1]] },
      },
      '/history/engines/stock/markets/shares/boards/TQBR/securities/SBER.json':
        {
          history: {
            columns: ['TRADEDATE', 'OPEN', 'HIGH', 'LOW', 'CLOSE', 'VOLUME'],
            data: [
              ['2026-11-17', 100, 110, 99, 108, 1000],
              ['2026-11-18', 108, 112, 107, 111, 1200],
            ],
          },
        },
    });
    const client = new MoexQuotesClient({
      fetchImpl,
      now: () => new Date('2026-11-18T13:00:00.000Z'),
    });

    const bars = await client.fetchDailyHistory('SBER');

    expect(bars).toHaveLength(2);
    expect(bars[1]?.close).toBe(111);
  });

  it('резолв доски недоступен → конфиг-фолбэк, иначе null', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    }));
    const client = new MoexQuotesClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.resolveBoard('UNKNOWN')).resolves.toBeNull();
  });
});
